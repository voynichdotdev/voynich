'use client'

// What the model's owner does from its page: set the price and the operator's share, grant an enclave, retire.

import { useEffect, useId, useRef, useState } from 'react'
import { fromBase64, toBase64, type Build, type Enclave, type GrantedEnclave, type Model, type PriceUnit } from '@voynich/contract'
import { wrapKey } from 'voynich/crypto'
import { api, read } from '@/lib/api'
import { bps, hardware, short, units } from '@/lib/format'
import { loadModelKey, openKeyFile, parseKeyFile, saveModelKey, setVaultPassword, unlockVault, useVault, type SealedKeyFile } from '@/lib/keys'
import { play } from '@/lib/sound'
import { errorMessage, send } from '@/lib/tx'
import { PasswordForm } from '@/components/seal/Password'
import { StateTile } from '@/components/tile/Tile'
import s from './model-view.module.css'

type Tx = { stage: 'idle' | 'signing' | 'confirming' | 'done' | 'failed'; message?: string }

function useTx(fixture: string | null, onDone: () => void) {
  const [tx, setTx] = useState<Tx>({ stage: 'idle' })
  const busy = tx.stage === 'signing' || tx.stage === 'confirming'
  const run = async (build: () => Promise<Build>, cue?: 'grant') => {
    if (busy) return
    setTx({ stage: 'signing' })
    try {
      await send(api(fixture), await build(), (stage) => setTx({ stage }))
      setTx({ stage: 'done' })
      if (cue) play(cue)
      onDone()
    } catch (e) {
      play('failed')
      setTx({ stage: 'failed', message: errorMessage(e) })
    }
  }
  return { tx, busy, run, clear: () => setTx({ stage: 'idle' }) }
}

function TxLine({ tx, done }: { tx: Tx; done: string }) {
  if (tx.stage === 'idle') return null
  return (
    <p className={s.txLine} role="status" aria-live="polite">
      <StateTile state={tx.stage === 'done' ? 'passed' : tx.stage === 'failed' ? 'failed' : 'pending'} />
      <span className={tx.stage === 'failed' ? 'bad' : tx.stage === 'done' ? 'ochre' : 'sub'}>
        {tx.stage === 'signing' ? 'Awaiting signature' : tx.stage === 'confirming' ? 'Confirming' : tx.stage === 'done' ? done : tx.message}
      </span>
    </p>
  )
}

// A decimal typed by a person to base units, or null when it is not an amount.
function toBase(text: string, decimals: number): string | null {
  const m = /^(\d+)(?:\.(\d*))?$/.exec(text.trim().replaceAll(',', ''))
  if (!m) return null
  const frac = m[2] ?? ''
  if (frac.length > decimals) return null
  return (BigInt(m[1]!) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, '0') || '0')).toString()
}

type Props = { model: Model; fixture: string | null; signer: string; grants: GrantedEnclave[]; onChanged: () => void }

