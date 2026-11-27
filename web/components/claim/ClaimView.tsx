'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  claimRedemptionSol,
  loadRedemptionSummary,
  loadWalletRedemption,
  type RedemptionSummary,
  type WalletRedemption,
} from '@/lib/redemption'
import { explorerUrl } from '@/lib/env'
import { units } from '@/lib/format'
import { play } from '@/lib/sound'
import { errorMessage, type TxStageName } from '@/lib/tx'
import { wallet } from '@/lib/wallet'
import { useWallet } from '@/src/engines/wallet/react'
import { WalletButton } from '@/components/nav/WalletButton'
import { toast } from '@/components/ui/Toast'
import { Explorer, Failed, Hash, Loading, Stat } from '@/components/ui/kit'
import s from './claim.module.css'

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

function formatVoynich(raw: string): string {
  return units(raw, 6, 2)
}

function formatSol(lamports: string): string {
  return units(lamports, 9, 6)
}

export function ClaimView({ fixture, initialWallet }: { fixture: string | null; initialWallet: string | null }) {
  const w = useWallet(wallet)
  const [summary, setSummary] = useState<RedemptionSummary | null>(null)
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [lookupInput, setLookupInput] = useState(initialWallet ?? '')
  const [inspectedWallet, setInspectedWallet] = useState<string | null>(initialWallet)
  const [holder, setHolder] = useState<WalletRedemption | null>(null)
  const [holderLoading, setHolderLoading] = useState(false)
  const [holderError, setHolderError] = useState<string | null>(null)
  const [stage, setStage] = useState<'building' | TxStageName | null>(null)

  const activeWallet = w.address ?? inspectedWallet

  const refreshSummary = useCallback(async () => {
    try {
      setSummaryError(null)
      setSummary(await loadRedemptionSummary(fixture))
    } catch (e) {
      setSummaryError(errorMessage(e))
    }
  }, [fixture])

  const refreshHolder = useCallback(
    async (addr: string) => {
      setHolderLoading(true)
      setHolderError(null)
      try {
        setHolder(await loadWalletRedemption(addr, fixture))
      } catch (e) {
        setHolderError(errorMessage(e))
      } finally {
        setHolderLoading(false)
      }
    },
    [fixture],
  )

  useEffect(() => {
    void refreshSummary()
  }, [refreshSummary])

  useEffect(() => {
    if (!activeWallet) {
      setHolder(null)
      return
    }
    void refreshHolder(activeWallet)
  }, [activeWallet, refreshHolder])

  const onLookupSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = lookupInput.trim()
    if (!BASE58.test(trimmed)) {
      toast({ state: 'failed', text: 'Enter a valid Solana wallet address.' })
      return
    }
    setInspectedWallet(trimmed)
  }

  const onClaim = async () => {
    if (!w.address) return
    setStage('building')
    try {
      const tx = await claimRedemptionSol(w.address, setStage, fixture)
      play('verified')
      toast({
        state: 'settled',
        text: 'SOL claimed.',
        ...(tx.signature ? { href: explorerUrl('tx', tx.signature), hrefLabel: 'Explorer' } : {}),
      })
      await Promise.all([refreshSummary(), refreshHolder(w.address)])
    } catch (e) {
      play('failed')
      toast({ state: 'failed', text: errorMessage(e) })
    } finally {
      setStage(null)
    }
  }

  const canSign = Boolean(w.address && holder && holder.wallet === w.address)
  const redeemableTokens = BigInt(holder?.redeemableNowRaw ?? '0')
  const redeemableLamports = BigInt(holder?.redeemableNowLamports ?? '0')
  const poolConfigured = BigInt(summary?.poolLamports ?? '0') > 0n

  return (
    <div className="container page">
      <div className="page-head">
        <div>
          <h1 className="t-h1">Holder SOL Claim</h1>
          <p className="t-small">
            Send snapshot-eligible VOYNICH tokens and receive your proportional share of SOL in one atomic transaction.
          </p>
        </div>
        <WalletButton />
      </div>

      {summaryError ? (
        <Failed message={summaryError} retry={<button type="button" className="btn" data-size="s" onClick={() => void refreshSummary()}>Try again</button>} />
      ) : !summary ? (
        <div className="panel"><div className="panel-body"><Loading rows={3} label="Loading snapshot record" /></div></div>
      ) : (
        <div className={`grid ${s.layout}`}>
          <div className={s.main}>
            <section className="panel">
              <div className="panel-head">
                <h2>Your snapshot & claim</h2>
                <span className={summary.open ? 'ochre mono' : 'dim mono'}>
                  {summary.open ? 'Claims open' : 'Snapshot recorded'}
                </span>
              </div>
              <div className="panel-body">
                {!w.address ? (
                  <form className={s.lookup} onSubmit={onLookupSubmit}>
                    <div className="field">
                      <label htmlFor="claim-wallet-input">Check any wallet address, or connect above to claim</label>
                      <div className={s.lookupRow}>
                        <input
                          id="claim-wallet-input"
                          className="input mono"
                          placeholder="Solana wallet address"
                          value={lookupInput}
                          onChange={(e) => setLookupInput(e.target.value)}
                        />
                        <button type="submit" className="btn">Check snapshot</button>
                      </div>
                    </div>
                  </form>
                ) : null}

                {holderLoading ? (
                  <Loading rows={4} label="Checking snapshot allocation" />
                ) : holderError ? (
                  <Failed
                    message={holderError}
                    retry={
                      activeWallet ? (
                        <button type="button" className="btn" data-size="s" onClick={() => void refreshHolder(activeWallet)}>
                          Try again
                        </button>
                      ) : undefined
                    }
                  />
                ) : holder ? (
                  <div className={s.holderBox}>
                    <div className={s.statsRow}>
                      <Stat label="Snapshot balance" note={`Slot ${holder.snapshotSlot.toLocaleString('en-US')}`}>
                        <span className="t-fig t-fig-m">
                          {formatVoynich(holder.snapshotRaw)}
                          <span className="unit">VOYNICH</span>
                        </span>
                      </Stat>
                      <Stat label="Pool share" note="Of snapshot holder supply">
                        <span className="t-fig t-fig-m">
                          {holder.sharePct}
                          <span className="unit">%</span>
                        </span>
                      </Stat>
                      <Stat
                        label="Redeemable now"
                        note={poolConfigured ? `Sending ${formatVoynich(holder.redeemableNowRaw)} VOYNICH` : 'SOL pool finalizing'}
                      >
                        <span className="t-fig t-fig-m ochre">
                          {poolConfigured ? formatSol(holder.redeemableNowLamports) : 'Pending'}
                          {poolConfigured ? <span className="unit">SOL</span> : null}
                        </span>
                      </Stat>
                    </div>

                    <dl className="kv">
                      <dt>Wallet</dt>
                      <dd><Hash value={holder.wallet} chars={8} label="wallet address" /></dd>
                      <dt>Current wallet balance</dt>
                      <dd className="mono">{formatVoynich(holder.liveBalanceRaw)} <span className="unit">VOYNICH</span></dd>
                      <dt>Already claimed</dt>
                      <dd className="mono">
                        {formatVoynich(holder.claimedTokensRaw)} <span className="unit">VOYNICH</span>
                        {BigInt(holder.claimedLamports) > 0n ? (
                          <> ({formatSol(holder.claimedLamports)} <span className="unit">SOL</span>)</>
                        ) : null}
                      </dd>
                      <dt>Remaining snapshot cap</dt>
                      <dd className="mono">{formatVoynich(holder.remainingSnapshotRaw)} <span className="unit">VOYNICH</span></dd>
                      {holder.lastSignature ? (
                        <>
                          <dt>Claim transaction</dt>
                          <dd><Explorer kind="tx" id={holder.lastSignature} /></dd>
                        </>
                      ) : null}
                    </dl>

                    <div className={s.actionBar}>
                      {!holder.eligible ? (
                        <p className="t-small dim">This wallet held 0 VOYNICH at snapshot slot {holder.snapshotSlot.toLocaleString('en-US')}.</p>
                      ) : BigInt(holder.remainingSnapshotRaw) === 0n ? (
                        <p className="t-small ochre">Full snapshot allocation claimed.</p>
                      ) : redeemableTokens === 0n ? (
                        <p className="t-small dim">Hold VOYNICH in this wallet to redeem your remaining snapshot cap.</p>
                      ) : !canSign ? (
                        <p className="t-small dim">Connect wallet <span className="mono">{holder.wallet.slice(0, 6)}...</span> above to sign and claim.</p>
                      ) : !summary.open ? (
                        <button type="button" className="btn" disabled>
                          Claim window opening shortly
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn"
                          data-kind="primary"
                          data-pending={stage !== null || undefined}
                          disabled={stage !== null || redeemableLamports <= 0n}
                          onClick={() => void onClaim()}
                        >
                          {stage === 'building'
                            ? 'Building swap...'
                            : stage === 'signing'
                              ? 'Confirm in wallet...'
                              : stage === 'confirming'
                                ? 'Confirming on Solana...'
                                : `Send ${formatVoynich(holder.redeemableNowRaw)} VOYNICH & claim ${formatSol(holder.redeemableNowLamports)} SOL`}
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="t-small dim">Connect your wallet or enter an address above to inspect its recorded snapshot balance.</p>
                )}
              </div>
            </section>
          </div>

          <aside className={s.side}>
            <section className="panel">
              <div className="panel-head">
                <h2>Snapshot proof</h2>
              </div>
              <div className="panel-body">
                <dl className="kv">
                  <dt>Token mint</dt>
                  <dd><Hash value={summary.mint} chars={6} label="VOYNICH mint" /></dd>
                  <dt>Snapshot slot</dt>
                  <dd className="mono">{summary.snapshotSlot.toLocaleString('en-US')}</dd>
                  <dt>Captured (UTC)</dt>
                  <dd className="mono">{summary.snapshotTimestampUtc.replace('T', ' ').replace('.000Z', ' UTC')}</dd>
                  <dt>Eligible holders</dt>
                  <dd className="mono">{summary.totalHolders.toLocaleString('en-US')}</dd>
                  <dt>Snapshot supply</dt>
                  <dd className="mono">{formatVoynich(summary.totalEligibleRaw)} <span className="unit">VOYNICH</span></dd>
                  {poolConfigured ? (
                    <>
                      <dt>Total SOL pool</dt>
                      <dd className="mono">{formatSol(summary.poolLamports)} <span className="unit">SOL</span></dd>
                      <dt>Claimed so far</dt>
                      <dd className="mono">
                        {formatSol(summary.claimedLamports)} <span className="unit">SOL</span> ({summary.claimsCount})
                      </dd>
                    </>
                  ) : null}
                  {summary.vaultAddress ? (
                    <>
                      <dt>Redemption vault</dt>
                      <dd><Hash value={summary.vaultAddress} chars={6} label="redemption vault" /></dd>
                    </>
                  ) : null}
                  <dt>Snapshot SHA-256</dt>
                  <dd><Hash value={summary.snapshotSha256} chars={6} label="snapshot sha256" /></dd>
                </dl>
              </div>
            </section>
          </aside>
        </div>
      )}
    </div>
  )
}
