// Sending signed bytes and following them until they land, fail, or provably expire.
//
// The signed bytes are immutable intent: rebroadcast the same bytes while their blockhash lives,
// never re-sign. A send receipt is not confirmation, and an unreadable outcome never permits a
// replacement: "expired" is declared only when the block height is past the build's lifetime,
// the blockhash is invalid at finalized, and the signature has no history.

import { SendTransactionError, VersionedTransaction, type Connection, type SignatureStatus } from '@solana/web3.js'
import { toBase58 } from '../../core/encoding.js'
import { failureFromLogs, type ErrorRegistry, type TxError } from './failure.js'

export const REBROADCAST_MS = 2_000

export type Broadcast = (bytes: Uint8Array) => Promise<string>
export type Commitment = 'processed' | 'confirmed' | 'finalized'
export type Outcome = 'failed' | 'expired' | 'unknown' | 'timeout'

export class TxSendError extends Error {
  constructor(
    readonly outcome: Outcome,
    readonly signature: string,
    readonly failure: TxError | null = null,
  ) {
    super(
      outcome === 'failed'
        ? failure?.message ?? 'The transaction failed on chain.'
        : outcome === 'expired'
          ? 'The transaction expired without landing. Nothing was spent; build it again.'
          : 'The transaction result is not known yet. Check this signature before signing again.',
    )
    this.name = 'TxSendError'
  }
}

/** The build's lifetime; `contextSlot` (the slot the build read at) keeps a lagging finalized node from judging it. */
export type Lifetime = { blockhash: string; lastValidBlockHeight: number; contextSlot?: number }

/**
 * Whether a blockhash is provably dead: invalid at finalized on a node that has reached the
 * build's slot. null when that can't be shown yet (a lagging node is "not yet", never "expired").
 */
export async function blockhashExpired(connection: Connection, lifetime: Lifetime): Promise<boolean | null> {
  try {
    const valid = await connection.isBlockhashValid(lifetime.blockhash, { commitment: 'finalized', minContextSlot: lifetime.contextSlot })
    return !valid.value
  } catch {
    return null
  }
}

export type FollowOptions = {
  commitment?: Commitment
  timeoutMs?: number
  registry?: ErrorRegistry
}

const RANK: Record<Commitment, number> = { processed: 0, confirmed: 1, finalized: 2 }
const reached = (s: SignatureStatus, target: Commitment) => RANK[s.confirmationStatus ?? (s.confirmations === null ? 'finalized' : 'processed')] >= RANK[target]
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function landedLogs(connection: Connection, signature: string): Promise<string[]> {
  try {
    const tx = await connection.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })
    return tx?.meta?.logMessages ?? []
  } catch {
    return [] // a version this client can't read; the status alone says it failed
  }
}

async function readStatus(connection: Connection, signature: string) {
  return (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0] ?? null
}

/**
 * Follows a signature until `commitment`; when `broadcast` is given, resends the same bytes every
 * REBROADCAST_MS while no status has been seen and the lifetime holds.
 */
async function watch(connection: Connection, signature: string, lifetime: Lifetime | null, options: FollowOptions, broadcast?: () => Promise<void>): Promise<SignatureStatus> {
  const { commitment = 'confirmed', timeoutMs = 90_000, registry } = options
  const deadline = Date.now() + timeoutMs
  const fail = async (outcome: Outcome, failure: TxError | null = null): Promise<never> => {
    throw new TxSendError(outcome, signature, failure)
  }
  let seen = false
  let nextBroadcast = 0
  for (;;) {
    let status: SignatureStatus | null
    try {
      status = await readStatus(connection, signature)
    } catch {
      status = null
    }
    if (status) {
      seen = true
      if (status.err) return fail('failed', failureFromLogs('confirm', await landedLogs(connection, signature), registry))
      if (reached(status, commitment)) return status
    } else if (!seen && lifetime) {
      const height = await connection.getBlockHeight('confirmed').catch(() => null)
      if (height !== null && height > lifetime.lastValidBlockHeight) {
        // Past its height: expired only once the blockhash is provably dead and history is still empty.
        const expired = await blockhashExpired(connection, lifetime)
        const last = await readStatus(connection, signature).catch(() => null)
        if (!last && expired === true) return fail('expired')
        if (Date.now() >= deadline) return fail('unknown')
        await pause(1_000)
        continue
      }
      if (broadcast && Date.now() >= nextBroadcast) {
        nextBroadcast = Date.now() + REBROADCAST_MS
        await broadcast()
      }
    }
    if (Date.now() >= deadline) return fail('timeout')
    await pause(500)
  }
}

/** Sends signed bytes and follows them. Uses RPC sendRawTransaction unless `broadcast` is given (sender.ts). */
export async function sendSigned(
  connection: Connection,
  input: { bytes: Uint8Array } & Lifetime & FollowOptions & { broadcast?: Broadcast },
): Promise<{ signature: string; status: SignatureStatus }> {
  // Own the bytes: neither the caller nor a transport may change a later retry.
  const bytes = Uint8Array.from(input.bytes)
  const tx = VersionedTransaction.deserialize(bytes)
  if (tx.message.recentBlockhash !== input.blockhash) throw new Error('The lifetime does not belong to these bytes.')
  const first = tx.signatures[0]
  if (!first) throw new Error('These bytes carry no signature.')
  const signature = toBase58(first)
  const send = async () => {
    try {
      const sent = input.broadcast
        ? await input.broadcast(Uint8Array.from(bytes))
        : await connection.sendRawTransaction(bytes, { skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 0 })
      if (sent !== signature) throw new TxSendError('unknown', signature)
    } catch (e) {
      if (e instanceof TxSendError) throw e
      // A preflight rejection is final; any other error is transport ambiguity: read before retrying.
      if (e instanceof SendTransactionError && e.message.startsWith('Simulation failed')) {
        throw new TxSendError('failed', signature, failureFromLogs('send', e.logs ?? [], input.registry))
      }
    }
  }
  const status = await watch(connection, signature, input, input, send)
  return { signature, status }
}

/**
 * Follows a signature the wallet sent itself (signAndSendTransaction). Never resends: the server
 * doesn't hold those bytes. Never declares expiry either: the wallet may have re-dated the
 * transaction, so the build's blockhash proves nothing about it. Until it lands the outcome is
 * "timeout" (not seen yet); read again later rather than asking for a new signature.
 */
export async function followSignature(connection: Connection, signature: string, options: FollowOptions = {}): Promise<SignatureStatus> {
  return watch(connection, signature, null, options)
}
