import type { Pass, PassPlan, SetPassPlanRequest, TxStatus, VoynichClient } from '@voynich/contract'
import { read } from './api'
import { send, type TxStageName } from './tx'

export type { Pass, PassPlan }

export function computePassSavingsPct(
  spotPrice: string | bigint,
  passPrice: string | bigint,
): number {
  const spot = typeof spotPrice === 'bigint' ? spotPrice : BigInt(spotPrice || '0')
  const pass = typeof passPrice === 'bigint' ? passPrice : BigInt(passPrice || '0')
  if (spot <= 0n || pass <= 0n || pass >= spot) return 0
  return Math.round(Number(((spot - pass) * 10000n) / spot) / 100)
}

export function findActiveModelPass(
  passes: readonly Pass[],
  modelAddress: string,
): Pass | null {
  return (
    passes.find(
      (p) => p.status === 'open' && p.model === modelAddress && p.callsRemaining > 0,
    ) ?? null
  )
}

export function passPlanCliCommand(
  modelName: string,
  plan: {
    pricePerCall: string
    minCalls: number
    maxCalls: number
    ttlSlots: string
    active: boolean
  },
): string {
  const base = `voynich pass plan set ${modelName} --price ${plan.pricePerCall} --min-calls ${plan.minCalls} --max-calls ${plan.maxCalls} --ttl-slots ${plan.ttlSlots}`
  return plan.active ? base : `${base} --inactive`
}

export async function loadModelPassPlan(
  client: VoynichClient,
  modelId: string,
): Promise<PassPlan | null> {
  const res = await read(client.modelPassPlan(modelId))
  if (!res.ok) return null
  return res.data
}

export async function loadAccountPasses(
  client: VoynichClient,
  wallet: string,
): Promise<Pass[]> {
  const res = await read(client.accountPasses(wallet))
  if (!res.ok) return []
  return res.data.items
}

export async function setModelPassPlan(
  client: VoynichClient,
  modelId: string,
  body: SetPassPlanRequest,
  onStage?: (stage: TxStageName) => void,
): Promise<TxStatus> {
  const build = await client.setPassPlan(modelId, body)
  return send(client, build, onStage)
}

export async function buyModelPass(
  client: VoynichClient,
  body: { wallet: string; model: string; callsTotal: number; nonce?: string },
  onStage?: (stage: TxStageName) => void,
): Promise<TxStatus> {
  const build = await client.buyPass(body)
  return send(client, build, onStage)
}

export async function closeModelPass(
  client: VoynichClient,
  body: { wallet: string; pass: string },
  onStage?: (stage: TxStageName) => void,
): Promise<TxStatus> {
  const build = await client.closePass(body)
  return send(client, build, onStage)
}
