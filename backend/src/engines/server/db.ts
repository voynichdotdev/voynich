// One pg Pool per process, shared by Prisma (through the pg adapter) and by raw SQL, so both count
// against one connection limit. The pool's error listener keeps a dropped idle connection (the
// database restarting) from becoming an uncaught exception, and close() ends both.

import { PrismaPg } from '@prisma/adapter-pg'
import { Pool, type PoolConfig } from 'pg'

export type Database<Db> = { db: Db; pool: Pool; close(): Promise<void> }

/**
 * The generated PrismaClient lives in the project (its output path is the project's choice), so it
 * comes in as a factory: `createDatabase(url, (adapter) => new PrismaClient({ adapter }))`.
 */
export function createDatabase<Db extends { $disconnect(): Promise<void> }>(
  url: string,
  client: (adapter: PrismaPg) => Db,
  config: Omit<PoolConfig, 'connectionString'> = {},
): Database<Db> {
  if (!url) throw new Error('DATABASE_URL is required.')
  const pool = new Pool({ connectionString: url, ...config })
  pool.on('error', (error) => console.error(JSON.stringify({ level: 'error', event: 'postgres_pool', name: error.name, message: error.message })))
  const db = client(new PrismaPg(pool))
  let closing: Promise<void> | undefined
  return {
    db,
    pool,
    close: () =>
      (closing ??= (async () => {
        try {
          await db.$disconnect()
        } finally {
          await pool.end()
        }
      })()),
  }
}
