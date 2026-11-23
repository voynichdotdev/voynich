'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { fromBase64, type Config, type MeasurementRecord, type Model, type ModelVersion, type ReceiptView as View } from '@voynich/contract'
import { api, type Read } from '@/lib/api'
import { decodeOpenAnswer } from '@/lib/call'
import { RECEIPT_CHECKS } from '@/lib/facts'
import { group, short } from '@/lib/format'
import { play } from '@/lib/sound'
import { verifyAll, type CheckId, type CheckResult } from '@/lib/verify'
import { RAMP, BARE_BELOW, capFill, C } from '@/components/field/ramp'
import { Frame } from '@/components/drawn/Drawn'
import { StateTile } from '@/components/tile/Tile'
import { MeasurementSource } from '@/components/ui/MeasurementSource'
import { Amount, Explorer, Failed, Hash, Loading, Size } from '@/components/ui/kit'
import { isNotFound, loadReceipt, type ReceiptBundle } from './load'
import { ReceiptField } from './ReceiptField'
import { HalfHash } from './HalfHash'
import { Split, moneyOf, q } from './shared'
import s from './receipt.module.css'

export function ReceiptPage({ id, fixture, initial }: { id: string; fixture: string | null; initial: Read<ReceiptBundle> }) {
  const [r, setR] = useState(initial)
  // A receipt this browser's own session wrote is read from the browser before the page says it is not there.
  const [again, setAgain] = useState(!initial.ok && isNotFound(initial.code))
  useEffect(() => {
    if (!again) return
    let live = true
    void loadReceipt(api(fixture), id).then((x) => { if (live) { setR(x); setAgain(false) } })
    return () => { live = false }
  }, [again, fixture, id])

  if (again) return <ReceiptLoading />
  if (!r.ok) {
    return (
      <div className="container page">
        <nav className="crumb" aria-label="Breadcrumb"><Link href={`/receipts${q(fixture)}`}>Receipts</Link><span>/</span><span>Receipt</span></nav>
        {isNotFound(r.code) ? (
          <>
            <div className="page-head">
              <div>
                <h1 className="t-h1">Receipt</h1>
                <p className="t-small">Nothing is recorded under this id.</p>
              </div>
            </div>
            <div className={s.missing}>
              <div>
                <div className="t-label">The id asked for</div>
                <p className={`mono ${s.missingId}`}>{id}</p>
              </div>
              <ReceiptField fixture={fixture} label="Another receipt id, call address or transaction signature" />
            </div>
          </>
        ) : (
          <>
            <div className="page-head"><h1 className="t-h1">Receipt</h1></div>
            <Failed title="This receipt did not load" message={r.message} />
          </>
        )}
      </div>
    )
  }
  return <Receipt fixture={fixture} view={r.data.view} model={r.data.model} config={r.data.config} measurement={r.data.measurement ?? null} version={r.data.version ?? null} />
}

export function ReceiptLoading() {
  return (
    <div className="container page">
      <div className="page-head"><h1 className="t-h1">Receipt</h1></div>
      <div className={`grid ${s.layout}`}>
        <div className={s.main}><div className={s.verdict}><Loading rows={3} /></div><Loading rows={5} /></div>
        <div className={s.side}><div className="panel"><div className="panel-body"><Loading rows={7} /></div></div></div>
      </div>
    </div>
  )
}

type Results = Partial<Record<CheckId, CheckResult>>

