// Signing with the connected wallet: server-built transactions, messages, and Sign-In With Solana.
// Every helper takes the store's connection(), so none of them holds state of its own.

import { toBase58 } from '../core/encoding'
import { features, type SignInInput, type SignInOutput } from './features'
import type { Connection } from './store'

export type WalletErrorStage = 'no-wallet' | 'unsupported' | 'rejected'

export class WalletError extends Error {
  constructor(
    readonly stage: WalletErrorStage,
    message: string,
  ) {
    super(message)
    this.name = 'WalletError'
  }
}

const need = (c: Connection | null): Connection => {
  if (!c) throw new WalletError('no-wallet', 'Connect a wallet first.')
  return c
}

const rejected = (e: unknown, fallback: string) => new WalletError('rejected', e instanceof Error && e.message ? e.message : fallback)

export const canSign = (c: Connection | null) => !!c && !!features(c.wallet)['solana:signTransaction']
export const canSignAndSend = (c: Connection | null) => !!c && !!features(c.wallet)['solana:signAndSendTransaction']
export const canSignMessage = (c: Connection | null) => !!c && !!features(c.wallet)['solana:signMessage']

/** Signs a serialized transaction (legacy or v0) and returns the signed bytes. */
export async function signTransaction(conn: Connection | null, transaction: Uint8Array): Promise<Uint8Array> {
  const { wallet, account, chain } = need(conn)
  const f = features(wallet)['solana:signTransaction']
  if (!f) throw new WalletError('unsupported', `${wallet.name} can only sign and send, not sign alone.`)
  try {
    const [out] = await f.signTransaction({ account, transaction, chain })
    if (!out) throw new Error('The wallet returned no signed transaction.')
    return out.signedTransaction
  } catch (e) {
    throw rejected(e, 'The wallet declined to sign.')
  }
}

/**
 * Signs and sends through the wallet itself; returns the base58 signature.
 * The preferred path for single-signer transactions: Phantom adds ComputeBudget and Lighthouse
 * guards when it signs and is least likely to block a request it sends itself. signTransaction
 * plus a relay is the fallback. A transaction another key must also sign (a vanity mint) is
 * always signed by the wallet first and co-signed on the server after: Phantom blocks a
 * transaction that already carries another signature.
 */
export async function signAndSendTransaction(conn: Connection | null, transaction: Uint8Array): Promise<string> {
  const { wallet, account, chain } = need(conn)
  const f = features(wallet)['solana:signAndSendTransaction']
  if (!f) throw new WalletError('unsupported', `${wallet.name} can only sign, not send.`)
  try {
    const [out] = await f.signAndSendTransaction({ account, transaction, chain })
    if (!out) throw new Error('The wallet returned no signature.')
    return toBase58(out.signature)
  } catch (e) {
    throw rejected(e, 'The wallet declined to sign.')
  }
}

/** Signs exact bytes (a sign-in message the API issued, byte for byte). */
export async function signMessage(conn: Connection | null, message: Uint8Array): Promise<{ signedMessage: Uint8Array; signature: Uint8Array }> {
  const { wallet, account } = need(conn)
  const f = features(wallet)['solana:signMessage']
  if (!f) throw new WalletError('unsupported', `${wallet.name} can't sign messages.`)
  try {
    const [out] = await f.signMessage({ account, message })
    if (!out) throw new Error('The wallet returned no signed message.')
    return out
  } catch (e) {
    throw rejected(e, 'The wallet declined to sign the message.')
  }
}

/**
 * Sign-In With Solana when the wallet has it; null when it doesn't, so the caller falls back to
 * signMessage over the same text. `conn` may be a connection made a moment ago that the UI state
 * hasn't caught up with yet.
 */
export async function signIn(conn: Connection | null, input: SignInInput): Promise<SignInOutput | null> {
  const { wallet } = need(conn)
  const f = features(wallet)['solana:signIn']
  if (!f) return null
  try {
    const [out] = await f.signIn(input)
    return out ?? null
  } catch (e) {
    throw rejected(e, 'The wallet declined to sign in.')
  }
}
