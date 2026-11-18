// KeeperTxStore over the KeeperTransaction model in schema.prisma.

import type { KeeperTxRow, KeeperTxStore } from './journal.js'

type Row = Omit<KeeperTxRow, 'lastValidBlockHeight' | 'contextSlot' | 'state'> & { state: string; lastValidBlockHeight: bigint; contextSlot: bigint }

/** The slice of a generated Prisma client this store uses. */
export type KeeperPrisma = {
  keeperTransaction: {
    findUnique(args: { where: { key: string } }): Promise<Row | null>
    findMany(args: { where: { state: string }; orderBy: { createdAt: 'asc' } }): Promise<Row[]>
    create(args: { data: Row }): Promise<unknown>
    updateMany(args: { where: { key: string; state?: string; signature?: string }; data: Partial<Row> }): Promise<{ count: number }>
  }
}

const fromRow = (r: Row): KeeperTxRow => ({ ...r, state: r.state as KeeperTxRow['state'], lastValidBlockHeight: Number(r.lastValidBlockHeight), contextSlot: Number(r.contextSlot) })
const toRow = (r: KeeperTxRow): Row => ({ ...r, lastValidBlockHeight: BigInt(r.lastValidBlockHeight), contextSlot: BigInt(r.contextSlot) })

export function prismaKeeperStore(db: KeeperPrisma): KeeperTxStore {
  return {
    async get(key) {
      const r = await db.keeperTransaction.findUnique({ where: { key } })
      return r && fromRow(r)
    },
    async put(row, replacing) {
      if (replacing) {
        const { count } = await db.keeperTransaction.updateMany({ where: { key: row.key, state: 'expired', signature: replacing }, data: toRow(row) })
        return count === 1
      }
      try {
        await db.keeperTransaction.create({ data: toRow(row) })
        return true
      } catch (e) {
        if ((e as { code?: string }).code === 'P2002') return false // unique key: another writer journaled first
        throw e
      }
    },
    async update(key, patch) {
      const data: Partial<Row> = { ...patch } as Partial<Row>
      if (patch.lastValidBlockHeight !== undefined) data.lastValidBlockHeight = BigInt(patch.lastValidBlockHeight)
      if (patch.contextSlot !== undefined) data.contextSlot = BigInt(patch.contextSlot)
      await db.keeperTransaction.updateMany({ where: { key }, data })
    },
    async pending() {
      return (await db.keeperTransaction.findMany({ where: { state: 'signed' }, orderBy: { createdAt: 'asc' } })).map(fromRow)
    },
  }
}
