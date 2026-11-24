import { Connection, Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js'
import type { IdlAccounts } from '@coral-xyz/anchor'
import { ATTACH_WEIGHTS_BATCH, Address, ApiClientError, DEFAULT_UPLOAD_KEYS, INITIAL_CREATE_WEIGHTS, MAX_UPLOAD_KEYS, MAX_WEIGHTS, ModelBaseSchema, ProgramEvent, SEAL_RANGE_CHUNKS, StreamPiece as StreamPieceSchema, WRITE_CHUNK_BYTES, createClient, decodeManifest, fromBase58, type AnswerMode, type Build, type Call, type CallAnswer, type Enclave, type GrantedEnclave, type Manifest, type MeasurementRecord, type Model, type ModelBase, type ModelPolicy, type ModelVersion, type ModelVersions, type Money, type PriceUnit, type Receipt, type ReceiptView, type StreamFinishReason, type StreamPiece, type TxStatus } from '@voynich/contract'
import { decodeAdapter } from './adapter.js'
import { CIPHER_CHUNK_BYTES, WEIGHTS_CHUNK_BYTES, WEIGHTS_CIPHER, ciphertextHash, decryptCallOutput, encryptCallInput, fromBase64, fromHex, generateEncryptionKeyPair, openWeightsChunk, sealWeights, sha256, signSealDerivation, streamInitialHash, streamNextHash, toBase64, toHex, utf8, verifyPiece, verifyReceipt, wrapKey, type SealDerivationSigner, type WeightsCipherHeader } from './crypto.js'
import { addresses, chainPrograms, decodeAttestation, decodeConfigAccount, decodeModelBaseBytes, decodeModelVersionAccount, decodeReceiptAccount, decodeWeightsHeader, modelVersionPda, PROGRAM_ID, type Voynich as VoynichProgram } from './program.js'
import { preprocessSketch, type SketchInput } from './preprocess.js'
import { historicalAttestation, transactionSettledReceipt } from './history.js'

export const VERSION_WRITE_CHUNK_BYTES = 704
const VERSION_WRITE_CONCURRENCY = 4

export type WalletSigner = { publicKey: PublicKey; signTransaction(transaction: VersionedTransaction): Promise<VersionedTransaction>; signMessage?(message: Uint8Array): Promise<Uint8Array> }
export type VoynichSigner = WalletSigner | Keypair
export type VoynichOptions = { apiUrl: string; rpcUrl?: string; signer?: VoynichSigner; connection?: Connection; headers?: Record<string, string>; fixture?: string; fetch?: typeof fetch; pollMs?: number }
export type RoutingStrategy = 'cheapest' | 'fastest' | 'balanced'
export type SelectEnclaveOptions = {
  strategy?: RoutingStrategy
  modelOperatorShareBps?: number
}
export type CallStep = 'encrypting' | 'awaiting-signature' | 'escrowed' | 'answering' | 'verified'
export type CallOptions = { signal?: AbortSignal; onStep?: (step: CallStep) => void; enclave?: string; strategy?: RoutingStrategy; answerMode?: AnswerMode; maxTokens?: number; ceiling?: string }
export type ClassificationScore = { label: string; probability: number }
export type ClassificationOutput = { label: string; probability?: number; scores?: ClassificationScore[] }
export type TextGenerationOutput = { text: string; tokens: number; finishReason: 'eos' | 'length' }
export type CallOutput = ClassificationOutput | TextGenerationOutput
export type StreamPiecePayload = { index: number; text: string; tokens: number; finishReason: StreamFinishReason | null }
export type VerifiedStreamPiece = {
  piece: StreamPiece
  payload: StreamPiecePayload
  text: string
  tokens: number
  count: number
  runningHash: string
  finishReason: StreamFinishReason | null
  spentAmount?: string
  remainingAmount?: string
}
export type VerifyStreamPieceOptions = {
  piece: StreamPiece
  expectedCall: string
  expectedIndex: number
  previousCount: number
  previousRunningHash: Uint8Array
  enclaveSigningKey: string | Uint8Array
  inputHash: string | Uint8Array
  replySecretKey: Uint8Array
  baseSha256?: string | Uint8Array | null
}
export type StreamPiecesOptions = {
  replySecretKey: Uint8Array
  enclaveSigningKey: string | Uint8Array
  inputHash: string | Uint8Array
  baseSha256?: string | Uint8Array | null
  signal?: AbortSignal
}
export type OpenStreamOptions = {
  ceiling: string
  enclave?: string
  strategy?: RoutingStrategy
  maxTokens?: number
  onStep?: (step: 'encrypting' | 'awaiting-signature' | 'escrowed' | 'streaming') => void
  signal?: AbortSignal
}
export type StreamOptions = {
  ceiling?: string
  enclave?: string
  strategy?: RoutingStrategy
  maxTokens?: number
  onStep?: (step: 'encrypting' | 'awaiting-signature' | 'escrowed' | 'streaming' | 'verified') => void
  signal?: AbortSignal
}
export type StreamResult = {
  text: string
  count: number
  finishReason: StreamFinishReason | null
  call: Call
  receipt: Receipt
  verified: boolean
  fixture: boolean
  checks: { signature: boolean; record: boolean; expiry: boolean; answer: boolean; base: boolean }
  spentAmount: string
  returnedAmount: string
  lastPiece: VerifiedStreamPiece | null
}
export type SettlePieceInput = {
  count: number | bigint | string
  runningHash: string
  signature: string
}
export type SettleResult = {
  receipt: Receipt
  verification: Verification
}
export type VoynichStream = AsyncIterable<VerifiedStreamPiece> & {
  readonly call: Call
  readonly model: Model
  readonly enclave: Enclave
  readonly ceiling: string
  stop(): Promise<void>
  settle(): Promise<StreamResult>
  lastPiece(): VerifiedStreamPiece | null
  final(): Promise<StreamResult>
}
export type PublishVersionOptions = {
  weights: Uint8Array
  manifest?: Manifest
  base?: ModelBase | null
  modelKey?: Uint8Array
  signal?: AbortSignal
}
export type PublishVersionResult = {
  model: Model
  version: number
  ciphertextSha256: string
  noncePrefix: string
  transactionsSent: number
}
export class VoynichError extends Error {
  constructor(readonly code: string, message: string, readonly call?: Call, readonly refundState?: string) { super(message); this.name = 'VoynichError' }
}

/**
 * Selects one granted enclave according to quote and latency routing strategy.
 * Effective operator share is `grant.quotedOperatorShareBps ?? modelOperatorShareBps`.
 */
export function selectEnclave(
  enclaves: readonly GrantedEnclave[],
  options: SelectEnclaveOptions = {},
): GrantedEnclave | null {
  if (!enclaves.length) return null
  const strategy: RoutingStrategy = options.strategy ?? 'balanced'
  const fallbackShare = options.modelOperatorShareBps ?? 10_000
  const effectiveShare = (item: GrantedEnclave) => {
    const quoted = item.grant.quotedOperatorShareBps
    if (quoted === null || quoted === undefined) return fallbackShare
    return Math.min(quoted, fallbackShare)
  }
  const latencyOf = (item: GrantedEnclave): number | null =>
    item.grant.medianAnswerMs === null || item.grant.medianAnswerMs === undefined
      ? null
      : item.grant.medianAnswerMs
  const compareLatency = (a: number | null, b: number | null) => {
    if (a === b) return 0
    if (a === null) return 1
    if (b === null) return -1
    return a - b
  }
  const compareKey = (a: GrantedEnclave, b: GrantedEnclave) =>
    a.enclave.signingKey < b.enclave.signingKey ? -1 : a.enclave.signingKey > b.enclave.signingKey ? 1 : 0

  const sorted = [...enclaves]
  if (strategy === 'cheapest') {
    sorted.sort((a, b) =>
      effectiveShare(a) - effectiveShare(b)
      || compareLatency(latencyOf(a), latencyOf(b))
      || compareKey(a, b),
    )
    return sorted[0] ?? null
  }
  if (strategy === 'fastest') {
    sorted.sort((a, b) =>
      compareLatency(latencyOf(a), latencyOf(b))
      || effectiveShare(a) - effectiveShare(b)
      || compareKey(a, b),
    )
    return sorted[0] ?? null
  }
  // 'balanced': equal weight normalized share and latency with deterministic fallback when latencies are null or equal.
  const shares = sorted.map(effectiveShare)
  const minShare = Math.min(...shares)
  const maxShare = Math.max(...shares)
  const shareSpan = maxShare - minShare
  const knownLatencies = sorted.map(latencyOf).filter((v): v is number => v !== null)
  const minLatency = knownLatencies.length ? Math.min(...knownLatencies) : 0
  const maxLatency = knownLatencies.length ? Math.max(...knownLatencies) : 0
  const latencySpan = maxLatency - minLatency
  const score = (item: GrantedEnclave) => {
    const s = shareSpan > 0 ? (effectiveShare(item) - minShare) / shareSpan : 0
    const lat = latencyOf(item)
    const l = knownLatencies.length === 0
      ? 0
      : lat === null
        ? 1
        : latencySpan > 0
          ? (lat - minLatency) / latencySpan
          : 0
    return 0.5 * s + 0.5 * l
  }
  sorted.sort((a, b) => {
    const diff = score(a) - score(b)
    if (Math.abs(diff) > 1e-12) return diff
    return effectiveShare(a) - effectiveShare(b)
      || compareLatency(latencyOf(a), latencyOf(b))
      || compareKey(a, b)
  })
  return sorted[0] ?? null
}

/**
 * Verifies one encrypted signed stream piece against sequential index, monotonic count,
 * piece SHA-256, running hash chain, and Ed25519 voynich/piece/v1|v2 signature before decrypting.
 */
export function verifyStreamPiece(params: VerifyStreamPieceOptions): {
  verified: VerifiedStreamPiece
  nextRunningHash: Uint8Array
  nextCount: number
} {
  const {
    piece, expectedCall, expectedIndex, previousCount, previousRunningHash,
    enclaveSigningKey, inputHash, replySecretKey, baseSha256,
  } = params
  if (piece.call !== expectedCall) {
    throw new VoynichError('VERIFICATION_FAILED', `Stream piece call (${piece.call}) does not match expected call (${expectedCall}).`)
  }
  if (!Number.isSafeInteger(piece.index) || piece.index !== expectedIndex) {
    throw new VoynichError('VERIFICATION_FAILED', `Stream piece index ${piece.index} does not match expected sequential index ${expectedIndex}.`)
  }
  if (!Number.isSafeInteger(piece.deltaTokens) || piece.deltaTokens < 0 || piece.count !== previousCount + piece.deltaTokens) {
    throw new VoynichError('VERIFICATION_FAILED', `Stream piece count ${piece.count} is not monotonic from ${previousCount} + ${piece.deltaTokens}.`)
  }
  if (piece.deltaTokens === 0 && piece.finishReason === null) {
    throw new VoynichError('VERIFICATION_FAILED', `Stream piece ${piece.index} cannot have deltaTokens === 0 without a terminal finishReason.`)
  }
  const envelopeBytes = fromBase64(piece.envelope)
  if (toHex(sha256(envelopeBytes)) !== piece.pieceHash) {
    throw new VoynichError('VERIFICATION_FAILED', `Stream piece ${piece.index} hash does not match encrypted envelope bytes.`)
  }
  const nextRunningHash = streamNextHash(previousRunningHash, piece.count, envelopeBytes)
  if (toHex(nextRunningHash) !== piece.runningHash) {
    throw new VoynichError('VERIFICATION_FAILED', `Stream piece ${piece.index} running hash does not match the chain commitment.`)
  }
  const callBytes = fromBase58(expectedCall)
  const inputHashBytes = typeof inputHash === 'string' ? fromHex(inputHash) : inputHash
  const signingKeyBytes = typeof enclaveSigningKey === 'string' ? fromBase58(enclaveSigningKey) : enclaveSigningKey
  const baseBytes = baseSha256 == null ? null : (typeof baseSha256 === 'string' ? fromHex(baseSha256) : baseSha256)
  const sigBytes = fromBase64(piece.signature)
  if (!verifyPiece(sigBytes, signingKeyBytes, callBytes, inputHashBytes, piece.count, nextRunningHash, baseBytes)) {
    throw new VoynichError('VERIFICATION_FAILED', `Stream piece ${piece.index} signature failed Ed25519 verification.`)
  }
  let payload: StreamPiecePayload
  try {
    const plaintext = decryptCallOutput(envelopeBytes, replySecretKey)
    const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as Partial<StreamPiecePayload>
    const finishReason = parsed.finishReason ?? null
    if (
      typeof parsed.index !== 'number' ||
      typeof parsed.text !== 'string' ||
      typeof parsed.tokens !== 'number' ||
      !(parsed.finishReason === null || finishReason === 'eos' || finishReason === 'length' || finishReason === 'ceiling' || finishReason === 'stopped')
    ) {
      throw new Error('Malformed piece payload')
    }
    payload = { index: parsed.index, text: parsed.text, tokens: parsed.tokens, finishReason }
  } catch (error) {
    throw new VoynichError('VERIFICATION_FAILED', error instanceof Error ? error.message : 'Failed to decrypt stream piece.')
  }
  if (payload.index !== piece.index || payload.tokens !== piece.deltaTokens || payload.finishReason !== piece.finishReason) {
    throw new VoynichError('VERIFICATION_FAILED', `Stream piece ${piece.index} decrypted metadata does not match signed envelope metadata.`)
  }
  return {
    verified: {
      piece,
      payload,
      text: payload.text,
      tokens: payload.tokens,
      count: piece.count,
      runningHash: piece.runningHash,
      finishReason: payload.finishReason,
    },
    nextRunningHash,
    nextCount: piece.count,
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
export type Verification = { verified: boolean; signature: boolean; record: boolean; expiry: boolean; answer: boolean; base: boolean; receipt: Receipt; reason?: string; fixture: boolean }
export type SealResume = { model: string; ciphertext: Uint8Array; modelKey: Uint8Array; uploadKey: Keypair; uploadKeys?: Keypair[]; plaintextSizeBytes: number; noncePrefix: Uint8Array; weightsKeys?: Keypair[] }
export type SealMetrics = { bytesWritten: number; totalBytes: number; transactionsSent: number; elapsedMs: number; feesLamports: string }
export type SealProgress = { step: 'create' | 'upload' | 'seal' | 'grant' | 'done'; bytesWritten: number; totalBytes: number; transactionsWritten: number; transactionsSent: number; elapsedMs: number; feesLamports: string }
export type SealResult = { model: Model; resume: SealResume; uploadKeyCount: number } & SealMetrics
export type SealOptions = { weights?: Uint8Array; manifest: Manifest; name?: string; price: Money; priceUnit?: PriceUnit; operatorShareBps: number; allowedMeasurements: string[]; uploadFundingLamports: string; uploadKeyCount?: number; base?: ModelBase; grantEnclave?: string; resume?: SealResume; onPrepared?: (resume: SealResume) => void | Promise<void>; onProgress?: (progress: SealProgress) => void; signal?: AbortSignal }
const COMPUTE_BUDGET_PROGRAM = new PublicKey('ComputeBudget111111111111111111111111111111')
export function transactionFeeLamports(transaction: VersionedTransaction): bigint {
  const keys = transaction.message.staticAccountKeys
  const base = 5000n * BigInt(transaction.message.header.numRequiredSignatures)
  let limit: number | undefined
  let microLamports = 0n
  let nonBudgetCount = 0
  for (const ix of transaction.message.compiledInstructions) {
    const program = keys[ix.programIdIndex]
    if (program?.equals(COMPUTE_BUDGET_PROGRAM)) {
      const view = new DataView(ix.data.buffer, ix.data.byteOffset, ix.data.byteLength)
      if (ix.data[0] === 2 && ix.data.length >= 5) limit = view.getUint32(1, true)
      else if (ix.data[0] === 3 && ix.data.length >= 9) microLamports = view.getBigUint64(1, true)
    } else {
      nonBudgetCount++
    }
  }
  const units = limit ?? Math.min(1_400_000, Math.max(1, nonBudgetCount) * 200_000)
  return base + (microLamports > 0n ? (BigInt(units) * microLamports + 999_999n) / 1_000_000n : 0n)
}
const wait = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => { signal?.throwIfAborted(); const done = () => { signal?.removeEventListener('abort', abort); resolve() }; const timer = setTimeout(done, ms); const abort = () => { clearTimeout(timer); reject(signal?.reason ?? new Error('Aborted')) }; signal?.addEventListener('abort', abort, { once: true }) })

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function concatUint8(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) { out.set(part, offset); offset += part.length }
  return out
}

/**
 * Inspects attached on-chain Weights accounts via batched 56-byte headers and concurrent
 * 8-chunk dataSlice reads, authenticating each 64 KiB chunk with openWeightsChunk so
 * cross-device resume repairs missing or partial writes directly from chain state.
 */
export async function findUnwrittenRangesFromChain(params: {
  connection: Pick<Connection, 'getMultipleAccountsInfo' | 'getAccountInfo'>
  programId: PublicKey
  modelAddress: PublicKey
  weightsAddresses: PublicKey[]
  ciphertext: Uint8Array
  modelKey: Uint8Array
  noncePrefix: Uint8Array
  writeChunkBytes: number
  rangeChunks?: number
  concurrency?: number
}): Promise<{
  unwritten: { offset: number; length: number }[]
  verifiedChunks: number
  totalChunks: number
  bytesAlreadyValid: number
}> {
  const {
    connection, programId, modelAddress, weightsAddresses, ciphertext,
    modelKey, noncePrefix, writeChunkBytes,
  } = params
  const rangeChunks = Math.max(1, params.rangeChunks ?? 8)
  const concurrency = Math.max(1, params.concurrency ?? 6)
  const headerInfos = await connection.getMultipleAccountsInfo(weightsAddresses, { commitment: 'confirmed', dataSlice: { offset: 0, length: 56 } })
  const accounts: { pubkey: PublicKey; index: number; offset: number; sizeBytes: number; writtenBytes: number }[] = []
  let cumulative = 0
  for (let index = 0; index < weightsAddresses.length; index++) {
    const info = headerInfos[index]
    if (!info || !info.owner.equals(programId)) throw new VoynichError('INVALID_WEIGHTS', 'An on-chain weights account is missing or has an invalid owner.')
    const header = decodeWeightsHeader(info.data, { headerOnly: true })
    if (!header.model.equals(modelAddress) || header.index !== index) throw new VoynichError('INVALID_WEIGHTS', 'An on-chain weights account header does not match this model.')
    accounts.push({ pubkey: weightsAddresses[index]!, index, offset: cumulative, sizeBytes: header.sizeBytes, writtenBytes: header.writtenBytes })
    cumulative += header.sizeBytes
  }
  if (cumulative !== ciphertext.length) throw new VoynichError('INVALID_WEIGHTS', 'The attached weights accounts do not match the ciphertext length.')

  const totalChunks = Math.ceil(ciphertext.length / CIPHER_CHUNK_BYTES)
  const plaintextBytes = ciphertext.length - totalChunks * 16
  const cipherHeader: WeightsCipherHeader = { cipher: WEIGHTS_CIPHER, chunkBytes: WEIGHTS_CHUNK_BYTES, noncePrefix, plaintextBytes }
  const chunkComplete = new Uint8Array(totalChunks)
  const rangeBuffers = new Map<number, Uint8Array>()
  const ranges: { rangeIndex: number; startChunk: number; chunkCount: number }[] = []
  for (let startChunk = 0, rangeIndex = 0; startChunk < totalChunks; startChunk += rangeChunks, rangeIndex++) {
    ranges.push({ rangeIndex, startChunk, chunkCount: Math.min(rangeChunks, totalChunks - startChunk) })
  }

  let verifiedChunks = 0
  let bytesAlreadyValid = 0
  let cursor = 0
  const worker = async () => {
    for (;;) {
      const item = ranges[cursor++]
      if (!item) return
      const rangeStart = item.startChunk * CIPHER_CHUNK_BYTES
      const rangeEnd = Math.min((item.startChunk + item.chunkCount) * CIPHER_CHUNK_BYTES, ciphertext.length)
      const intersecting = accounts.filter(acc => acc.offset < rangeEnd && acc.offset + acc.sizeBytes > rangeStart)
      // Skip RPC read completely if every intersecting account has writtenBytes before this range.
      const anyWritten = intersecting.some(acc => acc.writtenBytes > Math.max(0, rangeStart - acc.offset))
      if (!anyWritten) continue
      const pieces: Uint8Array[] = []
      for (const acc of intersecting) {
        const sliceStart = Math.max(rangeStart, acc.offset)
        const sliceEnd = Math.min(rangeEnd, acc.offset + acc.sizeBytes)
        const length = sliceEnd - sliceStart
        const info = await connection.getAccountInfo(acc.pubkey, { commitment: 'confirmed', dataSlice: { offset: 56 + (sliceStart - acc.offset), length } })
        if (!info || !info.owner.equals(programId) || info.data.length !== length) throw new VoynichError('INVALID_WEIGHTS', 'Could not read an on-chain weights range.')
        pieces.push(info.data)
      }
      const rangeData = pieces.length === 1 ? pieces[0]! : concatUint8(pieces)
      let allMatch = true
      for (let i = 0; i < item.chunkCount; i++) {
        const chunkIndex = item.startChunk + i
        const cStart = chunkIndex * CIPHER_CHUNK_BYTES
        const cEnd = Math.min(cStart + CIPHER_CHUNK_BYTES, ciphertext.length)
        const expected = ciphertext.subarray(cStart, cEnd)
        const actual = rangeData.subarray(cStart - rangeStart, cEnd - rangeStart)
        if (bytesEqual(actual, expected)) {
          try {
            openWeightsChunk(actual, chunkIndex, modelKey, cipherHeader)
            chunkComplete[chunkIndex] = 1
            verifiedChunks++
            bytesAlreadyValid += expected.length
            continue
          } catch {}
        }
        allMatch = false
      }
      if (!allMatch) rangeBuffers.set(item.rangeIndex, rangeData)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, ranges.length) }, () => worker()))

  // Build exact account-aligned writeChunkBytes slices for any incomplete chunk or short written_bytes high-water mark.
  const unwritten: { offset: number; length: number }[] = []
  for (const acc of accounts) {
    for (let local = 0; local < acc.sizeBytes; local += writeChunkBytes) {
      const length = Math.min(writeChunkBytes, acc.sizeBytes - local)
      const globalStart = acc.offset + local
      const globalEnd = globalStart + length
      const firstChunk = Math.floor(globalStart / CIPHER_CHUNK_BYTES)
      const lastChunk = Math.floor((globalEnd - 1) / CIPHER_CHUNK_BYTES)
      let allChunksComplete = true
      for (let c = firstChunk; c <= lastChunk; c++) {
        if (chunkComplete[c] !== 1) { allChunksComplete = false; break }
      }
      const coveredByWrittenMark = local + length <= acc.writtenBytes
      if (allChunksComplete && coveredByWrittenMark) continue
      // Check slice bytes inside partially-written ranges so already-landed 888B writes are not resent.
      if (coveredByWrittenMark && firstChunk === lastChunk) {
        const rangeIndex = Math.floor(firstChunk / rangeChunks)
        const rangeData = rangeBuffers.get(rangeIndex)
        if (rangeData) {
          const rangeStart = rangeIndex * rangeChunks * CIPHER_CHUNK_BYTES
          const actualSlice = rangeData.subarray(globalStart - rangeStart, globalEnd - rangeStart)
          if (bytesEqual(actualSlice, ciphertext.subarray(globalStart, globalEnd))) continue
        }
      }
      unwritten.push({ offset: globalStart, length })
    }
  }
  return { unwritten, verifiedChunks, totalChunks, bytesAlreadyValid }
}

