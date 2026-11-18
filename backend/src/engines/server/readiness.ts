// Whether the program a service drives exists yet. Every replica, worker and role of a product
// shares one probe through a database row that reserves the next RPC read, so waiting for a deploy
// costs a couple of calls a minute however many processes and tabs are open. Services boot healthy
// in the waiting state and go live on their own when the program appears: no restart, no edit.
//
// Table (as a Prisma model, so migrations create it):
//   model ServiceReadiness {
//     id          String    @id
//     ready       Boolean   @default(false)
//     nextProbeAt DateTime  @default(now()) @db.Timestamptz(3)
//     checkedAt   DateTime? @db.Timestamptz(3)
//     lastError   String?
//   }

import { createHash } from 'node:crypto'
import type { MiddlewareHandler } from 'hono'
import type { Pool } from 'pg'
import { fail } from './errors.js'

export type ReadinessStatus = 'waiting' | 'ready'

export type Readiness = {
  start(): Promise<void>
  stop(): Promise<void>
  status(): ReadinessStatus
  /** resolves once ready; rejects if the service stops first */
  waitUntilReady(): Promise<void>
}

export type ReadinessOptions = {
  pool: Pick<Pool, 'query'>
  /** what is awaited; processes with the same key share one probe (readinessKey) */
  key: string
  /** one RPC read: true once everything the service needs exists on chain */
  probe: () => Promise<boolean>
  /** spacing of probes across all processes; 30 s notices a deploy within half a minute */
  probeEveryMs?: number
  /** how often each process reads the shared row */
  checkEveryMs?: number
}

/** The key hashes the endpoint (which may carry an API key) together with the awaited addresses. */
export const readinessKey = (rpcEndpoint: string, addresses: readonly string[]) =>
  createHash('sha256').update(JSON.stringify([rpcEndpoint, ...addresses])).digest('hex')

/** A probe over getMultipleAccountsInfo: the first account is the program (executable), the rest must exist. */
export const programProbe = (read: () => Promise<readonly ({ executable: boolean } | null)[]>) => async () => {
  const [program, ...rest] = await read()
  return !!program?.executable && rest.every((a) => a !== null)
}

/** Until the addresses a probe needs are configured (a lookup table made at launch), wait with no RPC and no database. */
export function waitingForConfig(): Readiness {
  let release = () => {}
  const stopped = new Promise<void>((resolve) => (release = resolve))
  return {
    start: async () => {},
    stop: async () => release(),
    status: () => 'waiting',
    waitUntilReady: async () => {
      await stopped
      throw new Error('Stopped before the program was ready.')
    },
  }
}

export function createReadiness(options: ReadinessOptions): Readiness {
  const { pool, key, probe, probeEveryMs = 30_000, checkEveryMs = 2_000 } = options
  let ready = false
  let stopped = false
  let timer: ReturnType<typeof setInterval> | undefined
  let inFlight: Promise<void> | undefined
  let seeded = false
  const waiters = new Set<() => void>()

  // Every time comparison runs on the database's clock, so replicas with drifting clocks still take turns.
  async function poll() {
    if (!seeded) {
      await pool.query(`INSERT INTO "ServiceReadiness" ("id") VALUES ($1) ON CONFLICT ("id") DO NOTHING`, [key])
      seeded = true
    }
    const reserved = await pool.query(
      `UPDATE "ServiceReadiness" SET "nextProbeAt" = NOW() + ($2::int * INTERVAL '1 millisecond')
       WHERE "id" = $1 AND "nextProbeAt" <= NOW() AND NOT "ready" RETURNING "id"`,
      [key, probeEveryMs],
    )
    if (reserved.rowCount) {
      try {
        const found = await probe()
        await pool.query(`UPDATE "ServiceReadiness" SET "ready" = $2, "checkedAt" = NOW(), "lastError" = NULL WHERE "id" = $1`, [key, found])
      } catch (error) {
        // A failed read is never taken as ready; the reservation already spaces the retry.
        const name = error instanceof Error ? error.name : 'Error'
        await pool.query(`UPDATE "ServiceReadiness" SET "lastError" = $2 WHERE "id" = $1`, [key, name])
        console.error(JSON.stringify({ level: 'error', event: 'readiness_probe_failed', name }))
      }
    }
    const row = await pool.query<{ ready: boolean }>(`SELECT "ready" FROM "ServiceReadiness" WHERE "id" = $1`, [key])
    if (row.rows[0]?.ready) {
      ready = true
      clearInterval(timer)
      for (const wake of waiters) wake()
    }
  }

  const tick = () => {
    if (ready || stopped) return Promise.resolve()
    inFlight ??= poll()
      .catch((error) => console.error(JSON.stringify({ level: 'error', event: 'readiness_database_failed', name: error?.name })))
      .finally(() => (inFlight = undefined))
    return inFlight
  }

  return {
    async start() {
      await tick()
      if (!ready) timer = setInterval(() => void tick(), checkEveryMs)
    },
    async stop() {
      stopped = true
      clearInterval(timer)
      await inFlight
      for (const wake of waiters) wake()
    },
    status: () => (ready ? 'ready' : 'waiting'),
    async waitUntilReady() {
      while (!ready && !stopped) {
        await new Promise<void>((resolve) => {
          const done = () => {
            waiters.delete(done)
            resolve()
          }
          waiters.add(done)
        })
      }
      if (!ready) throw new Error('Stopped before the program was ready.')
    },
  }
}

/** For routes that build transactions: answer PROGRAM_UNAVAILABLE (retryable) while waiting. */
export const requireReady =
  (readiness: Pick<Readiness, 'status'>, message = 'The program is not deployed yet.'): MiddlewareHandler =>
  async (_c, next) => {
    if (readiness.status() !== 'ready') fail('PROGRAM_UNAVAILABLE', message, { stage: 'build', retryable: true })
    await next()
  }
