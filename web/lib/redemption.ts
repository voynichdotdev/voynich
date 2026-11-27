'use client'

import { API_URL, API_URL_SERVER } from './env'
import { TxError, type TxStageName } from './tx'
import { wallet } from './wallet'
import { followStatus, signAndSubmit, walletFailure, type TxApi } from '@/src/engines/tx/client/flow'
import type { TxBuild, TxStatus } from '@/src/engines/tx/types'

export type RedemptionSummary = {
  open: boolean
  mint: string
  decimals: number
  snapshotSlot: number
  snapshotTimestampUtc: string
  snapshotSha256: string
  totalHolders: number
  totalEligibleRaw: string
  poolLamports: string
  vaultAddress: string | null
  claimedTokensRaw: string
  claimedLamports: string
  claimsCount: number
}

export type WalletRedemption = {
  wallet: string
  open: boolean
  eligible: boolean
  mint: string
  decimals: number
  snapshotSlot: number
  snapshotRaw: string
  shareBps: number
  sharePct: string
  liveBalanceRaw: string
  claimedTokensRaw: string
  claimedLamports: string
  remainingSnapshotRaw: string
  redeemableNowRaw: string
  poolLamports: string
  totalAllocationLamports: string
  redeemableNowLamports: string
  pendingBuildId: string | null
  lastSignature: string | null
}

type RedemptionBuild = TxBuild & {
  action: string
  requiredSigners: string[]
  fixture: boolean
  redeemableNowRaw: string
  payoutLamports: string
}

function baseUrl(): string {
  return (typeof window === 'undefined' ? API_URL_SERVER : API_URL).replace(/\/+$/, '')
}

function headers(fixture?: string | null): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (fixture) h['X-Fixture'] = fixture
  return h
}

async function parseJson<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    const err = body?.error
    const e = Object.assign(new Error(err?.message || `HTTP ${res.status}`), {
      code: err?.code ?? 'API_ERROR',
      status: res.status,
      body,
    })
    throw e
  }
  return body as T
}

export async function loadRedemptionSummary(fixture?: string | null): Promise<RedemptionSummary> {
  const res = await fetch(`${baseUrl()}/v1/redemption`, { headers: headers(fixture), cache: 'no-store' })
  return parseJson<RedemptionSummary>(res)
}

export async function loadWalletRedemption(address: string, fixture?: string | null): Promise<WalletRedemption> {
  const res = await fetch(`${baseUrl()}/v1/redemption/${encodeURIComponent(address)}`, {
    headers: headers(fixture),
    cache: 'no-store',
  })
  return parseJson<WalletRedemption>(res)
}

export async function claimRedemptionSol(
  address: string,
  onStage?: (stage: 'building' | TxStageName) => void,
  fixture?: string | null,
): Promise<TxStatus> {
  onStage?.('building')
  const buildRes = await fetch(`${baseUrl()}/v1/redemption/build`, {
    method: 'POST',
    headers: headers(fixture),
    body: JSON.stringify({ wallet: address }),
  })
  const build = await parseJson<RedemptionBuild>(buildRes)

  const txApi: TxApi = {
    submit: async (input) => {
      if (input.mode !== 'relay') {
        throw new TxError('Redemption requires server co-signing.', 'build', false)
      }
      const r = await fetch(`${baseUrl()}/v1/redemption/submit`, {
        method: 'POST',
        headers: headers(fixture),
        body: JSON.stringify({
          buildId: input.buildId,
          signedTransactionBase64: input.signedTransactionBase64,
          idempotencyKey: input.idempotencyKey,
        }),
      })
      return parseJson<TxStatus>(r)
    },
    status: async (id) => {
      const r = await fetch(`${baseUrl()}/v1/redemption/tx/${encodeURIComponent(id)}`, {
        headers: headers(fixture),
        cache: 'no-store',
      })
      return parseJson<TxStatus>(r)
    },
  }

  onStage?.('signing')
  let first: TxStatus
  try {
    first = await signAndSubmit(wallet.connection(), build, txApi, 'relay')
  } catch (e) {
    const f = (e as { failure?: ReturnType<typeof walletFailure> }).failure
    if (!f) throw e
    throw new TxError(f.message, f.stage, f.retryable, f.nextStep)
  }

  onStage?.('confirming')
  const last = await followStatus(txApi, first, { intervalMs: 700, timeoutMs: 90_000 })
  if (last.status === 'failed' || last.status === 'expired') {
    throw new TxError(
      last.error?.message ?? 'The claim transaction did not confirm.',
      last.error?.stage ?? 'confirm',
      last.error?.retryable ?? true,
      last.error?.nextStep,
    )
  }
  return last
}
