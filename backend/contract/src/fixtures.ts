// Fixture material the web builds against before any chain exists: deterministic sample keys and
// signatures, transaction bytes that can never be signed for real, and an error body for every code
// so each failure state can be forced and drawn.

import { toBase58, toBase64 } from './encoding.js'
import type { ApiErrorBody, ErrorStage } from './errors.js'
import { ATTACH_WEIGHTS_BATCH, DEFAULT_UPLOAD_KEYS, INITIAL_CREATE_WEIGHTS, MODEL_ACCOUNT_BYTES, SEAL_RANGE_CHUNKS, WRITE_CHUNK_BYTES, errors, type ErrorCode, type Model, type Enclave, type AttestationRecord, type Grant, type Call, type Receipt, type Config, type Stats, type Build, type ModelCostQuote, type Bounty, type BountyAttempt } from './schemas.js'
import { fixtureManifest } from './sketch-manifest.js'
export { fixtureManifest, SKETCH_LABELS } from './sketch-manifest.js'

/** FNV-1a, so string seeds ("coin-3-mint") work as well as numbers. */
const seedOf = (seed: number | string) => {
  if (typeof seed === 'number') return seed >>> 0
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193) >>> 0
  return h
}

function sampleBytes(seed: number | string, length: number) {
  const s = seedOf(seed)
  let state = s + 1
  const bytes = Uint8Array.from({ length }, (_, i) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return (state >>> 24) ^ ((i * 17) & 255)
  })
  // The seed itself closes the key, so two seeds never produce the same sample.
  for (let i = 0; i < 4; i++) bytes[length - 4 + i] = (s >>> ((3 - i) * 8)) & 255
  return bytes
}

export const fixtureAddress = (seed: number | string) => toBase58(sampleBytes(seed, 32))
export const fixtureSignature = (seed: number | string) => toBase58(sampleBytes(seed, 64))

/** Base64 that decodes to a label, not a transaction: a wallet or RPC handed it refuses it outright. */
export const fixtureTransaction = (label: string) => toBase64(new TextEncoder().encode(`FIXTURE_NOT_A_SOLANA_TRANSACTION:${label}`))

export type ErrorDetails<Code extends string> = Record<Code, readonly [message: string, retryable: boolean, stage: ErrorStage]>

/** One sample envelope per code; `extra` adds the fields a screen needs to draw (fieldErrors, programError). */
export function fixtureErrors<Code extends string>(
  details: ErrorDetails<Code>,
  extra: Partial<Record<Code, Partial<Omit<ApiErrorBody['error'], 'code'>>>> = {},
): Record<Code, ApiErrorBody<Code>> {
  const out = {} as Record<Code, ApiErrorBody<Code>>
  for (const code of Object.keys(details) as Code[]) {
    const [message, retryable, stage] = details[code]
    out[code] = { error: { code, message, retryable, stage, ...extra[code] } }
  }
  return out
}

