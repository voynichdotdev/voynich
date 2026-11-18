import type { Prisma } from '@prisma/client'
import { IDL as VOYNICH_IDL } from 'voynich/idl/voynich'
import { IDL as ATTEST_IDL } from 'voynich/idl/attest'
import { IDL as BOUNTY_IDL } from 'voynich/idl/bounty'
import { normalizeLegacyVoynichEvent } from 'voynich/program'
import { anchorProgram } from '../engines/indexer/anchor.js'
import { Indexer, type WakeStream } from '../engines/indexer/indexer.js'
import { laserStream } from '../engines/indexer/laserstream.js'
import { PrismaIndexStore } from '../engines/indexer/prisma-store.js'
import { SessionLease } from '../engines/indexer/session-lease.js'
import { runWorker } from '../engines/indexer/worker.js'
import type { ChainRuntime } from '../runtime.js'
import { createFacts, type Facts } from './facts.js'
import { createApply } from './store.js'
import { runLoop } from '../engines/server/lifecycle.js'

export const DEFAULT_POLL_MS = 2_000
export const DEFAULT_RECONCILE_MS = 60_000

export type LaserStreamConfig = {
  endpoint: string
  apiKey: string
  reconcileMs: number
}

export function resolveLaserStreamConfig(env: {
  LASERSTREAM_ENDPOINT?: string
  LASERSTREAM_API_KEY?: string
  SOLANA_RPC_URL?: string
  INDEXER_RECONCILE_MS?: number
}): LaserStreamConfig | null {
  const endpoint = env.LASERSTREAM_ENDPOINT?.trim()
  if (!endpoint) return null
  let apiKey = env.LASERSTREAM_API_KEY?.trim() || ''
  if (!apiKey && env.SOLANA_RPC_URL) {
    try {
      apiKey = new URL(env.SOLANA_RPC_URL).searchParams.get('api-key')?.trim() ?? ''
    } catch {
      apiKey = ''
    }
  }
  if (!apiKey) return null
  return {
    endpoint,
    apiKey,
    reconcileMs: env.INDEXER_RECONCILE_MS ?? DEFAULT_RECONCILE_MS,
  }
}

export type IndexerDriverOptions = {
  addresses: string[]
  isReady: () => boolean
  catchUp: () => Promise<void>
  stopIndexer?: () => Promise<void>
  stream?: (wake: () => void) => Promise<WakeStream>
  pollMs?: number
  reconcileMs?: number
  retryMs?: number
  log?: (entry: Record<string, unknown>) => void
}

export function createIndexerJob(options: IndexerDriverOptions) {
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS
  const reconcileMs = options.reconcileMs ?? DEFAULT_RECONCILE_MS
  const retryMs = options.retryMs ?? 10_000
  let controller: AbortController | undefined
  let loop: Promise<void> | undefined
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let wakeStream: WakeStream | undefined
  let inFlight: Promise<void> | undefined
  let wakeQueued = false

  if (!options.stream) {
    return {
      async start() {
        controller = new AbortController()
        loop = runLoop({
          name: 'indexer',
          signal: controller.signal,
          everyMs: pollMs,
          run: async () => {
            if (!options.isReady()) return 'waiting'
            await options.catchUp()
          },
        })
      },
      async stop() {
        controller?.abort()
        await options.stopIndexer?.()
        await loop
      },
    }
  }

  const clearTimer = () => {
    if (timer) {
      clearTimeout(timer)
      timer = undefined
    }
  }

  const schedule = (delayMs: number) => {
    if (stopped) return
    clearTimer()
    timer = setTimeout(() => {
      timer = undefined
      void runCycle()
    }, delayMs)
  }

  const wake = () => {
    if (stopped) return
    if (inFlight) {
      wakeQueued = true
      return
    }
    schedule(0)
  }

  const ensureStream = async () => {
    if (wakeStream || stopped) return
    const opened = await options.stream!(wake)
    if (stopped) {
      await opened.close()
      return
    }
    wakeStream = opened
    await opened.setAddresses(options.addresses)
  }

  const runCycle = async () => {
    if (stopped || inFlight) return
    const task = (async () => {
      try {
        if (!options.isReady()) {
          schedule(pollMs)
          return
        }
        await ensureStream()
        await options.catchUp()
        const nextDelay = wakeQueued ? 0 : reconcileMs
        wakeQueued = false
        schedule(nextDelay)
      } catch (error) {
        wakeQueued = false
        options.log?.({ event: 'indexer_cycle_failed', error: error instanceof Error ? error.message : String(error) })
        schedule(retryMs)
      }
    })().finally(() => {
      inFlight = undefined
    })
    inFlight = task
    await task
  }

  return {
    async start() {
      stopped = false
      wakeQueued = false
      schedule(0)
    },
    async stop() {
      stopped = true
      clearTimer()
      const currentStream = wakeStream
      wakeStream = undefined
      await currentStream?.close()
      await options.stopIndexer?.()
      await inFlight
    },
  }
}

