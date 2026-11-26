'use client'

// One call, from an input on this device to a verified answer: encrypt to the enclave, open the call
// (the price goes into escrow), relay the envelope, wait for the answer, check the receipt, decrypt.
// The panel reads the state this writes; nothing here touches the screen.

import { ProgramEvent, StreamPiece as StreamPieceSchema, fromBase58, type AnswerMode, type Call, type Config, type GrantedEnclaves, type Model, type RefundState, type StreamFinishReason, type StreamPiece, type VoynichClient } from '@voynich/contract'
import { FIXTURE } from '@voynich/contract/fixtures'
import type { Keypair } from '@solana/web3.js'
import { selectEnclave, type RoutingStrategy } from 'voynich'
import { decryptCallOutput, encryptCallInput, fromBase64, fromHex, generateEncryptionKeyPair, sha256, streamInitialHash, streamNextHash, toBase64, toHex, utf8, verifyPiece } from 'voynich/crypto'
import { indexed } from './api'
import { money } from './format'
import { submitDelegateBuild } from './sessions'
import { errorMessage, send } from './tx'
import { verifyAll, type CheckResult } from './verify'

export { selectEnclave, type RoutingStrategy }

export type FlightStage = 'encrypting' | 'signing' | 'escrowed' | 'answering' | 'streaming'
export type Stage = 'idle' | FlightStage | 'verified' | 'failed' | 'refunded'

export type Score = { label: string; probability: number }
// What the enclave returned, decrypted here. `scores` is sorted, highest first; `text`/`tokens`/`finishReason` are set on text generation; `raw` is the payload as it came.
export type Output = { label: string | null; scores: Score[]; text: string | null; tokens: number | null; finishReason: string | null; raw: unknown }

export type StreamLastPiece = { index: number; count: number; runningHash: string; signature: string }

export type StreamProgress = {
  text: string
  count: number
  pieces: number
  spentAmount: string
  remainingAmount: string
  ceilingAmount: string
  finishReason: StreamFinishReason | null
  stopping: boolean
  stopError: string | null
  lastPiece: StreamLastPiece | null
}

export type SettlementSummary = {
  deliveredCount: string
  paidAmount: string
  returnedAmount: string
  ceilingAmount: string
}

export type SavedStreamPiece = {
  call: string
  model: string
  modelName: string
  index: number
  count: number
  runningHash: string
  signature: string
  spentAmount: string
  remainingAmount: string
  ceilingAmount: string
  deadlineSlot: string
  updatedAt: number
}

export const STREAM_PIECES_STORAGE_KEY = 'voynich:stream-pieces:v1'
export const STREAM_PIECES_MAX_ENTRIES = 50
export const STREAM_PIECES_TTL_MS = 7 * 24 * 60 * 60 * 1000

function isSavedStreamPiece(x: unknown): x is SavedStreamPiece {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  return (
    typeof o.call === 'string' &&
    typeof o.model === 'string' &&
    typeof o.modelName === 'string' &&
    typeof o.index === 'number' && Number.isSafeInteger(o.index) && o.index >= 0 &&
    typeof o.count === 'number' && Number.isSafeInteger(o.count) && o.count >= 0 &&
    typeof o.runningHash === 'string' && /^[0-9a-f]{64}$/i.test(o.runningHash) &&
    typeof o.signature === 'string' && o.signature.length > 0 &&
    typeof o.spentAmount === 'string' &&
    typeof o.remainingAmount === 'string' &&
    typeof o.ceilingAmount === 'string' &&
    typeof o.deadlineSlot === 'string' &&
    typeof o.updatedAt === 'number' && Number.isFinite(o.updatedAt)
  )
}

export function loadSavedStreamPieces(now = Date.now()): Record<string, SavedStreamPiece> {
  try {
    if (typeof localStorage === 'undefined') return {}
    const raw = localStorage.getItem(STREAM_PIECES_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Record<string, SavedStreamPiece> = {}
    let pruned = false
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (isSavedStreamPiece(v) && now - v.updatedAt <= STREAM_PIECES_TTL_MS) {
        out[k] = v
      } else {
        pruned = true
      }
    }
    if (pruned) {
      localStorage.setItem(STREAM_PIECES_STORAGE_KEY, JSON.stringify(out))
    }
    return out
  } catch {
    return {}
  }
}

export function saveStreamPiece(entry: SavedStreamPiece, now = Date.now()): void {
  try {
    if (typeof localStorage === 'undefined') return
    const current = loadSavedStreamPieces(now)
    const sanitized: SavedStreamPiece = {
      call: entry.call,
      model: entry.model,
      modelName: entry.modelName,
      index: entry.index,
      count: entry.count,
      runningHash: entry.runningHash,
      signature: entry.signature,
      spentAmount: entry.spentAmount,
      remainingAmount: entry.remainingAmount,
      ceilingAmount: entry.ceilingAmount,
      deadlineSlot: entry.deadlineSlot,
      updatedAt: entry.updatedAt,
    }
    current[sanitized.call] = sanitized
    const entries = Object.values(current)
      .filter((e) => now - e.updatedAt <= STREAM_PIECES_TTL_MS)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, STREAM_PIECES_MAX_ENTRIES)
    const next: Record<string, SavedStreamPiece> = {}
    for (const e of entries) next[e.call] = e
    localStorage.setItem(STREAM_PIECES_STORAGE_KEY, JSON.stringify(next))
  } catch {}
}

