// Process lifecycle. Building a runtime (database, chain service, indexer) never starts its loops or
// binds a port, so scripts and rehearsals construct it freely; start() does that. One idempotent
// shutdown, shared by signals and in-process tests, aborts the loops and closes what was opened:
// a worker holding a lease releases it on SIGTERM, so the next deployment takes over at once.

export function createShutdown(close: () => Promise<void>) {
  const controller = new AbortController()
  let closing: Promise<void> | undefined
  const shutdown = () => {
    if (!closing) {
      controller.abort()
      closing = Promise.resolve().then(close)
    }
    return closing
  }
  return { signal: controller.signal, shutdown }
}

export function onShutdownSignals(shutdown: () => Promise<void>) {
  const stop = () =>
    void shutdown().then(
      () => process.exit(0),
      (error) => {
        console.error(JSON.stringify({ level: 'error', event: 'shutdown_failed', name: error?.name }))
        process.exit(1)
      },
    )
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
}

/** Waits, or returns early when the signal aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal?.addEventListener('abort', done, { once: true })
  })
}

export type LoopOptions = {
  name: string
  signal: AbortSignal
  /** one pass; 'waiting' while the program isn't there yet */
  run: () => Promise<'live' | 'waiting' | void>
  everyMs: number
  waitingMs?: number
  /**
   * A failed pass waits at least a minute: a fast tick retrying a failing setup (an unfunded keeper
   * at launch) turns into a loop of reads and simulations on a shared RPC key.
   */
  failureMs?: number
}

/** A worker loop that logs only when its status changes. Resolves once the signal aborts. */
export async function runLoop({ name, signal, run, everyMs, waitingMs = 30_000, failureMs = 60_000 }: LoopOptions) {
  let previous = ''
  while (!signal.aborted) {
    let status: string
    let delay: number
    try {
      status = (await run()) ?? 'live'
      delay = status === 'waiting' ? waitingMs : everyMs
    } catch (error) {
      status = 'failing'
      delay = failureMs
      console.error(JSON.stringify({ level: 'error', event: 'worker_failed', worker: name, name: error instanceof Error ? error.name : 'Error' }))
    }
    if (status !== previous) console.log(JSON.stringify({ level: 'info', event: 'worker_status', worker: name, status }))
    previous = status
    await sleep(delay, signal)
  }
}
