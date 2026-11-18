// Server keypairs from environment variables: the 64-byte JSON array Solana's CLI writes, or
// base58. Errors name the variable and never echo its value.

import { Keypair, type PublicKey } from '@solana/web3.js'
import { fromBase58 } from '../../core/encoding.js'

export function keypairFromSecret(name: string, value: string | undefined): Keypair {
  const text = value?.trim()
  if (!text) throw new Error(`${name} is required.`)
  let bytes: Uint8Array
  if (text.startsWith('[')) {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new Error(`${name} is not valid JSON.`)
    }
    if (!Array.isArray(parsed) || !parsed.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)) throw new Error(`${name} must be a JSON array of bytes.`)
    bytes = Uint8Array.from(parsed)
  } else {
    try {
      bytes = fromBase58(text)
    } catch {
      throw new Error(`${name} is neither a JSON byte array nor base58.`)
    }
  }
  if (bytes.length !== 64) throw new Error(`${name} must hold a 64-byte secret key.`)
  // Keypair keeps a reference to these bytes: don't wipe them here.
  try {
    return Keypair.fromSecretKey(bytes)
  } catch {
    throw new Error(`${name} is not a valid ed25519 secret key.`)
  }
}

export const keypairFromEnv = (name: string) => keypairFromSecret(name, process.env[name])

/** Refuses to run with a key other than the one the deployment expects (a manifest, a PDA's authority). */
export function expectKey(name: string, keypair: Keypair, expected: PublicKey | string) {
  const want = typeof expected === 'string' ? expected : expected.toBase58()
  if (keypair.publicKey.toBase58() !== want) throw new Error(`${name} belongs to ${keypair.publicKey.toBase58()}, expected ${want}.`)
}
