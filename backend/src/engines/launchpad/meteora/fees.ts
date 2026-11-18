// Trading fees on both venues. A DBC pool books creator fees only until it migrates; after that
// they accrue to the creator's permanently locked DAMM v2 position, whose NFT the creator holds.
// Whatever routes "the creator's fees" reads and claims both, and moving the creator role on the
// old pool does not move the position NFT.

import type { PublicKey, TransactionInstruction } from '@solana/web3.js'
import { DynamicBondingCurveIdl } from '@meteora-ag/dynamic-bonding-curve-sdk'
import { CpAmmIdl, getUnClaimLpFee } from '@meteora-ag/cp-amm-sdk'
import { dbcMints, type Dbc } from './dbc.js'
import { dammAccounts, dammMints, type Damm } from './damm.js'
import { claimAccounts, onlyProgram, ownedBy, withTokenAccounts, withoutComputeBudget } from './instructions.js'
import { U64_MAX, big, bn } from './math.js'
import { DAMM_V2_PROGRAM_ID, DBC_PROGRAM_ID } from './pdas.js'

export type Position = { pool: PublicKey; position: PublicKey; positionNftAccount: PublicKey }

/**
 * Positions `owner` holds on `pool`, found by the position NFT it holds. A migrated position
 * marked permanently locked can still carry a dust unit of unlocked liquidity from rounding, so a
 * search for "no unlocked liquidity" misses it; the NFT does not.
 */
export async function positionsOf(damm: Damm, pool: PublicKey, owner: PublicKey): Promise<Position[]> {
  const held = await damm.amm.getUserPositionByPool(pool, owner)
  return held.map((p) => ({ pool, position: p.position, positionNftAccount: p.positionNftAccount }))
}

export type FeeAmounts = { base: bigint; quote: bigint }

/** Unclaimed creator fees: what the curve still books, and what the creator's positions have accrued. */
export async function creatorFeeAmounts(dbc: Dbc, damm: Damm, args: { dbcPool: PublicKey; creator: PublicKey; dammPool?: PublicKey }) {
  const snap = await dbc.snapshot(args.dbcPool)
  const curve: FeeAmounts = { base: big(snap.pool.poolState.creatorBaseFee), quote: big(snap.pool.poolState.creatorQuoteFee) }
  const positions: FeeAmounts = { base: 0n, quote: 0n }
  if (args.dammPool) {
    const [state, held] = await Promise.all([damm.pool(args.dammPool), positionsOf(damm, args.dammPool, args.creator)])
    const baseIsA = state.tokenAMint.equals(snap.pool.poolState.baseMint)
    for (const p of held) {
      const fees = getUnClaimLpFee(state, await damm.amm.fetchPositionState(p.position))
      positions.base += big(baseIsA ? fees.feeTokenA : fees.feeTokenB)
      positions.quote += big(baseIsA ? fees.feeTokenB : fees.feeTokenA)
    }
  }
  return { curve, positions }
}

/**
 * Every claim for a creator who signs at top level: the curve's booked fees, then each held
 * position's. Each batch opens its token accounts again, since the batch before closed WSOL.
 */
export async function creatorFeeClaims(
  dbc: Dbc,
  damm: Damm,
  args: { creator: PublicKey; dbcPool: PublicKey; dammPool?: PublicKey; payer?: PublicKey; receiver?: PublicKey },
): Promise<TransactionInstruction[]> {
  const { creator, payer = creator, receiver = creator } = args
  const snap = await dbc.snapshot(args.dbcPool)
  const curve = await dbc.client.creator.claimCreatorTradingFee2({ creator, payer, receiver, pool: args.dbcPool, maxBaseAmount: bn(U64_MAX), maxQuoteAmount: bn(U64_MAX) })
  const out = withTokenAccounts(withoutComputeBudget(curve.instructions), payer, claimAccounts(creator, receiver, dbcMints(snap)))
  if (!args.dammPool) return out
  const state = await damm.pool(args.dammPool)
  for (const p of await positionsOf(damm, args.dammPool, creator)) {
    const tx = await damm.amm.claimPositionFee2({ owner: creator, feePayer: payer, receiver, pool: args.dammPool, position: p.position, positionNftAccount: p.positionNftAccount, ...dammAccounts(state) })
    out.push(...withTokenAccounts(withoutComputeBudget(tx.instructions), payer, claimAccounts(creator, receiver, dammMints(state))))
  }
  return out
}

