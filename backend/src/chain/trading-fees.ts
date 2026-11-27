// Claiming creator trading fees from Meteora DBC and graduated DAMM v2 pools, and routing
// the configured basis-points share into the buyback pool.

import { getUnClaimLpFee } from '@meteora-ag/cp-amm-sdk'
import { NATIVE_MINT } from '@solana/spl-token'
import { PublicKey, type TransactionInstruction } from '@solana/web3.js'
import { dammAccounts, dammMints, type Damm } from '../engines/launchpad/meteora/damm.js'
import type { Dbc } from '../engines/launchpad/meteora/dbc.js'
import { positionsOf } from '../engines/launchpad/meteora/fees.js'
import { claimAccounts, withTokenAccounts, withoutComputeBudget } from '../engines/launchpad/meteora/instructions.js'
import { big } from '../engines/launchpad/meteora/math.js'

const WSOL_MINT = NATIVE_MINT.toBase58()

export type TokenBalanceSnapshot = {
  mint: string
  owner?: string
  uiTokenAmount: { amount: string }
}

export type ClaimTxMeta = {
  fee?: number | null
  preBalances: readonly number[]
  postBalances: readonly number[]
  preTokenBalances?: readonly TokenBalanceSnapshot[] | null
  postTokenBalances?: readonly TokenBalanceSnapshot[] | null
  loadedAddresses?: {
    writable?: readonly { toBase58(): string }[]
    readonly?: readonly { toBase58(): string }[]
  } | null
}

export type ClaimedBalances = {
  claimedSol: bigint
  claimedBase: bigint
}

export type ProtocolPaymentSum = {
  mint: string | null
  amount: bigint
}

/** Integer basis-points share of a claimed amount, rounded down. */
export function buybackShareOf(claimed: bigint, bps: number): bigint {
  if (claimed <= 0n || bps <= 0) return 0n
  return (claimed * BigInt(bps)) / 10_000n
}

/**
 * Computes the exact creator-fee slice corresponding to `targetVolumePpm` (e.g. 5,000 ppm = 0.50%
 * of swap volume) out of a net creator payout whose gross rate is `grossCreatorRatePpm` and whose
 * protocol cut on collect is `protocolShareRatePpm` (both in parts per 1,000,000).
 */
export function creatorVolumeShareOf(
  claimedNet: bigint,
  grossCreatorRatePpm: bigint,
  protocolShareRatePpm: bigint,
  targetVolumePpm: bigint,
): { buybackAmount: bigint; effectiveBps: number } {
  if (claimedNet <= 0n || targetVolumePpm <= 0n || grossCreatorRatePpm <= 0n || protocolShareRatePpm >= 1_000_000n) {
    return { buybackAmount: 0n, effectiveBps: 0 }
  }
  const netRatePpt = grossCreatorRatePpm * (1_000_000n - protocolShareRatePpm)
  const targetRatePpt = targetVolumePpm * 1_000_000n
  if (netRatePpt <= 0n) return { buybackAmount: 0n, effectiveBps: 0 }
  if (netRatePpt <= targetRatePpt) {
    return { buybackAmount: claimedNet, effectiveBps: 10_000 }
  }
  const buybackAmount = (claimedNet * targetRatePpt) / netRatePpt
  const effectiveBps = Number((targetRatePpt * 10_000n + netRatePpt / 2n) / netRatePpt)
  return { buybackAmount, effectiveBps }
}

/** Deducts claim + swap/burn network fee allowance from the creator buyback share so existing wallet SOL is untouched. */
export function creatorBuybackAfterGas(shareLamports: bigint, claimFeeLamports: bigint, extraGasLamports = 45_000n): bigint {
  const allowance = (claimFeeLamports > 0n ? claimFeeLamports : 5_000n) + extraGasLamports
  return shareLamports > allowance ? shareLamports - allowance : 0n
}

/**
 * Extracts exact net WSOL (unwrapped to SOL) and base tokens received by `creatorBase58` in a
 * LaunchLab `claim_creator_fee` or Raydium CPMM `collect_creator_fee` transaction. Summing native
 * balances across `{creator, creatorWsolAta, creatorBaseAta}` makes ATA creation rent and WSOL
 * unwrap of pre-existing balances cancel identically while excluding Raydium's protocol fee share.
 */
export function parseCreatorClaimedBalances(
  meta: ClaimTxMeta,
  creatorBase58: string,
  creatorWsolAtaBase58: string,
  creatorBaseAtaBase58: string,
  outputMintBase58: string,
  staticAccountKeys: readonly string[],
): ClaimedBalances {
  const allKeys = [
    ...staticAccountKeys,
    ...(meta.loadedAddresses?.writable?.map(k => k.toBase58()) ?? []),
    ...(meta.loadedAddresses?.readonly?.map(k => k.toBase58()) ?? []),
  ]
  const owned = new Set([creatorBase58, creatorWsolAtaBase58, creatorBaseAtaBase58])
  let preOwned = 0n
  let postOwned = 0n
  for (let i = 0; i < allKeys.length; i++) {
    if (!owned.has(allKeys[i]!)) continue
    if (i < meta.preBalances.length) preOwned += BigInt(meta.preBalances[i]!)
    if (i < meta.postBalances.length) postOwned += BigInt(meta.postBalances[i]!)
  }
  const fee = allKeys[0] === creatorBase58 ? BigInt(meta.fee ?? 0) : 0n
  const netDelta = postOwned - preOwned + fee
  const claimedSol = netDelta > 0n ? netDelta : 0n

  const isCreatorBase = (row: TokenBalanceSnapshot) => row.mint === outputMintBase58 && row.owner === creatorBase58
  const baseDelta = sumTokenAmounts(meta.postTokenBalances, isCreatorBase) - sumTokenAmounts(meta.preTokenBalances, isCreatorBase)
  return {
    claimedSol,
    claimedBase: baseDelta > 0n ? baseDelta : 0n,
  }
}

