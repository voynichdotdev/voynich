// The indexer's storage port. Staged transactions are the record of work still to do; a cursor only
// marks where re-reading an address may stop, so it never moves past a transaction that isn't
// applied yet. prisma-store.ts implements it on Postgres.

export type StageInput<F> = {
  signature: string
  slot: number
  blockTime: number | null
  failed: boolean
  /** the watched address whose history this transaction came from */
  address: string
  facts: F | null
  /** decode issues, one `CODE: message` per line */
  decodeError: string | null
  /** the transaction error the signature list reported, as JSON */
  chainError: unknown
}

export type StagedTransaction<F> = {
  signature: string
  slot: number
  /** position inside its block, read only when a slot holds more than one staged transaction */
  transactionIndex: number
  blockTime: Date | null
  failed: boolean
  /** every watched address this transaction was seen from */
  addresses: string[]
  facts: F | null
  decodeError: string | null
  chainError: unknown
}

export type CursorAdvance = { address: string; signature: string; slot: number }

export interface IndexStore<F, Tx> {
  /** the newest applied signature for an address, or null before its first */
  cursor(address: string): Promise<string | null>
  /** addresses indexed transactions introduced, followed from then on */
  discovered(): Promise<string[]>
  watch(address: string, discoveredBy: string): Promise<void>
  /** which of these signatures are staged already; adds `address` to each that lacks it */
  seen(signatures: string[], address: string): Promise<Set<string>>
  stage(row: StageInput<F>): Promise<void>
  /** unapplied signatures at or below `fence`, for every slot that holds more than one */
  crowded(fence: number): Promise<Map<number, string[]>>
  order(positions: { signature: string; index: number }[]): Promise<void>
  /** the oldest unapplied transactions at or below `fence`, in chain order */
  pending(fence: number, take: number): Promise<StagedTransaction<F>[]>
  /**
   * Applies rows in one database transaction: `each` runs per row in order, the rows are marked
   * applied, and the cursors are written last, in the same commit.
   */
  apply(rows: StagedTransaction<F>[], cursors: CursorAdvance[], each: (tx: Tx, row: StagedTransaction<F>) => Promise<void>): Promise<void>
}
