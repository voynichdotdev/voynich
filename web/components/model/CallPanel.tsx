'use client'

// The call: an input made on this device, one signature, and the answer with its receipt.
// The flow is lib/call.ts; this is every state of it on screen.

import Link from 'next/link'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { AnswerMode, GrantedEnclaves, Model, ModelPolicy, Pass } from '@voynich/contract'
import { api } from '@/lib/api'
import { IDLE, effectiveShareBps, eligibleEnclaves, formatLatency, hasOpenCall, heldStage, parseCeiling, parseTensor, pickEnclave, refundCall, resumeCall, runCall, runSessionCall, settleMeteredStream, type CallState, type FlightStage, type RoutingStrategy, type Stage } from '@/lib/call'
import { CALL_STAGES, RECEIPT_CHECKS } from '@/lib/facts'
import { bps, group, money, short, units } from '@/lib/format'
import { formatRateCeiling, isCallerAllowedByPolicy } from '@/lib/policy'
import { closeBrowserSession, findActiveBrowserSession, loadAccountSessions, openBrowserSession, type ActiveBrowserSession } from '@/lib/sessions'
import { play, stop } from '@/lib/sound'
import { errorMessage, type TxStageName } from '@/lib/tx'
import { wallet } from '@/lib/wallet'
import { useWallet } from '@/src/engines/wallet/react'
import { sampleBytes } from '@/components/field/ramp'
import { Frame } from '@/components/drawn/Drawn'
import { StateTile, TileStrip } from '@/components/tile/Tile'
import { Amount, Hash } from '@/components/ui/kit'
import { Connect } from './Connect'
import { DrawPad, InputGrid } from './DrawPad'
import { hasInk, heldStrokes, rasterize, type Stroke } from './sketch'
import s from './call-panel.module.css'

type StageId = (typeof CALL_STAGES)[number]['id']
const PATH_UNARY: StageId[] = ['disconnected', 'ready', 'encrypting', 'signing', 'escrowed', 'answering', 'verified']
const PATH_METERED: StageId[] = ['disconnected', 'ready', 'encrypting', 'signing', 'escrowed', 'streaming', 'verified']
const LABEL = Object.fromEntries(CALL_STAGES.map((x) => [x.id, x.label])) as Record<StageId, string>
const IN_FLIGHT: Stage[] = ['encrypting', 'signing', 'escrowed', 'answering', 'streaming']
const pct = (p: number) => `${(p * 100).toFixed(p >= 0.1 ? 0 : 1)}%`

type Props = { model: Model; fixture: string | null; compact?: boolean; owner?: boolean; enclaves?: GrantedEnclaves['items'] | null; policy?: ModelPolicy | null; activePass?: Pass | null; referrer?: string | null; referralShareBps?: number | null; onSettled?: () => void }

// A model that takes no calls, composed per cause: retired, sealed with no enclave yet, or still uploading.
function Closed({ model, fixture, compact, owner }: { model: Model; fixture: string | null; compact: boolean; owner: boolean }) {
  const q = fixture ? `?fixture=${fixture}` : ''
  const total = model.sizeBytes
  const written = Math.min(total, model.upload?.bytesWritten ?? model.weights.reduce((sum, a) => sum + a.writtenRanges.reduce((x, r) => x + r.length, 0), 0))
  const cause = model.status
  return (
    <section className={`panel ${s.panel}`} data-compact={compact || undefined} aria-label="Call">
      <div className={s.head}>
        <h2>Call</h2>
        <span className={s.now}>{cause === 'retired' ? 'Retired' : cause === 'sealed' ? 'Awaiting a grant' : 'Uploading'}</span>
      </div>
      <div className={s.closed} data-cause={cause}>
        {cause === 'retired' ? (
          <>
            <div className={s.closedLead}>
              <h3 className={s.lead}>This model takes no new calls</h3>
              <p className="t-small">Its owner retired it. Its ciphertext and its receipts stay on chain.</p>
            </div>
            <dl className={s.facts}>
              <div><dt>New calls</dt><dd>Closed</dd></div>
              <div><dt>Open calls</dt><dd>Settle or refund</dd></div>
            </dl>
            <div className={s.closedAct}><Link href={`/account${q}`} className="btn">Your calls</Link></div>
          </>
        ) : cause === 'sealed' ? (
          <>
            <div className={s.closedLead}>
              <h3 className={s.lead}>No enclave holds it yet</h3>
              <p className="t-small">The model is sealed. It answers calls once an enclave holds a grant for its key.</p>
            </div>
            <dl className={s.facts}>
              <div><dt>Sealed at slot</dt><dd className="mono">{model.sealedSlot ? group(model.sealedSlot) : ''}</dd></div>
              <div><dt>Allowed measurements</dt><dd className="mono">{group(model.allowedMeasurements.length)}</dd></div>
            </dl>
            <div className={s.closedAct}>
              {owner ? <a href="#owner" className="btn" data-kind="primary">Grant an enclave</a> : <span className="t-small sub">Its owner grants the first enclave.</span>}
            </div>
          </>
        ) : (
          <>
            <div className={s.closedLead}>
              <h3 className={s.lead}>The ciphertext is still being written</h3>
              <p className="t-small">Calls open once it is sealed and an enclave holds a grant.</p>
            </div>
            <div className={s.progress}>
              <TileStrip parts={[{ share: total && written ? Math.max(written / total, 1 / 32) : 0, step: 12 }]} cells={32} height={16} />
              <p className="mono">{group(written)} <span className="sub">of {group(total)} bytes written</span></p>
            </div>
            <div className={s.closedAct}><Link href={`/seal${q}`} className="btn" data-kind={owner ? 'primary' : undefined}>Continue in Seal</Link></div>
          </>
        )}
      </div>
    </section>
  )
}

