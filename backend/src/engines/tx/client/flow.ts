// The browser side of one transaction: the wallet signs what the server built, then either the
// wallet sends it and the browser reports the signature, or the browser hands the signed bytes
// back for the server to check, co-sign if needed, and send. Then it reads the status until it
// settles, and never sends again on its own.
//
// The browser never broadcasts to an RPC itself: the server holds the RPC, the checks and the
// retry policy.

import { fromBase64, toBase64 } from '../../core/encoding.js'
import { canSign, canSignAndSend, signAndSendTransaction, signTransaction, WalletError } from '../../wallet/sign.js'
import type { Connection } from '../../wallet/store.js'
import { settled, type TxBuild, type TxFailure, type TxStatus, type TxSubmission } from '../types.js'

export type TxApi = {
  submit(input: TxSubmission): Promise<TxStatus>
  status(id: string): Promise<TxStatus>
}

export type TxRoute = 'wallet-sent' | 'relay'

/**
 * The wallet sends a single-signer transaction itself when it can (wallets guard what they send
 * best that way). Everything else goes back through the server: a transaction the server
 * co-signs after the wallet, and every transaction on a cluster the wallet's own RPC can't reach
 * (localnet).
 */
export function chooseRoute(conn: Connection | null, build: TxBuild, walletReachesCluster: boolean): TxRoute {
  if (!build.cosigned && walletReachesCluster && canSignAndSend(conn)) return 'wallet-sent'
  if (!canSign(conn) && !build.cosigned && canSignAndSend(conn)) return 'wallet-sent'
  return 'relay'
}

export class TxFlowError extends Error {
  constructor(readonly failure: TxFailure) {
    super(failure.message)
    this.name = 'TxFlowError'
  }
}

/** A wallet's refusal reads as one; anything else the wallet threw is its own message. */
export function walletFailure(e: unknown): TxFailure {
  const message = e instanceof Error ? e.message : ''
  if (e instanceof WalletError && e.stage === 'rejected' && /reject|cancel|denied|declined|closed/i.test(message))
    return { stage: 'wallet-rejected', message: "The wallet didn't sign it.", nextStep: 'Nothing was sent. Sign again when you are ready.', retryable: true }
  return { stage: 'wallet-rejected', message: message || "The wallet couldn't sign it.", nextStep: 'Try again in a moment.', retryable: true }
}

const key = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`)

/** Signs and submits; returns the first status the server reports. */
export async function signAndSubmit(conn: Connection | null, build: TxBuild, api: TxApi, route: TxRoute): Promise<TxStatus> {
  const bytes = fromBase64(build.transactionBase64)
  let submission: TxSubmission
  try {
    submission =
      route === 'wallet-sent'
        ? { mode: 'wallet-sent', buildId: build.id, signature: await signAndSendTransaction(conn, bytes), idempotencyKey: key() }
        : { mode: 'relay', buildId: build.id, signedTransactionBase64: toBase64(await signTransaction(conn, bytes)), idempotencyKey: key() }
  } catch (e) {
    throw new TxFlowError(walletFailure(e))
  }
  return api.submit(submission)
}

/**
 * Reads the status until it settles or `timeoutMs` passes. "submitted" and "unconfirmed" both
 * mean "not seen landing yet": keep reading, never re-send, and offer "check again" at the end.
 */
export async function followStatus(api: TxApi, first: TxStatus, options: { intervalMs?: number; timeoutMs?: number; onUpdate?: (s: TxStatus) => void } = {}): Promise<TxStatus> {
  const { intervalMs = 1_200, timeoutMs = 90_000, onUpdate } = options
  let current = first
  const started = Date.now()
  while (!settled(current.status) && Date.now() - started < timeoutMs) {
    await new Promise((r) => setTimeout(r, intervalMs))
    try {
      current = await api.status(current.id)
      onUpdate?.(current)
    } catch {
      /* a missed read is not an outcome; read again */
    }
  }
  return current
}
