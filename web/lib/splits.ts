import {
  Address,
  type ModelSplit,
  type SplitRecipientInput,
  type TxStatus,
  type VoynichClient,
} from '@voynich/contract'
import { read } from './api'
import { bps } from './format'
import { send, type TxStageName } from './tx'

export const SPLIT_LIMITS = {
  maxRecipients: 8,
  totalBps: 10000,
} as const

export type SplitRowDraft = {
  wallet: string
  sharePct: string
}

export type SplitValidation =
  | { ok: true; recipients: SplitRecipientInput[]; totalBps: number }
  | { ok: false; error: string; totalBps: number }

export function formatSplitPct(shareBps: number): string {
  return bps(shareBps)
}

export function pctToBps(raw: string): number | null {
  const trimmed = raw.trim()
  if (!/^\d+(?:\.\d{1,2})?$/.test(trimmed)) return null
  const value = Math.round(Number(trimmed) * 100)
  if (!Number.isInteger(value) || value <= 0 || value > SPLIT_LIMITS.totalBps) return null
  return value
}

export function splitToDraft(
  split: ModelSplit | null | undefined,
  ownerWallet?: string,
): SplitRowDraft[] {
  if (split && split.active && split.recipients.length > 0) {
    return split.recipients.map((r) => ({
      wallet: r.wallet,
      sharePct: String(Number((r.shareBps / 100).toFixed(2))),
    }))
  }
  return ownerWallet
    ? [{ wallet: ownerWallet, sharePct: '100' }]
    : [{ wallet: '', sharePct: '' }]
}

export function validateSplitDraft(rows: readonly SplitRowDraft[]): SplitValidation {
  const active = rows.filter((r) => r.wallet.trim().length > 0 || r.sharePct.trim().length > 0)
  if (active.length === 0) {
    return { ok: false, error: 'Add at least one recipient, or use Clear split to disable routing.', totalBps: 0 }
  }
  if (active.length > SPLIT_LIMITS.maxRecipients) {
    return { ok: false, error: `At most ${SPLIT_LIMITS.maxRecipients} recipients are allowed.`, totalBps: 0 }
  }

  const seen = new Set<string>()
  const recipients: SplitRecipientInput[] = []
  let totalBps = 0

  for (let i = 0; i < active.length; i++) {
    const wallet = active[i]!.wallet.trim()
    const shareBps = pctToBps(active[i]!.sharePct)
    if (!Address.safeParse(wallet).success) {
      return { ok: false, error: `Row ${i + 1}: enter a valid Solana address.`, totalBps }
    }
    if (seen.has(wallet)) {
      return { ok: false, error: `Duplicate recipient address: ${wallet.slice(0, 10)}.`, totalBps }
    }
    seen.add(wallet)
    if (shareBps === null) {
      return { ok: false, error: `Row ${i + 1}: enter a share between 0.01% and 100%.`, totalBps }
    }
    totalBps += shareBps
    recipients.push({ wallet, shareBps })
  }

  if (totalBps !== SPLIT_LIMITS.totalBps) {
    return {
      ok: false,
      error: `Shares sum to ${formatSplitPct(totalBps)}. They must equal 100%.`,
      totalBps,
    }
  }

  return { ok: true, recipients, totalBps }
}

export function splitEquals(
  split: ModelSplit | null | undefined,
  recipients: readonly SplitRecipientInput[],
): boolean {
  if (!split || !split.active) return false
  if (split.recipients.length !== recipients.length) return false
  return split.recipients.every(
    (r, i) => r.wallet === recipients[i]!.wallet && r.shareBps === recipients[i]!.shareBps,
  )
}

export function splitSetCliCommand(
  modelName: string,
  recipients: readonly SplitRecipientInput[],
): string {
  if (recipients.length === 0) {
    return `voynich model split set ${modelName} --clear`
  }
  const flags = recipients.map((r) => `--recipient ${r.wallet}:${r.shareBps}`).join(' ')
  return `voynich model split set ${modelName} ${flags}`
}

export function totalUnclaimedLamports(split: Pick<ModelSplit, 'recipients'> | null | undefined): bigint {
  if (!split) return 0n
  let total = 0n
  for (const r of split.recipients) {
    total += BigInt(r.claimable)
  }
  return total
}

export async function loadModelSplit(
  client: VoynichClient,
  model: { address: string; hasSplit?: boolean },
  force = false,
): Promise<ModelSplit | null> {
  if (!force && model.hasSplit === false) return null
  const res = await read(client.modelSplit(model.address))
  if (!res.ok) return null
  return res.data
}

export async function setModelSplit(
  client: VoynichClient,
  modelId: string,
  wallet: string,
  recipients: SplitRecipientInput[],
  onStage?: (stage: TxStageName) => void,
): Promise<TxStatus> {
  const build = await client.setSplit(modelId, { wallet, recipients })
  return send(client, build, onStage)
}

export async function claimModelSplit(
  client: VoynichClient,
  modelId: string,
  wallet: string,
  recipient?: string,
  onStage?: (stage: TxStageName) => void,
): Promise<TxStatus> {
  const build = await client.claimSplit(modelId, recipient ? { wallet, recipient } : { wallet })
  return send(client, build, onStage)
}