// Where each claim layout puts its destination token accounts, read from the IDLs by name.
type IdlView = { instructions: readonly { discriminator: readonly number[]; accounts: readonly { name: string }[] }[] }
const LAYOUTS: { program: PublicKey; idl: IdlView }[] = [
  { program: DBC_PROGRAM_ID, idl: DynamicBondingCurveIdl },
  { program: DAMM_V2_PROGRAM_ID, idl: CpAmmIdl },
]

/** The two token accounts a DBC or DAMM v2 fee claim pays into. */
export function claimDestinations(claim: TransactionInstruction): [PublicKey, PublicKey] {
  const layout = LAYOUTS.find((l) => l.program.equals(claim.programId))
  const ix = layout?.idl.instructions.find((i) => i.discriminator.every((b, n) => claim.data[n] === b))
  const a = ix?.accounts.findIndex((acc) => acc.name === 'token_a_account') ?? -1
  const b = ix?.accounts.findIndex((acc) => acc.name === 'token_b_account') ?? -1
  if (a < 0 || b < 0) throw new Error('Not a DBC or DAMM v2 fee claim.')
  const ka = claim.keys[a], kb = claim.keys[b]
  if (!ka || !kb) throw new Error('The fee claim has fewer accounts than its IDL.')
  return [ka.pubkey, kb.pubkey]
}

export type VenueClaim = { instruction: TransactionInstruction; destinations: [PublicKey, PublicKey] }

/**
 * Partner (fee claimer) claims on one venue, as bare venue instructions. A claimer that is a
 * program PDA wraps each into its own program's CPI, passing the claim's metas with the signer
 * flag cleared and signing with its seeds; `setup` opens the claimer's token accounts first,
 * paid by `payer`, since a PDA cannot pay at top level.
 */
export async function partnerFeeClaims(
  dbc: Dbc,
  damm: Damm,
  args: { feeClaimer: PublicKey; payer: PublicKey; venue: 'dbc' | 'damm-v2'; pool: PublicKey },
): Promise<{ setup: TransactionInstruction[]; claims: VenueClaim[] }> {
  const { feeClaimer, payer } = args
  const claims: TransactionInstruction[] = []
  let setup: TransactionInstruction[]
  if (args.venue === 'dbc') {
    const snap = await dbc.snapshot(args.pool)
    const tx = await dbc.client.partner.claimPartnerTradingFee({ feeClaimer, payer, pool: args.pool, maxBaseAmount: bn(U64_MAX), maxQuoteAmount: bn(U64_MAX) })
    claims.push(...onlyProgram(tx.instructions, DBC_PROGRAM_ID))
    setup = withTokenAccounts([], payer, ownedBy(feeClaimer, dbcMints(snap)))
  } else {
    const state = await damm.pool(args.pool)
    for (const p of await positionsOf(damm, args.pool, feeClaimer)) {
      const tx = await damm.amm.claimPositionFee({ owner: feeClaimer, feePayer: payer, pool: args.pool, position: p.position, positionNftAccount: p.positionNftAccount, ...dammAccounts(state) })
      claims.push(...onlyProgram(tx.instructions, DAMM_V2_PROGRAM_ID))
    }
    setup = withTokenAccounts([], payer, ownedBy(feeClaimer, dammMints(state)))
  }
  return { setup, claims: claims.map((instruction) => ({ instruction, destinations: claimDestinations(instruction) })) }
}
