// A compute-unit price for a transaction, from what recently landed on the accounts it writes.

import type { Connection, PublicKey, TransactionInstruction } from '@solana/web3.js'

export type PriorityFeeOptions = {
  /** percentile of recent fees to pay, 0–1 */
  percentile?: number
  /** ceiling in micro-lamports per compute unit */
  maxMicroLamports?: bigint
  /** used when the RPC has no samples or fails */
  fallbackMicroLamports?: bigint
}

/** The writable accounts of a set of instructions, deduplicated (the RPC takes at most 128). */
export function writableAccounts(instructions: readonly TransactionInstruction[]): PublicKey[] {
  const out = new Map<string, PublicKey>()
  for (const ix of instructions) for (const k of ix.keys) if (k.isWritable) out.set(k.pubkey.toBase58(), k.pubkey)
  return [...out.values()].slice(0, 128)
}

/** The given percentile of recent prioritization fees over the accounts this transaction locks. */
export async function recentPriorityFee(connection: Connection, instructions: readonly TransactionInstruction[], options: PriorityFeeOptions = {}): Promise<bigint> {
  const { percentile = 0.75, maxMicroLamports = 1_000_000n, fallbackMicroLamports = 1n } = options
  try {
    const fees = (await connection.getRecentPrioritizationFees({ lockedWritableAccounts: writableAccounts(instructions) }))
      .map((f) => BigInt(f.prioritizationFee))
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    if (!fees.length) return fallbackMicroLamports
    const pick = fees[Math.min(fees.length - 1, Math.floor(fees.length * percentile))]
    const price = pick !== undefined && pick > 0n ? pick : fallbackMicroLamports
    return price > maxMicroLamports ? maxMicroLamports : price
  } catch {
    return fallbackMicroLamports
  }
}

/** Lamports the priority fee costs at a given limit and price (rounded up, as the runtime does). */
export const priorityFeeLamports = (computeUnitLimit: number, microLamports: bigint) => (BigInt(computeUnitLimit) * microLamports + 999_999n) / 1_000_000n
