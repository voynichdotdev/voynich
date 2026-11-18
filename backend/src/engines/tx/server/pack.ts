// Fitting as many items as one transaction holds (fee claims, payouts, proofs), in order.

import { ComputeBudgetProgram, TransactionMessage, VersionedTransaction, type AddressLookupTableAccount, type PublicKey, type TransactionInstruction } from '@solana/web3.js'
import { PACKET_BYTES, SIZE_CHECK_BLOCKHASH, WALLET_GUARD_BYTES, wireSize } from './build.js'

export type PackOptions = {
  payer: PublicKey
  lookupTables?: readonly AddressLookupTableAccount[]
  /** reserve room for wallet guards (true for anything a wallet signs) */
  walletSigned?: boolean
  /** instructions that always close the transaction (closing WSOL, say), given what was included */
  tail?: (included: number) => TransactionInstruction[]
}

/** Whether these instructions, with a compute budget, fit one wallet-safe transaction. */
export function fits(instructions: readonly TransactionInstruction[], options: PackOptions): boolean {
  const budget = [ComputeBudgetProgram.setComputeUnitLimit({ units: 1 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 })]
  let tx: VersionedTransaction
  try {
    tx = new VersionedTransaction(
      new TransactionMessage({ payerKey: options.payer, recentBlockhash: SIZE_CHECK_BLOCKHASH, instructions: [...budget, ...instructions] }).compileToV0Message([...(options.lookupTables ?? [])]),
    )
  } catch (e) {
    if (e instanceof RangeError) return false // more than 256 accounts or an oversized index
    throw e
  }
  return wireSize(tx) <= PACKET_BYTES - (options.walletSigned === false ? 0 : WALLET_GUARD_BYTES)
}

/**
 * Takes items in order while they fit; returns the instructions and how many items they cover.
 * The caller builds the rest in the next transaction.
 */
export function pack<T>(items: readonly T[], toInstructions: (item: T) => TransactionInstruction[], options: PackOptions): { instructions: TransactionInstruction[]; count: number } {
  const body: TransactionInstruction[] = []
  let count = 0
  for (const item of items) {
    const next = [...body, ...toInstructions(item)]
    if (!fits([...next, ...(options.tail?.(count + 1) ?? [])], options)) break
    body.splice(0, body.length, ...next)
    count++
  }
  return { instructions: [...body, ...(count ? options.tail?.(count) ?? [] : [])], count }
}