function Receipt({ fixture, view, model, config, measurement, version }: { fixture: string | null; view: View; model: Model | null; config: Config | null; measurement: MeasurementRecord | null; version: ModelVersion | null }) {
  const { receipt } = view
  const [results, setResults] = useState<Results>({})
  const [done, setDone] = useState(false)
  const run = useRef(0)

  const verify = useCallback(async () => {
    const me = ++run.current
    setResults({})
    setDone(false)
    await new Promise((res) => setTimeout(res, 450))
    if (me !== run.current) return
    await verifyAll(view, config, (c) => {
      if (me !== run.current) return
      setResults((p) => ({ ...p, [c.id]: c }))
      play(c.passed ? 'check' : 'failed')
    })
    if (me === run.current) setDone(true)
  }, [view, config])

  useEffect(() => {
    void verify()
    return () => { run.current++ }
  }, [verify])

  const failed = RECEIPT_CHECKS.filter((c) => results[c.id] && !results[c.id]!.passed).length
  const state = !done ? 'pending' : failed ? 'failed' : 'verified'
  const total = RECEIPT_CHECKS.length

  const p = receipt.payments
  const metered = receipt.deliveredCount !== null && receipt.deliveredCount !== undefined
  const returnedAmount = receipt.returnedAmount ?? '0'
  const ceilingAmount = metered ? (BigInt(p.total) + BigInt(returnedAmount)).toString() : null
  const unit = (amount: string) => moneyOf(amount, p.mint, [model?.price])
  const share = (amount: string) => (p.total === '0' ? 0 : Number((BigInt(amount) * 10000n) / BigInt(p.total)) / 10000)
  const rows = [
    { id: 'owner' as const, label: 'Owner', pay: p.owner },
    { id: 'operator' as const, label: 'Operator', pay: p.operator },
    { id: 'protocol' as const, label: 'Protocol', pay: p.protocol },
  ]

  const open = (() => {
    if (receipt.answerMode !== 'open' || !receipt.openAnswer) return null
    try { return decodeOpenAnswer(receipt.openAnswer) } catch { return null }
  })()
  const openTop = open?.output?.scores[0]

  return (
    <div className="container page">
      <nav className="crumb" aria-label="Breadcrumb"><Link href={`/receipts${q(fixture)}`}>Receipts</Link><span>/</span><span className="mono">{short(receipt.address, 6)}</span></nav>
      <div className="page-head">
        <div>
          <h1 className="t-h1">Receipt</h1>
          <p className="t-small">
            {metered ? (
              <>Metered stream from <Link className="link mono" href={`/models/${receipt.modelName}${q(fixture)}`}>{receipt.modelName}</Link> (<span className="mono">{group(receipt.deliveredCount!)}</span> {receipt.deliveredCount === '1' ? 'token' : 'tokens'}), settled at slot <span className="mono">{group(receipt.slot)}</span>.</>
            ) : (
              <>One answer from <Link className="link mono" href={`/models/${receipt.modelName}${q(fixture)}`}>{receipt.modelName}</Link>, settled at slot <span className="mono">{group(receipt.slot)}</span>.</>
            )}
          </p>
        </div>
        <Explorer kind="tx" id={receipt.transactionSignature}>Settlement on the explorer</Explorer>
      </div>

      <div className={`grid ${s.layout}`}>
        <section className={s.main} aria-labelledby="verdict">
          <Frame className={s.verdict} color={state === 'verified' ? 'var(--ochre)' : 'transparent'}>
            <div className={s.verdictRow}>
              <div aria-live="polite">
                <h2 id="verdict" className={`t-display ${s.word}`} data-state={state}>{state === 'verified' ? 'Verified' : state === 'failed' ? 'Not verified' : 'Verifying'}</h2>
                <p className="t-small">
                  {state === 'verified' ? `${total} of ${total} checks passed in this browser.` : state === 'failed' ? `${failed} of ${total} checks failed in this browser.` : `Running ${total} checks in this browser.`}
                </p>
              </div>
              <button type="button" className="btn" data-size="s" onClick={() => void verify()} disabled={!done}>Verify again</button>
            </div>
          </Frame>

          {open ? (
            <section className={`panel ${s.openAnswer}`} aria-labelledby="open-answer">
              <div className="panel-head">
                <h2 id="open-answer">Open answer on chain</h2>
                <Size n={open.byteLength} size="s" />
              </div>
              <div className={`panel-body ${s.openBody}`}>
                {open.output?.label ? (
                  <div className={s.openTop}>
                    <span className={s.openLabel}>{open.output.label}</span>
                    {openTop ? <span className="t-fig t-fig-m">{(openTop.probability * 100).toFixed(0)}<span className="unit">%</span></span> : null}
                  </div>
                ) : open.output?.text !== null && open.output?.text !== undefined ? (
                  <div className={s.openTextWrap}>
                    <p className={s.openText}>{open.output.text || <span className="dim">(empty)</span>}</p>
                    {open.output.tokens !== null || open.output.finishReason ? (
                      <div className={`mono ${s.openTextMeta}`}>
                        {open.output.tokens !== null ? <span>{group(open.output.tokens)} {open.output.tokens === 1 ? 'token' : 'tokens'}</span> : null}
                        {open.output.finishReason ? <span>finish: {open.output.finishReason}</span> : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <pre className={`mono ${s.openPayload}`}>{open.text}</pre>
              </div>
            </section>
          ) : null}

          <ol className={s.checks}>
            {RECEIPT_CHECKS.map((c) => {
              const res = results[c.id]
              const st = !res ? 'pending' : res.passed ? 'passed' : 'failed'
              return (
                <li key={c.id} data-state={st}>
                  <span className={s.checkTile}><StateTile state={st} size={20} /></span>
                  <div>
                    <h3 className="t-h3">{c.label}<span className="sr-only">: {st}</span></h3>
                    <p className="t-small dim">{c.says}</p>
                    <p className={`t-small ${s.detail}`}>{res ? res.detail : String.fromCharCode(160)}</p>
                    {c.id === 'signature' ? <SigTiles bytes={fromBase64(receipt.signature)} lit={!!res?.passed} /> : null}
                  </div>
                </li>
              )
            })}
          </ol>
        </section>

        <aside className={s.side}>
          <section className="panel" aria-labelledby="facts">
            <div className="panel-head"><h2 id="facts">Receipt</h2><Hash value={receipt.address} label="receipt id" /></div>
            <div className="panel-body">
              <dl className="kv">
                <dt>Call</dt><dd><Hash value={receipt.call} label="call address" /></dd>
                <dt>Caller</dt>
                <dd className={s.callerVal}>
                  <Hash value={receipt.caller} label="caller address" />
                  {receipt.callerIsProgram ? <span className={s.programBadge}>Program</span> : null}
                </dd>
                <dt>Model</dt><dd><Link className="link mono" href={`/models/${receipt.modelName}${q(fixture)}`}>{receipt.modelName}</Link></dd>
                {version ? (
                  <>
                    <dt>Model version</dt>
                    <dd className={s.callerVal}>
                      <span className="mono">v{version.version}</span>
                      {version.ciphertextSha256 ? <Hash value={version.ciphertextSha256} chars={6} label="weights hash" /> : null}
                    </dd>
                  </>
                ) : null}
                <dt>Enclave</dt><dd><Hash value={receipt.enclave} href={`/enclaves/${receipt.enclave}${q(fixture)}`} label="enclave address" /></dd>
                <dt>Enclave key</dt><dd><Hash value={view.enclaveSigningKey} label="enclave key" /></dd>
                {measurement ? (
                  <>
                    <dt>Runtime source</dt>
                    <dd><MeasurementSource record={measurement} /></dd>
                  </>
                ) : null}
                <dt>Input hash</dt><dd><Hash value={receipt.inputHash} chars={10} label="input hash" /></dd>
                <dt>Answer mode</dt><dd className="mono">{receipt.answerMode === 'open' ? 'open' : 'sealed'}</dd>
                {metered ? (
                  <>
                    <dt>Delivered</dt><dd className="mono">{group(receipt.deliveredCount!)} {receipt.deliveredCount === '1' ? 'token' : 'tokens'}</dd>
                    <dt>Returned to caller</dt><dd><Amount value={unit(returnedAmount)} /></dd>
                  </>
                ) : null}
                <dt>Slot</dt><dd className="mono">{group(receipt.slot)}</dd>
                <dt>Settlement</dt><dd><Explorer kind="tx" id={receipt.transactionSignature}><span className="mono">{short(receipt.transactionSignature, 6)}</span></Explorer></dd>
                {view.modelBase ? (
                  <>
                    <dt>Base model</dt>
                    <dd className={s.baseVal}>
                      <span className={s.baseSummary}>
                        <span className="mono">{view.modelBase.format}</span>
                        <Size n={view.modelBase.sizeBytes} size="s" />
                      </span>
                      {view.modelBase.source.startsWith('https://') || view.modelBase.source.startsWith('http://') ? (
                        <a className={`link mono ${s.baseSource}`} href={view.modelBase.source} target="_blank" rel="noreferrer">{view.modelBase.source}</a>
                      ) : (
                        <span className={`mono ${s.baseSource}`}>{view.modelBase.source}</span>
                      )}
                    </dd>
                  </>
                ) : null}
              </dl>
              <div className={s.whole}>
                <div className="t-label">{metered ? 'Running hash' : 'Output hash'}</div>
                <HalfHash value={receipt.outputHash} label={metered ? 'running hash' : 'output hash'} />
              </div>
              {view.modelBase ? (
                <div className={s.whole}>
                  <div className="t-label">Base SHA-256</div>
                  <HalfHash value={view.modelBase.sha256} label="base model hash" />
                </div>
              ) : null}
            </div>
          </section>

          <section className="panel" aria-labelledby="payments">
            <div className="panel-head"><h2 id="payments">Payments</h2><Amount value={unit(p.total)} size="s" /></div>
            <div className="panel-body">
              {metered && ceilingAmount !== null ? (
                <dl className={`kv ${s.meteredPay}`}>
                  <dt>Ceiling</dt><dd><Amount value={unit(ceilingAmount)} /></dd>
                  <dt>Paid</dt><dd><Amount value={unit(p.total)} /></dd>
                </dl>
              ) : null}
              <Split parts={rows.map((x) => ({ id: x.id, label: x.label, share: share(x.pay.amount), value: <Amount value={unit(x.pay.amount)} />, note: <Hash value={x.pay.recipient} chars={4} label={`${x.label.toLowerCase()} address`} /> }))} />
              {metered ? (
                <div className={s.returnedRow}>
                  <div>
                    <div className="t-label">Returned to caller</div>
                    <Hash value={receipt.caller} chars={4} label="caller address" />
                  </div>
                  <div className={s.returnedVal}>
                    <Amount value={unit(returnedAmount)} />
                    <span className="t-small dim">Same transaction</span>
                  </div>
                </div>
              ) : null}
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}

// The receipt's signature as tiles, under the check that reads it. The cells take their caps when it passes.
function SigTiles({ bytes, lit }: { bytes: Uint8Array; lit: boolean }) {
  return (
    <div className={s.sig} aria-hidden="true">
      {Array.from(bytes, (b, i) => {
        const step = Math.min(RAMP.length - 1, BARE_BELOW + (b % (RAMP.length - BARE_BELOW)))
        return <span key={i} style={lit ? { background: capFill(step), color: step === RAMP.length - 1 ? C.ground : C.glyph } : undefined}>{RAMP[step]}</span>
      })}
    </div>
  )
}
