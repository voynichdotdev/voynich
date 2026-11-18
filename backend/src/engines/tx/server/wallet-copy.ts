// Checking the copy a wallet signed before the server relays or co-signs it.
//
// Wallets rewrite what they sign (Phantom replaces the compute budget and appends Lighthouse
// guards), so the signed copy is never required to match the build byte for byte. The server
// checks only as far as its own authority reaches:
// - nothing to co-sign: the owner signed as fee payer and the action's program is still there;
// - a co-signature (vanity mint, partner key): the instructions that signature authorizes are
//   present and unchanged, compared by resolved address (never by lookup-table index or
//   position), and the co-signer appears in no other instruction except Lighthouse's.

import { ComputeBudgetProgram, PublicKey, SystemProgram, TransactionMessage, type AddressLookupTableAccount, type TransactionInstruction, type VersionedTransaction } from '@solana/web3.js'
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { hasValidSignature, isUnsigned, signerSlot } from './ed25519.js'
import { TxError } from './failure.js'

export const LIGHTHOUSE_PROGRAM_ID = new PublicKey('L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95')

const changed = (message: string) => new TxError('wallet-changed', message, { retryable: false })

export function decompile(tx: VersionedTransaction, tables: readonly AddressLookupTableAccount[]): TransactionInstruction[] {
  try {
    return TransactionMessage.decompile(tx.message, { addressLookupTableAccounts: [...tables] }).instructions
  } catch {
    throw changed('The signed transaction references accounts its lookup tables do not hold.')
  }
}

/** An instruction as resolved addresses, flags and data: equal when it authorizes the same thing. */
export const fingerprint = (ix: TransactionInstruction) =>
  JSON.stringify([ix.programId.toBase58(), ix.data.toString('base64'), ix.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable])])

function requirePayer(signed: VersionedTransaction, payer: PublicKey) {
  if (!signed.message.staticAccountKeys[0]?.equals(payer)) throw changed('The wallet changed the fee payer.')
  if (!hasValidSignature(signed, payer)) throw changed('The fee payer signature is missing or invalid.')
}

/**
 * A transaction no server key signs: accept the wallet's rewrite once the owner signed as fee
 * payer, the action's program is still there, and every program is one this action uses.
 * System and Token instructions pass only when they are the build's own (no added transfers).
 */
export function acceptWalletSigned(input: {
  signed: VersionedTransaction
  payer: PublicKey
  tables: readonly AddressLookupTableAccount[]
  requiredProgram: PublicKey
  /** programs the build itself uses besides the required one */
  allowedPrograms?: readonly PublicKey[]
  /** the build's instructions, to recognize its own System/Token instructions */
  built?: readonly TransactionInstruction[]
}): TransactionInstruction[] {
  requirePayer(input.signed, input.payer)
  const instructions = decompile(input.signed, input.tables)
  if (!instructions.some((ix) => ix.programId.equals(input.requiredProgram))) throw changed('The action instruction is missing from the signed transaction.')
  const moneyPrograms = [SystemProgram.programId, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]
  const free = new Set([input.requiredProgram, ComputeBudgetProgram.programId, ASSOCIATED_TOKEN_PROGRAM_ID, LIGHTHOUSE_PROGRAM_ID, ...(input.allowedPrograms ?? [])].map((p) => p.toBase58()))
  for (const p of moneyPrograms) free.delete(p.toBase58())
  const own = new Set((input.built ?? []).map(fingerprint))
  for (const ix of instructions) {
    if (free.has(ix.programId.toBase58())) continue
    if (moneyPrograms.some((p) => p.equals(ix.programId)) && own.has(fingerprint(ix))) continue
    throw changed(`The signed transaction calls ${ix.programId.toBase58()}, which this action does not use.`)
  }
  return instructions
}

/**
 * The wallet's copy of a transaction the server will co-sign. Returns the differences found (empty
 * when it may be signed); `assertCosignable` throws on any. Log the differences of a refused copy:
 * real wallets rewrite in ways test signers don't.
 */
export function cosignDifferences(input: {
  original: VersionedTransaction
  signed: VersionedTransaction
  originalTables: readonly AddressLookupTableAccount[]
  signedTables: readonly AddressLookupTableAccount[]
  payer: PublicKey
  cosigner: PublicKey
  /** a mint being created must stay writable */
  cosignerWritable?: boolean
}): string[] {
  const { original, signed, payer, cosigner, cosignerWritable = true } = input
  const out: string[] = []
  if (!signed.message.staticAccountKeys[0]?.equals(payer)) out.push('fee_payer')
  else if (!hasValidSignature(signed, payer)) out.push('payer_signature')
  // The build's lifetime is what the server recorded; a wallet may recompile, not re-date.
  if (signed.message.recentBlockhash !== original.message.recentBlockhash) out.push('blockhash')

  const slot = signerSlot(signed, cosigner)
  const header = signed.message.header
  if (slot < 0) out.push('cosigner_not_signer')
  else {
    if (!isUnsigned(signed.signatures[slot]!)) out.push('cosigner_signed_before_server')
    if (cosignerWritable && slot >= header.numRequiredSignatures - header.numReadonlySignedAccounts) out.push('cosigner_not_writable')
  }
  // Every other required signer must already carry a valid signature over these exact bytes.
  signed.message.staticAccountKeys.slice(0, header.numRequiredSignatures).forEach((key) => {
    if (!key.equals(payer) && !key.equals(cosigner) && !hasValidSignature(signed, key)) out.push(`signature:${key.toBase58()}`)
  })

  let before: TransactionInstruction[], after: TransactionInstruction[]
  try {
    before = TransactionMessage.decompile(original.message, { addressLookupTableAccounts: [...input.originalTables] }).instructions
    after = TransactionMessage.decompile(signed.message, { addressLookupTableAccounts: [...input.signedTables] }).instructions
  } catch {
    return [...out, 'unresolvable_accounts']
  }
  const touches = (ix: TransactionInstruction) => ix.programId.equals(cosigner) || ix.keys.some((k) => k.pubkey.equals(cosigner))
  const remaining = before.filter(touches).map(fingerprint)
  for (const ix of after) {
    const at = remaining.indexOf(fingerprint(ix))
    if (at >= 0) remaining.splice(at, 1)
    else if (touches(ix) && !ix.programId.equals(LIGHTHOUSE_PROGRAM_ID)) out.push(`unauthorized_use:${ix.programId.toBase58()}`)
  }
  if (remaining.length) out.push(`missing_authorized_instructions:${remaining.length}`)
  return out
}

export function assertCosignable(input: Parameters<typeof cosignDifferences>[0]): void {
  const diff = cosignDifferences(input)
  if (diff.length) throw changed(`The wallet changed what the co-signature authorizes (${diff.join(', ')}). Build again and sign the new copy.`)
}
