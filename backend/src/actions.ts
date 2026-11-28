import type { Context } from 'hono'
import { PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js'
import { ACTIONS_VERSION, SOLANA_MAINNET_CHAIN_ID, type ActionGetResponse, type Model, type PassPlan } from '@voynich/contract'
import { encryptCallInput, fromBase64, generateEncryptionKeyPair, sha256, toBase64, toHex, utf8 } from 'voynich/crypto'

export const ACTIONS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Content-Encoding, Accept-Encoding, X-Accept-Action-Version, X-Accept-Blockchain-Ids',
  'Access-Control-Expose-Headers': 'X-Action-Version, X-Blockchain-Ids',
  'X-Action-Version': ACTIONS_VERSION,
  'X-Blockchain-Ids': SOLANA_MAINNET_CHAIN_ID,
}

export function applyActionsHeaders(c: Context) {
  for (const [key, value] of Object.entries(ACTIONS_HEADERS)) {
    c.header(key, value)
  }
}

export function formatSol(lamports: string): string {
  const n = BigInt(lamports)
  const whole = n / 1_000_000_000n
  const frac = (n % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '')
  return frac ? `${whole}.${frac} SOL` : `${whole} SOL`
}

export function buildPassActionMeta(model: Model, plan: PassPlan | null, webUrl = 'https://voynich.dev'): ActionGetResponse {
  const webBase = webUrl.replace(/\/+$/, '')
  const icon = `${webBase}/icon.png`
  const hrefBase = `/v1/actions/models/${encodeURIComponent(model.name)}/pass`
  if (!plan || !plan.active) {
    return {
      type: 'action',
      icon,
      title: `Voynich Pass: ${model.name}`,
      description: `No active prepaid pass plan is currently configured for ${model.name}.`,
      label: 'Pass unavailable',
      disabled: true,
    }
  }
  const minCalls = Math.max(1, plan.minCalls)
  const doubleCalls = Math.min(plan.maxCalls, minCalls * 2)
  const unitPrice = plan.mint === null ? formatSol(plan.pricePerCall) : `${plan.pricePerCall} units`
  const actions: NonNullable<ActionGetResponse['links']>['actions'] = [
    {
      type: 'transaction',
      label: `Buy ${minCalls} calls`,
      href: `${hrefBase}?calls=${minCalls}`,
    },
  ]
  if (doubleCalls > minCalls) {
    actions.push({
      type: 'transaction',
      label: `Buy ${doubleCalls} calls`,
      href: `${hrefBase}?calls=${doubleCalls}`,
    })
  }
  actions.push({
    type: 'transaction',
    label: 'Buy custom pass',
    href: `${hrefBase}?calls={calls}`,
    parameters: [
      {
        name: 'calls',
        label: `Number of calls (${plan.minCalls} to ${plan.maxCalls})`,
        required: true,
        type: 'number',
        min: plan.minCalls,
        max: plan.maxCalls,
      },
    ],
  })
  return {
    type: 'action',
    icon,
    title: `Buy ${model.name} Pass`,
    description: `Prepay calls on sealed model ${model.name} at ${unitPrice} per call (${plan.minCalls}-${plan.maxCalls} calls). Unused escrow returns on close.`,
    label: `Buy ${minCalls} calls`,
    links: { actions },
  }
}

export function buildCallActionMeta(model: Model, ref?: string, webUrl = 'https://voynich.dev'): ActionGetResponse {
  const webBase = webUrl.replace(/\/+$/, '')
  const icon = `${webBase}/icon.png`
  const refSuffix = ref ? `&ref=${encodeURIComponent(ref)}` : ''
  const hrefBase = `/v1/actions/models/${encodeURIComponent(model.name)}/call`
  const priceLabel = model.price.mint === null ? formatSol(model.price.amount) : `${model.price.amount} ${model.price.symbol}`
  const isText = model.manifest.inputKind === 'text'

  const actions: NonNullable<ActionGetResponse['links']>['actions'] = isText
    ? [
        {
          type: 'transaction',
          label: `Call ${model.name}`,
          href: `${hrefBase}?prompt={prompt}${refSuffix}`,
          parameters: [
            {
              name: 'prompt',
              label: 'Prompt for encrypted enclave inference',
              required: true,
              type: 'text',
            },
          ],
        },
      ]
    : [
        {
          type: 'transaction',
          label: `Run sample on ${model.name}`,
          href: ref ? `${hrefBase}?ref=${encodeURIComponent(ref)}` : hrefBase,
        },
      ]

  return {
    type: 'action',
    icon,
    title: `Call ${model.name} on Voynich`,
    description: isText
      ? `Run sealed inference on ${model.name} (${priceLabel}/${model.priceUnit}) with hardware-signed on-chain receipt.`
      : `Run a sample encrypted call on ${model.name} (${priceLabel}/${model.priceUnit}) with an open verifiable receipt on Solana.`,
    label: `Call ${model.name}`,
    disabled: model.status !== 'live',
    links: { actions },
  }
}

export function encryptActionCallInput(model: Model, enclaveEncryptionKeyBase64: string, prompt?: string, maxTokens?: number): { inputHash: string; envelope: string } {
  const reply = generateEncryptionKeyPair()
  const payload = model.manifest.inputKind === 'text'
    ? {
        input: (prompt && prompt.trim()) ? prompt.trim() : 'Hello from Solana Blinks',
        ...(maxTokens !== undefined ? { maxTokens } : {}),
        outputPublicKey: toBase64(reply.publicKey),
      }
    : {
        input: new Array<number>(784).fill(0),
        outputPublicKey: toBase64(reply.publicKey),
      }
  const encrypted = encryptCallInput(utf8(JSON.stringify(payload)), fromBase64(enclaveEncryptionKeyBase64))
  return {
    inputHash: toHex(sha256(encrypted)),
    envelope: toBase64(encrypted),
  }
}

export function buildFixtureActionTransaction(account: string): string {
  const payer = new PublicKey(account)
  const ix = SystemProgram.transfer({ fromPubkey: payer, toPubkey: payer, lamports: 0 })
  const msg = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: PublicKey.default.toBase58(),
    instructions: [ix],
  }).compileToV0Message()
  return Buffer.from(new VersionedTransaction(msg).serialize()).toString('base64')
}