export const SCENARIOS = ['empty', 'failed', 'loading', 'waiting', 'expired-enclave', 'unreachable-enclave', 'revoked-grant', 'uploading', 'sealed', 'retired', 'refundable', 'refunded', 'call-ready', 'call-encrypting', 'call-awaiting-signature', 'call-escrowed', 'call-answering', 'call-verified', 'call-failed', 'seal-prepare', 'seal-encrypting', 'seal-awaiting-signature', 'seal-uploading', 'seal-upload-failed', 'seal-ready', 'seal-grant', 'seal-done'] as const
export type Scenario = typeof SCENARIOS[number]
export const FIXTURE_TIME = '2026-11-18T00:00:00.000Z'
/** Deterministic sample identities. All fixture-only; no key controls funds. */
export const FIXTURE = {
  owner: fixtureAddress('owner'), operator: fixtureAddress('operator'), caller: fixtureAddress('caller'),
  model: fixtureAddress('sketch-32'), weights: fixtureAddress('weights'), enclave: fixtureAddress('enclave'),
  attestation: fixtureAddress('attestation'), grant: fixtureAddress('grant'), call: fixtureAddress('call'),
  receipt: fixtureAddress('receipt'), program: fixtureAddress('voynich-program'), attestProgram: fixtureAddress('attest-program'),
  bountyProgram: fixtureAddress('bounty-program'), bounty: fixtureAddress('bounty'), attempt: fixtureAddress('bounty-attempt'),
  feeRecipient: fixtureAddress('fixture-fee-recipient'), uploadKey: fixtureAddress('upload-key'),
} as const
export const fixturePrice = { amount: '100000', mint: null, decimals: 9, symbol: 'SOL' }
export const fixtureConfig: Config = {
  mode: 'fixture', cluster: 'localnet', rpcUrl: 'http://127.0.0.1:9704', programId: FIXTURE.program,
  attestationProgramId: FIXTURE.attestProgram, bountyProgramId: FIXTURE.bountyProgram, attestationRecordLayoutVersion: 1,
  feeRecipient: FIXTURE.feeRecipient, protocolShareBps: 500, callDeadlineSlots: '150', maxOpenAnswerBytes: 1024, tokenMint: null, fixture: true,
}
export const fixtureAttestation: AttestationRecord = {
  address: FIXTURE.attestation, signingKey: 'eD862YbQFCoa2LH8ciRX4mo1oVxKGgUi6c38nCfumtN', encryptionKey: 'hvfa8iVxr36BS8DOFy1mzYeO6yACKdTJvvzxza8p2mQ=',
  hardwareType: 'dev', measurement: 'ab'.repeat(48), recordedSlot: '800', expiresAtSlot: '1000000', layoutVersion: 1,
}
export const fixtureEnclave: Enclave = {
  address: FIXTURE.enclave, signingKey: fixtureAttestation.signingKey, encryptionKey: fixtureAttestation.encryptionKey,
  hardwareType: 'dev', measurement: fixtureAttestation.measurement, expiresAtSlot: fixtureAttestation.expiresAtSlot,
  operator: FIXTURE.operator, endpoint: 'http://127.0.0.1:9707', relayPath: '/v1/calls/{call}/input', status: 'live',
  reachable: true, lastSeen: FIXTURE_TIME,
  modelsHeld: 1, callsSettled: '42', attestation: fixtureAttestation,
}
export const fixtureModel: Model = {
  address: FIXTURE.model, name: 'sketch-32', owner: FIXTURE.owner, createdSlot: '810', sealedSlot: '820',
  sizeBytes: 65552, plaintextSizeBytes: 65536, ciphertextSha256: 'cd'.repeat(32),
  hashVersion: 1, sealedChunks: 1, base: null,
  cipher: { id: 'xchacha20poly1305-64k-v1', chunkSizeBytes: 65536, noncePrefix: toBase64(new Uint8Array(16).fill(3)) },
  allowedMeasurements: [fixtureEnclave.measurement], price: fixturePrice, priceUnit: 'call', operatorShareBps: 2500, protocolShareBps: 500,
  status: 'live', manifest: fixtureManifest,
  weights: [{ address: FIXTURE.weights, model: FIXTURE.model, index: 0, offset: 0, sizeBytes: 65552, writtenRanges: [{ offset: 0, length: 65552 }] }],
  upload: { uploadKey: FIXTURE.uploadKey, uploadKeys: [FIXTURE.uploadKey], bytesWritten: 65552, transactionsWritten: 129, writtenRanges: [{ offset: 0, length: 65552 }], closed: true },
  enclavesHolding: 1, callsSettled: '42',
}
export const fixtureGrant: Grant = { address: FIXTURE.grant, model: FIXTURE.model, modelName: 'sketch-32', enclave: FIXTURE.enclave, wrappedKey: 'AeBmWdoBW+79P4Fgb4BoKxpeZtymttHoPLHvgJYNw7cWGVI8qZVIDM6DKEHe4UOGkDsdAREZwz6kErx1O/10v3t/aBFEXuTWCwbRsEZxulCro36kS8u9vvBFzy5xbs0rQvjKaaWY6pOv', grantedBy: FIXTURE.owner, grantedSlot: '825', status: 'live', quotedOperatorShareBps: null, medianAnswerMs: 400 }
export const fixtureCall: Call = { address: FIXTURE.call, caller: FIXTURE.caller, callerIsProgram: false, model: FIXTURE.model, modelName: 'sketch-32', enclave: FIXTURE.enclave, inputHash: '11'.repeat(32), answerMode: 'sealed', price: fixturePrice, priceUnit: 'call', unitPrice: fixturePrice, ceiling: null, openedSlot: '900', deadlineSlot: '1050', status: 'settled', receipt: FIXTURE.receipt, failure: null }
export const fixtureReceipt: Receipt = {
  address: FIXTURE.receipt, call: FIXTURE.call, caller: FIXTURE.caller, callerIsProgram: false, model: FIXTURE.model, modelName: 'sketch-32', enclave: FIXTURE.enclave,
  inputHash: fixtureCall.inputHash, outputHash: '22'.repeat(32), signature: 'ejWNS6HzIFlRiSXd7g4SLDw32+8cdmisrcXwFc/CFtqmxziRZY/RChk6DTo0FV5YuRd5I0V/+Cryl6VCEFQgBA==', answerMode: 'sealed', openAnswer: null, deliveredCount: null, returnedAmount: null, slot: '902', transactionSignature: fixtureSignature('settle'),
  payments: { mint: null, total: fixturePrice.amount, owner: { recipient: FIXTURE.owner, amount: '70000' }, operator: { recipient: FIXTURE.operator, amount: '25000' }, protocol: { recipient: FIXTURE.feeRecipient, amount: '5000' } },
}
export const fixtureStats: Stats = { models: 1, enclaves: 1, receipts: '42', callsSettled: '42', programCalls: '3', operatorEarnings: [{ mint: null, amount: '1050000', decimals: 9, symbol: 'SOL' }], currentSlot: '1000', asOf: FIXTURE_TIME }
export const fixtureBounty: Bounty = {
  address: FIXTURE.bounty, creator: FIXTURE.owner, nonce: '1', model: FIXTURE.model, modelName: 'sketch-32',
  targetLabel: 'clock', reward: { amount: '50000000', mint: null, decimals: 9, symbol: 'SOL' }, status: 'open',
  winner: null, winningCall: null, winningReceipt: null, createdSlot: '910', claimedSlot: null, attempts: '0',
}
export const fixtureBountyAttempt: BountyAttempt = {
  address: FIXTURE.attempt, bounty: FIXTURE.bounty, drawer: FIXTURE.caller, call: FIXTURE.call, createdSlot: '915', refunded: false,
}

