'use client'

// The account is one place in every state: the calls as the work, what the wallet owns and operates beside them.
// With no wallet, nothing read yet or a failed read, the same regions stand with that state where the data would be.

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import type { Account, Call, Earnings, Pass, Referral, Session } from '@voynich/contract'
import { FIXTURE } from '@voynich/contract/fixtures'
import { api, read, type Read } from '@/lib/api'
import { loadLastPieceFromApi, loadSavedStreamPieces, removeSavedStreamPiece, type SavedStreamPiece } from '@/lib/call'
import { LINKS, SKETCH32 } from '@/lib/facts'
import { group, hardware, money, short } from '@/lib/format'
import { closeModelPass, loadAccountPasses } from '@/lib/passes'
import { claimModelReferral, loadAccountReferrals } from '@/lib/referrals'
import { closeBrowserSession, loadAccountSessions } from '@/lib/sessions'
import { play } from '@/lib/sound'
import { errorMessage, send, type TxStageName } from '@/lib/tx'
import { wallet } from '@/lib/wallet'
import { useWallet } from '@/src/engines/wallet/react'
import { WalletButton } from '@/components/nav/WalletButton'
import { State, StateTile } from '@/components/tile/Tile'
import { toast } from '@/components/ui/Toast'
import { Amount, Empty, Failed, Hash, Loading } from '@/components/ui/kit'
import { q } from '@/components/receipt/shared'
import s from './account.module.css'

type Names = Record<string, string>
// What the regions hold: nothing to read from, a read under way, a read that failed, or the account.
type Held = { is: 'connect' } | { is: 'loading' } | { is: 'failed'; message: string; retry?: () => void } | { is: 'data'; account: Account }

export function AccountView({ fixture, as = null, walletAddress = null }: { fixture: string | null; as?: 'owner' | null; walletAddress?: string | null }) {
  const w = useWallet(wallet)
  // With no wallet connected, `?wallet=<pubkey>` inspects that wallet read-only, `?as=owner` shows
  // the account of the wallet that owns sketch-32, and a named scenario on a sample API shows its caller's account.
  const [sample, setSample] = useState<string | null | undefined>(!walletAddress && (fixture || as) ? undefined : null)
  const [r, setR] = useState<Read<Account> | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [passes, setPasses] = useState<Pass[]>([])
  const [referrals, setReferrals] = useState<Referral[]>([])
  const [names, setNames] = useState<Names>({})
  const address = walletAddress ?? w.address ?? sample ?? null
  const canSign = !!address && w.address === address

  useEffect(() => {
    if (walletAddress || (!fixture && !as) || w.address) return
    let live = true
    if (as === 'owner') {
      void read(api(fixture).model(SKETCH32.id)).then((m) => {
        if (!live) return
        if (!m.ok) { setSample(null); setR(m) } else setSample(m.data.owner)
      })
      return () => { live = false }
    }
    void read(api(fixture).config()).then((c) => {
      if (!live) return
      if (!c.ok) { setSample(null); setR(c) } else setSample(c.data.fixture ? FIXTURE.caller : null)
    })
    return () => { live = false }
  }, [walletAddress, fixture, as, w.address])

  const load = useCallback(async (who: string) => {
    const client = api(fixture)
    const [account, list, sess, ps, refs] = await Promise.all([
      read(client.account(who)),
      read(client.models({ limit: 100 })),
      loadAccountSessions(client, who),
      loadAccountPasses(client, who),
      loadAccountReferrals(client, who),
    ])
    if (list.ok) setNames(Object.fromEntries(list.data.items.map((m) => [m.address, m.name])))
    setSessions(sess)
    setPasses(ps)
    setReferrals(refs)
    return account
  }, [fixture])

  useEffect(() => {
    if (!address) return
    let live = true
    setR(null)
    void load(address).then((a) => { if (live) setR(a) })
    return () => { live = false }
  }, [address, load])

  const waiting = !walletAddress && (!w.ready || w.status === 'connecting' || sample === undefined)
  const held: Held = r && !r.ok ? { is: 'failed', message: r.message, retry: address ? () => { setR(null); void load(address).then(setR) } : undefined }
    : !address ? (waiting ? { is: 'loading' } : { is: 'connect' })
    : !r ? { is: 'loading' }
    : { is: 'data', account: r.data }

  return (
    <div className="container page">
      <div className="page-head">
        <div>
          <h1 className="t-h1">Account</h1>
          {address ? <p className={s.who}><Hash value={address} chars={8} label="wallet address" /></p> : <p className="t-small">Your calls, the models you own and the enclaves you operate.</p>}
        </div>
      </div>
      <Regions
        fixture={fixture}
        held={held}
        names={names}
        sessions={sessions}
        passes={passes}
        referrals={referrals}
        wallet={address}
        canSign={canSign}
        onChange={(calls) => { if (r?.ok) setR({ ok: true, data: { ...r.data, calls } }) }}
        onSessionsChange={setSessions}
        onPassesChange={setPasses}
        onReferralsChange={setReferrals}
      />
    </div>
  )
}

