// One keeper process: hold the leader lease, wait while the deployment isn't ready (no program,
// no lookup table yet), and tick. Replicas without the lease stand by and stay healthy, so a
// rolling deploy never runs two keepers at once.

export type Lease = {
  /** true when this process now holds the lease */
  acquire(): Promise<boolean>
  /** false when it was lost; called every leaseMs / 3 while leading */
  renew(): Promise<boolean>
  release(): Promise<void>
}

export type KeeperHealth = { status: 'starting' | 'waiting' | 'standby' | 'ready' | 'stopping'; lastTickAt: string | null }

export type KeeperRuntimeOptions = {
  lease: Lease
  leaseMs: number
  tickMs: number
  /** 'waiting' until what the keeper needs exists on chain */
  gate?: () => Promise<'waiting' | 'ready'>
  tick: () => Promise<void>
  /** called when leadership is lost mid-run, to stop side work (a grinder, a stream) */
  onDemoted?: () => Promise<void>
  log?: (event: Record<string, unknown>) => void
}

export function createKeeperRuntime(options: KeeperRuntimeOptions) {
  const { lease, leaseMs, tickMs, gate = async () => 'ready' as const, tick, onDemoted, log } = options
  const health: KeeperHealth = { status: 'starting', lastTickAt: null }
  let leading = false
  let stopped = false
  let inTick = false
  let heartbeat: ReturnType<typeof setInterval> | undefined

  const demote = async () => {
    leading = false
    if (heartbeat) clearInterval(heartbeat)
    heartbeat = undefined
    await onDemoted?.().catch(() => {})
  }

  async function once() {
    if (inTick || stopped) return
    inTick = true
    try {
      if (!leading && (await lease.acquire())) {
        leading = true
        heartbeat = setInterval(() => {
          void lease.renew().then(
            (ok) => (ok ? undefined : demote()),
            () => demote(),
          )
        }, Math.max(250, Math.floor(leaseMs / 3)))
        heartbeat.unref?.()
      }
      if (!leading) {
        health.status = 'standby'
        return
      }
      if ((await gate()) !== 'ready') {
        health.status = 'waiting'
        return
      }
      health.status = 'ready'
      await tick()
    } finally {
      health.lastTickAt = new Date().toISOString()
      inTick = false
    }
  }

  async function run() {
    while (!stopped) {
      const started = Date.now()
      try {
        await once()
      } catch (e) {
        log?.({ event: 'keeper_tick_error', message: e instanceof Error ? e.message.slice(0, 200) : 'unknown' })
      }
      if (!stopped) await new Promise((r) => setTimeout(r, Math.max(0, tickMs - (Date.now() - started))))
    }
  }

  async function stop() {
    stopped = true
    health.status = 'stopping'
    while (inTick) await new Promise((r) => setTimeout(r, 25))
    if (leading) {
      await demote()
      await lease.release()
    }
  }

  /** Whether this process still leads; check it before every write that must be the leader's. */
  const isLeader = () => leading && !stopped

  return { run, stop, health, isLeader }
}