/** Static snapshots for rendering, before any interaction with the fixture session. */
export const STATE_FIXTURES = {
  revokedGrant: { ...fixtureGrant, status: 'revoked' as const },
  uploading: { ...fixtureModel, status: 'uploading' as const, sealedSlot: null, ciphertextSha256: null, sealedChunks: 0, enclavesHolding: 0, callsSettled: '0', upload: { ...fixtureModel.upload!, bytesWritten: 512, transactionsWritten: 1, writtenRanges: [{ offset: 0, length: 512 }], closed: false }, weights: [{ ...fixtureModel.weights[0]!, writtenRanges: [{ offset: 0, length: 512 }] }] },
  sealed: { ...fixtureModel, status: 'sealed' as const, enclavesHolding: 0 },
  retired: { ...fixtureModel, status: 'retired' as const },
  expiredEnclave: { ...fixtureEnclave, status: 'expired' as const, reachable: false, lastSeen: null, expiresAtSlot: '950', attestation: { ...fixtureAttestation, expiresAtSlot: '950' } },
  unreachableEnclave: { ...fixtureEnclave, reachable: false, lastSeen: null },
  escrowedCall: { ...fixtureCall, status: 'open' as const, receipt: null },
  refundableCall: { ...fixtureCall, status: 'refundable' as const, deadlineSlot: '950', receipt: null, failure: { code: 'ENCLAVE_EXPIRED' as const, message: 'The enclave expired before settlement.', refundState: 'refundable' as const } },
  refundedCall: { ...fixtureCall, status: 'refunded' as const, deadlineSlot: '950', receipt: null, failure: { code: 'ENCLAVE_EXPIRED' as const, message: 'The full escrow was returned.', refundState: 'refunded' as const } },
}
export const fixtureExpiredEnclave = STATE_FIXTURES.expiredEnclave
export const CALL_PANEL_FIXTURES = [
  { step: 'ready', call: null, failure: null }, { step: 'encrypting', call: null, failure: null },
  { step: 'awaiting-signature', call: null, failure: null }, { step: 'escrowed', call: STATE_FIXTURES.escrowedCall, failure: null },
  { step: 'answering', call: STATE_FIXTURES.escrowedCall, failure: null },
  { step: 'verified', call: fixtureCall, receipt: fixtureReceipt, output: { label: 'cat', confidence: 0.93 }, checks: { signature: 'passed', record: 'passed', expiry: 'passed' }, failure: null },
  { step: 'failed', call: STATE_FIXTURES.refundableCall, failure: STATE_FIXTURES.refundableCall.failure },
  { step: 'refunded', call: STATE_FIXTURES.refundedCall, failure: STATE_FIXTURES.refundedCall.failure },
] as const
export const SEAL_PANEL_FIXTURES = [
  { step: 'prepare', model: null }, { step: 'encrypting', model: null }, { step: 'awaiting-signature', model: null },
  { step: 'uploading', model: STATE_FIXTURES.uploading },
  { step: 'failed', model: STATE_FIXTURES.uploading, retry: 'Resume from the written byte ranges.' },
  { step: 'ready-to-seal', model: { ...STATE_FIXTURES.uploading, upload: { ...fixtureModel.upload!, closed: false } } },
  { step: 'grant', model: STATE_FIXTURES.sealed }, { step: 'done', model: fixtureModel },
] as const

