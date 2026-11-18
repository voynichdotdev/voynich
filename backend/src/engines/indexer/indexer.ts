// The indexing loop. Each cycle reads every watched address's new signatures back to its cursor,
// stages each new transaction's decoded facts, then applies everything staged in chain order, one
// database transaction per page. Streams and webhooks only wake it: this RPC catch-up is the one
// path that reads and decodes transactions, so a missed hint costs a delay, never a fact.
//
// It never lists program accounts. New addresses come from decoded transactions (a pool a
// migration created) through `discover`, and are followed from then on.

import { decodeTransaction, type DecodedTransaction, type ProgramDecoder } from './decoder.js'
import { blockSignatures, confirmedSlot, readTransaction, signaturePage, type Rpc, type SignatureInfo } from './rpc.js'
import type { CursorAdvance, IndexStore, StagedTransaction } from './store.js'

/** Wake-up hints that follow the watched addresses: logs-stream, laserstream, helius-webhook. */
export interface WakeStream {
  setAddresses(addresses: string[]): Promise<void>
  close(): Promise<void>
}

export type IndexerOptions<F, Tx> = {
  rpc: Rpc
  store: IndexStore<F, Tx>
  programs: ProgramDecoder[]
  /** followed from the start: usually the program id and its config accounts */
  addresses: string[]
  /** the product's facts for one decoded transaction: plain JSON, amounts as strings */
  facts(tx: DecodedTransaction, signature: SignatureInfo): F | Promise<F>
  /** writes one transaction's facts inside its page's database transaction, in chain order */
  apply(tx: Tx, row: StagedTransaction<F>): Promise<void>
  /** addresses these facts introduce; read from the start of their history */
  discover?(facts: F): string[]
  stream?(wake: () => void): Promise<WakeStream>
  /** between cycles when nothing wakes it (5 s) */
  pollMs?: number
  /** the pause after a failed cycle; wakes don't shorten it (60 s) */
  retryMs?: number
  /** signatures per getSignaturesForAddress page, at most 1000 (200) */
  pageSize?: number
  /** getTransaction calls in flight at once (20) */
  concurrency?: number
  /** transactions per apply transaction (50) */
  applyBatch?: number
  log?(entry: Record<string, unknown>): void
}

export class Indexer<F, Tx> {
  private readonly addresses: Set<string>
  private stream?: WakeStream
  private timer?: ReturnType<typeof setTimeout>
  private inFlight?: Promise<void>
  private running = false
  private stopped = false
  private wakeQueued = false
  private retryAfter = 0

  constructor(private readonly options: IndexerOptions<F, Tx>) {
    this.addresses = new Set(options.addresses)
  }

  /** Opens the wake stream and starts cycling. The first cycle runs at once, in the background. */
  async start(): Promise<void> {
    if (this.running) return
    this.running = true
    this.stopped = false
    let stream: WakeStream | undefined
    try {
      stream = await this.options.stream?.(() => this.wake())
    } catch (error) {
      this.running = false
      throw error
    }
    if (this.stopped) {
      await stream?.close()
      return
    }
    this.stream = stream
    this.schedule(0)
  }

  /** Ends the loop; a cycle in flight stops at its next page boundary. */
  async stop(): Promise<void> {
    this.stopped = true
    this.running = false
    clearTimeout(this.timer)
    await this.stream?.close()
    this.stream = undefined
    await this.inFlight
  }

  /** Runs one cycle, or joins the one running. Works without start(), for scripts and backfills. */
  catchUp(): Promise<void> {
    this.inFlight ??= this.cycle().finally(() => (this.inFlight = undefined))
    return this.inFlight
  }

  /** Brings the next cycle forward. Many wakes during a cycle fold into one more cycle. */
  wake(): void {
    if (!this.running || this.wakeQueued) return
    this.wakeQueued = true
    this.schedule(0)
  }

  watched(): string[] {
    return [...this.addresses]
  }

  private schedule(delay: number) {
    if (!this.running) return
    clearTimeout(this.timer)
    this.timer = setTimeout(async () => {
      this.timer = undefined
      this.wakeQueued = false
      try {
        await this.catchUp()
        this.schedule(this.wakeQueued ? 0 : (this.options.pollMs ?? 5000))
      } catch (error) {
        const retryMs = this.options.retryMs ?? 60_000
        this.retryAfter = Date.now() + retryMs
        this.options.log?.({ event: 'indexer_cycle_failed', error: error instanceof Error ? error.message : String(error) })
        this.schedule(retryMs)
      }
    }, Math.max(delay, this.retryAfter - Date.now()))
    this.timer.unref?.()
  }

