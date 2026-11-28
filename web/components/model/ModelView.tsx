'use client'

// One sealed model: the call beside its facts, its ciphertext, the enclaves that hold it and the receipts it left.
// The page hands over what the server read; this keeps it current after a call settles or the owner changes it.

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import type { Config, GrantedEnclaves, Model, ModelPolicy, ModelSplit, ModelVersions, Pass, PassPlan, ReceiptsPage, ReferralConfig } from '@voynich/contract'
import { api, read, type Read } from '@/lib/api'
import { LINKS } from '@/lib/facts'
import { bps, group, hardware, short } from '@/lib/format'
import { batchRunCliCommand, formatBatchProgress, formatBatchStatus, loadModelBatches, type BatchRecord } from '@/lib/batches'
import { benchmarkRunCliCommand, formatScorePct, loadModelBenchmarks, type BenchmarkRecord } from '@/lib/benchmarks'
import { computeUptimePct, formatBondSol } from '@/lib/bonds'
import { effectiveShareBps, formatLatency } from '@/lib/call'
import { findMeasurement, loadMeasurements, type MeasurementMap } from '@/lib/measurements'
import { buildOpenAISnippets, isMeteredTextModel, mcpToolPromptNote, OPENAI_SNIPPET_TABS, openAIModelId, type OpenAISnippetTab } from '@/lib/openai'
import { buyModelPass, computePassSavingsPct, findActiveModelPass, loadAccountPasses, loadModelPassPlan } from '@/lib/passes'
import { formatRateCeiling, loadModelPolicy } from '@/lib/policy'
import { formatQuorumMode, formatQuorumStatus, formatQuorumVotes, loadModelQuorums, quorumRunCliCommand, type QuorumRecord } from '@/lib/quorums'
import { buildReferralLink, formatReferralShare, loadModelReferralConfig } from '@/lib/referrals'
import { play } from '@/lib/sound'
import { claimModelSplit, formatSplitPct, loadModelSplit, totalUnclaimedLamports } from '@/lib/splits'
import { errorMessage } from '@/lib/tx'
import { effectiveModelVersion, fallbackModelVersions, loadModelVersions } from '@/lib/versions'
import { wallet } from '@/lib/wallet'
import { useWallet } from '@/src/engines/wallet/react'
import { State, StateTile, TileStrip } from '@/components/tile/Tile'
import { MeasurementSource } from '@/components/ui/MeasurementSource'
import { Amount, Empty, Explorer, Failed, Hash, Size, Stat } from '@/components/ui/kit'
import { CallPanel } from './CallPanel'
import { CipherView } from './CipherView'
import { OwnerPanel } from './OwnerPanel'
import s from './model-view.module.css'

type Props = {
  fixture: string | null
  asOwner: boolean
  referrer?: string | null
  initial: {
    model: Model
    enclaves: Read<GrantedEnclaves>
    receipts: Read<ReceiptsPage>
    measurements?: MeasurementMap
    policy?: ModelPolicy | null
    split?: ModelSplit | null
    passPlan?: PassPlan | null
    referralConfig?: ReferralConfig | null
    versions?: ModelVersions | null
    benchmarks?: BenchmarkRecord[]
    quorums?: QuorumRecord[]
    batches?: BatchRecord[]
  }
}

const SPLIT_STEPS = [14, 11, 8, 6, 13, 9, 7, 5] as const

type ClaimTx = { wallet: string; stage: 'signing' | 'confirming' | 'done' | 'failed'; message?: string }
type BuyPassTx = { stage: 'signing' | 'confirming' | 'done' | 'failed'; message?: string }