const errorDetails = Object.fromEntries(errors.ErrorCode.options.map((code) => [code, [code.toLowerCase().replaceAll('_', ' ') + '.', errors.status[code] >= 500 || code === 'PROGRAM_UNAVAILABLE', code === 'VALIDATION_ERROR' ? 'validation' : 'read']])) as unknown as ErrorDetails<ErrorCode>
Object.assign(errorDetails, {
  MODEL_NOT_FOUND: ['This model was not found.', false, 'read'], MODEL_NOT_LIVE: ['This model is not accepting new calls.', false, 'build'],
  ENCLAVE_EXPIRED: ['The enclave attestation has expired.', false, 'build'], CALL_NOT_REFUNDABLE: ['This call is not past its deadline or has already settled.', false, 'build'],
  PROGRAM_UNAVAILABLE: ['The program is not available yet.', true, 'build'], CONFIGURATION_REQUIRED: ['Required protocol configuration is unset.', false, 'build'],
  PROGRAM_REFUSED: ['The program refused this instruction.', false, 'simulation'], INPUT_HASH_MISMATCH: ['The encrypted input does not match the escrowed hash.', false, 'upload'],
  INSUFFICIENT_FUNDS: ['The wallet cannot cover this transaction.', false, 'build'],
})
export const ERROR_FIXTURES = fixtureErrors(errorDetails, {
  VALIDATION_ERROR: { fieldErrors: { wallet: ['Must be a base58 address of 32 bytes.'] } },
  PROGRAM_REFUSED: { programError: { programId: FIXTURE.program, name: 'ModelNotLive', number: 6001 } },
  CHAIN_REFUSED: { programError: { programId: FIXTURE.program, name: 'ModelNotLive', number: 6001 } },
  INSUFFICIENT_FUNDS: { funding: { mint: null, required: '1000000', available: '500000', shortfall: '500000' } },
})
export function fixtureBuild(action: Build['action'], wallet = FIXTURE.caller): Build {
  return { id: `fixture-${action}`, action, transactionBase64: fixtureTransaction(action), blockhash: fixtureAddress('blockhash'), lastValidBlockHeight: 2000, cosigned: false, requiredSigners: action === 'create_model' ? [wallet, FIXTURE.uploadKey] : [wallet], fixture: true, addresses: { model: FIXTURE.model, ...(action === 'open_call' ? { call: FIXTURE.call } : {}), ...(action === 'create_model' ? { uploadKey: FIXTURE.uploadKey, weights: [FIXTURE.weights] } : {}) } }
}

