// IndexStore on Postgres through Prisma, in plain SQL against the tables in schema.prisma, so it
// takes the project's generated client as it is and never imports it. A page applies in one
// transaction under an advisory lock, with the cursors as that transaction's last writes.

import type { CursorAdvance, IndexStore, StageInput, StagedTransaction } from './store.js'

/** The raw-query surface every Prisma client and interactive-transaction client has. */
export type Sql = {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): PromiseLike<T>
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): PromiseLike<number>
}
type Db<Tx extends Sql> = Sql & {
  $transaction<R>(fn: (tx: Tx) => Promise<R>, options?: { maxWait?: number; timeout?: number }): Promise<R>
}

type Row = {
  signature: string
  slot: bigint | number | string
  transaction_index: number
  block_time: Date | string | null
  failed: boolean
  addresses: string[]
  facts: string | null
  decode_error: string | null
  chain_error: string | null
}

const json = (value: unknown) => (value === null || value === undefined ? null : JSON.stringify(value))

export class PrismaIndexStore<F, Tx extends Sql = Sql> implements IndexStore<F, Tx> {
  private readonly lock: string
  private readonly timeout: number

  /** `lock` names the advisory lock pages apply under; one per indexer sharing a database. */
  constructor(
    private readonly db: Db<Tx>,
    options: { lock?: string; timeoutMs?: number } = {},
  ) {
    this.lock = options.lock ?? 'indexer:apply'
    this.timeout = options.timeoutMs ?? 30_000
  }

  async cursor(address: string) {
    const rows = await this.db.$queryRaw<{ latest_signature: string | null }[]>`
      SELECT latest_signature FROM indexer_cursors WHERE address = ${address}`
    return rows[0]?.latest_signature ?? null
  }

  async discovered() {
    const rows = await this.db.$queryRaw<{ address: string }[]>`
      SELECT address FROM indexer_cursors WHERE discovered_by IS NOT NULL`
    return rows.map((r) => r.address)
  }

  async watch(address: string, discoveredBy: string) {
    await this.db.$executeRaw`
      INSERT INTO indexer_cursors (address, discovered_by) VALUES (${address}, ${discoveredBy})
      ON CONFLICT (address) DO NOTHING`
  }

  async seen(signatures: string[], address: string) {
    if (!signatures.length) return new Set<string>()
    await this.db.$executeRaw`
      UPDATE indexed_transactions SET addresses = array_append(addresses, ${address}::text)
      WHERE signature = ANY(${signatures}::text[]) AND NOT (${address}::text = ANY(addresses))`
    const rows = await this.db.$queryRaw<{ signature: string }[]>`
      SELECT signature FROM indexed_transactions WHERE signature = ANY(${signatures}::text[])`
    return new Set(rows.map((r) => r.signature))
  }

  async stage(row: StageInput<F>) {
    const blockTime = row.blockTime === null ? null : new Date(row.blockTime * 1000)
    await this.db.$executeRaw`
      INSERT INTO indexed_transactions (signature, slot, block_time, failed, addresses, facts, decode_error, chain_error)
      VALUES (${row.signature}, ${row.slot}, ${blockTime}, ${row.failed}, ARRAY[${row.address}::text],
        ${json(row.facts)}::jsonb, ${row.decodeError}, ${json(row.chainError)}::jsonb)
      ON CONFLICT (signature) DO NOTHING`
  }

  async crowded(fence: number) {
    const rows = await this.db.$queryRaw<{ slot: bigint | number | string; signatures: string[] }[]>`
      SELECT slot, array_agg(signature::text ORDER BY signature) AS signatures FROM indexed_transactions
      WHERE applied_at IS NULL AND slot <= ${fence}
      GROUP BY slot HAVING count(*) > 1 ORDER BY slot`
    return new Map(rows.map((r) => [Number(r.slot), r.signatures]))
  }

  async order(positions: { signature: string; index: number }[]) {
    if (!positions.length) return
    await this.db.$executeRaw`
      UPDATE indexed_transactions AS t SET transaction_index = o.idx
      FROM unnest(${positions.map((p) => p.signature)}::text[], ${positions.map((p) => p.index)}::int[]) AS o(sig, idx)
      WHERE t.signature = o.sig`
  }

  async pending(fence: number, take: number): Promise<StagedTransaction<F>[]> {
    const rows = await this.db.$queryRaw<Row[]>`
      SELECT signature, slot, transaction_index, block_time, failed, addresses,
        facts::text AS facts, decode_error, chain_error::text AS chain_error
      FROM indexed_transactions WHERE applied_at IS NULL AND slot <= ${fence}
      ORDER BY slot, transaction_index, signature LIMIT ${take}`
    return rows.map((r) => ({
      signature: r.signature,
      slot: Number(r.slot),
      transactionIndex: Number(r.transaction_index),
      blockTime: r.block_time === null ? null : new Date(r.block_time),
      failed: r.failed,
      addresses: r.addresses,
      facts: r.facts === null ? null : (JSON.parse(r.facts) as F),
      decodeError: r.decode_error,
      chainError: r.chain_error === null ? null : JSON.parse(r.chain_error),
    }))
  }

  async apply(rows: StagedTransaction<F>[], cursors: CursorAdvance[], each: (tx: Tx, row: StagedTransaction<F>) => Promise<void>) {
    await this.db.$transaction(
      async (tx) => {
        // pg_advisory_xact_lock returns void, which $queryRaw can't read back; $executeRaw runs it.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${this.lock}, 0))`
        for (const row of rows) {
          const [current] = await tx.$queryRaw<{ applied: boolean }[]>`
            SELECT applied_at IS NOT NULL AS applied FROM indexed_transactions WHERE signature = ${row.signature}`
          if (!current || current.applied) continue
          await each(tx, row)
          await tx.$executeRaw`UPDATE indexed_transactions SET applied_at = now() WHERE signature = ${row.signature}`
        }
        if (!cursors.length) return
        await tx.$executeRaw`
          INSERT INTO indexer_cursors (address, latest_signature, latest_slot)
          SELECT * FROM unnest(${cursors.map((c) => c.address)}::text[], ${cursors.map((c) => c.signature)}::text[], ${cursors.map((c) => c.slot)}::bigint[])
          ON CONFLICT (address) DO UPDATE SET latest_signature = EXCLUDED.latest_signature, latest_slot = EXCLUDED.latest_slot, updated_at = now()
          WHERE indexer_cursors.latest_slot IS NULL OR indexer_cursors.latest_slot <= EXCLUDED.latest_slot`
      },
      { timeout: this.timeout },
    )
  }
}
