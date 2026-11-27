import { z } from 'zod'
import { Address, Base64, PageQuery, Signature, Timestamp, U64, page } from './primitives.js'
import { defineErrors } from './errors.js'
import { fromBase64 } from './encoding.js'

export const CONTRACT_VERSION = '0.1.38'
export const errors = defineErrors({
  MODEL_NOT_FOUND: 404, MODEL_NOT_LIVE: 409, MODEL_NOT_UPLOADING: 409,
  ENCLAVE_NOT_FOUND: 404, ENCLAVE_EXPIRED: 409, MEASUREMENT_NOT_ALLOWED: 422,
  MEASUREMENT_NOT_FOUND: 404, MEASUREMENT_ALREADY_EXISTS: 409, MEASUREMENT_DEPRECATED: 409, INVALID_MEASUREMENT: 422,
  POLICY_NOT_FOUND: 404, INVALID_POLICY: 422, POLICY_CALLER_DENIED: 403, POLICY_OPERATOR_DENIED: 403, POLICY_REQUIRED: 409,
  SPLIT_NOT_FOUND: 404, INVALID_SPLIT: 422,
  BOND_NOT_FOUND: 404, INVALID_BOND: 422,
  BENCHMARK_NOT_FOUND: 404, INVALID_BENCHMARK: 422,
  PASS_PLAN_NOT_FOUND: 404, PASS_NOT_FOUND: 404, INVALID_PASS: 422,
  REFERRAL_CONFIG_NOT_FOUND: 404, REFERRAL_NOT_FOUND: 404, INVALID_REFERRAL: 422,
  QUORUM_NOT_FOUND: 404, INVALID_QUORUM: 422,
  BATCH_NOT_FOUND: 404, INVALID_BATCH: 422,
  GRANT_REQUIRED: 409, INVALID_QUOTE: 422, INVALID_VERSION: 422, SESSION_NOT_FOUND: 404, INVALID_SESSION: 422, CALL_NOT_FOUND: 404, CALL_NOT_OPEN: 409,
  CALL_NOT_REFUNDABLE: 409, CALL_DEADLINE_PASSED: 409, RECEIPT_NOT_FOUND: 404,
  INPUT_HASH_MISMATCH: 422, INVALID_ENVELOPE: 422, UPLOAD_INCOMPLETE: 409,
  CIPHERTEXT_HASH_MISMATCH: 422, PROGRAM_REFUSED: 422, INSUFFICIENT_FUNDS: 422,
  BOUNTY_NOT_FOUND: 404, BOUNTY_NOT_OPEN: 409,
})
export const ApiError = errors.ApiError
export const ErrorCode = errors.ErrorCode
export type ErrorCode = z.output<typeof ErrorCode>
export const Hash = z.string().regex(/^[0-9a-f]{64}$/)
/** Hardware measurements are fixed 48-byte values. */
export const HardwareMeasurement = z.string().regex(/^[0-9a-f]{96}$/)
export const Measurement = HardwareMeasurement
export const ProgramModelName = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(32)
export const WRITE_CHUNK_BYTES = 888 as const
export const WRITE_CHUNK_MAX_BASE64 = Math.ceil(WRITE_CHUNK_BYTES / 3) * 4
export const MAX_UPLOAD_KEYS = 8 as const
export const DEFAULT_UPLOAD_KEYS = 8 as const
export const MAX_WEIGHTS = 64 as const
export const INITIAL_CREATE_WEIGHTS = 8 as const
export const ATTACH_WEIGHTS_BATCH = 16 as const
export const SEAL_RANGE_CHUNKS = 8 as const
export const MODEL_ACCOUNT_BYTES = 8192 as const
export const MODEL_BASE_FORMATS = ['onnx', 'safetensors', 'gguf'] as const
export const TOKENIZER_FORMATS = ['byte-level', 'bpe', 'word-piece'] as const
export const MAX_BASE_FORMAT = 32 as const
export const MAX_BASE_SOURCE = 256 as const
export const MAX_SOURCE_REPO = 128 as const
export const MAX_COMMIT_SHA = 64 as const
export const MAX_MEASUREMENT_VERSION = 32 as const
export const MAX_POLICY_CALLERS = 32 as const
export const MAX_POLICY_OPERATORS = 16 as const
export const MAX_POLICY_REGIONS = 8 as const
export const MAX_POLICY_REGION_LEN = 16 as const
export const MAX_SPLIT_RECIPIENTS = 8 as const
export const DEFAULT_BOND_SLASH_BPS = 1000 as const
export const MAX_BENCHMARK_NAME = 32 as const
export const MAX_BENCHMARK_URI = 160 as const
export const MAX_BENCHMARK_RECEIPTS = 16 as const
export const MAX_REFERRAL_SHARE_BPS = 2500 as const
export const MIN_QUORUM_VOTES = 2 as const
export const MAX_QUORUM_VOTES = 5 as const
export const MIN_BATCH_ITEMS = 1 as const
export const MAX_BATCH_ITEMS = 256 as const
export const MAX_BATCH_APPEND_CHUNK = 16 as const
export const PROGRAM_LIMITS = { modelNameBytes: 32, weightsAccounts: MAX_WEIGHTS, measurements: 8, manifestBytes: 4096, endpointBytes: 256, weightsHeaderBytes: 56, maxOpenAnswerBytes: 4096, writeChunkBytes: WRITE_CHUNK_BYTES, maxUploadKeys: MAX_UPLOAD_KEYS, sealRangeChunks: SEAL_RANGE_CHUNKS, modelAccountBytes: MODEL_ACCOUNT_BYTES, baseFormatBytes: MAX_BASE_FORMAT, baseSourceBytes: MAX_BASE_SOURCE, sourceRepoBytes: MAX_SOURCE_REPO, commitShaBytes: MAX_COMMIT_SHA, measurementVersionBytes: MAX_MEASUREMENT_VERSION, policyCallers: MAX_POLICY_CALLERS, policyOperators: MAX_POLICY_OPERATORS, policyRegions: MAX_POLICY_REGIONS, policyRegionBytes: MAX_POLICY_REGION_LEN, splitRecipients: MAX_SPLIT_RECIPIENTS } as const
export const AnswerMode = z.enum(['sealed', 'open'])
export const PriceUnit = z.enum(['call', 'token'])
export const Slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).min(1).max(32)
export const ModelId = z.union([Address, Slug])
export const ReceiptId = z.union([Address, Signature])
export const HardwareType = z.enum(['dev', 'tdx', 'sev-snp'])
export const EncryptionKey = Base64.refine((value) => { try { return fromBase64(value).length === 32 } catch { return false } }, 'Must encode a 32-byte X25519 key.')
export const ReceiptSignature = Base64.refine((value) => { try { return fromBase64(value).length === 64 } catch { return false } }, 'Must encode a 64-byte Ed25519 signature.')
export const Envelope = Base64.refine((value) => { try { const bytes = fromBase64(value); return bytes.length >= 73 && bytes[0] === 1 } catch { return false } }, 'Must encode a version 1 ciphertext envelope.')
export const WrappedKey = Envelope.refine((value) => { try { return fromBase64(value).length === 105 } catch { return false } }, 'Must encode an envelope wrapping a 32-byte key.')
export const ModelBaseFormat = z.enum(MODEL_BASE_FORMATS)
export const ModelBaseSource = z.string().min(1).max(MAX_BASE_SOURCE).refine(
  (value) => !/[\s\x00-\x1f\x7f]/.test(value) && /^(?:https?:\/\/|ipfs:\/\/|hf:\/\/)/.test(value),
  'Base source must use https://, http://, ipfs://, or hf:// with no whitespace or control characters.',
)
export const TokenizerFormat = z.enum(TOKENIZER_FORMATS)
export const TokenizerRef = z.strictObject({
  format: TokenizerFormat,
  source: ModelBaseSource.optional(),
  sha256: Hash.refine((value) => !/^0{64}$/.test(value), 'Tokenizer SHA-256 must be non-zero.').optional(),
  vocabSize: z.int().min(1).max(1_000_000),
  maxInputTokens: z.int().min(1).max(32_768),
  maxOutputTokens: z.int().min(1).max(4_096).optional(),
  bosTokenId: z.int().nonnegative().optional(),
  eosTokenId: z.int().nonnegative().optional(),
  padTokenId: z.int().nonnegative().optional(),
}).superRefine((value, ctx) => {
  if (value.format !== 'byte-level') {
    if (!value.source) ctx.addIssue({ code: 'custom', path: ['source'], message: 'Tokenizer source is required for bpe and word-piece formats.' })
    if (!value.sha256) ctx.addIssue({ code: 'custom', path: ['sha256'], message: 'Tokenizer sha256 is required for bpe and word-piece formats.' })
  } else if (Boolean(value.source) !== Boolean(value.sha256)) {
    ctx.addIssue({ code: 'custom', path: [value.source ? 'sha256' : 'source'], message: 'Tokenizer source and sha256 must be supplied together.' })
  }
  if (value.bosTokenId !== undefined && value.bosTokenId >= value.vocabSize) {
    ctx.addIssue({ code: 'custom', path: ['bosTokenId'], message: 'bosTokenId must be less than vocabSize.' })
  }
  if (value.eosTokenId !== undefined && value.eosTokenId >= value.vocabSize) {
    ctx.addIssue({ code: 'custom', path: ['eosTokenId'], message: 'eosTokenId must be less than vocabSize.' })
  }
  if (value.padTokenId !== undefined && value.padTokenId >= value.vocabSize) {
    ctx.addIssue({ code: 'custom', path: ['padTokenId'], message: 'padTokenId must be less than vocabSize.' })
  }
})
export const Manifest = z.strictObject({
  name: Slug,
  inputKind: z.enum(['sketch', 'tensor', 'text']),
  inputShape: z.array(z.int().positive()).min(1).optional(),
  labels: z.array(z.string()).min(1).optional(),
  tokenizer: TokenizerRef.optional(),
  inputName: z.string().min(1).optional(),
  outputName: z.string().min(1).optional(),
  preprocess: z.string().min(1).optional(),
}).superRefine((value, ctx) => {
  if (value.inputKind === 'text') {
    if (!value.tokenizer) {
      ctx.addIssue({ code: 'custom', path: ['tokenizer'], message: 'Text models require a tokenizer in the manifest.' })
    }
  } else {
    if (!value.inputShape || value.inputShape.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['inputShape'], message: 'Sketch and tensor models require inputShape in the manifest.' })
    }
    if (!value.labels || value.labels.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['labels'], message: 'Sketch and tensor models require labels in the manifest.' })
    }
  }
})
export const CipherHeader = z.strictObject({ id: z.literal('xchacha20poly1305-64k-v1'), chunkSizeBytes: z.literal(65536), noncePrefix: Base64.refine((value) => { try { return fromBase64(value).length === 16 } catch { return false } }, 'Must encode a 16-byte nonce prefix.') })
export const Money = z.strictObject({ amount: U64, mint: Address.nullable(), decimals: z.int().min(0).max(255), symbol: z.string() })
export const ByteRange = z.strictObject({ offset: z.int().nonnegative(), length: z.int().positive() })
export const Weights = z.strictObject({ address: Address, model: Address, index: z.int().nonnegative(), offset: z.int().nonnegative(), sizeBytes: z.int().nonnegative(), writtenRanges: z.array(ByteRange) })
export const Upload = z.strictObject({ uploadKey: Address, uploadKeys: z.array(Address), bytesWritten: z.int().nonnegative(), transactionsWritten: z.int().nonnegative(), writtenRanges: z.array(ByteRange), closed: z.boolean() })
export const ModelStatus = z.enum(['uploading', 'sealed', 'live', 'retired'])
export const ModelBase = z.strictObject({
  sha256: Hash.refine((value) => !/^0{64}$/.test(value), 'Base SHA-256 must be non-zero.'),
  sizeBytes: z.int().positive(),
  format: ModelBaseFormat,
  source: ModelBaseSource,
})
export const ModelBaseSchema = ModelBase
export const Model = z.strictObject({
  address: Address, name: Slug, owner: Address, createdSlot: U64, sealedSlot: U64.nullable(),
  sizeBytes: z.int().nonnegative(), plaintextSizeBytes: z.int().nonnegative(), ciphertextSha256: Hash.nullable(),
  hashVersion: z.int().min(0).max(1), sealedChunks: z.int().nonnegative(),
  base: ModelBase.nullable(),
  cipher: CipherHeader, allowedMeasurements: z.array(Measurement).min(1), price: Money, priceUnit: PriceUnit,
  operatorShareBps: z.int().min(0).max(10000), protocolShareBps: z.int().min(0).max(10000).nullable(),
  status: ModelStatus, manifest: Manifest, weights: z.array(Weights), upload: Upload.nullable(),
  enclavesHolding: z.int().nonnegative(), callsSettled: U64,
  currentVersion: z.int().positive().optional(),
  hasSplit: z.boolean().optional(),
})
export const VersionStatus = z.enum(['uploading', 'live', 'archived'])
export const ModelVersion = z.strictObject({
  model: Address,
  version: z.int().positive(),
  address: Address.nullable(),
  status: VersionStatus,
  sizeBytes: z.int().nonnegative(),
  ciphertextSha256: Hash.nullable(),
  base: ModelBase.nullable(),
  manifest: Manifest.nullable(),
  publishedSlot: U64.nullable(),
})
export const ModelVersions = z.strictObject({ items: z.array(ModelVersion), currentVersion: z.int().positive() })
export const SessionStatus = z.enum(['open', 'closed'])
export const Session = z.strictObject({
  address: Address,
  caller: Address,
  delegate: Address,
  nonce: U64,
  mint: Address.nullable(),
  model: Address.nullable(),
  budget: Money,
  spent: U64,
  remaining: U64,
  callsOpened: U64,
  openedSlot: U64,
  expiresAtSlot: U64,
  closedSlot: U64.nullable(),
  returnedAmount: U64.nullable(),
  status: SessionStatus,
})
export const AccountSessions = z.strictObject({ items: z.array(Session), asOf: Timestamp })
export const OpenSessionRequest = z.strictObject({
  wallet: Address,
  delegate: Address,
  nonce: U64.optional(),
  mint: Address.nullable().optional(),
  model: ModelId.nullable().optional(),
  budget: U64,
  expiresAtSlot: U64.optional(),
  durationSlots: U64.optional(),
  delegateGasLamports: U64.optional(),
})
export const OpenSessionCallRequest = z.strictObject({
  delegate: Address,
  model: ModelId,
  enclave: Address,
  inputHash: Hash,
  nonce: U64.optional(),
  answerMode: AnswerMode.default('sealed'),
  ceiling: U64.optional(),
})
export const AttestationRecord = z.strictObject({ address: Address, signingKey: Address, encryptionKey: EncryptionKey, hardwareType: HardwareType, measurement: Measurement, recordedSlot: U64, expiresAtSlot: U64, layoutVersion: z.int().positive() })
export const Enclave = z.strictObject({ address: Address, signingKey: Address, encryptionKey: EncryptionKey, hardwareType: HardwareType, measurement: Measurement, expiresAtSlot: U64, operator: Address, endpoint: z.url(), relayPath: z.string(), status: z.enum(['live', 'expired']), reachable: z.boolean(), lastSeen: Timestamp.nullable(), modelsHeld: z.int().nonnegative(), callsSettled: U64, attestation: AttestationRecord, bondedLamports: U64.optional(), missedCalls: U64.optional(), slashedTotal: U64.optional() })
export const Grant = z.strictObject({ address: Address, model: Address, modelName: Slug, enclave: Address, wrappedKey: WrappedKey, grantedBy: Address, grantedSlot: U64, status: z.enum(['live', 'expired', 'revoked']), quotedOperatorShareBps: z.int().min(0).max(10000).nullable().optional(), medianAnswerMs: z.int().nonnegative().nullable().optional() })
export const GrantedEnclave = z.strictObject({ enclave: Enclave, grant: Grant })
export const Payment = z.strictObject({ recipient: Address, amount: U64 })
export const PaymentSplit = z.strictObject({ mint: Address.nullable(), total: U64, owner: Payment, operator: Payment, protocol: Payment })
export const Receipt = z.strictObject({ address: Address, call: Address, caller: Address, callerIsProgram: z.boolean(), model: Address, modelName: Slug, enclave: Address, inputHash: Hash, outputHash: Hash, signature: ReceiptSignature, answerMode: AnswerMode, openAnswer: Base64.nullable(), deliveredCount: U64.nullable(), returnedAmount: U64.nullable(), slot: U64, transactionSignature: Signature, payments: PaymentSplit })
export const ReceiptView = z.strictObject({ receipt: Receipt, enclaveSigningKey: Address, attestationRecord: AttestationRecord, attestationProgramId: Address, recordLayoutVersion: z.int().positive(), modelBase: ModelBase.nullable() })
export const RefundState = z.enum(['unavailable', 'pending-deadline', 'refundable', 'refunded'])
export const CallFailure = z.strictObject({ code: ErrorCode, message: z.string(), refundState: RefundState })
export const CallStatus = z.enum(['open', 'settled', 'refundable', 'refunded'])
export const Call = z.strictObject({ address: Address, caller: Address, callerIsProgram: z.boolean(), model: Address, modelName: Slug, enclave: Address, inputHash: Hash, answerMode: AnswerMode, price: Money, priceUnit: PriceUnit, unitPrice: Money, ceiling: Money.nullable(), openedSlot: U64, deadlineSlot: U64, status: CallStatus, receipt: Address.nullable(), failure: CallFailure.nullable() })
export const CallAnswer = z.strictObject({ status: z.enum(['waiting', 'answered', 'failed']), call: Call, outputEnvelope: Envelope.nullable(), openAnswer: Base64.nullable(), outputHash: Hash.nullable(), signature: ReceiptSignature.nullable(), settleTransaction: Signature.nullable(), receiptAddress: Address.nullable(), failure: CallFailure.nullable() })
export const StreamFinishReason = z.enum(['eos', 'length', 'ceiling', 'stopped'])
export const StreamPiece = z.strictObject({
  call: Address,
  index: z.int().nonnegative(),
  count: z.int().nonnegative(),
  deltaTokens: z.int().nonnegative(),
  envelope: Envelope,
  pieceHash: Hash,
  runningHash: Hash,
  signature: ReceiptSignature,
  finishReason: StreamFinishReason.nullable(),
})
export const CallStreamDone = z.strictObject({
  call: Address,
  status: z.enum(['done', 'failed']),
  count: z.int().nonnegative(),
  pieceCount: z.int().nonnegative(),
  runningHash: Hash.nullable(),
  signature: ReceiptSignature.nullable(),
  finishReason: StreamFinishReason.nullable(),
  receiptAddress: Address.nullable(),
  settleTransaction: Signature.nullable(),
  failure: CallFailure.nullable(),
})
export const CallPieces = z.strictObject({
  call: Address,
  status: z.enum(['waiting', 'streaming', 'done', 'failed']),
  pieces: z.array(StreamPiece),
  failure: CallFailure.nullable(),
})
export const RelayAccepted = z.strictObject({ call: Address, status: z.literal('accepted') })
export const StopCallAccepted = z.strictObject({ call: Address, status: z.enum(['stopping', 'already-finished']) })
export const Earnings = Money
export const Account = z.strictObject({ wallet: Address, models: z.array(Model), ownerEarnings: z.array(Earnings), enclaves: z.array(Enclave), operatorEarnings: z.array(Earnings), calls: z.array(Call) })
export const EnclaveDetail = z.strictObject({ enclave: Enclave, grants: z.array(Grant), receipts: z.array(Receipt), earnings: z.array(Earnings) })
export const Stats = z.strictObject({ models: z.int().nonnegative(), enclaves: z.int().nonnegative(), receipts: U64, callsSettled: U64, programCalls: U64, operatorEarnings: z.array(Earnings), currentSlot: U64, asOf: Timestamp })
export const Config = z.strictObject({ mode: z.enum(['fixture', 'chain']), cluster: z.enum(['localnet', 'devnet', 'mainnet-beta']), rpcUrl: z.url(), programId: Address.nullable(), attestationProgramId: Address.nullable(), bountyProgramId: Address.nullable(), attestationRecordLayoutVersion: z.int().positive().nullable(), feeRecipient: Address.nullable(), protocolShareBps: z.int().min(0).max(10000).nullable(), callDeadlineSlots: U64.nullable(), maxOpenAnswerBytes: z.int().positive().max(4096).nullable(), tokenMint: Address.nullable(), fixture: z.boolean() })
export const Health = z.strictObject({ status: z.enum(['fixture', 'waiting', 'ready']), contractVersion: z.string() })
export const WeightsRangeQuery = z.strictObject({ offset: z.coerce.number().int().nonnegative().default(0), length: z.coerce.number().int().positive().max(1048576).default(256) })
export const WeightsRange = z.strictObject({ model: Address, offset: z.int().nonnegative(), length: z.int().nonnegative(), totalBytes: z.int().nonnegative(), bytesBase64: Base64, accounts: z.array(Weights) })
export const Home = z.strictObject({ stats: Stats, model: Model.nullable(), ciphertext: WeightsRange.nullable(), recentReceipts: z.array(Receipt) })
export const ModelQuery = PageQuery.extend({ sort: z.enum(['calls', 'newest', 'price']).default('calls') })
export const ModelsPage = page(Model)
export const EnclavesPage = page(Enclave)
export const ReceiptsPage = page(Receipt)
export const GrantedEnclaves = z.strictObject({ items: z.array(GrantedEnclave), asOf: Timestamp })
export const BountyStatus = z.enum(['open', 'claimed', 'cancelled'])
export const BountyAttempt = z.strictObject({ address: Address, bounty: Address, drawer: Address, call: Address, createdSlot: U64, refunded: z.boolean() })
export const Bounty = z.strictObject({
  address: Address, creator: Address, nonce: U64, model: Address, modelName: Slug.nullable(),
  targetLabel: z.string().min(1).max(32), reward: Money, status: BountyStatus,
  winner: Address.nullable(), winningCall: Address.nullable(), winningReceipt: Address.nullable(),
  createdSlot: U64, claimedSlot: U64.nullable(), attempts: U64,
})
export const BountyDetail = z.strictObject({ bounty: Bounty, attempts: z.array(BountyAttempt) })
export const BountiesPage = page(Bounty)
export const BountyQuery = PageQuery.extend({ status: BountyStatus.optional(), model: ModelId.optional() })
export const MeasurementStatus = z.enum(['active', 'deprecated'])
export const MeasurementRecord = z.strictObject({
  address: Address,
  digest: HardwareMeasurement,
  publisher: Address,
  sourceRepo: z.string().min(1).max(MAX_SOURCE_REPO),
  commitSha: z.string().regex(/^[0-9a-fA-F]{7,64}$/),
  recipeHash: Hash,
  version: z.string().min(1).max(MAX_MEASUREMENT_VERSION),
  createdSlot: U64,
  status: MeasurementStatus,
})
export const MeasurementsPage = page(MeasurementRecord)
export const MeasurementQuery = PageQuery.extend({ status: MeasurementStatus.optional() })
export const PolicyRegion = z.string().regex(/^[a-z0-9-]+$/).min(1).max(MAX_POLICY_REGION_LEN)
export const ModelPolicy = z.strictObject({
  address: Address,
  model: Address,
  allowListEnabled: z.boolean(),
  allowedCallers: z.array(Address).max(MAX_POLICY_CALLERS),
  maxCallsPerCallerPerWindow: z.int().nonnegative(),
  windowSlots: U64,
  allowedOperators: z.array(Address).max(MAX_POLICY_OPERATORS),
  allowedRegions: z.array(PolicyRegion).max(MAX_POLICY_REGIONS),
  updatedSlot: U64,
})
export const SplitRecipientInput = z.strictObject({
  wallet: Address,
  shareBps: z.int().min(1).max(10000),
})
export const SplitRecipient = z.strictObject({
  wallet: Address,
  shareBps: z.int().min(0).max(10000),
  accrued: U64,
  claimed: U64,
  claimable: U64,
})
export const ModelSplit = z.strictObject({
  address: Address,
  model: Address,
  authority: Address,
  mint: Address.nullable(),
  active: z.boolean(),
  totalReceived: U64,
  recipients: z.array(SplitRecipient).max(MAX_SPLIT_RECIPIENTS),
  updatedSlot: U64,
})
export const OperatorBond = z.strictObject({
  address: Address,
  enclave: Address,
  operator: Address,
  bondedLamports: U64,
  slashedTotal: U64,
  missedCalls: U64,
  slashBps: z.int().min(0).max(10000),
  updatedSlot: U64,
})
export const BenchmarkUri = z.string().min(1).max(MAX_BENCHMARK_URI).refine(
  (value) => !/[\s\x00-\x1f\x7f]/.test(value) && /^(?:https?:\/\/|ipfs:\/\/|hf:\/\/)/.test(value),
  'Dataset URI must use https://, http://, ipfs://, or hf:// with no whitespace or control characters.',
)
export const BenchmarkRecord = z.strictObject({
  address: Address,
  model: Address,
  modelName: Slug.nullable().optional(),
  publisher: Address,
  name: Slug,
  modelVersion: z.int().positive(),
  datasetSha256: Hash,
  datasetUri: BenchmarkUri,
  sampleCount: z.int().positive(),
  passedCount: z.int().nonnegative(),
  scoreBps: z.int().min(0).max(10000),
  receipts: z.array(Address).min(1).max(MAX_BENCHMARK_RECEIPTS),
  publishedSlot: U64,
})
export const BenchmarksPage = page(BenchmarkRecord)
export const BenchmarkQuery = PageQuery.extend({
  model: ModelId.optional(),
  name: Slug.optional(),
})
export const PassStatus = z.enum(['open', 'closed'])
export const PassPlan = z.strictObject({
  address: Address,
  model: Address,
  modelName: Slug.nullable().optional(),
  authority: Address,
  mint: Address.nullable(),
  pricePerCall: U64,
  minCalls: z.int().nonnegative(),
  maxCalls: z.int().nonnegative(),
  ttlSlots: U64,
  active: z.boolean(),
  updatedSlot: U64,
})
export const Pass = z.strictObject({
  address: Address,
  model: Address,
  modelName: Slug.nullable().optional(),
  holder: Address,
  nonce: U64,
  mint: Address.nullable(),
  pricePerCall: U64,
  callsTotal: z.int().positive(),
  callsUsed: z.int().nonnegative(),
  callsRemaining: z.int().nonnegative(),
  escrowRemaining: U64,
  returnedAmount: U64,
  purchasedSlot: U64,
  expiresAtSlot: U64,
  closedSlot: U64.nullable(),
  status: PassStatus,
  updatedSlot: U64,
})
export const AccountPasses = z.strictObject({ items: z.array(Pass), asOf: Timestamp })
export const ReferralConfig = z.strictObject({
  address: Address,
  model: Address,
  modelName: Slug.nullable().optional(),
  shareBps: z.int().min(0).max(MAX_REFERRAL_SHARE_BPS),
  active: z.boolean(),
  updatedSlot: U64,
})
export const Referral = z.strictObject({
  address: Address,
  model: Address,
  modelName: Slug.nullable().optional(),
  referrer: Address,
  mint: Address.nullable(),
  totalEarned: U64,
  claimed: U64,
  claimable: U64,
  callsReferred: U64,
  updatedSlot: U64,
})
export const AccountReferrals = z.strictObject({ items: z.array(Referral), asOf: Timestamp })
export const QuorumStatus = z.enum(['open', 'agreed'])
export const QuorumRecord = z.strictObject({
  address: Address,
  model: Address,
  modelName: Slug.nullable().optional(),
  caller: Address,
  nonce: U64,
  inputHash: Hash,
  requiredVotes: z.int().min(MIN_QUORUM_VOTES).max(MAX_QUORUM_VOTES),
  requireDistinctEnclaves: z.boolean(),
  status: QuorumStatus,
  agreedOutputHash: Hash.nullable(),
  voteCount: z.int().min(0).max(MAX_QUORUM_VOTES),
  distinctEnclaves: z.int().min(0).max(MAX_QUORUM_VOTES),
  receipts: z.array(Address).max(MAX_QUORUM_VOTES),
  createdSlot: U64,
  finalizedSlot: U64.nullable(),
  updatedSlot: U64,
})
export const QuorumsPage = page(QuorumRecord)
export const QuorumQuery = PageQuery.extend({
  model: ModelId.optional(),
  caller: Address.optional(),
  status: QuorumStatus.optional(),
})
export const BatchStatus = z.enum(['open', 'completed'])
export const BatchRecord = z.strictObject({
  address: Address,
  model: Address,
  modelName: Slug.optional(),
  caller: Address,
  nonce: U64,
  manifestHash: Hash,
  totalCount: z.int().min(MIN_BATCH_ITEMS).max(MAX_BATCH_ITEMS),
  completedCount: z.int().min(0).max(MAX_BATCH_ITEMS),
  status: BatchStatus,
  receiptsRoot: Hash,
  receipts: z.array(Address).max(MAX_BATCH_ITEMS),
  createdSlot: U64,
  completedSlot: U64.nullable(),
  updatedSlot: U64,
})
export const BatchesPage = page(BatchRecord)
export const BatchQuery = PageQuery.extend({
  model: ModelId.optional(),
  caller: Address.optional(),
  status: BatchStatus.optional(),
})
export const OpenAIModelMetadata = z.strictObject({
  address: Address,
  slug: Slug,
  inputKind: z.enum(['sketch', 'tensor', 'text']),
  pricingMode: PriceUnit,
  price: U64,
  mint: Address.nullable(),
  status: ModelStatus,
  currentVersion: z.int().min(1),
})
export const OpenAIModel = z.strictObject({
  id: z.string().min(1),
  object: z.literal('model'),
  created: z.int().nonnegative(),
  owned_by: Address,
  voynich: OpenAIModelMetadata,
})
export const OpenAIModelsList = z.strictObject({
  object: z.literal('list'),
  data: z.array(OpenAIModel),
})