export function getSavedStreamPiece(callAddress: string, now = Date.now()): SavedStreamPiece | null {
  return loadSavedStreamPieces(now)[callAddress] ?? null
}

export function removeSavedStreamPiece(callAddress: string): void {
  try {
    if (typeof localStorage === 'undefined') return
    const current = loadSavedStreamPieces()
    if (!(callAddress in current)) return
    delete current[callAddress]
    localStorage.setItem(STREAM_PIECES_STORAGE_KEY, JSON.stringify(current))
  } catch {}
}

export type CallState = {
  stage: Stage
  // the last stage the call was seen in before it ended, so a failure shows where it stopped
  reached: FlightStage | null
  confirming: boolean
  envelope: Uint8Array | null
  inputHash: string | null
  call: Call | null
  receipt: string | null
  checks: CheckResult[]
  output: Output | null
  stream: StreamProgress | null
  settlement: SettlementSummary | null
  failure: { message: string; refundState: RefundState } | null
}

export const IDLE: CallState = { stage: 'idle', reached: null, confirming: false, envelope: null, inputHash: null, call: null, receipt: null, checks: [], output: null, stream: null, settlement: null, failure: null }

export type Update = (patch: Partial<CallState>) => void

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
// How long the input is shown turning into ciphertext before the wallet opens.
export const ENCRYPT_MS = 900
const POLL_MS = 600

export function decodeOutput(raw: unknown): Output {
  const o = raw as { label?: unknown; probability?: unknown; scores?: unknown; text?: unknown; tokens?: unknown; finishReason?: unknown } | null
  const scores: Score[] = Array.isArray(o?.scores)
    ? (o.scores as unknown[]).flatMap((s) => {
        const x = s as { label?: unknown; probability?: unknown } | null
        return typeof x?.label === 'string' && typeof x.probability === 'number' ? [{ label: x.label, probability: x.probability }] : []
      })
    : []
  if (scores.length === 0 && typeof o?.label === 'string' && typeof o?.probability === 'number') {
    scores.push({ label: o.label, probability: o.probability })
  }
  scores.sort((a, b) => b.probability - a.probability)
  return {
    label: typeof o?.label === 'string' ? o.label : scores[0]?.label ?? null,
    scores,
    text: typeof o?.text === 'string' ? o.text : null,
    tokens: typeof o?.tokens === 'number' && Number.isFinite(o.tokens) ? o.tokens : null,
    finishReason: typeof o?.finishReason === 'string' ? o.finishReason : null,
    raw,
  }
}

export function decodeOpenAnswer(openAnswerBase64: string): { text: string; byteLength: number; output: Output | null } {
  const bytes = fromBase64(openAnswerBase64)
  const text = new TextDecoder().decode(bytes)
  try {
    const parsed = JSON.parse(text) as unknown
    return { text, byteLength: bytes.length, output: decodeOutput(parsed) }
  } catch {
    return { text, byteLength: bytes.length, output: null }
  }
}

function refundStateOf(call: Call): RefundState {
  if (call.failure) return call.failure.refundState
  return call.status === 'refundable' ? 'refundable' : call.status === 'refunded' ? 'refunded' : call.status === 'open' ? 'pending-deadline' : 'unavailable'
}

// Wait for the enclave, then check what it sent before anything is read.
export async function follow(client: VoynichClient, model: Model, address: string, inputHash: string | null, secret: Uint8Array, update: Update, signal?: AbortSignal) {
  let answer = await client.answer(address)
  while (answer.status === 'waiting') {
    await sleep(POLL_MS)
    if (signal?.aborted) return
    answer = await client.answer(address)
  }
  if (signal?.aborted) return
  const openCall = answer.call.answerMode === 'open'
  if (answer.status === 'failed' || !answer.receiptAddress || (!openCall && !answer.outputEnvelope)) {
    const f = answer.failure ?? answer.call.failure
    const refundState = f?.refundState ?? refundStateOf(answer.call)
    update({ stage: refundState === 'refunded' ? 'refunded' : 'failed', call: answer.call, failure: { message: f?.message ?? 'The enclave did not answer before the deadline.', refundState } })
    return
  }
  const receiptAddress = answer.receiptAddress
  const view = await indexed(() => client.receipt(receiptAddress), 'RECEIPT_NOT_FOUND')
  const r = view.receipt
  const isOpen = r.answerMode === 'open' || openCall
  const openB64 = r.openAnswer ?? answer.openAnswer
  if (isOpen) {
    if (!openB64) throw new Error('The receipt does not carry an open answer.')
    const openBytes = fromBase64(openB64)
    if (r.call !== address || (inputHash !== null && r.inputHash !== inputHash) || r.outputHash !== toHex(sha256(openBytes))) {
      throw new Error('The receipt does not match this call and its open answer.')
    }
  } else {
    const envelope = fromBase64(answer.outputEnvelope!)
    if (r.call !== address || (inputHash !== null && r.inputHash !== inputHash) || r.outputHash !== toHex(sha256(envelope))) {
      throw new Error('The receipt does not match this call and its answer.')
    }
  }
  if (!model.allowedMeasurements.includes(view.attestationRecord.measurement)) throw new Error('The enclave that answered runs a measurement this model does not allow.')
  let config: Config | null = null
  try { config = await client.config() } catch {}
  const checks: CheckResult[] = []
  update({ call: answer.call, receipt: r.address, checks })
  await verifyAll(view, config, (c) => { checks.push(c); update({ checks: [...checks] }) })
  if (signal?.aborted) return
  const bad = checks.find((c) => !c.passed)
  if (bad) {
    update({ stage: 'failed', failure: { message: bad.detail, refundState: 'unavailable' } })
    return
  }
  let output: Output
  if (isOpen) {
    const decoded = decodeOpenAnswer(openB64!)
    output = decoded.output ?? { label: null, scores: [], text: null, tokens: null, finishReason: null, raw: decoded.text }
  } else {
    const envelope = fromBase64(answer.outputEnvelope!)
    output = decodeOutput(JSON.parse(new TextDecoder().decode(decryptCallOutput(envelope, secret))))
  }
  update({ stage: 'verified', output })
}

