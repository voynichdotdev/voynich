'use client'

// On-chain bounty flows: draw via CPI into sketch-32 (open answer), verify all four receipt checks,
// collect the reward directly from the bounty program, post a new bounty, or cancel an open one.

import type { Bounty, Call, Model, RefundState, VoynichClient } from '@voynich/contract'
import { encryptCallInput, fromBase64, generateEncryptionKeyPair, sha256, toBase64, toHex, utf8 } from 'voynich/crypto'
import { indexed } from './api'
import { ENCRYPT_MS, follow, type Update } from './call'
import { errorMessage, send } from './tx'

const POLL_MS = 600
const CALL_COSTS = 3_000_000n // call + attempt rent and tx fee, in lamports, rounded up
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// Parses a positive decimal SOL string (up to 9 decimal places) into exact lamports without floating-point drift.
export function parseSolToLamports(raw: string): bigint | null {
  const s = raw.trim()
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(s)) return null
  const [whole = '0', frac = ''] = s.split('.')
  if (frac.length > 9) return null
  const lamports = BigInt(whole || '0') * 1_000_000_000n + BigInt(frac.padEnd(9, '0'))
  return lamports > 0n ? lamports : null
}

function refundStateOf(call: Call): RefundState {
  if (call.failure) return call.failure.refundState
  return call.status === 'refundable' ? 'refundable' : call.status === 'refunded' ? 'refunded' : call.status === 'open' ? 'pending-deadline' : 'unavailable'
}

async function shortOf(e: unknown, client: VoynichClient, model: Model, wallet: string): Promise<unknown> {
  if ((e as { code?: string }).code !== 'SIMULATION_FAILED' || model.price.mint !== null) return e
  try {
    const { rpcUrl } = await client.config()
    const r = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [wallet, { commitment: 'confirmed' }] }),
    })
    const balance = BigInt(((await r.json()) as { result: { value: number } }).result.value)
    if (balance < BigInt(model.price.amount) + CALL_COSTS) {
      return new Error('The wallet holds too little SOL for this draw. Add SOL to the wallet, then try again.')
    }
  } catch {}
  return e
}

export async function runBountyDraw(o: {
  client: VoynichClient
  bounty: Bounty
  model: Model
  wallet: string
  input: unknown
  update: Update
  signal?: AbortSignal
}) {
  const { client, bounty, model, wallet, input, update, signal } = o
  let call: Call | null = null
  try {
    const { items } = await client.modelEnclaves(model.address)
    const pick = items.find(({ enclave, grant }) => enclave.status === 'live' && grant.status === 'live' && enclave.reachable === true)
    if (!pick) throw new Error('No enclave holds a live grant for this model.')
    const reply = generateEncryptionKeyPair()
    const envelope = encryptCallInput(
      utf8(JSON.stringify({ input, outputPublicKey: toBase64(reply.publicKey) })),
      fromBase64(pick.enclave.encryptionKey),
    )
    const inputHash = toHex(sha256(envelope))
    update({ stage: 'encrypting', reached: 'encrypting', envelope, inputHash })
    const [build] = await Promise.all([
      client
        .drawBounty(bounty.address, { wallet, enclave: pick.enclave.address, inputHash })
        .catch(async (e) => { throw await shortOf(e, client, model, wallet) }),
      sleep(ENCRYPT_MS),
    ])
    if (signal?.aborted) return
    update({ stage: 'signing', reached: 'signing' })
    await send(client, build, (s) => update({ confirming: s === 'confirming' }))
    const address = build.addresses.call
    if (!address) throw new Error('The bounty draw opened without a call address.')
    call = await indexed(() => client.call(address), 'CALL_NOT_FOUND')
    update({ stage: 'escrowed', reached: 'escrowed', confirming: false, call })
    await Promise.all([client.relayInput(address, { envelope: toBase64(envelope) }), sleep(POLL_MS)])
    if (signal?.aborted) return
    update({ stage: 'answering', reached: 'answering' })
    await follow(client, model, address, inputHash, reply.secretKey, update, signal)
  } catch (e) {
    if (signal?.aborted) return
    let refundState: RefundState = 'unavailable'
    if (call) {
      try {
        call = await client.call(call.address)
        refundState = refundStateOf(call)
      } catch {
        refundState = 'pending-deadline'
      }
    }
    update({ stage: 'failed', confirming: false, call, failure: { message: errorMessage(e), refundState } })
  }
}

export async function collectBounty(o: {
  client: VoynichClient
  bountyAddress: string
  callAddress: string
  wallet: string
  onConfirming?: (confirming: boolean) => void
}): Promise<{ signature: string | null }> {
  const build = await o.client.collectBounty(o.bountyAddress, { wallet: o.wallet, call: o.callAddress })
  const status = await send(o.client, build, (s) => o.onConfirming?.(s === 'confirming'))
  return { signature: status.signature ?? null }
}

export async function postBounty(o: {
  client: VoynichClient
  modelId: string
  targetLabel: string
  lamports: bigint
  wallet: string
  onConfirming?: (confirming: boolean) => void
}): Promise<{ bountyAddress: string | null; signature: string | null }> {
  const build = await o.client.postBounty({
    wallet: o.wallet,
    model: o.modelId,
    targetLabel: o.targetLabel,
    reward: { amount: o.lamports.toString(), mint: null, decimals: 9, symbol: 'SOL' },
  })
  const status = await send(o.client, build, (s) => o.onConfirming?.(s === 'confirming'))
  return { bountyAddress: build.addresses.bounty ?? null, signature: status.signature ?? null }
}

export async function cancelBounty(o: {
  client: VoynichClient
  bountyAddress: string
  wallet: string
  onConfirming?: (confirming: boolean) => void
}): Promise<{ signature: string | null }> {
  const build = await o.client.cancelBounty(o.bountyAddress, { wallet: o.wallet })
  const status = await send(o.client, build, (s) => o.onConfirming?.(s === 'confirming'))
  return { signature: status.signature ?? null }
}

export async function refreshBounties(
  client: VoynichClient,
  ready?: (items: Bounty[]) => boolean,
  tries = 10,
): Promise<Bounty[]> {
  let last: Bounty[] = []
  for (let i = 0; i < tries; i++) {
    const page = await client.bounties({ limit: 50 })
    last = page.items
    if (!ready || ready(last)) return last
    await sleep(500)
  }
  return last
}

// Reads /v1/bounties/:address after a draw settles so single-tx on_receipt payouts are detected
// right away without prompting for a second collect signature.
export async function fetchBountyAfterSettle(
  client: VoynichClient,
  bountyAddress: string,
  callAddress: string,
  tries = 6,
  delayMs = 400,
): Promise<Bounty | null> {
  let last: Bounty | null = null
  for (let i = 0; i < tries; i++) {
    try {
      const detail = await client.bounty(bountyAddress)
      last = detail.bounty
      if (last.status === 'claimed' && last.winningCall === callAddress) return last
      if (last.status !== 'open') return last
    } catch {}
    if (i + 1 < tries) await sleep(delayMs)
  }
  return last
}
