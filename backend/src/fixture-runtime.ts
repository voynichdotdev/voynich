import { randomUUID, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { z } from 'zod'
import { decodeManifest, errors, fromBase58, toBase58, type Bounty, type BountyAttempt, type Build, type Call, type CallAnswer, type CallPieces, type CallStreamDone, type Enclave, type ErrorCode, type Grant, type MeasurementRecord, type Model, type ModelPolicy, type Receipt, type StopCallAccepted, type StreamFinishReason, type StreamPiece, type TxStatus, type TxSubmission } from '@voynich/contract'
import { FIXTURE, fixtureAddress, fixtureBounty, fixtureCall, fixtureConfig, fixtureEnclave, fixtureGrant, fixtureModel, fixtureReceipt, fixtureSignature, fixtureTransaction } from '@voynich/contract/fixtures'
import { CIPHER_CHUNK_BYTES, decryptCallInput, encryptCallOutput, encryptionPublicKey, fromBase64, fromHex, sealWeights, sha256, signPiece, signReceipt, signingPublicKey, streamInitialHash, streamNextHash, toBase64, toHex, utf8, verifyPiece, wrapKey } from 'voynich/crypto'
import { ApiFailure, failer, parse, type Fail } from './engines/server/errors.js'
import { EventHub, streamEvent } from './engines/server/sse.js'

export const fail: Fail<ErrorCode> = failer(errors.status)
// Public, fixture-only seeds. Never used by any chain/runtime mode.
const encryptionSeed = sha256(utf8('voynich/fixture/enclave/encryption/v1'))
const signingSeed = sha256(utf8('voynich/fixture/enclave/signing/v1'))
const weightsPath = new URL('../models/sketch-32/sketch-32.onnx', import.meta.url)
const plaintextWeights = existsSync(weightsPath) ? new Uint8Array(readFileSync(weightsPath)) : new Uint8Array(65536).map((_, i) => i % 251)
const sealed = sealWeights(plaintextWeights, sha256(utf8('voynich/fixture/model/v1')))
const manifestPath = new URL('../models/sketch-32/manifest.json', import.meta.url)
const manifest = existsSync(manifestPath) ? decodeManifest(readFileSync(manifestPath, 'utf8')) : fixtureModel.manifest
type LedgerEntry = { build: Build; commit: () => void; status?: TxStatus; submission?: string }

export class FixtureState {
  readonly hub = new EventHub()
  readonly builds = new Map<string, LedgerEntry>()
  readonly bytes = new Map<string, Uint8Array>()
  readonly answers = new Map<string, CallAnswer>()
  readonly pieces = new Map<string, CallPieces>()
  readonly stopTokens = new Map<string, string>()
  readonly replyKeys = new Map<string, Uint8Array>()
  readonly inputs = new Map<string, string>()
  models: Model[] = []
  enclaves: Enclave[] = []
  grants: Grant[] = []
  calls: Call[] = []
  receipts: Receipt[] = []
  bounties: Bounty[] = []
  bountyAttempts: BountyAttempt[] = []
  measurements: MeasurementRecord[] = []
  readonly policies = new Map<string, ModelPolicy>()
  readonly splits = new Map<string, import('@voynich/contract').ModelSplit>()
  readonly versions = new Map<string, import('@voynich/contract').ModelVersion[]>()
  readonly stagedVersions = new Map<string, { version: number; address: string; weights: string[]; sizeBytes: number; noncePrefix: string; manifest: import('@voynich/contract').Manifest; base: import('@voynich/contract').ModelBase | null; bytes: Uint8Array; sealedChunks: number }>()
  readonly sessions = new Map<string, import('@voynich/contract').Session>()
  slot = 1000n

  constructor(readonly scenario: string | null) {
    if (scenario === 'empty' || scenario === 'waiting') return
    const model = structuredClone(fixtureModel)
    Object.assign(model, {
      manifest, sizeBytes: sealed.ciphertext.length, plaintextSizeBytes: sealed.header.plaintextBytes,
      ciphertextSha256: toHex(sealed.merkleRoot),
      hashVersion: 1, sealedChunks: Math.ceil(sealed.ciphertext.length / CIPHER_CHUNK_BYTES),
      cipher: { id: sealed.header.cipher, chunkSizeBytes: sealed.header.chunkBytes, noncePrefix: toBase64(sealed.header.noncePrefix) },
    })
    model.callsSettled = '1'
    model.weights[0]!.sizeBytes = sealed.ciphertext.length
    model.weights[0]!.writtenRanges = [{ offset: 0, length: sealed.ciphertext.length }]
    model.upload = { uploadKey: FIXTURE.uploadKey, uploadKeys: [FIXTURE.uploadKey], bytesWritten: sealed.ciphertext.length, transactionsWritten: Math.ceil(sealed.ciphertext.length / 888), writtenRanges: [{ offset: 0, length: sealed.ciphertext.length }], closed: true }
    const enclave = structuredClone(fixtureEnclave)
    enclave.callsSettled = '1'
    enclave.signingKey = toBase58(signingPublicKey(signingSeed))
    enclave.encryptionKey = toBase64(encryptionPublicKey(encryptionSeed))
    Object.assign(enclave.attestation, { signingKey: enclave.signingKey, encryptionKey: enclave.encryptionKey })
    this.models.push(model)
    this.enclaves.push(enclave)
    this.bytes.set(model.address, sealed.ciphertext.slice())
    this.grants.push({ ...fixtureGrant, wrappedKey: toBase64(wrapKey(sealed.key, encryptionPublicKey(encryptionSeed))) })
    const call = structuredClone(fixtureCall)
    const receipt = structuredClone(fixtureReceipt)
    receipt.signature = toBase64(signReceipt(signingSeed, fromBase58(call.address), fromHex(call.inputHash), fromHex(receipt.outputHash)))
    this.calls.push(call)
    this.receipts.push(receipt)
    this.bounties.push(structuredClone(fixtureBounty))
    if (scenario === 'expired-enclave') {
      enclave.status = 'expired'; enclave.expiresAtSlot = '950'; enclave.attestation.expiresAtSlot = '950'; enclave.reachable = false; enclave.lastSeen = null
      this.grants[0]!.status = 'expired'
    }
    if (scenario === 'revoked-grant') { this.grants[0]!.status = 'revoked'; model.enclavesHolding = 0; enclave.modelsHeld = 0 }
    if (scenario === 'unreachable-enclave') { enclave.reachable = false; enclave.lastSeen = null }
    if (['uploading', 'seal-uploading', 'seal-upload-failed', 'seal-ready'].includes(scenario ?? '')) {
      model.status = 'uploading'; model.sealedSlot = null; model.ciphertextSha256 = null; model.sealedChunks = 0
      const length = scenario === 'seal-ready' ? model.sizeBytes : 512
      model.upload = { uploadKey: FIXTURE.uploadKey, uploadKeys: [FIXTURE.uploadKey], bytesWritten: length, transactionsWritten: Math.ceil(length / 512), writtenRanges: [{ offset: 0, length }], closed: false }
      model.weights[0]!.writtenRanges = [{ offset: 0, length }]
      model.enclavesHolding = 0; this.grants = []
      this.calls = []; this.receipts = []; model.callsSettled = '0'; enclave.callsSettled = '0'
      enclave.modelsHeld = 0
      this.bytes.get(model.address)!.fill(0, length)
    }
    if (scenario === 'sealed' || scenario === 'seal-grant') { model.status = 'sealed'; model.enclavesHolding = 0; this.grants = []; this.calls = []; this.receipts = []; model.callsSettled = '0'; enclave.callsSettled = '0'; enclave.modelsHeld = 0 }
    if (scenario === 'retired') model.status = 'retired'
    if (['call-escrowed', 'call-answering', 'call-failed', 'refundable', 'refunded'].includes(scenario ?? '')) {
      this.receipts = []; call.receipt = null; call.status = 'open'
      model.callsSettled = '0'; enclave.callsSettled = '0'
      if (['call-failed', 'refundable', 'refunded'].includes(scenario!)) {
        call.status = scenario === 'refunded' ? 'refunded' : 'refundable'; call.deadlineSlot = '950'
        call.failure = { code: 'ENCLAVE_EXPIRED', message: 'The enclave did not settle the call before its deadline.', refundState: scenario === 'refunded' ? 'refunded' : 'refundable' }
      }
    }
    // A ready answer in snapshot scenarios is encrypted to this documented fixture caller key.
    if (this.calls.includes(call) && call.status === 'settled') {
      const replyKey = encryptionPublicKey(sha256(utf8('voynich/fixture/caller/encryption/v1')))
      this.settle(call, replyKey, false)
    }
  }

  emit(type: string, data: unknown) { this.hub.publish(streamEvent(type, data)) }
  model(id: string) { const row = this.models.find(m => m.address === id || m.name === id); if (!row) fail('MODEL_NOT_FOUND', 'This model was not found.'); return row }
  enclave(id: string) { const row = this.enclaves.find(e => e.address === id || e.signingKey === id); if (!row) fail('ENCLAVE_NOT_FOUND', 'This enclave was not found.'); return row }
  call(id: string) { const row = this.calls.find(c => c.address === id); if (!row) fail('CALL_NOT_FOUND', 'This call was not found.'); return row }
  bounty(id: string) { const row = this.bounties.find(b => b.address === id); if (!row) fail('BOUNTY_NOT_FOUND', 'This bounty was not found.'); return row }
  owner(model: Model, wallet: string) { if (model.owner !== wallet) fail('PROGRAM_REFUSED', 'Only the model owner can sign this instruction.', { stage: 'simulation' }) }
  liveEnclave(id: string) { const e = this.enclave(id); if (e.status === 'expired' || BigInt(e.expiresAtSlot) <= this.slot) fail('ENCLAVE_EXPIRED', 'The enclave attestation has expired.', { stage: 'build' }); return e }
  requireGrant(model: Model, enclave: Enclave) {
    if (model.status !== 'live') fail('MODEL_NOT_LIVE', 'This model is not accepting new calls.', { stage: 'build' })
    if (!this.grants.some(g => g.model === model.address && g.enclave === enclave.address && g.status === 'live')) fail('GRANT_REQUIRED', 'This enclave does not hold a live grant.', { stage: 'build' })
  }
  ready() { if (this.scenario === 'waiting') fail('PROGRAM_UNAVAILABLE', 'The program is not available yet.', { stage: 'build', retryable: true }) }
  build(action: Build['action'], signers: string[], addresses: Build['addresses'], commit: () => void): Build {
    this.ready()
    const id = randomUUID()
    const build: Build = { id, action, transactionBase64: fixtureTransaction(`${action}:${id}`), blockhash: fixtureAddress('blockhash'), lastValidBlockHeight: 2000, cosigned: false, requiredSigners: signers, fixture: true, addresses }
    this.builds.set(id, { build, commit })
    return build
  }
  submit(input: TxSubmission): TxStatus {
    const entry = this.builds.get(input.buildId)
    if (!entry) fail('NOT_FOUND', 'This transaction was not built here.')
    const fingerprint = JSON.stringify(input)
    if (entry.submission) {
      if (entry.submission !== fingerprint) fail('IDEMPOTENCY_CONFLICT', 'This build already has a different submission.', { stage: 'send' })
      return entry.status!
    }
    if (input.mode === 'relay' && input.signedTransactionBase64 !== entry.build.transactionBase64) fail('PROGRAM_REFUSED', 'The signed transaction does not match its build.', { stage: 'send' })
    entry.commit()
    entry.submission = fingerprint
    entry.status = { id: entry.build.id, status: 'confirmed', signature: input.mode === 'wallet-sent' ? input.signature : fixtureSignature(entry.build.id) }
    this.slot++
    this.emit('transaction.updated', entry.status)
    return entry.status
  }
  transaction(id: string): TxStatus {
    const entry = this.builds.get(id)
    if (!entry) fail('NOT_FOUND', 'This transaction was not found.')
    return entry.status ?? { id, status: 'built' }
  }
  answer(id: string): CallAnswer {
    const call = this.call(id)
    return this.answers.get(id) ?? { status: call.failure ? 'failed' : 'waiting', call, outputEnvelope: null, openAnswer: null, outputHash: null, signature: null, settleTransaction: null, receiptAddress: null, failure: call.failure }
  }
  callPieces(id: string): CallPieces {
    const call = this.call(id)
    return this.pieces.get(id) ?? { call: call.address, status: call.failure ? 'failed' : 'waiting', pieces: [], failure: call.failure }
  }
  relay(id: string, envelopeBase64: string) {
    const call = this.call(id)
    const prior = this.inputs.get(id)
    if (prior === envelopeBase64) return
    if (call.status !== 'open') fail('CALL_NOT_OPEN', 'This call is no longer open.', { stage: 'upload' })
    if (BigInt(call.deadlineSlot) <= this.slot) fail('CALL_DEADLINE_PASSED', 'The call is past its settlement deadline.', { stage: 'upload' })
    const envelope = fromBase64(envelopeBase64)
    if (toHex(sha256(envelope)) !== call.inputHash) fail('INPUT_HASH_MISMATCH', 'The encrypted input does not match the escrowed hash.', { stage: 'upload' })
    let decoded: unknown
    try { decoded = JSON.parse(new TextDecoder().decode(decryptCallInput(envelope, encryptionSeed))) }
    catch { fail('INVALID_ENVELOPE', 'The enclave could not authenticate the encrypted input.', { stage: 'upload' }) }
    const payload = parse(z.strictObject({
      input: z.unknown(),
      maxTokens: z.int().min(1).max(4096).optional(),
      outputPublicKey: z.string().refine(value => { try { return fromBase64(value).length === 32 } catch { return false } }, 'Must be a base64 X25519 public key.'),
      stopToken: z.string().refine(value => { try { return fromBase64(value).length === 16 } catch { return false } }, 'Must be a base64 16-byte stop token.').optional(),
    }), decoded)
    const model = this.model(call.model)
    if (model.manifest.inputKind === 'sketch') parse(z.array(z.number().min(0).max(1)).length(784), payload.input)
    this.liveEnclave(call.enclave)
    if (payload.stopToken) this.stopTokens.set(id, payload.stopToken)
    if (call.priceUnit === 'token') {
      const replyPublic = fromBase64(payload.outputPublicKey)
      this.replyKeys.set(id, replyPublic)
      if (this.scenario === 'call-answering') {
        this.inputs.set(id, envelopeBase64)
        this.pieces.set(id, { call: id, status: 'streaming', pieces: [], failure: null })
        this.emit('call.updated', call)
        return
      }
      this.streamFixturePieces(call, model, replyPublic, payload.maxTokens)
      this.inputs.set(id, envelopeBase64)
      return
    }
    if (this.scenario === 'call-answering') { this.inputs.set(id, envelopeBase64); this.emit('call.updated', call); return }
    if (this.scenario === 'call-failed') {
      call.status = 'refundable'; call.deadlineSlot = String(this.slot - 1n)
      call.failure = { code: 'ENCLAVE_EXPIRED', message: 'The enclave did not settle the call before its deadline.', refundState: 'refundable' }
      this.inputs.set(id, envelopeBase64)
      this.emit('call.updated', call); return
    }
    this.settle(call, fromBase64(payload.outputPublicKey))
    this.inputs.set(id, envelopeBase64)
  }
  stop(id: string, stopToken: string): StopCallAccepted {
    const call = this.call(id)
    const expected = this.stopTokens.get(id)
    let authorized = false
    if (expected) {
      try {
        const expectedBytes = fromBase64(expected)
        const providedBytes = fromBase64(stopToken)
        authorized = expectedBytes.length === 16 && providedBytes.length === 16 && timingSafeEqual(expectedBytes, providedBytes)
      } catch {
        authorized = false
      }
    }
    if (!authorized) {
      throw new ApiFailure(403, { error: { code: 'UNAUTHORIZED', message: 'The stop token is missing or does not match this call.', retryable: false, stage: 'auth' } })
    }
    const existing = this.pieces.get(id)
    if (call.status !== 'open' || existing?.status === 'done' || existing?.status === 'failed') {
      return { call: id, status: 'already-finished' }
    }
    const replyPublic = this.replyKeys.get(id)
    if (replyPublic) {
      this.streamFixturePieces(call, this.model(call.model), replyPublic, 0, 'stopped')
    }
    return { call: id, status: 'stopping' }
  }
  streamFixturePieces(call: Call, model: Model, replyPublic: Uint8Array, maxTokens?: number, forcedReason?: StreamFinishReason) {
    const sample = ['Fixture ', 'metered ', 'stream.']
    const unitPrice = BigInt(call.unitPrice.amount)
    const ceiling = BigInt(call.ceiling?.amount ?? call.price.amount)
    const ceilingTokens = unitPrice === 0n ? 64 : Number(ceiling / unitPrice)
    const requestedCap = maxTokens ?? 64
    const limit = Math.max(0, Math.min(requestedCap, ceilingTokens))
    const cappedByCeiling = unitPrice > 0n && (maxTokens === undefined ? ceilingTokens <= requestedCap : ceilingTokens < requestedCap)
    const callBytes = fromBase58(call.address)
    const inputHashBytes = fromHex(call.inputHash)
    const baseBytes = model.base ? fromHex(model.base.sha256) : null
    let runningHash = streamInitialHash(callBytes, inputHashBytes)
    let count = 0
    const list: StreamPiece[] = []
    const tokens = sample.join('')
    const pieceTexts: string[] = []
    for (let i = 0; i < Math.min(tokens.length, limit); i++) pieceTexts.push(tokens[i]!)
    const hitLimit = pieceTexts.length >= limit && limit < tokens.length
    const finalReason: StreamFinishReason = forcedReason ?? (hitLimit ? (cappedByCeiling ? 'ceiling' : 'length') : 'eos')
    const chunks = pieceTexts.length > 0 ? pieceTexts : ['']
    for (let index = 0; index < chunks.length; index++) {
      const text = chunks[index]!
      const deltaTokens = text.length > 0 ? 1 : 0
      const finishReason = index === chunks.length - 1 ? finalReason : null
      count += deltaTokens
      const pieceBytes = encryptCallOutput(utf8(JSON.stringify({ index, text, tokens: deltaTokens, finishReason })), replyPublic)
      const pieceHash = toHex(sha256(pieceBytes))
      runningHash = streamNextHash(runningHash, count, pieceBytes)
      const signature = toBase64(signPiece(signingSeed, callBytes, inputHashBytes, count, runningHash, baseBytes))
      const piece: StreamPiece = {
        call: call.address, index, count, deltaTokens,
        envelope: toBase64(pieceBytes), pieceHash, runningHash: toHex(runningHash), signature, finishReason,
      }
      list.push(piece)
      this.emit('call.piece', piece)
    }
    const last = list[list.length - 1]!
    const total = BigInt(last.count) * unitPrice
    const returned = ceiling - total
    const enclave = this.enclave(call.enclave)
    const protocolShare = model.protocolShareBps
    if (protocolShare === null || !fixtureConfig.feeRecipient) fail('CONFIGURATION_REQUIRED', 'Protocol fee configuration is required.', { stage: 'build' })
    const operatorAmount = total * BigInt(model.operatorShareBps) / 10000n
    const protocolAmount = total * BigInt(protocolShare) / 10000n
    const ownerAmount = total - operatorAmount - protocolAmount
    const receiptAddress = fixtureAddress(`receipt:${call.address}`)
    const settleTx = fixtureSignature(`settle:${call.address}`)
    const receipt: Receipt = {
      address: receiptAddress,
      call: call.address,
      caller: call.caller,
      callerIsProgram: call.callerIsProgram,
      model: model.address,
      modelName: model.name,
      enclave: enclave.address,
      inputHash: call.inputHash,
      outputHash: last.runningHash,
      signature: last.signature,
      answerMode: call.answerMode,
      openAnswer: null,
      deliveredCount: String(last.count),
      returnedAmount: String(returned),
      slot: String(++this.slot),
      transactionSignature: settleTx,
      payments: {
        mint: call.price.mint,
        total: String(total),
        owner: { recipient: model.owner, amount: String(ownerAmount) },
        operator: { recipient: enclave.operator, amount: String(operatorAmount) },
        protocol: { recipient: fixtureConfig.feeRecipient, amount: String(protocolAmount) },
      },
    }
    call.status = 'settled'; call.receipt = receiptAddress; call.failure = null
    this.receipts = this.receipts.filter(r => r.call !== call.address); this.receipts.unshift(receipt)
    this.answers.set(call.address, {
      status: 'answered', call, outputEnvelope: null, openAnswer: null,
      outputHash: last.runningHash, signature: last.signature,
      settleTransaction: settleTx, receiptAddress, failure: null,
    })
    model.callsSettled = String(BigInt(model.callsSettled) + 1n)
    enclave.callsSettled = String(BigInt(enclave.callsSettled) + 1n)
    this.emit('receipt.created', receipt)
    this.emit('call.updated', call)
    const state: CallPieces = { call: call.address, status: 'done', pieces: list, failure: null }
    this.pieces.set(call.address, state)
    const donePayload: CallStreamDone = {
      call: call.address, status: 'done', count: last.count, pieceCount: list.length,
      runningHash: last.runningHash, signature: last.signature, finishReason: last.finishReason,
      receiptAddress, settleTransaction: settleTx, failure: null,
    }
    this.emit('call.stream.done', donePayload)
  }
  settleMetered(call: Call, body: { wallet: string; count: string; runningHash: string; signature: string }) {
    if (call.status !== 'open') fail('CALL_NOT_OPEN', 'This call is no longer open.', { stage: 'build' })
    if (call.priceUnit !== 'token') fail('PROGRAM_REFUSED', 'Only per-token calls support metered settlement.', { stage: 'build' })
    const enclave = this.enclave(call.enclave)
    if (body.wallet !== call.caller && body.wallet !== enclave.operator) {
      throw new ApiFailure(403, { error: { code: 'UNAUTHORIZED', message: 'Only the caller or operator can settle this metered call.', retryable: false, stage: 'auth' } })
    }
    if (this.slot > BigInt(call.deadlineSlot)) {
      fail('CALL_DEADLINE_PASSED', 'The call settlement deadline has passed. Refund the call instead.', { stage: 'build' })
    }
    const model = this.model(call.model)
    const count = BigInt(body.count)
    const unitPrice = BigInt(call.unitPrice.amount)
    const ceiling = BigInt(call.ceiling?.amount ?? call.price.amount)
    if (count * unitPrice > ceiling) {
      fail('VALIDATION_ERROR', 'Delivered token total exceeds the escrowed ceiling.', { stage: 'validation', fieldErrors: { count: ['Exceeds escrowed ceiling.'] } })
    }
    const baseBytes = model.base ? fromHex(model.base.sha256) : null
    const validSig = verifyPiece(
      fromBase64(body.signature),
      fromBase58(enclave.signingKey),
      fromBase58(call.address),
      fromHex(call.inputHash),
      count,
      fromHex(body.runningHash),
      baseBytes,
    )
    if (!validSig) {
      fail('INVALID_ENVELOPE', 'The piece signature does not match the enclave signing key.', { stage: 'validation' })
    }
    const receiptAddress = fixtureAddress(`receipt:${call.address}`)
    const settleTx = fixtureSignature(`settle:${call.address}`)
    return this.build('settle_metered_call', [body.wallet], { model: model.address, call: call.address, receipt: receiptAddress }, () => {
      const total = count * unitPrice
      const returned = ceiling - total
      const protocolShare = model.protocolShareBps
      if (protocolShare === null || !fixtureConfig.feeRecipient) fail('CONFIGURATION_REQUIRED', 'Protocol fee configuration is required.', { stage: 'build' })
      const operatorAmount = total * BigInt(model.operatorShareBps) / 10000n
      const protocolAmount = total * BigInt(protocolShare) / 10000n
      const ownerAmount = total - operatorAmount - protocolAmount
      const receipt: Receipt = {
        address: receiptAddress,
        call: call.address,
        caller: call.caller,
        callerIsProgram: call.callerIsProgram,
        model: model.address,
        modelName: model.name,
        enclave: enclave.address,
        inputHash: call.inputHash,
        outputHash: body.runningHash,
        signature: body.signature,
        answerMode: call.answerMode,
        openAnswer: null,
        deliveredCount: String(count),
        returnedAmount: String(returned),
        slot: String(++this.slot),
        transactionSignature: settleTx,
        payments: {
          mint: call.price.mint,
          total: String(total),
          owner: { recipient: model.owner, amount: String(ownerAmount) },
          operator: { recipient: enclave.operator, amount: String(operatorAmount) },
          protocol: { recipient: fixtureConfig.feeRecipient, amount: String(protocolAmount) },
        },
      }
      call.status = 'settled'; call.receipt = receiptAddress; call.failure = null
      this.receipts = this.receipts.filter(r => r.call !== call.address); this.receipts.unshift(receipt)
      this.answers.set(call.address, {
        status: 'answered', call, outputEnvelope: null, openAnswer: null,
        outputHash: body.runningHash, signature: body.signature,
        settleTransaction: settleTx, receiptAddress, failure: null,
      })
      model.callsSettled = String(BigInt(model.callsSettled) + 1n)
      enclave.callsSettled = String(BigInt(enclave.callsSettled) + 1n)
      const existing = this.pieces.get(call.address)
      const pieceList = existing?.pieces ?? []
      this.pieces.set(call.address, { call: call.address, status: 'done', pieces: pieceList, failure: null })
      this.emit('receipt.created', receipt)
      this.emit('call.updated', call)
      this.emit('call.stream.done', {
        call: call.address, status: 'done', count: Number(count), pieceCount: pieceList.length,
        runningHash: body.runningHash, signature: body.signature, finishReason: 'stopped',
        receiptAddress, settleTransaction: settleTx, failure: null,
      } satisfies CallStreamDone)
    })
  }
  creditSplit(modelAddress: string, ownerAmount: bigint) {
    const split = this.splits.get(modelAddress)
    if (!split || !split.active || split.recipients.length === 0 || ownerAmount <= 0n) return
    let distributed = 0n
    const shares = split.recipients.map(r => {
      const share = (ownerAmount * BigInt(r.shareBps)) / 10000n
      distributed += share
      return share
    })
    const dust = ownerAmount - distributed
    if (dust > 0n) shares[0] = (shares[0] ?? 0n) + dust
    split.totalReceived = String(BigInt(split.totalReceived) + ownerAmount)
    split.recipients = split.recipients.map((r, i) => {
      const accrued = BigInt(r.accrued) + (shares[i] ?? 0n)
      const claimed = BigInt(r.claimed)
      return { ...r, accrued: String(accrued), claimable: String(accrued > claimed ? accrued - claimed : 0n) }
    })
    split.updatedSlot = String(this.slot)
    this.emit('split.updated', split)
  }
  settle(call: Call, replyPublic: Uint8Array, increment = true) {
    const model = this.model(call.model)
    const enclave = this.enclave(call.enclave)
    const labels = model.manifest.labels
    const isTextGen = model.manifest.inputKind === 'text' && (!labels || labels.length === 0)
    const openPayload = isTextGen
      ? { text: 'Fixture text answer.', tokens: 3, finishReason: 'eos' as const }
      : (() => {
          const list = labels && labels.length > 0 ? labels : ['cat']
          const label = list.includes('cat') ? 'cat' : list[0]!
          const scores = list.map(item => ({ label: item, probability: item === label ? 0.91 : 0.09 / (list.length - 1 || 1) }))
          return { label, probability: 0.91, scores: scores.slice(0, 5), allScores: scores }
        })()
    let outputEnvelope: string | null = null
    let openAnswer: string | null = null
    let outputHash: string
    if (call.answerMode === 'open') {
      const openBytes = utf8(JSON.stringify(
        'text' in openPayload ? openPayload : { label: openPayload.label, probability: openPayload.probability, scores: openPayload.scores },
      ))
      openAnswer = toBase64(openBytes)
      outputHash = toHex(sha256(openBytes))
    } else {
      let envelope: Uint8Array
      const sealedBody = 'text' in openPayload ? openPayload : { label: openPayload.label, scores: openPayload.allScores }
      try { envelope = encryptCallOutput(utf8(JSON.stringify(sealedBody)), replyPublic) }
      catch { fail('INVALID_ENVELOPE', 'The caller output key is not a usable X25519 key.', { stage: 'upload' }) }
      outputEnvelope = toBase64(envelope)
      outputHash = toHex(sha256(envelope))
    }
    const signature = toBase64(signReceipt(signingSeed, fromBase58(call.address), fromHex(call.inputHash), fromHex(outputHash), model.base ? fromHex(model.base.sha256) : null))
    const total = BigInt(call.price.amount)
    const protocolShare = model.protocolShareBps
    if (protocolShare === null || !fixtureConfig.feeRecipient) fail('CONFIGURATION_REQUIRED', 'Protocol fee configuration is required.', { stage: 'build' })
    const operator = total * BigInt(model.operatorShareBps) / 10000n
    const protocol = total * BigInt(protocolShare) / 10000n
    const address = increment ? fixtureAddress(`receipt:${call.address}`) : FIXTURE.receipt
    const receipt: Receipt = { address, call: call.address, caller: call.caller, callerIsProgram: call.callerIsProgram, model: model.address, modelName: model.name, enclave: enclave.address, inputHash: call.inputHash, outputHash, signature, answerMode: call.answerMode, openAnswer, deliveredCount: null, returnedAmount: null,
      slot: increment ? String(++this.slot) : '902', transactionSignature: fixtureSignature(`settle:${call.address}`),
      payments: { mint: call.price.mint, total: String(total), owner: { recipient: model.owner, amount: String(total - operator - protocol) }, operator: { recipient: enclave.operator, amount: String(operator) }, protocol: { recipient: fixtureConfig.feeRecipient, amount: String(protocol) } } }
    call.status = 'settled'; call.receipt = address; call.failure = null
    this.receipts = this.receipts.filter(r => r.call !== call.address); this.receipts.unshift(receipt)
    this.answers.set(call.address, { status: 'answered', call, outputEnvelope, openAnswer, outputHash, signature, settleTransaction: receipt.transactionSignature, receiptAddress: address, failure: null })
    if (increment) { model.callsSettled = String(BigInt(model.callsSettled) + 1n); enclave.callsSettled = String(BigInt(enclave.callsSettled) + 1n); this.creditSplit(model.address, total - operator - protocol); this.emit('receipt.created', receipt); this.emit('call.updated', call) }
  }
  range(model: Model, offset: number, length: number) {
    if (offset > model.sizeBytes) fail('VALIDATION_ERROR', 'The byte offset exceeds the ciphertext length.', { stage: 'validation', fieldErrors: { offset: ['Outside ciphertext.'] } })
    const bytes = this.bytes.get(model.address)!.subarray(offset, Math.min(offset + length, model.sizeBytes))
    return { model: model.address, offset, length: bytes.length, totalBytes: model.sizeBytes, bytesBase64: toBase64(bytes), accounts: model.weights.filter(w => w.offset < offset + bytes.length && w.offset + w.sizeBytes > offset) }
  }
  stats() {
    const count = this.models.length === 0 ? 0n : this.models.reduce((sum, m) => sum + BigInt(m.callsSettled), 0n)
    const programCalls = this.calls.filter(c => c.callerIsProgram).length
    return { models: this.models.length, enclaves: this.enclaves.filter(e => e.status === 'live').length, receipts: String(count), callsSettled: String(count), programCalls: String(programCalls), operatorEarnings: this.earnings('operator'), currentSlot: String(this.slot), asOf: new Date().toISOString() }
  }
  earnings(role: 'owner' | 'operator', wallet?: string) {
    const totals = new Map<string | null, bigint>()
    for (const receipt of this.receipts) {
      const payment = receipt.payments[role]
      if (!wallet || payment.recipient === wallet) totals.set(receipt.payments.mint, (totals.get(receipt.payments.mint) ?? 0n) + BigInt(payment.amount))
    }
    return [...totals].map(([mint, amount]) => {
      const { decimals, symbol } = this.models.find(m => m.price.mint === mint)?.price ?? { decimals: 9, symbol: 'SOL' }
      return { mint, amount: String(amount), decimals, symbol }
    })
  }
}

export function addRange(model: Model, offset: number, length: number) {
  const ranges = [...model.upload!.writtenRanges, { offset, length }].sort((a, b) => a.offset - b.offset)
  const merged: { offset: number; length: number }[] = []
  for (const range of ranges) {
    const previous = merged.at(-1)
    if (previous && previous.offset + previous.length >= range.offset) previous.length = Math.max(previous.offset + previous.length, range.offset + range.length) - previous.offset
    else merged.push({ ...range })
  }
  model.upload!.writtenRanges = merged
  model.upload!.bytesWritten = merged.reduce((total, range) => total + range.length, 0)
  model.upload!.transactionsWritten++
  model.weights[0]!.writtenRanges = merged
}
