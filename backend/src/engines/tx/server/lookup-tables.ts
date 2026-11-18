// Address lookup tables: loading them for a build, waiting until a fresh one is usable, and
// creating/extending one. Every user transaction is v0 over a table so it leaves room for the
// guards a wallet appends.

import { AddressLookupTableProgram, type AddressLookupTableAccount, type Connection, type PublicKey, type TransactionInstruction } from '@solana/web3.js'

/** Slots past the last extension (or freeze) before a table is used. */
export const TABLE_SLOT_MARGIN = 3
/** Addresses per extend instruction; a table holds 256. */
export const EXTEND_BATCH = 20
export const TABLE_CAPACITY = 256

export async function loadLookupTables(connection: Connection, addresses: readonly PublicKey[]): Promise<AddressLookupTableAccount[]> {
  return Promise.all(
    addresses.map(async (address) => {
      const table = (await connection.getAddressLookupTable(address, { commitment: 'confirmed' })).value
      if (!table) throw new Error(`Lookup table ${address.toBase58()} does not exist.`)
      return table
    }),
  )
}

const frozenSeen = new WeakMap<Connection, Map<string, number>>()

/**
 * Waits until every table is safe to reference. A freshly extended table can pass simulation and
 * still be dropped by the leader, so wait past its last extension. A frozen table also needs its
 * freeze to age, and extension age can't prove that (a long-lived table may have just frozen):
 * the first time a frozen table is seen, its latest signature slot bounds the freeze.
 */
export async function waitForLookupTables(
  connection: Connection,
  tables: readonly AddressLookupTableAccount[],
  { timeoutMs = 30_000 }: { timeoutMs?: number } = {},
): Promise<void> {
  if (!tables.length) return
  const deadline = Date.now() + timeoutMs
  let slot = await connection.getSlot('processed')
  let seen = frozenSeen.get(connection)
  if (!seen) frozenSeen.set(connection, (seen = new Map()))
  let target = 0
  for (const table of tables) {
    if (!table.isActive()) throw new Error(`Lookup table ${table.key.toBase58()} is deactivated.`)
    let freeze = 0
    if (table.state.authority === undefined) {
      const key = table.key.toBase58()
      if (!seen.has(key)) {
        const [latest] = await connection.getSignaturesForAddress(table.key, { limit: 1 }, 'confirmed')
        seen.set(key, Math.max(slot, latest?.slot ?? 0))
      }
      freeze = seen.get(key)!
    }
    target = Math.max(target, table.state.lastExtendedSlot, freeze)
  }
  target += TABLE_SLOT_MARGIN
  while (slot < target) {
    if (Date.now() >= deadline) throw new Error(`Lookup tables not usable yet: slot ${slot}, needed ${target}.`)
    await new Promise((r) => setTimeout(r, 250))
    slot = await connection.getSlot('processed')
  }
}

/**
 * A recent slot for createLookupTable. Not the finalized slot itself: a bank's SlotHashes stops at
 * its parent, so that slot isn't "recent" yet when the create is simulated at finalized.
 */
export async function lookupTableRecentSlot(connection: Connection): Promise<number> {
  const finalized = await connection.getSlot('finalized')
  const blocks = await connection.getBlocks(finalized - 32, finalized - 4, 'finalized')
  const slot = blocks.at(-1)
  if (slot === undefined) throw new Error('No recent finalized block to anchor the lookup table.')
  return slot
}

export function createLookupTable(authority: PublicKey, payer: PublicKey, recentSlot: number): { instruction: TransactionInstruction; address: PublicKey } {
  const [instruction, address] = AddressLookupTableProgram.createLookupTable({ authority, payer, recentSlot })
  return { instruction, address }
}

/** Extend instructions for the addresses the table doesn't hold yet, EXTEND_BATCH per instruction. */
export function extendLookupTable(table: AddressLookupTableAccount, authority: PublicKey, payer: PublicKey, addresses: readonly PublicKey[]): TransactionInstruction[] {
  const held = new Set(table.state.addresses.map((a) => a.toBase58()))
  const missing = [...new Map(addresses.filter((a) => !held.has(a.toBase58())).map((a) => [a.toBase58(), a])).values()]
  if (held.size + missing.length > TABLE_CAPACITY) throw new Error(`Lookup table ${table.key.toBase58()} is full; start a new table.`)
  const out: TransactionInstruction[] = []
  for (let i = 0; i < missing.length; i += EXTEND_BATCH)
    out.push(AddressLookupTableProgram.extendLookupTable({ lookupTable: table.key, authority, payer, addresses: missing.slice(i, i + EXTEND_BATCH) }))
  return out
}