export function OwnerPanel({ model, fixture, signer, grants, onChanged }: Props) {
  const client = api(fixture)
  const protocol = model.protocolShareBps ?? 0

  // ---- price
  const [priceUnit, setPriceUnit] = useState<PriceUnit>(model.priceUnit ?? 'call')
  const [price, setPrice] = useState(units(model.price.amount, model.price.decimals, model.price.decimals).replaceAll(',', ''))
  const [share, setShare] = useState(String(model.operatorShareBps / 100))
  const unitId = useId()
  const priceTx = useTx(fixture, onChanged)
  const amount = toBase(price, model.price.decimals)
  const shareBps = /^\d+(\.\d{1,2})?$/.test(share.trim()) ? Math.round(Number(share) * 100) : NaN
  const priceErr = amount === null ? `Enter an amount in ${model.price.symbol}.` : ''
  const shareErr = Number.isNaN(shareBps) ? 'Enter a share in percent.' : shareBps + protocol > 10000 ? `At most ${bps(10000 - protocol)} is left after the protocol share.` : ''
  const priceSame = amount === model.price.amount && shareBps === model.operatorShareBps && priceUnit === (model.priceUnit ?? 'call')

  // ---- grant
  const [enclaves, setEnclaves] = useState<Enclave[] | null>(null)
  const [enclavesErr, setEnclavesErr] = useState('')
  const [picked, setPicked] = useState<string | null>(null)
  const [key, setKey] = useState<Uint8Array | null>(null)
  const [keyErr, setKeyErr] = useState('')
  const [pwBusy, setPwBusy] = useState(false)
  const [keyFile, setKeyFile] = useState<{ name: string; sealed: SealedKeyFile } | null>(null) // a chosen key file that waits for its password
  const file = useRef<HTMLInputElement>(null)
  const pwId = useId()
  const vault = useVault()
  const grantTx = useTx(fixture, onChanged)
  const saved = () => loadModelKey(model.address) ?? loadModelKey(model.name)
  useEffect(() => { if (vault.unlocked) setKey((k) => k ?? saved()) }, [vault.unlocked, model.address, model.name]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    void read(api(fixture).enclaves({ limit: 100 })).then((r) => {
      if (r.ok) setEnclaves(r.data.items.filter((e) => model.allowedMeasurements.includes(e.measurement)))
      else setEnclavesErr(r.message)
    })
  }, [fixture, model.address, model.allowedMeasurements])
  const holds = (address: string) => grants.some((g) => g.enclave.address === address && g.grant.status === 'live')
  const chosen = enclaves?.find((e) => e.address === picked) ?? null
  const canGrant = model.status === 'sealed' || model.status === 'live'
  const grantWhy = !canGrant ? (model.status === 'retired' ? 'A retired model is not granted.' : 'Seal the model before granting it.')
    : !chosen ? 'Choose an enclave.'
    : !key ? 'The model key is not in this browser. Choose its key file.' : ''
  // The keys in this browser wait for their password: it is asked where Grant would be.
  const locked = !key && !keyFile && !vault.unlocked && (vault.exists || vault.plain)
  const grant = (k: Uint8Array) => {
    if (!canGrant || !chosen) return
    void grantTx.run(() => client.grantByOwner(model.address, { wallet: signer, enclave: chosen.address, wrappedKey: toBase64(wrapKey(k, fromBase64(chosen.encryptionKey))) }), 'grant').then(() => setPicked(null))
  }
  // With the key in hand the grant goes on by itself when an enclave is already chosen.
  const hold = (k: Uint8Array) => { setKey(k); setKeyFile(null); setKeyErr(''); grant(k) }
  const unlock = async (password: string) => {
    const ok = await (vault.exists ? unlockVault(password) : setVaultPassword(password))
    const k = ok ? saved() : null
    if (k) hold(k)
    return ok
  }
  const openChosen = async (password: string) => {
    const k = keyFile ? await openKeyFile(keyFile.sealed, password) : null
    if (!k) return false
    if (vault.unlocked) saveModelKey(model.address, k)
    hold(k)
    return true
  }
  const readKey = async (f: File | undefined) => {
    if (!f) return
    const parsed = parseKeyFile(await f.text())
    if (!parsed) { setKeyErr('This is not a model key file.'); return }
    if (parsed.model !== model.address && parsed.model !== model.name) { setKeyErr('This key file belongs to another model.'); return }
    setKeyErr('')
    if ('key' in parsed) { if (vault.unlocked) saveModelKey(model.address, parsed.key); hold(parsed.key) }
    else setKeyFile({ name: f.name, sealed: parsed.sealed })
  }
  const choose = <input ref={file} type="file" accept=".json,application/json" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void readKey(f) }} />

  // ---- retire
  const [confirming, setConfirming] = useState(false)
  const retireTx = useTx(fixture, onChanged)

  return (
    <section className={`panel ${s.owner}`} aria-labelledby="owner">
      <div className="panel-head"><h2 id="owner">Owner</h2><span className="t-small dim">You own this model.</span></div>
      <div className={s.ownerBody}>
        <form className={s.ownerCol} noValidate onSubmit={(e) => { e.preventDefault(); if (!priceErr && !shareErr && !priceSame) void priceTx.run(() => client.setPrice(model.address, { wallet: signer, price: { ...model.price, amount: amount! }, operatorShareBps: shareBps, priceUnit })) }}>
          <h3 className="t-h3">Set price</h3>
          <div className="field">
            <span className="t-label" id={unitId}>Pricing unit</span>
            <div className="seg" role="group" aria-labelledby={unitId}>
              <button type="button" aria-pressed={priceUnit === 'call'} onClick={() => { play('toggle'); setPriceUnit('call'); priceTx.clear() }}>Per call</button>
              <button type="button" aria-pressed={priceUnit === 'token'} onClick={() => { play('toggle'); setPriceUnit('token'); priceTx.clear() }}>Per token</button>
            </div>
          </div>
          <div className={s.pair}>
            <div className="field">
              <label htmlFor="own-price">{priceUnit === 'token' ? 'Price a token' : 'Price a call'}</label>
              <div className="input-row">
                <input id="own-price" className="input mono" inputMode="decimal" autoComplete="off" value={price} onChange={(e) => { setPrice(e.target.value); priceTx.clear() }} aria-invalid={priceErr ? true : undefined} />
                <span className="suffix">{model.price.symbol}</span>
              </div>
              {priceErr ? <span className="err">{priceErr}</span> : null}
            </div>
            <div className="field">
              <label htmlFor="own-share">Operator share</label>
              <div className="input-row">
                <input id="own-share" className="input mono" inputMode="decimal" autoComplete="off" value={share} onChange={(e) => { setShare(e.target.value); priceTx.clear() }} aria-invalid={shareErr ? true : undefined} />
                <span className="suffix">%</span>
              </div>
              {shareErr ? <span className="err">{shareErr}</span> : null}
            </div>
          </div>
          <div className={s.ownerAct}>
            <button type="submit" className="btn" data-kind="primary" data-size="s" disabled={!!priceErr || !!shareErr || priceSame} data-pending={priceTx.busy || undefined}>Set price</button>
            {priceTx.tx.stage === 'idle' && priceSame ? <span className="t-small dim">Change a value to set it.</span> : null}
            <TxLine tx={priceTx.tx} done="Price set" />
          </div>
        </form>

        <div className={s.ownerCol}>
          <h3 className="t-h3">Grant an enclave</h3>
          {enclavesErr ? <p className="t-small bad" role="alert">{enclavesErr}</p>
            : !enclaves ? <span className="skeleton" style={{ width: '70%' }} />
            : enclaves.length === 0 ? <p className="t-small">No registered enclave runs a measurement this model allows.</p>
            : (
              <ul className={s.pick} role="radiogroup" aria-label="Enclave to grant">
                {enclaves.map((e) => {
                  const why = e.status === 'expired' ? 'Expired' : holds(e.address) ? 'Holds a grant' : ''
                  return (
                    <li key={e.address}>
                      <button type="button" role="radio" aria-checked={picked === e.address} disabled={!!why} onClick={() => { setPicked(e.address); grantTx.clear() }}>
                        <StateTile state={picked === e.address ? 'live' : 'waiting'} />
                        <span className="mono">{short(e.address, 6)}</span>
                        <span className="t-small dim">{why || hardware(e.hardwareType)}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          {locked || keyFile ? (
            <>
              {keyFile ? (
                <div className={s.keyRow}>
                  <StateTile state="waiting" />
                  <span className={`mono ${s.keyName}`}>{keyFile.name}</span>
                </div>
              ) : null}
              <PasswordForm key={keyFile?.name ?? 'browser'} id={pwId} mode={keyFile ? 'file' : vault.exists ? 'unlock' : 'set'} run={keyFile ? openChosen : unlock} onBusy={setPwBusy} bare>
                {keyErr ? <p className="t-small bad" role="alert">{keyErr}</p> : null}
                <div className={s.ownerAct}>
                  <button type="submit" className="btn" data-kind="primary" data-size="s" data-pending={pwBusy || undefined} disabled={pwBusy}>
                    {pwBusy ? <StateTile state="pending" size={14} /> : null}{keyFile ? (pwBusy ? 'Opening' : 'Open key file') : vault.exists ? (pwBusy ? 'Unlocking' : 'Unlock') : pwBusy ? 'Setting password' : 'Set password'}
                  </button>
                  {choose}
                  <button type="button" className="btn" data-size="s" disabled={pwBusy} onClick={() => file.current?.click()}>{keyFile ? 'Choose another file' : 'Choose key file'}</button>
                </div>
              </PasswordForm>
            </>
          ) : (
            <>
              <div className={s.keyRow}>
                <StateTile state={key ? 'sealed' : 'waiting'} />
                <span className="t-small">{key ? 'The model key is on this device.' : 'The model key is not in this browser.'}</span>
                {key ? null : (
                  <>
                    {choose}
                    <button type="button" className="btn" data-size="s" onClick={() => file.current?.click()}>Choose key file</button>
                  </>
                )}
              </div>
              {keyErr ? <p className="t-small bad" role="alert">{keyErr}</p> : null}
              <div className={s.ownerAct}>
                <button type="button" className="btn" data-kind="primary" data-size="s" disabled={!!grantWhy} data-pending={grantTx.busy || undefined} onClick={() => grant(key!)}>
                  Grant
                </button>
                {grantTx.tx.stage === 'idle' && grantWhy ? <span className="t-small dim">{grantWhy}</span> : null}
                <TxLine tx={grantTx.tx} done="Granted" />
              </div>
            </>
          )}
        </div>

        <div className={s.ownerCol}>
          <h3 className="t-h3">Retire</h3>
          {model.status === 'retired' ? (
            <p className="t-small">This model is retired. It takes no new calls.</p>
          ) : (
            <>
              <p className="t-small">A retired model takes no new calls. Its ciphertext and its receipts stay on chain.</p>
              <div className={s.ownerAct}>
                {confirming ? (
                  <>
                    <button type="button" className="btn" data-kind="danger" data-size="s" data-pending={retireTx.busy || undefined} onClick={() => void retireTx.run(() => client.retireModel(model.address, { wallet: signer })).then(() => setConfirming(false))}>Retire {model.name}</button>
                    <button type="button" className="btn" data-size="s" disabled={retireTx.busy} onClick={() => setConfirming(false)}>Keep it</button>
                  </>
                ) : (
                  <button type="button" className="btn" data-kind="danger" data-size="s" onClick={() => { retireTx.clear(); setConfirming(true) }}>Retire</button>
                )}
                {confirming && retireTx.tx.stage === 'idle' ? <span className="t-small dim">This cannot be undone.</span> : null}
              </div>
            </>
          )}
          <TxLine tx={retireTx.tx} done="Retired" />
        </div>
      </div>
    </section>
  )
}
