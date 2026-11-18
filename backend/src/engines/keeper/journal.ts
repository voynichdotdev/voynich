// Keeper transactions that survive restarts. Each action has an idempotency key (what it does,
// e.g. `sweep:<mint>:<epoch>`). The signed bytes are written down before they are sent; a restart
// follows the same signature instead of signing anew, and an action is rebuilt only after its
// transaction provably expired. A missing status never authorizes a replacement.

import type { AddressLookupTableAccount, Connection, Keypair, TransactionInstruction } from '@solana/web3.js'
import { buildUnsignedV0 } from '../tx/server/build.js'
import { signatureOf } from '../tx/server/ed25519.js'
import { failureFromLogs, type ErrorRegistry } from '../tx/server/failure.js'
import { blockhashExpired, REBROADCAST_MS, type Broadcast } from '../tx/server/send.js'

export type KeeperTxState = 'signed' | 'confirmed' | 'failed' | 'expired'

export type KeeperTxRow = {
  key: string
  state: KeeperTxState
  signature: string
  signedBase64: string
  blockhash: string
  lastValidBlockHeight: number
  contextSlot: number
  error: string | null
}

export interface KeeperTxStore {
  get(key: string): Promise<KeeperTxRow | null>
  /** Inserts the row, or replaces an 'expired' row whose signature is `replacing`. false if another writer won. */
  put(row: KeeperTxRow, replacing?: string): Promise<boolean>
  update(key: string, patch: Partial<KeeperTxRow>): Promise<void>
  /** rows still 'signed', oldest first */
  pending(): Promise<KeeperTxRow[]>
}

export type JournalOptions = {
  connection: Connection
  store: KeeperTxStore
  signer: Keypair
  lookupTables?: () => Promise<AddressLookupTableAccount[]>
  microLamports?: () => Promise<bigint>
  /** extra instructions every keeper transaction carries (a Sender tip) */
  extra?: (signer: Keypair) => TransactionInstruction[]
  broadcast?: Broadcast
  registry?: ErrorRegistry
  /** checked before every send: a demoted keeper must not write */
  isLeader?: () => boolean
  /** how long one follow waits before leaving the row 'signed' for the next tick */
  followMs?: number
}

export type FollowResult = 'confirmed' | 'pending'

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function createJournal(options: JournalOptions) {
  const { connection, store, signer, isLeader = () => true, followMs = 90_000 } = options
  const own = () => {
    if (!isLeader()) throw new Error('KEEPER_NOT_LEADER')
  }
  const send = (bytes: Uint8Array) =>
    options.broadcast ? options.broadcast(bytes) : connection.sendRawTransaction(bytes, { skipPreflight: true, maxRetries: 0 })

  /** Follows the journaled transaction; throws on failure or expiry, 'pending' when still unseen. */
  async function follow(key: string): Promise<FollowResult> {
    const row = await store.get(key)
    if (!row) throw new Error(`No keeper transaction ${key}.`)
    if (row.state === 'confirmed') return 'confirmed'
    if (row.state !== 'signed') throw new Error(`Keeper transaction ${key} ${row.state}${row.error ? `: ${row.error}` : ''}.`)
    const bytes = Buffer.from(row.signedBase64, 'base64')
    const deadline = Date.now() + followMs
    let nextSend = 0
    while (Date.now() < deadline) {
      const status = (await connection.getSignatureStatuses([row.signature], { searchTransactionHistory: true })).value[0]
      if (status?.err) {
        const tx = await connection.getTransaction(row.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }).catch(() => null)
        const failure = failureFromLogs('confirm', tx?.meta?.logMessages, options.registry)
        await store.update(key, { state: 'failed', error: failure.program?.name ?? failure.message })
        throw failure
      }
      if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') {
        await store.update(key, { state: 'confirmed' })
        return 'confirmed'
      }
      if (!status) {
        const height = await connection.getBlockHeight('confirmed')
        if (height > row.lastValidBlockHeight) {
          if ((await blockhashExpired(connection, row)) === true) {
            const again = (await connection.getSignatureStatuses([row.signature], { searchTransactionHistory: true })).value[0]
            if (!again) {
              await store.update(key, { state: 'expired' })
              throw new Error(`Keeper transaction ${key} expired; the next cycle rebuilds it.`)
            }
          }
        } else if (Date.now() >= nextSend) {
          own()
          nextSend = Date.now() + REBROADCAST_MS
          await send(Uint8Array.from(bytes)).catch(() => {}) // ambiguity is read, not retried blindly
        }
      }
      await pause(1_000)
    }
    return 'pending'
  }

  /**
   * Runs an action once. Confirmed: done. Signed: follow it. Missing or expired: build, sign,
   * simulate, journal, then send.
   */
  async function execute(key: string, instructions: () => Promise<TransactionInstruction[]> | TransactionInstruction[]): Promise<FollowResult> {
    const existing = await store.get(key)
    if (existing?.state === 'confirmed') return 'confirmed'
    if (existing?.state === 'failed') throw new Error(`Keeper action ${key} failed: ${existing.error}`)
    if (!existing || existing.state === 'expired') {
      own()
      const [tables, price] = await Promise.all([options.lookupTables?.() ?? [], options.microLamports?.() ?? 0n])
      const build = await buildUnsignedV0({
        connection,
        payer: signer.publicKey,
        instructions: [...(await instructions()), ...(options.extra?.(signer) ?? [])],
        lookupTables: tables,
        microLamports: price,
        walletSigned: false,
        registry: options.registry,
      })
      build.transaction.sign([signer])
      const { value } = await connection.simulateTransaction(build.transaction, { sigVerify: true, commitment: 'confirmed' })
      if (value.err) throw failureFromLogs('simulation', value.logs, options.registry)
      own()
      const row: KeeperTxRow = {
        key,
        state: 'signed',
        signature: signatureOf(build.transaction),
        signedBase64: Buffer.from(build.transaction.serialize()).toString('base64'),
        blockhash: build.blockhash,
        lastValidBlockHeight: build.lastValidBlockHeight,
        contextSlot: build.contextSlot,
        error: null,
      }
      await store.put(row, existing?.signature) // losing the race means another writer journaled it: follow theirs
    }
    return follow(key)
  }

  /** Follows every transaction left 'signed' by an earlier run. Call at the start of each tick. */
  async function resume() {
    for (const row of await store.pending()) await follow(row.key).catch(() => {})
  }

  return { execute, follow, resume }
}