  private async cycle(): Promise<void> {
    const { rpc, store } = this.options
    const limit = Math.min(this.options.pageSize ?? 200, 1000), concurrency = this.options.concurrency ?? 20
    for (const address of await store.discovered()) this.addresses.add(address)
    // Every address is read after this slot is confirmed, so nothing at or below it can still be
    // missing from the stage: rows up to it apply now, across addresses, in true chain order.
    const fence = await confirmedSlot(rpc)
    const heads = new Map<string, SignatureInfo>(), scanned = new Set<string>()
    let staged = 0

    // Pass 1: stage. RPC reads stay outside database transactions; facts land on disk as they come.
    for (let address = this.unscanned(scanned); address; address = this.unscanned(scanned)) {
      const until = await store.cursor(address)
      for (let before: string | undefined; ; ) {
        if (this.stopped) return
        const page = await signaturePage(rpc, address, { before, until, limit })
        if (!page.length) break
        if (!heads.has(address)) heads.set(address, page[0]!)
        const known = await store.seen(page.map((s) => s.signature), address)
        const fresh = page.filter((s) => !known.has(s.signature))
        for (let i = 0; i < fresh.length; i += concurrency) {
          if (this.stopped) return
          await Promise.all(fresh.slice(i, i + concurrency).map((row) => this.stage(row, address)))
        }
        staged += fresh.length
        if (page.length < limit) break
        before = page[page.length - 1]!.signature
      }
      scanned.add(address)
    }

    // Signature lists order one address. Two staged transactions in one slot take their block's order.
    for (const [slot, signatures] of await store.crowded(fence)) {
      if (this.stopped) return
      const block = await blockSignatures(rpc, slot)
      const positions = signatures.map((signature) => ({ signature, index: block.indexOf(signature) }))
      if (positions.some((p) => p.index < 0)) throw new Error(`A confirmed transaction is missing from block ${slot}.`)
      await store.order(positions)
    }

    // Pass 2: apply in chain order. Each page moves the cursors of the addresses its rows came from.
    let applied = 0
    for (;;) {
      if (this.stopped) return
      const rows = await store.pending(fence, this.options.applyBatch ?? 50)
      if (!rows.length) break
      const advances = new Map<string, CursorAdvance>()
      for (const row of rows) for (const address of row.addresses) advances.set(address, { address, signature: row.signature, slot: row.slot })
      await store.apply(rows, [...advances.values()], (tx, row) => this.options.apply(tx, row))
      applied += rows.length
    }
    // An address whose newest transactions were applied through another address still moves to its head.
    const settled = [...heads].filter(([, head]) => head.slot <= fence).map(([address, head]) => ({ address, signature: head.signature, slot: head.slot }))
    if (settled.length) await store.apply([], settled, async () => {})

    if (!this.stopped) await this.stream?.setAddresses([...this.addresses])
    if (staged || applied) this.options.log?.({ event: 'indexer_caught_up', staged, applied, fence, addresses: this.addresses.size })
  }

  private unscanned(scanned: Set<string>) {
    for (const address of this.addresses) if (!scanned.has(address)) return address
    return undefined
  }

  private async stage(row: SignatureInfo, address: string) {
    const { rpc, store, programs } = this.options
    const raw = await readTransaction(rpc, row.signature)
    if (raw === null) throw new Error(`Confirmed transaction is not readable on this node yet: ${row.signature}`)
    const tx = decodeTransaction(raw, programs, row.signature)
    tx.blockTime ??= row.blockTime
    const failed = tx.failed || row.err != null
    const facts = tx.valid ? await this.options.facts(tx, row) : null
    const issues = tx.issues.map((i) => `${i.code}: ${i.message}`)
    if (tx.blockTime === null) issues.push('MISSING_BLOCK_TIME: the node keeps no block time for this slot')
    // New addresses are saved before the row: a staged row is never decoded again, so its
    // discoveries must already be durable when it lands.
    for (const next of facts && !failed ? (this.options.discover?.(facts) ?? []) : []) {
      if (this.addresses.has(next)) continue
      await store.watch(next, row.signature)
      this.addresses.add(next)
    }
    await store.stage({ signature: row.signature, slot: row.slot, blockTime: tx.blockTime, failed, address, facts, decodeError: issues.join('\n') || null, chainError: row.err })
  }
}