export function ModelView({ fixture, asOwner, referrer = null, initial }: Props) {
  const w = useWallet(wallet)
  const [model, setModel] = useState(initial.model)
  const [enclaves, setEnclaves] = useState(initial.enclaves)
  const [receipts, setReceipts] = useState(initial.receipts)
  const [measurements, setMeasurements] = useState<MeasurementMap>(initial.measurements ?? {})
  const [policy, setPolicy] = useState<ModelPolicy | null>(initial.policy ?? null)
  const [modelSplit, setModelSplit] = useState<ModelSplit | null>(initial.split ?? null)
  const [passPlan, setPassPlan] = useState<PassPlan | null>(initial.passPlan ?? null)
  const [referralConfig, setReferralConfig] = useState<ReferralConfig | null>(initial.referralConfig ?? null)
  const [refCopied, setRefCopied] = useState(false)
  const [walletPasses, setWalletPasses] = useState<Pass[]>([])
  const [passCallsText, setPassCallsText] = useState(() => {
    const plan = initial.passPlan
    if (!plan) return '5'
    return String(Math.min(plan.maxCalls, Math.max(plan.minCalls, 5)))
  })
  const [buyPassTx, setBuyPassTx] = useState<BuyPassTx | null>(null)
  const [versions, setVersions] = useState<ModelVersions | null>(initial.versions ?? null)
  const [benchmarks, setBenchmarks] = useState<BenchmarkRecord[]>(initial.benchmarks ?? [])
  const [quorums, setQuorums] = useState<QuorumRecord[]>(initial.quorums ?? [])
  const [quorumCopied, setQuorumCopied] = useState(false)
  const [batches, setBatches] = useState<BatchRecord[]>(initial.batches ?? [])
  const [batchCopied, setBatchCopied] = useState(false)
  const [openaiTab, setOpenaiTab] = useState<OpenAISnippetTab>('js')
  const [openaiCopied, setOpenaiCopied] = useState(false)
  const [config, setConfig] = useState<Config | null>(null)
  const [claimTx, setClaimTx] = useState<ClaimTx | null>(null)
  const id = initial.model.address
  const q = fixture ? `?fixture=${fixture}` : ''

  const refresh = useCallback(async () => {
    const client = api(fixture)
    const [m, e, r, ms, vs, bs, pp, rc, qs, bts] = await Promise.all([
      read(client.model(id)),
      read(client.modelEnclaves(id)),
      read(client.modelReceipts(id, { limit: 8 })),
      loadMeasurements(client),
      loadModelVersions(client, id),
      loadModelBenchmarks(client, id),
      loadModelPassPlan(client, id),
      loadModelReferralConfig(client, id),
      loadModelQuorums(client, id),
      loadModelBatches(client, id),
    ])
    const nextModel = m.ok ? m.data : model
    if (m.ok) setModel(m.data)
    setEnclaves(e)
    setReceipts(r)
    setMeasurements(ms)
    if (vs) setVersions(vs)
    setBenchmarks(bs)
    setPassPlan(pp)
    setReferralConfig(rc)
    setQuorums(qs)
    setBatches(bts)
    const [nextPolicy, nextSplit] = await Promise.all([
      loadModelPolicy(client, nextModel),
      loadModelSplit(client, nextModel),
    ])
    setPolicy(nextPolicy)
    setModelSplit(nextSplit)
    if (w.status === 'connected' && w.address) {
      setWalletPasses(await loadAccountPasses(client, w.address))
    }
  }, [fixture, id, w.status, w.address]) // eslint-disable-line react-hooks/exhaustive-deps

  // After a confirmation the API's read follows the chain by a moment: read now and once more shortly after.
  const refreshSoon = useCallback(() => { void refresh(); setTimeout(() => void refresh(), 2500) }, [refresh])

  useEffect(() => {
    void refresh()
    void read(api(fixture).config()).then((c) => { if (c.ok) setConfig(c.data) })
  }, [fixture, refresh])

  useEffect(() => {
    if (w.status !== 'connected' || !w.address) {
      setWalletPasses([])
      return
    }
    let liveSub = true
    void loadAccountPasses(api(fixture), w.address).then((items) => {
      if (liveSub) setWalletPasses(items)
    })
    return () => { liveSub = false }
  }, [fixture, w.status, w.address])

  const activePass = findActiveModelPass(walletPasses, model.address)
  const activeReferral = referralConfig?.active && referralConfig.shareBps > 0 ? referralConfig : null
  const effectiveReferrer = referrer && activeReferral && referrer !== w.address ? referrer : null
  const shareOrigin = typeof window !== 'undefined' ? window.location.origin : 'https://voynich.dev'
  const myReferralLink = w.status === 'connected' && w.address ? buildReferralLink(shareOrigin, model.name, w.address) : null

  // The owner's wallet sees the owner's tools. On a sample API the view can be opened as the owner.
  const isOwner = (w.status === 'connected' && w.address === model.owner) || (asOwner && !!config?.fixture)
  const live = model.status === 'live'
  const perToken = model.priceUnit === 'token'
  const activeVersion = versions?.currentVersion ?? effectiveModelVersion(model)
  const versionItems = versions?.items?.length ? versions.items : fallbackModelVersions(model)
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
          {modelSplit?.active && modelSplit.recipients.length > 0 ? (
            <p className="t-small dim" style={{ marginTop: 8 }}>
              Owner share routes to <a href="#revenue-split" className="link">{modelSplit.recipients.length} {modelSplit.recipients.length === 1 ? 'recipient' : 'recipients'}</a>.
            </p>
          ) : null}
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
            <span className={s.kindBadge}>v{activeVersion}</span>
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
          <CallPanel model={model} fixture={fixture} owner={isOwner} enclaves={enclaves.ok ? enclaves.data.items : null} policy={policy} activePass={activePass} referrer={effectiveReferrer} referralShareBps={activeReferral?.shareBps ?? null} onSettled={refreshSoon} />
        </div>

        {live ? facts : null}

        {isOwner ? (
          <div className={s.full}>
            <OwnerPanel model={model} fixture={fixture} signer={w.address === model.owner ? w.address : model.owner} grants={enclaves.ok ? enclaves.data.items : []} policy={policy} split={modelSplit} passPlan={passPlan} referralConfig={referralConfig} currentVersion={activeVersion} onChanged={refreshSoon} />
          </div>
        ) : null}

        {activeReferral ? (
          <section id="referral-share" className={`panel ${s.full}`} aria-labelledby="referral-share-heading">
            <div className="panel-head">
              <div className={s.splitHeadMeta}>
                <h2 id="referral-share-heading">Referral share</h2>
                <span className={s.programBadge}>{formatReferralShare(activeReferral.shareBps)} of owner share</span>
              </div>
              <Link href={`/account${q}`} className="link t-small" data-arrow>Claim referral earnings</Link>
            </div>
            <div className="panel-body">
              {myReferralLink ? (
                <div className={s.upgradeRow}>
                  <code className={`mono ${s.upgradeCode}`}>{myReferralLink}</code>
                  <button
                    type="button"
                    className="btn"
                    data-kind="primary"
                    data-size="s"
                    onClick={() => {
                      void navigator.clipboard?.writeText(myReferralLink)
                      play('copy')
                      setRefCopied(true)
                      setTimeout(() => setRefCopied(false), 1800)
                    }}
                  >
                    {refCopied ? 'Copied' : 'Copy referral link'}
                  </button>
                </div>
              ) : (
                <p className="t-small dim">
                  Connect your wallet to copy a <span className="mono">?ref=&lt;wallet&gt;</span> share link and earn {formatReferralShare(activeReferral.shareBps)} of the owner share on every settled call you refer.
                </p>
              )}
              {effectiveReferrer ? (
                <p className="t-small dim" style={{ marginTop: 8 }}>
                  Active referral: <span className="mono">{short(effectiveReferrer, 6)}</span> receives {formatReferralShare(activeReferral.shareBps)} of the owner share when your call settles.
                </p>
              ) : null}
            </div>
          </section>
        ) : null}

        {passPlan?.active && !perToken ? (() => {
          const savingsPct = computePassSavingsPct(model.price.amount, passPlan.pricePerCall)
          const parsedCalls = /^\d+$/.test(passCallsText.trim()) ? Number(passCallsText.trim()) : NaN
          const callsValid = Number.isInteger(parsedCalls) && parsedCalls >= passPlan.minCalls && parsedCalls <= passPlan.maxCalls
          const totalCost = callsValid ? (BigInt(passPlan.pricePerCall) * BigInt(parsedCalls)).toString() : null
          const busy = buyPassTx?.stage === 'signing' || buyPassTx?.stage === 'confirming'
          const buyer = w.status === 'connected' ? w.address : config?.fixture ? model.owner : null
          return (
            <section id="call-passes" className={`panel ${s.full}`} aria-labelledby="call-passes-heading">
              <div className="panel-head">
                <div className={s.splitHeadMeta}>
                  <h2 id="call-passes-heading">Call passes</h2>
                  {savingsPct > 0 ? <span className={s.programBadge}>{savingsPct}% off spot</span> : null}
                </div>
                <span className="t-small dim">
                  <Amount value={{ ...model.price, amount: passPlan.pricePerCall }} /> / call ({group(passPlan.minCalls)} to {group(passPlan.maxCalls)} calls, {group(passPlan.ttlSlots)} slots TTL)
                </span>
              </div>
              <div className="panel-body">
                <div className={s.upgradeRow}>
                  <div className="input-row" style={{ maxWidth: 160 }}>
                    <input
                      aria-label="Pass call count"
                      className="input mono"
                      inputMode="numeric"
                      autoComplete="off"
                      value={passCallsText}
                      onChange={(e) => { setPassCallsText(e.target.value); setBuyPassTx(null) }}
                    />
                    <span className="suffix">calls</span>
                  </div>
                  {totalCost ? (
                    <span className="t-small dim">
                      Total: <Amount value={{ ...model.price, amount: totalCost }} />
                    </span>
                  ) : (
                    <span className="t-small bad">Enter {group(passPlan.minCalls)} to {group(passPlan.maxCalls)} calls.</span>
                  )}
                  <button
                    type="button"
                    className="btn"
                    data-kind="primary"
                    data-size="s"
                    disabled={!callsValid || !buyer || busy}
                    data-pending={busy || undefined}
                    onClick={() => {
                      if (!callsValid || !buyer || busy) return
                      setBuyPassTx({ stage: 'signing' })
                      void buyModelPass(api(fixture), { wallet: buyer, model: model.address, callsTotal: parsedCalls }, (stage) => {
                        setBuyPassTx({ stage })
                      })
                        .then(() => {
                          play('grant')
                          setBuyPassTx({ stage: 'done', message: `Purchased ${parsedCalls}-call pass.` })
                          refreshSoon()
                        })
                        .catch((err) => {
                          play('failed')
                          setBuyPassTx({ stage: 'failed', message: errorMessage(err) })
                        })
                    }}
                  >
                    {busy ? (buyPassTx?.stage === 'signing' ? 'Signing' : 'Confirming') : 'Buy pass'}
                  </button>
                  {activePass ? (
                    <Link href={`/account${q}`} className="link t-small" data-arrow>
                      Active pass: {activePass.callsRemaining} of {activePass.callsTotal} left
                    </Link>
                  ) : !buyer ? (
                    <span className="t-small dim">Connect a wallet to buy a pass.</span>
                  ) : null}
                </div>
                {buyPassTx ? (
                  <p className={s.txLine} role="status" aria-live="polite" style={{ marginTop: 10 }}>
                    <StateTile state={buyPassTx.stage === 'done' ? 'passed' : buyPassTx.stage === 'failed' ? 'failed' : 'pending'} />
                    <span className={buyPassTx.stage === 'failed' ? 'bad' : buyPassTx.stage === 'done' ? 'ochre' : 'sub'}>
                      {buyPassTx.stage === 'signing' ? 'Awaiting signature' : buyPassTx.stage === 'confirming' ? 'Confirming pass' : buyPassTx.message}
                    </span>
                  </p>
                ) : null}
              </div>
            </section>
          )
        })() : null}

        {modelSplit && modelSplit.recipients.length > 0 ? (
          <section id="revenue-split" className={`panel ${s.full}`} aria-labelledby="revenue-split-heading">
            <div className="panel-head">
              <div className={s.splitHeadMeta}>
                <h2 id="revenue-split-heading">Revenue split</h2>
                <span className={s.kindBadge}>{modelSplit.active ? 'Active' : 'Cleared'}</span>
                <Hash value={modelSplit.address} chars={6} label="split account" />
              </div>
              <span className="t-small dim">
                Total routed: <Amount value={{ ...model.price, amount: modelSplit.totalReceived }} />
              </span>
            </div>
            <div className={s.splitStripWrap}>
              <TileStrip
                parts={modelSplit.recipients.map((r, idx) => ({
                  share: r.shareBps / 10000,
                  step: SPLIT_STEPS[idx % SPLIT_STEPS.length]!,
                }))}
                cells={48}
                height={14}
              />
              <div className={s.splitLegend}>
                {modelSplit.recipients.map((r) => (
                  <span key={r.wallet} className={s.splitLegendItem}>
                    <span className="mono">{short(r.wallet, 4)}</span>
                    <span className="mono ochre">{formatSplitPct(r.shareBps)}</span>
                  </span>
                ))}
              </div>
            </div>
            <ul
              className={s.list}
              style={{ '--cols': 'minmax(0, 1.5fr) minmax(0, 1.1fr) minmax(0, 0.9fr) minmax(0, 0.9fr) minmax(0, 0.9fr) minmax(0, 0.8fr)' } as React.CSSProperties}
            >
              <li className={s.listHead} aria-hidden="true">
                <span>Recipient</span>
                <span>Share</span>
                <span className={s.num}>Accrued</span>
                <span className={s.num}>Claimed</span>
                <span className={s.num}>Unclaimed</span>
                <span className={s.num}>Action</span>
              </li>
              {modelSplit.recipients.map((r) => {
                const unclaimed = BigInt(r.claimable)
                const busy = claimTx?.stage === 'signing' || claimTx?.stage === 'confirming'
                const claimingThis = busy && claimTx?.wallet === r.wallet
                const payer = w.status === 'connected' ? w.address : config?.fixture ? r.wallet : null
                const canClaim = unclaimed > 0n && !!payer && !busy
                return (
                  <li key={r.wallet} className={s.row}>
                    <span data-label="Recipient" className={s.callerCell}>
                      <Hash value={r.wallet} chars={6} label="recipient wallet" />
                      {w.status === 'connected' && w.address === r.wallet ? <span className={s.programBadge}>You</span> : null}
                    </span>
                    <span data-label="Share" className={s.splitShareCell}>
                      <span className="mono">{formatSplitPct(r.shareBps)}</span>
                      <span className={s.splitBarTrack} aria-hidden="true">
                        <span className={s.splitBarFill} style={{ width: `${Math.min(100, r.shareBps / 100)}%` }} />
                      </span>
                    </span>
                    <span data-label="Accrued" className={s.num}>
                      <Amount value={{ ...model.price, amount: r.accrued }} />
                    </span>
                    <span data-label="Claimed" className={s.num}>
                      <Amount value={{ ...model.price, amount: r.claimed }} />
                    </span>
                    <span data-label="Unclaimed" className={s.num}>
                      <Amount value={{ ...model.price, amount: r.claimable }} />
                    </span>
                    <span data-label="Action" className={`${s.num} ${s.splitActionCell}`}>
                      <button
                        type="button"
                        className="btn"
                        data-kind={unclaimed > 0n ? 'primary' : undefined}
                        data-size="s"
                        disabled={!canClaim}
                        data-pending={claimingThis || undefined}
                        onClick={() => {
                          if (!payer || unclaimed <= 0n || busy) return
                          setClaimTx({ wallet: r.wallet, stage: 'signing' })
                          void claimModelSplit(api(fixture), model.address, payer, r.wallet, (stage) => {
                            setClaimTx({ wallet: r.wallet, stage })
                          })
                            .then(() => {
                              play('grant')
                              setClaimTx({ wallet: r.wallet, stage: 'done', message: `Claimed for ${short(r.wallet, 4)}.` })
                              refreshSoon()
                            })
                            .catch((err) => {
                              play('failed')
                              setClaimTx({ wallet: r.wallet, stage: 'failed', message: errorMessage(err) })
                            })
                        }}
                      >
                        {claimingThis ? (claimTx.stage === 'signing' ? 'Signing' : 'Confirming') : 'Claim'}
                      </button>
                    </span>
                  </li>
                )
              })}
            </ul>
            <div className={s.splitFoot}>
              {claimTx ? (
                <p className={s.txLine} role="status" aria-live="polite">
                  <StateTile state={claimTx.stage === 'done' ? 'passed' : claimTx.stage === 'failed' ? 'failed' : 'pending'} />
                  <span className={claimTx.stage === 'failed' ? 'bad' : claimTx.stage === 'done' ? 'ochre' : 'sub'}>
                    {claimTx.stage === 'signing'
                      ? 'Awaiting signature'
                      : claimTx.stage === 'confirming'
                        ? 'Confirming claim'
                        : claimTx.message}
                  </span>
                </p>
              ) : totalUnclaimedLamports(modelSplit) > 0n && w.status !== 'connected' && !config?.fixture ? (
                <span className="t-small dim">Connect any wallet to submit a permissionless claim.</span>
              ) : (
                <span className="t-small dim">Permissionless claims transfer accrued owner share directly to each recipient wallet.</span>
              )}
              <span className="t-small dim">Updated slot <span className="mono">{group(modelSplit.updatedSlot)}</span></span>
            </div>
          </section>
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

        <section id="openai-sdk" className={`panel ${s.full}`} aria-labelledby="openai-sdk-heading">
          <div className="panel-head">
            <div className={s.splitHeadMeta}>
              <h2 id="openai-sdk-heading">OpenAI SDK &amp; MCP</h2>
              <span className={s.kindBadge}>{openaiTab === 'mcp' ? 'stdio MCP' : 'OPENAI_BASE_URL'}</span>
              {openaiTab !== 'mcp' && isMeteredTextModel(model) ? <span className={s.programBadge}>stream: true</span> : null}
            </div>
            <div className={s.splitHeadMeta}>
              <Link href="/docs/sdk/openai-compatible" className="link t-small" data-arrow>OpenAI guide</Link>
              <Link href="/docs/sdk/mcp-server" className="link t-small" data-arrow>MCP guide</Link>
            </div>
          </div>
          <div className="panel-body">
            {(() => {
              const snippets = buildOpenAISnippets(model)
              const activeCode = snippets[openaiTab]
              return (
                <>
                  <div className={s.openaiBar}>
                    <div className={s.openaiTabs} role="tablist" aria-label="OpenAI SDK and MCP snippet format">
                      {OPENAI_SNIPPET_TABS.map((tab) => (
                        <button
                          key={tab.id}
                          type="button"
                          role="tab"
                          aria-selected={openaiTab === tab.id}
                          className={s.openaiTab}
                          onClick={() => {
                            if (openaiTab !== tab.id) {
                              play('toggle')
                              setOpenaiTab(tab.id)
                              setOpenaiCopied(false)
                            }
                          }}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="btn"
                      data-size="s"
                      onClick={() => {
                        void navigator.clipboard?.writeText(activeCode)
                        play('copy')
                        setOpenaiCopied(true)
                        setTimeout(() => setOpenaiCopied(false), 1800)
                      }}
                    >
                      {openaiCopied ? 'Copied' : 'Copy snippet'}
                    </button>
                  </div>
                  <pre className={s.openaiPre}><code>{activeCode}</code></pre>
                </>
              )
            })()}
          </div>
          <div className={s.splitFoot}>
            {openaiTab === 'mcp' ? (
              <span className="t-small dim">{mcpToolPromptNote(model)}</span>
            ) : (
              <span className="t-small dim">Run <span className="mono">voynich serve</span> locally, point any OpenAI client at <span className="mono">http://127.0.0.1:8787/v1</span>, and read <span className="mono">X-Voynich-Receipt</span> on every response.</span>
            )}
            <span className="t-small dim">Model ID <span className="mono">{openAIModelId(model)}</span></span>
          </div>
        </section>

        <section className={`panel ${s.full}`} aria-labelledby="benchmarks">
          <div className="panel-head">
            <div className={s.splitHeadMeta}>
              <h2 id="benchmarks">Benchmarks</h2>
              <span className={s.kindBadge}>{group(benchmarks.length)}</span>
            </div>
            <Link href={`/benchmarks${q}`} className="link t-small" data-arrow>All benchmarks</Link>
          </div>
          {benchmarks.length === 0 ? (
            <div className="panel-body">
              <p className="t-small dim">No on-chain benchmarks published for this model yet. Anyone can anchor a receipt-backed score from the CLI.</p>
            </div>
          ) : (
            <ul
              className={s.list}
              style={{ '--cols': 'minmax(0, 1.1fr) minmax(0, 0.55fr) minmax(0, 1fr) minmax(0, 0.75fr) minmax(0, 1.15fr) minmax(0, 1.45fr)' } as React.CSSProperties}
            >
              <li className={s.listHead} aria-hidden="true">
                <span>Suite</span>
                <span>Version</span>
                <span>Score</span>
                <span className={s.num}>Passed</span>
                <span>Dataset</span>
                <span>Receipts</span>
              </li>
              {benchmarks.map((b) => (
                <li key={b.address} className={s.row}>
                  <span data-label="Suite" className="mono">{b.name}</span>
                  <span data-label="Version"><span className={s.kindBadge}>v{b.modelVersion}</span></span>
                  <span data-label="Score" className={s.splitShareCell}>
                    <span className="mono ochre">{formatScorePct(b.scoreBps)}</span>
                    <span className={s.splitBarTrack} aria-hidden="true">
                      <span className={s.splitBarFill} style={{ width: `${Math.min(100, b.scoreBps / 100)}%` }} />
                    </span>
                  </span>
                  <span data-label="Passed" className={`mono ${s.num}`}>{group(b.passedCount)} / {group(b.sampleCount)}</span>
                  <span data-label="Dataset">
                    <Hash value={b.datasetSha256} chars={6} label="dataset hash" />
                  </span>
                  <span data-label="Receipts" className={s.receiptPills}>
                    {b.receipts.slice(0, 4).map((r) => (
                      <Link key={r} href={`/receipts/${r}${q}`} className={s.receiptPill} title={r}>
                        {short(r, 4)}
                      </Link>
                    ))}
                    {b.receipts.length > 4 ? <span className={s.kindBadge}>+{b.receipts.length - 4}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className={s.splitFoot}>
            <code className={`mono ${s.upgradeCode}`}>{benchmarkRunCliCommand(model.name)}</code>
          </div>
        </section>

        <section id="quorums" className={`panel ${s.full}`} aria-labelledby="quorums-heading">
          <div className="panel-head">
            <div className={s.splitHeadMeta}>
              <h2 id="quorums-heading">Quorums</h2>
              <span className={s.kindBadge}>{group(quorums.length)}</span>
            </div>
            <span className="t-small dim">Multi-receipt on-chain consensus proofs</span>
          </div>
          {quorums.length === 0 ? (
            <div className="panel-body">
              <p className="t-small dim">No quorum consensus proofs recorded for this model yet. Run a multi-vote quorum call from the CLI to verify agreement across receipts on chain.</p>
            </div>
          ) : (
            <ul
              className={s.list}
              style={{ '--cols': 'minmax(0, 1.05fr) minmax(0, 0.7fr) minmax(0, 0.7fr) minmax(0, 1fr) minmax(0, 1.1fr) minmax(0, 1.45fr)' } as React.CSSProperties}
            >
              <li className={s.listHead} aria-hidden="true">
                <span>Quorum</span>
                <span>Status</span>
                <span className={s.num}>Votes</span>
                <span>Enclaves</span>
                <span>Agreed output</span>
                <span>Receipts</span>
              </li>
              {quorums.map((qr) => (
                <li key={qr.address} className={s.row}>
                  <span data-label="Quorum">
                    <Link href={`/quorums/${qr.address}${q}`} className="link mono" title={qr.address}>
                      {short(qr.address, 6)}
                    </Link>
                  </span>
                  <span data-label="Status">
                    <State state={qr.status === 'agreed' ? 'live' : 'uploading'} label={formatQuorumStatus(qr.status)} />
                  </span>
                  <span data-label="Votes" className={`mono ${s.num} ${qr.status === 'agreed' ? 'ochre' : ''}`}>
                    {formatQuorumVotes(qr.voteCount, qr.requiredVotes)}
                  </span>
                  <span data-label="Enclaves" className={s.callerCell}>
                    <span className="mono">{group(qr.distinctEnclaves)}</span>
                    <span className={s.kindBadge}>{formatQuorumMode(qr.requireDistinctEnclaves)}</span>
                  </span>
                  <span data-label="Agreed output">
                    {qr.agreedOutputHash ? (
                      <Hash value={qr.agreedOutputHash} chars={6} label="agreed output hash" />
                    ) : (
                      <span className="sub">Pending</span>
                    )}
                  </span>
                  <span data-label="Receipts" className={s.receiptPills}>
                    {qr.receipts.slice(0, 4).map((r) => (
                      <Link key={r} href={`/receipts/${r}${q}`} className={s.receiptPill} title={r}>
                        {short(r, 4)}
                      </Link>
                    ))}
                    {qr.receipts.length > 4 ? <span className={s.kindBadge}>+{qr.receipts.length - 4}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className={s.splitFoot}>
            <div className={s.upgradeRow} style={{ width: '100%' }}>
              <code className={`mono ${s.upgradeCode}`}>{quorumRunCliCommand(model.name)}</code>
              <button
                type="button"
                className="btn"
                data-size="s"
                onClick={() => {
                  void navigator.clipboard?.writeText(quorumRunCliCommand(model.name))
                  play('copy')
                  setQuorumCopied(true)
                  setTimeout(() => setQuorumCopied(false), 1800)
                }}
              >
                {quorumCopied ? 'Copied' : 'Copy command'}
              </button>
            </div>
          </div>
        </section>

        <section id="batches" className={`panel ${s.full}`} aria-labelledby="batches-heading">
          <div className="panel-head">
            <div className={s.splitHeadMeta}>
              <h2 id="batches-heading">Batches</h2>
              <span className={s.kindBadge}>{group(batches.length)}</span>
            </div>
            <span className="t-small dim">Chained multi-item receipt roots on chain</span>
          </div>
          {batches.length === 0 ? (
            <div className="panel-body">
              <p className="t-small dim">No batch jobs recorded for this model yet. Run a batch from the CLI to commit up to 256 receipts into one on-chain root.</p>
            </div>
          ) : (
            <ul
              className={s.list}
              style={{ '--cols': 'minmax(0, 1.05fr) minmax(0, 0.75fr) minmax(0, 0.75fr) minmax(0, 1.25fr) minmax(0, 1.55fr)' } as React.CSSProperties}
            >
              <li className={s.listHead} aria-hidden="true">
                <span>Batch</span>
                <span>Status</span>
                <span className={s.num}>Progress</span>
                <span>Receipts root</span>
                <span>Receipts</span>
              </li>
              {batches.map((bt) => (
                <li key={bt.address} className={s.row}>
                  <span data-label="Batch">
                    <Link href={`/batches/${bt.address}${q}`} className="link mono" title={bt.address}>
                      {short(bt.address, 6)}
                    </Link>
                  </span>
                  <span data-label="Status">
                    <State state={bt.status === 'completed' ? 'live' : 'uploading'} label={formatBatchStatus(bt.status)} />
                  </span>
                  <span data-label="Progress" className={`mono ${s.num} ${bt.status === 'completed' ? 'ochre' : ''}`}>
                    {formatBatchProgress(bt.completedCount, bt.totalCount)}
                  </span>
                  <span data-label="Receipts root">
                    <Hash value={bt.receiptsRoot} chars={6} label="receipts root" />
                  </span>
                  <span data-label="Receipts" className={s.receiptPills}>
                    {bt.receipts.slice(0, 4).map((r) => (
                      <Link key={r} href={`/receipts/${r}${q}`} className={s.receiptPill} title={r}>
                        {short(r, 4)}
                      </Link>
                    ))}
                    {bt.receipts.length > 4 ? <span className={s.kindBadge}>+{bt.receipts.length - 4}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className={s.splitFoot}>
            <div className={s.upgradeRow} style={{ width: '100%' }}>
              <code className={`mono ${s.upgradeCode}`}>{batchRunCliCommand(model.name)}</code>
              <button
                type="button"
                className="btn"
                data-size="s"
                onClick={() => {
                  void navigator.clipboard?.writeText(batchRunCliCommand(model.name))
                  play('copy')
                  setBatchCopied(true)
                  setTimeout(() => setBatchCopied(false), 1800)
                }}
              >
                {batchCopied ? 'Copied' : 'Copy command'}
              </button>
            </div>
          </div>
        </section>

        <section className={`panel ${s.full}`} aria-labelledby="versions">
          <div className="panel-head">
            <h2 id="versions">Version history</h2>
            <span className="t-small dim">Active: <span className="mono">v{activeVersion}</span></span>
          </div>
          <ul className={s.list} style={{ '--cols': 'minmax(0, 0.7fr) minmax(0, 0.8fr) minmax(0, 1.8fr) minmax(0, 0.9fr) minmax(0, 1fr)' } as React.CSSProperties}>
            <li className={s.listHead} aria-hidden="true"><span>Version</span><span>Status</span><span>Weights hash</span><span className={s.num}>Size</span><span className={s.num}>Published slot</span></li>
            {versionItems.map((v) => (
              <li key={v.version} className={s.row}>
                <span data-label="Version" className="mono">v{v.version}</span>
                <span data-label="Status">
                  <State
                    state={v.status === 'live' ? 'live' : v.status === 'uploading' ? 'uploading' : 'sealed'}
                    label={v.status === 'live' ? 'Live' : v.status === 'uploading' ? 'Uploading' : 'Archived'}
                  />
                </span>
                <span data-label="Weights hash">
                  {v.ciphertextSha256 ? <Hash value={v.ciphertextSha256} chars={10} label={`v${v.version} weights hash`} /> : <span className="sub">Uploading</span>}
                </span>
                <span data-label="Size" className={s.num}><Size n={v.sizeBytes} /></span>
                <span data-label="Published slot" className={`mono ${s.num}`}>{v.publishedSlot ? group(v.publishedSlot) : 'Pending'}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className={`panel ${s.half}`} aria-labelledby="enclaves">
          <div className="panel-head"><h2 id="enclaves">Enclaves holding a grant</h2></div>
          {!enclaves.ok ? <div className={`panel-body ${s.fail}`}><Failed title="The enclaves did not load" message={enclaves.message} retry={<button type="button" className="btn" data-size="s" onClick={() => void refresh()}>Try again</button>} /></div>
            : enclaves.data.items.length === 0 ? <div className="panel-body"><Empty title="No enclave holds this model yet">An enclave answers calls once the owner grants it the model key.</Empty></div>
            : (
              <ul className={s.list} style={{ '--cols': 'minmax(0, 1.05fr) minmax(0, 0.65fr) minmax(0, 1fr) minmax(0, 0.85fr) minmax(0, 0.78fr) minmax(0, 0.75fr) minmax(0, 0.65fr)' } as React.CSSProperties}>
                <li className={s.listHead} aria-hidden="true"><span>Enclave</span><span>Hardware</span><span>Measurement</span><span className={s.num}>Bond &amp; uptime</span><span className={s.num}>Quoted share</span><span className={s.num}>Median latency</span><span>Grant</span></li>
                {enclaves.data.items.map(({ enclave, grant }) => {
                  const share = effectiveShareBps(grant, model.operatorShareBps)
                  const discounted = grant.quotedOperatorShareBps !== null && grant.quotedOperatorShareBps !== undefined && grant.quotedOperatorShareBps < model.operatorShareBps
                  const hasBond = enclave.bondedLamports && BigInt(enclave.bondedLamports) > 0n
                  const uptime = computeUptimePct(enclave.callsSettled, enclave.missedCalls)
                  return (
                    <li key={grant.address} className={s.row}>
                      <span data-label="Enclave"><Hash value={enclave.signingKey} chars={4} href={`/enclaves/${enclave.address}${q}`} label="enclave address" /></span>
                      <span data-label="Hardware">{hardware(enclave.hardwareType)}</span>
                      <span data-label="Measurement">
                        <Hash value={enclave.measurement} chars={4} label="measurement" />
                        <MeasurementSource record={findMeasurement(measurements, enclave.measurement)} compact />
                      </span>
                      <span data-label="Bond & uptime" className={`mono ${s.num}`}>
                        <span className={hasBond ? 'ochre' : 'dim'}>{formatBondSol(enclave.bondedLamports)}</span>
                        <span className="t-small dim" style={{ display: 'block' }}>{uptime}</span>
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
