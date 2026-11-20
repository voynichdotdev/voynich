'use client'

// Interactive bounties workbench: select an open bounty, draw the target label, run a CPI open call,
// verify all four receipt checks, collect the reward in one press, or post and cancel bounties.

import Link from 'next/link'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { Bounty, Model } from '@voynich/contract'
import { api } from '@/lib/api'
import { cancelBounty, collectBounty, fetchBountyAfterSettle, parseSolToLamports, postBounty, refreshBounties, runBountyDraw } from '@/lib/bounties'
import { IDLE, type CallState, type FlightStage, type Stage } from '@/lib/call'
import { CALL_STAGES, RECEIPT_CHECKS, SKETCH32 } from '@/lib/facts'
import { group, money, short } from '@/lib/format'
import { play, stop } from '@/lib/sound'
import { errorMessage } from '@/lib/tx'
import type { CheckResult } from '@/lib/verify'
import { wallet } from '@/lib/wallet'
import { useWallet } from '@/src/engines/wallet/react'
import { sampleBytes } from '@/components/field/ramp'
import { Frame } from '@/components/drawn/Drawn'
import { Connect } from '@/components/model/Connect'
import { DrawPad, InputGrid } from '@/components/model/DrawPad'
import { hasInk, rasterize, type Stroke } from '@/components/model/sketch'
import { State, StateTile, TileStrip } from '@/components/tile/Tile'
import { Amount, Empty, Explorer, Failed, Hash, Tabs } from '@/components/ui/kit'
import s from './bounties.module.css'

type StageId = (typeof CALL_STAGES)[number]['id']
type Filter = 'open' | 'claimed' | 'all'

const PATH: StageId[] = ['disconnected', 'ready', 'encrypting', 'signing', 'escrowed', 'answering', 'verified']
const LABEL = Object.fromEntries(CALL_STAGES.map((x) => [x.id, x.label])) as Record<StageId, string>
const IN_FLIGHT: Stage[] = ['encrypting', 'signing', 'escrowed', 'answering']
const pct = (p: number) => `${(p * 100).toFixed(p >= 0.1 ? 0 : 1)}%`

type Props = {
  initialBounties: Bounty[]
  model: Model | null
  bountyProgramId: string | null
  fixture: string | null
  loadError: string | null
}