/** Illustrative fixture costs only; chain mode reads current rent and fees from RPC. */
export function fixtureModelCostQuote(sizeBytes = fixtureModel.sizeBytes, uploadKeyCount: number = DEFAULT_UPLOAD_KEYS): ModelCostQuote {
  const capacity = 10 * 1024 * 1024 - 56
  const weights = Array.from({ length: Math.ceil(sizeBytes / capacity) }, (_, index) => {
    const payloadBytes = Math.min(capacity, sizeBytes - index * capacity), accountBytes = payloadBytes + 56
    return { index, payloadBytes, accountBytes, rentLamports: ((BigInt(accountBytes) + 128n) * 6960n).toString(), writeCount: Math.ceil(payloadBytes / WRITE_CHUNK_BYTES) }
  })
  const modelRentLamports = ((BigInt(MODEL_ACCOUNT_BYTES) + 128n) * 6960n).toString(), uploadKeyMinimumLamports = '890880'
  const weightsRent = weights.reduce((sum, part) => sum + BigInt(part.rentLamports), 0n)
  const writeCount = weights.reduce((sum, part) => sum + part.writeCount, 0), writeFees = BigInt(writeCount) * 5000n
  const attachWeightsCount = weights.length > INITIAL_CREATE_WEIGHTS ? Math.ceil((weights.length - INITIAL_CREATE_WEIGHTS) / ATTACH_WEIGHTS_BATCH) : 0
  const attachWeightsFees = BigInt(attachWeightsCount) * 5000n
  const totalChunks = Math.ceil(sizeBytes / 65552)
  const sealRangeCount = Math.max(0, Math.ceil(totalChunks / SEAL_RANGE_CHUNKS) - 1)
  const sealRangeFees = BigInt(sealRangeCount) * 5000n
  const perKeyWrites = Math.ceil(writeCount / uploadKeyCount)
  const perKeyFunding = BigInt(perKeyWrites) * 5000n + attachWeightsFees + sealRangeFees + BigInt(uploadKeyMinimumLamports) + 10000n
  const uploadFunding = perKeyFunding * BigInt(uploadKeyCount)
  const extraSweepFees = BigInt(uploadKeyCount - 1) * 5000n
  const returnedReserve = uploadFunding - writeFees - attachWeightsFees - sealRangeFees - extraSweepFees
  const allocationFees = BigInt(weights.length) * 10000n
  const estimatedCost = BigInt(modelRentLamports) + weightsRent + allocationFees + 10000n + attachWeightsFees + writeFees + sealRangeFees + extraSweepFees + 10000n
  return { fixture: true, asOfSlot: '1000', sizeBytes, writeChunkBytes: WRITE_CHUNK_BYTES, writeCount, modelAccountBytes: MODEL_ACCOUNT_BYTES, modelRentLamports, weights,
    createTransactionBytes: null, createTransactionMaxBytes: 1104, manifestBytes: null, canCreate: null,
    weightsRentLamports: weightsRent.toString(), uploadKeyCount, uploadKeyMinimumLamports, signaturesPerTransaction: { allocation: 2, createModel: 2, write: 1, seal: 2 },
    allocationFeeLamports: '10000', allocationFeesLamports: allocationFees.toString(), createFeeLamports: '10000',
    attachWeightsCount, attachWeightsFeesLamports: attachWeightsFees.toString(),
    writeFeeLamports: '5000', writeFeesLamports: writeFees.toString(),
    sealRangeCount, sealRangeFeesLamports: sealRangeFees.toString(),
    sealFeeLamports: '10000',
    uploadFundingLamports: uploadFunding.toString(), returnedUploadReserveLamports: returnedReserve.toString(), estimatedCostLamports: estimatedCost.toString(), requiredUpfrontLamports: (estimatedCost + returnedReserve).toString() }
}
