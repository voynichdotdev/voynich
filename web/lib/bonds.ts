import type { VoynichClient } from '@voynich/contract'
import { read } from './api'
import { units } from './format'

export type EnclaveBond = Awaited<ReturnType<VoynichClient['enclaveBond']>>

export const DEFAULT_BOND_SLASH_BPS = 1000

export function formatBondSol(
  lamports: string | bigint | null | undefined,
  maxFrac = 4,
): string {
  if (lamports === null || lamports === undefined || lamports === '') return 'Unbonded'
  const raw = typeof lamports === 'bigint' ? lamports : BigInt(lamports)
  if (raw <= 0n) return 'Unbonded'
  return `${units(raw.toString(), 9, maxFrac)} SOL`
}

export function computeUptimePct(
  callsSettled: string | number | bigint,
  missedCalls: string | number | bigint | null | undefined,
): string {
  const settled = BigInt(callsSettled || 0)
  const missed = BigInt(missedCalls || 0)
  const total = settled + missed
  if (total <= 0n || missed <= 0n) return '100%'
  const pct = Number((settled * 10000n) / total) / 100
  if (Number.isInteger(pct)) return `${pct.toFixed(0)}%`
  return `${Number(pct.toFixed(2))}%`
}

export function bondCliCommand(
  action: 'show' | 'deposit' | 'withdraw',
  enclaveKey?: string,
  lamports?: string | number,
): string {
  if (action === 'show') {
    return enclaveKey ? `voynich enclave bond show ${enclaveKey}` : 'voynich enclave bond show'
  }
  const amount = lamports !== undefined ? String(lamports) : action === 'deposit' ? '100000000' : '50000000'
  return enclaveKey
    ? `voynich enclave bond ${action} ${amount} --enclave ${enclaveKey}`
    : `voynich enclave bond ${action} ${amount}`
}

export async function loadEnclaveBond(
  client: VoynichClient,
  key: string,
): Promise<EnclaveBond | null> {
  const res = await read(client.enclaveBond(key))
  if (!res.ok) return null
  return res.data
}
