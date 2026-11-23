'use client'

// One sealed model: the call beside its facts, its ciphertext, the enclaves that hold it and the receipts it left.
// The page hands over what the server read; this keeps it current after a call settles or the owner changes it.

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import type { Config, GrantedEnclaves, Model, ModelPolicy, ReceiptsPage } from '@voynich/contract'
import { api, read, type Read } from '@/lib/api'
import { LINKS } from '@/lib/facts'
import { bps, group, hardware, short } from '@/lib/format'
import { effectiveShareBps, formatLatency } from '@/lib/call'
import { findMeasurement, loadMeasurements, type MeasurementMap } from '@/lib/measurements'
import { formatRateCeiling, loadModelPolicy } from '@/lib/policy'
import { wallet } from '@/lib/wallet'
import { useWallet } from '@/src/engines/wallet/react'
import { State, TileStrip } from '@/components/tile/Tile'
import { MeasurementSource } from '@/components/ui/MeasurementSource'
import { Amount, Empty, Explorer, Failed, Hash, Size, Stat } from '@/components/ui/kit'
import { CallPanel } from './CallPanel'
import { CipherView } from './CipherView'
import { OwnerPanel } from './OwnerPanel'
import s from './model-view.module.css'

type Props = {
  fixture: string | null
  asOwner: boolean
  initial: { model: Model; enclaves: Read<GrantedEnclaves>; receipts: Read<ReceiptsPage>; measurements?: MeasurementMap; policy?: ModelPolicy | null }
}

