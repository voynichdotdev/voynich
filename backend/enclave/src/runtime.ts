#!/usr/bin/env node
import { createHash, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  Ed25519Program, Keypair, PublicKey, SystemProgram, SYSVAR_INSTRUCTIONS_PUBKEY,
  SYSVAR_SLOT_HASHES_PUBKEY, type Connection, type Signer, type TransactionInstruction,
} from '@solana/web3.js'
import { TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token'
import { z } from 'zod'
import type { InferenceSession } from 'onnxruntime-node'
import { Address, CONTRACT_VERSION, Manifest, RelayInputRequest, StopCallRequest, decodeManifest, errors, toBase58, type CallFailure, type CallPieces, type CallStreamDone, type StopCallAccepted, type StreamFinishReason, type StreamPiece } from '@voynich/contract'
import {
  CIPHER_CHUNK_BYTES, decryptCallInput, encryptCallOutput, encryptionPublicKey, fromBase64, fromHex,
  generateEncryptionKeyPair, merkleRootFromLeaves, openWeightsChunk, pieceMessage, receiptMessage, sha256, signPiece, signReceipt, signingPublicKey,
  streamInitialHash, streamNextHash, toBase64, toHex, unwrapKey, utf8, wrapKey, type WeightsCipherHeader,
} from 'voynich/crypto'
import { streamSSE } from 'hono/streaming'
import { applyOnnxAdapter } from 'voynich/adapter'
import { BN, addresses, chainPrograms, decodeAttestation, decodeCallAccount, decodeConfigAccount, decodeGrantAccount, decodePolicyAccount, decodeReceiptAccount, decodeWeightsHeader, eventAccounts, type DecodedPolicyAccount } from 'voynich/program'
import { defaultBaseCacheDir, fetchVerifiedBase, type BaseModelRef } from './base-cache.js'
import { EnclaveRateLimiter, isRegionAllowed, parseEnclaveRegion } from './policy.js'
import { loadTokenizer, type LoadedTokenizer } from './tokenizer.js'
import { createRpc, type RpcLog } from '../../src/engines/rpc/client.js'
import { buildUnsignedV0 } from '../../src/engines/tx/server/build.js'
import { loadLookupTables } from '../../src/engines/tx/server/lookup-tables.js'
import { TxSendError, sendSigned } from '../../src/engines/tx/server/send.js'
import { createApi } from '../../src/engines/server/app.js'
import { ApiFailure, failer, redact, type Fail } from '../../src/engines/server/errors.js'
import { readJson, readParam } from '../../src/engines/server/input.js'
import { serve } from '../../src/engines/server/serve.js'
import { EventHub, streamEvent } from '../../src/engines/server/sse.js'
import { readSealed, sealingKey, writeSealed } from './storage.js'

const fail: Fail<z.output<typeof errors.ErrorCode>> = failer(errors.status)
const bn = (value: bigint | number) => new BN(value.toString())
const logRpc = (entry: RpcLog) => console.error(JSON.stringify(entry))
const emptyAnswer = () => ({ status: 'waiting' as const, outputEnvelope: null, openAnswer: null, outputHash: null, signature: null, settleTransaction: null, receiptAddress: null, failure: null })
export type RuntimeAnswer = {
  status: 'waiting' | 'answered' | 'failed'
  outputEnvelope: string | null
  openAnswer: string | null
  outputHash: string | null
  signature: string | null
  settleTransaction: string | null
  receiptAddress: string | null
  failure: CallFailure | null
  baseSha256?: string | null
  finalCount?: number
  finishReason?: StreamFinishReason | null
}
export type ModelTiming = {
  grantLoadedAtMs: number
  openWeightsMs?: number
  openBaseMs?: number
  base?: BaseModelRef
  firstAnswerAtMs?: number
  grantToFirstAnswerMs?: number
}
export type EnclaveBaseStatus = BaseModelRef & { openBaseSeconds: number | null }
export function grantToFirstAnswerSecondsMap(timings?: Record<string, ModelTiming>): Record<string, number | null> {
  const result: Record<string, number | null> = {}
  for (const [model, timing] of Object.entries(timings ?? {})) {
    result[model] = timing.grantToFirstAnswerMs !== undefined ? Number((timing.grantToFirstAnswerMs / 1000).toFixed(3)) : null
  }
  return result
}
export function openWeightsSecondsMap(timings?: Record<string, ModelTiming>): Record<string, number | null> {
  const result: Record<string, number | null> = {}
  for (const [model, timing] of Object.entries(timings ?? {})) {
    result[model] = timing.openWeightsMs !== undefined ? Number((timing.openWeightsMs / 1000).toFixed(3)) : null
  }
  return result
}
export function basesMap(timings?: Record<string, ModelTiming>): Record<string, EnclaveBaseStatus> {
  const result: Record<string, EnclaveBaseStatus> = {}
  for (const [model, timing] of Object.entries(timings ?? {})) {
    if (!timing.base) continue
    result[model] = {
      ...timing.base,
      openBaseSeconds: timing.openBaseMs !== undefined ? Number((timing.openBaseMs / 1000).toFixed(3)) : null,
    }
  }
  return result
}
export const OPEN_RANGE_CHUNKS = 8
export const WEIGHTS_FETCH_CONCURRENCY = 6

export async function openModelWeights(params: {
  connection: Pick<Connection, 'getMultipleAccountsInfo' | 'getAccountInfo'>
  programId: PublicKey
  modelAddress: PublicKey
  weightsAddresses: PublicKey[]
  sizeBytes: number
  hashVersion: number
  expectedHashHex: string
  key: Uint8Array
  noncePrefix: Uint8Array
  rangeChunks?: number
  concurrency?: number
}): Promise<Uint8Array> {
  const {
    connection, programId, modelAddress, weightsAddresses, sizeBytes,
    hashVersion, expectedHashHex, key, noncePrefix,
  } = params
  if (!weightsAddresses.length || sizeBytes <= 16) throw new Error('A granted model has no valid weights accounts.')
  const rangeChunks = Math.max(1, params.rangeChunks ?? OPEN_RANGE_CHUNKS)
  const concurrency = Math.max(1, params.concurrency ?? WEIGHTS_FETCH_CONCURRENCY)

  // 1. Fetch all 56-byte Weights headers in one batched RPC call.
  const headerInfos = await connection.getMultipleAccountsInfo(weightsAddresses, { commitment: 'confirmed', dataSlice: { offset: 0, length: 56 } })
  const accounts: { pubkey: PublicKey; offset: number; sizeBytes: number }[] = []
  let cumulative = 0
  for (let index = 0; index < weightsAddresses.length; index++) {
    const info = headerInfos[index]
    if (!info || !info.owner.equals(programId)) throw new Error('A granted model weights account is missing or has the wrong owner.')
    const header = decodeWeightsHeader(info.data, { headerOnly: true })
    if (!header.model.equals(modelAddress) || header.index !== index || header.sizeBytes <= 0 || header.writtenBytes !== header.sizeBytes) {
      throw new Error('A granted model weights account has an invalid header.')
    }
    if (hashVersion >= 1 && header.globalOffset !== cumulative) {
      throw new Error('A granted model weights account has a non-contiguous offset.')
    }
    accounts.push({ pubkey: weightsAddresses[index]!, offset: cumulative, sizeBytes: header.sizeBytes })
    cumulative += header.sizeBytes
  }
  if (cumulative !== sizeBytes) throw new Error('A granted model ciphertext size does not match its weights accounts.')

  // 2. Preallocate the plaintext buffer and partition into 8-chunk (~512 KiB) ranges.
  const totalChunks = Math.ceil(sizeBytes / CIPHER_CHUNK_BYTES)
  const plaintextBytes = sizeBytes - totalChunks * 16
  if (plaintextBytes <= 0) throw new Error('A granted model plaintext length is invalid.')
  const plaintext = new Uint8Array(plaintextBytes)
  const cipherHeader: WeightsCipherHeader = { cipher: 'xchacha20poly1305-64k-v1', chunkBytes: 65536, noncePrefix, plaintextBytes }
  const ranges: { rangeIndex: number; startChunk: number; chunkCount: number }[] = []
  for (let startChunk = 0, rangeIndex = 0; startChunk < totalChunks; startChunk += rangeChunks, rangeIndex++) {
    ranges.push({ rangeIndex, startChunk, chunkCount: Math.min(rangeChunks, totalChunks - startChunk) })
  }

  // 3. Fetch ranges concurrently via dataSlice, splicing across Weights boundaries and decrypting chunks in place.
  const leafHashes: Uint8Array[] = hashVersion === 1 ? new Array<Uint8Array>(totalChunks) : []
  const v0Hasher = hashVersion === 0 ? createHash('sha256') : null
  const pendingV0 = new Map<number, Uint8Array>()
  let nextV0Range = 0
  let cursor = 0
  const worker = async () => {
    for (;;) {
      const item = ranges[cursor++]
      if (!item) return
      const rangeByteStart = item.startChunk * CIPHER_CHUNK_BYTES
      const rangeByteEnd = Math.min((item.startChunk + item.chunkCount) * CIPHER_CHUNK_BYTES, sizeBytes)
      const pieces: Uint8Array[] = []
      for (const acc of accounts) {
        const accEnd = acc.offset + acc.sizeBytes
        if (accEnd <= rangeByteStart || acc.offset >= rangeByteEnd) continue
        const sliceStart = Math.max(rangeByteStart, acc.offset)
        const sliceEnd = Math.min(rangeByteEnd, accEnd)
        const length = sliceEnd - sliceStart
        const sliceInfo = await connection.getAccountInfo(acc.pubkey, { commitment: 'confirmed', dataSlice: { offset: 56 + (sliceStart - acc.offset), length } })
        if (!sliceInfo || !sliceInfo.owner.equals(programId) || sliceInfo.data.length !== length) {
          throw new Error('A granted model weights range could not be read.')
        }
        pieces.push(sliceInfo.data)
      }
      const rangeCiphertext = pieces.length === 1 ? pieces[0]! : Buffer.concat(pieces)
      if (rangeCiphertext.length !== rangeByteEnd - rangeByteStart) {
        throw new Error('A granted model weights range length was incomplete.')
      }
      let localOffset = 0
      for (let i = 0; i < item.chunkCount; i++) {
        const chunkIndex = item.startChunk + i
        const chunkPlainLen = Math.min(65536, plaintextBytes - chunkIndex * 65536)
        const chunkCipherLen = chunkPlainLen + 16
        const chunkCipher = rangeCiphertext.subarray(localOffset, localOffset + chunkCipherLen)
        const opened = openWeightsChunk(chunkCipher, chunkIndex, key, cipherHeader)
        plaintext.set(opened.plaintext, chunkIndex * 65536)
        if (hashVersion === 1) leafHashes[chunkIndex] = opened.leafHash
        localOffset += chunkCipherLen
      }
      if (v0Hasher) {
        pendingV0.set(item.rangeIndex, rangeCiphertext)
        while (pendingV0.has(nextV0Range)) {
          v0Hasher.update(pendingV0.get(nextV0Range)!)
          pendingV0.delete(nextV0Range)
          nextV0Range++
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, ranges.length) }, () => worker()))

  // 4. Verify whole-model commitment (v1 Merkle root or v0 flat SHA-256) before returning plaintext.
  const computedHex = hashVersion === 1 ? toHex(merkleRootFromLeaves(leafHashes)) : v0Hasher!.digest('hex')
  if (computedHex !== expectedHashHex) {
    throw new Error('A granted model ciphertext hash does not match the sealed model.')
  }
  return plaintext
}
type Pending = { bytes: string; blockhash: string; lastValidBlockHeight: number; contextSlot: number; signature: string }
type SealedState = {
  version: 1
  signingSeed: string
  encryptionSecret: string
  chain: string | null
  grants: Record<string, { model: string; wrappedKey: string }>
  answers: Record<string, RuntimeAnswer>
  pieces?: Record<string, StreamPiece[]>
  stopTokens?: Record<string, string>
  inputHashes: Record<string, string>
  inputs: Record<string, string>
  pending: Record<string, Pending>
  modelTimings?: Record<string, ModelTiming>
}
export function loadedVersionsMap(loaded: ReadonlyMap<string, { version?: number }>): Record<string, number> {
  const result: Record<string, number> = {}
  for (const [model, entry] of loaded) {
    result[model] = entry.version ?? 1
  }
  return result
}

type LoadedModel = {
  key: Uint8Array
  manifest: z.output<typeof Manifest>
  session: InferenceSession
  baseSha256: Uint8Array | null
  tokenizer?: LoadedTokenizer
  version: number
  ciphertextSha256: string
}

export function measurement(): string {
  return createHash('sha384').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex')
}
function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required for the development enclave.`)
  return value
}
function keypair(name: string): Keypair {
  const defaults: Record<string, string> = { OPERATOR_KEYPAIR: '../dev/keys/operator.json', DEV_ATTESTATION_ROOT_KEYPAIR: '../dev/keys/attest-root.json' }
  const value = process.env[name] ?? (process.env.CLUSTER === 'localnet' ? defaults[name] : undefined) ?? required(name)
  const bytes = value.trim().startsWith('[') ? value : readFileSync(value, 'utf8')
  try { return Keypair.fromSecretKey(Uint8Array.from(z.array(z.int().min(0).max(255)).length(64).parse(JSON.parse(bytes)))) }
  catch { throw new Error(`${name} must contain a valid 64-byte Solana keypair.`) }
}
const optionalNumber = (name: string) => process.env[name] ? z.coerce.number().int().nonnegative().parse(process.env[name]) : undefined
const sleep = (ms: number, signal: AbortSignal) => new Promise<void>(resolveSleep => {
  if (signal.aborted) return resolveSleep()
  const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolveSleep() }
  const timer = setTimeout(finish, ms)
  signal.addEventListener('abort', finish, { once: true })
})

export function enclaveListenConfig(env: Record<string, string | undefined> = process.env): { port: number; host: string } {
  const rawPort = env.PORT?.trim() || env.ENCLAVE_PORT?.trim() || '9707'
  const port = z.coerce.number().int().min(1).max(65535).parse(rawPort)
  const host = env.ENCLAVE_HOST?.trim() || (env.PORT?.trim() ? '0.0.0.0' : '127.0.0.1')
  return { port, host }
}

function detectIntInputType(session: InferenceSession, name: string): 'int32' | 'int64' {
  const metadata = (session as unknown as { inputMetadata?: readonly { name?: string; type?: string }[] }).inputMetadata
  if (Array.isArray(metadata)) {
    const byName = metadata.find(item => item?.name === name)
    if (byName?.type === 'int32') return 'int32'
    const index = session.inputNames.indexOf(name)
    if (index >= 0 && metadata[index]?.type === 'int32') return 'int32'
  }
  return 'int64'
}

function makeIntTensor(ort: typeof import('onnxruntime-node'), dtype: 'int32' | 'int64', values: readonly number[]) {
  if (dtype === 'int32') {
    return new ort.Tensor('int32', Int32Array.from(values), [1, values.length])
  }
  return new ort.Tensor('int64', BigInt64Array.from(values, v => BigInt(v)), [1, values.length])
}

function encodeOpenTextAnswer(
  text: string,
  tokens: number,
  finishReason: 'eos' | 'length',
  budget: number,
): Uint8Array {
  const full = utf8(JSON.stringify({ text, tokens, finishReason }))
  if (full.length <= budget) return full
  const chars = [...text]
  let low = 0
  let high = chars.length
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    const candidate = utf8(JSON.stringify({ text: chars.slice(0, mid).join(''), tokens, finishReason }))
    if (candidate.length <= budget) low = mid
    else high = mid - 1
  }
  const bounded = utf8(JSON.stringify({ text: chars.slice(0, low).join(''), tokens, finishReason }))
  if (bounded.length > budget) throw new Error('The open text answer exceeds the configured maximum byte length.')
  return bounded
}

function scoresFromLogits(logits: readonly number[], labels: readonly string[]) {
  if (logits.length !== labels.length) throw new Error('The model output shape does not match its labels.')
  const maximum = Math.max(...logits)
  const exponentials = logits.map(value => Math.exp(value - maximum))
  const total = exponentials.reduce((sum, value) => sum + value, 0)
  return labels.map((label, index) => ({ label, probability: exponentials[index]! / total })).sort((left, right) => right.probability - left.probability).slice(0, 5)
}

export class EnclaveRuntime {
  readonly softwareMeasurement = measurement()
  readonly statePath = resolve(process.env.ENCLAVE_STATE_PATH ?? '.local/enclave.sealed.json')
  readonly baseCacheDir = defaultBaseCacheDir(this.statePath)
  readonly operator = keypair('OPERATOR_KEYPAIR')
  readonly sealing = sealingKey(process.env.DEV_SEALING_KEY, this.operator.secretKey)
  readonly developmentRoot = keypair('DEV_ATTESTATION_ROOT_KEYPAIR')
  readonly endpoint = process.env.ENCLAVE_ENDPOINT ?? `http://127.0.0.1:${enclaveListenConfig().port}`
  readonly region = parseEnclaveRegion(process.env.ENCLAVE_REGION)
  readonly rpc = createRpc({ url: required('SOLANA_RPC_URL'), service: 'voynich-enclave', rps: optionalNumber('ENCLAVE_RPC_RPS'), scanIntervalMs: optionalNumber('ENCLAVE_SCAN_INTERVAL_MS'), log: logRpc })
  readonly programs = chainPrograms(this.rpc.connection, {
    programId: process.env.PROGRAM_ID ? new PublicKey(process.env.PROGRAM_ID) : undefined,
    attestationProgramId: process.env.ATTESTATION_PROGRAM_ID ? new PublicKey(process.env.ATTESTATION_PROGRAM_ID) : undefined,
  })
  readonly pda = addresses(this.programs.voynich.programId, this.programs.attest.programId)
  readonly state: SealedState
  readonly signing: Keypair
  readonly encryptionSecret: Uint8Array
  readonly enclave: PublicKey
  readonly record: PublicKey
  readonly loaded = new Map<string, LoadedModel>()
  readonly inFlight = new Map<string, Promise<void>>()
  readonly pieceHub = new EventHub()
  readonly stopRequested = new Set<string>()
  readonly policyCache = new Map<string, { policy: DecodedPolicyAccount | null; fetchedAtMs: number }>()
  readonly rateLimiter = new EnclaveRateLimiter()
  private grantsLoading?: Promise<Awaited<ReturnType<EnclaveRuntime['loadGrants']>>>
  private initialScan = true
  private lastProgramSignature: string | null = null

  constructor() {
    this.state = readSealed<SealedState>(this.statePath, this.sealing) ?? {
      version: 1, signingSeed: toBase64(Keypair.generate().secretKey.slice(0, 32)),
      encryptionSecret: toBase64(generateEncryptionKeyPair().secretKey), chain: null,
      grants: {}, answers: {}, inputHashes: {}, inputs: {}, pending: {},
    }
    if (this.state.version !== 1) throw new Error('Unsupported enclave state version.')
    this.signing = Keypair.fromSeed(fromBase64(this.state.signingSeed))
    this.encryptionSecret = fromBase64(this.state.encryptionSecret)
    this.enclave = this.pda.enclave(this.signing.publicKey)
    this.record = this.pda.record(this.signing.publicKey)
    this.save()
  }
  save() { writeSealed(this.statePath, this.sealing, this.state) }

  /** Signed bytes are sealed to disk before their first broadcast and reused after a restart. */
  async execute(action: string, instructions: TransactionInstruction[], signers: Signer[] = []): Promise<string> {
    let pending = this.state.pending[action]
    if (!pending) {
      const unique = [...new Map([this.operator, ...signers].map(signer => [signer.publicKey.toBase58(), signer])).values()]
      const lookupTables = process.env.LOOKUP_TABLE ? await loadLookupTables(this.rpc.connection, [new PublicKey(process.env.LOOKUP_TABLE)]) : []
      const build = await buildUnsignedV0({ connection: this.rpc.connection, payer: this.operator.publicKey, instructions, cosigners: unique.filter(signer => !signer.publicKey.equals(this.operator.publicKey)).map(signer => signer.publicKey), walletSigned: false, lookupTables })
      build.transaction.sign(unique)
      pending = { bytes: toBase64(build.transaction.serialize()), blockhash: build.blockhash, lastValidBlockHeight: build.lastValidBlockHeight, contextSlot: build.contextSlot, signature: toBase58(build.transaction.signatures[0]!) }
      this.state.pending[action] = pending
      this.save()
    }
    try {
      const result = await sendSigned(this.rpc.connection, { ...pending, bytes: fromBase64(pending.bytes) })
      if (action.startsWith('settle:')) {
        const answer = this.state.answers[action.slice(7)]!
        answer.status = 'answered'; answer.settleTransaction = result.signature; answer.failure = null
      }
      delete this.state.pending[action]
      this.save()
      return result.signature
    } catch (error) {
      if (error instanceof TxSendError && (error.outcome === 'failed' || error.outcome === 'expired')) {
        delete this.state.pending[action]
        this.save()
      }
      throw error
    }
  }
  async probeCanBoot(): Promise<boolean> {
    const [voynich, config, attestConfig, operator] = await this.rpc.connection.getMultipleAccountsInfo(
      [this.programs.voynich.programId, this.pda.config, this.pda.attestConfig, this.operator.publicKey],
      'confirmed',
    )
    return Boolean(voynich?.executable && config && attestConfig && (operator?.lamports ?? 0) >= 5_000_000)
  }
  async boot() {
    const chain = `${await this.rpc.connection.getGenesisHash()}:${this.programs.voynich.programId}:${this.programs.attest.programId}`
    if (this.state.chain && this.state.chain !== chain) throw new Error('The sealed enclave state belongs to another chain. Choose a separate ENCLAVE_STATE_PATH.')
    this.state.chain = chain
    this.save()
    for (const action of Object.keys(this.state.pending)) await this.execute(action, [])
    const minimum = await this.rpc.connection.getMinimumBalanceForRentExemption(0)
    const balance = await this.rpc.connection.getBalance(this.signing.publicKey, 'confirmed')
    if (balance < minimum) await this.execute('fund-signing-key', [SystemProgram.transfer({ fromPubkey: this.operator.publicKey, toPubkey: this.signing.publicKey, lamports: minimum - balance })])
    await this.attestAndRegister()
  }
  async attestAndRegister() {
    const config = await this.programs.attest.account.attestConfig.fetch(this.pda.attestConfig)
    if (!config.devRoot.equals(this.developmentRoot.publicKey)) throw new Error('DEV_ATTESTATION_ROOT_KEYPAIR does not match the configured development root.')
    const current = await this.programs.attest.account.attestationRecord.fetchNullable(this.record)
    const now = BigInt(await this.rpc.connection.getSlot('confirmed'))
    const refreshMargin = BigInt(config.recordLifetimeSlots.toString()) / 3n
    if (!current || BigInt(current.expiresAtSlot.toString()) <= now + refreshMargin || toHex(Uint8Array.from(current.measurement)) !== this.softwareMeasurement) {
      const hashes = await this.rpc.connection.getAccountInfo(SYSVAR_SLOT_HASHES_PUBKEY, 'confirmed')
      if (!hashes || hashes.data.length < 48) throw new Error('The SlotHashes sysvar has no recent entry.')
      const recentSlot = hashes.data.readBigUInt64LE(8)
      if (current && recentSlot <= BigInt(current.reportSlot.toString())) throw new Error('A fresh slot is required to refresh the attestation report.')
      const hash = hashes.data.subarray(16, 48)
      const slotBytes = Buffer.alloc(8); slotBytes.writeBigUInt64LE(recentSlot)
      const message = Buffer.concat([Buffer.from('voynich/attestation/v1'), Buffer.from([1, 0]), this.signing.publicKey.toBuffer(), Buffer.from(this.softwareMeasurement, 'hex'), slotBytes, hash])
      const verify = Ed25519Program.createInstructionWithPrivateKey({ privateKey: this.developmentRoot.secretKey, message })
      const offset = verify.data.readUInt16LE(2)
      const signature = [...verify.data.subarray(offset, offset + 64)]
      const instruction = await this.programs.attest.methods.submitReport(1, 0, this.signing.publicKey, [...fromHex(this.softwareMeasurement)], bn(recentSlot), [...hash], signature, 2).accountsStrict({
        payer: this.operator.publicKey, config: this.pda.attestConfig, record: this.record,
        slotHashes: SYSVAR_SLOT_HASHES_PUBKEY, instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
        systemProgram: SystemProgram.programId, ...eventAccounts(this.programs.attest.programId),
      }).instruction()
      await this.execute(`attest:${recentSlot}`, [verify, instruction])
    }
    const enclave = await this.programs.voynich.account.enclave.fetchNullable(this.enclave)
    const record = await this.programs.attest.account.attestationRecord.fetch(this.record)
    if (!enclave) {
      const instruction = await this.programs.voynich.methods.registerEnclave([...encryptionPublicKey(this.encryptionSecret)], this.endpoint).accountsStrict({
        operator: this.operator.publicKey, signingKey: this.signing.publicKey, config: this.pda.config,
        attestationRecord: this.record, enclave: this.enclave, systemProgram: SystemProgram.programId,
        ...eventAccounts(this.programs.voynich.programId),
      }).instruction()
      await this.execute('register', [instruction], [this.signing])
    } else if (!enclave.operator.equals(this.operator.publicKey) || !Buffer.from(enclave.encryptionKey).equals(Buffer.from(encryptionPublicKey(this.encryptionSecret)))) {
      throw new Error('The on-chain enclave registration does not match its sealed keys and operator.')
    } else if (enclave.expiresAtSlot.toString() !== record.expiresAtSlot.toString() || enclave.endpoint !== this.endpoint || toHex(Uint8Array.from(enclave.measurement)) !== this.softwareMeasurement) {
      const instruction = await this.programs.voynich.methods.refreshEnclave(this.endpoint).accountsStrict({ signingKey: this.signing.publicKey, config: this.pda.config, attestationRecord: this.record, enclave: this.enclave, ...eventAccounts(this.programs.voynich.programId) }).instruction()
      await this.execute(`refresh:${record.expiresAtSlot}`, [instruction], [this.signing])
    }
  }
  async fetchModelPolicy(modelAddress: PublicKey, hasPolicyHint?: boolean, forceRefresh = false): Promise<DecodedPolicyAccount | null> {
    const key = modelAddress.toBase58()
    if (hasPolicyHint === false) {
      this.policyCache.set(key, { policy: null, fetchedAtMs: Date.now() })
      return null
    }
    const cached = this.policyCache.get(key)
    if (!forceRefresh && cached && Date.now() - cached.fetchedAtMs < 15_000) {
      return cached.policy
    }
    const info = await this.rpc.connection.getAccountInfo(this.pda.policy(modelAddress), 'confirmed')
    const policy = info && info.owner.equals(this.programs.voynich.programId) ? decodePolicyAccount(info.data) : null
    this.policyCache.set(key, { policy, fetchedAtMs: Date.now() })
    return policy
  }
  async loadGrants() {
    const grantDisc = toBase58(sha256(utf8('account:Grant')).subarray(0, 8))
    const rawGrants = await this.rpc.connection.getProgramAccounts(this.programs.voynich.programId, {
      commitment: 'confirmed',
      filters: [
        { memcmp: { offset: 0, bytes: grantDisc } },
        { memcmp: { offset: 40, bytes: this.enclave.toBase58() } },
      ],
    })
    const grants = rawGrants.map(({ pubkey, account }) => ({
      publicKey: pubkey,
      account: decodeGrantAccount(account.data),
    }))
    const active = new Set<string>()
    for (const { publicKey, account: grant } of grants) {
      if (grant.revoked) continue
      const modelAddress = grant.model.toBase58()
      const model = await this.programs.voynich.account.model.fetch(grant.model)
      if (!model.allowedMeasurements.some(value => toHex(Uint8Array.from(value)) === this.softwareMeasurement)) continue
      const hasPolicy = Boolean((model as { hasPolicy?: boolean }).hasPolicy)
      const policy = await this.fetchModelPolicy(grant.model, hasPolicy, true)
      if (!isRegionAllowed(policy, this.region)) {
        console.log(JSON.stringify({ event: 'model.skipped.policy_region', model: modelAddress, region: this.region, allowedRegions: policy?.allowedRegions ?? [] }))
        continue
      }
      active.add(modelAddress)
      const wrappedKey = toBase64(Uint8Array.from(grant.wrappedKey))
      const modelVersion = Math.max(1, Number((model as { currentVersion?: number }).currentVersion ?? 0))
      const ciphertextSha256 = toHex(Uint8Array.from(model.ciphertextSha256))
      const existingLoaded = this.loaded.get(modelAddress)
      if (
        existingLoaded
        && this.state.grants[publicKey.toBase58()]?.wrappedKey === wrappedKey
        && existingLoaded.version === modelVersion
        && existingLoaded.ciphertextSha256 === ciphertextSha256
      ) continue
      try {
        const key = unwrapKey(fromBase64(wrappedKey), this.encryptionSecret)
        const hashVersion = (model as { hashVersion?: number }).hashVersion ?? 0
        const rawBase = (model as { base?: { sha256: number[]; sizeBytes: { toString(): string }; format: string; source: string } | null }).base ?? null
        let baseRef: BaseModelRef | undefined
        let openBaseMs: number | undefined
        let baseBytes: Uint8Array | undefined
        if (rawBase) {
          if (rawBase.format !== 'onnx') throw new Error(`Unsupported base model format in enclave: ${rawBase.format}`)
          baseRef = {
            sha256: toHex(Uint8Array.from(rawBase.sha256)),
            sizeBytes: Number(rawBase.sizeBytes.toString()),
            format: rawBase.format,
            source: rawBase.source,
          }
          const fetchedBase = await fetchVerifiedBase(baseRef, { cacheDir: this.baseCacheDir })
          baseBytes = fetchedBase.bytes
          openBaseMs = fetchedBase.elapsedMs
        }
        const openStartedAtMs = Date.now()
        const openedWeights = await openModelWeights({
          connection: this.rpc.connection,
          programId: this.programs.voynich.programId,
          modelAddress: grant.model,
          weightsAddresses: model.weights,
          sizeBytes: Number(model.sizeBytes.toString()),
          hashVersion,
          expectedHashHex: ciphertextSha256,
          key,
          noncePrefix: Uint8Array.from(model.noncePrefix),
        })
        const openWeightsMs = Math.max(0, Date.now() - openStartedAtMs)
        const sessionBytes = baseRef && baseBytes
          ? applyOnnxAdapter(baseBytes, openedWeights, baseRef.sha256)
          : openedWeights
        const manifest = decodeManifest(Uint8Array.from(model.manifest))
        const tokenizer = manifest.inputKind === 'text' && manifest.tokenizer
          ? await loadTokenizer(manifest.tokenizer, { cacheDir: this.baseCacheDir })
          : undefined
        const ort = await import('onnxruntime-node')
        const session = await ort.InferenceSession.create(sessionBytes, { executionProviders: ['cpu'] })
        const previousLoaded = this.loaded.get(modelAddress)
        this.loaded.set(modelAddress, {
          key,
          manifest,
          session,
          baseSha256: baseRef ? fromHex(baseRef.sha256) : null,
          ...(tokenizer ? { tokenizer } : {}),
          version: modelVersion,
          ciphertextSha256,
        })
        if (previousLoaded && previousLoaded.session !== session) {
          const pending = [...this.inFlight.values()]
          void Promise.allSettled(pending).then(() => previousLoaded.session.release().catch(() => {}))
        }
        this.state.grants[publicKey.toBase58()] = { model: modelAddress, wrappedKey }
        this.state.modelTimings ??= {}
        const existingTiming = this.state.modelTimings[modelAddress]
        if (existingTiming) {
          existingTiming.openWeightsMs = openWeightsMs
          if (baseRef) { existingTiming.base = baseRef; existingTiming.openBaseMs = openBaseMs }
        } else {
          this.state.modelTimings[modelAddress] = {
            grantLoadedAtMs: Date.now(),
            openWeightsMs,
            ...(baseRef ? { base: baseRef, openBaseMs } : {}),
          }
        }
        this.save()
        console.log(JSON.stringify({
          event: previousLoaded ? 'model.reloaded' : 'model.loaded',
          model: modelAddress,
          name: manifest.name,
          version: modelVersion,
          ciphertextSha256,
          openWeightsMs,
          ...(openBaseMs !== undefined ? { openBaseMs } : {}),
        }))
      } catch (error) {
        console.error(JSON.stringify({
          event: 'model.load.failed',
          model: modelAddress,
          error: error instanceof Error ? error.name : 'Error',
          message: error instanceof Error ? redact(error.message) : 'Failed to load granted model.',
        }))
      }
    }
    for (const [address, loaded] of this.loaded) if (!active.has(address)) { await loaded.session.release(); this.loaded.delete(address) }
    return grants.filter(grant => !grant.account.revoked)
  }
  async grantNewEnclaves(grants: Awaited<ReturnType<EnclaveRuntime['loadGrants']>>) {
    const enclaves = await this.programs.voynich.account.enclave.all()
    const slot = BigInt(await this.rpc.connection.getSlot('confirmed'))
    for (const source of grants) {
      const loaded = this.loaded.get(source.account.model.toBase58())
      if (!loaded) continue
      const model = await this.programs.voynich.account.model.fetch(source.account.model)
      if (!('live' in model.status)) continue
      const hasPolicy = Boolean((model as { hasPolicy?: boolean }).hasPolicy)
      const policy = await this.fetchModelPolicy(source.account.model, hasPolicy)
      if (!isRegionAllowed(policy, this.region)) continue
      for (const target of enclaves) {
        if (target.publicKey.equals(this.enclave)) continue
        if (!model.allowedMeasurements.some(value => Buffer.from(value).equals(Buffer.from(target.account.measurement)))) continue
        if (policy && policy.allowedOperators.length > 0 && !policy.allowedOperators.some(op => op.equals(target.account.operator))) continue
        const info = await this.rpc.connection.getAccountInfo(target.account.attestationRecord, 'confirmed')
        if (!info || !info.owner.equals(this.programs.attest.programId)) continue
        const record = decodeAttestation(info.data)
        if (!record.signingKey.equals(target.account.signingKey) || record.expiresAtSlot <= slot || record.measurement !== toHex(Uint8Array.from(target.account.measurement))) continue
        const grant = this.pda.grant(source.account.model, target.publicKey)
        const existing = await this.programs.voynich.account.grant.fetchNullable(grant)
        if (existing) continue // An owner-revoked grant requires an owner to restore it.
        const wrapped = wrapKey(loaded.key, Uint8Array.from(target.account.encryptionKey))
        const policyRemaining = hasPolicy ? [{ pubkey: this.pda.policy(source.account.model), isWritable: false, isSigner: false }] : []
        const instruction = await this.programs.voynich.methods.grantByEnclave(Buffer.from(wrapped)).accountsStrict({
          signingKey: this.signing.publicKey, payer: this.operator.publicKey, config: this.pda.config,
          model: source.account.model, sourceEnclave: this.enclave, sourceGrant: source.publicKey,
          sourceAttestationRecord: this.record, targetEnclave: target.publicKey,
          targetAttestationRecord: target.account.attestationRecord, grant,
          systemProgram: SystemProgram.programId, ...eventAccounts(this.programs.voynich.programId),
        }).remainingAccounts(policyRemaining).instruction()
        await this.execute(`grant:${grant}`, [instruction], [this.signing])
      }
    }
  }
  ensureGrantsLoaded() {
    return (this.grantsLoading ??= this.loadGrants().finally(() => { this.grantsLoading = undefined }))
  }
  async sync() {
    await this.attestAndRegister()
    const [latest] = await this.rpc.connection.getSignaturesForAddress(this.programs.voynich.programId, { limit: 1 }, 'confirmed')
    const newest = latest?.signature ?? null
    if (this.initialScan || newest !== this.lastProgramSignature) {
      const grants = await this.ensureGrantsLoaded()
      await this.grantNewEnclaves(grants)
      this.lastProgramSignature = newest
      this.initialScan = false
    }
    for (const [id, answer] of Object.entries(this.state.answers)) {
      if (answer.status === 'waiting' && !this.inFlight.has(id)) this.startAnswer(new PublicKey(id), this.state.inputs[id]!)
    }
  }
  async fetchCall(address: PublicKey) {
    const info = await this.rpc.connection.getAccountInfo(address, 'confirmed')
    if (!info || !info.owner.equals(this.programs.voynich.programId)) return null
    return decodeCallAccount(info.data)
  }
  async acceptInput(address: PublicKey, envelope: string) {
    const call = await this.fetchCall(address)
    if (!call) fail('CALL_NOT_FOUND', 'This call was not found.')
    if (!call.enclave.equals(this.enclave)) fail('INVALID_ENVELOPE', 'This call names another enclave.', { stage: 'upload' })
    const hash = toHex(sha256(fromBase64(envelope)))
    const id = address.toBase58()
    if (this.state.inputHashes[id] === hash && (this.state.answers[id]?.status === 'answered' || this.inFlight.has(id) || this.state.pending[`settle:${address}`])) return
    if (!('open' in call.status)) fail('CALL_NOT_OPEN', 'This call is no longer open.', { stage: 'upload' })
    const currentSlot = BigInt(await this.rpc.connection.getSlot('confirmed'))
    if (BigInt(call.deadlineSlot.toString()) < currentSlot) fail('CALL_DEADLINE_PASSED', 'The settlement deadline has passed.', { stage: 'upload' })
    const loadedEntry = this.loaded.get(call.model.toBase58())
    if (!loadedEntry) {
      const wasRunning = Boolean(this.grantsLoading)
      await this.ensureGrantsLoaded()
      if (wasRunning && !this.loaded.has(call.model.toBase58())) await this.ensureGrantsLoaded()
      if (!this.loaded.has(call.model.toBase58())) fail('GRANT_REQUIRED', 'This enclave does not hold an active loaded grant for this model.', { stage: 'upload' })
    } else if (this.programs?.voynich?.account?.model?.fetch) {
      const onChainModel = await this.programs.voynich.account.model.fetch(call.model).catch(() => null)
      if (onChainModel) {
        const nextVersion = Math.max(1, Number((onChainModel as { currentVersion?: number }).currentVersion ?? 0))
        const nextHash = toHex(Uint8Array.from(onChainModel.ciphertextSha256))
        if (nextVersion !== loadedEntry.version || nextHash !== loadedEntry.ciphertextSha256) {
          await this.ensureGrantsLoaded()
        }
      }
    }
    const policy = await this.fetchModelPolicy(call.model)
    if (!isRegionAllowed(policy, this.region)) {
      throw new ApiFailure(403, { error: { code: 'PROGRAM_REFUSED', message: `This enclave region (${this.region ?? 'unset'}) is not allowed by the model policy.`, retryable: false, stage: 'upload' } })
    }
    if (policy && policy.maxCallsPerCallerPerWindow > 0 && BigInt(policy.windowSlots.toString()) > 0n) {
      const rateCheck = this.rateLimiter.checkAndRecord(
        call.model.toBase58(),
        call.caller.toBase58(),
        currentSlot,
        policy.maxCallsPerCallerPerWindow,
        BigInt(policy.windowSlots.toString()),
      )
      if (!rateCheck.allowed) {
        throw new ApiFailure(429, { error: { code: 'RATE_LIMITED', message: `Caller exceeded the model policy ceiling of ${rateCheck.limit} calls per ${rateCheck.windowSlots} slots.`, retryable: true, stage: 'upload' } })
      }
    }
    if (call.priceUnit === 'token') {
      const loaded = this.loaded.get(call.model.toBase58())!
      if (loaded.manifest.inputKind !== 'text' || (loaded.manifest.labels && loaded.manifest.labels.length > 0)) {
        fail('PROGRAM_REFUSED', 'Per-token streaming requires a generative text model.', { stage: 'upload' })
      }
      if (call.answerMode !== 'sealed') {
        fail('PROGRAM_REFUSED', 'Per-token streaming requires sealed answer mode.', { stage: 'upload' })
      }
      this.state.pieces ??= {}
      this.state.pieces[id] = []
      try {
        const peeked = JSON.parse(Buffer.from(decryptCallInput(fromBase64(envelope), this.encryptionSecret)).toString('utf8')) as { stopToken?: unknown }
        if (typeof peeked?.stopToken === 'string' && fromBase64(peeked.stopToken).length === 16) {
          this.state.stopTokens ??= {}
          this.state.stopTokens[id] = peeked.stopToken
        }
      } catch {
        // Malformed envelopes will be rejected normally inside answer().
      }
    }
    this.state.inputHashes[id] = hash
    this.state.inputs[id] = envelope
    this.state.answers[id] = emptyAnswer()
    this.save()
    this.startAnswer(address, envelope)
  }
  requestStop(address: PublicKey, stopToken: string): StopCallAccepted {
    const id = address.toBase58()
    const expected = this.state.stopTokens?.[id]
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
    const stored = this.state.answers[id]
    const pieces = this.state.pieces?.[id] ?? []
    const hasTerminal = pieces.length > 0 && pieces[pieces.length - 1]!.finishReason !== null
    if (stored?.status === 'answered' || stored?.status === 'failed' || hasTerminal) {
      return { call: id, status: 'already-finished' }
    }
    this.stopRequested.add(id)
    return { call: id, status: 'stopping' }
  }
  startAnswer(address: PublicKey, envelope: string) {
    const id = address.toBase58()
    const existing = this.state.answers[id]
    const readyToSettle = Boolean(
      existing?.outputEnvelope ||
      existing?.openAnswer ||
      (existing?.finalCount !== undefined && existing?.finishReason !== null && existing?.finishReason !== undefined),
    )
    const task = (readyToSettle ? this.settleStored(address) : this.answer(address, envelope)).catch(error => {
      const row = this.state.answers[id]!
      if (error instanceof TxSendError && ['unknown', 'timeout'].includes(error.outcome)) {
        row.settleTransaction = error.signature
      } else {
        row.status = 'failed'
        // The next answer read obtains the current refund state from chain.
        row.failure = { code: error instanceof ApiFailure ? error.body.error.code as CallFailure['code'] : 'PROGRAM_REFUSED', message: error instanceof ApiFailure ? error.message : 'The enclave could not complete this call.', refundState: 'pending-deadline' }
        const pieces = this.state.pieces?.[id] ?? []
        const last = pieces[pieces.length - 1]
        const donePayload: CallStreamDone = {
          call: id,
          status: 'failed',
          count: last?.count ?? 0,
          pieceCount: pieces.length,
          runningHash: last?.runningHash ?? null,
          signature: last?.signature ?? null,
          finishReason: last?.finishReason ?? null,
          receiptAddress: row.receiptAddress ?? null,
          settleTransaction: row.settleTransaction ?? null,
          failure: row.failure,
        }
        this.pieceHub.publish(streamEvent('call.stream.done', donePayload))
      }
      this.save()
      console.error(JSON.stringify({ event: 'call.failed', call: id, error: error instanceof Error ? error.name : 'Error' }))
    }).finally(() => this.inFlight.delete(id))
    this.inFlight.set(id, task)
  }
  async refundState(address: PublicKey): Promise<CallFailure['refundState']> {
    const call = await this.fetchCall(address)
    if (!call) return 'unavailable'
    if ('refunded' in call.status) return 'refunded'
    if ('settled' in call.status) return 'unavailable'
    return BigInt(await this.rpc.connection.getSlot('confirmed')) > BigInt(call.deadlineSlot.toString()) ? 'refundable' : 'pending-deadline'
  }
  async answer(address: PublicKey, envelope: string) {
    const call = await this.fetchCall(address)
    if (!call) fail('CALL_NOT_FOUND', 'This call was not found.')
    const record = await this.programs.attest.account.attestationRecord.fetch(this.record)
    if (BigInt(record.expiresAtSlot.toString()) <= BigInt(await this.rpc.connection.getSlot('confirmed'))) fail('ENCLAVE_EXPIRED', 'The enclave attestation expired before answering.', { stage: 'build' })
    const model = this.loaded.get(call.model.toBase58())
    if (!model) throw new Error('The granted model has not loaded yet.')
    const rawPayload = JSON.parse(Buffer.from(decryptCallInput(fromBase64(envelope), this.encryptionSecret)).toString('utf8')) as unknown
    if (call.priceUnit === 'token') {
      await this.answerMeteredStream(address, call, model, rawPayload)
      return
    }
    const outputKeySchema = call.answerMode === 'open'
      ? z.string().refine(value => fromBase64(value).length === 32).optional()
      : z.string().refine(value => fromBase64(value).length === 32)
    const ort = await import('onnxruntime-node')

    let scores: { label: string; probability: number }[] | null = null
    let textResult: { text: string; tokens: number; finishReason: 'eos' | 'length' } | null = null
    let outputPublicKey: string | undefined

    if (model.manifest.inputKind === 'text') {
      if (!model.tokenizer || !model.manifest.tokenizer) throw new Error('The text model tokenizer is not loaded.')
      const payload = z.strictObject({
        input: z.string(),
        maxTokens: z.int().min(1).max(4096).optional(),
        outputPublicKey: outputKeySchema,
      }).parse(rawPayload)
      outputPublicKey = payload.outputPublicKey
      const tokRef = model.manifest.tokenizer
      const inputName = model.manifest.inputName ?? (model.session.inputNames.includes('input_ids') ? 'input_ids' : model.session.inputNames[0]!)
      const outputName = model.manifest.outputName ?? (model.session.outputNames.includes('logits') ? 'logits' : model.session.outputNames[0]!)
      const inputDtype = detectIntInputType(model.session, inputName)
      const hasAttentionMask = model.session.inputNames.includes('attention_mask') && inputName !== 'attention_mask'
      const maskDtype = hasAttentionMask ? detectIntInputType(model.session, 'attention_mask') : 'int64'
      const hasTokenTypeIds = model.session.inputNames.includes('token_type_ids') && inputName !== 'token_type_ids'
      const typeDtype = hasTokenTypeIds ? detectIntInputType(model.session, 'token_type_ids') : 'int64'

      const buildFeeds = (ids: readonly number[]) => {
        const feeds: Record<string, import('onnxruntime-node').Tensor> = {
          [inputName]: makeIntTensor(ort, inputDtype, ids),
        }
        if (hasAttentionMask) feeds.attention_mask = makeIntTensor(ort, maskDtype, ids.map(() => 1))
        if (hasTokenTypeIds) feeds.token_type_ids = makeIntTensor(ort, typeDtype, ids.map(() => 0))
        return feeds
      }

      const encoded = model.tokenizer.encode(payload.input)
      const initialIds = encoded.length > 0 ? encoded : [tokRef.padTokenId ?? tokRef.bosTokenId ?? 0]

      if (model.manifest.labels && model.manifest.labels.length > 0) {
        const result = await model.session.run(buildFeeds(initialIds))
        const outTensor = result[outputName]!
        const flat = Array.from(outTensor.data as Float32Array)
        const numLabels = model.manifest.labels.length
        const logits = outTensor.dims.length === 3
          ? flat.slice(flat.length - numLabels)
          : flat
        scores = scoresFromLogits(logits, model.manifest.labels)
      } else {
        const limit = tokRef.maxOutputTokens ?? 256
        const maxNewTokens = Math.min(payload.maxTokens ?? tokRef.maxOutputTokens ?? 64, limit)
        const ids = [...initialIds]
        const generated: number[] = []
        let finishReason: 'eos' | 'length' = 'length'
        for (let step = 0; step < maxNewTokens; step++) {
          const window = ids.length > tokRef.maxInputTokens ? ids.slice(ids.length - tokRef.maxInputTokens) : ids
          const result = await model.session.run(buildFeeds(window))
          const outTensor = result[outputName]!
          const data = outTensor.data as Float32Array
          let offset = 0
          let vocab = data.length
          if (outTensor.dims.length === 3) {
            const seqLen = Number(outTensor.dims[1]!)
            vocab = Number(outTensor.dims[2]!)
            offset = (seqLen - 1) * vocab
          } else if (outTensor.dims.length === 2) {
            vocab = Number(outTensor.dims[1]!)
          } else {
            throw new Error(`Unexpected text logits rank ${outTensor.dims.length}.`)
          }
          let bestId = 0
          let bestVal = -Infinity
          for (let v = 0; v < vocab; v++) {
            const val = data[offset + v]!
            if (val > bestVal) { bestVal = val; bestId = v }
          }
          if (tokRef.eosTokenId !== undefined && bestId === tokRef.eosTokenId) {
            finishReason = 'eos'
            break
          }
          generated.push(bestId)
          ids.push(bestId)
        }
        textResult = {
          text: model.tokenizer.decode(generated),
          tokens: generated.length,
          finishReason,
        }
      }
    } else {
      const payload = z.strictObject({
        input: z.array(z.number().finite()),
        outputPublicKey: outputKeySchema,
      }).parse(rawPayload)
      outputPublicKey = payload.outputPublicKey
      const inputShape = model.manifest.inputShape!
      const labels = model.manifest.labels!
      const size = inputShape.reduce((product, value) => product * value, 1)
      z.array(z.number().finite()).length(size).parse(payload.input)
      if (model.manifest.inputKind === 'sketch') z.array(z.number().min(0).max(1)).parse(payload.input)
      const inputName = model.manifest.inputName ?? model.session.inputNames[0]!
      const outputName = model.manifest.outputName ?? model.session.outputNames[0]!
      const result = await model.session.run({ [inputName]: new ort.Tensor('float32', Float32Array.from(payload.input), inputShape) })
      const logits = Array.from(result[outputName]!.data as Float32Array)
      scores = scoresFromLogits(logits, labels)
    }

    const receipt = this.pda.receipt(address)
    const answer = this.state.answers[address.toBase58()]!
    if (call.answerMode === 'open') {
      const configInfo = await this.rpc.connection.getAccountInfo(this.pda.config, 'confirmed')
      const maxOpenBytes = configInfo ? decodeConfigAccount(configInfo.data).maxOpenAnswerBytes : 1024
      const token = !call.priceMint.equals(PublicKey.default)
      const hasCallback = !call.callbackProgram.equals(PublicKey.default)
      let openBytes: Uint8Array
      if (textResult) {
        const budget = Math.min(maxOpenBytes, !token && !hasCallback ? 400 : 280)
        openBytes = encodeOpenTextAnswer(textResult.text, textResult.tokens, textResult.finishReason, budget)
      } else {
        const top = scores![0]!
        const fullBytes = utf8(JSON.stringify({ label: top.label, probability: top.probability, scores }))
        const compactBytes = utf8(JSON.stringify({ label: top.label, probability: top.probability }))
        openBytes = !token && !hasCallback && fullBytes.length <= Math.min(maxOpenBytes, 400) ? fullBytes : compactBytes
      }
      if (openBytes.length === 0 || openBytes.length > maxOpenBytes) throw new Error('The open answer exceeds the configured maximum byte length.')
      const outputHash = sha256(openBytes)
      const signature = signReceipt(this.signing.secretKey.slice(0, 32), address.toBytes(), Uint8Array.from(call.inputHash), outputHash, model.baseSha256)
      Object.assign(answer, { outputEnvelope: null, openAnswer: toBase64(openBytes), outputHash: toHex(outputHash), signature: toBase64(signature), receiptAddress: receipt.toBase58(), baseSha256: model.baseSha256 ? toHex(model.baseSha256) : null })
    } else {
      const plaintextOutput = textResult
        ? utf8(JSON.stringify(textResult))
        : utf8(JSON.stringify({ label: scores![0]!.label, scores }))
      const output = encryptCallOutput(plaintextOutput, fromBase64(outputPublicKey!))
      const outputHash = sha256(output)
      const signature = signReceipt(this.signing.secretKey.slice(0, 32), address.toBytes(), Uint8Array.from(call.inputHash), outputHash, model.baseSha256)
      Object.assign(answer, { outputEnvelope: toBase64(output), openAnswer: null, outputHash: toHex(outputHash), signature: toBase64(signature), receiptAddress: receipt.toBase58(), baseSha256: model.baseSha256 ? toHex(model.baseSha256) : null })
    }
    this.save()
    await this.settleStored(address)
  }
  async answerMeteredStream(
    address: PublicKey,
    call: NonNullable<Awaited<ReturnType<EnclaveRuntime['fetchCall']>>>,
    model: LoadedModel,
    rawPayload: unknown,
  ) {
    if (model.manifest.inputKind !== 'text' || !model.tokenizer || !model.manifest.tokenizer || (model.manifest.labels && model.manifest.labels.length > 0)) {
      fail('PROGRAM_REFUSED', 'Per-token streaming requires a generative text model.', { stage: 'build' })
    }
    const payload = z.strictObject({
      input: z.string(),
      maxTokens: z.int().min(1).max(4096).optional(),
      outputPublicKey: z.string().refine(value => fromBase64(value).length === 32),
      stopToken: z.string().refine(value => fromBase64(value).length === 16).optional(),
    }).parse(rawPayload)
    const id = address.toBase58()
    if (payload.stopToken) {
      this.state.stopTokens ??= {}
      this.state.stopTokens[id] = payload.stopToken
      this.save()
    }
    const replyPublicKey = fromBase64(payload.outputPublicKey)
    const tokRef = model.manifest.tokenizer
    const maxOut = tokRef.maxOutputTokens ?? 256
    const unitPrice = BigInt(call.price.toString())
    const ceiling = BigInt(call.ceiling.toString())
    const ceilingTokens = unitPrice === 0n ? maxOut : Number(ceiling / unitPrice)
    const requestedCap = Math.min(payload.maxTokens ?? tokRef.maxOutputTokens ?? 64, maxOut)
    const effectiveMaxTokens = Math.max(0, Math.min(requestedCap, ceilingTokens))
    const cappedByCeiling = unitPrice > 0n && (payload.maxTokens === undefined ? ceilingTokens <= requestedCap : ceilingTokens < requestedCap)

    const ort = await import('onnxruntime-node')
    const inputName = model.manifest.inputName ?? (model.session.inputNames.includes('input_ids') ? 'input_ids' : model.session.inputNames[0]!)
    const outputName = model.manifest.outputName ?? (model.session.outputNames.includes('logits') ? 'logits' : model.session.outputNames[0]!)
    const inputDtype = detectIntInputType(model.session, inputName)
    const hasAttentionMask = model.session.inputNames.includes('attention_mask') && inputName !== 'attention_mask'
    const maskDtype = hasAttentionMask ? detectIntInputType(model.session, 'attention_mask') : 'int64'
    const hasTokenTypeIds = model.session.inputNames.includes('token_type_ids') && inputName !== 'token_type_ids'
    const typeDtype = hasTokenTypeIds ? detectIntInputType(model.session, 'token_type_ids') : 'int64'
    const buildFeeds = (ids: readonly number[]) => {
      const feeds: Record<string, import('onnxruntime-node').Tensor> = {
        [inputName]: makeIntTensor(ort, inputDtype, ids),
      }
      if (hasAttentionMask) feeds.attention_mask = makeIntTensor(ort, maskDtype, ids.map(() => 1))
      if (hasTokenTypeIds) feeds.token_type_ids = makeIntTensor(ort, typeDtype, ids.map(() => 0))
      return feeds
    }

    const encoded = model.tokenizer.encode(payload.input)
    const ids = encoded.length > 0 ? [...encoded] : [tokRef.padTokenId ?? tokRef.bosTokenId ?? 0]
    const callBytes = address.toBytes()
    const inputHashBytes = Uint8Array.from(call.inputHash)
    const seed = this.signing.secretKey.slice(0, 32)
    const answer = this.state.answers[id]!
    this.state.pieces ??= {}
    const pieceList: StreamPiece[] = []
    this.state.pieces[id] = pieceList

    let runningHash = streamInitialHash(callBytes, inputHashBytes)
    let totalCount = 0
    let pieceIndex = 0
    const strictUtf8 = new TextDecoder('utf-8', { fatal: true })
    const specials = new Set<number>([
      ...(tokRef.bosTokenId !== undefined ? [tokRef.bosTokenId] : []),
      ...(tokRef.eosTokenId !== undefined ? [tokRef.eosTokenId] : []),
      ...(tokRef.padTokenId !== undefined ? [tokRef.padTokenId] : []),
    ])

    const decodeReadyUtf8 = (pendingIds: readonly number[], force: boolean): string | null => {
      if (tokRef.format === 'byte-level') {
        const rawBytes: number[] = []
        for (const tokenId of pendingIds) {
          if (!specials.has(tokenId) && tokenId >= 0 && tokenId <= 255) rawBytes.push(tokenId)
        }
        try {
          return strictUtf8.decode(Uint8Array.from(rawBytes))
        } catch {
          if (force || pendingIds.length >= 4) return model.tokenizer!.decode(pendingIds)
          return null
        }
      }
      const decoded = model.tokenizer!.decode(pendingIds)
      if (!decoded.endsWith('\uFFFD') || force || pendingIds.length >= 4) return decoded
      return null
    }

    const emitPiece = async (text: string, deltaTokens: number, finishReason: StreamFinishReason | null) => {
      totalCount += deltaTokens
      const piecePayload = utf8(JSON.stringify({ index: pieceIndex, text, tokens: deltaTokens, finishReason }))
      const envelopeBytes = encryptCallOutput(piecePayload, replyPublicKey)
      const pieceHashBytes = sha256(envelopeBytes)
      runningHash = streamNextHash(runningHash, totalCount, envelopeBytes)
      const sigBytes = signPiece(seed, callBytes, inputHashBytes, totalCount, runningHash, model.baseSha256)
      const piece: StreamPiece = {
        call: id,
        index: pieceIndex,
        count: totalCount,
        deltaTokens,
        envelope: toBase64(envelopeBytes),
        pieceHash: toHex(pieceHashBytes),
        runningHash: toHex(runningHash),
        signature: toBase64(sigBytes),
        finishReason,
      }
      pieceIndex++
      pieceList.push(piece)
      Object.assign(answer, {
        outputEnvelope: null,
        openAnswer: null,
        outputHash: piece.runningHash,
        signature: piece.signature,
        finalCount: piece.count,
        finishReason: piece.finishReason,
        baseSha256: model.baseSha256 ? toHex(model.baseSha256) : null,
      })
      this.save()
      this.pieceHub.publish(streamEvent('call.piece', piece))
      await new Promise<void>(resolveYield => setImmediate(resolveYield))
      return piece
    }

    let pendingIds: number[] = []
    let terminalPiece: StreamPiece | null = null
    try {
      for (let step = 0; step < effectiveMaxTokens; step++) {
        if (this.stopRequested.has(id)) {
          const finalText = pendingIds.length > 0 ? (decodeReadyUtf8(pendingIds, true) ?? '') : ''
          terminalPiece = await emitPiece(finalText, pendingIds.length, 'stopped')
          pendingIds = []
          break
        }
        const window = ids.length > tokRef.maxInputTokens ? ids.slice(ids.length - tokRef.maxInputTokens) : ids
        const result = await model.session.run(buildFeeds(window))
        if (this.stopRequested.has(id)) {
          const finalText = pendingIds.length > 0 ? (decodeReadyUtf8(pendingIds, true) ?? '') : ''
          terminalPiece = await emitPiece(finalText, pendingIds.length, 'stopped')
          pendingIds = []
          break
        }
        const outTensor = result[outputName]!
        const data = outTensor.data as Float32Array
        let offset = 0
        let vocab = data.length
        if (outTensor.dims.length === 3) {
          const seqLen = Number(outTensor.dims[1]!)
          vocab = Number(outTensor.dims[2]!)
          offset = (seqLen - 1) * vocab
        } else if (outTensor.dims.length === 2) {
          vocab = Number(outTensor.dims[1]!)
        } else {
          throw new Error(`Unexpected text logits rank ${outTensor.dims.length}.`)
        }
        let bestId = 0
        let bestVal = -Infinity
        for (let v = 0; v < vocab; v++) {
          const val = data[offset + v]!
          if (val > bestVal) { bestVal = val; bestId = v }
        }
        if (tokRef.eosTokenId !== undefined && bestId === tokRef.eosTokenId) {
          const finalText = pendingIds.length > 0 ? (decodeReadyUtf8(pendingIds, true) ?? '') : ''
          terminalPiece = await emitPiece(finalText, pendingIds.length, 'eos')
          pendingIds = []
          break
        }
        pendingIds.push(bestId)
        ids.push(bestId)
        const isLastStep = step === effectiveMaxTokens - 1
        const readyText = decodeReadyUtf8(pendingIds, isLastStep)
        if (readyText !== null) {
          const reason: StreamFinishReason | null = isLastStep ? (cappedByCeiling ? 'ceiling' : 'length') : null
          const emitted = await emitPiece(readyText, pendingIds.length, reason)
          if (reason !== null) terminalPiece = emitted
          pendingIds = []
        }
      }
      if (!terminalPiece) {
        const finalText = pendingIds.length > 0 ? (decodeReadyUtf8(pendingIds, true) ?? '') : ''
        const finalReason: StreamFinishReason = this.stopRequested.has(id) ? 'stopped' : (cappedByCeiling ? 'ceiling' : 'length')
        terminalPiece = await emitPiece(finalText, pendingIds.length, finalReason)
      }
      answer.receiptAddress = this.pda.receipt(address).toBase58()
      this.save()
      await this.settleStored(address)
    } finally {
      this.stopRequested.delete(id)
    }
  }
  async settleStored(address: PublicKey) {
    const call = await this.fetchCall(address)
    if (!call) fail('CALL_NOT_FOUND', 'This call was not found.')
    const id = address.toBase58()
    const answer = this.state.answers[id]!
    const receipt = this.pda.receipt(address)
    const adoptExistingReceipt = async (): Promise<boolean> => {
      const receiptInfo = await this.rpc.connection.getAccountInfo(receipt, 'confirmed')
      if (!receiptInfo || !receiptInfo.owner.equals(this.programs.voynich.programId)) return false
      const decoded = decodeReceiptAccount(receiptInfo.data)
      answer.receiptAddress = receipt.toBase58()
      answer.outputHash = toHex(Uint8Array.from(decoded.outputHash))
      answer.signature = toBase64(Uint8Array.from(decoded.signature))
      if (decoded.deliveredCount !== null) answer.finalCount = Number(decoded.deliveredCount.toString())
      answer.status = 'answered'
      answer.failure = null
      delete this.state.pending[`settle:${address}`]
      this.save()
      if (call.priceUnit === 'token') {
        const pieces = this.state.pieces?.[id] ?? []
        const last = pieces[pieces.length - 1]
        const donePayload: CallStreamDone = {
          call: id,
          status: 'done',
          count: answer.finalCount ?? last?.count ?? 0,
          pieceCount: pieces.length,
          runningHash: answer.outputHash ?? last?.runningHash ?? null,
          signature: answer.signature ?? last?.signature ?? null,
          finishReason: answer.finishReason ?? last?.finishReason ?? 'stopped',
          receiptAddress: answer.receiptAddress,
          settleTransaction: answer.settleTransaction,
          failure: null,
        }
        this.pieceHub.publish(streamEvent('call.stream.done', donePayload))
      }
      return true
    }
    if (!('open' in call.status)) {
      if (await adoptExistingReceipt()) return
      fail('CALL_NOT_OPEN', 'This call is no longer open.', { stage: 'build' })
    }
    const outputHash = fromHex(answer.outputHash!)
    const signature = fromBase64(answer.signature!)
    const openAnswerBytes = answer.openAnswer ? Buffer.from(fromBase64(answer.openAnswer)) : Buffer.alloc(0)
    const baseSha256Bytes = answer.baseSha256
      ? fromHex(answer.baseSha256)
      : (this.loaded.get(call.model.toBase58())?.baseSha256 ?? null)
    const token = !call.priceMint.equals(PublicKey.default)
    const ata = (owner: PublicKey) => getAssociatedTokenAddressSync(call.priceMint, owner, true)
    const prepare = token ? [...new Map([call.owner, call.operator, call.feeRecipient, call.caller].map(owner => [owner.toBase58(), owner])).values()].map(owner => createAssociatedTokenAccountIdempotentInstruction(this.operator.publicKey, ata(owner), owner, call.priceMint)) : []
    const callbackRemaining = !call.callbackProgram.equals(PublicKey.default)
      ? [
          { pubkey: call.callbackProgram, isWritable: false, isSigner: false },
          ...call.callbackAccounts.map(account => ({ pubkey: account.pubkey, isWritable: account.isWritable, isSigner: false })),
        ]
      : []
    const accounts = {
      payer: this.operator.publicKey, config: this.pda.config, model: call.model, enclave: this.enclave,
      attestationRecord: this.record, call: address, receipt, caller: call.caller, owner: call.owner,
      operator: call.operator, feeRecipient: call.feeRecipient, instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      escrowTokens: token ? ata(address) : null, ownerTokens: token ? ata(call.owner) : null,
      operatorTokens: token ? ata(call.operator) : null, protocolTokens: token ? ata(call.feeRecipient) : null,
      callerTokens: token ? ata(call.caller) : null, tokenProgram: token ? TOKEN_PROGRAM_ID : null,
      systemProgram: SystemProgram.programId, ...eventAccounts(this.programs.voynich.programId),
    }
    let verify: TransactionInstruction
    let settle: TransactionInstruction
    if (call.priceUnit === 'token') {
      const count = answer.finalCount ?? 0
      verify = Ed25519Program.createInstructionWithPublicKey({
        publicKey: this.signing.publicKey.toBytes(),
        message: pieceMessage(address.toBytes(), Uint8Array.from(call.inputHash), count, outputHash, baseSha256Bytes),
        signature,
      })
      settle = await this.programs.voynich.methods
        .settleMeteredCall(new BN(count), [...outputHash], [...signature], 2 + prepare.length)
        .accountsStrict(accounts)
        .remainingAccounts(callbackRemaining)
        .instruction()
    } else {
      verify = Ed25519Program.createInstructionWithPublicKey({
        publicKey: this.signing.publicKey.toBytes(),
        message: receiptMessage(address.toBytes(), Uint8Array.from(call.inputHash), outputHash, baseSha256Bytes),
        signature,
      })
      settle = await this.programs.voynich.methods
        .settleCall([...outputHash], [...signature], 2 + prepare.length, openAnswerBytes)
        .accountsStrict(accounts)
        .remainingAccounts(callbackRemaining)
        .instruction()
    }
    answer.receiptAddress = receipt.toBase58()
    try {
      answer.settleTransaction = await this.execute(`settle:${address}`, [...prepare, verify, settle])
    } catch (error) {
      if (await adoptExistingReceipt()) return
      throw error
    }
    answer.status = 'answered'
    answer.failure = null
    const modelAddress = call.model.toBase58()
    const timing = this.state.modelTimings?.[modelAddress]
    if (timing && timing.firstAnswerAtMs === undefined) {
      const settledAtMs = Date.now()
      timing.firstAnswerAtMs = settledAtMs
      timing.grantToFirstAnswerMs = Math.max(0, settledAtMs - timing.grantLoadedAtMs)
    }
    this.save()
    if (call.priceUnit === 'token') {
      const pieces = this.state.pieces?.[id] ?? []
      const last = pieces[pieces.length - 1]
      const donePayload: CallStreamDone = {
        call: id,
        status: 'done',
        count: answer.finalCount ?? last?.count ?? 0,
        pieceCount: pieces.length,
        runningHash: answer.outputHash ?? last?.runningHash ?? null,
        signature: answer.signature ?? last?.signature ?? null,
        finishReason: answer.finishReason ?? last?.finishReason ?? null,
        receiptAddress: answer.receiptAddress,
        settleTransaction: answer.settleTransaction,
        failure: null,
      }
      this.pieceHub.publish(streamEvent('call.stream.done', donePayload))
    }
  }
  async getAnswer(address: PublicKey): Promise<RuntimeAnswer> {
    const stored = { ...emptyAnswer(), ...(this.state.answers[address.toBase58()] ?? {}) }
    const { baseSha256: _omitBaseSha256, finalCount: _omitFinalCount, finishReason: _omitFinishReason, ...answer } = stored
    if (answer.failure) answer.failure.refundState = await this.refundState(address)
    return answer
  }
  async getPieces(address: PublicKey): Promise<CallPieces> {
    const id = address.toBase58()
    const pieces = [...(this.state.pieces?.[id] ?? [])]
    const stored = this.state.answers[id]
    if (stored?.status === 'failed') {
      const failure = stored.failure ? { ...stored.failure, refundState: await this.refundState(address) } : null
      return { call: id, status: 'failed', pieces, failure }
    }
    if (stored?.status === 'answered') {
      return { call: id, status: 'done', pieces, failure: null }
    }
    if (pieces.length > 0 || this.inFlight.has(id)) {
      return { call: id, status: 'streaming', pieces, failure: null }
    }
    return { call: id, status: 'waiting', pieces, failure: null }
  }
}