export const WalletRequest = z.strictObject({ wallet: Address })
const CreateModelBase = z.strictObject({ wallet: Address, uploadKey: Address, uploadKeys: z.array(Address).min(1).max(MAX_UPLOAD_KEYS).optional(), weights: z.array(Address).min(1).max(INITIAL_CREATE_WEIGHTS).optional(), name: Slug, manifest: Manifest, sizeBytes: z.int().positive(), plaintextSizeBytes: z.int().positive(), cipher: CipherHeader, price: Money, priceUnit: PriceUnit.optional(), operatorShareBps: z.int().min(0).max(10000), allowedMeasurements: z.array(Measurement).min(1).max(8), uploadFundingLamports: U64, base: ModelBase.optional() })
const validUploadKeys = (value: { uploadKey: string; uploadKeys?: string[] }) => !value.uploadKeys || (value.uploadKeys[0] === value.uploadKey && new Set(value.uploadKeys).size === value.uploadKeys.length)
export const CreateModelRequest = CreateModelBase.refine(validUploadKeys, { path: ['uploadKeys'], message: 'uploadKeys must start with uploadKey and contain distinct addresses.' })
export const ModelCostCreate = CreateModelBase.omit({ sizeBytes: true, uploadFundingLamports: true }).extend({ weights: z.array(Address).min(1).max(INITIAL_CREATE_WEIGHTS) }).refine(value => value.name === value.manifest.name, { path: ['name'], message: 'The manifest name must match the model name.' }).refine(validUploadKeys, { path: ['uploadKeys'], message: 'uploadKeys must start with uploadKey and contain distinct addresses.' })
export const ModelCostRequest = z.strictObject({ sizeBytes: z.int().min(17).max(MAX_WEIGHTS * (10 * 1024 * 1024 - 56)), uploadKeyCount: z.int().min(1).max(MAX_UPLOAD_KEYS).optional(), create: ModelCostCreate.optional() })
export const ModelCostQuote = z.strictObject({
  fixture: z.boolean(), asOfSlot: U64, sizeBytes: z.int().positive(), writeChunkBytes: z.literal(WRITE_CHUNK_BYTES), writeCount: z.int().positive(),
  modelAccountBytes: z.literal(MODEL_ACCOUNT_BYTES), modelRentLamports: U64,
  weights: z.array(z.strictObject({ index: z.int().nonnegative(), payloadBytes: z.int().positive(), accountBytes: z.int().positive(), rentLamports: U64, writeCount: z.int().positive() })),
  weightsRentLamports: U64, uploadKeyCount: z.int().min(1).max(MAX_UPLOAD_KEYS), uploadKeyMinimumLamports: U64,
  signaturesPerTransaction: z.strictObject({ allocation: z.int().positive(), createModel: z.int().positive(), write: z.int().positive(), seal: z.int().positive() }),
  allocationFeeLamports: U64, allocationFeesLamports: U64, createFeeLamports: U64,
  attachWeightsCount: z.int().nonnegative(), attachWeightsFeesLamports: U64,
  writeFeeLamports: U64, writeFeesLamports: U64,
  sealRangeCount: z.int().nonnegative(), sealRangeFeesLamports: U64,
  sealFeeLamports: U64,
  uploadFundingLamports: U64, returnedUploadReserveLamports: U64, estimatedCostLamports: U64, requiredUpfrontLamports: U64,
  createTransactionBytes: z.int().nonnegative().nullable(), createTransactionMaxBytes: z.literal(1104), manifestBytes: z.int().nonnegative().nullable(), canCreate: z.boolean().nullable(),
})
export const AttachWeightsRequest = z.strictObject({ wallet: Address, weights: z.array(Address).min(1).max(ATTACH_WEIGHTS_BATCH) })
export const WriteWeightsRequest = z.strictObject({ wallet: Address, offset: z.int().nonnegative(), bytesBase64: Base64.min(4).max(WRITE_CHUNK_MAX_BASE64).refine((value) => { try { return fromBase64(value).length <= WRITE_CHUNK_BYTES } catch { return false } }, `A write carries at most ${WRITE_CHUNK_BYTES} ciphertext bytes.`) })
export const SealRangeRequest = z.strictObject({ wallet: Address, chunkCount: z.int().min(1).max(SEAL_RANGE_CHUNKS).optional() })
export const SealModelRequest = z.strictObject({ wallet: Address, ciphertextSha256: Hash })
export const SetPriceRequest = z.strictObject({ wallet: Address, price: Money, operatorShareBps: z.int().min(0).max(10000), priceUnit: PriceUnit.optional() })
export const GrantRequest = z.strictObject({ wallet: Address, enclave: Address, wrappedKey: WrappedKey })
export const RevokeGrantRequest = z.strictObject({ wallet: Address, enclave: Address })
export const SetQuoteRequest = z.strictObject({ model: ModelId, operatorShareBps: z.int().min(0).max(10000).nullable(), payer: Address.optional() })
export const BeginVersionRequest = z.strictObject({
  wallet: Address,
  version: z.int().min(2).optional(),
  weights: z.array(Address).min(1).max(INITIAL_CREATE_WEIGHTS),
  manifest: Manifest,
  sizeBytes: z.int().positive(),
  noncePrefix: Base64.refine((value) => { try { return fromBase64(value).length === 16 } catch { return false } }, 'Must encode a 16-byte nonce prefix.'),
  base: ModelBase.optional(),
})
export const WriteVersionWeightsRequest = z.strictObject({
  wallet: Address,
  version: z.int().min(2),
  weights: Address,
  offset: z.int().nonnegative(),
  bytesBase64: Base64.min(4).max(WRITE_CHUNK_MAX_BASE64).refine((value) => { try { return fromBase64(value).length <= WRITE_CHUNK_BYTES } catch { return false } }, `A write carries at most ${WRITE_CHUNK_BYTES} ciphertext bytes.`),
})
export const SealVersionRangeRequest = z.strictObject({
  wallet: Address,
  version: z.int().min(2),
  chunkCount: z.int().min(1).max(SEAL_RANGE_CHUNKS).optional(),
})
export const PublishVersionRequest = z.strictObject({
  wallet: Address,
  version: z.int().min(2),
  ciphertextSha256: Hash,
})
export const OpenCallRequest = z.strictObject({ wallet: Address, model: ModelId, enclave: Address, inputHash: Hash, answerMode: AnswerMode.default('sealed'), nonce: U64.optional(), ceiling: U64.optional(), referrer: Address.optional() })
export const RelayInputRequest = z.strictObject({ envelope: Envelope })
export const StopCallRequest = z.strictObject({ stopToken: Base64 })
export const SettleCallRequest = z.strictObject({ wallet: Address, count: U64, runningHash: Hash, signature: ReceiptSignature })
export const PostBountyRequest = z.strictObject({ wallet: Address, model: ModelId, targetLabel: z.string().min(1).max(32), reward: Money, nonce: U64.optional() })
export const DrawBountyRequest = z.strictObject({ wallet: Address, enclave: Address, inputHash: Hash, nonce: U64.optional() })
export const CollectBountyRequest = z.strictObject({ wallet: Address, call: Address })
export const PublishMeasurementRequest = z.strictObject({
  wallet: Address,
  digest: HardwareMeasurement.refine((value) => !/^0{96}$/.test(value), 'Measurement digest must be non-zero.'),
  sourceRepo: z.string().min(1).max(MAX_SOURCE_REPO).refine((value) => !/[\s\x00-\x1f\x7f]/.test(value), 'sourceRepo must not contain whitespace or control characters.'),
  commitSha: z.string().regex(/^[0-9a-fA-F]{7,64}$/),
  recipeHash: Hash.refine((value) => !/^0{64}$/.test(value), 'recipeHash must be non-zero.'),
  version: z.string().min(1).max(MAX_MEASUREMENT_VERSION).refine((value) => !/[\s\x00-\x1f\x7f]/.test(value), 'version must not contain whitespace or control characters.'),
})
export const SetPolicyRequest = z.strictObject({
  wallet: Address,
  allowListEnabled: z.boolean(),
  allowedCallers: z.array(Address).max(MAX_POLICY_CALLERS).default([]),
  maxCallsPerCallerPerWindow: z.int().nonnegative().default(0),
  windowSlots: U64.default('0'),
  allowedOperators: z.array(Address).max(MAX_POLICY_OPERATORS).default([]),
  allowedRegions: z.array(PolicyRegion).max(MAX_POLICY_REGIONS).default([]),
}).superRefine((value, ctx) => {
  const windowBig = BigInt(value.windowSlots)
  if ((value.maxCallsPerCallerPerWindow === 0) !== (windowBig === 0n)) {
    ctx.addIssue({ code: 'custom', path: ['windowSlots'], message: 'maxCallsPerCallerPerWindow and windowSlots must both be zero or both positive.' })
  }
  if (new Set(value.allowedCallers).size !== value.allowedCallers.length) {
    ctx.addIssue({ code: 'custom', path: ['allowedCallers'], message: 'allowedCallers must contain distinct addresses.' })
  }
  if (new Set(value.allowedOperators).size !== value.allowedOperators.length) {
    ctx.addIssue({ code: 'custom', path: ['allowedOperators'], message: 'allowedOperators must contain distinct addresses.' })
  }
  if (new Set(value.allowedRegions).size !== value.allowedRegions.length) {
    ctx.addIssue({ code: 'custom', path: ['allowedRegions'], message: 'allowedRegions must contain distinct region codes.' })
  }
})
export const SetSplitRequest = z.strictObject({
  wallet: Address,
  recipients: z.array(SplitRecipientInput).max(MAX_SPLIT_RECIPIENTS),
}).superRefine((value, ctx) => {
  if (value.recipients.length === 0) return
  if (new Set(value.recipients.map((r) => r.wallet)).size !== value.recipients.length) {
    ctx.addIssue({ code: 'custom', path: ['recipients'], message: 'Split recipients must have distinct wallet addresses.' })
  }
  const totalBps = value.recipients.reduce((sum, r) => sum + r.shareBps, 0)
  if (totalBps !== 10000) {
    ctx.addIssue({ code: 'custom', path: ['recipients'], message: `Split shares must sum to 10000 bps (got ${totalBps}).` })
  }
})
export const ClaimSplitRequest = z.strictObject({
  wallet: Address,
  recipient: Address.optional(),
})
export const DepositBondRequest = z.strictObject({
  wallet: Address,
  amountLamports: U64.refine((value) => BigInt(value) > 0n, 'amountLamports must be positive.'),
})
export const WithdrawBondRequest = z.strictObject({
  wallet: Address,
  amountLamports: U64.refine((value) => BigInt(value) > 0n, 'amountLamports must be positive.'),
})
export const PublishBenchmarkRequest = z.strictObject({
  wallet: Address,
  name: Slug,
  datasetSha256: Hash.refine((value) => !/^0{64}$/.test(value), 'datasetSha256 must be non-zero.'),
  datasetUri: BenchmarkUri,
  sampleCount: z.int().positive(),
  passedCount: z.int().nonnegative(),
  scoreBps: z.int().min(0).max(10000).optional(),
  receipts: z.array(Address).min(1).max(MAX_BENCHMARK_RECEIPTS),
}).superRefine((value, ctx) => {
  if (value.passedCount > value.sampleCount) {
    ctx.addIssue({ code: 'custom', path: ['passedCount'], message: 'passedCount cannot exceed sampleCount.' })
  }
  const expected = Math.floor((value.passedCount * 10000) / value.sampleCount)
  if (value.scoreBps !== undefined && value.scoreBps !== expected) {
    ctx.addIssue({ code: 'custom', path: ['scoreBps'], message: `scoreBps must equal floor(passedCount * 10000 / sampleCount) = ${expected}.` })
  }
  if (new Set(value.receipts).size !== value.receipts.length) {
    ctx.addIssue({ code: 'custom', path: ['receipts'], message: 'receipts must contain distinct receipt addresses.' })
  }
})
export const SetPassPlanRequest = z.strictObject({
  wallet: Address,
  pricePerCall: U64,
  minCalls: z.int().nonnegative(),
  maxCalls: z.int().nonnegative(),
  ttlSlots: U64,
  active: z.boolean(),
}).superRefine((value, ctx) => {
  if (!value.active) return
  if (BigInt(value.pricePerCall) <= 0n) {
    ctx.addIssue({ code: 'custom', path: ['pricePerCall'], message: 'pricePerCall must be positive when active.' })
  }
  if (value.minCalls < 1) {
    ctx.addIssue({ code: 'custom', path: ['minCalls'], message: 'minCalls must be at least 1 when active.' })
  }
  if (value.maxCalls < value.minCalls) {
    ctx.addIssue({ code: 'custom', path: ['maxCalls'], message: 'maxCalls must be >= minCalls when active.' })
  }
  if (BigInt(value.ttlSlots) <= 0n) {
    ctx.addIssue({ code: 'custom', path: ['ttlSlots'], message: 'ttlSlots must be positive when active.' })
  }
})
export const BuyPassRequest = z.strictObject({
  wallet: Address,
  model: ModelId,
  callsTotal: z.int().positive(),
  nonce: U64.optional(),
})
export const OpenPassCallRequest = z.strictObject({
  wallet: Address,
  pass: Address,
  enclave: Address,
  inputHash: Hash,
  answerMode: AnswerMode.default('sealed'),
  nonce: U64.optional(),
})
export const ClosePassRequest = z.strictObject({
  wallet: Address,
  pass: Address,
})
export const SetReferralConfigRequest = z.strictObject({
  wallet: Address,
  shareBps: z.int().min(0).max(MAX_REFERRAL_SHARE_BPS),
  active: z.boolean(),
}).superRefine((value, ctx) => {
  if (value.active && value.shareBps <= 0) {
    ctx.addIssue({ code: 'custom', path: ['shareBps'], message: 'shareBps must be positive when active.' })
  }
})
export const ClaimReferralRequest = z.strictObject({
  wallet: Address,
  referrer: Address.optional(),
})
export const OpenQuorumRequest = z.strictObject({
  wallet: Address,
  inputHash: Hash.refine((value) => !/^0{64}$/.test(value), 'inputHash must be non-zero.'),
  requiredVotes: z.int().min(MIN_QUORUM_VOTES).max(MAX_QUORUM_VOTES),
  requireDistinctEnclaves: z.boolean().default(true),
  nonce: U64.optional(),
})
export const FinalizeQuorumRequest = z.strictObject({
  wallet: Address,
  receipts: z.array(Address).min(MIN_QUORUM_VOTES).max(MAX_QUORUM_VOTES).refine(
    (items) => new Set(items).size === items.length,
    'receipts must contain distinct receipt addresses.',
  ),
})
export const OpenBatchRequest = z.strictObject({
  wallet: Address,
  manifestHash: Hash.refine((value) => !/^0{64}$/.test(value), 'manifestHash must be non-zero.'),
  totalCount: z.int().min(MIN_BATCH_ITEMS).max(MAX_BATCH_ITEMS),
  nonce: U64.optional(),
})
export const AppendBatchReceiptsRequest = z.strictObject({
  wallet: Address,
  receipts: z.array(Address).min(1).max(MAX_BATCH_APPEND_CHUNK).refine(
    (items) => new Set(items).size === items.length,
    'receipts must contain distinct receipt addresses.',
  ),
})
export const Action = z.enum(['create_model', 'attach_weights', 'write_weights', 'seal_range', 'seal_model', 'set_price', 'grant_by_owner', 'revoke_grant', 'set_quote', 'retire_model', 'open_call', 'settle_metered_call', 'refund_call', 'post_bounty', 'draw_bounty', 'collect_bounty', 'cancel_bounty', 'publish_measurement', 'deprecate_measurement', 'set_policy', 'clear_policy', 'begin_version', 'write_version_weights', 'seal_version_range', 'publish_version', 'open_session', 'close_session', 'open_session_call', 'set_split', 'claim_split', 'deposit_bond', 'withdraw_bond', 'publish_benchmark', 'set_pass_plan', 'buy_pass', 'open_pass_call', 'close_pass', 'set_referral_config', 'register_call_referral', 'claim_referral', 'open_quorum', 'finalize_quorum', 'open_batch', 'append_batch_receipts'])
export const Build = z.strictObject({ id: z.string(), transactionBase64: Base64, blockhash: z.string(), lastValidBlockHeight: z.int().nonnegative(), cosigned: z.boolean(), action: Action, requiredSigners: z.array(Address), fixture: z.boolean(), addresses: z.strictObject({ model: Address.optional(), call: Address.optional(), receipt: Address.optional(), weights: z.array(Address).optional(), uploadKey: Address.optional(), bounty: Address.optional(), attempt: Address.optional(), measurement: Address.optional(), policy: Address.optional(), grant: Address.optional(), modelVersion: Address.optional(), session: Address.optional(), split: Address.optional(), bond: Address.optional(), benchmark: Address.optional(), passPlan: Address.optional(), pass: Address.optional(), referralConfig: Address.optional(), referral: Address.optional(), callReferral: Address.optional(), quorum: Address.optional(), batch: Address.optional() }) })
export const TxFailure = z.strictObject({ stage: z.enum(['build', 'wallet-rejected', 'wallet-changed', 'simulation', 'send', 'confirm']), message: z.string(), nextStep: z.string().optional(), retryable: z.boolean(), program: z.strictObject({ address: Address, code: z.int().nullable(), name: z.string().nullable() }).optional() })
export const TxStatus = z.strictObject({ id: z.string(), status: z.enum(['built', 'submitted', 'unconfirmed', 'confirmed', 'finalized', 'failed', 'expired']), signature: Signature.optional(), error: TxFailure.nullish() })
export const TxSubmission = z.discriminatedUnion('mode', [z.strictObject({ mode: z.literal('relay'), buildId: z.string(), signedTransactionBase64: Base64, idempotencyKey: z.string().min(1).max(128) }), z.strictObject({ mode: z.literal('wallet-sent'), buildId: z.string(), signature: Signature, idempotencyKey: z.string().min(1).max(128) })])
const eventFields = { id: z.string(), timestamp: Timestamp }
export const ProgramEvent = z.discriminatedUnion('type', [
  z.strictObject({ ...eventFields, type: z.literal('ready'), data: z.union([z.strictObject({ status: z.enum(['fixture', 'waiting', 'ready']) }), CallAnswer]) }),
  z.strictObject({ ...eventFields, type: z.literal('resync'), data: z.strictObject({ reason: z.enum(['reconnected', 'behind']) }) }),
  z.strictObject({ ...eventFields, type: z.literal('model.updated'), data: Model }),
  z.strictObject({ ...eventFields, type: z.literal('enclave.updated'), data: Enclave }),
  z.strictObject({ ...eventFields, type: z.literal('call.updated'), data: Call }),
  z.strictObject({ ...eventFields, type: z.literal('call.piece'), data: StreamPiece }),
  z.strictObject({ ...eventFields, type: z.literal('call.stream.done'), data: CallStreamDone }),
  z.strictObject({ ...eventFields, type: z.literal('receipt.created'), data: Receipt }),
  z.strictObject({ ...eventFields, type: z.literal('bounty.updated'), data: Bounty }),
  z.strictObject({ ...eventFields, type: z.literal('measurement.updated'), data: MeasurementRecord }),
  z.strictObject({ ...eventFields, type: z.literal('policy.updated'), data: ModelPolicy }),
  z.strictObject({ ...eventFields, type: z.literal('policy.cleared'), data: z.strictObject({ model: Address, policy: Address }) }),
  z.strictObject({ ...eventFields, type: z.literal('version.published'), data: ModelVersion }),
  z.strictObject({ ...eventFields, type: z.literal('session.updated'), data: Session }),
  z.strictObject({ ...eventFields, type: z.literal('split.updated'), data: ModelSplit }),
  z.strictObject({ ...eventFields, type: z.literal('bond.updated'), data: OperatorBond }),
  z.strictObject({ ...eventFields, type: z.literal('benchmark.published'), data: BenchmarkRecord }),
  z.strictObject({ ...eventFields, type: z.literal('pass.updated'), data: Pass }),
  z.strictObject({ ...eventFields, type: z.literal('pass_plan.updated'), data: PassPlan }),
  z.strictObject({ ...eventFields, type: z.literal('referral_config.updated'), data: ReferralConfig }),
  z.strictObject({ ...eventFields, type: z.literal('referral.updated'), data: Referral }),
  z.strictObject({ ...eventFields, type: z.literal('quorum.updated'), data: QuorumRecord }),
  z.strictObject({ ...eventFields, type: z.literal('batch.updated'), data: BatchRecord }),
  z.strictObject({ ...eventFields, type: z.literal('transaction.updated'), data: TxStatus }),
])