export type VerifyBrowserPieceInput = {
  piece: StreamPiece
  expectedCall: string
  expectedIndex: number
  previousCount: number
  previousRunningHash: Uint8Array
  enclaveSigningKey: string
  inputHash: string
  replySecretKey: Uint8Array
  baseSha256?: string | null
}

export type VerifiedBrowserPiece = {
  index: number
  count: number
  tokens: number
  text: string
  runningHash: string
  signature: string
  finishReason: StreamFinishReason | null
  nextRunningHash: Uint8Array
}

// Verifies sequential index, monotonic count, envelope SHA-256, running hash chain, and Ed25519
// voynich/piece/v1|v2 signature before decrypting the piece payload.
export function verifyBrowserStreamPiece(params: VerifyBrowserPieceInput): VerifiedBrowserPiece {
  const { piece, expectedCall, expectedIndex, previousCount, previousRunningHash, enclaveSigningKey, inputHash, replySecretKey, baseSha256 } = params
  if (piece.call !== expectedCall) throw new Error('Stream piece call does not match this call.')
  if (!Number.isSafeInteger(piece.index) || piece.index !== expectedIndex) {
    throw new Error(`Stream piece index ${piece.index} does not match expected index ${expectedIndex}.`)
  }
  if (!Number.isSafeInteger(piece.deltaTokens) || piece.deltaTokens < 0 || piece.count !== previousCount + piece.deltaTokens) {
    throw new Error(`Stream piece count ${piece.count} is not monotonic from ${previousCount} + ${piece.deltaTokens}.`)
  }
  if (piece.deltaTokens === 0 && piece.finishReason === null) {
    throw new Error(`Stream piece ${piece.index} has zero tokens without a terminal finish reason.`)
  }
  const envelopeBytes = fromBase64(piece.envelope)
  if (toHex(sha256(envelopeBytes)) !== piece.pieceHash) {
    throw new Error(`Stream piece ${piece.index} hash does not match encrypted envelope bytes.`)
  }
  const nextRunningHash = streamNextHash(previousRunningHash, piece.count, envelopeBytes)
  if (toHex(nextRunningHash) !== piece.runningHash) {
    throw new Error(`Stream piece ${piece.index} running hash does not match the chain commitment.`)
  }
  const callBytes = fromBase58(expectedCall)
  const inputHashBytes = fromHex(inputHash)
  const signingKeyBytes = fromBase58(enclaveSigningKey)
  const baseBytes = baseSha256 ? fromHex(baseSha256) : null
  const sigBytes = fromBase64(piece.signature)
  if (!verifyPiece(sigBytes, signingKeyBytes, callBytes, inputHashBytes, piece.count, nextRunningHash, baseBytes)) {
    throw new Error(`Stream piece ${piece.index} signature failed Ed25519 verification.`)
  }
  const plaintext = decryptCallOutput(envelopeBytes, replySecretKey)
  const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as { index?: unknown; text?: unknown; tokens?: unknown; finishReason?: unknown }
  const finishReason = parsed.finishReason === undefined ? null : parsed.finishReason
  if (
    typeof parsed.index !== 'number' ||
    typeof parsed.text !== 'string' ||
    typeof parsed.tokens !== 'number' ||
    !(finishReason === null || finishReason === 'eos' || finishReason === 'length' || finishReason === 'ceiling' || finishReason === 'stopped')
  ) {
    throw new Error(`Stream piece ${piece.index} payload is malformed.`)
  }
  if (parsed.index !== piece.index || parsed.tokens !== piece.deltaTokens || finishReason !== piece.finishReason) {
    throw new Error(`Stream piece ${piece.index} decrypted metadata does not match signed piece headers.`)
  }
  return {
    index: piece.index,
    count: piece.count,
    tokens: parsed.tokens,
    text: parsed.text,
    runningHash: piece.runningHash,
    signature: piece.signature,
    finishReason,
    nextRunningHash,
  }
}

async function* parseSseStream(body: ReadableStream<Uint8Array>): AsyncGenerator<{ event: string; data: string }> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      for (;;) {
        const sep = buffer.indexOf('\n\n')
        const crlfSep = buffer.indexOf('\r\n\r\n')
        let cut = -1
        let skip = 0
        if (sep >= 0 && (crlfSep < 0 || sep < crlfSep)) { cut = sep; skip = 2 }
        else if (crlfSep >= 0) { cut = crlfSep; skip = 4 }
        if (cut < 0) break
        const block = buffer.slice(0, cut)
        buffer = buffer.slice(cut + skip)
        let event = 'message'
        const dataLines: string[] = []
        for (const rawLine of block.split(/\r?\n/)) {
          if (!rawLine || rawLine.startsWith(':')) continue
          if (rawLine.startsWith('event:')) event = rawLine.slice(6).trim()
          else if (rawLine.startsWith('data:')) dataLines.push(rawLine.slice(5).trimStart())
        }
        if (dataLines.length > 0) yield { event, data: dataLines.join('\n') }
      }
    }
  } finally {
    try { await reader.cancel() } catch {}
  }
}