export function createVoynich(options: VoynichOptions) {
  const api = createClient(options.apiUrl, { headers: options.headers, fixture: options.fixture, fetch: options.fetch })
  const pollMs = options.pollMs ?? 500
  const configured = () => api.config()
  const rpc = async () => options.connection ?? new Connection(options.rpcUrl ?? (await configured()).rpcUrl, 'confirmed')
  async function confirmSignatureHttp(conn: Connection, signature: string, lastValidBlockHeight: number, signal?: AbortSignal): Promise<void> {
    for (;;) {
      const { value } = await conn.getSignatureStatuses([signature])
      const status = value[0]
      if (status) {
        if (status.err) {
          throw new VoynichError('TRANSACTION_FAILED', `Transaction ${signature} failed: ${JSON.stringify(status.err)}`)
        }
        if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') {
          return
        }
      }
      const blockHeight = await conn.getBlockHeight('confirmed')
      if (blockHeight > lastValidBlockHeight) {
        throw new VoynichError('TRANSACTION_EXPIRED', `Transaction ${signature} expired before confirmation.`)
      }
      await wait(pollMs, signal)
    }
  }
  function signer(): VoynichSigner { if (!options.signer) throw new VoynichError('WALLET_REQUIRED', 'Connect a wallet or configure a signing keypair.'); return options.signer }
  async function follow(status: TxStatus, signal?: AbortSignal, intervalMs = pollMs): Promise<TxStatus> {
    if (status.status === 'built') throw new VoynichError('TRANSACTION_NOT_SUBMITTED', 'This transaction has been built but has not been submitted.')
    while (!['confirmed', 'finalized', 'failed', 'expired'].includes(status.status)) { await wait(intervalMs, signal); status = await api.transaction(status.id, { signal }) }
    if (status.status === 'failed' || status.status === 'expired') throw new VoynichError('TRANSACTION_' + status.status.toUpperCase(), status.error?.message ?? 'The transaction did not land.')
    return status
  }
  async function sendMeasured(build: Build, localSigners: Keypair[] = [], override?: VoynichSigner, signal?: AbortSignal, intervalMs = pollMs): Promise<{ status: TxStatus; feeLamports: bigint }> {
    let bytes = build.transactionBase64
    let feeLamports = 0n
    if (!build.fixture) {
      const active = override ?? signer()
      let transaction = VersionedTransaction.deserialize(fromBase64(bytes))
      if ('secretKey' in active) transaction.sign([active])
      else transaction = await active.signTransaction(transaction)
      // The owner wallet signs first; upload/weights keys sign its returned message.
      const required = transaction.message.staticAccountKeys.slice(0, transaction.message.header.numRequiredSignatures)
      const needed = localSigners.filter(local => required.some(key => key.equals(local.publicKey)))
      if (needed.length) transaction.sign(needed)
      feeLamports = transactionFeeLamports(transaction)
      bytes = toBase64(transaction.serialize())
    }
    const status = await follow(await api.submitTransaction({ mode: 'relay', buildId: build.id, signedTransactionBase64: bytes, idempotencyKey: build.id }, { signal }), signal, intervalMs)
    return { status, feeLamports }
  }
  async function send(build: Build, localSigners: Keypair[] = [], override?: VoynichSigner, signal?: AbortSignal) {
    return (await sendMeasured(build, localSigners, override, signal)).status
  }
  async function indexed<T>(read: () => Promise<T>, missing: string, matches: (value: T) => boolean = () => true, signal?: AbortSignal): Promise<T> {
    for (;;) { try { const value = await read(); if (matches(value)) return value } catch (error) { if (!(error instanceof ApiClientError) || error.code !== missing) throw error } await wait(pollMs, signal) }
  }
  /** Authenticate the encryption destination before either input or model-key ciphertext exists. */
  async function encryptionDestination(modelId: string, model: Model, candidate: Enclave, requireGrant: boolean) {
    const config = await configured()
    if (config.fixture) return { encryptionKey: fromBase64(candidate.encryptionKey), signingKey: candidate.signingKey, manifest: model.manifest }
    if (config.programId !== PROGRAM_ID.toBase58()) throw new VoynichError('PROGRAM_MISMATCH', 'The API does not name the canonical Voynich program.')
    const connection = await rpc(), { voynich } = chainPrograms(connection)
    const pdas = addresses()
    const first = await connection.getMultipleAccountsInfoAndContext([pdas.config, new PublicKey(model.address), new PublicKey(candidate.address)], 'confirmed')
    if (first.value.some(info => !info || !info.owner.equals(PROGRAM_ID))) throw new VoynichError('INVALID_CHAIN_ACCOUNT', 'The model, enclave or configuration account is missing or has an invalid owner.')
    const chainConfig = decodeConfigAccount(first.value[0]!.data)
    const chainModel = voynich.coder.accounts.decode<IdlAccounts<VoynichProgram>['model']>('model', first.value[1]!.data)
    const enclave = voynich.coder.accounts.decode<IdlAccounts<VoynichProgram>['enclave']>('enclave', first.value[2]!.data)
    const expectedModel = Address.safeParse(modelId).success ? modelId : pdas.model(modelId).toBase58()
    if (expectedModel !== model.address || pdas.model(chainModel.name).toBase58() !== model.address || pdas.enclave(enclave.signingKey).toBase58() !== candidate.address) throw new VoynichError('MODEL_MISMATCH', 'The chain accounts do not match the requested model and enclave.')
    if (requireGrant ? !('live' in chainModel.status) : !('sealed' in chainModel.status || 'live' in chainModel.status)) throw new VoynichError('MODEL_NOT_LIVE', 'The model is not ready for this action.')
    if (!requireGrant && !chainModel.owner.equals(signer().publicKey)) throw new VoynichError('OWNER_REQUIRED', 'Only this model owner may wrap an owner grant.')
    const recordAddress = addresses(PROGRAM_ID, chainConfig.attestationProgram).record(enclave.signingKey)
    if (!recordAddress.equals(enclave.attestationRecord)) throw new VoynichError('INVALID_ATTESTATION', 'The enclave points to an invalid attestation record.')
    const grantAddress = pdas.grant(model.address, candidate.address)
    const second = await connection.getMultipleAccountsInfoAndContext(requireGrant ? [recordAddress, grantAddress] : [recordAddress], { commitment: 'confirmed', minContextSlot: first.context.slot })
    const recordInfo = second.value[0]
    if (!recordInfo || !recordInfo.owner.equals(chainConfig.attestationProgram)) throw new VoynichError('INVALID_ATTESTATION', 'The attestation record owner does not match the chain configuration.')
    const record = decodeAttestation(recordInfo.data)
    const currentSlot = BigInt(Math.max(first.context.slot, second.context.slot, await connection.getSlot('confirmed')))
    const hardware = (['dev', 'tdx', 'sev-snp'] as const)[enclave.hardwareType]
    if (record.layoutVersion !== chainConfig.recordLayoutVersion || !record.signingKey.equals(enclave.signingKey) || record.hardwareType !== hardware || record.measurement !== toHex(Uint8Array.from(enclave.measurement)) || record.recordedSlot > currentSlot || record.expiresAtSlot <= currentSlot || !chainModel.allowedMeasurements.some(measurement => toHex(Uint8Array.from(measurement)) === record.measurement)) throw new VoynichError('INVALID_ATTESTATION', 'The enclave record is expired or does not match the registered and allowed software.')
    if (requireGrant) {
      const grantInfo = second.value[1]
      if (!grantInfo || !grantInfo.owner.equals(PROGRAM_ID)) throw new VoynichError('GRANT_REQUIRED', 'The enclave has no chain grant for this model.')
      const grant = voynich.coder.accounts.decode<IdlAccounts<VoynichProgram>['grant']>('grant', grantInfo.data)
      if (grant.revoked || grant.model.toBase58() !== model.address || grant.enclave.toBase58() !== candidate.address) throw new VoynichError('GRANT_REQUIRED', 'The enclave has no active chain grant for this model.')
    }
    const manifest = decodeManifest(Uint8Array.from(chainModel.manifest))
    return { encryptionKey: Uint8Array.from(enclave.encryptionKey), signingKey: enclave.signingKey.toBase58(), manifest }
  }
  async function allocateWeights(keys: Keypair[], size: number, programId: PublicKey, signal?: AbortSignal): Promise<{ transactionsSent: number; feesLamports: bigint }> {
    const connection = await rpc(), active = signer(), capacity = 10 * 1024 * 1024 - 56
    let transactionsSent = 0
    let feesLamports = 0n
    for (let index = 0; index < keys.length; index++) {
      signal?.throwIfAborted()
      const allocation = keys[index]!, space = 56 + Math.min(capacity, size - index * capacity)
      const existing = await connection.getAccountInfo(allocation.publicKey, 'confirmed')
      if (existing) { if (!existing.owner.equals(programId) || existing.data.length !== space) throw new VoynichError('INVALID_WEIGHTS', 'A resumed weights allocation does not match this model.'); continue }
      const lifetime = await connection.getLatestBlockhash('confirmed')
      const instruction = SystemProgram.createAccount({ fromPubkey: active.publicKey, newAccountPubkey: allocation.publicKey, lamports: await connection.getMinimumBalanceForRentExemption(space), space, programId })
      let transaction = new VersionedTransaction(new TransactionMessage({ payerKey: active.publicKey, recentBlockhash: lifetime.blockhash, instructions: [instruction] }).compileToV0Message())
      if ('secretKey' in active) transaction.sign([active]); else transaction = await active.signTransaction(transaction)
      transaction.sign([allocation])
      const fee = transactionFeeLamports(transaction)
      const signature = await connection.sendRawTransaction(transaction.serialize(), { skipPreflight: false, maxRetries: 0 })
      for (;;) {
        const status = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0]
        if (status?.err) throw new VoynichError('ALLOCATION_FAILED', 'The weights allocation transaction failed.')
        if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') break
        if (await connection.getBlockHeight('confirmed') > lifetime.lastValidBlockHeight && !(await connection.isBlockhashValid(lifetime.blockhash, { commitment: 'finalized' })).value) {
          const final = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0]
          if (!final) throw new VoynichError('TRANSACTION_EXPIRED', 'The weights allocation expired. Resume using the saved sealing state.')
        }
        await wait(pollMs, signal)
      }
      transactionsSent++
      feesLamports += fee
    }
    return { transactionsSent, feesLamports }
  }
  async function verify(id: string, opts: { receipt?: ReceiptView; outputEnvelope?: string; signal?: AbortSignal } = {}): Promise<Verification> {
    const view = opts.receipt ?? await api.receipt(id, { signal: opts.signal })
    const config = await configured()
    const receipt = view.receipt
    const identifierBytes = fromBase58(id)
    const transactionIdentifier = identifierBytes.length === 64
    const identifierMatches = identifierBytes.length === 32 ? id === receipt.address || id === receipt.call : transactionIdentifier && id === receipt.transactionSignature
    if (!identifierMatches) return { verified: false, signature: false, record: false, expiry: false, answer: false, base: false, receipt, fixture: config.fixture, reason: 'The returned receipt does not match the requested identifier.' }
    if (opts.outputEnvelope && toHex(sha256(fromBase64(opts.outputEnvelope))) !== receipt.outputHash) return { verified: false, signature: false, record: false, expiry: false, answer: false, base: false, receipt, fixture: config.fixture, reason: 'Encrypted output hash does not match the receipt.' }
    const answerMatchesHash = receipt.answerMode === 'open'
      ? receipt.openAnswer !== null && toHex(sha256(fromBase64(receipt.openAnswer))) === receipt.outputHash
      : receipt.openAnswer === null
    const sigBytes = fromBase64(receipt.signature)
    const keyBytes = fromBase58(view.enclaveSigningKey)
    const callBytes = fromBase58(receipt.call)
    const inputHashBytes = fromHex(receipt.inputHash)
    const outputHashBytes = fromHex(receipt.outputHash)
    const checkSigForBase = (expectedBase: ModelBase | null, deliveredCount: bigint | null): { signature: boolean; base: boolean } => {
      const checkOne = (baseBytes: Uint8Array | null) =>
        deliveredCount !== null
          ? verifyPiece(sigBytes, keyBytes, callBytes, inputHashBytes, deliveredCount, outputHashBytes, baseBytes)
          : verifyReceipt(sigBytes, keyBytes, callBytes, inputHashBytes, outputHashBytes, baseBytes)
      if (!expectedBase) {
        return { signature: checkOne(null), base: true }
      }
      if (checkOne(fromHex(expectedBase.sha256))) {
        return { signature: true, base: true }
      }
      // Distinguish legacy pre-v2 adapter receipts (valid v1 signature without base commitment) from forged signatures.
      const legacyV1 = checkOne(null)
      return { signature: legacyV1, base: false }
    }
    const viewDeliveredCount = receipt.deliveredCount !== null ? BigInt(receipt.deliveredCount) : null
    const prelim = checkSigForBase(view.modelBase ?? null, viewDeliveredCount)
    if (config.fixture) return { verified: false, signature: prelim.signature, record: false, expiry: false, answer: answerMatchesHash, base: prelim.base, receipt, fixture: true, reason: 'Fixture attestation is not chain proof.' }
    if (config.programId !== PROGRAM_ID.toBase58()) throw new VoynichError('PROGRAM_MISMATCH', 'The API does not name the canonical Voynich program.')
    const connection = await rpc()
    const { voynich } = chainPrograms(connection)
    if (transactionIdentifier && !await transactionSettledReceipt(connection, voynich, id, receipt, options.fetch ?? globalThis.fetch.bind(globalThis), opts.signal)) return { verified: false, signature: prelim.signature, record: false, expiry: false, answer: answerMatchesHash, base: prelim.base, receipt, fixture: false, reason: 'The requested transaction did not settle this receipt.' }
    const receiptKey = new PublicKey(receipt.address), enclaveKey = new PublicKey(receipt.enclave), recordKey = new PublicKey(view.attestationRecord.address)
    const configAddress = addresses().config
    const infos = await connection.getMultipleAccountsInfo([configAddress, receiptKey, enclaveKey, recordKey, new PublicKey(receipt.model)], 'confirmed')
    if (infos.some(info => !info)) return { verified: false, signature: prelim.signature, record: false, expiry: false, answer: answerMatchesHash, base: false, receipt, fixture: false, reason: 'A required chain account is missing.' }
    const [configInfo, receiptInfo, enclaveInfo, recordInfo, modelInfo] = infos
    if (![configInfo!, receiptInfo!, enclaveInfo!, modelInfo!].every(info => info.owner.equals(voynich.programId))) return { verified: false, signature: prelim.signature, record: false, expiry: false, answer: answerMatchesHash, base: false, receipt, fixture: false, reason: 'A chain account owner does not match its program.' }
    const chainConfig = decodeConfigAccount(configInfo!.data)
    const derived = addresses(PROGRAM_ID, chainConfig.attestationProgram)
    const { attest } = chainPrograms(connection, { attestationProgramId: chainConfig.attestationProgram })
    if (!recordInfo!.owner.equals(chainConfig.attestationProgram)) return { verified: false, signature: prelim.signature, record: false, expiry: false, answer: answerMatchesHash, base: false, receipt, fixture: false, reason: 'The attestation owner does not match the chain configuration.' }
    const chainReceipt = decodeReceiptAccount(receiptInfo!.data)
    const enclave = voynich.coder.accounts.decode<IdlAccounts<VoynichProgram>['enclave']>('enclave', enclaveInfo!.data)
    const chainModel = voynich.coder.accounts.decode<IdlAccounts<VoynichProgram>['model']>('model', modelInfo!.data)
    const chainModelBase = decodeModelBaseBytes(modelInfo!.data)
    const viewBaseMatchesChain = chainModelBase === null
      ? (view.modelBase ?? null) === null
      : view.modelBase !== null &&
        view.modelBase !== undefined &&
        view.modelBase.sha256 === chainModelBase.sha256 &&
        view.modelBase.sizeBytes === chainModelBase.sizeBytes &&
        view.modelBase.format === chainModelBase.format &&
        view.modelBase.source === chainModelBase.source
    const chainDeliveredCount = chainReceipt.deliveredCount !== null ? BigInt(chainReceipt.deliveredCount.toString()) : null
    const sigCheck = checkSigForBase(chainModelBase, chainDeliveredCount)
    const signature = sigCheck.signature
    const base = sigCheck.base && viewBaseMatchesChain
    const currentAttestation = decodeAttestation(recordInfo!.data)
    const slot = BigInt(receipt.slot)
    const attestation = currentAttestation.recordedSlot <= slot ? currentAttestation : await historicalAttestation(connection, attest, recordKey, slot, options.fetch ?? globalThis.fetch.bind(globalThis))
    const keyMatches = enclave.signingKey.toBase58() === view.enclaveSigningKey && attestation.signingKey.equals(enclave.signingKey)
    const chainDeliveredStr = chainReceipt.deliveredCount?.toString() ?? null
    const chainReturnedStr = chainReceipt.returnedAmount?.toString() ?? null
    const meteredMatch = chainDeliveredStr === receipt.deliveredCount && chainReturnedStr === receipt.returnedAmount && (chainDeliveredStr === null) === (chainReturnedStr === null)
    const paymentsSumMatches = BigInt(receipt.payments.owner.amount) + BigInt(receipt.payments.operator.amount) + BigInt(receipt.payments.protocol.amount) === BigInt(receipt.payments.total)
    const paymentsMatch = meteredMatch && paymentsSumMatches && (chainReceipt.priceMint.equals(PublicKey.default) ? null : chainReceipt.priceMint.toBase58()) === receipt.payments.mint && chainReceipt.total.toString() === receipt.payments.total && chainReceipt.owner.toBase58() === receipt.payments.owner.recipient && chainReceipt.ownerAmount.toString() === receipt.payments.owner.amount && chainReceipt.operator.toBase58() === receipt.payments.operator.recipient && chainReceipt.operatorAmount.toString() === receipt.payments.operator.amount && chainReceipt.feeRecipient.toBase58() === receipt.payments.protocol.recipient && chainReceipt.protocolAmount.toString() === receipt.payments.protocol.amount
    const chainOpenAnswer = chainReceipt.openAnswer.length > 0 ? toBase64(chainReceipt.openAnswer) : null
    const answer = answerMatchesHash && chainReceipt.answerMode === receipt.answerMode && chainOpenAnswer === receipt.openAnswer && (chainReceipt.answerMode === 'sealed' ? chainReceipt.openAnswer.length === 0 : chainReceipt.openAnswer.length > 0 && toHex(sha256(chainReceipt.openAnswer)) === receipt.outputHash)
    const receiptMatches = paymentsMatch && derived.receipt(new PublicKey(receipt.call)).equals(receiptKey) && chainReceipt.call.toBase58() === receipt.call && chainReceipt.model.toBase58() === receipt.model && chainReceipt.enclave.toBase58() === receipt.enclave && toHex(Uint8Array.from(chainReceipt.inputHash)) === receipt.inputHash && toHex(Uint8Array.from(chainReceipt.outputHash)) === receipt.outputHash && toBase64(Uint8Array.from(chainReceipt.signature)) === receipt.signature && chainReceipt.slot.toString() === receipt.slot
    const measurementAllowed = chainModel.allowedMeasurements.some(measurement => toHex(Uint8Array.from(measurement)) === attestation.measurement)
    const record = keyMatches && receiptMatches && measurementAllowed && chainModel.name === receipt.modelName && derived.model(chainModel.name).equals(new PublicKey(receipt.model)) && derived.enclave(enclave.signingKey).equals(enclaveKey) && derived.record(enclave.signingKey).equals(recordKey) && enclave.attestationRecord.equals(recordKey) && chainConfig.attestationProgram.toBase58() === view.attestationProgramId && chainConfig.recordLayoutVersion === attestation.layoutVersion && attestation.layoutVersion === view.recordLayoutVersion
    const expiry = attestation.recordedSlot <= slot && attestation.expiresAtSlot > slot
    const verified = signature && record && expiry && answer && base
    return { verified, signature, record, expiry, answer, base, receipt, fixture: false, ...(!verified ? { reason: 'The signature, attestation binding, expiry, open answer or base commitment check failed.' } : {}) }
  }
  async function call(modelId: string, input: SketchInput | number[] | string, opts: CallOptions = {}) {
    const answerMode: AnswerMode = opts.answerMode ?? 'sealed'
    const model = await api.model(modelId, { signal: opts.signal })
    const granted = await api.modelEnclaves(model.address, { signal: opts.signal })
    const liveGranted = granted.items.filter(item => item.enclave.status === 'live' && item.enclave.reachable && item.grant.status === 'live')
    const selected = opts.enclave
      ? liveGranted.find(item => item.enclave.address === opts.enclave || item.enclave.signingKey === opts.enclave)
      : opts.strategy
        ? selectEnclave(liveGranted, { strategy: opts.strategy, modelOperatorShareBps: model.operatorShareBps })
        : liveGranted[0]
    if (!selected) throw new VoynichError('ENCLAVE_UNAVAILABLE', 'No live, reachable granted enclave is available.')
    const destination = await encryptionDestination(modelId, model, selected.enclave, true)
    if (opts.enclave && opts.enclave !== selected.enclave.address && opts.enclave !== destination.signingKey) throw new VoynichError('ENCLAVE_MISMATCH', 'The enclave does not match the requested call destination.')
    opts.onStep?.('encrypting')
    const caller = signer(), reply = generateEncryptionKeyPair()
    let callPayload: Record<string, unknown>
    if (destination.manifest.inputKind === 'text') {
      if (typeof input !== 'string') throw new VoynichError('INVALID_INPUT', 'Text models require a string prompt input.')
      callPayload = {
        input,
        ...(opts.maxTokens !== undefined ? { maxTokens: opts.maxTokens } : {}),
        outputPublicKey: toBase64(reply.publicKey),
      }
    } else {
      const value = destination.manifest.inputKind === 'sketch' ? preprocessSketch(input as SketchInput) : input
      callPayload = { input: value, outputPublicKey: toBase64(reply.publicKey) }
    }
    const encrypted = encryptCallInput(utf8(JSON.stringify(callPayload)), destination.encryptionKey)
    const inputHash = toHex(sha256(encrypted))
    opts.onStep?.('awaiting-signature')
    const build = await api.openCall({ wallet: caller.publicKey.toBase58(), model: model.address, enclave: selected.enclave.address, inputHash, answerMode, ...(opts.ceiling !== undefined ? { ceiling: opts.ceiling } : {}) }, { signal: opts.signal })
    await send(build, [], undefined, opts.signal)
    const callAddress = build.addresses.call!
    const opened = await indexed(() => api.call(callAddress, { signal: opts.signal }), 'CALL_NOT_FOUND', undefined, opts.signal)
    opts.onStep?.('escrowed')
    try {
    await api.relayInput(callAddress, { envelope: toBase64(encrypted) }, { signal: opts.signal })
    opts.onStep?.('answering')
    let answer: CallAnswer
    for (;;) {
      answer = await api.answer(callAddress, { signal: opts.signal })
      if (answer.status === 'answered') break
      if (answer.status === 'failed' || answer.call.status === 'refundable' || answer.call.status === 'refunded') throw new VoynichError(answer.failure?.code ?? 'CALL_FAILED', answer.failure?.message ?? 'The call did not settle.', answer.call, answer.failure?.refundState)
      await wait(pollMs, opts.signal)
    }
    if (!answer.outputHash || !answer.signature || !answer.receiptAddress || !answer.settleTransaction || (answerMode === 'sealed' && !answer.outputEnvelope)) throw new VoynichError('INVALID_ANSWER', 'The enclave answer is incomplete.', answer.call)
    if (answer.call.inputHash !== inputHash || answer.call.address !== callAddress || answer.call.model !== model.address || answer.call.enclave !== selected.enclave.address) throw new VoynichError('RECEIPT_MISMATCH', 'The answer does not belong to this call.', answer.call)
    const receiptView = await indexed(() => api.receipt(answer.receiptAddress!, { signal: opts.signal }), 'RECEIPT_NOT_FOUND', undefined, opts.signal)
    const verification = await verify(answer.receiptAddress!, { receipt: receiptView, ...(answerMode === 'sealed' ? { outputEnvelope: answer.outputEnvelope! } : {}), signal: opts.signal })
    if (verification.receipt.call !== callAddress || verification.receipt.inputHash !== inputHash || verification.receipt.model !== model.address || verification.receipt.enclave !== selected.enclave.address) throw new VoynichError('RECEIPT_MISMATCH', 'The receipt does not belong to this call.', answer.call)
    if (!verification.verified && !(verification.fixture && verification.signature && verification.answer && verification.base)) throw new VoynichError('VERIFICATION_FAILED', verification.reason ?? 'Receipt verification failed.', answer.call)
    let output: CallOutput
    if (answerMode === 'open') {
      const openBytes = fromBase64(verification.receipt.openAnswer!)
      const decoded = new TextDecoder().decode(openBytes)
      try { output = JSON.parse(decoded) as CallOutput } catch { output = { text: decoded, tokens: 0, finishReason: 'length' } }
    } else {
      output = JSON.parse(new TextDecoder().decode(decryptCallOutput(fromBase64(answer.outputEnvelope!), reply.secretKey))) as CallOutput
    }
    opts.onStep?.('verified')
    return { output, receipt: verification.receipt, verified: verification.verified, fixture: verification.fixture, checks: { signature: verification.signature, record: verification.record, expiry: verification.expiry, answer: verification.answer, base: verification.base } }
    } catch (error) {
      if (error instanceof VoynichError) throw error
      const code = error instanceof ApiClientError ? error.code : 'CALL_INTERRUPTED'
      throw new VoynichError(code, error instanceof Error ? error.message : 'The call was interrupted after escrow.', opened, code === 'CALL_DEADLINE_PASSED' ? 'refundable' : 'pending-deadline')
    }
  }
  async function* streamPieces(callAddress: string, opts: StreamPiecesOptions): AsyncGenerator<VerifiedStreamPiece> {
    const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis)
    const callBytes = fromBase58(callAddress)
    const inputHashBytes = typeof opts.inputHash === 'string' ? fromHex(opts.inputHash) : opts.inputHash
    let runningHash = streamInitialHash(callBytes, inputHashBytes)
    let expectedIndex = 0
    let count = 0
    let finished = false
    let reconnects = 0
    const maxReconnects = 5

    const processPiece = (rawPiece: StreamPiece): VerifiedStreamPiece => {
      const checked = verifyStreamPiece({
        piece: rawPiece,
        expectedCall: callAddress,
        expectedIndex,
        previousCount: count,
        previousRunningHash: runningHash,
        enclaveSigningKey: opts.enclaveSigningKey,
        inputHash: inputHashBytes,
        replySecretKey: opts.replySecretKey,
        baseSha256: opts.baseSha256,
      })
      runningHash = checked.nextRunningHash
      count = checked.nextCount
      expectedIndex++
      if (checked.verified.finishReason !== null) finished = true
      return checked.verified
    }

    while (!finished) {
      opts.signal?.throwIfAborted()
      const after = expectedIndex > 0 ? expectedIndex - 1 : undefined
      const url = api.callStreamUrl(callAddress, after)
      const headers: Record<string, string> = { Accept: 'text/event-stream', ...(options.headers ?? {}) }
      let response: Response | null = null
      try {
        response = await fetcher(url, { headers, signal: opts.signal })
      } catch (error) {
        if (opts.signal?.aborted) throw error
        response = null
      }
      if (response && response.ok && response.body) {
        try {
          for await (const frame of parseSseStream(response.body)) {
            opts.signal?.throwIfAborted()
            let parsedJson: unknown
            try { parsedJson = JSON.parse(frame.data) } catch { continue }
            const envelope = ProgramEvent.safeParse(parsedJson)
            if (envelope.success) {
              if (envelope.data.type === 'call.piece') {
                const piece = envelope.data.data
                if (piece.index < expectedIndex) continue
                yield processPiece(piece)
                if (finished) return
              } else if (envelope.data.type === 'call.stream.done') {
                const done = envelope.data.data
                if (done.status === 'failed') {
                  throw new VoynichError(done.failure?.code ?? 'CALL_FAILED', done.failure?.message ?? 'The stream failed.', undefined, done.failure?.refundState)
                }
                if (done.pieceCount > expectedIndex) {
                  // Catch up any missed tail pieces from /pieces before finishing.
                  break
                }
                finished = true
                return
              }
            } else {
              const directPiece = StreamPieceSchema.safeParse(parsedJson)
              if (directPiece.success) {
                if (directPiece.data.index < expectedIndex) continue
                yield processPiece(directPiece.data)
                if (finished) return
              }
            }
          }
        } catch (error) {
          if (error instanceof VoynichError || opts.signal?.aborted) throw error
        }
      }
      if (finished) return
      // Catch up via snapshot endpoint and verify whether stream completed or needs SSE reconnect.
      const snap = await api.callPieces(callAddress, { signal: opts.signal })
      for (const piece of snap.pieces) {
        if (piece.index < expectedIndex) continue
        yield processPiece(piece)
        if (finished) return
      }
      if (snap.status === 'failed') {
        throw new VoynichError(snap.failure?.code ?? 'CALL_FAILED', snap.failure?.message ?? 'The stream failed.', undefined, snap.failure?.refundState)
      }
      if (snap.status === 'done') return
      reconnects++
      if (reconnects > maxReconnects) {
        throw new VoynichError('STREAM_INTERRUPTED', 'The piece stream disconnected before finishing.')
      }
      await wait(Math.min(pollMs, 500), opts.signal)
    }
  }
  async function openStream(modelId: string, input: string, opts: OpenStreamOptions) {
    const model = await api.model(modelId, { signal: opts.signal })
    if (model.priceUnit !== 'token') throw new VoynichError('INVALID_MODEL', 'Streaming calls require a per-token model (priceUnit: token).')
    const granted = await api.modelEnclaves(model.address, { signal: opts.signal })
    const liveGranted = granted.items.filter(item => item.enclave.status === 'live' && item.enclave.reachable && item.grant.status === 'live')
    const selected = opts.enclave
      ? liveGranted.find(item => item.enclave.address === opts.enclave || item.enclave.signingKey === opts.enclave)
      : opts.strategy
        ? selectEnclave(liveGranted, { strategy: opts.strategy, modelOperatorShareBps: model.operatorShareBps })
        : liveGranted[0]
    if (!selected) throw new VoynichError('ENCLAVE_UNAVAILABLE', 'No live, reachable granted enclave is available.')
    const destination = await encryptionDestination(modelId, model, selected.enclave, true)
    if (opts.enclave && opts.enclave !== selected.enclave.address && opts.enclave !== destination.signingKey) throw new VoynichError('ENCLAVE_MISMATCH', 'The enclave does not match the requested call destination.')
    if (destination.manifest.inputKind !== 'text') throw new VoynichError('INVALID_INPUT', 'Streaming calls require a text model.')
    opts.onStep?.('encrypting')
    const caller = signer(), reply = generateEncryptionKeyPair()
    const stopTokenBytes = new Uint8Array(16)
    globalThis.crypto.getRandomValues(stopTokenBytes)
    const stopToken = toBase64(stopTokenBytes)
    const callPayload = {
      input,
      ...(opts.maxTokens !== undefined ? { maxTokens: opts.maxTokens } : {}),
      outputPublicKey: toBase64(reply.publicKey),
      stopToken,
    }
    const encrypted = encryptCallInput(utf8(JSON.stringify(callPayload)), destination.encryptionKey)
    const inputHash = toHex(sha256(encrypted))
    opts.onStep?.('awaiting-signature')
    const build = await api.openCall({
      wallet: caller.publicKey.toBase58(),
      model: model.address,
      enclave: selected.enclave.address,
      inputHash,
      answerMode: 'sealed',
      ceiling: opts.ceiling,
    }, { signal: opts.signal })
    await send(build, [], undefined, opts.signal)
    const callAddress = build.addresses.call!
    const opened = await indexed(() => api.call(callAddress, { signal: opts.signal }), 'CALL_NOT_FOUND', undefined, opts.signal)
    opts.onStep?.('escrowed')
    await api.relayInput(callAddress, { envelope: toBase64(encrypted) }, { signal: opts.signal })
    opts.onStep?.('streaming')
    const baseSha256 = model.base?.sha256 ?? null
    return {
      call: opened,
      model,
      enclave: selected.enclave,
      inputHash,
      baseSha256,
      enclaveSigningKey: destination.signingKey,
      replySecretKey: reply.secretKey,
      stopToken,
      stop: async () => { await api.stopCall(callAddress, { stopToken }, { signal: opts.signal }) },
      pieces: streamPieces(callAddress, {
        replySecretKey: reply.secretKey,
        enclaveSigningKey: destination.signingKey,
        inputHash,
        baseSha256,
        signal: opts.signal,
      }),
    }
  }
  async function stream(modelId: string, input: string, opts: StreamOptions = {}): Promise<VoynichStream> {
    const model = await api.model(modelId, { signal: opts.signal })
    if (model.priceUnit !== 'token') throw new VoynichError('INVALID_MODEL', 'Streaming calls require a per-token model (priceUnit: token).')
    const defaultTokens = BigInt(opts.maxTokens ?? model.manifest.tokenizer?.maxOutputTokens ?? 64)
    const ceiling = opts.ceiling ?? (defaultTokens * BigInt(model.price.amount)).toString()
    const opened = await openStream(modelId, input, {
      ceiling,
      enclave: opts.enclave,
      strategy: opts.strategy,
      maxTokens: opts.maxTokens,
      onStep: opts.onStep,
      signal: opts.signal,
    })
    const unitPrice = BigInt(opened.call.unitPrice.amount)
    const ceilingBig = BigInt(opened.call.ceiling?.amount ?? ceiling)
    const source = opened.pieces[Symbol.asyncIterator]()
    let text = ''
    let last: VerifiedStreamPiece | null = null
    let exhausted = false
    let stopPromise: Promise<void> | undefined
    let finalPromise: Promise<StreamResult> | undefined

    const nextPiece = async (): Promise<IteratorResult<VerifiedStreamPiece>> => {
      if (exhausted) return { done: true, value: undefined }
      const item = await source.next()
      if (item.done) {
        exhausted = true
        return { done: true, value: undefined }
      }
      const spent = BigInt(item.value.count) * unitPrice
      const remaining = ceilingBig > spent ? ceilingBig - spent : 0n
      const enriched: VerifiedStreamPiece = {
        ...item.value,
        spentAmount: spent.toString(),
        remainingAmount: remaining.toString(),
      }
      text += enriched.text
      last = enriched
      if (enriched.finishReason !== null) exhausted = true
      return { done: false, value: enriched }
    }

    const drain = async () => {
      while (!exhausted) {
        const res = await nextPiece()
        if (res.done) break
      }
    }

    const stop = async () => {
      stopPromise ??= opened.stop().then(() => undefined)
      return stopPromise
    }

    const settleStream = async (): Promise<StreamResult> => {
      if (!last) {
        throw new VoynichError('VERIFICATION_FAILED', 'No verified stream piece is available to settle yet.', opened.call)
      }
      const { receipt, verification } = await settle(opened.call.address, {
        count: last.count,
        runningHash: last.runningHash,
        signature: last.piece.signature,
      }, { signal: opts.signal })
      exhausted = true
      const refreshedCall = await api.call(opened.call.address, { signal: opts.signal }).catch(() => opened.call)
      opts.onStep?.('verified')
      return {
        text,
        count: last.count,
        finishReason: last.finishReason ?? 'stopped',
        call: refreshedCall,
        receipt,
        verified: verification.verified,
        fixture: verification.fixture,
        checks: {
          signature: verification.signature,
          record: verification.record,
          expiry: verification.expiry,
          answer: verification.answer,
          base: verification.base,
        },
        spentAmount: receipt.payments.total,
        returnedAmount: receipt.returnedAmount ?? '0',
        lastPiece: last,
      }
    }

    const final = () => {
      finalPromise ??= (async (): Promise<StreamResult> => {
        await drain()
        const callAddress = opened.call.address
        let settledCall = opened.call
        let receiptAddress = settledCall.receipt
        while (!receiptAddress) {
          opts.signal?.throwIfAborted()
          const [answer, latestCall] = await Promise.all([
            api.answer(callAddress, { signal: opts.signal }).catch(() => null),
            api.call(callAddress, { signal: opts.signal }),
          ])
          settledCall = latestCall
          if (latestCall.receipt) {
            receiptAddress = latestCall.receipt
            break
          }
          if (answer?.status === 'answered' && answer.receiptAddress) {
            receiptAddress = answer.receiptAddress
            break
          }
          if (answer?.status === 'failed' || latestCall.status === 'refundable' || latestCall.status === 'refunded') {
            const failure = answer?.failure ?? latestCall.failure
            throw new VoynichError(failure?.code ?? 'CALL_FAILED', failure?.message ?? 'The stream call did not settle.', latestCall, failure?.refundState)
          }
          await wait(pollMs, opts.signal)
        }
        const receiptView = await indexed(() => api.receipt(receiptAddress!, { signal: opts.signal }), 'RECEIPT_NOT_FOUND', undefined, opts.signal)
        if (!last) {
          throw new VoynichError('VERIFICATION_FAILED', 'The stream completed without any verified pieces.', settledCall)
        }
        if (
          receiptView.receipt.call !== callAddress ||
          receiptView.receipt.outputHash !== last.runningHash ||
          receiptView.receipt.deliveredCount !== String(last.count)
        ) {
          throw new VoynichError('RECEIPT_MISMATCH', 'The settled receipt does not match the last verified stream piece.', settledCall)
        }
        const verification = await verify(receiptAddress, { receipt: receiptView, signal: opts.signal })
        if (!verification.verified && !(verification.fixture && verification.signature && verification.answer && verification.base)) {
          throw new VoynichError('VERIFICATION_FAILED', verification.reason ?? 'Receipt verification failed.', settledCall)
        }
        const refreshedCall = await api.call(callAddress, { signal: opts.signal }).catch(() => settledCall)
        opts.onStep?.('verified')
        return {
          text,
          count: last.count,
          finishReason: last.finishReason,
          call: refreshedCall,
          receipt: verification.receipt,
          verified: verification.verified,
          fixture: verification.fixture,
          checks: {
            signature: verification.signature,
            record: verification.record,
            expiry: verification.expiry,
            answer: verification.answer,
            base: verification.base,
          },
          spentAmount: verification.receipt.payments.total,
          returnedAmount: verification.receipt.returnedAmount ?? '0',
          lastPiece: last,
        }
      })()
      return finalPromise
    }

    return {
      call: opened.call,
      model: opened.model,
      enclave: opened.enclave,
      ceiling,
      stop,
      settle: settleStream,
      lastPiece: () => last,
      final,
      [Symbol.asyncIterator]: () => ({ next: nextPiece }),
    }
  }
  async function settle(callAddress: string, piece: SettlePieceInput, opts: { signal?: AbortSignal } = {}): Promise<SettleResult> {
    const wallet = signer()
    const build = await api.settleCall(callAddress, {
      wallet: wallet.publicKey.toBase58(),
      count: String(piece.count),
      runningHash: piece.runningHash,
      signature: piece.signature,
    }, { signal: opts.signal })
    await send(build, [], undefined, opts.signal)
    const receiptAddress = build.addresses.receipt ?? callAddress
    const receiptView = await indexed(() => api.receipt(receiptAddress, { signal: opts.signal }), 'RECEIPT_NOT_FOUND', undefined, opts.signal)
    const verification = await verify(receiptView.receipt.address, { receipt: receiptView, signal: opts.signal })
    if (!verification.verified && !(verification.fixture && verification.signature && verification.answer && verification.base)) {
      throw new VoynichError('VERIFICATION_FAILED', verification.reason ?? 'Receipt verification failed.')
    }
    return { receipt: verification.receipt, verification }
  }
  async function grantMeasured(modelId: string, enclaveId: string, modelKey: Uint8Array, opts: { signal?: AbortSignal } = {}) {
    const model = await api.model(modelId, { signal: opts.signal })
    const detail = await api.enclave(enclaveId, { signal: opts.signal })
    const destination = await encryptionDestination(modelId, model, detail.enclave, false)
    if (enclaveId !== detail.enclave.address && enclaveId !== destination.signingKey) throw new VoynichError('ENCLAVE_MISMATCH', 'The enclave does not match the requested grant recipient.')
    const wrappedKey = wrapKey(modelKey, destination.encryptionKey)
    return sendMeasured(await api.grantByOwner(modelId, { wallet: signer().publicKey.toBase58(), enclave: detail.enclave.address, wrappedKey: toBase64(wrappedKey) }, { signal: opts.signal }), [], undefined, opts.signal)
  }
  async function grant(modelId: string, enclaveId: string, modelKey: Uint8Array, opts: { signal?: AbortSignal } = {}) {
    return (await grantMeasured(modelId, enclaveId, modelKey, opts)).status
  }
  async function refund(callId: string, opts: { signal?: AbortSignal } = {}) { return send(await api.refundCall(callId, { wallet: signer().publicKey.toBase58() }, { signal: opts.signal }), [], undefined, opts.signal) }
  async function setPrice(modelId: string, price: Money, operatorShareBps: number, opts: { priceUnit?: PriceUnit; signal?: AbortSignal } = {}) {
    return send(await api.setPrice(modelId, { wallet: signer().publicKey.toBase58(), price, operatorShareBps, ...(opts.priceUnit !== undefined ? { priceUnit: opts.priceUnit } : {}) }, { signal: opts.signal }), [], undefined, opts.signal)
  }
  async function retire(modelId: string, opts: { signal?: AbortSignal } = {}) {
    return send(await api.retireModel(modelId, { wallet: signer().publicKey.toBase58() }, { signal: opts.signal }), [], undefined, opts.signal)
  }
  async function revoke(modelId: string, enclaveId: string, opts: { signal?: AbortSignal } = {}) {
    const detail = await api.enclave(enclaveId, { signal: opts.signal })
    return send(await api.revokeGrant(modelId, { wallet: signer().publicKey.toBase58(), enclave: detail.enclave.address }, { signal: opts.signal }), [], undefined, opts.signal)
  }
  async function sweepExtraUploadKeys(extraKeys: Keypair[], ownerKey: PublicKey, signal?: AbortSignal): Promise<{ transactionsSent: number; feesLamports: bigint }> {
    if (!extraKeys.length) return { transactionsSent: 0, feesLamports: 0n }
    const connection = await rpc()
    const infos = await connection.getMultipleAccountsInfo(extraKeys.map(pair => pair.publicKey), 'confirmed')
    const lifetime = await connection.getLatestBlockhash('confirmed')
    let transactionsSent = 0
    let feesLamports = 0n
    await Promise.all(extraKeys.map(async (extra, index) => {
      signal?.throwIfAborted()
      const lamports = BigInt(infos[index]?.lamports ?? 0)
      const sweepFee = 5000n
      if (lamports <= sweepFee) return
      const instruction = SystemProgram.transfer({ fromPubkey: extra.publicKey, toPubkey: ownerKey, lamports: lamports - sweepFee })
      const transaction = new VersionedTransaction(new TransactionMessage({ payerKey: extra.publicKey, recentBlockhash: lifetime.blockhash, instructions: [instruction] }).compileToV0Message())
      transaction.sign([extra])
      const fee = transactionFeeLamports(transaction)
      const signature = await connection.sendRawTransaction(transaction.serialize(), { skipPreflight: false, maxRetries: 2 })
      for (;;) {
        const status = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0]
        if (status?.err) throw new VoynichError('SWEEP_FAILED', 'An upload key sweep transaction failed.')
        if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') break
        if (await connection.getBlockHeight('confirmed') > lifetime.lastValidBlockHeight && !(await connection.isBlockhashValid(lifetime.blockhash, { commitment: 'finalized' })).value) {
          const final = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0]
          if (!final) throw new VoynichError('TRANSACTION_EXPIRED', 'An upload key sweep transaction expired.')
        }
        await wait(Math.min(pollMs, 200), signal)
      }
      transactionsSent++
      feesLamports += fee
    }))
    return { transactionsSent, feesLamports }
  }
  async function seal(opts: SealOptions): Promise<SealResult> {
    const startedAt = Date.now()
    const wallet = signer()
    const config = await configured()
    const desiredUploadKeys = Math.max(1, Math.min(MAX_UPLOAD_KEYS, Math.trunc(opts.uploadKeyCount ?? DEFAULT_UPLOAD_KEYS)))
    let modelId = opts.resume?.model
    const modelName = opts.name ?? opts.manifest.name
    if (!modelId && !config.fixture) {
      if (!config.programId) throw new VoynichError('CONFIGURATION_REQUIRED', 'The Voynich program is not configured.')
      modelId = addresses(new PublicKey(config.programId)).model(modelName).toBase58()
    }
    const plaintextInput = opts.resume ? undefined : (opts.weights ?? (() => { throw new Error('Weights are required for a new sealing') })())
    let validatedBase: ModelBase | undefined
    if (opts.base !== undefined) {
      try {
        validatedBase = ModelBaseSchema.parse(opts.base)
      } catch (error) {
        throw new VoynichError('INVALID_BASE', error instanceof Error ? error.message : 'Base model metadata is invalid.')
      }
      if (plaintextInput) {
        let decoded
        try {
          decoded = decodeAdapter(plaintextInput)
        } catch (error) {
          throw new VoynichError('INVALID_ADAPTER', error instanceof Error ? error.message : 'Weights must be a valid voynich/adapter/v1 file when base is set.')
        }
        if (decoded.baseSha256 !== validatedBase.sha256) {
          throw new VoynichError('BASE_MISMATCH', `Adapter baseSha256 (${decoded.baseSha256}) does not match base.sha256 (${validatedBase.sha256}).`)
        }
      }
    }
    const expectedCipherLength = opts.resume
      ? opts.resume.ciphertext.length
      : plaintextInput!.length + Math.ceil(plaintextInput!.length / WEIGHTS_CHUNK_BYTES) * 16
    const neededWeightsCount = Math.ceil(expectedCipherLength / (10 * 1024 * 1024 - 56))
    if (neededWeightsCount > MAX_WEIGHTS) throw new VoynichError('MODEL_TOO_LARGE', `A model can use at most ${MAX_WEIGHTS} weights accounts.`)

    const canDerive = 'secretKey' in wallet || typeof wallet.signMessage === 'function'
    let uploadKey: Keypair
    let uploadKeys: Keypair[]
    let allUploadKeysPool: Keypair[]
    let weightsKeys: Keypair[]
    let ciphertext: Uint8Array
    let modelKey: Uint8Array
    let noncePrefix: Uint8Array
    let plaintextSizeBytes: number
    let deterministic = false

    if (opts.resume) {
      uploadKey = opts.resume.uploadKey
      uploadKeys = opts.resume.uploadKeys?.length ? opts.resume.uploadKeys : [uploadKey]
      allUploadKeysPool = uploadKeys
      weightsKeys = opts.resume.weightsKeys ?? Array.from({ length: neededWeightsCount }, () => Keypair.generate())
      ciphertext = opts.resume.ciphertext
      modelKey = opts.resume.modelKey
      noncePrefix = opts.resume.noncePrefix
      plaintextSizeBytes = opts.resume.plaintextSizeBytes
    } else if (canDerive && (!config.fixture || config.programId)) {
      const programKey = config.programId ? new PublicKey(config.programId) : PROGRAM_ID
      const derivedModel = modelId ?? addresses(programKey).model(modelName).toBase58()
      const derived = await signSealDerivation(wallet as SealDerivationSigner, programKey, derivedModel, {
        uploadKeyCount: MAX_UPLOAD_KEYS,
        weightsKeyCount: neededWeightsCount,
      })
      const sealed = sealWeights(plaintextInput!, derived.modelKey, {
        cipher: WEIGHTS_CIPHER,
        noncePrefix: derived.noncePrefix,
        plaintextBytes: plaintextInput!.length,
        chunkBytes: WEIGHTS_CHUNK_BYTES,
      })
      deterministic = true
      uploadKey = derived.uploadKey
      allUploadKeysPool = derived.uploadKeys
      uploadKeys = derived.uploadKeys.slice(0, desiredUploadKeys)
      weightsKeys = derived.weightsKeys
      ciphertext = sealed.ciphertext
      modelKey = sealed.key
      noncePrefix = sealed.header.noncePrefix
      plaintextSizeBytes = sealed.header.plaintextBytes
    } else {
      if (!config.fixture) throw new VoynichError('SIGN_MESSAGE_REQUIRED', 'Connect a wallet that supports signMessage to derive resumable sealing keys.')
      const sealed = sealWeights(plaintextInput!)
      uploadKey = Keypair.generate()
      uploadKeys = [uploadKey, ...Array.from({ length: desiredUploadKeys - 1 }, () => Keypair.generate())]
      allUploadKeysPool = uploadKeys
      weightsKeys = Array.from({ length: neededWeightsCount }, () => Keypair.generate())
      ciphertext = sealed.ciphertext
      modelKey = sealed.key
      noncePrefix = sealed.header.noncePrefix
      plaintextSizeBytes = sealed.header.plaintextBytes
    }

    let transactions = 0
    let transactionsSent = 0
    let feesLamports = 0n
    let writeChunkBytes: number = WRITE_CHUNK_BYTES
    const emit = (step: SealProgress['step'], bytesWritten: number, transactionsWritten: number) => {
      opts.onProgress?.({
        step,
        bytesWritten,
        totalBytes: ciphertext.length,
        transactionsWritten,
        transactionsSent,
        elapsedMs: Math.max(0, Date.now() - startedAt),
        feesLamports: feesLamports.toString(),
      })
    }
    let existing: Model | undefined
    if (modelId) { try { existing = await api.model(modelId, { signal: opts.signal }) } catch (error) { if (!(error instanceof ApiClientError) || error.code !== 'MODEL_NOT_FOUND') throw error } }
    if (existing) {
      if (existing.base && validatedBase) {
        if (
          existing.base.sha256 !== validatedBase.sha256 ||
          existing.base.sizeBytes !== validatedBase.sizeBytes ||
          existing.base.format !== validatedBase.format ||
          existing.base.source !== validatedBase.source
        ) {
          throw new VoynichError('RESUME_MISMATCH', 'Supplied base does not match the on-chain model base.')
        }
      } else if (existing.base && !validatedBase) {
        validatedBase = existing.base
        if (plaintextInput) {
          let decoded
          try {
            decoded = decodeAdapter(plaintextInput)
          } catch (error) {
            throw new VoynichError('INVALID_ADAPTER', error instanceof Error ? error.message : 'Weights must be a valid voynich/adapter/v1 file to resume this adapter model.')
          }
          if (decoded.baseSha256 !== existing.base.sha256) {
            throw new VoynichError('BASE_MISMATCH', `Adapter baseSha256 (${decoded.baseSha256}) does not match the on-chain model base.sha256 (${existing.base.sha256}).`)
          }
        }
      } else if (!existing.base && validatedBase) {
        throw new VoynichError('RESUME_MISMATCH', 'Cannot attach a base model when resuming a standalone model.')
      }
    }
    if (!existing) {
      let initialWeightsCount = Math.min(weightsKeys.length, INITIAL_CREATE_WEIGHTS)
      const makeCreate = (keys: Keypair[], initialWeights: Keypair[]) => ({
        wallet: wallet.publicKey.toBase58(),
        uploadKey: keys[0]!.publicKey.toBase58(),
        uploadKeys: keys.map(key => key.publicKey.toBase58()),
        weights: initialWeights.map(key => key.publicKey.toBase58()),
        name: modelName,
        manifest: opts.manifest,
        plaintextSizeBytes,
        cipher: { id: 'xchacha20poly1305-64k-v1' as const, chunkSizeBytes: 65536 as const, noncePrefix: toBase64(noncePrefix) },
        price: opts.price,
        ...(opts.priceUnit !== undefined ? { priceUnit: opts.priceUnit } : {}),
        operatorShareBps: opts.operatorShareBps,
        allowedMeasurements: opts.allowedMeasurements,
        ...(validatedBase ? { base: validatedBase } : {}),
      })
      let create = makeCreate(uploadKeys, weightsKeys.slice(0, initialWeightsCount))
      let quote = await api.quoteModel({ sizeBytes: ciphertext.length, uploadKeyCount: uploadKeys.length, create }, { signal: opts.signal })
      while (quote.canCreate !== true && initialWeightsCount > 1) {
        initialWeightsCount--
        create = makeCreate(uploadKeys, weightsKeys.slice(0, initialWeightsCount))
        quote = await api.quoteModel({ sizeBytes: ciphertext.length, uploadKeyCount: uploadKeys.length, create }, { signal: opts.signal })
      }
      while (quote.canCreate !== true && uploadKeys.length > 1) {
        uploadKeys = uploadKeys.slice(0, -1)
        create = makeCreate(uploadKeys, weightsKeys.slice(0, initialWeightsCount))
        quote = await api.quoteModel({ sizeBytes: ciphertext.length, uploadKeyCount: uploadKeys.length, create }, { signal: opts.signal })
      }
      writeChunkBytes = quote.writeChunkBytes
      if (quote.canCreate !== true) throw new VoynichError('CREATE_MODEL_TOO_LARGE', `The create_model transaction is ${quote.createTransactionBytes ?? 'unknown'} bytes; the wallet-safe maximum is ${quote.createTransactionMaxBytes}. Reduce the manifest or measurements before allocating accounts.`)
      emit('create', 0, 0)
      if (!config.fixture) {
        await opts.onPrepared?.({ model: modelId!, ciphertext, modelKey, uploadKey, uploadKeys, plaintextSizeBytes, noncePrefix, weightsKeys })
        const allocated = await allocateWeights(weightsKeys, ciphertext.length, new PublicKey(config.programId!), opts.signal)
        transactionsSent += allocated.transactionsSent
        feesLamports += allocated.feesLamports
      }
      const uploadFundingLamports = BigInt(opts.uploadFundingLamports) >= BigInt(quote.uploadFundingLamports) || config.fixture
        ? opts.uploadFundingLamports
        : quote.uploadFundingLamports
      const request = { ...create, sizeBytes: ciphertext.length, uploadFundingLamports }
      const build = await api.createModel(request, { signal: opts.signal })
      modelId = build.addresses.model!
      await opts.onPrepared?.({ model: modelId, ciphertext, modelKey, uploadKey, uploadKeys, plaintextSizeBytes, noncePrefix, weightsKeys })
      const created = await sendMeasured(build, [uploadKey], undefined, opts.signal)
      transactionsSent++
      feesLamports += created.feeLamports
    }
    const resume: SealResume = { model: modelId!, ciphertext, modelKey, uploadKey, uploadKeys, plaintextSizeBytes, noncePrefix, weightsKeys }
    modelId = resume.model
    let model = existing ?? await indexed(() => api.model(modelId!, { signal: opts.signal }), 'MODEL_NOT_FOUND', undefined, opts.signal)
    if (model.owner !== wallet.publicKey.toBase58() || model.sizeBytes !== ciphertext.length) throw new VoynichError('RESUME_MISMATCH', 'The sealing state does not match the on-chain model.')
    if (model.cipher.noncePrefix !== toBase64(noncePrefix)) {
      throw new VoynichError('RESUME_MISMATCH', deterministic ? 'This model was created with non-deterministic keys; supply its saved owner state file to resume.' : 'The sealing state does not match the on-chain model.')
    }
    if (model.upload && !model.upload.closed && model.upload.uploadKey !== uploadKey.publicKey.toBase58()) throw new VoynichError('RESUME_MISMATCH', 'The sealing state does not match the on-chain model.')
    let activeUploadKeyCount = uploadKeys.length
    if (model.status === 'uploading') {
      if (!config.fixture && model.weights.length < weightsKeys.length) {
        // Ensure any unallocated deterministic weights accounts exist on chain before attaching.
        const allocated = await allocateWeights(weightsKeys, ciphertext.length, new PublicKey(config.programId!), opts.signal)
        transactionsSent += allocated.transactionsSent
        feesLamports += allocated.feesLamports
        for (let cursor = model.weights.length; cursor < weightsKeys.length; cursor += ATTACH_WEIGHTS_BATCH) {
          const batch = weightsKeys.slice(cursor, cursor + ATTACH_WEIGHTS_BATCH).map(key => key.publicKey.toBase58())
          const attached = await sendMeasured(
            await api.attachWeights(modelId, { wallet: uploadKey.publicKey.toBase58(), weights: batch }, { signal: opts.signal }),
            [],
            uploadKey,
            opts.signal,
            Math.min(pollMs, 200),
          )
          transactionsSent++
          feesLamports += attached.feeLamports
        }
        model = await indexed(() => api.model(modelId!, { signal: opts.signal }), 'MODEL_NOT_FOUND', value => value.weights.length >= weightsKeys.length, opts.signal)
      }
      let confirmedBytes = model.upload?.bytesWritten ?? 0
      transactions = model.upload?.transactionsWritten ?? 0
      let unwritten: { offset: number; length: number }[] = []
      if (!config.fixture && existing) {
        const connection = await rpc()
        const chainCheck = await findUnwrittenRangesFromChain({
          connection,
          programId: new PublicKey(config.programId!),
          modelAddress: new PublicKey(model.address),
          weightsAddresses: model.weights.map(w => new PublicKey(w.address)),
          ciphertext,
          modelKey,
          noncePrefix,
          writeChunkBytes,
        })
        unwritten = chainCheck.unwritten
        confirmedBytes = Math.max(confirmedBytes, chainCheck.bytesAlreadyValid)
      } else {
        const ranges = model.upload?.writtenRanges ?? []
        for (let offset = 0; offset < ciphertext.length;) {
          const containing = ranges.find(range => range.offset <= offset && range.offset + range.length > offset)
          if (containing) { offset = containing.offset + containing.length; continue }
          const next = ranges.find(range => range.offset > offset)?.offset ?? ciphertext.length
          const account = model.weights.find(weight => weight.offset <= offset && weight.offset + weight.sizeBytes > offset)
          if (!account) throw new VoynichError('INVALID_WEIGHTS', 'The model weights accounts do not cover this byte range.')
          const length = Math.min(writeChunkBytes, next - offset, account.offset + account.sizeBytes - offset)
          unwritten.push({ offset, length }); offset += length
        }
      }
      const authorized = new Set(model.upload?.uploadKeys.length ? model.upload.uploadKeys : [uploadKey.publicKey.toBase58()])
      const activeKeys = allUploadKeysPool.filter(pair => authorized.has(pair.publicKey.toBase58()))
      if (!activeKeys.length) throw new VoynichError('RESUME_MISMATCH', 'No authorized upload key is available for this model.')
      activeUploadKeyCount = activeKeys.length
      if (unwritten.length > 0) {
        const perKey = Math.max(1, Math.ceil(unwritten.length / activeKeys.length))
        const perKeyConcurrency = 2
        const writePollMs = Math.min(pollMs, 200)
        const writeAbort = new AbortController()
        const onParentAbort = () => writeAbort.abort(opts.signal?.reason)
        opts.signal?.addEventListener('abort', onParentAbort, { once: true })
        try {
          await Promise.all(activeKeys.map(async (key, keyIndex) => {
            const slice = unwritten.slice(keyIndex * perKey, (keyIndex + 1) * perKey)
            let nextIndex = 0
            const lane = async () => {
              while (!writeAbort.signal.aborted) {
                const index = nextIndex++
                if (index >= slice.length) return
                const chunk = slice[index]!
                const written = await sendMeasured(
                  await api.writeWeights(resume.model, { wallet: key.publicKey.toBase58(), offset: chunk.offset, bytesBase64: toBase64(ciphertext.subarray(chunk.offset, chunk.offset + chunk.length)) }, { signal: writeAbort.signal }),
                  [],
                  key,
                  writeAbort.signal,
                  writePollMs,
                )
                confirmedBytes = Math.min(ciphertext.length, confirmedBytes + chunk.length)
                transactions++; transactionsSent++; feesLamports += written.feeLamports
                emit('upload', confirmedBytes, transactions)
              }
            }
            await Promise.all(Array.from({ length: Math.min(perKeyConcurrency, slice.length) }, () => lane()))
          }))
        } catch (error) {
          writeAbort.abort(error)
          throw error
        } finally {
          opts.signal?.removeEventListener('abort', onParentAbort)
        }
      }
      emit('seal', ciphertext.length, transactions)
      if (model.hashVersion === 1) {
        const totalChunks = Math.ceil(ciphertext.length / CIPHER_CHUNK_BYTES)
        let sealedChunks = model.sealedChunks ?? 0
        if (!config.fixture && existing) {
          const connection = await rpc()
          const { voynich } = chainPrograms(connection, { programId: config.programId! })
          const onChain = await voynich.account.model.fetch(new PublicKey(model.address))
          sealedChunks = (onChain as { sealedChunks?: number }).sealedChunks ?? sealedChunks
        }
        const rangePollMs = Math.min(pollMs, 200)
        while (sealedChunks + SEAL_RANGE_CHUNKS < totalChunks) {
          const rangeTx = await sendMeasured(
            await api.sealRange(modelId, { wallet: uploadKey.publicKey.toBase58(), chunkCount: SEAL_RANGE_CHUNKS }, { signal: opts.signal }),
            [],
            uploadKey,
            opts.signal,
            rangePollMs,
          )
          sealedChunks += SEAL_RANGE_CHUNKS
          transactionsSent++
          feesLamports += rangeTx.feeLamports
          emit('seal', ciphertext.length, transactions)
        }
      }
      if (!config.fixture && activeKeys.length > 1) {
        const swept = await sweepExtraUploadKeys(activeKeys.slice(1), wallet.publicKey, opts.signal)
        transactionsSent += swept.transactionsSent
        feesLamports += swept.feesLamports
      }
      const sealedTx = await sendMeasured(await api.sealModel(modelId, { wallet: wallet.publicKey.toBase58(), ciphertextSha256: toHex(ciphertextHash(ciphertext, model.hashVersion)) }, { signal: opts.signal }), [uploadKey], undefined, opts.signal)
      transactionsSent++
      feesLamports += sealedTx.feeLamports
    } else if (!config.fixture && deterministic) {
      // Sweep any leftover lamports on deterministic upload keys if a previous run ended after sealing.
      const swept = await sweepExtraUploadKeys(allUploadKeysPool, wallet.publicKey, opts.signal)
      transactionsSent += swept.transactionsSent
      feesLamports += swept.feesLamports
    }
    model = await indexed(() => api.model(modelId!, { signal: opts.signal }), 'MODEL_NOT_FOUND', value => value.status !== 'uploading', opts.signal)
    if (opts.grantEnclave && model.status === 'sealed') {
      emit('grant', ciphertext.length, transactions)
      const granted = await grantMeasured(modelId, opts.grantEnclave, modelKey, { signal: opts.signal })
      transactionsSent++
      feesLamports += granted.feeLamports
      model = await indexed(() => api.model(modelId!, { signal: opts.signal }), 'MODEL_NOT_FOUND', value => value.status === 'live', opts.signal)
    }
    const elapsedMs = Math.max(0, Date.now() - startedAt)
    emit('done', ciphertext.length, transactions)
    return {
      model,
      resume,
      uploadKeyCount: activeUploadKeyCount,
      bytesWritten: ciphertext.length,
      totalBytes: ciphertext.length,
      transactionsSent,
      elapsedMs,
      feesLamports: feesLamports.toString(),
    }
  }
  async function publishMeasurement(
    input: { digest: string; sourceRepo: string; commitSha: string; recipeHash: string; version: string },
    opts: { signal?: AbortSignal } = {},
  ): Promise<MeasurementRecord> {
    const wallet = signer()
    await send(await api.publishMeasurement({ wallet: wallet.publicKey.toBase58(), ...input }, { signal: opts.signal }), [], undefined, opts.signal)
    return indexed(() => api.measurement(input.digest, { signal: opts.signal }), 'MEASUREMENT_NOT_FOUND', undefined, opts.signal)
  }
  async function deprecateMeasurement(digest: string, opts: { signal?: AbortSignal } = {}): Promise<MeasurementRecord> {
    const wallet = signer()
    await send(await api.deprecateMeasurement(digest, { wallet: wallet.publicKey.toBase58() }, { signal: opts.signal }), [], undefined, opts.signal)
    return indexed(() => api.measurement(digest, { signal: opts.signal }), 'MEASUREMENT_NOT_FOUND', value => value.status === 'deprecated', opts.signal)
  }
  async function policy(modelId: string, opts: { signal?: AbortSignal } = {}): Promise<ModelPolicy | null> {
    try {
      return await api.modelPolicy(modelId, { signal: opts.signal })
    } catch (error) {
      if (error instanceof ApiClientError && error.code === 'POLICY_NOT_FOUND') return null
      throw error
    }
  }
  async function setPolicy(
    modelId: string,
    input: {
      allowListEnabled: boolean
      allowedCallers?: string[]
      maxCallsPerCallerPerWindow?: number
      windowSlots?: string
      allowedOperators?: string[]
      allowedRegions?: string[]
    },
    opts: { signal?: AbortSignal } = {},
  ): Promise<ModelPolicy> {
    const wallet = signer()
    await send(await api.setPolicy(modelId, {
      wallet: wallet.publicKey.toBase58(),
      allowListEnabled: input.allowListEnabled,
      allowedCallers: input.allowedCallers ?? [],
      maxCallsPerCallerPerWindow: input.maxCallsPerCallerPerWindow ?? 0,
      windowSlots: input.windowSlots ?? '0',
      allowedOperators: input.allowedOperators ?? [],
      allowedRegions: input.allowedRegions ?? [],
    }, { signal: opts.signal }), [], undefined, opts.signal)
    return indexed(() => api.modelPolicy(modelId, { signal: opts.signal }), 'POLICY_NOT_FOUND', undefined, opts.signal)
  }
  async function clearPolicy(modelId: string, opts: { signal?: AbortSignal } = {}): Promise<TxStatus> {
    const wallet = signer()
    return send(await api.clearPolicy(modelId, { wallet: wallet.publicKey.toBase58() }, { signal: opts.signal }), [], undefined, opts.signal)
  }
  async function setQuote(
    enclaveKey: string,
    modelId: string,
    operatorShareBps: number | null,
    opts: { signal?: AbortSignal } = {},
  ): Promise<TxStatus> {
    const wallet = signer()
    return send(await api.setQuote(enclaveKey, {
      model: modelId,
      operatorShareBps,
      payer: wallet.publicKey.toBase58(),
    }, { signal: opts.signal }), [], undefined, opts.signal)
  }
  async function listVersions(modelId: string, opts: { signal?: AbortSignal } = {}): Promise<ModelVersions> {
    return api.modelVersions(modelId, { signal: opts.signal })
  }
  async function publishVersion(modelId: string, opts: PublishVersionOptions): Promise<PublishVersionResult> {
    const wallet = signer()
    const [config, current] = await Promise.all([
      api.config({ signal: opts.signal }),
      api.model(modelId, { signal: opts.signal }),
    ])
    const version = (current.currentVersion ?? 1) + 1
    let modelKey = opts.modelKey
    const programId = config.programId ? new PublicKey(config.programId) : PROGRAM_ID
    if (!modelKey) {
      const derived = await signSealDerivation(wallet as SealDerivationSigner, programId, current.address)
      modelKey = derived.modelKey
    }
    const expectedCiphertextLen = opts.weights.length + Math.ceil(opts.weights.length / WEIGHTS_CHUNK_BYTES) * 16
    const capacity = 10 * 1024 * 1024 - 56
    const manifest = opts.manifest ?? current.manifest
    const base = opts.base === undefined ? (current.base ?? undefined) : (opts.base ?? undefined)

    let resuming = false
    let resumeNoncePrefix: Uint8Array | null = null
    let weightsAddresses: string[] = []
    let sealedChunks = 0
    const existingWeightsData = new Map<string, { writtenBytes: number; bytes: Uint8Array | null }>()

    if (!config.fixture) {
      const conn = await rpc()
      const mvPda = modelVersionPda(new PublicKey(current.address), version, programId)
      const mvInfo = await conn.getAccountInfo(mvPda, 'confirmed')
      if (mvInfo) {
        const mv = decodeModelVersionAccount(mvInfo.data)
        if (mv.status !== 'uploading') {
          throw new VoynichError('INVALID_VERSION', `Version ${version} is already ${mv.status}.`)
        }
        const onChainSize = Number(mv.sizeBytes.toString())
        if (onChainSize !== expectedCiphertextLen) {
          throw new VoynichError('INVALID_WEIGHTS', `Uploading version ${version} expects ${onChainSize} ciphertext bytes, got ${expectedCiphertextLen}.`)
        }
        resuming = true
        resumeNoncePrefix = mv.noncePrefix
        weightsAddresses = mv.weights.map(k => k.toBase58())
        sealedChunks = mv.sealedChunks
        // Inspect existing Weights accounts so any already-written slices can be skipped on resume.
        const infos = await conn.getMultipleAccountsInfo(mv.weights, 'confirmed')
        for (let i = 0; i < mv.weights.length; i++) {
          const info = infos[i]
          if (!info) continue
          const hdr = decodeWeightsHeader(info.data)
          existingWeightsData.set(mv.weights[i]!.toBase58(), {
            writtenBytes: hdr.writtenBytes,
            bytes: hdr.writtenBytes > 0 ? info.data.subarray(56, 56 + hdr.sizeBytes) : null,
          })
        }
      }
    } else {
      const existingVersions = await api.modelVersions(current.address, { signal: opts.signal }).catch(() => null)
      const uploading = existingVersions?.items.find(v => v.version === version && v.status === 'uploading')
      if (uploading) {
        if (uploading.sizeBytes !== expectedCiphertextLen) {
          throw new VoynichError('INVALID_WEIGHTS', `Uploading version ${version} expects ${uploading.sizeBytes} ciphertext bytes, got ${expectedCiphertextLen}.`)
        }
        resuming = true
      }
    }

    const sealed = resumeNoncePrefix
      ? sealWeights(opts.weights, modelKey, {
          cipher: WEIGHTS_CIPHER,
          noncePrefix: resumeNoncePrefix,
          plaintextBytes: opts.weights.length,
          chunkBytes: WEIGHTS_CHUNK_BYTES,
        })
      : sealWeights(opts.weights, modelKey)
    const ciphertext = sealed.ciphertext
    const noncePrefix = toBase64(sealed.header.noncePrefix)
    const ciphertextSha256 = toHex(sealed.merkleRoot)
    const partCount = Math.ceil(ciphertext.length / capacity)
    if (partCount > INITIAL_CREATE_WEIGHTS) {
      throw new VoynichError('INVALID_WEIGHTS', `Model version ciphertext exceeds ${INITIAL_CREATE_WEIGHTS} weights accounts.`)
    }

    let transactionsSent = 0
    if (!resuming) {
      const weightKeys = Array.from({ length: partCount }, () => Keypair.generate())
      weightsAddresses = weightKeys.map(k => k.publicKey.toBase58())
      if (!config.fixture) {
        const conn = await rpc()
        const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed')
        for (let i = 0; i < weightKeys.length; i++) {
          const partBytes = Math.min(capacity, ciphertext.length - i * capacity)
          const space = 56 + partBytes
          const rent = await conn.getMinimumBalanceForRentExemption(space)
          const createIx = SystemProgram.createAccount({
            fromPubkey: wallet.publicKey,
            newAccountPubkey: weightKeys[i]!.publicKey,
            lamports: rent,
            space,
            programId,
          })
          let tx = new VersionedTransaction(new TransactionMessage({
            payerKey: wallet.publicKey,
            recentBlockhash: blockhash,
            instructions: [createIx],
          }).compileToV0Message())
          if ('secretKey' in wallet) tx.sign([wallet])
          else tx = await wallet.signTransaction(tx)
          tx.sign([weightKeys[i]!])
          const sig = await conn.sendRawTransaction(tx.serialize(), { preflightCommitment: 'confirmed' })
          await confirmSignatureHttp(conn, sig, lastValidBlockHeight, opts.signal)
          transactionsSent++
        }
      }
      await send(await api.beginVersion(current.address, {
        wallet: wallet.publicKey.toBase58(),
        version,
        weights: weightsAddresses,
        manifest,
        sizeBytes: ciphertext.length,
        noncePrefix,
        ...(base ? { base } : {}),
      }, { signal: opts.signal }), [], undefined, opts.signal)
      transactionsSent++
    } else if (weightsAddresses.length === 0) {
      weightsAddresses = Array.from({ length: partCount }, () => Keypair.generate().publicKey.toBase58())
    }

    const writeTasks: Array<{ weights: string; offset: number; slice: Uint8Array }> = []
    for (let i = 0; i < weightsAddresses.length; i++) {
      const partStart = i * capacity
      const partLen = Math.min(capacity, ciphertext.length - partStart)
      const weightsAddr = weightsAddresses[i]!
      const existing = existingWeightsData.get(weightsAddr)
      for (let offset = 0; offset < partLen; offset += VERSION_WRITE_CHUNK_BYTES) {
        const end = Math.min(partLen, offset + VERSION_WRITE_CHUNK_BYTES)
        const slice = ciphertext.subarray(partStart + offset, partStart + end)
        if (existing && existing.bytes && end <= existing.writtenBytes && bytesEqual(existing.bytes.subarray(offset, end), slice)) {
          continue
        }
        writeTasks.push({ weights: weightsAddr, offset, slice })
      }
    }

    let nextWrite = 0
    const workerCount = Math.min(VERSION_WRITE_CONCURRENCY, writeTasks.length)
    await Promise.all(Array.from({ length: workerCount }, async () => {
      while (nextWrite < writeTasks.length) {
        const task = writeTasks[nextWrite++]!
        await send(await api.writeVersionWeights(current.address, {
          wallet: wallet.publicKey.toBase58(),
          version,
          weights: task.weights,
          offset: task.offset,
          bytesBase64: toBase64(task.slice),
        }, { signal: opts.signal }), [], undefined, opts.signal)
        transactionsSent++
      }
    }))

    const totalChunks = Math.ceil(ciphertext.length / CIPHER_CHUNK_BYTES)
    while (totalChunks - sealedChunks > SEAL_RANGE_CHUNKS) {
      const count = Math.min(SEAL_RANGE_CHUNKS, totalChunks - sealedChunks)
      await send(await api.sealVersionRange(current.address, {
        wallet: wallet.publicKey.toBase58(),
        version,
        chunkCount: count,
      }, { signal: opts.signal }), [], undefined, opts.signal)
      sealedChunks += count
      transactionsSent++
    }

    await send(await api.publishVersion(current.address, {
      wallet: wallet.publicKey.toBase58(),
      version,
      ciphertextSha256,
    }, { signal: opts.signal }), [], undefined, opts.signal)
    transactionsSent++

    const updated = await indexed(
      () => api.model(current.address, { signal: opts.signal }),
      'MODEL_NOT_FOUND',
      value => (value.currentVersion ?? 1) >= version,
      opts.signal,
    )
    return { model: updated, version, ciphertextSha256, noncePrefix, transactionsSent }
  }
  return { api, call, stream, openStream, streamPieces, settle, verify, seal, grant, refund, setPrice, retire, revoke, setQuote, listVersions, publishVersion, publishMeasurement, deprecateMeasurement, policy, setPolicy, clearPolicy, models: api.models, model: api.model, enclaves: api.enclaves, enclave: api.enclave, measurements: api.measurements, measurement: api.measurement, account: (wallet = signer().publicKey.toBase58()) => api.account(wallet), send }
}
export type Voynich = ReturnType<typeof createVoynich>