function loadEnvironment() {
  try { process.loadEnvFile() } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  for (const [name, value] of Object.entries(process.env)) if (value?.trim() === '') delete process.env[name]
}
export async function registerFromEnv(): Promise<void> { loadEnvironment(); const runtime = new EnclaveRuntime(); await runtime.boot(); console.log(JSON.stringify({ enclave: runtime.enclave.toBase58(), signingKey: runtime.signing.publicKey.toBase58(), measurement: runtime.softwareMeasurement })) }
export async function statusFromEnv() {
  loadEnvironment()
  const statePath = resolve(process.env.ENCLAVE_STATE_PATH ?? '.local/enclave.sealed.json')
  const softwareMeasurement = measurement()
  const region = parseEnclaveRegion(process.env.ENCLAVE_REGION)
  if (!existsSync(statePath)) return { enclave: null, signingKey: null, measurement: softwareMeasurement, region, registered: false, expiresAtSlot: null, openWeightsSeconds: {} as Record<string, number | null>, grantToFirstAnswerSeconds: {} as Record<string, number | null>, bases: {} as Record<string, EnclaveBaseStatus> }
  const sealKey = sealingKey(process.env.DEV_SEALING_KEY, process.env.DEV_SEALING_KEY ? undefined : keypair('OPERATOR_KEYPAIR').secretKey)
  const state = readSealed<SealedState>(statePath, sealKey)!
  if (state.version !== 1) throw new Error('Unsupported enclave state version.')
  const signing = new PublicKey(signingPublicKey(fromBase64(state.signingSeed)))
  const rpc = createRpc({ url: required('SOLANA_RPC_URL'), service: 'voynich-enclave-status', rps: optionalNumber('ENCLAVE_RPC_RPS'), scanIntervalMs: optionalNumber('ENCLAVE_SCAN_INTERVAL_MS'), log: logRpc })
  const programs = chainPrograms(rpc.connection, { programId: process.env.PROGRAM_ID, attestationProgramId: process.env.ATTESTATION_PROGRAM_ID })
  const chain = `${await rpc.connection.getGenesisHash()}:${programs.voynich.programId}:${programs.attest.programId}`
  if (state.chain && state.chain !== chain) throw new Error('The sealed enclave state belongs to another chain. Choose a separate ENCLAVE_STATE_PATH.')
  const address = addresses(programs.voynich.programId, programs.attest.programId).enclave(signing)
  const enclave = await programs.voynich.account.enclave.fetchNullable(address)
  return { enclave: address.toBase58(), signingKey: signing.toBase58(), measurement: softwareMeasurement, region, registered: !!enclave, expiresAtSlot: enclave?.expiresAtSlot.toString() ?? null, openWeightsSeconds: openWeightsSecondsMap(state.modelTimings), grantToFirstAnswerSeconds: grantToFirstAnswerSecondsMap(state.modelTimings), bases: basesMap(state.modelTimings) }
}
export type EnclaveAppRuntime = Pick<EnclaveRuntime, 'enclave' | 'softwareMeasurement' | 'loaded' | 'acceptInput' | 'getAnswer'> & {
  region?: string | null
  state?: Pick<SealedState, 'modelTimings'>
  getPieces?: EnclaveRuntime['getPieces']
  requestStop?: EnclaveRuntime['requestStop']
  pieceHub?: EnclaveRuntime['pieceHub']
}