function Regions({ fixture, held, names, sessions, passes, referrals, wallet: who, canSign, onChange, onSessionsChange, onPassesChange, onReferralsChange }: { fixture: string | null; held: Held; names: Names; sessions: Session[]; passes: Pass[]; referrals: Referral[]; wallet: string | null; canSign: boolean; onChange: (calls: Call[]) => void; onSessionsChange: (sessions: Session[]) => void; onPassesChange: (passes: Pass[]) => void; onReferralsChange: (referrals: Referral[]) => void }) {
  const [pending, setPending] = useState<{ call: string; kind: 'refund' | 'settle'; stage: 'building' | TxStageName } | null>(null)
  const [closingSession, setClosingSession] = useState<{ address: string; stage: 'building' | TxStageName } | null>(null)
  const [sessionErrors, setSessionErrors] = useState<Record<string, string>>({})
  const [closingPass, setClosingPass] = useState<{ address: string; stage: 'building' | TxStageName } | null>(null)
  const [passErrors, setPassErrors] = useState<Record<string, string>>({})
  const [claimingRef, setClaimingRef] = useState<{ address: string; stage: 'building' | TxStageName } | null>(null)
  const [refErrors, setRefErrors] = useState<Record<string, string>>({})
  const [loadingPiece, setLoadingPiece] = useState<string | null>(null)
  const [savedPieces, setSavedPieces] = useState<Record<string, SavedStreamPiece>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const account = held.is === 'data' ? held.account : null
  const calls = account?.calls ?? []
  const refundable = calls.filter((c) => c.status === 'refundable').length

  useEffect(() => {
    const loaded = loadSavedStreamPieces()
    let changed = false
    for (const c of calls) {
      if ((c.status === 'settled' || c.status === 'refunded') && loaded[c.address]) {
        removeSavedStreamPiece(c.address)
        delete loaded[c.address]
        changed = true
      }
    }
    setSavedPieces(changed ? { ...loaded } : loaded)
  }, [calls])

  const refund = async (call: Call) => {
    if (pending || !who) return
    const client = api(fixture)
    setErrors((e) => ({ ...e, [call.address]: '' }))
    setPending({ call: call.address, kind: 'refund', stage: 'building' })
    try {
      const build = await client.refundCall(call.address, { wallet: who })
      await send(client, build, (stage) => setPending({ call: call.address, kind: 'refund', stage }))
      play('refund')
      removeSavedStreamPiece(call.address)
      onChange(calls.map((c) => (c.address === call.address ? { ...c, status: 'refunded' as const, failure: c.failure ? { ...c.failure, refundState: 'refunded' as const } : null } : c)))
      toast({ state: 'refunded', text: `${money(call.price)} ${call.price.symbol} returned to the caller` })
    } catch (e) {
      play('failed')
      setErrors((x) => ({ ...x, [call.address]: errorMessage(e) }))
    } finally {
      setPending(null)
    }
  }

  const settle = async (call: Call, piece: SavedStreamPiece) => {
    if (pending || !who) return
    const client = api(fixture)
    setErrors((e) => ({ ...e, [call.address]: '' }))
    setPending({ call: call.address, kind: 'settle', stage: 'building' })
    try {
      const build = await client.settleCall(call.address, {
        wallet: who,
        count: String(piece.count),
        runningHash: piece.runningHash,
        signature: piece.signature,
      })
      await send(client, build, (stage) => setPending({ call: call.address, kind: 'settle', stage }))
      let receipt = build.addresses.receipt ?? null
      if (!receipt) {
        try {
          const updated = await client.call(call.address)
          receipt = updated.receipt
        } catch {}
      }
      play('verified')
      removeSavedStreamPiece(call.address)
      setSavedPieces((prev) => {
        const next = { ...prev }
        delete next[call.address]
        return next
      })
      onChange(calls.map((c) => (c.address === call.address ? { ...c, status: 'settled' as const, receipt: receipt ?? c.receipt } : c)))
      toast({
        state: 'settled',
        text: `${money({ ...call.price, amount: piece.spentAmount })} ${call.price.symbol} paid, ${money({ ...call.price, amount: piece.remainingAmount })} ${call.price.symbol} returned to the caller`,
      })
    } catch (e) {
      play('failed')
      setErrors((x) => ({ ...x, [call.address]: errorMessage(e) }))
    } finally {
      setPending(null)
    }
  }

  const loadPiece = async (call: Call) => {
    if (pending || loadingPiece) return
    setErrors((e) => ({ ...e, [call.address]: '' }))
    setLoadingPiece(call.address)
    try {
      const saved = await loadLastPieceFromApi(api(fixture), call)
      setSavedPieces((prev) => ({ ...prev, [call.address]: saved }))
    } catch (e) {
      setErrors((x) => ({ ...x, [call.address]: errorMessage(e) }))
    } finally {
      setLoadingPiece(null)
    }
  }

  const closeSession = async (sess: Session) => {
    if (closingSession || !who) return
    const client = api(fixture)
    setSessionErrors((e) => ({ ...e, [sess.address]: '' }))
    setClosingSession({ address: sess.address, stage: 'building' })
    try {
      const updated = await closeBrowserSession({
        client,
        wallet: who,
        sessionAddress: sess.address,
        onStage: (stage) => setClosingSession({ address: sess.address, stage }),
      })
      play('refund')
      onSessionsChange(
        sessions.map((x) => (x.address === sess.address ? (updated ?? { ...x, status: 'closed' as const, remaining: '0' }) : x)),
      )
      toast({ state: 'refunded', text: `${money({ ...sess.budget, amount: sess.remaining })} ${sess.budget.symbol} reclaimed from session` })
    } catch (e) {
      play('failed')
      setSessionErrors((x) => ({ ...x, [sess.address]: errorMessage(e) }))
    } finally {
      setClosingSession(null)
    }
  }

  const closePass = async (p: Pass) => {
    if (closingPass || !who) return
    const client = api(fixture)
    setPassErrors((e) => ({ ...e, [p.address]: '' }))
    setClosingPass({ address: p.address, stage: 'building' })
    try {
      await closeModelPass(client, { wallet: who, pass: p.address }, (stage) => {
        setClosingPass({ address: p.address, stage })
      })
      play('refund')
      onPassesChange(
        passes.map((x) =>
          x.address === p.address
            ? { ...x, status: 'closed' as const, callsRemaining: 0, escrowRemaining: '0', returnedAmount: p.escrowRemaining }
            : x,
        ),
      )
      toast({
        state: 'refunded',
        text: `${money({ amount: p.escrowRemaining, decimals: 9, symbol: 'SOL' })} SOL reclaimed from pass`,
      })
    } catch (e) {
      play('failed')
      setPassErrors((x) => ({ ...x, [p.address]: errorMessage(e) }))
    } finally {
      setClosingPass(null)
    }
  }

  const claimReferral = async (ref: Referral) => {
    if (claimingRef || !who) return
    const client = api(fixture)
    setRefErrors((e) => ({ ...e, [ref.address]: '' }))
    setClaimingRef({ address: ref.address, stage: 'building' })
    try {
      await claimModelReferral(client, ref.model, { wallet: who, referrer: ref.referrer }, (stage) => {
        setClaimingRef({ address: ref.address, stage })
      })
      play('grant')
      onReferralsChange(
        referrals.map((x) =>
          x.address === ref.address
            ? { ...x, claimed: x.totalEarned, claimable: '0' }
            : x,
        ),
      )
      toast({
        state: 'refunded',
        text: `${money({ amount: ref.claimable, decimals: 9, symbol: 'SOL' })} SOL claimed from referral earnings`,
      })
    } catch (e) {
      play('failed')
      setRefErrors((x) => ({ ...x, [ref.address]: errorMessage(e) }))
    } finally {
      setClaimingRef(null)
    }
  }

  const quiet = held.is === 'connect' ? 'No wallet connected' : held.is === 'failed' ? 'Not read' : held.is === 'loading' ? null : 'None yet'
  // What a side region says when it has no rows of its own to show.
  const aside = (none: React.ReactNode, about: React.ReactNode) =>
    held.is === 'loading' || held.is === 'failed' ? null
    : <p className="t-small">{held.is === 'connect' ? about : none}</p>

  return (
    <div className={`grid ${s.layout}`}>
      <div className={s.main}>
        {held.is === 'data' ? (
          <section className="panel" aria-labelledby="sessions">
            <div className="panel-head">
              <h2 id="sessions">Active sessions</h2>
              <span className="mono dim">{group(sessions.filter((x) => x.status === 'open').length)} open</span>
            </div>
            {sessions.length === 0 ? (
              <div className="panel-body">
                <p className="t-small dim">No caller sessions yet. Open a one-signature session from any model page to run consecutive calls without wallet prompts.</p>
              </div>
            ) : (
              <ul className={s.calls}>
                <li className={`${s.sessionRow} ${s.callHead}`} aria-hidden="true"><span>State</span><span>Model</span><span className={s.num}>Budget</span><span className={s.num}>Remaining</span><span className={s.num}>Expires</span><span /></li>
                {sessions.map((sess) => {
                  const busy = closingSession?.address === sess.address
                  const modelName = sess.model ? names[sess.model] : null
                  return (
                    <li key={sess.address} className={s.sessionRow} data-state={sess.status}>
                      <span className={s.state}><State state={sess.status === 'open' ? 'live' : 'sealed'} label={sess.status === 'open' ? 'Open' : 'Closed'} /></span>
                      <span className={s.model}>
                        {sess.model ? (
                          <Link className="link mono" href={`/models/${modelName ?? sess.model}${q(fixture)}`}>{modelName ?? short(sess.model, 4)}</Link>
                        ) : (
                          <span className="t-small">Any model</span>
                        )}
                        <span className="t-small dim" style={{ marginLeft: 8 }}>{group(sess.callsOpened)} {sess.callsOpened === '1' ? 'call' : 'calls'}</span>
                      </span>
                      <span className={s.num}><span className="t-label">Budget</span><Amount value={sess.budget} /></span>
                      <span className={s.num}><span className="t-label">Remaining</span><Amount value={{ ...sess.budget, amount: sess.remaining }} /></span>
                      <span className={s.num}><span className="t-label">Expires</span><span className="mono">{group(sess.expiresAtSlot)}</span></span>
                      <span className={s.act} aria-live="polite">
                        {sess.status === 'open' && canSign ? (
                          <button
                            type="button"
                            className="btn"
                            data-size="s"
                            data-kind="primary"
                            data-pending={busy || undefined}
                            disabled={!!closingSession}
                            onClick={() => void closeSession(sess)}
                          >
                            {busy
                              ? <><StateTile state="pending" size={14} />{closingSession.stage === 'signing' ? 'Awaiting signature' : closingSession.stage === 'confirming' ? 'Confirming' : 'Building'}</>
                              : 'Close & reclaim'}
                          </button>
                        ) : sess.status === 'open' ? (
                          <span className="t-small dim">Open</span>
                        ) : (
                          <span className="t-small dim">Reclaimed</span>
                        )}
                      </span>
                      {sessionErrors[sess.address] ? <p className={`t-small bad ${s.why}`} role="alert">{sessionErrors[sess.address]}</p> : null}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        ) : null}

        {held.is === 'data' ? (
          <section className="panel" aria-labelledby="passes">
            <div className="panel-head">
              <h2 id="passes">Passes</h2>
              <span className="mono dim">{group(passes.filter((x) => x.status === 'open').length)} open</span>
            </div>
            {passes.length === 0 ? (
              <div className="panel-body">
                <p className="t-small dim">No prepaid call passes yet. Buy a discounted call pass on any model page with an active pass plan.</p>
              </div>
            ) : (
              <ul className={s.calls}>
                <li className={`${s.sessionRow} ${s.callHead}`} aria-hidden="true"><span>State</span><span>Model</span><span className={s.num}>Credits</span><span className={s.num}>Escrow</span><span className={s.num}>Expires</span><span /></li>
                {passes.map((p) => {
                  const busy = closingPass?.address === p.address
                  const modelName = p.modelName ?? names[p.model] ?? null
                  const priceUnit = { amount: p.escrowRemaining, decimals: 9, symbol: 'SOL' }
                  return (
                    <li key={p.address} className={s.sessionRow} data-state={p.status}>
                      <span className={s.state}><State state={p.status === 'open' ? 'live' : 'sealed'} label={p.status === 'open' ? 'Open' : 'Closed'} /></span>
                      <span className={s.model}>
                        <Link className="link mono" href={`/models/${modelName ?? p.model}${q(fixture)}`}>{modelName ?? short(p.model, 4)}</Link>
                        <span className="t-small dim" style={{ marginLeft: 8 }}>{p.callsRemaining} left</span>
                      </span>
                      <span className={s.num}><span className="t-label">Credits</span><span className="mono">{p.callsUsed} / {p.callsTotal}</span></span>
                      <span className={s.num}><span className="t-label">Escrow</span><Amount value={priceUnit} /></span>
                      <span className={s.num}><span className="t-label">Expires</span><span className="mono">{group(p.expiresAtSlot)}</span></span>
                      <span className={s.act} aria-live="polite">
                        {p.status === 'open' && canSign ? (
                          <button
                            type="button"
                            className="btn"
                            data-size="s"
                            data-kind="primary"
                            data-pending={busy || undefined}
                            disabled={!!closingPass}
                            onClick={() => void closePass(p)}
                          >
                            {busy
                              ? <><StateTile state="pending" size={14} />{closingPass.stage === 'signing' ? 'Awaiting signature' : closingPass.stage === 'confirming' ? 'Confirming' : 'Building'}</>
                              : 'Close & reclaim'}
                          </button>
                        ) : p.status === 'open' ? (
                          <span className="t-small dim">Open</span>
                        ) : (
                          <span className="t-small dim">Reclaimed</span>
                        )}
                      </span>
                      {passErrors[p.address] ? <p className={`t-small bad ${s.why}`} role="alert">{passErrors[p.address]}</p> : null}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        ) : null}

        {held.is === 'data' ? (
          <section className="panel" aria-labelledby="referrals">
            <div className="panel-head">
              <h2 id="referrals">Referrals</h2>
              <span className="mono dim">{group(referrals.length)} {referrals.length === 1 ? 'model' : 'models'}</span>
            </div>
            {referrals.length === 0 ? (
              <div className="panel-body">
                <p className="t-small dim">No referral earnings yet. Share any model page with <span className="mono">?ref=&lt;wallet&gt;</span> to earn a share of owner revenue on referred calls.</p>
              </div>
            ) : (
              <ul className={s.calls}>
                <li className={`${s.sessionRow} ${s.callHead}`} aria-hidden="true"><span>Model</span><span className={s.num}>Referred</span><span className={s.num}>Total earned</span><span className={s.num}>Claimed</span><span className={s.num}>Claimable</span><span /></li>
                {referrals.map((ref) => {
                  const busy = claimingRef?.address === ref.address
                  const modelName = ref.modelName ?? names[ref.model] ?? null
                  const hasClaimable = BigInt(ref.claimable) > 0n
                  return (
                    <li key={ref.address} className={s.sessionRow} data-state={hasClaimable ? 'open' : 'closed'}>
                      <span className={s.model}>
                        <Link className="link mono" href={`/models/${modelName ?? ref.model}${q(fixture)}`}>{modelName ?? short(ref.model, 4)}</Link>
                      </span>
                      <span className={s.num}><span className="t-label">Referred</span><span className="mono">{group(ref.callsReferred)} {ref.callsReferred === '1' ? 'call' : 'calls'}</span></span>
                      <span className={s.num}><span className="t-label">Total earned</span><Amount value={{ amount: ref.totalEarned, decimals: 9, symbol: 'SOL' }} /></span>
                      <span className={s.num}><span className="t-label">Claimed</span><Amount value={{ amount: ref.claimed, decimals: 9, symbol: 'SOL' }} /></span>
                      <span className={s.num}><span className="t-label">Claimable</span><Amount value={{ amount: ref.claimable, decimals: 9, symbol: 'SOL' }} /></span>
                      <span className={s.act} aria-live="polite">
                        {hasClaimable && canSign ? (
                          <button
                            type="button"
                            className="btn"
                            data-size="s"
                            data-kind="primary"
                            data-pending={busy || undefined}
                            disabled={!!claimingRef}
                            onClick={() => void claimReferral(ref)}
                          >
                            {busy
                              ? <><StateTile state="pending" size={14} />{claimingRef.stage === 'signing' ? 'Awaiting signature' : claimingRef.stage === 'confirming' ? 'Confirming' : 'Building'}</>
                              : 'Claim'}
                          </button>
                        ) : hasClaimable ? (
                          <span className="t-small dim">Claimable</span>
                        ) : (
                          <span className="t-small dim">Claimed</span>
                        )}
                      </span>
                      {refErrors[ref.address] ? <p className={`t-small bad ${s.why}`} role="alert">{refErrors[ref.address]}</p> : null}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        ) : null}

        <section aria-labelledby="calls">
        <div className="panel">
          <div className="panel-head"><h2 id="calls">Calls</h2>{account ? <span className="mono dim">{group(calls.length)}</span> : null}</div>
          {held.is === 'connect' ? (
            <div className="panel-body">
              <Empty title="Connect a wallet to see its account" action={<WalletButton kind="primary" />}>
                The calls it opened, with their receipts and refunds, are read from chain.
              </Empty>
            </div>
          ) : held.is === 'loading' ? (
            <div className="panel-body"><Loading rows={6} /></div>
          ) : held.is === 'failed' ? (
            <div className="panel-body">
              <Failed title="Your account did not load" message={held.message} retry={held.retry ? <button type="button" className="btn" data-size="s" onClick={held.retry}>Try again</button> : undefined} />
            </div>
          ) : calls.length === 0 ? (
            <div className="panel-body">
              <Empty title="No calls from this wallet yet" action={<Link href={`/models${q(fixture)}`} className="btn" data-kind="primary">Browse models</Link>}>
                A call it opens is listed here with its receipt, or its refund when the deadline passes.
              </Empty>
            </div>
          ) : (
            <>
              {refundable ? (
                <p className={s.now} role="status"><StateTile state="refundable" />{refundable === 1 ? 'One call is past its deadline. Its escrow is refundable.' : `${refundable} calls are past their deadline. Their escrow is refundable.`}</p>
              ) : null}
              <ul className={s.calls}>
                <li className={`${s.call} ${s.callHead}`} aria-hidden="true"><span>State</span><span>Model</span><span className={s.num}>Price</span><span className={s.num}>Opened</span><span className={s.num}>Deadline</span><span /></li>
                {calls.map((c) => {
                  const busy = pending?.call === c.address
                  const name = c.modelName ?? names[c.model]
                  return (
                    <li key={c.address} className={s.call} data-state={c.status}>
                      <span className={s.state}><State state={c.status} /></span>
                      <span className={s.model}><Link className="link mono" href={`/models/${name ?? c.model}${q(fixture)}`}>{name ?? short(c.model, 4)}</Link></span>
                      <span className={s.num}><span className="t-label">Price</span><Amount value={c.price} /></span>
                      <span className={s.num}><span className="t-label">Opened</span><span className="mono">{group(c.openedSlot)}</span></span>
                      <span className={s.num}><span className="t-label">Deadline</span><span className="mono">{group(c.deadlineSlot)}</span></span>
                      <span className={s.act} aria-live="polite">
                        {c.status === 'settled' && c.receipt ? <Link className="link" href={`/receipts/${c.receipt}${q(fixture)}`} data-arrow>Receipt</Link>
                          : c.status === 'refundable' && canSign ? (
                            <button type="button" className="btn" data-size="s" data-kind="primary" data-pending={busy || undefined} disabled={!!pending} onClick={() => void refund(c)}>
                              {busy ? <><StateTile state="pending" size={14} />{pending.stage === 'signing' ? 'Awaiting signature' : pending.stage === 'confirming' ? 'Confirming' : 'Building'}</> : 'Refund'}
                            </button>
                          ) : c.status === 'open' && c.priceUnit === 'token' && canSign ? (
                            savedPieces[c.address] ? (
                              <button type="button" className="btn" data-size="s" data-kind="primary" data-pending={busy || undefined} disabled={!!pending} onClick={() => void settle(c, savedPieces[c.address]!)}>
                                {busy ? <><StateTile state="pending" size={14} />{pending.stage === 'signing' ? 'Awaiting signature' : pending.stage === 'confirming' ? 'Confirming' : 'Building'}</> : `Settle (${group(savedPieces[c.address]!.count)} tok)`}
                              </button>
                            ) : (
                              <button type="button" className="btn" data-size="s" data-pending={loadingPiece === c.address || undefined} disabled={!!pending || !!loadingPiece} onClick={() => void loadPiece(c)}>
                                {loadingPiece === c.address ? <><StateTile state="pending" size={14} />Loading</> : 'Load last piece'}
                              </button>
                            )
                          ) : c.status === 'refundable' ? <span className="t-small dim">Refundable</span>
                          : c.status === 'refunded' ? <span className="t-small">Escrow returned</span>
                          : <span className="t-small dim">Awaiting the enclave</span>}
                      </span>
                      {c.failure && c.status === 'refundable' && !errors[c.address] ? <p className={`t-small dim ${s.why}`}>{c.failure.message}</p> : null}
                      {errors[c.address] ? <p className={`t-small bad ${s.why}`} role="alert">{errors[c.address]}{c.status === 'refundable' ? ' Press Refund to send it again.' : ''}</p> : null}
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </div>
        </section>
      </div>

      <aside className={s.side}>
        <section className="panel" aria-labelledby="owned">
          <div className="panel-head"><h2 id="owned">Models you own</h2>{account ? <span className="mono dim">{account.models.length}</span> : null}</div>
          <div className="panel-body">
            <Earned label="Owner earnings" rows={account?.ownerEarnings ?? []} quiet={quiet} />
            {account?.models.length ? (
              <ul className={s.owned}>
                {account.models.map((m) => (
                  <li key={m.address}>
                    <Link href={`/models/${m.name}${q(fixture)}`} className={s.ownedRow}>
                      <StateTile state={m.status} />
                      <span className="mono">{m.name}</span>
                      <span className="t-small dim">{m.status}</span>
                      <span className={s.count}><span className="mono">{group(m.callsSettled)}</span><span className="t-small dim">{m.callsSettled === '1' ? 'call settled' : 'calls settled'}</span></span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : aside(
              <>No sealed models under this wallet. <Link className="link" href={`/seal${q(fixture)}`} data-arrow>Seal a model</Link></>,
              <>The models this wallet sealed and what they earned. <Link className="link" href={`/seal${q(fixture)}`} data-arrow>Seal a model</Link></>,
            )}
          </div>
        </section>

        <section className="panel" aria-labelledby="operated">
          <div className="panel-head"><h2 id="operated">Enclaves you operate</h2>{account ? <span className="mono dim">{account.enclaves.length}</span> : null}</div>
          <div className="panel-body">
            <Earned label="Operator earnings" rows={account?.operatorEarnings ?? []} quiet={quiet} />
            {account?.enclaves.length ? (
              <ul className={s.owned}>
                {account.enclaves.map((e) => (
                  <li key={e.address}>
                    <Link href={`/enclaves/${e.address}${q(fixture)}`} className={s.ownedRow}>
                      <StateTile state={e.status === 'live' ? 'live' : 'expired'} />
                      <span className="mono">{short(e.address, 4)}</span>
                      <span className="t-small dim">{hardware(e.hardwareType)}, {e.status}</span>
                      <span className={s.count}><span className="mono">{group(e.callsSettled)}</span><span className="t-small dim">{e.callsSettled === '1' ? 'call settled' : 'calls settled'}</span></span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : aside(
              <>No enclaves under this wallet. <Link className="link" href={LINKS.operators.run} data-arrow>Run an enclave</Link></>,
              <>The enclaves this wallet operates and what they earned. <Link className="link" href={LINKS.operators.run} data-arrow>Run an enclave</Link></>,
            )}
          </div>
        </section>
      </aside>
    </div>
  )
}

// What a side of the account has earned, one figure a mint; a word in its place when there is no figure.
function Earned({ label, rows, quiet }: { label: string; rows: Earnings[]; quiet: string | null }) {
  return (
    <div className={s.earned}>
      <div className="t-label">{label}</div>
      {rows.length ? rows.map((e) => <Amount key={e.mint ?? 'sol'} value={e} size="m" />)
        : quiet ? <span className={`t-small dim ${s.quiet}`}>{quiet}</span>
        : <span className="skeleton" style={{ width: '40%', height: 28 }} />}
    </div>
  )
}