export async function followStream(o: {
  client: VoynichClient
  model: Model
  enclaveSigningKey: string
  call: Call
  inputHash: string
  secret: Uint8Array
  update: Update
  signal?: AbortSignal
  fetchImpl?: typeof fetch
  isStopping?: () => boolean
}) {
  const { client, model, enclaveSigningKey, call, inputHash, secret, update, signal } = o
  const fetcher = o.fetchImpl ?? globalThis.fetch.bind(globalThis)
  const callAddress = call.address
  const unitPrice = BigInt(call.unitPrice.amount)
  const ceilingBig = BigInt(call.ceiling?.amount ?? call.price.amount)
  const baseSha256 = model.base?.sha256 ?? null

  let runningHash = streamInitialHash(fromBase58(callAddress), fromHex(inputHash))
  let expectedIndex = 0
  let count = 0
  let text = ''
  let finishReason: StreamFinishReason | null = null
  let lastPiece: StreamLastPiece | null = null
  let finished = false
  let reconnects = 0
  const maxReconnects = 5

  const emitProgress = () => {
    const spent = BigInt(count) * unitPrice
    const remaining = ceilingBig > spent ? ceilingBig - spent : 0n
    update({
      stream: {
        text,
        count,
        pieces: expectedIndex,
        spentAmount: spent.toString(),
        remainingAmount: remaining.toString(),
        ceilingAmount: ceilingBig.toString(),
        finishReason,
        stopping: o.isStopping?.() ?? false,
        stopError: null,
        lastPiece,
      },
    })
  }

  const acceptPiece = (raw: StreamPiece) => {
    if (raw.index < expectedIndex) return
    const v = verifyBrowserStreamPiece({
      piece: raw,
      expectedCall: callAddress,
      expectedIndex,
      previousCount: count,
      previousRunningHash: runningHash,
      enclaveSigningKey,
      inputHash,
      replySecretKey: secret,
      baseSha256,
    })
    runningHash = v.nextRunningHash
    count = v.count
    expectedIndex++
    text += v.text
    finishReason = v.finishReason
    lastPiece = { index: v.index, count: v.count, runningHash: v.runningHash, signature: v.signature }
    const spent = BigInt(count) * unitPrice
    const remaining = ceilingBig > spent ? ceilingBig - spent : 0n
    saveStreamPiece({
      call: callAddress,
      model: model.address,
      modelName: model.name,
      index: v.index,
      count: v.count,
      runningHash: v.runningHash,
      signature: v.signature,
      spentAmount: spent.toString(),
      remainingAmount: remaining.toString(),
      ceilingAmount: ceilingBig.toString(),
      deadlineSlot: call.deadlineSlot,
      updatedAt: Date.now(),
    })
    if (v.finishReason !== null) finished = true
    emitProgress()
  }

  emitProgress()

  while (!finished) {
    if (signal?.aborted) return
    const after = expectedIndex > 0 ? expectedIndex - 1 : undefined
    const url = client.callStreamUrl(callAddress, after)
    let response: Response | null = null
    try {
      response = await fetcher(url, { headers: { Accept: 'text/event-stream' }, signal })
    } catch {
      if (signal?.aborted) return
      response = null
    }
    if (response && response.ok && response.body) {
      try {
        for await (const frame of parseSseStream(response.body)) {
          if (signal?.aborted) return
          let parsedJson: unknown
          try { parsedJson = JSON.parse(frame.data) } catch { continue }
          const envelope = ProgramEvent.safeParse(parsedJson)
          if (envelope.success) {
            if (envelope.data.type === 'call.piece') {
              acceptPiece(envelope.data.data)
              if (finished) break
            } else if (envelope.data.type === 'call.stream.done') {
              const done = envelope.data.data
              if (done.status === 'failed') {
                throw new Error(done.failure?.message ?? 'The stream failed before finishing.')
              }
              if (done.pieceCount > expectedIndex) break
              finished = true
              break
            }
          } else {
            const direct = StreamPieceSchema.safeParse(parsedJson)
            if (direct.success) {
              acceptPiece(direct.data)
              if (finished) break
            }
          }
        }
      } catch (e) {
        if (signal?.aborted) return
        if (e instanceof Error && (e.message.startsWith('Stream piece') || e.message.includes('stream failed'))) throw e
      }
    }
    if (finished || signal?.aborted) break
    const snap = await client.callPieces(callAddress)
    if (signal?.aborted) return
    for (const p of snap.pieces) {
      acceptPiece(p)
      if (finished) break
    }
    if (finished) break
    if (snap.status === 'failed') {
      throw new Error(snap.failure?.message ?? 'The stream failed before finishing.')
    }
    if (snap.status === 'done') {
      finished = true
      break
    }
    reconnects++
    if (reconnects > maxReconnects) {
      throw new Error('The piece stream disconnected before finishing.')
    }
    await sleep(Math.min(POLL_MS, 500))
  }

  if (signal?.aborted) return

  let answer = await client.answer(callAddress)
  while (answer.status === 'waiting') {
    await sleep(POLL_MS)
    if (signal?.aborted) return
    answer = await client.answer(callAddress)
  }
  if (signal?.aborted) return
  if (answer.status === 'failed' || !answer.receiptAddress) {
    const f = answer.failure ?? answer.call.failure
    const refundState = f?.refundState ?? refundStateOf(answer.call)
    update({ stage: refundState === 'refunded' ? 'refunded' : 'failed', call: answer.call, failure: { message: f?.message ?? 'The enclave did not settle the stream before the deadline.', refundState } })
    return
  }

  const receiptAddress = answer.receiptAddress
  const view = await indexed(() => client.receipt(receiptAddress), 'RECEIPT_NOT_FOUND')
  const r = view.receipt
  if (r.call !== callAddress || r.inputHash !== inputHash) {
    throw new Error('The receipt does not match this call.')
  }
  const finalPiece = lastPiece as StreamLastPiece | null
  if (finalPiece !== null) {
    if (r.outputHash !== finalPiece.runningHash) {
      throw new Error('The settled receipt running hash does not match the last verified piece.')
    }
    if (r.deliveredCount !== String(finalPiece.count)) {
      throw new Error('The settled receipt token count does not match the last verified piece.')
    }
  }
  if (!model.allowedMeasurements.includes(view.attestationRecord.measurement)) {
    throw new Error('The enclave that answered runs a measurement this model does not allow.')
  }
  let config: Config | null = null
  try { config = await client.config() } catch {}
  const checks: CheckResult[] = []
  update({ call: answer.call, receipt: r.address, checks })
  await verifyAll(view, config, (c) => { checks.push(c); update({ checks: [...checks] }) })
  if (signal?.aborted) return
  const bad = checks.find((c) => !c.passed)
  if (bad) {
    update({ stage: 'failed', failure: { message: bad.detail, refundState: 'unavailable' } })
    return
  }

  const deliveredCount = r.deliveredCount ?? String(finalPiece?.count ?? count)
  const paidAmount = r.payments.total
  const returnedAmount = r.returnedAmount ?? (ceilingBig > BigInt(paidAmount) ? (ceilingBig - BigInt(paidAmount)).toString() : '0')
  const output: Output = {
    label: null,
    scores: [],
    text,
    tokens: Number(deliveredCount),
    finishReason: finishReason ?? 'eos',
    raw: { text, tokens: Number(deliveredCount), finishReason: finishReason ?? 'eos' },
  }
  removeSavedStreamPiece(callAddress)
  update({
    stage: 'verified',
    output,
    settlement: {
      deliveredCount,
      paidAmount,
      returnedAmount,
      ceilingAmount: ceilingBig.toString(),
    },
  })
}