export function CallPanel({ model, fixture, compact = false, owner = false, enclaves, policy = null, activePass = null, referrer = null, referralShareBps = null, onSettled }: Props) {
  const w = useWallet(wallet)
  const connected = w.status === 'connected' && !!w.address
  const held = heldStage(fixture)
  const kind = model.manifest.inputKind
  const sketch = kind === 'sketch'
  const isText = kind === 'text'
  const metered = model.priceUnit === 'token'
  const labels = model.manifest.labels ?? []
  const inputShape = model.manifest.inputShape ?? []
  const tokenizer = model.manifest.tokenizer
  const live = model.status === 'live'
  const noEligibleEnclave = live && !held && !hasOpenCall(fixture) && Array.isArray(enclaves) && eligibleEnclaves(model, enclaves).length === 0
  const callerDeniedByPolicy = live && !held && !hasOpenCall(fixture) && connected && !!w.address && !isCallerAllowedByPolicy(policy, w.address)

  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [tensor, setTensor] = useState('')
  const [tensorErr, setTensorErr] = useState('')
  const [prompt, setPrompt] = useState('')
  const [maxTokens, setMaxTokens] = useState(() => (tokenizer?.maxOutputTokens ? String(Math.min(tokenizer.maxOutputTokens, 64)) : ''))
  const [maxTokensErr, setMaxTokensErr] = useState('')
  const [ceiling, setCeiling] = useState(() => {
    const defaultTokens = BigInt(Math.min(tokenizer?.maxOutputTokens ?? 64, 64))
    const raw = (BigInt(model.price.amount) * defaultTokens).toString()
    return units(raw, model.price.decimals, model.price.decimals).replaceAll(',', '')
  })
  const [ceilingErr, setCeilingErr] = useState('')
  const [answerMode, setAnswerMode] = useState<AnswerMode>('sealed')
  const [strategy, setStrategy] = useState<RoutingStrategy>('balanced')
  const [pinnedEnclave, setPinnedEnclave] = useState<string | null>(null)
  const [useSession, setUseSession] = useState(false)
  const [usePass, setUsePass] = useState(false)
  const [activeSession, setActiveSession] = useState<ActiveBrowserSession | null>(null)
  const [sessionBudget, setSessionBudget] = useState(() => {
    const unitRaw = BigInt(model.price.amount)
    const defaultTotal = metered ? unitRaw * BigInt(Math.min(tokenizer?.maxOutputTokens ?? 64, 64)) * 5n : unitRaw * 5n
    return units(defaultTotal.toString(), model.price.decimals, model.price.decimals).replaceAll(',', '')
  })
  const [sessionBusy, setSessionBusy] = useState<'opening' | 'closing' | null>(null)
  const [sessionStage, setSessionStage] = useState<TxStageName | null>(null)
  const [sessionErr, setSessionErr] = useState('')
  const [st, setSt] = useState<CallState>(IDLE)
  const [stopping, setStopping] = useState(false)
  const [stopErr, setStopErr] = useState('')
  const [settling, setSettling] = useState(false)
  const [settleErr, setSettleErr] = useState('')
  const [refunding, setRefunding] = useState(false)
  const [refundErr, setRefundErr] = useState('')
  const modeId = useId()
  const routingId = useId()
  const pinId = useId()
  const sessionId = useId()
  const sessionBudgetId = useId()
  const promptId = useId()
  const maxTokensId = useId()
  const ceilingId = useId()
  const abort = useRef<AbortController | null>(null)
  const stopStreamRef = useRef<(() => Promise<void>) | null>(null)
  const settled = useRef(onSettled)
  settled.current = onSettled
  const update = (patch: Partial<CallState>) => setSt((prev) => ({ ...prev, ...patch }))

  // A call that is already open when the page arrives, and the stages held still to be looked at.
  useEffect(() => {
    if (!live) return
    if (held === 'ready') { setStrokes(heldStrokes()); return }
    if (held) {
      setStrokes(heldStrokes())
      setSt({ ...IDLE, stage: held, reached: held, envelope: sampleBytes(600, 32) })
      return
    }
    if (!fixture || !hasOpenCall(fixture)) return
    const ac = new AbortController()
    abort.current = ac
    setStrokes(heldStrokes())
    void resumeCall({ client: api(fixture), model, fixture, update, signal: ac.signal })
    return () => ac.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixture, model.address, live])
  useEffect(() => () => { abort.current?.abort(); stop('answering') }, [])

  // Load any open browser session for the connected wallet on this model.
  useEffect(() => {
    if (!connected || !w.address || !live) { setActiveSession(null); return }
    let mounted = true
    void loadAccountSessions(api(fixture), w.address).then((list) => {
      if (!mounted) return
      const found = findActiveBrowserSession(w.address!, list, model.address, model.price.mint)
      setActiveSession(found)
      if (found) setUseSession(true)
    })
    return () => { mounted = false }
  }, [connected, w.address, live, fixture, model.address, model.price.mint])

  // The cues, at their moments.
  const stage = st.stage
  useEffect(() => {
    if (stage === 'encrypting') play('encrypt')
    else if (stage === 'signing') play('sign')
    else if (stage === 'escrowed') play('escrow')
    else if (stage === 'answering' || stage === 'streaming') play('answering')
    else if (stage === 'verified') play('verified')
    else if (stage === 'failed') play('failed')
    else if (stage === 'refunded') play('refund')
    if (stage === 'verified' || stage === 'refunded') {
      settled.current?.()
      if (connected && w.address) {
        void loadAccountSessions(api(fixture), w.address).then((list) => {
          setActiveSession(findActiveBrowserSession(w.address!, list, model.address, model.price.mint))
        })
      }
    }
    return () => { if (stage === 'answering' || stage === 'streaming') stop('answering') }
  }, [stage]) // eslint-disable-line react-hooks/exhaustive-deps
  const passed = st.checks.filter((c) => c.passed).length
  useEffect(() => { if (passed) play('check') }, [passed])

  const values = useMemo(() => (sketch ? rasterize(strokes) : []), [sketch, strokes])
  const path = metered ? PATH_METERED : PATH_UNARY
  const inFlight = IN_FLIGHT.includes(stage)
  const shown: StageId = stage === 'idle' ? (connected || held === 'ready' ? 'ready' : 'disconnected') : stage
  const at = path.indexOf(stage === 'failed' || stage === 'refunded' ? st.reached ?? 'ready' : shown)
  const price = `${money(model.price)} ${model.price.symbol}`
  const ceilingCheck = useMemo(() => (metered ? parseCeiling(ceiling, model) : null), [metered, ceiling, model])
  const coveredTokens = metered && ceilingCheck?.ok && BigInt(model.price.amount) > 0n ? BigInt(ceilingCheck.amount) / BigInt(model.price.amount) : null
  const ceilingLabel = ceilingCheck?.ok ? `${money({ ...model.price, amount: ceilingCheck.amount })} ${model.price.symbol}` : `${ceiling.trim() || '0'} ${model.price.symbol}`
  const eligible = useMemo(() => (Array.isArray(enclaves) ? eligibleEnclaves(model, enclaves) : []), [model, enclaves])
  const routed = useMemo(() => pickEnclave(model, eligible, { strategy, enclaveAddress: pinnedEnclave }), [model, eligible, strategy, pinnedEnclave])
  const empty = sketch ? !hasInk(strokes) : isText ? !prompt.trim() : !tensor.trim()

  const sessionBudgetCheck = useMemo(() => parseCeiling(sessionBudget, model), [sessionBudget, model])

  const openSession = async () => {
    if (!w.address || sessionBusy || !sessionBudgetCheck.ok) return
    setSessionBusy('opening')
    setSessionStage(null)
    setSessionErr('')
    try {
      const opened = await openBrowserSession({
        client: api(fixture),
        wallet: w.address,
        model,
        budget: sessionBudgetCheck.amount,
        onStage: setSessionStage,
      })
      setActiveSession(opened)
      setUseSession(true)
      play('escrow')
    } catch (e) {
      play('failed')
      setSessionErr(errorMessage(e))
    } finally {
      setSessionBusy(null)
      setSessionStage(null)
    }
  }

  const closeSession = async () => {
    if (!w.address || !activeSession || sessionBusy) return
    setSessionBusy('closing')
    setSessionStage(null)
    setSessionErr('')
    try {
      await closeBrowserSession({
        client: api(fixture),
        wallet: w.address,
        sessionAddress: activeSession.session.address,
        onStage: setSessionStage,
      })
      setActiveSession(null)
      setUseSession(false)
      play('refund')
    } catch (e) {
      play('failed')
      setSessionErr(errorMessage(e))
    } finally {
      setSessionBusy(null)
      setSessionStage(null)
    }
  }

  const start = () => {
    if (inFlight || !w.address) return
    let input: string | number[] = values
    let maxOut: number | undefined
    let callCeiling: string | undefined
    if (isText) {
      input = prompt
      if (labels.length === 0 && maxTokens.trim()) {
        const limit = tokenizer?.maxOutputTokens ?? 4096
        if (!/^\d+$/.test(maxTokens.trim())) {
          setMaxTokensErr(`Whole number from 1 to ${group(limit)}.`)
          return
        }
        const n = Number(maxTokens.trim())
        if (n < 1 || n > limit) {
          setMaxTokensErr(`Whole number from 1 to ${group(limit)}.`)
          return
        }
        maxOut = n
      }
    } else if (!sketch) {
      const t = parseTensor(tensor, inputShape)
      if (!t.ok) { setTensorErr(t.error); return }
      input = t.value
    }
    if (metered) {
      const c = parseCeiling(ceiling, model)
      if (!c.ok) { setCeilingErr(c.error); return }
      callCeiling = c.amount
    }
    const ac = new AbortController()
    abort.current = ac
    stopStreamRef.current = null
    setStopping(false)
    setStopErr('')
    setSettling(false)
    setSettleErr('')
    setRefundErr('')
    setMaxTokensErr('')
    setCeilingErr('')
    setSt({ ...IDLE, stage: 'encrypting', reached: 'encrypting' })
    const callParams = {
      client: api(fixture),
      model,
      wallet: w.address,
      input,
      maxTokens: maxOut,
      ceiling: callCeiling,
      answerMode,
      strategy,
      enclave: pinnedEnclave ?? undefined,
      onStopReady: (fn: (() => Promise<void>) | null) => { stopStreamRef.current = fn },
      update,
      signal: ac.signal,
    }
    if (useSession && activeSession) {
      void runSessionCall({
        ...callParams,
        session: { address: activeSession.session.address, delegate: activeSession.delegate },
      })
    } else if (usePass && activePass && !metered) {
      void runCall({
        ...callParams,
        pass: activePass.address,
      })
    } else {
      void runCall({
        ...callParams,
        ...(referrer && referrer !== w.address ? { referrer } : {}),
      })
    }
  }
  const stopStream = async () => {
    const fn = stopStreamRef.current
    if (!fn || stopping) return
    setStopping(true)
    setStopErr('')
    try {
      await fn()
    } catch (e) {
      setStopping(false)
      setStopErr(errorMessage(e))
    }
  }
  const selfSettle = async () => {
    const piece = st.stream?.lastPiece
    if (!st.call || !piece || !w.address || settling) return
    abort.current?.abort()
    stopStreamRef.current = null
    const ac = new AbortController()
    abort.current = ac
    setSettling(true)
    setSettleErr('')
    try {
      await settleMeteredStream({
        client: api(fixture),
        model,
        wallet: w.address,
        call: st.call,
        piece,
        text: st.stream?.text,
        finishReason: st.stream?.finishReason ?? 'stopped',
        update,
        signal: ac.signal,
      })
    } catch (e) {
      if (!ac.signal.aborted) {
        update({ confirming: false })
        setSettleErr(errorMessage(e))
      }
    } finally {
      setSettling(false)
    }
  }
  const reset = () => { abort.current?.abort(); stopStreamRef.current = null; setStopping(false); setStopErr(''); setSettling(false); setSettleErr(''); setRefundErr(''); setSt(IDLE) }
  const refund = async () => {
    if (!st.call || !w.address || refunding) return
    setRefunding(true)
    setRefundErr('')
    try { await refundCall(api(fixture), st.call, w.address, update) } catch (e) { update({ confirming: false }); setRefundErr(errorMessage(e)) }
    setRefunding(false)
  }

  const ended = stage === 'failed' || stage === 'refunded'
  const segAt = (i: number) => {
    if (stage === 'failed' && i === at) return 'bad'
    if (stage === 'verified') return i === at ? 'warm' : 'done'
    if (i < at) return 'done'
    return i === at && !ended ? 'now' : 'next'
  }

  const head = (
    <div className={s.head}>
      <h2>Call</h2>
      <div className={s.path}>
        <ol aria-hidden="true">
          {path.map((id, i) => <li key={id} title={LABEL[id]} data-at={segAt(i)} className={inFlight && i === at ? 'stepping' : undefined} />)}
        </ol>
        <span className={s.now} aria-live="polite" data-tone={stage === 'verified' ? 'warm' : stage === 'failed' ? 'bad' : undefined}>
          {ended ? null : <span className="mono">{at + 1}/{path.length}</span>}
          {st.confirming && stage === 'signing' ? 'Confirming' : LABEL[shown]}
        </span>
      </div>
    </div>
  )

  if (!live) return <Closed model={model} fixture={fixture} compact={compact} owner={owner} />

  if (noEligibleEnclave) {
    const q = fixture ? `?fixture=${fixture}` : ''
    return (
      <section className={`panel ${s.panel}`} data-compact={compact || undefined} aria-label="Call">
        <div className={s.head}>
          <h2>Call</h2>
          <span className={s.now}>No eligible enclave</span>
        </div>
        <div className={s.closed} data-cause="sealed">
          <div className={s.closedLead}>
            <h3 className={s.lead}>No enclave runs an allowed measurement</h3>
            <p className="t-small">No live enclave currently holds a grant with a measurement this model allows. Calls open once an allowed enclave holds a live grant.</p>
          </div>
          <dl className={s.facts}>
            <div><dt>Allowed measurements</dt><dd className="mono">{group(model.allowedMeasurements.length)}</dd></div>
            <div><dt>Granted enclaves</dt><dd className="mono">{group(enclaves?.length ?? 0)}</dd></div>
          </dl>
          <div className={s.closedAct}>
            {owner ? <a href="#owner" className="btn" data-kind="primary">Manage model</a> : <Link href={`/enclaves${q}`} className="btn">Enclaves</Link>}
          </div>
        </div>
      </section>
    )
  }

  if (callerDeniedByPolicy && policy) {
    const q = fixture ? `?fixture=${fixture}` : ''
    const rate = formatRateCeiling(policy)
    return (
      <section className={`panel ${s.panel}`} data-compact={compact || undefined} aria-label="Call">
        <div className={s.head}>
          <h2>Call</h2>
          <span className={s.now}>Caller not on allow list</span>
        </div>
        <div className={s.closed} data-cause="retired">
          <div className={s.closedLead}>
            <h3 className={s.lead}>This wallet is not on the model allow list</h3>
            <p className="t-small">The model owner enabled an on-chain caller allow list. Only listed wallets can open calls on this model.</p>
          </div>
          <dl className={s.facts}>
            <div><dt>Connected wallet</dt><dd className="mono">{short(w.address!, 6)}</dd></div>
            <div><dt>Allowed callers</dt><dd className="mono">{group(policy.allowedCallers.length)}</dd></div>
            {rate ? <div><dt>Rate ceiling</dt><dd className="mono">{rate}</dd></div> : null}
          </dl>
          <div className={s.closedAct}>
            {owner ? <a href="#owner-policy" className="btn" data-kind="primary">Edit policy</a> : <Link href={`/models${q}`} className="btn">All models</Link>}
          </div>
        </div>
      </section>
    )
  }

  const top = st.output?.scores[0]
  const rest = (st.output?.scores.slice(1) ?? []).filter((r) => r.probability >= 0.01).slice(0, 3)
  const refundable = st.failure?.refundState === 'refundable'
  const lastPiece = st.stream?.lastPiece ?? null
  const canSelfSettle =
    metered &&
    !!st.call &&
    !!lastPiece &&
    !st.receipt &&
    ((stage === 'streaming' && (stopping || !!stopErr)) || (stage === 'failed' && st.failure?.refundState === 'pending-deadline'))
  const streamCeiling = st.stream ? BigInt(st.stream.ceilingAmount) : 0n
  const streamSpent = st.stream ? BigInt(st.stream.spentAmount) : 0n
  const streamShare = streamCeiling > 0n ? Math.min(1, Number((streamSpent * 10000n) / streamCeiling) / 10000) : 0

  return (
    <section className={`panel ${s.panel}`} data-compact={compact || undefined} data-stage={shown} aria-label="Call">
      {head}
      <div className={s.body}>
        <div className={s.input}>
          {sketch ? (
            <>
              <DrawPad strokes={strokes} onChange={setStrokes} cipher={inFlight ? st.envelope ?? sampleBytes(600, 32) : null} label={`Drawing surface. Draw one of ${labels.length} things.`} />
              <div className={s.tools}>
                <button type="button" className="btn" data-size="s" disabled={inFlight || empty} onClick={() => setStrokes(strokes.slice(0, -1))}>Undo</button>
                <button type="button" className="btn" data-size="s" disabled={inFlight || empty} onClick={() => { play('clear'); setStrokes([]) }}>Clear</button>
                <span className={`t-small dim ${s.toolNote}`}>{inFlight ? 'Encrypted to the enclave' : 'Mouse, touch or pen'}</span>
              </div>
            </>
          ) : isText ? (
            <div className={s.promptWrap}>
              <div className="field">
                <label htmlFor={promptId}>Prompt</label>
                <textarea
                  id={promptId}
                  className={`textarea ${s.prompt}`}
                  value={prompt}
                  readOnly={inFlight}
                  placeholder="Write a prompt to encrypt to the enclave"
                  onChange={(e) => setPrompt(e.target.value)}
                  aria-describedby={`${promptId}-help`}
                />
                <span id={`${promptId}-help`} className="help">
                  {tokenizer ? `${tokenizer.format} tokenizer, up to ${group(tokenizer.maxInputTokens)} input tokens` : 'Encrypted to the enclave on this device'}
                </span>
              </div>
              {labels.length === 0 ? (
                <div className={s.promptTools}>
                  <div className={`field ${s.maxTokensField}`}>
                    <label htmlFor={maxTokensId}>Max tokens</label>
                    <input
                      id={maxTokensId}
                      type="text"
                      inputMode="numeric"
                      className="input mono"
                      value={maxTokens}
                      readOnly={inFlight}
                      placeholder={String(tokenizer?.maxOutputTokens ?? 64)}
                      onChange={(e) => { setMaxTokens(e.target.value); setMaxTokensErr('') }}
                      aria-invalid={maxTokensErr ? true : undefined}
                      aria-describedby={maxTokensErr ? `${maxTokensId}-err` : undefined}
                    />
                    {maxTokensErr ? <span id={`${maxTokensId}-err`} className="err" role="alert">{maxTokensErr}</span> : null}
                  </div>
                  <button type="button" className="btn" data-size="s" disabled={inFlight || !prompt} onClick={() => setPrompt('')}>Clear</button>
                  <span className={`t-small dim ${s.toolNote}`}>{inFlight ? 'Encrypted to the enclave' : `${group(prompt.length)} chars`}</span>
                </div>
              ) : (
                <div className={s.tools}>
                  <button type="button" className="btn" data-size="s" disabled={inFlight || !prompt} onClick={() => setPrompt('')}>Clear</button>
                  <span className={`t-small dim ${s.toolNote}`}>{inFlight ? 'Encrypted to the enclave' : `${group(prompt.length)} chars`}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="field">
              <label htmlFor="tensor">Input tensor, JSON</label>
              <textarea id="tensor" className={`textarea mono ${s.tensor}`} spellCheck={false} value={tensor} readOnly={inFlight} onChange={(e) => { setTensor(e.target.value); setTensorErr('') }} aria-invalid={tensorErr ? true : undefined} aria-describedby="tensor-help" />
              <span id="tensor-help" className={tensorErr ? 'err' : 'help'}>{tensorErr || `Shape [${inputShape.join(', ')}]`}</span>
            </div>
          )}
        </div>

        <div className={s.side}>
          {sketch ? (
            <div className={s.receives}>
              <InputGrid values={values} cell={compact ? 3 : 4} />
              <div>
                <div className="t-label">The model receives</div>
                <div className="mono">28 × 28</div>
                <div className="t-small dim">{model.manifest.preprocess ? <>Cropped to the ink, centred, 0&nbsp;to&nbsp;1.</> : <>0&nbsp;to&nbsp;1.</>}</div>
              </div>
            </div>
          ) : null}

          <div className={s.status} aria-live="polite">
            {stage === 'idle' ? (
              sketch ? (
                <>
                  <h3 className="t-h3">Draw one of {labels.length} things</h3>
                  <ul className={s.things}>{labels.map((l) => <li key={l}>{l}</li>)}</ul>
                </>
              ) : isText ? (
                labels.length > 0 ? (
                  <>
                    <h3 className="t-h3">Write text</h3>
                    <p className="t-small">It is encrypted to the enclave on this device. {model.name} answers with one of {labels.length} labels.</p>
                    <ul className={s.things}>{labels.map((l) => <li key={l}>{l}</li>)}</ul>
                  </>
                ) : (
                  <>
                    <h3 className="t-h3">Write a prompt</h3>
                    <p className="t-small">It is encrypted to the enclave on this device. {model.name} generates up to {group(tokenizer?.maxOutputTokens ?? 64)} tokens.</p>
                    {tokenizer ? (
                      <dl className={s.facts}>
                        <div><dt>Tokenizer</dt><dd className="mono">{tokenizer.format}</dd></div>
                        <div><dt>Vocabulary</dt><dd className="mono">{group(tokenizer.vocabSize)}</dd></div>
                      </dl>
                    ) : null}
                  </>
                )
              ) : (
                <>
                  <h3 className="t-h3">Paste a tensor</h3>
                  <p className="t-small">It is encrypted to the enclave on this device. {model.name} answers with one of {labels.length} labels.</p>
                </>
              )
            ) : null}

            {inFlight && stage !== 'streaming' && !st.receipt ? (
              <div className={s.flight}>
                <h3 className={s.lead}>
                  {stage === 'encrypting' ? 'Encrypting on this device'
                    : stage === 'signing' ? (st.confirming ? 'Confirming on chain' : 'Waiting for your wallet')
                    : stage === 'escrowed' ? 'The price is in escrow'
                    : 'The enclave has the call'}
                </h3>
                <p className="t-small">
                  {stage === 'encrypting' ? 'Only the enclave can open it.'
                    : stage === 'signing' ? (st.confirming ? 'The call is on its way to the chain.' : metered ? <>Sign once. {ceilingLabel} goes into escrow as your ceiling.</> : <>Sign once. {price} goes into escrow.</>)
                    : stage === 'escrowed' ? 'It is held until the enclave answers.'
                    : 'It opens the model and runs it on your input.'}
                </p>
                {st.inputHash || st.call ? (
                  <dl className={s.facts}>
                    {st.inputHash ? <div><dt>Input hash</dt><dd><Hash value={st.inputHash} chars={6} label="input hash" /></dd></div> : null}
                    {st.call && (stage === 'escrowed' || stage === 'answering') ? (
                      <>
                        <div><dt>In escrow</dt><dd><Amount value={st.call.price} /></dd></div>
                        <div><dt>Deadline slot</dt><dd className="mono">{group(st.call.deadlineSlot)}</dd></div>
                      </>
                    ) : null}
                  </dl>
                ) : null}
              </div>
            ) : null}

            {stage === 'streaming' && st.stream ? (
              <div className={s.answer}>
                <Frame className={s.topAnswer}>
                  <div className={s.answerHead}>
                    <div className="t-label">{st.receipt ? `${model.name} answers` : `${model.name} streaming`}</div>
                    <span className="mono dim">{group(st.stream.count)} {st.stream.count === 1 ? 'token' : 'tokens'}</span>
                  </div>
                  <div className={s.textAnswerWrap}>
                    <p className={s.textAnswer}>{st.stream.text || <span className="dim">Waiting for the first verified piece</span>}</p>
                    <div className={s.streamMeter}>
                      <TileStrip parts={[{ share: streamShare > 0 ? Math.max(streamShare, 1 / 32) : 0, step: 12 }]} cells={32} height={12} />
                      <div className={`mono ${s.meterRow}`}>
                        <span>Spent <Amount value={{ ...model.price, amount: st.stream.spentAmount }} /></span>
                        <span className="dim">Ceiling <Amount value={{ ...model.price, amount: st.stream.ceilingAmount }} /></span>
                      </div>
                    </div>
                  </div>
                </Frame>
                {stopErr ? <p className="t-small bad" role="alert">{stopErr}</p> : null}
                {canSelfSettle && st.stream ? (
                  <p className="t-small dim">
                    Pays {money({ ...model.price, amount: st.stream.spentAmount })} {model.price.symbol}, returns {money({ ...model.price, amount: st.stream.remainingAmount })} {model.price.symbol} immediately with your wallet.
                  </p>
                ) : null}
                {settleErr ? <p className="t-small bad" role="alert">{settleErr}</p> : null}
              </div>
            ) : null}

            {stage === 'verified' && st.output ? (
              <div className={s.answer}>
                <Frame className={s.topAnswer}>
                  <div className={s.answerHead}>
                    <div className="t-label">{model.name} answers</div>
                    {(st.call?.answerMode ?? answerMode) === 'open' ? <span className="mono dim">open on chain</span> : null}
                  </div>
                  {top || st.output.label ? (
                    <div className={s.topLine}>
                      <span className={s.topLabel}>{st.output.label ?? top?.label}</span>
                      {top ? <span className="t-fig t-fig-m">{(top.probability * 100).toFixed(0)}<span className="unit">%</span></span> : null}
                    </div>
                  ) : st.output.text !== null ? (
                    <div className={s.textAnswerWrap}>
                      <p className={s.textAnswer}>{st.output.text || <span className="dim">(empty)</span>}</p>
                      {st.output.tokens !== null || st.output.finishReason ? (
                        <div className={`mono ${s.textMeta}`}>
                          {st.output.tokens !== null ? <span>{group(st.output.tokens)} {st.output.tokens === 1 ? 'token' : 'tokens'}</span> : null}
                          {st.output.finishReason ? <span>finish: {st.output.finishReason}</span> : null}
                        </div>
                      ) : null}
                    </div>
                  ) : <pre className={`mono ${s.raw}`}>{JSON.stringify(st.output.raw, null, 2)}</pre>}
                </Frame>
                {rest.length ? (
                  <ul className={s.rest} aria-label="Next labels">
                    {rest.map((r) => (
                      <li key={r.label}>
                        <span className="t-small">{r.label}</span>
                        <TileStrip parts={[{ share: Math.max(r.probability, 0.001), step: 9 }]} cells={20} height={10} />
                        <span className="mono dim">{pct(r.probability)}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {st.settlement ? (
                  <dl className={s.facts} aria-label="Metered settlement">
                    <div>
                      <dt>Paid</dt>
                      <dd>
                        <Amount value={{ ...model.price, amount: st.settlement.paidAmount }} />{' '}
                        <span className="t-small dim">for {group(st.settlement.deliveredCount)} {st.settlement.deliveredCount === '1' ? 'token' : 'tokens'}</span>
                      </dd>
                    </div>
                    <div>
                      <dt>Returned</dt>
                      <dd>
                        <Amount value={{ ...model.price, amount: st.settlement.returnedAmount }} />{' '}
                        <span className="t-small dim">to caller</span>
                      </dd>
                    </div>
                  </dl>
                ) : null}
              </div>
            ) : null}

            {st.receipt && inFlight ? <h3 className={s.lead}>Checking the receipt</h3> : null}
            {st.receipt && (inFlight || stage === 'verified' || st.checks.length > 0) ? (
              <ul className={s.checks} aria-label="Receipt checks">
                {RECEIPT_CHECKS.map((c, i) => {
                  const r = st.checks[i]
                  return (
                    <li key={c.id} title={r?.detail ?? c.says}>
                      <StateTile state={r ? (r.passed ? 'passed' : 'failed') : i === st.checks.length ? 'pending' : 'waiting'} />
                      <span className={r?.passed ? 'ochre' : r ? 'bad' : 'sub'}>{c.label}</span>
                    </li>
                  )
                })}
              </ul>
            ) : null}

            {stage === 'refunded' ? (
              <div className={s.flight}>
                <h3 className={s.lead}>The escrow came back</h3>
                {st.call ? <p className={s.back}><Amount value={st.call.price} size="m" /><span className="t-small sub">returned to the caller</span></p> : null}
                {st.failure?.message ? <p className="t-small">{st.failure.message}</p> : null}
              </div>
            ) : null}

            {stage === 'failed' ? (
              <div className={s.flight} role="alert">
                <h3 className={s.lead} data-tone="bad"><StateTile state="failed" size={20} />The call failed</h3>
                <p className="t-small">{st.failure?.message}</p>
                <dl className={s.facts}>
                  <div>
                    <dt>Escrow</dt>
                    <dd>
                      {refundable && st.call ? <>Refundable, <Amount value={st.call.price} /></>
                        : st.failure?.refundState === 'pending-deadline' && st.call ? <>Refundable after slot <span className="mono">{group(st.call.deadlineSlot)}</span></>
                        : st.call ? 'Paid out when the call settled' : 'Nothing was put in escrow'}
                    </dd>
                  </div>
                </dl>
                {canSelfSettle && st.stream ? (
                  <p className="t-small dim">
                    Pays {money({ ...model.price, amount: st.stream.spentAmount })} {model.price.symbol}, returns {money({ ...model.price, amount: st.stream.remainingAmount })} {model.price.symbol} immediately with your wallet.
                  </p>
                ) : null}
                {settleErr ? <p className="t-small bad" role="alert">{settleErr}</p> : null}
                {refundErr ? <p className="t-small bad" role="alert">{refundErr}</p> : null}
              </div>
            ) : null}
          </div>

          {routed ? (
            <div className={s.routingBox}>
              <div className={s.modeRow}>
                <div className={s.modeLabel}>
                  <span className="t-label" id={routingId}>Routing</span>
                  <span className="t-small dim">
                    <span className="mono">{short(routed.enclave.signingKey, 4)}</span>
                    {' · '}
                    <span className="mono">{bps(effectiveShareBps(routed.grant, model.operatorShareBps))}</span>
                    {routed.grant.quotedOperatorShareBps !== null && routed.grant.quotedOperatorShareBps !== undefined && routed.grant.quotedOperatorShareBps < model.operatorShareBps ? ' quoted' : ' share'}
                    {' · '}
                    <span className="mono">{formatLatency(routed.grant.medianAnswerMs)}</span>
                  </span>
                </div>
                <div className="seg" role="group" aria-labelledby={routingId}>
                  {(['balanced', 'cheapest', 'fastest'] as const).map((stName) => (
                    <button
                      key={stName}
                      type="button"
                      aria-pressed={!pinnedEnclave && strategy === stName}
                      disabled={inFlight}
                      onClick={() => { play('toggle'); setStrategy(stName); setPinnedEnclave(null) }}
                    >
                      {stName === 'balanced' ? 'Balanced' : stName === 'cheapest' ? 'Cheapest' : 'Fastest'}
                    </button>
                  ))}
                </div>
              </div>
              {eligible.length > 1 ? (
                <div className={s.pinRow}>
                  <label htmlFor={pinId} className="t-small dim">Enclave</label>
                  <select
                    id={pinId}
                    className={`input mono ${s.pinSelect}`}
                    disabled={inFlight}
                    value={pinnedEnclave ?? ''}
                    onChange={(e) => { play('toggle'); setPinnedEnclave(e.target.value || null) }}
                  >
                    <option value="">Auto ({strategy})</option>
                    {eligible.map(({ enclave, grant }) => (
                      <option key={enclave.address} value={enclave.address}>
                        {short(enclave.signingKey, 4)} · {bps(effectiveShareBps(grant, model.operatorShareBps))} · {formatLatency(grant.medianAnswerMs)}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
            </div>
          ) : null}

          {connected ? (
            <div className={s.sessionBox}>
              <div className={s.modeRow}>
                <div className={s.modeLabel}>
                  <span className="t-label" id={sessionId}>Session</span>
                  <span className="t-small dim">
                    {activeSession
                      ? '0 wallet prompts per call'
                      : useSession
                        ? 'Sign once, run consecutive calls'
                        : 'Sign each call with wallet'}
                  </span>
                </div>
                <div className="seg" role="group" aria-labelledby={sessionId}>
                  <button type="button" aria-pressed={!useSession && !usePass} disabled={inFlight || !!sessionBusy} onClick={() => { play('toggle'); setUseSession(false); setUsePass(false) }}>Single call</button>
                  <button type="button" aria-pressed={useSession} disabled={inFlight || !!sessionBusy} onClick={() => { play('toggle'); setUseSession(true); setUsePass(false) }}>Session</button>
                  {activePass && !metered ? (
                    <button type="button" aria-pressed={usePass} disabled={inFlight || !!sessionBusy} onClick={() => { play('toggle'); setUsePass(true); setUseSession(false) }}>
                      Use pass ({activePass.callsRemaining}/{activePass.callsTotal})
                    </button>
                  ) : null}
                </div>
              </div>
              {usePass && activePass && !metered ? (
                <div className={s.sessionActive}>
                  <dl className={s.sessionMeta}>
                    <div>
                      <dt>Credits left</dt>
                      <dd className="mono">{activePass.callsRemaining} / {activePass.callsTotal}</dd>
                    </div>
                    <div>
                      <dt>Pass price</dt>
                      <dd><Amount value={{ ...model.price, amount: activePass.pricePerCall }} /></dd>
                    </div>
                    <div>
                      <dt>Expires slot</dt>
                      <dd className="mono">{group(activePass.expiresAtSlot)}</dd>
                    </div>
                  </dl>
                  <Link href={`/account${fixture ? `?fixture=${fixture}` : ''}`} className="link t-small" data-arrow>Manage pass</Link>
                </div>
              ) : null}
              {useSession ? (
                activeSession ? (
                  <div className={s.sessionActive}>
                    <dl className={s.sessionMeta}>
                      <div>
                        <dt>Remaining</dt>
                        <dd><Amount value={{ ...activeSession.session.budget, amount: activeSession.session.remaining }} /></dd>
                      </div>
                      <div>
                        <dt>Calls</dt>
                        <dd className="mono">{group(activeSession.session.callsOpened)}</dd>
                      </div>
                      <div>
                        <dt>Expires slot</dt>
                        <dd className="mono">{group(activeSession.session.expiresAtSlot)}</dd>
                      </div>
                    </dl>
                    <button
                      type="button"
                      className="btn"
                      data-size="s"
                      disabled={inFlight || !!sessionBusy}
                      data-pending={sessionBusy === 'closing' || undefined}
                      onClick={() => void closeSession()}
                    >
                      {sessionBusy === 'closing'
                        ? <><StateTile state="pending" size={14} />{sessionStage === 'confirming' ? 'Confirming' : 'Awaiting signature'}</>
                        : 'Close & reclaim'}
                    </button>
                  </div>
                ) : (
                  <div className={s.sessionOpen}>
                    <div className={`field ${s.sessionBudgetField}`}>
                      <label htmlFor={sessionBudgetId}>Session budget</label>
                      <div className="input-row">
                        <input
                          id={sessionBudgetId}
                          type="text"
                          inputMode="decimal"
                          className="input mono"
                          value={sessionBudget}
                          readOnly={!!sessionBusy}
                          autoComplete="off"
                          onChange={(e) => { setSessionBudget(e.target.value); setSessionErr('') }}
                          aria-invalid={!sessionBudgetCheck.ok ? true : undefined}
                        />
                        <span className="suffix">{model.price.symbol}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn"
                      data-size="s"
                      data-kind="primary"
                      disabled={inFlight || !!sessionBusy || !sessionBudgetCheck.ok}
                      data-pending={sessionBusy === 'opening' || undefined}
                      onClick={() => void openSession()}
                    >
                      {sessionBusy === 'opening'
                        ? <><StateTile state="pending" size={14} />{sessionStage === 'confirming' ? 'Confirming' : 'Awaiting signature'}</>
                        : 'Open session'}
                    </button>
                  </div>
                )
              ) : null}
              {useSession && !activeSession && !sessionBudgetCheck.ok ? <span className="err" role="alert">{sessionBudgetCheck.error}</span> : null}
              {sessionErr ? <span className="err" role="alert">{sessionErr}</span> : null}
            </div>
          ) : null}

          {metered ? (
            <div className={s.ceilingBox}>
              <div className="field">
                <label htmlFor={ceilingId}>Ceiling</label>
                <div className="input-row">
                  <input
                    id={ceilingId}
                    type="text"
                    inputMode="decimal"
                    className="input mono"
                    value={ceiling}
                    readOnly={inFlight}
                    autoComplete="off"
                    onChange={(e) => { setCeiling(e.target.value); setCeilingErr('') }}
                    aria-invalid={ceilingErr || (ceilingCheck && !ceilingCheck.ok) ? true : undefined}
                    aria-describedby={`${ceilingId}-help`}
                  />
                  <span className="suffix">{model.price.symbol}</span>
                </div>
                <span id={`${ceilingId}-help`} className={ceilingErr || (ceilingCheck && !ceilingCheck.ok) ? 'err' : 'help'}>
                  {ceilingErr || (ceilingCheck && !ceilingCheck.ok ? ceilingCheck.error : coveredTokens !== null ? `Covers up to ${group(coveredTokens.toString())} tokens at ${price} / token.` : `Rate: ${price} / token.`)}
                </span>
              </div>
            </div>
          ) : null}

          {!metered ? (
            <div className={s.modeRow}>
              <div className={s.modeLabel}>
                <span className="t-label" id={modeId}>Answer</span>
                {answerMode === 'open' ? <span className="t-small dim">Stored in receipt on chain</span> : null}
              </div>
              <div className="seg" role="group" aria-labelledby={modeId}>
                <button type="button" aria-pressed={answerMode === 'sealed'} disabled={inFlight} onClick={() => setAnswerMode('sealed')}>Sealed</button>
                <button type="button" aria-pressed={answerMode === 'open'} disabled={inFlight} onClick={() => setAnswerMode('open')}>Open on chain</button>
              </div>
            </div>
          ) : null}

          {referrer && referralShareBps && referralShareBps > 0 && !useSession && !usePass ? (
            <p className="t-small dim" style={{ marginBottom: 8 }}>
              Referred by <span className="mono">{short(referrer, 4)}</span> ({bps(referralShareBps)} of owner share).
            </p>
          ) : null}

          <div className={s.act}>
            {stage === 'verified' && st.receipt ? <Link href={`/receipts/${st.receipt}${fixture ? `?fixture=${fixture}` : ''}`} className={`link ${s.receipt}`} data-arrow>Receipt <span className="mono">{st.receipt.slice(0, 6)}…{st.receipt.slice(-6)}</span></Link> : null}
            {stage === 'idle' ? (
              connected || held === 'ready' ? (
                <>
                  <button
                    type="button"
                    className="btn"
                    data-kind="primary"
                    disabled={empty || (metered && !!ceilingCheck && !ceilingCheck.ok) || (useSession && !activeSession)}
                    onClick={start}
                  >
                    {useSession && activeSession
                      ? (metered ? `Stream from session (${ceilingLabel})` : `Call from session (${price})`)
                      : usePass && activePass && !metered
                        ? `Call with pass (${activePass.callsRemaining} left)`
                        : (metered ? `Open metered call (${ceilingLabel})` : `Call for ${price}`)}
                  </button>
                  {useSession && !activeSession
                    ? <span className="t-small dim">Open a session above, or switch to Single call.</span>
                    : empty ? <span className="t-small dim">{sketch ? 'Draw something first.' : isText ? 'Enter a prompt first.' : 'Enter the input first.'}</span> : null}
                </>
              ) : (
                <>
                  <Connect />
                  <span className="t-small dim">{metered ? `${price} a token` : `${price} a call`}</span>
                </>
              )
            ) : stage === 'streaming' && !st.receipt ? (
              <>
                <button
                  type="button"
                  className="btn"
                  data-kind="primary"
                  data-pending={stopping || undefined}
                  disabled={stopping || settling}
                  onClick={stopStream}
                >
                  {stopping
                    ? <><StateTile state="pending" size={14} />Settling at {group(st.stream?.count ?? 0)} {st.stream?.count === 1 ? 'token' : 'tokens'}</>
                    : 'Stop & settle'}
                </button>
                {canSelfSettle && lastPiece && connected ? (
                  <button
                    type="button"
                    className="btn"
                    data-pending={settling || undefined}
                    disabled={settling}
                    onClick={() => void selfSettle()}
                  >
                    {settling
                      ? <><StateTile state="pending" size={14} />{st.confirming ? 'Confirming' : 'Awaiting signature'}</>
                      : `Settle at ${group(lastPiece.count)} ${lastPiece.count === 1 ? 'token' : 'tokens'}`}
                  </button>
                ) : null}
              </>
            ) : inFlight ? (
              <button type="button" className="btn" data-kind="primary" data-pending="true" aria-busy="true">
                <StateTile state="pending" size={14} />
                {st.confirming && stage === 'signing' ? 'Confirming' : LABEL[stage as FlightStage]}
              </button>
            ) : (
              <>
                {stage === 'failed' && canSelfSettle && lastPiece ? (
                  connected ? (
                    <button type="button" className="btn" data-kind="primary" data-pending={settling || undefined} disabled={settling} onClick={() => void selfSettle()}>
                      {settling
                        ? <><StateTile state="pending" size={14} />{st.confirming ? 'Confirming' : 'Awaiting signature'}</>
                        : `Settle at ${group(lastPiece.count)} ${lastPiece.count === 1 ? 'token' : 'tokens'}`}
                    </button>
                  ) : <Connect label="Connect wallet to settle" />
                ) : stage === 'failed' && refundable ? (
                  connected ? (
                    <button type="button" className="btn" data-kind="primary" data-pending={refunding || undefined} onClick={refund}>
                      {refunding ? <><StateTile state="pending" size={14} />{st.confirming ? 'Confirming' : 'Awaiting signature'}</> : 'Refund'}
                    </button>
                  ) : <Connect label="Connect wallet to refund" />
                ) : null}
                <button type="button" className="btn" data-kind={stage === 'refunded' ? 'primary' : undefined} disabled={refunding || settling} onClick={reset}>Call again</button>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
