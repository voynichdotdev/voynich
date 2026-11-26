import {
  Address,
  type ClaimReferralRequest,
  type Referral,
  type ReferralConfig,
  type SetReferralConfigRequest,
  type TxStatus,
  type VoynichClient,
} from '@voynich/contract'
import { read } from './api'
import { bps, units } from './format'
import { send, type TxStageName } from './tx'

export type { Referral, ReferralConfig }

export const MAX_REFERRAL_SHARE_BPS = 2500

export function formatReferralShare(shareBps: number): string {
  return bps(shareBps)
}

export function formatReferralBalance(
  amount: string | bigint,
  decimals = 9,
  symbol = 'SOL',
  maxFrac = 6,
): string {
  const raw = typeof amount === 'bigint' ? amount.toString() : amount || '0'
  return `${units(raw, decimals, maxFrac)} ${symbol}`
}

export function parseReferralFromParams(
  searchParams: Record<string, string | string[] | undefined> | URLSearchParams | null | undefined,
): string | null {
  if (!searchParams) return null
  const raw = searchParams instanceof URLSearchParams ? searchParams.get('ref') : searchParams.ref
  const val = Array.isArray(raw) ? raw[0] : raw
  if (typeof val !== 'string') return null
  const trimmed = val.trim()
  return Address.safeParse(trimmed).success ? trimmed : null
}

export function buildReferralLink(
  origin: string,
  modelId: string,
  referrerWallet: string,
): string {
  const base = origin.replace(/\/+$/, '')
  return `${base}/models/${encodeURIComponent(modelId)}?ref=${encodeURIComponent(referrerWallet)}`
}

export function referralSetCliCommand(
  modelName: string,
  shareBps: number,
  active: boolean,
): string {
  const base = `voynich model referral set ${modelName} --share-bps ${shareBps}`
  return active ? base : `${base} --inactive`
}

export async function loadModelReferralConfig(
  client: VoynichClient,
  modelId: string,
): Promise<ReferralConfig | null> {
  const res = await read(client.modelReferral(modelId))
  if (!res.ok) return null
  return res.data
}

export async function loadAccountReferrals(
  client: VoynichClient,
  wallet: string,
): Promise<Referral[]> {
  const res = await read(client.accountReferrals(wallet))
  if (!res.ok) return []
  return res.data.items
}

export async function setModelReferralConfig(
  client: VoynichClient,
  modelId: string,
  body: SetReferralConfigRequest,
  onStage?: (stage: TxStageName) => void,
): Promise<TxStatus> {
  const build = await client.setReferralConfig(modelId, body)
  return send(client, build, onStage)
}

export async function claimModelReferral(
  client: VoynichClient,
  modelId: string,
  body: ClaimReferralRequest,
  onStage?: (stage: TxStageName) => void,
): Promise<TxStatus> {
  const build = await client.claimReferral(modelId, body)
  return send(client, build, onStage)
}