// Fetches /v1/calls/:id/pieces and verifies the signed piece chain against the enclave's signing key
// without decrypting (public proof recovery for another tab or device).
export async function loadLastPieceFromApi(client: VoynichClient, call: Call): Promise<SavedStreamPiece> {
  const [snap, enclaveDetail, model] = await Promise.all([
    client.callPieces(call.address),
    client.enclave(call.enclave),
    client.model(call.model),
  ])
  if (snap.pieces.length === 0) {
    throw new Error('No signed pieces have been recorded for this call yet.')
  }
  const callBytes = fromBase58(call.address)
  const inputHashBytes = fromHex(call.inputHash)
  const signingKeyBytes = fromBase58(enclaveDetail.enclave.signingKey)
  const baseBytes = model.base ? fromHex(model.base.sha256) : null
  let runningHash = streamInitialHash(callBytes, inputHashBytes)
  let expectedIndex = 0
  let count = 0
  let last: StreamPiece | null = null
  for (const piece of snap.pieces) {
    if (piece.call !== call.address) throw new Error('Piece call address does not match this call.')
    if (!Number.isSafeInteger(piece.index) || piece.index !== expectedIndex) {
      throw new Error(`Stream piece index ${piece.index} does not match expected index ${expectedIndex}.`)
    }
    if (!Number.isSafeInteger(piece.deltaTokens) || piece.deltaTokens < 0 || piece.count !== count + piece.deltaTokens) {
      throw new Error(`Stream piece count ${piece.count} is not monotonic.`)
    }
    if (piece.deltaTokens === 0 && piece.finishReason === null) {
      throw new Error(`Stream piece ${piece.index} has zero tokens without a finish reason.`)
    }
    const envelopeBytes = fromBase64(piece.envelope)
    if (toHex(sha256(envelopeBytes)) !== piece.pieceHash) {
      throw new Error(`Stream piece ${piece.index} hash does not match its encrypted envelope.`)
    }
    const nextRunningHash = streamNextHash(runningHash, piece.count, envelopeBytes)
    if (toHex(nextRunningHash) !== piece.runningHash) {
      throw new Error(`Stream piece ${piece.index} running hash does not match the chain commitment.`)
    }
    if (!verifyPiece(fromBase64(piece.signature), signingKeyBytes, callBytes, inputHashBytes, piece.count, nextRunningHash, baseBytes)) {
      throw new Error(`Stream piece ${piece.index} signature failed Ed25519 verification.`)
    }
    runningHash = nextRunningHash
    count = piece.count
    expectedIndex++
    last = piece
  }
  if (!last) throw new Error('No verified piece found for this call.')
  const unitPrice = BigInt(call.unitPrice.amount)
  const ceilingBig = BigInt(call.ceiling?.amount ?? call.price.amount)
  const spent = BigInt(last.count) * unitPrice
  const remaining = ceilingBig > spent ? ceilingBig - spent : 0n
  const saved: SavedStreamPiece = {
    call: call.address,
    model: call.model,
    modelName: call.modelName ?? model.name,
    index: last.index,
    count: last.count,
    runningHash: last.runningHash,
    signature: last.signature,
    spentAmount: spent.toString(),
    remainingAmount: remaining.toString(),
    ceilingAmount: ceilingBig.toString(),
    deadlineSlot: call.deadlineSlot,
    updatedAt: Date.now(),
  }
  saveStreamPiece(saved)
  return saved
}

