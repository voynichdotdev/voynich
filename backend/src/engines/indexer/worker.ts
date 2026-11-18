// A background job that runs only while its process holds the leader lease. During a deploy the
// new instance stands by, healthy, until the old one lets go, then takes over; two never run the
// job at once. The lease is checked on an interval, which also renews it.

export interface Lease {
  acquire(): Promise<boolean>
  release(): Promise<void>
}

export interface Job {
  start(): Promise<void>
  stop(): Promise<void>
}

export type WorkerState = 'active' | 'standby' | 'stopped'

export function runWorker(options: { lease: Lease; job: Job; intervalMs?: number; log?(entry: Record<string, unknown>): void }) {
  const log = options.log ?? ((entry) => console.log(JSON.stringify(entry)))
  const failed = (event: string) => (error: unknown) => log({ level: 'error', event, message: error instanceof Error ? error.message : String(error) })
  let state: WorkerState = 'standby'
  let stopping = false
  let tick: Promise<void> | undefined

  async function maintain() {
    const owned = await options.lease.acquire()
    if (stopping) return
    if (owned && state === 'standby') {
      await options.job.start()
      state = 'active'
    } else if (!owned && state === 'active') {
      state = 'standby'
      await options.job.stop()
    }
  }

  const run = () => (tick ??= maintain().catch(failed('worker_tick_failed')).finally(() => (tick = undefined)))
  const timer = setInterval(run, options.intervalMs ?? 5000)
  void run()

  return {
    /** For a health route: a standby instance is healthy too. */
    state: () => state,

    /** Stops the job, then gives up the lease. Wire it to SIGTERM ahead of closing the database. */
    async stop() {
      if (stopping) return
      stopping = true
      clearInterval(timer)
      await tick
      if (state === 'active') await options.job.stop().catch(failed('worker_stop_failed'))
      state = 'stopped'
      await options.lease.release().catch(failed('worker_release_failed'))
    },
  }
}
