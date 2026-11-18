// The server side of "the wallet signs, the server sends": take the wallet's signed copy, check
// it, add the server's co-signature when the build needs one, and simulate the exact bytes that
// will go out. The wallet always signs first; the server's signature goes on the copy it returns.
//
// Persist the returned bytes before broadcasting them (journal first, then send.ts): the same
// signed bytes have one signature and can land only once, so a crash after sending is recovered
// by reading that signature, never by building again.

import { VersionedTransaction, type AddressLookupTableAccount, type Connection, type Keypair, type PublicKey, type TransactionInstruction } from '@solana/web3.js'
import { signatureOf } from './ed25519.js'
import { TxError, failureFromLogs, type ErrorRegistry } from './failure.js'
import { PACKET_BYTES } from './build.js'
import { loadLookupTables } from './lookup-tables.js'
import { acceptWalletSigned, assertCosignable, decompile } from './wallet-copy.js'

export type RelayInput = {
  connection: Connection
  payer: PublicKey
  signedTransactionBase64: string
  /** the build as handed to the wallet */
  original: { transactionBase64: string; instructions?: readonly TransactionInstruction[] }
  /** the program the action is about; its instruction must survive the wallet */
  requiredProgram: PublicKey
  allowedPrograms?: readonly PublicKey[]
  /** the server's key that signs after the wallet, if the build needs one */
  cosigner?: Keypair
  registry?: ErrorRegistry
}

export type PreparedRelay = { bytes: Uint8Array; signature: string; transaction: VersionedTransaction }

async function tablesOf(connection: Connection, tx: VersionedTransaction): Promise<AddressLookupTableAccount[]> {
  try {
    return await loadLookupTables(connection, tx.message.addressTableLookups.map((l) => l.accountKey))
  } catch {
    throw new TxError('wallet-changed', 'A lookup table in the signed transaction is unavailable.', { retryable: false })
  }
}

export async function prepareRelay(input: RelayInput): Promise<PreparedRelay> {
  const { connection, payer } = input
  const raw = Buffer.from(input.signedTransactionBase64, 'base64')
  if (raw.length > PACKET_BYTES) throw new TxError('wallet-changed', 'The signed transaction is larger than a packet.', { retryable: false })
  let signed: VersionedTransaction
  try {
    signed = VersionedTransaction.deserialize(raw)
  } catch {
    throw new TxError('wallet-changed', 'The wallet returned bytes that are not a transaction.', { retryable: false })
  }
  const signedTables = await tablesOf(connection, signed)
  const original = VersionedTransaction.deserialize(Buffer.from(input.original.transactionBase64, 'base64'))
  const originalTables = await tablesOf(connection, original)

  if (input.cosigner) {
    assertCosignable({ original, signed, originalTables, signedTables, payer, cosigner: input.cosigner.publicKey })
    signed.sign([input.cosigner])
  } else {
    acceptWalletSigned({ signed, payer, tables: signedTables, requiredProgram: input.requiredProgram, allowedPrograms: input.allowedPrograms, built: input.original.instructions ?? decompile(original, originalTables) })
  }

  const { value } = await connection.simulateTransaction(signed, { sigVerify: true, commitment: 'confirmed' })
  if (value.err) throw failureFromLogs('simulation', value.logs, input.registry)
  return { bytes: signed.serialize(), signature: signatureOf(signed), transaction: signed }
}