// Caller self-settlement using the last verified signed piece: signs once, verifies the 5 receipt checks,
// pays delivered tokens, and returns unused ceiling in the same transaction.
export async function settleMeteredStream(o: {
  client: VoynichClient
  model: Model
  wallet: string
  call: Call
  piece: StreamLastPiece
  text?: string
  finishReason?: StreamFinishReason | null
  update: Update
  signal?: AbortSignal
}) {
  const { client, model, wallet: who, call, piece, update, signal } = o
  const ceilingBig = BigInt(call.ceiling?.amount ?? call.price.amount)
  const build = await client.settleCall(call.address, {
    wallet: who,
    count: String(piece.count),
    runningHash: piece.runningHash,
    signature: piece.signature,
  })
  if (signal?.aborted) return
  await send(client, build, (s) => update({ confirming: s === 'confirming' }))
  if (signal?.aborted) return
  let receiptAddress = build.addresses.receipt ?? null
  if (!receiptAddress) {
    const updatedCall = await indexed(() => client.call(call.address), 'CALL_NOT_FOUND', (c) => !!c.receipt)
    receiptAddress = updatedCall.receipt
  }
  if (!receiptAddress) throw new Error('The call settled without a receipt address.')
  const view = await indexed(() => client.receipt(receiptAddress!), 'RECEIPT_NOT_FOUND')
  const r = view.receipt
  if (r.call !== call.address || r.outputHash !== piece.runningHash || r.deliveredCount !== String(piece.count)) {
    throw new Error('The settled receipt does not match the last verified piece.')
  }
  if (!model.allowedMeasurements.includes(view.attestationRecord.measurement)) {
    throw new Error('The enclave that signed this piece runs a measurement this model does not allow.')
  }
  let config: Config | null = null
  try { config = await client.config() } catch {}
  const checks: CheckResult[] = []
  const settledCall: Call = { ...call, status: 'settled', receipt: r.address }
  update({ confirming: false, call: settledCall, receipt: r.address, checks })
  await verifyAll(view, config, (c) => { checks.push(c); update({ checks: [...checks] }) })
  if (signal?.aborted) return
  const bad = checks.find((c) => !c.passed)
  if (bad) {
    update({ stage: 'failed', failure: { message: bad.detail, refundState: 'unavailable' } })
    return
  }
  const deliveredCount = r.deliveredCount ?? String(piece.count)
  const paidAmount = r.payments.total
  const returnedAmount = r.returnedAmount ?? (ceilingBig > BigInt(paidAmount) ? (ceilingBig - BigInt(paidAmount)).toString() : '0')
  removeSavedStreamPiece(call.address)
  const text = o.text ?? ''
  const finishReason = o.finishReason ?? 'stopped'
  update({
    stage: 'verified',
    output: {
      label: null,
      scores: [],
      text,
      tokens: Number(deliveredCount),
      finishReason,
      raw: { text, tokens: Number(deliveredCount), finishReason },
    },
    settlement: {
      deliveredCount,
      paidAmount,
      returnedAmount,
      ceilingAmount: ceilingBig.toString(),
    },
  })
}

// The chain refuses a call the wallet cannot pay for without saying why: when the wallet holds less SOL than
// the price (or metered ceiling) and the call's own costs, that is the reason shown.
const CALL_COSTS = 2_500_000n // the call account's rent and the fee, in lamports, rounded up
async function shortOf(e: unknown, client: VoynichClient, model: Model, wallet: string, escrowAmount?: string): Promise<unknown> {
  if ((e as { code?: string }).code !== 'SIMULATION_FAILED' || model.price.mint !== null) return e
  try {
    const { rpcUrl } = await client.config()
    const r = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [wallet, { commitment: 'confirmed' }] }) })
    const balance = BigInt(((await r.json()) as { result: { value: number } }).result.value)
    if (balance < BigInt(escrowAmount ?? model.price.amount) + CALL_COSTS) return new Error('The wallet holds too little SOL for this call. Add SOL to the wallet, then call again.')
  } catch {}
  return e
}

// Parses a caller-entered ceiling in display units and enforces ceiling >= unitPrice (and > 0 when unitPrice > 0).
export function parseCeiling(text: string, model: Pick<Model, 'price'>): { ok: true; amount: string } | { ok: false; error: string } {
  const m = /^(\d+)(?:\.(\d*))?$/.exec(text.trim().replaceAll(',', ''))
  if (!m) return { ok: false, error: `Enter a ceiling in ${model.price.symbol}.` }
  const frac = m[2] ?? ''
  if (frac.length > model.price.decimals) {
    return { ok: false, error: `At most ${model.price.decimals} decimal places.` }
  }
  const value = BigInt(m[1]!) * 10n ** BigInt(model.price.decimals) + BigInt(frac.padEnd(model.price.decimals, '0') || '0')
  if (value > 18446744073709551615n) return { ok: false, error: 'Ceiling exceeds the u64 maximum.' }
  const unitPrice = BigInt(model.price.amount)
  if (value < unitPrice || (unitPrice > 0n && value === 0n)) {
    return { ok: false, error: `Ceiling must be at least ${money(model.price)} ${model.price.symbol} (one token).` }
  }
  return { ok: true, amount: value.toString() }
}