export function ModelView({ fixture, asOwner, initial }: Props) {
  const w = useWallet(wallet)
  const [model, setModel] = useState(initial.model)
  const [enclaves, setEnclaves] = useState(initial.enclaves)
  const [receipts, setReceipts] = useState(initial.receipts)
  const [measurements, setMeasurements] = useState<MeasurementMap>(initial.measurements ?? {})
  const [policy, setPolicy] = useState<ModelPolicy | null>(initial.policy ?? null)
  const [config, setConfig] = useState<Config | null>(null)
  const id = initial.model.address
  const q = fixture ? `?fixture=${fixture}` : ''

  const refresh = useCallback(async () => {
    const client = api(fixture)
    const [m, e, r, ms] = await Promise.all([
      read(client.model(id)),
      read(client.modelEnclaves(id)),
      read(client.modelReceipts(id, { limit: 8 })),
      loadMeasurements(client),
    ])
    const nextModel = m.ok ? m.data : model
    if (m.ok) setModel(m.data)
    setEnclaves(e)
    setReceipts(r)
    setMeasurements(ms)
    setPolicy(await loadModelPolicy(client, nextModel))
  }, [fixture, id]) // eslint-disable-line react-hooks/exhaustive-deps

  // After a confirmation the API's read follows the chain by a moment: read now and once more shortly after.
  const refreshSoon = useCallback(() => { void refresh(); setTimeout(() => void refresh(), 2500) }, [refresh])

  useEffect(() => {
    void refresh()
    void read(api(fixture).config()).then((c) => { if (c.ok) setConfig(c.data) })
  }, [fixture, refresh])

  // The owner's wallet sees the owner's tools. On a sample API the view can be opened as the owner.
  const isOwner = (w.status === 'connected' && w.address === model.owner) || (asOwner && !!config?.fixture)
  const live = model.status === 'live'
  const perToken = model.priceUnit === 'token'
  const protocol = model.protocolShareBps ?? config?.protocolShareBps ?? null
  const ownerBps = 10000 - model.operatorShareBps - (protocol ?? 0)
  const split = [
    { name: 'Owner', bps: ownerBps, step: 14 },
    { name: 'Operator', bps: model.operatorShareBps, step: 10 },
    ...(protocol === null ? [] : [{ name: 'Protocol', bps: protocol, step: 6 }]),
  ].filter((p) => p.bps > 0)

  const facts = (
    <section className={`panel ${s.facts}`} aria-labelledby="facts">
      <div className="panel-head"><h2 id="facts">Facts</h2></div>
      <dl className={`kv ${s.kv}`}>
        <dt>Owner</dt><dd><Hash value={model.owner} chars={6} label="owner address" /></dd>
        <dt>Sealed at slot</dt><dd>{model.sealedSlot ? <span className="mono">{group(model.sealedSlot)}</span> : <span className="sub">Not sealed yet</span>}</dd>
        <dt>Input</dt><dd className="mono">{model.manifest.inputKind}</dd>
        <dt>Ciphertext</dt><dd><Size n={model.sizeBytes} /></dd>
        <dt>Plaintext</dt><dd><Size n={model.plaintextSizeBytes} /></dd>
        <dt>Cipher</dt><dd className="mono">{model.cipher.id}</dd>
        <dt>Price</dt><dd><Amount value={model.price} />{perToken ? <span className="t-small dim"> / token</span> : null}</dd>
        <dt className={s.wide}>Split of the price</dt>
        <dd className={s.wide}>
          <TileStrip parts={split.map((p) => ({ share: p.bps / 10000, step: p.step }))} cells={36} height={14} />
          <div className={s.split}>
            {split.map((p) => <span key={p.name} style={{ flexGrow: Math.max(p.bps, 1400) }}><span className="t-label">{p.name}</span> <span className="mono">{bps(p.bps)}</span></span>)}
          </div>
          <Link href={LINKS.token} className={`link t-small ${s.fees}`} data-arrow>Fees and the token</Link>
        </dd>
        <dt className={s.wide}>Allowed measurements</dt>
        <dd className={s.wide}>
          <ul className={s.measures}>
            {model.allowedMeasurements.map((m) => (
              <li key={m}>
                <Hash value={m} chars={12} label="measurement" />
                <MeasurementSource record={findMeasurement(measurements, m)} />
              </li>
            ))}
          </ul>
        </dd>
        <dt className={s.wide}>{model.hashVersion === 1 ? 'Ciphertext Merkle root (64 KiB chunks)' : 'SHA-256 of the ciphertext'}</dt>
        <dd className={s.wide}>{model.ciphertextSha256 ? <Hash value={model.ciphertextSha256} full label="ciphertext hash" /> : <span className="sub">Fixed when the model is sealed</span>}</dd>
        {model.base ? (
          <>
            <dt className={s.wide}>Base model</dt>
            <dd className={`${s.wide} ${s.baseMeta}`}>
              <span className={s.baseSummary}>
                <span className="mono">{model.base.format}</span>
                <Size n={model.base.sizeBytes} />
              </span>
              {model.base.source.startsWith('https://') || model.base.source.startsWith('http://') ? (
                <a className={`link mono ${s.baseSource}`} href={model.base.source} target="_blank" rel="noreferrer">{model.base.source}</a>
              ) : (
                <span className={`mono ${s.baseSource}`}>{model.base.source}</span>
              )}
            </dd>
            <dt className={s.wide}>Base SHA-256</dt>
            <dd className={s.wide}><Hash value={model.base.sha256} full label="base model hash" /></dd>
          </>
        ) : null}
        {policy ? (
          <>
            <dt className={s.wide}>Policy</dt>
            <dd className={s.wide}>
              <div className={s.policySummary}>
                <div className={s.policyRow}>
                  <span className="t-label">Allow list</span>
                  <span>
                    {policy.allowListEnabled
                      ? `Restricted (${group(policy.allowedCallers.length)} ${policy.allowedCallers.length === 1 ? 'caller' : 'callers'})`
                      : 'Open'}
                  </span>
                </div>
                {formatRateCeiling(policy) ? (
                  <div className={s.policyRow}>
                    <span className="t-label">Rate ceiling</span>
                    <span className="mono">{formatRateCeiling(policy)}</span>
                  </div>
                ) : null}
                {policy.allowedOperators.length > 0 ? (
                  <div className={s.policyRow}>
                    <span className="t-label">Allowed operators</span>
                    <span className="mono">{group(policy.allowedOperators.length)} {policy.allowedOperators.length === 1 ? 'operator' : 'operators'}</span>
                  </div>
                ) : null}
                {policy.allowedRegions.length > 0 ? (
                  <div className={s.policyRow}>
                    <span className="t-label">Allowed regions</span>
                    <span className={s.policyPills}>
                      {policy.allowedRegions.map((reg) => <span key={reg} className={s.kindBadge}>{reg}</span>)}
                    </span>
                  </div>
                ) : null}
              </div>
            </dd>
          </>
        ) : null}
      </dl>
    </section>
  )

  return (
    <div className={`container page ${s.page}`}>
      <header className={s.head}>
        <div className={s.title}>
          <nav className="crumb" aria-label="Breadcrumb"><Link href={`/models${q}`}>Models</Link><span aria-hidden="true">/</span><span>{model.name}</span></nav>
          <div className={s.nameRow}>
            <h1 className={s.name}>{model.name}</h1>
            <State state={model.status} />
          </div>
          <div className={s.address}>
            <Hash value={model.address} chars={10} label="model address" />
            <Explorer kind="address" id={model.address} />
          </div>
        </div>
        <div className={s.stats}>
          <Stat label={perToken ? 'Price a token' : 'Price a call'}><Amount value={model.price} size="m" /></Stat>
          <Stat label="Calls settled"><span className="t-fig t-fig-m">{group(model.callsSettled)}</span></Stat>
          <Stat label="Enclaves holding it"><span className="t-fig t-fig-m">{group(model.enclavesHolding)}</span></Stat>
        </div>
      </header>

      <div className={`grid ${s.regions}`}>
        <div className={live ? s.call : s.full}>
          <CallPanel model={model} fixture={fixture} owner={isOwner} enclaves={enclaves.ok ? enclaves.data.items : null} policy={policy} onSettled={refreshSoon} />
        </div>

        {live ? facts : null}

        {isOwner ? (
          <div className={s.full}>
            <OwnerPanel model={model} fixture={fixture} signer={w.address === model.owner ? w.address : model.owner} grants={enclaves.ok ? enclaves.data.items : []} policy={policy} onChanged={refreshSoon} />
          </div>
        ) : null}

        <section className={`panel ${live ? s.full : s.cipher}`} aria-labelledby="ciphertext">
          <div className="panel-head">
            <h2 id="ciphertext">Ciphertext</h2>
            <span className="t-small dim">Read from chain. Anyone can fetch it.</span>
          </div>
          <div className="panel-body">
            <CipherView model={model.address} fixture={fixture} rows={live ? 8 : 16} hashVersion={model.hashVersion} />
          </div>
        </section>

        {live ? null : facts}

        <section className={`panel ${s.half}`} aria-labelledby="enclaves">
          <div className="panel-head"><h2 id="enclaves">Enclaves holding a grant</h2></div>
          {!enclaves.ok ? <div className={`panel-body ${s.fail}`}><Failed title="The enclaves did not load" message={enclaves.message} retry={<button type="button" className="btn" data-size="s" onClick={() => void refresh()}>Try again</button>} /></div>
            : enclaves.data.items.length === 0 ? <div className="panel-body"><Empty title="No enclave holds this model yet">An enclave answers calls once the owner grants it the model key.</Empty></div>
            : (
              <ul className={s.list} style={{ '--cols': 'minmax(0, 1.15fr) minmax(0, 0.7fr) minmax(0, 1.15fr) minmax(0, 0.85fr) minmax(0, 0.8fr) minmax(0, 0.7fr)' } as React.CSSProperties}>
                <li className={s.listHead} aria-hidden="true"><span>Enclave</span><span>Hardware</span><span>Measurement</span><span className={s.num}>Quoted share</span><span className={s.num}>Median latency</span><span>Grant</span></li>
                {enclaves.data.items.map(({ enclave, grant }) => {
                  const share = effectiveShareBps(grant, model.operatorShareBps)
                  const discounted = grant.quotedOperatorShareBps !== null && grant.quotedOperatorShareBps !== undefined && grant.quotedOperatorShareBps < model.operatorShareBps
                  return (
                    <li key={grant.address} className={s.row}>
                      <span data-label="Enclave"><Hash value={enclave.signingKey} chars={4} href={`/enclaves/${enclave.address}${q}`} label="enclave address" /></span>
                      <span data-label="Hardware">{hardware(enclave.hardwareType)}</span>
                      <span data-label="Measurement">
                        <Hash value={enclave.measurement} chars={4} label="measurement" />
                        <MeasurementSource record={findMeasurement(measurements, enclave.measurement)} compact />
                      </span>
                      <span data-label="Quoted share" className={`mono ${s.num}`} title={discounted ? `Quoted below model ceiling (${bps(model.operatorShareBps)})` : `Model ceiling (${bps(model.operatorShareBps)})`}>
                        {bps(share)}{discounted ? <span className={s.programBadge} style={{ marginLeft: 6 }}>Quoted</span> : null}
                      </span>
                      <span data-label="Median latency" className={`mono ${s.num}`}>{formatLatency(grant.medianAnswerMs)}</span>
                      <span data-label="Grant"><State state={grant.status} /></span>
                    </li>
                  )
                })}
              </ul>
            )}
        </section>

        <section className={`panel ${s.half}`} aria-labelledby="receipts">
          <div className="panel-head"><h2 id="receipts">Recent receipts</h2></div>
          {!receipts.ok ? <div className={`panel-body ${s.fail}`}><Failed title="The receipts did not load" message={receipts.message} retry={<button type="button" className="btn" data-size="s" onClick={() => void refresh()}>Try again</button>} /></div>
            : receipts.data.items.length === 0 ? <div className="panel-body"><Empty title="No receipts yet">Every settled call leaves one here.</Empty></div>
            : (
              <ul className={s.list} style={{ '--cols': 'minmax(0, 0.8fr) minmax(0, 1.35fr) minmax(0, 1.05fr) minmax(0, 0.9fr)' } as React.CSSProperties}>
                <li className={s.listHead} aria-hidden="true"><span>Slot</span><span>Caller</span><span>Output hash</span><span className={s.num}>Paid</span></li>
                {receipts.data.items.map((r) => (
                  <li key={r.address}>
                    <Link href={`/receipts/${r.address}${q}`} className={`${s.row} row-link`} aria-label={`Receipt at slot ${r.slot}`}>
                      <span data-label="Slot" className="mono">{group(r.slot)}</span>
                      <span data-label="Caller" className={s.callerCell}>
                        <span className="mono" title={r.caller}>{short(r.caller, 4)}</span>
                        {r.callerIsProgram ? <span className={s.programBadge}>Program</span> : null}
                      </span>
                      <span data-label="Output hash" className="mono">{short(r.outputHash, 6)}</span>
                      <span data-label="Paid" className={s.num}><Amount value={{ amount: r.payments.total, decimals: model.price.decimals, symbol: model.price.symbol }} /></span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
        </section>
      </div>
    </div>
  )
}