export function createEnclaveApp(runtime: EnclaveAppRuntime, isReady: () => boolean) {
  const app = createApi({ origins: [], contractVersion: CONTRACT_VERSION })
  const requireReady = () => {
    if (!isReady()) {
      fail('UPSTREAM_UNAVAILABLE', 'The enclave runtime is waiting for program initialization and operator funding.', { retryable: true })
    }
  }
  app.get('/health', c => c.json({
    status: isReady() ? 'ready' : 'waiting',
    enclave: runtime.enclave.toBase58(),
    measurement: runtime.softwareMeasurement,
    region: runtime.region ?? null,
    models: [...runtime.loaded.keys()],
    versions: loadedVersionsMap(runtime.loaded),
    openWeightsSeconds: openWeightsSecondsMap(runtime.state?.modelTimings),
    grantToFirstAnswerSeconds: grantToFirstAnswerSecondsMap(runtime.state?.modelTimings),
    bases: basesMap(runtime.state?.modelTimings),
  }))
  app.post('/v1/calls/:call/input', async c => {
    requireReady()
    const address = new PublicKey(readParam(c, 'call', Address))
    const body = await readJson(c, RelayInputRequest)
    await runtime.acceptInput(address, body.envelope)
    return c.json({ call: address.toBase58(), status: 'accepted' })
  })
  app.get('/v1/calls/:call/answer', async c => {
    requireReady()
    return c.json(await runtime.getAnswer(new PublicKey(readParam(c, 'call', Address))))
  })
  app.get('/v1/calls/:call/pieces', async c => {
    requireReady()
    const address = new PublicKey(readParam(c, 'call', Address))
    if (!runtime.getPieces) return c.json({ call: address.toBase58(), status: 'waiting', pieces: [], failure: null })
    return c.json(await runtime.getPieces(address))
  })
  app.post('/v1/calls/:call/stop', async c => {
    requireReady()
    const address = new PublicKey(readParam(c, 'call', Address))
    const body = await readJson(c, StopCallRequest)
    if (!runtime.requestStop) {
      throw new ApiFailure(403, { error: { code: 'UNAUTHORIZED', message: 'The stop token is missing or does not match this call.', retryable: false, stage: 'auth' } })
    }
    return c.json(await runtime.requestStop(address, body.stopToken))
  })
  app.get('/v1/calls/:call/stream', async c => {
    requireReady()
    const address = new PublicKey(readParam(c, 'call', Address))
    const callId = address.toBase58()
    const afterRaw = c.req.query('after')
    const after = afterRaw !== undefined && /^-?\d+$/.test(afterRaw) ? Math.max(-1, Number(afterRaw)) : -1
    c.header('Cache-Control', 'no-cache')
    c.header('X-Accel-Buffering', 'no')
    return streamSSE(c, async (stream) => {
      const queue: { type: string; id: string; timestamp: string; data: unknown }[] = []
      let wake: (() => void) | null = null
      let closed = false
      const off = runtime.pieceHub ? runtime.pieceHub.subscribe((event) => {
        const data = event.data as { call?: string }
        if (data?.call !== callId) return
        if (event.type !== 'call.piece' && event.type !== 'call.stream.done') return
        queue.push(event)
        wake?.()
      }) : () => {}
      stream.onAbort(() => {
        closed = true
        off()
        wake?.()
      })
      const send = (event: { type: string; id: string; timestamp: string; data: unknown }) =>
        stream.writeSSE({ event: event.type, id: event.id, data: JSON.stringify(event) })
      try {
        const snapshot = runtime.getPieces ? await runtime.getPieces(address) : { call: callId, status: 'waiting' as const, pieces: [], failure: null }
        let lastSentIndex = after
        for (const piece of snapshot.pieces) {
          if (closed) return
          if (piece.index <= lastSentIndex) continue
          await send(streamEvent('call.piece', piece))
          lastSentIndex = piece.index
        }
        if (snapshot.status === 'done' || snapshot.status === 'failed') {
          const last = snapshot.pieces[snapshot.pieces.length - 1]
          const ans = await runtime.getAnswer(address)
          const donePayload: CallStreamDone = {
            call: callId,
            status: snapshot.status,
            count: last?.count ?? 0,
            pieceCount: snapshot.pieces.length,
            runningHash: last?.runningHash ?? null,
            signature: last?.signature ?? null,
            finishReason: last?.finishReason ?? null,
            receiptAddress: ans.receiptAddress ?? null,
            settleTransaction: ans.settleTransaction ?? null,
            failure: snapshot.failure,
          }
          await send(streamEvent('call.stream.done', donePayload))
          return
        }
        while (!closed) {
          if (queue.length > 0) {
            const next = queue.shift()!
            if (next.type === 'call.piece') {
              const piece = next.data as StreamPiece
              if (piece.index <= lastSentIndex) continue
              await send(next)
              lastSentIndex = piece.index
            } else if (next.type === 'call.stream.done') {
              await send(next)
              return
            }
            continue
          }
          const idle = await new Promise<boolean>((resolveIdle) => {
            const timer = setTimeout(() => resolveIdle(true), 15_000)
            wake = () => {
              clearTimeout(timer)
              resolveIdle(false)
            }
          })
          wake = null
          if (idle && !closed) await stream.write(': keepalive\n\n')
        }
      } finally {
        closed = true
        off()
      }
    })
  })
  return app
}