// Filters granted enclaves to those that are live, reachable, unexpired, and running a measurement the model allows.
export function eligibleEnclaves(
  model: Pick<Model, 'allowedMeasurements'>,
  items: GrantedEnclaves['items'],
  currentSlot?: string | bigint | null,
): GrantedEnclaves['items'] {
  const slot = currentSlot !== undefined && currentSlot !== null ? BigInt(currentSlot) : null
  return items.filter(({ enclave, grant }) => {
    if (enclave.status !== 'live' || grant.status !== 'live' || enclave.reachable !== true) return false
    if (!model.allowedMeasurements.includes(enclave.measurement)) return false
    if (slot !== null && BigInt(enclave.expiresAtSlot) <= slot) return false
    return true
  })
}

export function effectiveShareBps(
  grant: { quotedOperatorShareBps?: number | null },
  modelOperatorShareBps: number,
): number {
  const q = grant.quotedOperatorShareBps
  if (q === null || q === undefined) return modelOperatorShareBps
  return Math.min(q, modelOperatorShareBps)
}

export function formatLatency(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return 'No data'
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(ms >= 10_000 ? 0 : 1)} s`
}

export function pickEnclave(
  model: Pick<Model, 'allowedMeasurements' | 'operatorShareBps'>,
  items: GrantedEnclaves['items'],
  options?: { strategy?: RoutingStrategy; enclaveAddress?: string | null; currentSlot?: string | bigint | null },
): GrantedEnclaves['items'][number] | null {
  const eligible = eligibleEnclaves(model, items, options?.currentSlot)
  if (eligible.length === 0) return null
  if (options?.enclaveAddress) {
    const pinned = eligible.find((x) => x.enclave.address === options.enclaveAddress || x.enclave.signingKey === options.enclaveAddress)
    if (pinned) return pinned
  }
  return selectEnclave(eligible, {
    strategy: options?.strategy ?? 'balanced',
    modelOperatorShareBps: model.operatorShareBps,
  })
}

export type RunCallOptions = {
  client: VoynichClient
  model: Model
  wallet: string
  input: string | number[]
  maxTokens?: number
  ceiling?: string
  answerMode?: AnswerMode
  strategy?: RoutingStrategy
  enclave?: string
  pass?: string | null
  session?: { address: string; delegate: Keypair } | null
  onStopReady?: (stop: (() => Promise<void>) | null) => void
  update: Update
  signal?: AbortSignal
}

export async function runCall(o: RunCallOptions) {
  const { client, model, update, signal } = o
  const metered = model.priceUnit === 'token'
  const answerMode: AnswerMode = metered ? 'sealed' : (o.answerMode ?? 'sealed')
  let call: Call | null = null
  let stopRequested = false
  try {
    const { items } = await client.modelEnclaves(model.address)
    const pick = pickEnclave(model, items, { strategy: o.strategy, enclaveAddress: o.enclave })
    if (!pick) throw new Error('No live enclave holds a grant with a measurement this model allows.')
    const reply = generateEncryptionKeyPair()
    let stopToken: string | undefined
    const payload: Record<string, unknown> = { input: o.input, outputPublicKey: toBase64(reply.publicKey) }
    if (o.maxTokens !== undefined) payload.maxTokens = o.maxTokens
    if (metered) {
      const stopBytes = new Uint8Array(16)
      globalThis.crypto.getRandomValues(stopBytes)
      stopToken = toBase64(stopBytes)
      payload.stopToken = stopToken
    }
    const envelope = encryptCallInput(utf8(JSON.stringify(payload)), fromBase64(pick.enclave.encryptionKey))
    const inputHash = toHex(sha256(envelope))
    update({ stage: 'encrypting', reached: 'encrypting', envelope, inputHash })
    const [build] = await Promise.all([
      o.session
        ? client.openSessionCall(o.session.address, {
            delegate: o.session.delegate.publicKey.toBase58(),
            model: model.address,
            enclave: pick.enclave.address,
            inputHash,
            answerMode,
            ...(o.ceiling !== undefined ? { ceiling: o.ceiling } : {}),
          })
        : o.pass
          ? client.openPassCall({
              wallet: o.wallet,
              pass: o.pass,
              enclave: pick.enclave.address,
              inputHash,
              answerMode,
            })
        : client
            .openCall({
              wallet: o.wallet,
              model: model.address,
              enclave: pick.enclave.address,
              inputHash,
              answerMode,
              ...(o.ceiling !== undefined ? { ceiling: o.ceiling } : {}),
            })
            .catch(async (e) => { throw await shortOf(e, client, model, o.wallet, o.ceiling) }),
      sleep(ENCRYPT_MS),
    ])
    if (signal?.aborted) return
    update({ stage: 'signing', reached: 'signing' })
    if (o.session) {
      await submitDelegateBuild(client, build, o.session.delegate, (s) => update({ confirming: s === 'confirming' }))
    } else {
      await send(client, build, (s) => update({ confirming: s === 'confirming' }))
    }
    const address = build.addresses.call
    if (!address) throw new Error('The call was opened without an address.')
    call = await indexed(() => client.call(address), 'CALL_NOT_FOUND')
    update({ stage: 'escrowed', reached: 'escrowed', confirming: false, call })
    await Promise.all([client.relayInput(address, { envelope: toBase64(envelope) }), sleep(POLL_MS)])
    if (signal?.aborted) return
    if (metered && stopToken) {
      let stopPromise: Promise<void> | null = null
      const stopFn = async () => {
        stopRequested = true
        stopPromise ??= client.stopCall(address, { stopToken: stopToken! }).then(() => undefined)
        await stopPromise
      }
      o.onStopReady?.(stopFn)
      update({ stage: 'streaming', reached: 'streaming' })
      await followStream({
        client,
        model,
        enclaveSigningKey: pick.enclave.signingKey,
        call,
        inputHash,
        secret: reply.secretKey,
        update,
        signal,
        isStopping: () => stopRequested,
      })
    } else {
      update({ stage: 'answering', reached: 'answering' })
      await follow(client, model, address, inputHash, reply.secretKey, update, signal)
    }
  } catch (e) {
    if (signal?.aborted) return
    let refundState: RefundState = 'unavailable'
    if (call) {
      try { call = await client.call(call.address); refundState = refundStateOf(call) } catch { refundState = 'pending-deadline' }
    }
    update({ stage: 'failed', confirming: false, call, failure: { message: errorMessage(e), refundState } })
  } finally {
    o.onStopReady?.(null)
  }
}

export async function runSessionCall(o: Omit<RunCallOptions, 'session'> & { session: { address: string; delegate: Keypair } }) {
  return runCall(o)
}

// Take the escrow of an expired call back. Throws with the reason when it does not go through.
export async function refundCall(client: VoynichClient, call: Call, wallet: string, update: Update) {
  const build = await client.refundCall(call.address, { wallet })
  await send(client, build, (s) => update({ confirming: s === 'confirming' }))
  const next = await client.call(call.address)
  removeSavedStreamPiece(call.address)
  update({ stage: 'refunded', confirming: false, call: next, failure: { message: next.failure?.message ?? '', refundState: 'refunded' } })
}

// A call that is already on the API when the page opens (the `call-*`, `refundable` and `refunded` scenarios of a
// sample API): its address, the stage the panel holds if it should not follow it, and the key its answer is sealed to.
const HELD: Record<string, FlightStage | 'follow'> = {
  'call-escrowed': 'escrowed', 'call-answering': 'follow', 'call-verified': 'follow', 'call-failed': 'follow', refundable: 'follow', refunded: 'follow',
}
// Stages that live only in the browser, held still so they can be looked at.
const LOCAL: Record<string, 'ready' | FlightStage> = { 'call-ready': 'ready', 'call-encrypting': 'encrypting', 'call-awaiting-signature': 'signing' }

export function heldStage(fixture: string | null): 'ready' | FlightStage | null {
  return fixture ? LOCAL[fixture] ?? null : null
}
export function hasOpenCall(fixture: string | null): boolean {
  return !!fixture && fixture in HELD
}

export async function resumeCall(o: { client: VoynichClient; model: Model; fixture: string; update: Update; signal?: AbortSignal }) {
  const hold = HELD[o.fixture]
  if (!hold) return
  try {
    const call = await o.client.call(FIXTURE.call)
    if (o.signal?.aborted) return
    if (hold !== 'follow') {
      o.update({ stage: hold, reached: hold, call })
      return
    }
    o.update({ stage: 'answering', reached: 'answering', call })
    await follow(o.client, o.model, call.address, null, sha256(utf8('voynich/fixture/caller/encryption/v1')), o.update, o.signal)
  } catch (e) {
    if (o.signal?.aborted) return
    o.update({ stage: 'failed', failure: { message: errorMessage(e), refundState: 'unavailable' } })
  }
}

// A tensor typed as JSON: nested arrays in the manifest's shape, or one flat array of as many numbers.
// Always returns a flat number[] matching what the enclave runtime expects.
export function parseTensor(text: string, shape: readonly number[]): { ok: true; value: number[] } | { ok: false; error: string } {
  const want = `[${shape.join(', ')}]`
  if (!text.trim()) return { ok: false, error: `Enter a tensor of shape ${want}.` }
  let v: unknown
  try { v = JSON.parse(text) } catch { return { ok: false, error: 'This is not valid JSON.' } }
  const total = shape.reduce((a, b) => a * b, 1)
  const numbers = (a: unknown[]): a is number[] => a.every((x) => typeof x === 'number' && Number.isFinite(x))
  if (Array.isArray(v) && v.length === total && numbers(v)) return { ok: true, value: v }
  const fits = (x: unknown, d: number): boolean => {
    if (d === shape.length) return typeof x === 'number' && Number.isFinite(x)
    return Array.isArray(x) && x.length === shape[d] && x.every((y) => fits(y, d + 1))
  }
  if (!fits(v, 0)) return { ok: false, error: `The model takes shape ${want}: nested arrays of numbers, or one flat array of ${total}.` }
  const flat: number[] = []
  const flatten = (x: unknown) => {
    if (Array.isArray(x)) for (const y of x) flatten(y)
    else flat.push(x as number)
  }
  flatten(v)
  return { ok: true, value: flat }
}
