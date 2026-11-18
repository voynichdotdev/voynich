// Unsigned v0 transactions the server builds for a wallet to sign: compute budget first, a limit
// measured by simulation, a size that leaves room for the guards the wallet appends, and a
// simulation that passes before anything is handed out.

import { ComputeBudgetProgram, PublicKey, TransactionMessage, VersionedTransaction, type AddressLookupTableAccount, type Connection, type TransactionInstruction } from '@solana/web3.js'
import { InsufficientFundsError, TxError, failureFromLogs, insufficientFundsOutcome, type ErrorRegistry } from './failure.js'
import { waitForLookupTables } from './lookup-tables.js'
import { priorityFeeLamports } from './priority-fee.js'

export const PACKET_BYTES = 1232
export const MAX_COMPUTE_UNITS = 1_400_000
/** Room for what a wallet appends when it signs (Phantom: ComputeBudget + Lighthouse guards, 100+ bytes). */
export const WALLET_GUARD_BYTES = 128
/** Compute the wallet's Lighthouse guards use (a local rewrite measured about 3,000); wallets keep the dapp's limit. */
export const WALLET_GUARD_UNITS = 4_000

export type BuildInput = {
  connection: Connection
  payer: PublicKey
  instructions: readonly TransactionInstruction[]
  lookupTables?: readonly AddressLookupTableAccount[]
  /** compute-unit price; see priority-fee.ts */
  microLamports?: bigint
  /** keys besides the payer that must sign (a vanity mint the server co-signs after the wallet) */
  cosigners?: readonly PublicKey[]
  /** false for transactions the server signs itself (keepers): no guard bytes or units reserved */
  walletSigned?: boolean
  /** a fixed limit instead of measuring one */
  computeUnitLimit?: number
  registry?: ErrorRegistry
  /** Native spend by the payer, excluding the network fee (rent, escrow, upload funding). */
  requiredLamports?: bigint
}

export type UnsignedBuild = {
  transaction: VersionedTransaction
  transactionBase64: string
  blockhash: string
  lastValidBlockHeight: number
  /** the slot the build read at; later reads use it as minContextSlot */
  contextSlot: number
  computeUnitLimit: number
  microLamports: bigint
  unitsConsumed: number
  wireBytes: number
  lookupTables: string[]
}

export function wireSize(tx: VersionedTransaction): number {
  try {
    return tx.serialize().length
  } catch (e) {
    if (e instanceof RangeError) return Infinity
    throw e
  }
}

export async function buildUnsignedV0(input: BuildInput): Promise<UnsignedBuild> {
  const { connection, payer, lookupTables = [], microLamports = 0n, cosigners = [], walletSigned = true, registry } = input
  // Callers' own budget instructions are replaced, never stacked.
  const instructions = input.instructions.filter((ix) => !ix.programId.equals(ComputeBudgetProgram.programId))
  await waitForLookupTables(connection, lookupTables)
  const latest = await connection.getLatestBlockhashAndContext('confirmed')

  const compile = (units: number, price: bigint) =>
    new VersionedTransaction(
      new TransactionMessage({
        payerKey: payer,
        recentBlockhash: latest.value.blockhash,
        instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: price }), ...instructions],
      }).compileToV0Message([...lookupTables]),
    )

  const simulate = async (tx: VersionedTransaction) => {
    const { value } = await connection.simulateTransaction(tx, { sigVerify: false, commitment: 'confirmed', minContextSlot: latest.context.slot })
    if (value.err) {
      const rentFailure = typeof value.err === 'object' && 'InsufficientFundsForRent' in value.err
        ? value.err.InsufficientFundsForRent as { account_index: number } : null
      if (insufficientFundsOutcome(value.err, value.logs) && (!rentFailure || rentFailure.account_index === 0)) {
        const [fee, balance] = await Promise.all([connection.getFeeForMessage(tx.message, 'confirmed'), connection.getBalance(payer, 'confirmed')])
        if (fee.value === null) throw new TxError('build', 'The RPC did not return the transaction fee.')
        const spend = (input.requiredLamports ?? 0n) + BigInt(fee.value)
        const rentMinimum = BigInt(await connection.getMinimumBalanceForRentExemption(0))
        const payerMinimum = BigInt(fee.value) + rentMinimum
        const required = rentFailure ? spend + rentMinimum : spend > payerMinimum ? spend : payerMinimum
        if (BigInt(balance) < required) throw new InsufficientFundsError(null, required, BigInt(balance))
      }
      throw failureFromLogs('simulation', value.logs, registry)
    }
    if (value.unitsConsumed === undefined) throw new TxError('simulation', 'The RPC did not report compute usage.')
    return value.unitsConsumed
  }

  // Probe without a priority fee, so its generous ceiling can't reject a payer who can afford
  // the measured final transaction.
  const probe = compile(input.computeUnitLimit ?? MAX_COMPUTE_UNITS, 0n)
  const maximum = PACKET_BYTES - (walletSigned ? WALLET_GUARD_BYTES : 0)
  const probeBytes = wireSize(probe)
  if (probeBytes > maximum)
    throw new TxError('build', `The transaction is ${Number.isFinite(probeBytes) ? probeBytes : 'over ' + PACKET_BYTES} bytes; the limit with room for wallet guards is ${maximum}. Extend the lookup table or split the action.`, { retryable: false })

  const expectedSigners = [payer, ...cosigners].map((k) => k.toBase58()).sort()
  const signers = probe.message.staticAccountKeys.slice(0, probe.message.header.numRequiredSignatures).map((k) => k.toBase58()).sort()
  if (signers.join() !== expectedSigners.join()) throw new TxError('build', `Unexpected signers: ${signers.join(', ')}.`, { retryable: false })

  const measured = await simulate(probe)
  const computeUnitLimit =
    input.computeUnitLimit ?? Math.min(MAX_COMPUTE_UNITS, Math.ceil((measured + (walletSigned ? WALLET_GUARD_UNITS : 0)) * 1.2) + 10_000)
  const transaction = compile(computeUnitLimit, microLamports)
  const unitsConsumed = await simulate(transaction)
  const bytes = transaction.serialize()
  return {
    transaction,
    transactionBase64: Buffer.from(bytes).toString('base64'),
    blockhash: latest.value.blockhash,
    lastValidBlockHeight: latest.value.lastValidBlockHeight,
    contextSlot: latest.context.slot,
    computeUnitLimit,
    microLamports,
    unitsConsumed,
    wireBytes: bytes.length,
    lookupTables: lookupTables.map((t) => t.key.toBase58()),
  }
}

/** The exact network fee of a build, split into base and priority parts. */
export async function networkFee(connection: Connection, build: UnsignedBuild): Promise<{ total: bigint; base: bigint; priority: bigint }> {
  const fee = (await connection.getFeeForMessage(build.transaction.message, 'confirmed')).value
  if (fee === null) throw new TxError('build', 'The RPC did not return the transaction fee.')
  const priority = priorityFeeLamports(build.computeUnitLimit, build.microLamports)
  return { total: BigInt(fee), base: BigInt(fee) - priority, priority }
}

/** A placeholder blockhash for size checks: every blockhash serializes to the same 32 bytes. */
export const SIZE_CHECK_BLOCKHASH = PublicKey.default.toBase58()
