import type { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { Address, HardwareMeasurement } from '@voynich/contract'
import { SessionLease } from '../engines/indexer/session-lease.js'
import { runWorker } from '../engines/indexer/worker.js'
import { runLoop } from '../engines/server/lifecycle.js'

const health = z.object({ status: z.literal('ready'), enclave: Address, measurement: HardwareMeasurement })
const PROBE_INTERVAL_MS = 15000
const PROBE_TIMEOUT_MS = 3000

/** One API replica probes; every reader and replica uses the same stored result. */
export function runEnclaveHealth(options: { db: PrismaClient; connectionString: string; ready: () => boolean }) {
  const { db } = options
  const lease = new SessionLease({ connectionString: options.connectionString, name: 'voynich:enclave-health' })
  let controller: AbortController
  let loop: Promise<void>
  const job = {
    async start() {
      controller = new AbortController()
      loop = runLoop({ name: 'enclave-health', signal: controller.signal, everyMs: PROBE_INTERVAL_MS, run: async () => {
        if (!options.ready() || !lease.held) return 'waiting'
        const enclaves = await db.enclave.findMany({ include: { attestationRecord: true } })
        const results = await Promise.allSettled(enclaves.map(async enclave => {
          let reachable = false
          try {
            const response = await fetch(enclave.endpoint.replace(/\/+$/, '') + '/health', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(PROBE_TIMEOUT_MS)]) })
            if (response.status === 200) {
              const parsed = health.safeParse(await response.json())
              reachable = parsed.success && parsed.data.enclave === enclave.address && parsed.data.measurement === enclave.attestationRecord.measurement
            } else await response.body?.cancel()
          } catch {
            // A failed health request is an availability observation, not process failure.
          }
          if (controller.signal.aborted || !lease.held) return
          await db.$transaction(async tx => {
            // Do not apply a response from an endpoint replaced during this request.
            const update = await tx.enclave.updateMany({ where: { address: enclave.address, endpoint: enclave.endpoint, attestationRecord: { measurement: enclave.attestationRecord.measurement } }, data: { reachable, ...(reachable ? { lastSeen: new Date() } : {}) } })
            if (update.count && enclave.reachable !== reachable) await tx.$executeRaw`SELECT pg_notify('voynich_events', ${JSON.stringify({ type: 'enclave.updated', id: enclave.address })})`
          })
          if (enclave.reachable !== reachable) console.log(JSON.stringify({ event: 'enclave_health_changed', enclave: enclave.address, reachable }))
        }))
        const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
        if (failure) throw failure.reason
      } })
    },
    async stop() { controller.abort(); await loop },
  }
  return runWorker({ lease, job })
}