export type Model = z.output<typeof Model>
export type ModelBase = z.output<typeof ModelBase>
export type ModelBaseFormat = z.output<typeof ModelBaseFormat>
export type TokenizerFormat = z.output<typeof TokenizerFormat>
export type TokenizerRef = z.output<typeof TokenizerRef>
export type Manifest = z.output<typeof Manifest>
export type Weights = z.output<typeof Weights>
export type Enclave = z.output<typeof Enclave>
export type AttestationRecord = z.output<typeof AttestationRecord>
export type Grant = z.output<typeof Grant>
export type Receipt = z.output<typeof Receipt>
export type Call = z.output<typeof Call>
export type CallAnswer = z.output<typeof CallAnswer>
export type StreamFinishReason = z.output<typeof StreamFinishReason>
export type StreamPiece = z.output<typeof StreamPiece>
export type CallStreamDone = z.output<typeof CallStreamDone>
export type CallPieces = z.output<typeof CallPieces>
export type Config = z.output<typeof Config>
export type Stats = z.output<typeof Stats>
export type Build = z.output<typeof Build>
export type TxStatus = z.output<typeof TxStatus>
export type TxSubmission = z.output<typeof TxSubmission>
export type Money = z.output<typeof Money>
export type CipherHeader = z.output<typeof CipherHeader>
export type Payment = z.output<typeof Payment>
export type PaymentSplit = z.output<typeof PaymentSplit>
export type Earnings = z.output<typeof Earnings>
export type Account = z.output<typeof Account>
export type EnclaveDetail = z.output<typeof EnclaveDetail>
export type ReceiptView = z.output<typeof ReceiptView>
export type Home = z.output<typeof Home>
export type WeightsRange = z.output<typeof WeightsRange>
export type CallFailure = z.output<typeof CallFailure>
export type ProgramEvent = z.output<typeof ProgramEvent>
export type Hash = z.output<typeof Hash>
export type Measurement = z.output<typeof Measurement>
export type HardwareMeasurement = z.output<typeof HardwareMeasurement>
export type ProgramModelName = z.output<typeof ProgramModelName>
export type Slug = z.output<typeof Slug>
export type ModelId = z.output<typeof ModelId>
export type ReceiptId = z.output<typeof ReceiptId>
export type HardwareType = z.output<typeof HardwareType>
export type EncryptionKey = z.output<typeof EncryptionKey>
export type ReceiptSignature = z.output<typeof ReceiptSignature>
export type Envelope = z.output<typeof Envelope>
export type WrappedKey = z.output<typeof WrappedKey>
export type ByteRange = z.output<typeof ByteRange>
export type Upload = z.output<typeof Upload>
export type ModelStatus = z.output<typeof ModelStatus>
export type GrantedEnclave = z.output<typeof GrantedEnclave>
export type RefundState = z.output<typeof RefundState>
export type CallStatus = z.output<typeof CallStatus>
export type AnswerMode = z.output<typeof AnswerMode>
export type PriceUnit = z.output<typeof PriceUnit>
export type RelayAccepted = z.output<typeof RelayAccepted>
export type StopCallAccepted = z.output<typeof StopCallAccepted>
export type StopCallRequest = z.output<typeof StopCallRequest>
export type SettleCallRequest = z.output<typeof SettleCallRequest>
export type Health = z.output<typeof Health>
export type WeightsRangeQuery = z.output<typeof WeightsRangeQuery>
export type ModelQuery = z.output<typeof ModelQuery>
export type ModelsPage = z.output<typeof ModelsPage>
export type EnclavesPage = z.output<typeof EnclavesPage>
export type ReceiptsPage = z.output<typeof ReceiptsPage>
export type GrantedEnclaves = z.output<typeof GrantedEnclaves>
export type WalletRequest = z.output<typeof WalletRequest>
export type ModelCostRequest = z.output<typeof ModelCostRequest>
export type ModelCostCreate = z.output<typeof ModelCostCreate>
export type ModelCostQuote = z.output<typeof ModelCostQuote>
export type CreateModelRequest = z.output<typeof CreateModelRequest>
export type AttachWeightsRequest = z.output<typeof AttachWeightsRequest>
export type WriteWeightsRequest = z.output<typeof WriteWeightsRequest>
export type SealRangeRequest = z.output<typeof SealRangeRequest>
export type SealModelRequest = z.output<typeof SealModelRequest>
export type SetPriceRequest = z.output<typeof SetPriceRequest>
export type GrantRequest = z.output<typeof GrantRequest>
export type RevokeGrantRequest = z.output<typeof RevokeGrantRequest>
export type SetQuoteRequest = z.output<typeof SetQuoteRequest>
export type OpenCallRequest = z.output<typeof OpenCallRequest>
export type RelayInputRequest = z.output<typeof RelayInputRequest>
export type BountyStatus = z.output<typeof BountyStatus>
export type BountyAttempt = z.output<typeof BountyAttempt>
export type Bounty = z.output<typeof Bounty>
export type BountyDetail = z.output<typeof BountyDetail>
export type BountiesPage = z.output<typeof BountiesPage>
export type BountyQuery = z.output<typeof BountyQuery>
export type PostBountyRequest = z.output<typeof PostBountyRequest>
export type DrawBountyRequest = z.output<typeof DrawBountyRequest>
export type CollectBountyRequest = z.output<typeof CollectBountyRequest>
export type MeasurementStatus = z.output<typeof MeasurementStatus>
export type MeasurementRecord = z.output<typeof MeasurementRecord>
export type MeasurementsPage = z.output<typeof MeasurementsPage>
export type MeasurementQuery = z.output<typeof MeasurementQuery>
export type PublishMeasurementRequest = z.output<typeof PublishMeasurementRequest>
export type PolicyRegion = z.output<typeof PolicyRegion>
export type ModelPolicy = z.output<typeof ModelPolicy>
export type SetPolicyRequest = z.output<typeof SetPolicyRequest>
export type SplitRecipientInput = z.output<typeof SplitRecipientInput>
export type SplitRecipient = z.output<typeof SplitRecipient>
export type ModelSplit = z.output<typeof ModelSplit>
export type SetSplitRequest = z.output<typeof SetSplitRequest>
export type ClaimSplitRequest = z.output<typeof ClaimSplitRequest>
export type OperatorBond = z.output<typeof OperatorBond>
export type DepositBondRequest = z.output<typeof DepositBondRequest>
export type WithdrawBondRequest = z.output<typeof WithdrawBondRequest>
export type BenchmarkRecord = z.output<typeof BenchmarkRecord>
export type BenchmarksPage = z.output<typeof BenchmarksPage>
export type BenchmarkQuery = z.output<typeof BenchmarkQuery>
export type PublishBenchmarkRequest = z.output<typeof PublishBenchmarkRequest>
export type PassStatus = z.output<typeof PassStatus>
export type PassPlan = z.output<typeof PassPlan>
export type Pass = z.output<typeof Pass>
export type AccountPasses = z.output<typeof AccountPasses>
export type SetPassPlanRequest = z.output<typeof SetPassPlanRequest>
export type BuyPassRequest = z.output<typeof BuyPassRequest>
export type OpenPassCallRequest = z.output<typeof OpenPassCallRequest>
export type ClosePassRequest = z.output<typeof ClosePassRequest>
export type ReferralConfig = z.output<typeof ReferralConfig>
export type Referral = z.output<typeof Referral>
export type AccountReferrals = z.output<typeof AccountReferrals>
export type SetReferralConfigRequest = z.output<typeof SetReferralConfigRequest>
export type ClaimReferralRequest = z.output<typeof ClaimReferralRequest>
export type QuorumStatus = z.output<typeof QuorumStatus>
export type QuorumRecord = z.output<typeof QuorumRecord>
export type QuorumsPage = z.output<typeof QuorumsPage>
export type QuorumQuery = z.output<typeof QuorumQuery>
export type OpenQuorumRequest = z.output<typeof OpenQuorumRequest>
export type FinalizeQuorumRequest = z.output<typeof FinalizeQuorumRequest>
export type BatchStatus = z.output<typeof BatchStatus>
export type BatchRecord = z.output<typeof BatchRecord>
export type BatchesPage = z.output<typeof BatchesPage>
export type BatchQuery = z.output<typeof BatchQuery>
export type OpenBatchRequest = z.output<typeof OpenBatchRequest>
export type AppendBatchReceiptsRequest = z.output<typeof AppendBatchReceiptsRequest>
export type OpenAIModelMetadata = z.output<typeof OpenAIModelMetadata>
export type OpenAIModel = z.output<typeof OpenAIModel>
export type OpenAIModelsList = z.output<typeof OpenAIModelsList>
export type VersionStatus = z.output<typeof VersionStatus>
export type ModelVersion = z.output<typeof ModelVersion>
export type ModelVersions = z.output<typeof ModelVersions>
export type BeginVersionRequest = z.output<typeof BeginVersionRequest>
export type WriteVersionWeightsRequest = z.output<typeof WriteVersionWeightsRequest>
export type SealVersionRangeRequest = z.output<typeof SealVersionRangeRequest>
export type PublishVersionRequest = z.output<typeof PublishVersionRequest>
export type SessionStatus = z.output<typeof SessionStatus>
export type Session = z.output<typeof Session>
export type AccountSessions = z.output<typeof AccountSessions>
export type OpenSessionRequest = z.output<typeof OpenSessionRequest>
export type OpenSessionCallRequest = z.output<typeof OpenSessionCallRequest>
export type Action = z.output<typeof Action>
export type TxFailure = z.output<typeof TxFailure>