function sumTokenAmounts(
  rows: readonly TokenBalanceSnapshot[] | null | undefined,
  predicate: (row: TokenBalanceSnapshot) => boolean,
): bigint {
  let total = 0n
  for (const row of rows ?? []) {
    if (predicate(row)) total += BigInt(row.uiTokenAmount.amount)
  }
  return total
}

/**
 * Extracts exact claimed SOL and base tokens from a settled Meteora claim transaction.
 * WSOL outflow from non-fee-recipient pool vaults excludes fee-payer rent/priority costs.
 */
export function parseClaimedBalances(
  meta: ClaimTxMeta,
  feeRecipientBase58: string,
  outputMintBase58: string,
  staticAccountKeys: readonly string[],
): ClaimedBalances {
  const isVaultWsol = (row: TokenBalanceSnapshot) => row.mint === WSOL_MINT && row.owner !== feeRecipientBase58
  const vaultOutflow = sumTokenAmounts(meta.preTokenBalances, isVaultWsol) - sumTokenAmounts(meta.postTokenBalances, isVaultWsol)

  let claimedSol = vaultOutflow > 0n ? vaultOutflow : 0n
  if (claimedSol <= 0n) {
    const recipientIndex = staticAccountKeys.indexOf(feeRecipientBase58)
    if (recipientIndex >= 0 && recipientIndex < meta.preBalances.length && recipientIndex < meta.postBalances.length) {
      const fee = recipientIndex === 0 ? BigInt(meta.fee ?? 0) : 0n
      const delta = BigInt(meta.postBalances[recipientIndex]!) - BigInt(meta.preBalances[recipientIndex]!) + fee
      if (delta > 0n) claimedSol = delta
    }
  }

  const isRecipientBase = (row: TokenBalanceSnapshot) => row.mint === outputMintBase58 && row.owner === feeRecipientBase58
  const baseDelta = sumTokenAmounts(meta.postTokenBalances, isRecipientBase) - sumTokenAmounts(meta.preTokenBalances, isRecipientBase)
  return {
    claimedSol,
    claimedBase: baseDelta > 0n ? baseDelta : 0n,
  }
}

/** Merges Voynich protocol fee credits (per mint) with SOL buyback credits from claimed trading fees. */
export function combineBuybackCredits(
  protocolPayments: readonly ProtocolPaymentSum[],
  tradingFeeBuybackLamports: bigint,
): ProtocolPaymentSum[] {
  const byMint = new Map<string | null, bigint>()
  for (const row of protocolPayments) {
    if (row.amount <= 0n) continue
    byMint.set(row.mint, (byMint.get(row.mint) ?? 0n) + row.amount)
  }
  if (tradingFeeBuybackLamports > 0n) {
    byMint.set(null, (byMint.get(null) ?? 0n) + tradingFeeBuybackLamports)
  }
  return Array.from(byMint, ([mint, amount]) => ({ mint, amount }))
}

/** Builds instructions to claim all accrued trading fees for one DAMM v2 locked LP position. */
export async function dammPositionClaimInstructions(
  damm: Damm,
  args: { pool: PublicKey; position: PublicKey; creator: PublicKey },
): Promise<TransactionInstruction[]> {
  const [state, held] = await Promise.all([damm.pool(args.pool), positionsOf(damm, args.pool, args.creator)])
  const target = held.find(p => p.position.equals(args.position))
  if (!target) throw new Error(`No DAMM v2 position ${args.position.toBase58()} held by creator on pool ${args.pool.toBase58()}.`)
  const tx = await damm.amm.claimPositionFee2({
    owner: args.creator,
    feePayer: args.creator,
    receiver: args.creator,
    pool: args.pool,
    position: target.position,
    positionNftAccount: target.positionNftAccount,
    ...dammAccounts(state),
  })
  return withTokenAccounts(withoutComputeBudget(tx.instructions), args.creator, claimAccounts(args.creator, args.creator, dammMints(state)))
}

/** Finds the first DAMM v2 creator position whose unclaimed quote/base fees meet the threshold. */
export async function findClaimableDammPosition(
  dbc: Dbc,
  damm: Damm,
  args: { dbcPool: PublicKey; dammPool: PublicKey; creator: PublicKey; minLamports: bigint },
): Promise<PublicKey | null> {
  const [snap, state, held] = await Promise.all([
    dbc.snapshot(args.dbcPool),
    damm.pool(args.dammPool),
    positionsOf(damm, args.dammPool, args.creator),
  ])
  const baseIsA = state.tokenAMint.equals(snap.pool.poolState.baseMint)
  for (const p of held) {
    const fees = getUnClaimLpFee(state, await damm.amm.fetchPositionState(p.position))
    const baseOwed = big(baseIsA ? fees.feeTokenA : fees.feeTokenB)
    const quoteOwed = big(baseIsA ? fees.feeTokenB : fees.feeTokenA)
    if (quoteOwed >= args.minLamports || baseOwed > 0n) return p.position
  }
  return null
}