export function BountiesView({ initialBounties, model, bountyProgramId, fixture, loadError }: Props) {
  const w = useWallet(wallet)
  const connected = w.status === 'connected' && !!w.address
  const q = fixture ? `?fixture=${fixture}` : ''
  const labelSelectId = useId()
  const amountInputId = useId()

  const [bounties, setBounties] = useState<Bounty[]>(initialBounties)
  const [filter, setFilter] = useState<Filter>('open')
  const [selectedAddress, setSelectedAddress] = useState<string | null>(
    () => initialBounties.find((b) => b.status === 'open')?.address ?? null,
  )

  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [st, setSt] = useState<CallState>(IDLE)
  const [checkingSettlement, setCheckingSettlement] = useState(false)
  const [settledBounty, setSettledBounty] = useState<Bounty | null>(null)
  const [collecting, setCollecting] = useState(false)
  const [collectConfirming, setCollectConfirming] = useState(false)
  const [collectErr, setCollectErr] = useState('')
  const [collectedInfo, setCollectedInfo] = useState<{
    bounty: Bounty
    receipt: string
    signature: string | null
    singleTx: boolean
    checks: CheckResult[]
  } | null>(null)

  const [cancellingAddress, setCancellingAddress] = useState<string | null>(null)
  const [cancelErr, setCancelErr] = useState('')

  const labels = useMemo(() => model?.manifest.labels ?? [], [model])
  const [postLabel, setPostLabel] = useState<string>(() => model?.manifest.labels?.[0] ?? 'clock')
  const [postAmount, setPostAmount] = useState('0.01')
  const [posting, setPosting] = useState(false)
  const [postConfirming, setPostConfirming] = useState(false)
  const [postMsg, setPostMsg] = useState<{ tone: 'warm' | 'bad'; text: string } | null>(null)

  const abort = useRef<AbortController | null>(null)
  const update = (patch: Partial<CallState>) => setSt((prev) => ({ ...prev, ...patch }))

  useEffect(() => () => { abort.current?.abort(); stop('answering') }, [])

  const stage = st.stage
  useEffect(() => {
    if (stage === 'encrypting') play('encrypt')
    else if (stage === 'signing') play('sign')
    else if (stage === 'escrowed') play('escrow')
    else if (stage === 'answering') play('answering')
    else if (stage === 'verified') play('verified')
    else if (stage === 'failed') play('failed')
    return () => { if (stage === 'answering') stop('answering') }
  }, [stage])
  const passedCount = st.checks.filter((c) => c.passed).length
  useEffect(() => { if (passedCount) play('check') }, [passedCount])

  const openBounties = useMemo(() => bounties.filter((b) => b.status === 'open'), [bounties])
  const claimedBounties = useMemo(() => bounties.filter((b) => b.status === 'claimed'), [bounties])
  const visibleBounties = useMemo(
    () => (filter === 'open' ? openBounties : filter === 'claimed' ? claimedBounties : bounties),
    [bounties, claimedBounties, filter, openBounties],
  )

  const selected = useMemo(
    () => openBounties.find((b) => b.address === selectedAddress) ?? openBounties[0] ?? null,
    [openBounties, selectedAddress],
  )

  const values = useMemo(() => rasterize(strokes), [strokes])
  const inFlight = IN_FLIGHT.includes(stage)
  const shown: StageId = stage === 'idle' ? (connected ? 'ready' : 'disconnected') : stage
  const at = PATH.indexOf(stage === 'failed' || stage === 'refunded' ? st.reached ?? 'ready' : shown)
  const ended = stage === 'failed' || stage === 'refunded'
  const empty = !hasInk(strokes)
  const callPrice = model ? `${money(model.price)} ${model.price.symbol}` : ''

  const top = st.output?.scores[0]
  const rest = (st.output?.scores.slice(1) ?? []).filter((r) => r.probability >= 0.01).slice(0, 3)
  const answeredLabel = st.output?.label ?? top?.label ?? null
  const matched = !!(selected && stage === 'verified' && answeredLabel === selected.targetLabel)

  // After a draw settles and verifies, read /v1/bounties/:address to detect atomic one-tx payout.
  useEffect(() => {
    if (stage !== 'verified' || !selected || !st.call || !st.receipt) return
    let cancelled = false
    const targetAddress = selected.address
    const callAddress = st.call.address
    const receiptAddress = st.receipt
    const currentChecks = st.checks
    setCheckingSettlement(true)
    setSettledBounty(null)
    void (async () => {
      const client = api(fixture)
      const latest = await fetchBountyAfterSettle(client, targetAddress, callAddress, matched ? 8 : 1)
      if (cancelled) return
      setSettledBounty(latest)
      setCheckingSettlement(false)
      if (latest && latest.status === 'claimed' && latest.winningCall === callAddress) {
        const next = await refreshBounties(
          client,
          (items) => items.some((b) => b.address === targetAddress && b.status === 'claimed'),
          4,
        )
        if (cancelled) return
        setBounties(next)
        setCollectedInfo({
          bounty: latest,
          receipt: receiptAddress,
          signature: null,
          singleTx: true,
          checks: currentChecks,
        })
        setSt(IDLE)
        setStrokes([])
        setSelectedAddress(next.find((b) => b.status === 'open')?.address ?? null)
        return
      }
      try {
        const next = await refreshBounties(client, undefined, 1)
        if (!cancelled) setBounties(next)
      } catch {}
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, st.call?.address, st.receipt, selected?.address])

  const segAt = (i: number) => {
    if (stage === 'failed' && i === at) return 'bad'
    if (stage === 'verified') return i === at ? 'warm' : 'done'
    if (i < at) return 'done'
    return i === at && !ended ? 'now' : 'next'
  }

  const pickBounty = (addr: string) => {
    if (inFlight || collecting) return
    abort.current?.abort()
    setSelectedAddress(addr)
    setSt(IDLE)
    setCheckingSettlement(false)
    setSettledBounty(null)
    setCollectErr('')
    setCollectedInfo(null)
    setCancelErr('')
  }

  const startDraw = () => {
    if (inFlight || !w.address || !selected || !model || empty) return
    const ac = new AbortController()
    abort.current = ac
    setCheckingSettlement(false)
    setSettledBounty(null)
    setCollectErr('')
    setCollectedInfo(null)
    setCancelErr('')
    setSt({ ...IDLE, stage: 'encrypting', reached: 'encrypting' })
    void runBountyDraw({
      client: api(fixture),
      bounty: selected,
      model,
      wallet: w.address,
      input: values,
      update,
      signal: ac.signal,
    })
  }

  const resetDraw = () => {
    abort.current?.abort()
    setCheckingSettlement(false)
    setSettledBounty(null)
    setCollectErr('')
    setSt(IDLE)
  }

  const onCollect = async () => {
    if (!selected || !st.call || !st.receipt || !w.address || collecting) return
    setCollecting(true)
    setCollectConfirming(false)
    setCollectErr('')
    try {
      const target = selected
      const receipt = st.receipt
      const currentChecks = st.checks
      const res = await collectBounty({
        client: api(fixture),
        bountyAddress: target.address,
        callAddress: st.call.address,
        wallet: w.address,
        onConfirming: setCollectConfirming,
      })
      const next = await refreshBounties(
        api(fixture),
        (items) => items.some((b) => b.address === target.address && b.status === 'claimed'),
      )
      setBounties(next)
      setCollectedInfo({ bounty: target, receipt, signature: res.signature, singleTx: false, checks: currentChecks })
      setSt(IDLE)
      setStrokes([])
      setSelectedAddress(next.find((b) => b.status === 'open')?.address ?? null)
    } catch (e) {
      setCollectErr(errorMessage(e))
    } finally {
      setCollecting(false)
      setCollectConfirming(false)
    }
  }

  const onCancel = async (bounty: Bounty) => {
    if (!w.address || cancellingAddress) return
    setCancellingAddress(bounty.address)
    setCancelErr('')
    try {
      await cancelBounty({ client: api(fixture), bountyAddress: bounty.address, wallet: w.address })
      const next = await refreshBounties(
        api(fixture),
        (items) => items.some((b) => b.address === bounty.address && b.status === 'cancelled'),
      )
      setBounties(next)
      if (selected?.address === bounty.address) {
        setSt(IDLE)
        setSelectedAddress(next.find((b) => b.status === 'open')?.address ?? null)
      }
    } catch (e) {
      setCancelErr(errorMessage(e))
    } finally {
      setCancellingAddress(null)
    }
  }

  const onPost = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!w.address || posting || !model) return
    const lamports = parseSolToLamports(postAmount)
    if (!lamports) {
      setPostMsg({ tone: 'bad', text: 'Enter a positive SOL amount (up to 9 decimals).' })
      return
    }
    setPosting(true)
    setPostConfirming(false)
    setPostMsg(null)
    try {
      const res = await postBounty({
        client: api(fixture),
        modelId: model.name,
        targetLabel: postLabel,
        lamports,
        wallet: w.address,
        onConfirming: setPostConfirming,
      })
      const next = await refreshBounties(
        api(fixture),
        (items) => (res.bountyAddress ? items.some((b) => b.address === res.bountyAddress) : items.length > bounties.length),
      )
      setBounties(next)
      setFilter('open')
      if (res.bountyAddress) setSelectedAddress(res.bountyAddress)
      setCollectedInfo(null)
      setSt(IDLE)
      setPostMsg({ tone: 'warm', text: `Posted ${postAmount.trim()} SOL bounty for "${postLabel}".` })
    } catch (err) {
      setPostMsg({ tone: 'bad', text: errorMessage(err) })
    } finally {
      setPosting(false)
      setPostConfirming(false)
    }
  }

  if (loadError) {
    return <div className={s.fail}><Failed title="Bounties did not load" message={loadError} /></div>
  }

  return (
    <>
      <div className={s.layout}>
        <div className={s.col}>
          <section className={`panel ${s.bench}`} aria-label="Draw to claim a bounty">
            <div className={s.benchHead}>
              <div className={s.benchTitle}>
                <h2>Draw to claim</h2>
                {selected ? (
                  <>
                    <span className={s.targetTag}>Draw &ldquo;{selected.targetLabel}&rdquo;</span>
                    <Amount value={selected.reward} size="s" />
                  </>
                ) : (
                  <span className="t-small dim">No open bounty selected</span>
                )}
              </div>
              {selected ? (
                <div className={s.path}>
                  <ol aria-hidden="true">
                    {PATH.map((id, i) => (
                      <li key={id} title={LABEL[id]} data-at={segAt(i)} className={inFlight && i === at ? 'stepping' : undefined} />
                    ))}
                  </ol>
                  <span className={s.now} aria-live="polite" data-tone={stage === 'verified' ? 'warm' : stage === 'failed' ? 'bad' : undefined}>
                    {ended ? null : <span className="mono">{at + 1}/{PATH.length}</span>}
                    {st.confirming && stage === 'signing' ? 'Confirming' : LABEL[shown]}
                  </span>
                </div>
              ) : null}
            </div>

            {collectedInfo ? (
              <div className="panel-body">
                <Frame className={s.topAnswer}>
                  <div className={s.answerHead}>
                    <span className="t-label">{collectedInfo.singleTx ? 'Settled and paid in one transaction' : 'Bounty collected'}</span>
                    <span className="mono dim">verified on chain</span>
                  </div>
                  <div className={s.topLine}>
                    <span className={s.topLabel}>{collectedInfo.bounty.targetLabel}</span>
                    <Amount value={collectedInfo.bounty.reward} size="m" />
                  </div>
                  <p className="t-small">
                    {collectedInfo.singleTx
                      ? 'The enclave settled your open receipt and the bounty program paid the reward directly to your wallet in the same transaction.'
                      : 'The bounty program read the open receipt via CPI and paid the reward directly to your wallet.'}
                  </p>
                  {collectedInfo.checks.length > 0 ? (
                    <ul className={s.checks} aria-label="Receipt checks">
                      {RECEIPT_CHECKS.map((c, i) => {
                        const r = collectedInfo.checks[i]
                        return (
                          <li key={c.id} title={r?.detail ?? c.says}>
                            <StateTile state={r ? (r.passed ? 'passed' : 'failed') : 'waiting'} />
                            <span className={r?.passed ? 'ochre' : r ? 'bad' : 'sub'}>{c.label}</span>
                          </li>
                        )
                      })}
                    </ul>
                  ) : null}
                  <div className={s.act}>
                    <Link href={`/receipts/${collectedInfo.receipt}${q}`} className="link" data-arrow>
                      Receipt <span className="mono">{short(collectedInfo.receipt, 6)}</span>
                    </Link>
                    {collectedInfo.signature ? <Explorer kind="tx" id={collectedInfo.signature}>Payout tx</Explorer> : null}
                    <button type="button" className="btn" data-size="s" onClick={() => setCollectedInfo(null)}>
                      {openBounties.length ? 'Next open bounty' : 'Done'}
                    </button>
                  </div>
                </Frame>
              </div>
            ) : !selected ? (
              <div className="panel-body">
                <Empty title="No open bounties right now">
                  Post a bounty for any of the {labels.length || SKETCH32.categories} sketch-32 labels on the right, and anyone can draw to claim it.
                </Empty>
              </div>
            ) : !model || model.status !== 'live' ? (
              <div className="panel-body">
                <Empty title={`${SKETCH32.name} is not taking calls right now`}>
                  Drawing bounties settle through {SKETCH32.name} on chain.
                </Empty>
              </div>
            ) : (
              <div className={s.benchBody}>
                <div className={s.input}>
                  <DrawPad
                    strokes={strokes}
                    onChange={setStrokes}
                    cipher={inFlight ? st.envelope ?? sampleBytes(600, 32) : null}
                    label={`Drawing surface. Draw ${selected.targetLabel} to claim the bounty.`}
                  />
                  <div className={s.tools}>
                    <button type="button" className="btn" data-size="s" disabled={inFlight || collecting || empty} onClick={() => setStrokes(strokes.slice(0, -1))}>Undo</button>
                    <button type="button" className="btn" data-size="s" disabled={inFlight || collecting || empty} onClick={() => { play('clear'); setStrokes([]) }}>Clear</button>
                    <span className={`t-small dim ${s.toolNote}`}>{inFlight ? 'Encrypted to the enclave' : 'Mouse, touch or pen'}</span>
                  </div>
                </div>

                <div className={s.side}>
                  <div className={s.receives}>
                    <InputGrid values={values} cell={4} />
                    <div>
                      <div className="t-label">Target label</div>
                      <div className="t-h3">{selected.targetLabel}</div>
                      <div className="t-small dim">Open answer on chain via CPI</div>
                    </div>
                  </div>

                  <div className={s.status} aria-live="polite">
                    {stage === 'idle' ? (
                      <>
                        <p className="t-small">
                          Draw <strong style={{ color: 'var(--text)' }}>{selected.targetLabel}</strong>. Sign once to open a CPI call to {model.name} with an on-chain callback. If the verified answer matches, the enclave settles the receipt and pays the reward in one transaction.
                        </p>
                        <dl className={s.facts}>
                          <div><dt>Reward</dt><dd><Amount value={selected.reward} /></dd></div>
                          <div><dt>Call price</dt><dd><Amount value={model.price} /></dd></div>
                          <div><dt>Attempts</dt><dd className="mono">{group(selected.attempts)}</dd></div>
                          <div><dt>Creator</dt><dd><Hash value={selected.creator} chars={4} label="creator address" /></dd></div>
                        </dl>
                      </>
                    ) : null}

                    {inFlight && !st.receipt ? (
                      <div>
                        <h3 className={s.lead}>
                          {stage === 'encrypting' ? 'Encrypting on this device'
                            : stage === 'signing' ? (st.confirming ? 'Confirming on chain' : 'Waiting for your wallet')
                            : stage === 'escrowed' ? 'CPI call opened'
                            : 'The enclave has the call'}
                        </h3>
                        <p className="t-small" style={{ marginTop: 6 }}>
                          {stage === 'encrypting' ? 'Your sketch is encrypted to the enclave.'
                            : stage === 'signing' ? (st.confirming ? 'The bounty program is opening the call via CPI.' : <>Sign once. {callPrice} goes into call escrow.</>)
                            : stage === 'escrowed' ? 'Relaying your encrypted sketch to the enclave.'
                            : 'Running sketch-32 and settling the open receipt on chain.'}
                        </p>
                        {st.inputHash || st.call ? (
                          <dl className={s.facts} style={{ marginTop: 10 }}>
                            {st.inputHash ? <div><dt>Input hash</dt><dd><Hash value={st.inputHash} chars={6} label="input hash" /></dd></div> : null}
                            {st.call ? <div><dt>Deadline slot</dt><dd className="mono">{group(st.call.deadlineSlot)}</dd></div> : null}
                          </dl>
                        ) : null}
                      </div>
                    ) : null}

                    {stage === 'verified' && st.output ? (
                      <div className={s.answer}>
                        <Frame className={s.topAnswer}>
                          <div className={s.answerHead}>
                            <span className="t-label">{model.name} answers</span>
                            <span className="mono dim">open on chain</span>
                          </div>
                          {top || answeredLabel ? (
                            <div className={s.topLine}>
                              <span className={s.topLabel}>{answeredLabel}</span>
                              {top ? <span className="t-fig t-fig-m">{(top.probability * 100).toFixed(0)}<span className="unit">%</span></span> : null}
                            </div>
                          ) : null}
                        </Frame>
                        {rest.length ? (
                          <ul className={s.rest} aria-label="Next labels">
                            {rest.map((r) => (
                              <li key={r.label}>
                                <span className="t-small">{r.label}</span>
                                <TileStrip parts={[{ share: Math.max(r.probability, 0.001), step: 9 }]} cells={16} height={10} />
                                <span className="mono dim">{pct(r.probability)}</span>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                        <div className={s.verdict} data-match={matched ? 'true' : undefined}>
                          {matched ? (
                            checkingSettlement ? (
                              <p className={s.verdictNote} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <StateTile state="pending" size={14} />
                                Checking on-chain payout on the settled transaction.
                              </p>
                            ) : settledBounty && settledBounty.status === 'claimed' && settledBounty.winningCall !== st.call?.address ? (
                              <p className={s.verdictNote}>
                                This bounty was already claimed by another drawer.
                              </p>
                            ) : settledBounty && settledBounty.status === 'cancelled' ? (
                              <p className={s.verdictNote}>
                                This bounty was cancelled before settlement.
                              </p>
                            ) : (
                              <>
                                <p className={s.verdictNote}>
                                  Match verified on chain. Collect <Amount value={selected.reward} /> directly from the bounty program.
                                </p>
                                <div className={s.act}>
                                  <button
                                    type="button"
                                    className="btn"
                                    data-kind="primary"
                                    data-pending={collecting || undefined}
                                    disabled={collecting}
                                    onClick={onCollect}
                                  >
                                    {collecting ? <><StateTile state="pending" size={14} />{collectConfirming ? 'Confirming' : 'Awaiting signature'}</> : `Collect ${money(selected.reward)} ${selected.reward.symbol}`}
                                  </button>
                                </div>
                              </>
                            )
                          ) : (
                            <p className={s.verdictNote}>
                              Answered &ldquo;{answeredLabel ?? 'unknown'}&rdquo; instead of &ldquo;{selected.targetLabel}&rdquo;. Clear and draw again to claim.
                            </p>
                          )}
                          {collectErr ? <p className="t-small bad" role="alert">{collectErr}</p> : null}
                        </div>
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

                    {stage === 'failed' ? (
                      <div role="alert">
                        <h3 className={s.lead} data-tone="bad"><StateTile state="failed" size={18} />The draw failed</h3>
                        <p className="t-small" style={{ marginTop: 6 }}>{st.failure?.message}</p>
                      </div>
                    ) : null}

                    {cancelErr ? <p className="t-small bad" role="alert">{cancelErr}</p> : null}
                  </div>

                  <div className={s.act}>
                    {stage === 'verified' && st.receipt ? (
                      <Link href={`/receipts/${st.receipt}${q}`} className={`link ${s.receiptLink}`} data-arrow>
                        Receipt <span className="mono">{short(st.receipt, 6)}</span>
                      </Link>
                    ) : null}
                    {stage === 'idle' ? (
                      connected ? (
                        <>
                          <button type="button" className="btn" data-kind="primary" disabled={empty} onClick={startDraw}>
                            Draw for {callPrice}
                          </button>
                          {w.address === selected.creator ? (
                            <button
                              type="button"
                              className="btn"
                              data-kind="danger"
                              data-size="s"
                              disabled={cancellingAddress === selected.address}
                              onClick={() => void onCancel(selected)}
                            >
                              {cancellingAddress === selected.address ? 'Cancelling' : 'Cancel bounty'}
                            </button>
                          ) : null}
                          {empty ? <span className="t-small dim">Draw {selected.targetLabel} first.</span> : null}
                        </>
                      ) : (
                        <>
                          <Connect />
                          <span className="t-small dim">{callPrice} per draw</span>
                        </>
                      )
                    ) : inFlight ? (
                      <button type="button" className="btn" data-kind="primary" data-pending="true" aria-busy="true">
                        <StateTile state="pending" size={14} />
                        {st.confirming && stage === 'signing' ? 'Confirming' : LABEL[stage as FlightStage]}
                      </button>
                    ) : (
                      <button type="button" className="btn" data-kind={matched ? undefined : 'primary'} disabled={collecting} onClick={resetDraw}>
                        Draw again
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>

        <div className={s.col}>
          <section className="panel" aria-label="Bounties list">
            <div className={s.listHead}>
              <h2 style={{ fontSize: 13, fontWeight: 600 }}>Bounties</h2>
              <Tabs<Filter>
                value={filter}
                onChange={setFilter}
                label="Filter bounties"
                items={[
                  { id: 'open', label: `Open (${openBounties.length})` },
                  { id: 'claimed', label: `Claimed (${claimedBounties.length})` },
                  { id: 'all', label: `All (${bounties.length})` },
                ]}
              />
            </div>

            {visibleBounties.length === 0 ? (
              <div className="panel-body">
                <Empty title={filter === 'open' ? 'No open bounties' : filter === 'claimed' ? 'No claimed bounties yet' : 'No bounties yet'}>
                  {filter === 'open' ? 'Post a bounty below to put SOL behind a sketch-32 label.' : 'Claimed bounties appear here with their winning receipt.'}
                </Empty>
              </div>
            ) : (
              <ul className={s.list}>
                {visibleBounties.map((b) => {
                  const isSelected = selected?.address === b.address && b.status === 'open'
                  const isCreator = connected && w.address === b.creator
                  return (
                    <li key={b.address} className={s.row} data-selected={isSelected ? 'true' : undefined}>
                      <div className={s.rowTop}>
                        <div className={s.rowLabel}>
                          <span className={s.labelWord}>{b.targetLabel}</span>
                          <State
                            state={b.status === 'open' ? 'open' : b.status === 'claimed' ? 'passed' : 'retired'}
                            label={b.status}
                          />
                        </div>
                        <Amount value={b.reward} size="s" />
                      </div>
                      <div className={s.rowMeta}>
                        <div className={s.rowInfo}>
                          <span>{b.modelName ?? SKETCH32.name}</span>
                          <span className="mono">{group(b.attempts)} {b.attempts === '1' ? 'attempt' : 'attempts'}</span>
                          {b.status === 'claimed' && b.winner ? (
                            <span>Winner <span className="mono">{short(b.winner, 4)}</span></span>
                          ) : (
                            <span>By <span className="mono">{short(b.creator, 4)}</span></span>
                          )}
                        </div>
                        <div className={s.rowActs}>
                          {b.status === 'open' ? (
                            <>
                              <button
                                type="button"
                                className="btn"
                                data-size="s"
                                data-kind={isSelected ? 'primary' : undefined}
                                disabled={inFlight || collecting}
                                onClick={() => pickBounty(b.address)}
                              >
                                {isSelected ? 'Selected' : 'Draw'}
                              </button>
                              {isCreator ? (
                                <button
                                  type="button"
                                  className="btn"
                                  data-size="s"
                                  data-kind="danger"
                                  disabled={cancellingAddress === b.address}
                                  onClick={() => void onCancel(b)}
                                >
                                  {cancellingAddress === b.address ? 'Cancelling' : 'Cancel'}
                                </button>
                              ) : null}
                            </>
                          ) : b.winningReceipt ? (
                            <Link href={`/receipts/${b.winningReceipt}${q}`} className="link" data-arrow>
                              Receipt <span className="mono">{short(b.winningReceipt, 4)}</span>
                            </Link>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          <section className="panel" aria-label="Post a bounty">
            <div className="panel-head">
              <h2>Post a bounty</h2>
              <span className="mono dim">{model?.name ?? SKETCH32.name}</span>
            </div>
            <form className={s.postBody} onSubmit={(e) => void onPost(e)}>
              <div className={s.postGrid}>
                <div className="field">
                  <label htmlFor={labelSelectId}>Target label</label>
                  <select
                    id={labelSelectId}
                    className="select"
                    value={postLabel}
                    disabled={posting || labels.length === 0}
                    onChange={(e) => setPostLabel(e.target.value)}
                  >
                    {(labels.length ? labels : ['clock', 'star']).map((l) => (
                      <option key={l} value={l}>{l}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor={amountInputId}>Reward</label>
                  <div className="input-row">
                    <input
                      id={amountInputId}
                      type="text"
                      inputMode="decimal"
                      className="input mono"
                      value={postAmount}
                      disabled={posting}
                      onChange={(e) => setPostAmount(e.target.value)}
                      placeholder="0.01"
                    />
                    <span className="suffix mono">SOL</span>
                  </div>
                </div>
              </div>
              <div className={s.postFoot}>
                {connected ? (
                  <button
                    type="submit"
                    className="btn"
                    data-kind="primary"
                    data-size="s"
                    data-pending={posting || undefined}
                    disabled={posting || !model}
                  >
                    {posting ? <><StateTile state="pending" size={14} />{postConfirming ? 'Confirming' : 'Awaiting signature'}</> : 'Post bounty'}
                  </button>
                ) : (
                  <Connect label="Connect to post" />
                )}
                <span className="t-small dim">Escrowed on chain; cancel any time while open.</span>
              </div>
              {postMsg ? (
                <p className={s.postMsg} data-tone={postMsg.tone} role={postMsg.tone === 'bad' ? 'alert' : 'status'}>
                  {postMsg.text}
                </p>
              ) : null}
            </form>
          </section>
        </div>
      </div>

      {bountyProgramId ? (
        <div className={s.programFoot}>
          <span>Bounty program <Hash value={bountyProgramId} chars={6} label="bounty program address" /></span>
          <Link href={`/docs/program/calling-a-model${q}`} className="link" data-arrow>Calling a model from a program</Link>
        </div>
      ) : null}
    </>
  )
}