export async function runIndexer(runtime: ChainRuntime) {
  const { db, env, rpc, readiness, programs } = runtime
  const programId = programs.voynich.programId.toBase58()
  const attestProgramId = programs.attest.programId.toBase58()
  let fence = 0n
  const indexerRpc = { async call<T>(method: string, params?: unknown[]): Promise<T> {
    const value = await rpc.call<T>(method, params)
    if (method === 'getSlot') fence = BigInt(String(value))
    return value
  } }
  const voynichDecoder = anchorProgram({ ...VOYNICH_IDL, address: programId })
  const compatibleVoynich = {
    ...voynichDecoder,
    event: (bytes: Uint8Array) => voynichDecoder.event!(normalizeLegacyVoynichEvent(bytes)),
  }
  const bountyProgramId = runtime.bountyProgramId?.toBase58() ?? null
  const watchedAddresses = [
    programId,
    attestProgramId,
    runtime.addresses.config.toBase58(),
    runtime.addresses.attestConfig.toBase58(),
    ...(bountyProgramId ? [bountyProgramId] : []),
  ]
  const log = (entry: Record<string, unknown>) => console.log(JSON.stringify(entry))
  const makeIndexer = () => new Indexer<Facts, Prisma.TransactionClient>({
    rpc: indexerRpc, store: new PrismaIndexStore<Facts, Prisma.TransactionClient>(db, { lock: 'voynich:index-apply' }),
    programs: [
      compatibleVoynich,
      anchorProgram({ ...ATTEST_IDL, address: attestProgramId }),
      ...(bountyProgramId ? [anchorProgram({ ...BOUNTY_IDL, address: bountyProgramId })] : []),
    ],
    addresses: watchedAddresses,
    // Both programs occur in every legitimate state change; account-by-account
    // discovery would add one history poll per call without adding any facts.
    facts: createFacts(rpc.connection), apply: createApply(attestProgramId),
    log,
  })
  const lsConfig = resolveLaserStreamConfig(env)
  let indexer: ReturnType<typeof makeIndexer> | undefined
  const job = createIndexerJob({
    addresses: watchedAddresses,
    isReady: () => readiness.status() === 'ready',
    catchUp: async () => {
      indexer ??= makeIndexer()
      await indexer.catchUp()
      await db.$executeRaw`INSERT INTO "SharedProtocolState" (id, "currentSlot", "updatedAt") VALUES ('protocol', ${fence}, now())
        ON CONFLICT (id) DO UPDATE SET "currentSlot" = GREATEST("SharedProtocolState"."currentSlot", EXCLUDED."currentSlot"), "updatedAt" = now()`
    },
    stopIndexer: async () => {
      const current = indexer
      indexer = undefined
      await current?.stop()
    },
    ...(lsConfig
      ? {
          stream: laserStream({ endpoint: lsConfig.endpoint, apiKey: lsConfig.apiKey, log }),
          reconcileMs: lsConfig.reconcileMs,
        }
      : {}),
    log,
  })
  log(lsConfig
    ? { event: 'indexer_mode', mode: 'laserstream', endpoint: lsConfig.endpoint, reconcileMs: lsConfig.reconcileMs, addresses: watchedAddresses.length }
    : { event: 'indexer_mode', mode: 'poll', pollMs: DEFAULT_POLL_MS, addresses: watchedAddresses.length })
  const lease = new SessionLease({ connectionString: env.DATABASE_URL!, name: 'voynich:indexer' })
  return runWorker({ lease, job })
}
