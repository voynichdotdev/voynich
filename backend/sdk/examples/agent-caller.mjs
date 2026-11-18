#!/usr/bin/env node
/**
 * Autonomous agent caller for Voynich.
 *
 * Loads a Solana keypair from VOYNICH_KEYPAIR, calls a live sealed model via the
 * `voynich` SDK, runs an independent on-chain verification pass against the
 * returned Receipt, aborts non-zero unless all four checks pass, and emits (and
 * optionally POSTs) a structured JSON report carrying the receipt proof.
 */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Keypair } from '@solana/web3.js'
import { createVoynich } from 'voynich'

export const DEFAULT_API_URL = 'https://api.voynich.dev'
export const DEFAULT_SITE_URL = 'https://voynich.dev'
export const DEFAULT_MODEL = 'sketch-32'
export const DEFAULT_ANSWER_MODE = 'open'

/** Sample 280x280 stroke drawing (clock face with hands) for sketch-32. */
export const DEFAULT_DRAWING = {
  width: 280,
  height: 280,
  strokes: [
    Array.from({ length: 37 }, (_, i) => {
      const angle = (i / 36) * Math.PI * 2
      return [140 + Math.cos(angle) * 95, 140 + Math.sin(angle) * 95]
    }),
    [[140, 140], [140, 82]],
    [[140, 140], [198, 140]],
  ],
}

export function trimTrailingSlash(url) {
  return url.replace(/\/+$/, '')
}

export function parseAgentConfig(env = process.env) {
  const keypairPath = env.VOYNICH_KEYPAIR?.trim() || ''
  const apiUrl = trimTrailingSlash(env.VOYNICH_API_URL?.trim() || DEFAULT_API_URL)
  const siteUrl = trimTrailingSlash(env.VOYNICH_SITE_URL?.trim() || DEFAULT_SITE_URL)
  const model = env.VOYNICH_MODEL?.trim() || DEFAULT_MODEL
  const answerMode = (env.VOYNICH_ANSWER_MODE?.trim() || DEFAULT_ANSWER_MODE).toLowerCase()
  if (answerMode !== 'open' && answerMode !== 'sealed') {
    throw new Error(`VOYNICH_ANSWER_MODE must be "open" or "sealed" (received "${answerMode}").`)
  }
  const webhookUrl = env.REPORT_WEBHOOK_URL?.trim() || null
  return { keypairPath, apiUrl, siteUrl, model, answerMode, webhookUrl }
}

export async function loadKeypair(filePath) {
  if (!filePath) {
    throw new Error('VOYNICH_KEYPAIR is required and must point to a Solana JSON keypair file.')
  }
  let raw
  try {
    raw = JSON.parse(await readFile(resolve(filePath), 'utf8'))
  } catch {
    throw new Error('VOYNICH_KEYPAIR could not be read as a Solana JSON keypair file.')
  }
  if (!Array.isArray(raw) || raw.length !== 64 || !raw.every(n => Number.isInteger(n) && n >= 0 && n <= 255)) {
    throw new Error('VOYNICH_KEYPAIR must contain a 64-byte Solana keypair JSON array.')
  }
  return Keypair.fromSecretKey(Uint8Array.from(raw))
}

export function formatAgentReport({
  agent,
  model,
  answerMode,
  output,
  verification,
  siteUrl = DEFAULT_SITE_URL,
}) {
  if (!verification || verification.verified !== true) {
    const failed = ['signature', 'record', 'expiry', 'answer']
      .filter(name => !verification?.[name])
    const detail = verification?.reason || (failed.length ? `failed checks: ${failed.join(', ')}` : 'verification returned false')
    throw new Error(`Receipt verification failed: ${detail}`)
  }
  const receipt = verification.receipt
  const base = trimTrailingSlash(siteUrl)
  return {
    agent,
    model: receipt.modelName ?? model,
    answerMode: receipt.answerMode ?? answerMode,
    output,
    receiptAddress: receipt.address,
    receiptUrl: `${base}/receipts/${receipt.address}`,
    accountUrl: `${base}/account?wallet=${agent}`,
    slot: receipt.slot,
    transactionSignature: receipt.transactionSignature,
    verified: true,
    checks: {
      signature: verification.signature,
      record: verification.record,
      expiry: verification.expiry,
      answer: verification.answer,
    },
  }
}

export async function runAgentCall({
  client,
  agent,
  model = DEFAULT_MODEL,
  answerMode = DEFAULT_ANSWER_MODE,
  drawing = DEFAULT_DRAWING,
  siteUrl = DEFAULT_SITE_URL,
  webhookUrl = null,
  fetchImpl = globalThis.fetch,
}) {
  const result = await client.call(model, drawing, { answerMode })
  const verification = await client.verify(result.receipt.address)
  const report = formatAgentReport({
    agent,
    model,
    answerMode,
    output: result.output,
    verification,
    siteUrl,
  })
  if (webhookUrl) {
    const response = await fetchImpl(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(report),
    })
    if (!response.ok) {
      throw new Error(`REPORT_WEBHOOK_URL responded with HTTP ${response.status}.`)
    }
  }
  return report
}

async function main() {
  const config = parseAgentConfig(process.env)
  const signer = await loadKeypair(config.keypairPath)
  const client = createVoynich({ apiUrl: config.apiUrl, signer })
  const report = await runAgentCall({
    client,
    agent: signer.publicKey.toBase58(),
    model: config.model,
    answerMode: config.answerMode,
    drawing: DEFAULT_DRAWING,
    siteUrl: config.siteUrl,
    webhookUrl: config.webhookUrl,
  })
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  main().catch(error => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  })
}
