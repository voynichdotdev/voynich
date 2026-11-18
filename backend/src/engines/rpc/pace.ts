// Pacing for one RPC budget. Every client of a named service in this process (a web3.js Connection,
// raw calls, the browser relay) takes its turn from one clock, so the service's rate is what its
// budget says however many clients it opens. getProgramAccounts also keeps its own wider spacing,
// without holding back the calls queued behind it.

export type PaceOptions = {
  /** requests a second for the whole service; every live service on a shared key adds up under the plan's cap */
  rps: number
  /** minimum gap between program scans; 0 on localnet */
  scanIntervalMs: number
}

export type RpcCall = { method: string; params?: readonly unknown[] }

// A holder read (a token program filtered to one mint) answers a page, so it keeps only the request pace.
const TOKEN_PROGRAMS = new Set(['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'])

const isScan = ({ method, params }: RpcCall) => method === 'getProgramAccounts' && !TOKEN_PROGRAMS.has(String(params?.[0]))

type Budget = PaceOptions & { nextCall: number; nextScan: number }
const budgets = new Map<string, Budget>()

export type Pacer = {
  /** reserves turns for the calls (a batch is several) and returns the wait in ms, or null if it would exceed maxWaitMs */
  reserve(calls: readonly RpcCall[], maxWaitMs?: number): number | null
  wait(calls: readonly RpcCall[]): Promise<void>
}

/** The pacer for a named service; the same name in one process shares one budget, the latest options win. */
export function pacer(service: string, options: PaceOptions): Pacer {
  let b = budgets.get(service)
  if (!b) budgets.set(service, (b = { ...options, nextCall: 0, nextScan: 0 }))
  else Object.assign(b, options)
  const budget = b

  function reserve(calls: readonly RpcCall[], maxWaitMs = Infinity) {
    const now = Date.now()
    const slot = Math.max(now, budget.nextCall)
    const scan = calls.some(isScan)
    const at = scan ? Math.max(slot, budget.nextScan) : slot
    if (at - now > maxWaitMs) return null
    // The request clock advances from `slot`, not `at`: a scan waiting for its own turn doesn't
    // push every later call behind it.
    budget.nextCall = slot + (Math.max(1, calls.length) * 1000) / budget.rps
    if (scan) budget.nextScan = at + budget.scanIntervalMs
    return at - now
  }

  return {
    reserve,
    async wait(calls) {
      const delay = reserve(calls)!
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
    },
  }
}
