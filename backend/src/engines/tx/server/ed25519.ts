// Ed25519 checks on transaction signatures with node:crypto alone (no tweetnacl, no noble).
// Used wherever the server must know a wallet really signed the exact bytes it is about to
// co-sign or relay.

import { createPublicKey, verify } from 'node:crypto'
import type { PublicKey, VersionedTransaction } from '@solana/web3.js'
import { toBase58 } from '../../core/encoding.js'

// DER prefix that turns a raw 32-byte Ed25519 public key into an SPKI key node:crypto accepts.
const SPKI_ED25519 = Buffer.from('302a300506032b6570032100', 'hex')

export function verifyEd25519(signer: PublicKey, message: Uint8Array, signature: Uint8Array): boolean {
  const key = createPublicKey({ key: Buffer.concat([SPKI_ED25519, signer.toBuffer()]), format: 'der', type: 'spki' })
  return verify(null, message, key, signature)
}

/** The signer's slot among the required signatures, or -1. */
export function signerSlot(tx: VersionedTransaction, signer: PublicKey): number {
  const slot = tx.message.staticAccountKeys.findIndex((k) => k.equals(signer))
  return slot >= 0 && slot < tx.message.header.numRequiredSignatures ? slot : -1
}

/** Whether `signer` holds a valid signature over this exact message. */
export function hasValidSignature(tx: VersionedTransaction, signer: PublicKey): boolean {
  const slot = signerSlot(tx, signer)
  return slot >= 0 && verifyEd25519(signer, tx.message.serialize(), tx.signatures[slot]!)
}

export const isUnsigned = (signature: Uint8Array) => signature.every((b) => b === 0)

/** The transaction id: the fee payer's signature in base58. */
export function signatureOf(tx: VersionedTransaction): string {
  const sig = tx.signatures[0]
  if (!sig || isUnsigned(sig)) throw new Error('The fee payer has not signed this transaction.')
  return toBase58(sig)
}
