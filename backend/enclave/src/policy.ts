import { PolicyRegion } from '@voynich/contract'

export type EnclavePolicyRules = {
  allowedRegions: readonly string[]
  maxCallsPerCallerPerWindow: number
  windowSlots: bigint
}

export function parseEnclaveRegion(raw?: string): string | null {
  if (raw === undefined) return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  const parsed = PolicyRegion.safeParse(trimmed)
  if (!parsed.success) {
    throw new Error(`ENCLAVE_REGION must match ${PolicyRegion.description ?? 'lowercase alphanumeric and hyphen (1..16 chars)'}, got "${trimmed}".`)
  }
  return parsed.data
}

export function isRegionAllowed(policy: Pick<EnclavePolicyRules, 'allowedRegions'> | null, region: string | null): boolean {
  if (!policy || policy.allowedRegions.length === 0) return true
  return region !== null && policy.allowedRegions.includes(region)
}

export type RateLimitDecision =
  | { allowed: true; count: number }
  | { allowed: false; count: number; limit: number; windowSlots: bigint }

/** In-memory sliding-window per-(model, caller) call slot counter for owner policy ceilings. */
export class EnclaveRateLimiter {
  private readonly windows = new Map<string, bigint[]>()

  checkAndRecord(
    model: string,
    caller: string,
    currentSlot: bigint,
    maxCalls: number,
    windowSlots: bigint,
  ): RateLimitDecision {
    if (maxCalls <= 0 || windowSlots <= 0n) return { allowed: true, count: 0 }
    const key = `${model}:${caller}`
    const cutoff = currentSlot > windowSlots ? currentSlot - windowSlots : 0n
    const prev = this.windows.get(key) ?? []
    const active = prev.filter(slot => slot > cutoff)
    if (active.length >= maxCalls) {
      this.windows.set(key, active)
      return { allowed: false, count: active.length, limit: maxCalls, windowSlots }
    }
    active.push(currentSlot)
    this.windows.set(key, active)
    return { allowed: true, count: active.length }
  }

  clear(model?: string) {
    if (!model) {
      this.windows.clear()
      return
    }
    const prefix = `${model}:`
    for (const key of this.windows.keys()) {
      if (key.startsWith(prefix)) this.windows.delete(key)
    }
  }
}