export async function runFromEnv(): Promise<void> {
  loadEnvironment()
  const runtime = new EnclaveRuntime()
  const sync = async () => {
    try { await runtime.sync() }
    catch (error) { console.error(JSON.stringify({ event: 'enclave.sync.failed', error: error instanceof Error ? error.name : 'Error', message: error instanceof Error ? redact(error.message) : 'The enclave sync failed.' })) }
  }
  let ready = false
  const controller = new AbortController()
  const app = createEnclaveApp(runtime, () => ready)
  const waitPollMs = optionalNumber('ENCLAVE_WAIT_POLL_MS') ?? 60_000
  const readyPollMs = optionalNumber('ENCLAVE_POLL_MS') ?? 5_000
  const loop = (async () => {
    while (!controller.signal.aborted) {
      if (!ready) {
        try {
          if (await runtime.probeCanBoot()) {
            await runtime.boot()
            await sync()
            ready = true
            continue
          }
        } catch (error) {
          console.error(JSON.stringify({ event: 'enclave.boot.failed', error: error instanceof Error ? error.name : 'Error', message: error instanceof Error ? redact(error.message) : 'The enclave boot check failed.' }))
        }
        await sleep(waitPollMs, controller.signal)
        continue
      }
      await sleep(readyPollMs, controller.signal)
      if (!controller.signal.aborted) await sync()
    }
  })()
  const listen = enclaveListenConfig()
  const server = serve(app, { port: listen.port, host: listen.host, close: async () => { controller.abort(); await loop; await Promise.all(runtime.inFlight.values()); for (const model of runtime.loaded.values()) await model.session.release() } })
  try { await loop } catch (error) { controller.abort(); await server.shutdown(); throw error }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  if (process.argv.includes('--measurement')) console.log(measurement())
  else await runFromEnv()
}
