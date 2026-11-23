import {
  Address, PolicyRegion,
  type ModelPolicy, type SetPolicyRequest, type VoynichClient,
} from '@voynich/contract'
import { read } from './api'
import { group } from './format'

export const POLICY_LIMITS = {
  callers: 32,
  operators: 16,
  regions: 8,
  regionBytes: 16,
} as const

export type PolicyDraft = {
  allowListEnabled: boolean
  allowedCallersText: string
  maxCallsText: string
  windowSlotsText: string
  allowedOperatorsText: string
  allowedRegionsText: string
}

export type PolicyErrors = Partial<Record<'allowedCallers' | 'rate' | 'allowedOperators' | 'allowedRegions', string>>

export type PolicyBody = Omit<SetPolicyRequest, 'wallet'>

export const EMPTY_POLICY_DRAFT: PolicyDraft = {
  allowListEnabled: false,
  allowedCallersText: '',
  maxCallsText: '0',
  windowSlotsText: '0',
  allowedOperatorsText: '',
  allowedRegionsText: '',
}

export function policyToDraft(policy: ModelPolicy | null | undefined): PolicyDraft {
  if (!policy) return { ...EMPTY_POLICY_DRAFT }
  return {
    allowListEnabled: policy.allowListEnabled,
    allowedCallersText: policy.allowedCallers.join('\n'),
    maxCallsText: String(policy.maxCallsPerCallerPerWindow),
    windowSlotsText: policy.windowSlots,
    allowedOperatorsText: policy.allowedOperators.join('\n'),
    allowedRegionsText: policy.allowedRegions.join(', '),
  }
}

export async function loadModelPolicy(
  client: VoynichClient,
  model: { address: string; hasPolicy?: boolean },
  force = false,
): Promise<ModelPolicy | null> {
  if (!force && model.hasPolicy === false) return null
  const res = await read(client.modelPolicy(model.address))
  if (!res.ok) return null
  return res.data
}

export function isCallerAllowedByPolicy(
  policy: Pick<ModelPolicy, 'allowListEnabled' | 'allowedCallers'> | null | undefined,
  walletAddress: string | null | undefined,
): boolean {
  if (!policy || !policy.allowListEnabled) return true
  if (!walletAddress) return true
  return policy.allowedCallers.includes(walletAddress)
}

export function parseAddressList(
  raw: string,
  max: number,
  label: string,
): { ok: true; values: string[] } | { ok: false; error: string } {
  const parts = raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  const seen = new Set<string>()
  const values: string[] = []
  for (const part of parts) {
    if (!Address.safeParse(part).success) {
      return { ok: false, error: `Invalid ${label} address: ${part.slice(0, 12)}.` }
    }
    if (!seen.has(part)) {
      seen.add(part)
      values.push(part)
    }
  }
  if (values.length > max) {
    return { ok: false, error: `At most ${max} ${label} addresses are allowed.` }
  }
  return { ok: true, values }
}

export function parseRegionList(
  raw: string,
): { ok: true; values: string[] } | { ok: false; error: string } {
  const parts = raw
    .split(/[\s,]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  const seen = new Set<string>()
  const values: string[] = []
  for (const part of parts) {
    if (!PolicyRegion.safeParse(part).success) {
      return { ok: false, error: `Invalid region "${part}". Use 1 to ${POLICY_LIMITS.regionBytes} lowercase letters, digits, or hyphens.` }
    }
    if (!seen.has(part)) {
      seen.add(part)
      values.push(part)
    }
  }
  if (values.length > POLICY_LIMITS.regions) {
    return { ok: false, error: `At most ${POLICY_LIMITS.regions} regions are allowed.` }
  }
  return { ok: true, values }
}

const U32_MAX = 0xffff_ffff
const U64_MAX = 18446744073709551615n

export function validatePolicyDraft(
  draft: PolicyDraft,
): { ok: true; body: PolicyBody } | { ok: false; errors: PolicyErrors } {
  const errors: PolicyErrors = {}

  const callers = parseAddressList(draft.allowedCallersText, POLICY_LIMITS.callers, 'caller')
  if (!callers.ok) errors.allowedCallers = callers.error

  const operators = parseAddressList(draft.allowedOperatorsText, POLICY_LIMITS.operators, 'operator')
  if (!operators.ok) errors.allowedOperators = operators.error

  const regions = parseRegionList(draft.allowedRegionsText)
  if (!regions.ok) errors.allowedRegions = regions.error

  const maxRaw = draft.maxCallsText.trim() || '0'
  const winRaw = draft.windowSlotsText.trim() || '0'
  let maxCalls = 0
  let windowSlots = 0n
  if (!/^\d+$/.test(maxRaw) || !/^\d+$/.test(winRaw)) {
    errors.rate = 'Enter whole numbers for max calls and window slots.'
  } else {
    maxCalls = Number(maxRaw)
    windowSlots = BigInt(winRaw)
    if (!Number.isSafeInteger(maxCalls) || maxCalls < 0 || maxCalls > U32_MAX) {
      errors.rate = 'Max calls must be between 0 and 4,294,967,295.'
    } else if (windowSlots < 0n || windowSlots > U64_MAX) {
      errors.rate = 'Window slots must be a valid unsigned 64-bit integer.'
    } else if ((maxCalls > 0) !== (windowSlots > 0n)) {
      errors.rate = 'Set both max calls and window slots, or leave both at 0.'
    }
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors }
  }
  return {
    ok: true,
    body: {
      allowListEnabled: draft.allowListEnabled,
      allowedCallers: callers.ok ? callers.values : [],
      maxCallsPerCallerPerWindow: maxCalls,
      windowSlots: windowSlots.toString(),
      allowedOperators: operators.ok ? operators.values : [],
      allowedRegions: regions.ok ? regions.values : [],
    },
  }
}

export function policyEquals(policy: ModelPolicy | null | undefined, body: PolicyBody): boolean {
  if (!policy) return false
  if (policy.allowListEnabled !== body.allowListEnabled) return false
  if (policy.maxCallsPerCallerPerWindow !== body.maxCallsPerCallerPerWindow) return false
  if (policy.windowSlots !== body.windowSlots) return false
  const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((v, i) => v === b[i])
  return (
    sameList(policy.allowedCallers, body.allowedCallers) &&
    sameList(policy.allowedOperators, body.allowedOperators) &&
    sameList(policy.allowedRegions, body.allowedRegions)
  )
}

export function formatRateCeiling(policy: Pick<ModelPolicy, 'maxCallsPerCallerPerWindow' | 'windowSlots'>): string | null {
  if (policy.maxCallsPerCallerPerWindow <= 0 || BigInt(policy.windowSlots) <= 0n) return null
  const unit = policy.maxCallsPerCallerPerWindow === 1 ? 'call' : 'calls'
  return `${group(policy.maxCallsPerCallerPerWindow)} ${unit} / ${group(policy.windowSlots)} slots`
}
