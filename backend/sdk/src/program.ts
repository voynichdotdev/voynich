import { Program } from '@coral-xyz/anchor'
import type { Program as AnchorProgram } from '@coral-xyz/anchor'
import BN from 'bn.js'
import { PublicKey, SystemProgram, TransactionMessage, VersionedTransaction, type Connection } from '@solana/web3.js'
import { Buffer } from 'buffer'
import { ModelBaseSchema, type ModelBase } from '@voynich/contract'
import { IDL as VOYNICH_IDL, type Voynich } from './generated/voynich.js'
import { IDL as ATTEST_IDL, type Attest } from './generated/attest.js'
import { IDL as BOUNTY_IDL, type Bounty } from './generated/bounty.js'
import { fromHex, sha256, toHex, utf8 } from './crypto.js'

// Anchor 0.31's Borsh coder reads Buffer globally, including in a browser bundle.
globalThis.Buffer ??= Buffer
export { BN }
export type { Voynich, Attest, Bounty }
export const PROGRAM_ID = new PublicKey(VOYNICH_IDL.address)
export const ATTESTATION_PROGRAM_ID = new PublicKey(ATTEST_IDL.address)
export const BOUNTY_PROGRAM_ID = new PublicKey(BOUNTY_IDL.address)
type Key = PublicKey | string
const key = (value: Key) => typeof value === 'string' ? new PublicKey(value) : value
export const pda = (programId: PublicKey, ...seeds: Uint8Array[]): PublicKey => PublicKey.findProgramAddressSync(seeds.map(seed => Buffer.from(seed)), programId)[0]
export const eventAccounts = (program: PublicKey) => ({ eventAuthority: pda(program, utf8('__event_authority')), program })
export function bountyAddresses(bountyProgramId: Key = BOUNTY_PROGRAM_ID) {
  const id = key(bountyProgramId)
  return {
    bounty: (creator: Key, nonce: bigint) => { const bytes = new Uint8Array(8); new DataView(bytes.buffer).setBigUint64(0, nonce, true); return pda(id, utf8('bounty'), key(creator).toBytes(), bytes) },
    caller: (bounty: Key) => pda(id, utf8('caller'), key(bounty).toBytes()),
    attempt: (bounty: Key, call: Key) => pda(id, utf8('attempt'), key(bounty).toBytes(), key(call).toBytes()),
  }
}
export function bountyProgram(connection: Connection, bountyProgramId: Key = BOUNTY_PROGRAM_ID): AnchorProgram<Bounty> {
  return new Program<Bounty>({ ...BOUNTY_IDL, address: key(bountyProgramId).toBase58() } as Bounty, { connection })
}
export function measurementPda(digest: Uint8Array | string, programId: Key = PROGRAM_ID): PublicKey {
  const bytes = typeof digest === 'string' ? fromHex(digest) : digest
  if (bytes.length !== 48) throw new Error('Measurement digest must be 48 bytes (96 hex characters)')
  return pda(key(programId), utf8('measurement'), bytes.subarray(0, 32), bytes.subarray(32, 48))
}
export function policyPda(model: Key, programId: Key = PROGRAM_ID): PublicKey {
  return pda(key(programId), utf8('policy'), key(model).toBytes())
}
export function grantPda(model: Key, enclave: Key, programId: Key = PROGRAM_ID): PublicKey {
  return pda(key(programId), utf8('grant'), key(model).toBytes(), key(enclave).toBytes())
}
export function modelVersionPda(model: Key, version: number, programId: Key = PROGRAM_ID): PublicKey {
  if (!Number.isSafeInteger(version) || version < 1 || version > 0xffffffff) {
    throw new Error('Model version must be a u32 >= 1')
  }
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, version, true)
  return pda(key(programId), utf8('version'), key(model).toBytes(), bytes)
}
export function sessionPda(caller: Key, delegate: Key, nonce: bigint | number | string, programId: Key = PROGRAM_ID): PublicKey {
  const bytes = new Uint8Array(8)
  new DataView(bytes.buffer).setBigUint64(0, BigInt(nonce), true)
  return pda(key(programId), utf8('session'), key(caller).toBytes(), key(delegate).toBytes(), bytes)
}
export function splitPda(model: Key, programId: Key = PROGRAM_ID): PublicKey {
  return pda(key(programId), utf8('split'), key(model).toBytes())
}
export function addresses(programId = PROGRAM_ID, attestationProgramId = ATTESTATION_PROGRAM_ID) {
  return {
    config: pda(programId, utf8('config')),
    attestConfig: pda(attestationProgramId, utf8('config')),
    model: (name: string) => pda(programId, utf8('model'), utf8(name)),
    enclave: (signing: Key) => pda(programId, utf8('enclave'), key(signing).toBytes()),
    grant: (model: Key, enclave: Key) => pda(programId, utf8('grant'), key(model).toBytes(), key(enclave).toBytes()),
    call: (caller: Key, nonce: bigint) => { const bytes = new Uint8Array(8); new DataView(bytes.buffer).setBigUint64(0, nonce, true); return pda(programId, utf8('call'), key(caller).toBytes(), bytes) },
    receipt: (call: Key) => pda(programId, utf8('receipt'), key(call).toBytes()),
    measurement: (digest: Uint8Array | string) => measurementPda(digest, programId),
    policy: (model: Key) => policyPda(model, programId),
    modelVersion: (model: Key, version: number) => modelVersionPda(model, version, programId),
    session: (caller: Key, delegate: Key, nonce: bigint | number | string) => sessionPda(caller, delegate, nonce, programId),
    split: (model: Key) => splitPda(model, programId),
    record: (signing: Key) => pda(attestationProgramId, utf8('record'), key(signing).toBytes()),
  }
}
export function chainPrograms(connection: Connection, ids: { programId?: Key; attestationProgramId?: Key } = {}): { voynich: AnchorProgram<Voynich>; attest: AnchorProgram<Attest> } {
  const provider = { connection }
  return {
    voynich: new Program<Voynich>({ ...VOYNICH_IDL, address: key(ids.programId ?? PROGRAM_ID).toBase58() } as Voynich, provider),
    attest: new Program<Attest>({ ...ATTEST_IDL, address: key(ids.attestationProgramId ?? ATTESTATION_PROGRAM_ID).toBase58() } as Attest, provider),
  }
}
export function decodeAttestation(data: Uint8Array) {
  const discriminator = [33, 137, 13, 193, 39, 232, 216, 63]
  if (data.length !== 114 || discriminator.some((byte, index) => data[index] !== byte) || data[8] !== 1 || data[41]! > 2) throw new Error('Unsupported attestation record layout')
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  return { layoutVersion: data[8]!, signingKey: new PublicKey(data.subarray(9, 41)), hardwareType: (['dev', 'tdx', 'sev-snp'] as const)[data[41]!]!, measurement: toHex(data.subarray(42, 90)), recordedSlot: view.getBigUint64(90, true), expiresAtSlot: view.getBigUint64(98, true), reportSlot: view.getBigUint64(106, true) }
}

/** Weights use a raw header and are intentionally absent from Anchor's account coder. */
export function decodeWeightsHeader(data: Uint8Array, options: { headerOnly?: boolean } = {}) {
  const discriminator = sha256(utf8('account:Weights')).subarray(0, 8)
  if (data.length < 56 || discriminator.some((byte, index) => data[index] !== byte)) throw new Error('Invalid Weights account header')
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const sizeBytes = view.getUint32(44, true), writtenBytes = view.getUint32(48, true), globalOffset = view.getUint32(52, true)
  const validLength = options.headerOnly ? data.length === 56 : data.length === 56 + sizeBytes
  if (!validLength || writtenBytes > sizeBytes) throw new Error('Invalid Weights account size')
  return { model: new PublicKey(data.subarray(8, 40)), index: view.getUint32(40, true), sizeBytes, writtenBytes, globalOffset }
}

export const CONFIG_LEGACY_SPACE = 116
export const CONFIG_SPACE = 118
export const CALL_LEGACY_SPACE = 302
export const CALL_STEP1_SPACE = 303
export const CALL_STEP2_SPACE = 304
export const CALL_STEP6_SPACE = 340
export const CALL_SPACE = 349
export const MAX_CALLBACK_ACCOUNTS = 8
export const RECEIPT_LEGACY_SPACE = 401
export const RECEIPT_METERED_EXTENSION = 16
export const RECEIPT_METERED_SPACE = 423
export const MEASUREMENT_SPACE = 366
export const POLICY_SPACE = 1770
export const GRANT_BASE_SPACE = 223
export const GRANT_SPACE = 226
export const MODEL_VERSION_SPACE = 8192
export const SESSION_SPACE = 186
export const SPLIT_SPACE = 526
export const DEFAULT_MAX_OPEN_ANSWER_BYTES = 1024

const matchesDisc = (data: Uint8Array, label: string) => {
  const disc = sha256(utf8(label)).subarray(0, 8)
  return data.length >= 8 && disc.every((byte, index) => data[index] === byte)
}

export type DecodedConfigAccount = {
  admin: PublicKey
  attestationProgram: PublicKey
  recordLayoutVersion: number
  feeRecipient: PublicKey
  protocolShareBps: number
  callDeadlineSlots: BN
  bump: number
  maxOpenAnswerBytes: number
  legacy: boolean
}

export function decodeConfigAccount(data: Uint8Array): DecodedConfigAccount {
  if (!matchesDisc(data, 'account:Config') || (data.length !== CONFIG_LEGACY_SPACE && data.length !== CONFIG_SPACE)) {
    throw new Error('Invalid Config account data')
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const legacy = data.length === CONFIG_LEGACY_SPACE
  return {
    admin: new PublicKey(data.subarray(8, 40)),
    attestationProgram: new PublicKey(data.subarray(40, 72)),
    recordLayoutVersion: data[72]!,
    feeRecipient: new PublicKey(data.subarray(73, 105)),
    protocolShareBps: view.getUint16(105, true),
    callDeadlineSlots: new BN(view.getBigUint64(107, true).toString()),
    bump: data[115]!,
    maxOpenAnswerBytes: legacy ? DEFAULT_MAX_OPEN_ANSWER_BYTES : view.getUint16(116, true),
    legacy,
  }
}

export type CallbackAccount = {
  pubkey: PublicKey
  isWritable: boolean
}

export type DecodedCallAccount = {
  caller: PublicKey
  model: PublicKey
  enclave: PublicKey
  nonce: BN
  inputHash: number[]
  price: BN
  priceMint: PublicKey
  owner: PublicKey
  operator: PublicKey
  feeRecipient: PublicKey
  operatorShareBps: number
  protocolShareBps: number
  openedSlot: BN
  deadlineSlot: BN
  status: { open: Record<string, never> } | { settled: Record<string, never> } | { refunded: Record<string, never> }
  bump: number
  answerMode: 'sealed' | 'open'
  callerIsProgram: boolean
  callbackProgram: PublicKey
  callbackAccounts: CallbackAccount[]
  priceUnit: 'call' | 'token'
  ceiling: BN
  legacy: boolean
}

export function decodeCallAccount(data: Uint8Array): DecodedCallAccount {
  const validFixed = data.length === CALL_LEGACY_SPACE || data.length === CALL_STEP1_SPACE || data.length === CALL_STEP2_SPACE
  if (!matchesDisc(data, 'account:Call') || (!validFixed && data.length < CALL_STEP6_SPACE)) {
    throw new Error('Invalid Call account data')
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const price = new BN(view.getBigUint64(144, true).toString())
  const statusByte = data[300]!
  const status = statusByte === 0 ? { open: {} } : statusByte === 1 ? { settled: {} } : statusByte === 2 ? { refunded: {} } : (() => { throw new Error('Invalid Call status') })()
  const legacy = data.length === CALL_LEGACY_SPACE
  let answerMode: 'sealed' | 'open' = 'sealed'
  let callerIsProgram = false
  let callbackProgram = PublicKey.default
  const callbackAccounts: CallbackAccount[] = []
  let priceUnit: 'call' | 'token' = 'call'
  let ceiling: BN = price
  if (data.length >= CALL_STEP1_SPACE) {
    if (data[302] === 0) answerMode = 'sealed'
    else if (data[302] === 1) answerMode = 'open'
    else throw new Error('Invalid Call answer mode')
  }
  if (data.length >= CALL_STEP2_SPACE) {
    if (data[303] === 0) callerIsProgram = false
    else if (data[303] === 1) callerIsProgram = true
    else throw new Error('Invalid Call callerIsProgram flag')
  }
  if (data.length >= CALL_STEP6_SPACE) {
    callbackProgram = new PublicKey(data.subarray(304, 336))
    const count = view.getUint32(336, true)
    const callbackEnd = CALL_STEP6_SPACE + count * 33
    if (count > MAX_CALLBACK_ACCOUNTS || (data.length !== callbackEnd && data.length !== callbackEnd + 9)) {
      throw new Error('Invalid Call callbackAccounts length')
    }
    for (let index = 0; index < count; index++) {
      const offset = CALL_STEP6_SPACE + index * 33
      const writableByte = data[offset + 32]!
      if (writableByte !== 0 && writableByte !== 1) throw new Error('Invalid Call callbackAccount writable flag')
      callbackAccounts.push({
        pubkey: new PublicKey(data.subarray(offset, offset + 32)),
        isWritable: writableByte === 1,
      })
    }
    if (data.length === callbackEnd + 9) {
      if (data[callbackEnd] === 0) priceUnit = 'call'
      else if (data[callbackEnd] === 1) priceUnit = 'token'
      else throw new Error('Invalid Call priceUnit')
      ceiling = new BN(view.getBigUint64(callbackEnd + 1, true).toString())
    }
  }
  return {
    caller: new PublicKey(data.subarray(8, 40)),
    model: new PublicKey(data.subarray(40, 72)),
    enclave: new PublicKey(data.subarray(72, 104)),
    nonce: new BN(view.getBigUint64(104, true).toString()),
    inputHash: Array.from(data.subarray(112, 144)),
    price,
    priceMint: new PublicKey(data.subarray(152, 184)),
    owner: new PublicKey(data.subarray(184, 216)),
    operator: new PublicKey(data.subarray(216, 248)),
    feeRecipient: new PublicKey(data.subarray(248, 280)),
    operatorShareBps: view.getUint16(280, true),
    protocolShareBps: view.getUint16(282, true),
    openedSlot: new BN(view.getBigUint64(284, true).toString()),
    deadlineSlot: new BN(view.getBigUint64(292, true).toString()),
    status,
    bump: data[301]!,
    answerMode,
    callerIsProgram,
    callbackProgram,
    callbackAccounts,
    priceUnit,
    ceiling,
    legacy,
  }
}

export type DecodedReceiptAccount = {
  call: PublicKey
  model: PublicKey
  enclave: PublicKey
  inputHash: number[]
  outputHash: number[]
  signature: number[]
  slot: BN
  priceMint: PublicKey
  total: BN
  owner: PublicKey
  operator: PublicKey
  feeRecipient: PublicKey
  ownerAmount: BN
  operatorAmount: BN
  protocolAmount: BN
  bump: number
  answerMode: 'sealed' | 'open'
  openAnswer: Uint8Array
  callerIsProgram: boolean
  deliveredCount: BN | null
  returnedAmount: BN | null
  legacy: boolean
}

export function decodeReceiptAccount(data: Uint8Array): DecodedReceiptAccount {
  if (!matchesDisc(data, 'account:Receipt') || (data.length !== RECEIPT_LEGACY_SPACE && data.length < RECEIPT_LEGACY_SPACE + 5)) {
    throw new Error('Invalid Receipt account data')
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const legacy = data.length === RECEIPT_LEGACY_SPACE
  let answerMode: 'sealed' | 'open' = 'sealed'
  let openAnswer: Uint8Array = new Uint8Array(0)
  let callerIsProgram = false
  let deliveredCount: BN | null = null
  let returnedAmount: BN | null = null
  if (!legacy) {
    if (data[401] === 0) answerMode = 'sealed'
    else if (data[401] === 1) answerMode = 'open'
    else throw new Error('Invalid Receipt answer mode')
    const len = view.getUint32(402, true)
    const step1Len = 406 + len
    const step2Len = step1Len + 1
    const meteredLen = step2Len + RECEIPT_METERED_EXTENSION
    if (data.length !== step1Len && data.length !== step2Len && data.length !== meteredLen) {
      throw new Error('Invalid Receipt openAnswer length')
    }
    openAnswer = data.subarray(406, step1Len)
    if (data.length === step2Len || data.length === meteredLen) {
      if (data[step1Len] === 0) callerIsProgram = false
      else if (data[step1Len] === 1) callerIsProgram = true
      else throw new Error('Invalid Receipt callerIsProgram flag')
    }
    if (data.length === meteredLen) {
      deliveredCount = new BN(view.getBigUint64(step2Len, true).toString())
      returnedAmount = new BN(view.getBigUint64(step2Len + 8, true).toString())
    }
  }
  return {
    call: new PublicKey(data.subarray(8, 40)),
    model: new PublicKey(data.subarray(40, 72)),
    enclave: new PublicKey(data.subarray(72, 104)),
    inputHash: Array.from(data.subarray(104, 136)),
    outputHash: Array.from(data.subarray(136, 168)),
    signature: Array.from(data.subarray(168, 232)),
    slot: new BN(view.getBigUint64(232, true).toString()),
    priceMint: new PublicKey(data.subarray(240, 272)),
    total: new BN(view.getBigUint64(272, true).toString()),
    owner: new PublicKey(data.subarray(280, 312)),
    operator: new PublicKey(data.subarray(312, 344)),
    feeRecipient: new PublicKey(data.subarray(344, 376)),
    ownerAmount: new BN(view.getBigUint64(376, true).toString()),
    operatorAmount: new BN(view.getBigUint64(384, true).toString()),
    protocolAmount: new BN(view.getBigUint64(392, true).toString()),
    bump: data[400]!,
    answerMode,
    openAnswer,
    callerIsProgram,
    deliveredCount,
    returnedAmount,
    legacy,
  }
}

export type DecodedMeasurementAccount = {
  digest: string
  publisher: PublicKey
  sourceRepo: string
  commitSha: string
  recipeHash: string
  version: string
  createdSlot: BN
  status: 'active' | 'deprecated'
  bump: number
}

export function decodeMeasurementAccount(data: Uint8Array): DecodedMeasurementAccount {
  if (!matchesDisc(data, 'account:Measurement') || data.length < 8 + 48 + 32 + 4 + 4 + 32 + 4 + 8 + 1 + 1) {
    throw new Error('Invalid Measurement account data')
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const decoder = new TextDecoder()
  let offset = 8
  const digest = toHex(data.subarray(offset, offset + 48)); offset += 48
  const publisher = new PublicKey(data.subarray(offset, offset + 32)); offset += 32
  const readStr = (maxLen: number) => {
    if (offset + 4 > data.length) throw new Error('Invalid Measurement string length')
    const len = view.getUint32(offset, true); offset += 4
    if (len > maxLen || offset + len > data.length) throw new Error('Invalid Measurement string bounds')
    const value = decoder.decode(data.subarray(offset, offset + len)); offset += len
    return value
  }
  const sourceRepo = readStr(128)
  const commitSha = readStr(64)
  if (offset + 32 > data.length) throw new Error('Invalid Measurement recipeHash bounds')
  const recipeHash = toHex(data.subarray(offset, offset + 32)); offset += 32
  const version = readStr(32)
  if (offset + 10 > data.length) throw new Error('Invalid Measurement tail bounds')
  const createdSlot = new BN(view.getBigUint64(offset, true).toString()); offset += 8
  const statusTag = data[offset++]!
  if (statusTag !== 0 && statusTag !== 1) throw new Error('Invalid Measurement status')
  const status: 'active' | 'deprecated' = statusTag === 0 ? 'active' : 'deprecated'
  const bump = data[offset++]!
  return { digest, publisher, sourceRepo, commitSha, recipeHash, version, createdSlot, status, bump }
}

export type DecodedPolicyAccount = {
  model: PublicKey
  allowListEnabled: boolean
  allowedCallers: PublicKey[]
  maxCallsPerCallerPerWindow: number
  windowSlots: BN
  allowedOperators: PublicKey[]
  allowedRegions: string[]
  updatedSlot: BN
  bump: number
}

export function decodePolicyAccount(data: Uint8Array): DecodedPolicyAccount {
  if (!matchesDisc(data, 'account:Policy') || data.length < 8 + 32 + 1 + 4 + 4 + 8 + 4 + 4 + 8 + 1) {
    throw new Error('Invalid Policy account data')
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const decoder = new TextDecoder()
  let offset = 8
  const model = new PublicKey(data.subarray(offset, offset + 32)); offset += 32
  const allowTag = data[offset++]!
  if (allowTag !== 0 && allowTag !== 1) throw new Error('Invalid Policy allowListEnabled flag')
  const allowListEnabled = allowTag === 1
  const readKeys = (maxCount: number) => {
    if (offset + 4 > data.length) throw new Error('Invalid Policy key vector length')
    const count = view.getUint32(offset, true); offset += 4
    if (count > maxCount || offset + count * 32 > data.length) throw new Error('Invalid Policy key vector bounds')
    const keys: PublicKey[] = []
    for (let i = 0; i < count; i++) {
      keys.push(new PublicKey(data.subarray(offset, offset + 32)))
      offset += 32
    }
    return keys
  }
  const allowedCallers = readKeys(32)
  if (offset + 12 > data.length) throw new Error('Invalid Policy rate fields')
  const maxCallsPerCallerPerWindow = view.getUint32(offset, true); offset += 4
  const windowSlots = new BN(view.getBigUint64(offset, true).toString()); offset += 8
  const allowedOperators = readKeys(16)
  if (offset + 4 > data.length) throw new Error('Invalid Policy regions length')
  const regionCount = view.getUint32(offset, true); offset += 4
  if (regionCount > 8) throw new Error('Invalid Policy regions count')
  const allowedRegions: string[] = []
  for (let i = 0; i < regionCount; i++) {
    if (offset + 4 > data.length) throw new Error('Invalid Policy region string length')
    const len = view.getUint32(offset, true); offset += 4
    if (len > 16 || offset + len > data.length) throw new Error('Invalid Policy region string bounds')
    allowedRegions.push(decoder.decode(data.subarray(offset, offset + len)))
    offset += len
  }
  if (offset + 9 > data.length) throw new Error('Invalid Policy tail bounds')
  const updatedSlot = new BN(view.getBigUint64(offset, true).toString()); offset += 8
  const bump = data[offset++]!
  return { model, allowListEnabled, allowedCallers, maxCallsPerCallerPerWindow, windowSlots, allowedOperators, allowedRegions, updatedSlot, bump }
}

/** Pads legacy and earlier-step mainnet CPI events with default trailing fields so the current IDL decodes them. */
export function normalizeLegacyVoynichEvent(bytes: Uint8Array): Uint8Array {
  if (bytes.length === 115 && matchesDisc(bytes, 'event:ConfigChanged')) {
    const out = new Uint8Array(117)
    out.set(bytes)
    new DataView(out.buffer).setUint16(115, DEFAULT_MAX_OPEN_ANSWER_BYTES, true)
    return out
  }
  if (matchesDisc(bytes, 'event:ModelCreated')) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    let cursor = 8 + 32 + 32
    const readLen = () => {
      if (cursor + 4 > bytes.length) return -1
      const len = view.getUint32(cursor, true)
      cursor += 4
      return len
    }
    const nameLen = readLen()
    if (nameLen >= 0) {
      cursor += nameLen
      const manifestLen = readLen()
      if (manifestLen >= 0) {
        cursor += manifestLen
        const weightsLen = readLen()
        if (weightsLen >= 0) {
          cursor += weightsLen * 32 + 8
          const cipherLen = readLen()
          if (cipherLen >= 0) {
            cursor += cipherLen + 16
            const measLen = readLen()
            if (measLen >= 0) {
              cursor += measLen * 48 + 8 + 32 + 2
              const uploadKeyOffset = cursor
              cursor += 32 + 8
              if (cursor === bytes.length) {
                // Era 0 (pre-Step-3): append upload_keys=[uploadKey] (36B), hash_version=0 (1B), base=None (1B), price_unit=Call (1B).
                const out = new Uint8Array(bytes.length + 4 + 32 + 1 + 1 + 1)
                out.set(bytes)
                new DataView(out.buffer).setUint32(bytes.length, 1, true)
                out.set(bytes.subarray(uploadKeyOffset, uploadKeyOffset + 32), bytes.length + 4)
                return out
              }
              const uploadKeysLen = readLen()
              if (uploadKeysLen >= 0) {
                cursor += uploadKeysLen * 32
                if (cursor === bytes.length) {
                  // Era 1 (Build 2 Step 3): append hash_version=0 (1B), base=None (1B), price_unit=Call (1B).
                  const out = new Uint8Array(bytes.length + 3)
                  out.set(bytes)
                  return out
                }
                if (cursor + 1 === bytes.length) {
                  // Era 2 (Build 2 Steps 4-6): append base=None (1B), price_unit=Call (1B).
                  const out = new Uint8Array(bytes.length + 2)
                  out.set(bytes)
                  return out
                }
                if (cursor + 2 <= bytes.length) {
                  cursor += 1 // hash_version
                  const baseTag = bytes[cursor++]
                  let validBase = false
                  if (baseTag === 0) {
                    validBase = true
                  } else if (baseTag === 1 && cursor + 40 <= bytes.length) {
                    cursor += 32 + 8 // sha256 + size_bytes
                    const formatLen = readLen()
                    if (formatLen >= 0 && cursor + formatLen <= bytes.length) {
                      cursor += formatLen
                      const sourceLen = readLen()
                      if (sourceLen >= 0 && cursor + sourceLen <= bytes.length) {
                        cursor += sourceLen
                        validBase = true
                      }
                    }
                  }
                  if (validBase && cursor === bytes.length) {
                    // Era 3 (Build 3 Steps 1-6): append price_unit=Call (1B).
                    const out = new Uint8Array(bytes.length + 1)
                    out.set(bytes)
                    return out
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  if (bytes.length === 80 && matchesDisc(bytes, 'event:ModelSealed')) {
    const out = new Uint8Array(81)
    out.set(bytes)
    // Legacy ModelSealed (80B): append base_sha256 = None (0).
    return out
  }
  if (bytes.length === 82 && matchesDisc(bytes, 'event:ModelPriceChanged')) {
    const out = new Uint8Array(83)
    out.set(bytes)
    // Legacy ModelPriceChanged (82B): append price_unit = Call (0).
    return out
  }
  if (matchesDisc(bytes, 'event:CallOpened')) {
    if (bytes.length === 332 || bytes.length === 333 || bytes.length === 334) {
      const out = new Uint8Array(379)
      out.set(bytes)
      // Legacy (332), Step 1 (333), Step 2 (334): trailing fields default to Sealed / false / Pubkey::default / [] / Call / ceiling=price.
      out.set(bytes.subarray(176, 184), 371)
      return out
    }
    if (bytes.length >= 370) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      const count = view.getUint32(366, true)
      if (count <= MAX_CALLBACK_ACCOUNTS && bytes.length === 370 + count * 33) {
        const out = new Uint8Array(bytes.length + 9)
        out.set(bytes)
        // Build 1 Step 6 (370 + 33*K): append price_unit = Call (0) and ceiling = price.
        out.set(bytes.subarray(176, 184), bytes.length + 1)
        return out
      }
    }
  }
  if (matchesDisc(bytes, 'event:CallSettled')) {
    if (bytes.length === 432) {
      const out = new Uint8Array(440)
      out.set(bytes)
      // Legacy (432): answer_mode = Sealed (0), open_answer = [], caller_is_program = false (0), delivered_count = None (0), returned_amount = None (0).
      return out
    }
    if (bytes.length >= 437) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      const openLen = view.getUint32(433, true)
      if (bytes.length === 437 + openLen) {
        const out = new Uint8Array(440 + openLen)
        out.set(bytes)
        // Step 1 (437 + N): appends caller_is_program = false (0), delivered_count = None (0), returned_amount = None (0).
        return out
      }
      if (bytes.length === 438 + openLen) {
        const out = new Uint8Array(440 + openLen)
        out.set(bytes)
        // Step 2 (438 + N): appends delivered_count = None (0), returned_amount = None (0).
        return out
      }
    }
  }
  return bytes
}

const utf8Decoder = new TextDecoder('utf-8', { fatal: true })

/**
 * Decodes the trailing Option<ModelBase> from raw on-chain Model account bytes without Anchor
 * or Node-only dependencies, handling both legacy 6,000-byte accounts (returns null) and
 * current 8,192-byte accounts with or without a base model.
 */
export function decodeModelBaseBytes(data: Uint8Array): ModelBase | null {
  if (!matchesDisc(data, 'account:Model') || data.length < 8 + 32) {
    throw new Error('Invalid Model account data')
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let offset = 8
  const need = (n: number) => {
    if (offset + n > data.length) throw new Error('Truncated Model account data')
  }
  const skip = (n: number) => { need(n); offset += n }
  const readU32 = () => { need(4); const v = view.getUint32(offset, true); offset += 4; return v }
  const readU64Number = () => {
    need(8)
    const v = view.getBigUint64(offset, true)
    offset += 8
    const n = Number(v)
    if (!Number.isSafeInteger(n)) throw new Error('Model base sizeBytes exceeds safe integer range')
    return n
  }
  const readString = () => {
    const len = readU32()
    need(len)
    const text = utf8Decoder.decode(data.subarray(offset, offset + len))
    offset += len
    return text
  }

  skip(32) // owner
  skip(readU32()) // name
  skip(readU32()) // manifest
  skip(readU32() * 32) // weights
  skip(8) // size_bytes
  skip(readU32()) // cipher
  skip(16) // nonce_prefix
  skip(32) // ciphertext_sha256
  skip(readU32() * 48) // allowed_measurements
  skip(8) // price
  skip(32) // price_mint
  skip(2) // operator_share_bps
  skip(32) // upload_key
  skip(1) // status
  skip(8) // created_slot
  skip(8) // sealed_slot
  skip(8) // calls_settled
  skip(1) // bump

  // Trailing fields appended after legacy layout; zero-padded or absent on 6,000-byte accounts.
  if (offset + 4 > data.length) return null
  skip(readU32() * 32) // upload_keys
  if (offset + 1 + 4 + 4 > data.length) return null
  skip(1) // hash_version
  skip(4) // sealed_chunks
  skip(readU32() * 32) // merkle_frontier
  if (offset + 4 + 1 > data.length) return null
  skip(4) // merkle_frontier_mask

  const tag = data[offset++]!
  if (tag === 0) return null
  if (tag !== 1) throw new Error(`Invalid Model base option tag: ${tag}`)
  need(32)
  const sha256Hex = toHex(data.subarray(offset, offset + 32))
  offset += 32
  const sizeBytes = readU64Number()
  const format = readString()
  const source = readString()
  return ModelBaseSchema.parse({ sha256: sha256Hex, sizeBytes, format, source })
}

export type DecodedGrantAccount = {
  model: PublicKey
  enclave: PublicKey
  wrappedKey: Uint8Array
  grantedBy: PublicKey
  grantedSlot: BN
  revoked: boolean
  bump: number
  quotedOperatorShareBps: number | null
  legacy: boolean
}

export function decodeGrantAccount(data: Uint8Array): DecodedGrantAccount {
  if (!matchesDisc(data, 'account:Grant') || data.length < GRANT_BASE_SPACE) {
    throw new Error('Invalid Grant account data')
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let offset = 8
  const model = new PublicKey(data.subarray(offset, offset + 32)); offset += 32
  const enclave = new PublicKey(data.subarray(offset, offset + 32)); offset += 32
  const wrappedLen = view.getUint32(offset, true); offset += 4
  if (offset + wrappedLen + 32 + 8 + 1 + 1 > data.length) throw new Error('Truncated Grant account data')
  const wrappedKey = new Uint8Array(data.subarray(offset, offset + wrappedLen)); offset += wrappedLen
  const grantedBy = new PublicKey(data.subarray(offset, offset + 32)); offset += 32
  const grantedSlot = new BN(view.getBigUint64(offset, true).toString()); offset += 8
  const revokedByte = data[offset++]!
  if (revokedByte !== 0 && revokedByte !== 1) throw new Error(`Invalid Grant revoked bool: ${revokedByte}`)
  const revoked = revokedByte === 1
  const bump = data[offset++]!
  let quotedOperatorShareBps: number | null = null
  const legacy = offset === data.length
  if (!legacy) {
    const tag = data[offset++]!
    if (tag === 0) {
      quotedOperatorShareBps = null
    } else if (tag === 1) {
      if (offset + 2 > data.length) throw new Error('Truncated Grant quotedOperatorShareBps')
      quotedOperatorShareBps = view.getUint16(offset, true)
    } else {
      throw new Error(`Invalid Grant quote option tag: ${tag}`)
    }
  }
  return { model, enclave, wrappedKey, grantedBy, grantedSlot, revoked, bump, quotedOperatorShareBps, legacy }
}

export async function buildSetQuoteTx(params: {
  connection: Connection
  operator: Key
  model: Key
  enclave: Key
  operatorShareBps: number | null
  recentBlockhash?: string
  programId?: Key
}): Promise<VersionedTransaction> {
  const programId = key(params.programId ?? PROGRAM_ID)
  const operator = key(params.operator)
  const model = key(params.model)
  const enclave = key(params.enclave)
  const grant = grantPda(model, enclave, programId)
  const { voynich } = chainPrograms(params.connection, { programId })
  const instruction = await voynich.methods
    .setQuote(params.operatorShareBps)
    .accountsStrict({
      operator,
      model,
      enclave,
      grant,
      systemProgram: SystemProgram.programId,
      ...eventAccounts(programId),
    })
    .instruction()
  const recentBlockhash = params.recentBlockhash ?? (await params.connection.getLatestBlockhash('confirmed')).blockhash
  const message = new TransactionMessage({
    payerKey: operator,
    recentBlockhash,
    instructions: [instruction],
  }).compileToV0Message()
  return new VersionedTransaction(message)
}

export type DecodedModelVersionAccount = {
  model: PublicKey
  version: number
  status: 'uploading' | 'live' | 'archived'
  weights: PublicKey[]
  sizeBytes: BN
  noncePrefix: Uint8Array
  ciphertextSha256: string
  manifest: Uint8Array
  base: ModelBase | null
  hashVersion: number
  sealedChunks: number
  merkleFrontier: Uint8Array[]
  merkleFrontierMask: number
  publishedSlot: BN
  bump: number
}

export function decodeModelVersionAccount(data: Uint8Array): DecodedModelVersionAccount {
  if (!matchesDisc(data, 'account:ModelVersion') || data.length < 8 + 32 + 4 + 1) {
    throw new Error('Invalid ModelVersion account data')
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let offset = 8
  const need = (n: number) => {
    if (offset + n > data.length) throw new Error('Truncated ModelVersion account data')
  }
  const readU32 = () => { need(4); const v = view.getUint32(offset, true); offset += 4; return v }
  const readU64 = () => { need(8); const v = view.getBigUint64(offset, true); offset += 8; return v }
  const readString = () => {
    const len = readU32()
    need(len)
    const text = utf8Decoder.decode(data.subarray(offset, offset + len))
    offset += len
    return text
  }

  need(32)
  const model = new PublicKey(data.subarray(offset, offset + 32)); offset += 32
  const version = readU32()
  need(1)
  const statusTag = data[offset++]!
  if (statusTag > 2) throw new Error(`Invalid VersionStatus tag: ${statusTag}`)
  const status = (['uploading', 'live', 'archived'] as const)[statusTag]!
  const weightsLen = readU32()
  const weights: PublicKey[] = []
  for (let i = 0; i < weightsLen; i++) {
    need(32)
    weights.push(new PublicKey(data.subarray(offset, offset + 32)))
    offset += 32
  }
  const sizeBytes = new BN(readU64().toString())
  need(16)
  const noncePrefix = new Uint8Array(data.subarray(offset, offset + 16)); offset += 16
  need(32)
  const ciphertextSha256 = toHex(data.subarray(offset, offset + 32)); offset += 32
  const manifestLen = readU32()
  need(manifestLen)
  const manifest = new Uint8Array(data.subarray(offset, offset + manifestLen)); offset += manifestLen
  need(1)
  const baseTag = data[offset++]!
  let base: ModelBase | null = null
  if (baseTag === 1) {
    need(32)
    const sha256Hex = toHex(data.subarray(offset, offset + 32)); offset += 32
    const baseSize = Number(readU64())
    const format = readString()
    const source = readString()
    base = ModelBaseSchema.parse({ sha256: sha256Hex, sizeBytes: baseSize, format, source })
  } else if (baseTag !== 0) {
    throw new Error(`Invalid ModelVersion base tag: ${baseTag}`)
  }
  need(1)
  const hashVersion = data[offset++]!
  const sealedChunks = readU32()
  const frontierLen = readU32()
  const merkleFrontier: Uint8Array[] = []
  for (let i = 0; i < frontierLen; i++) {
    need(32)
    merkleFrontier.push(new Uint8Array(data.subarray(offset, offset + 32)))
    offset += 32
  }
  const merkleFrontierMask = readU32()
  const publishedSlot = new BN(readU64().toString())
  need(1)
  const bump = data[offset++]!
  return {
    model, version, status, weights, sizeBytes, noncePrefix, ciphertextSha256, manifest,
    base, hashVersion, sealedChunks, merkleFrontier, merkleFrontierMask, publishedSlot, bump,
  }
}

export async function buildBeginVersionTx(params: {
  connection: Connection
  owner: Key
  model: Key
  version: number
  weights: Key[]
  manifest: Uint8Array
  sizeBytes: number | bigint
  noncePrefix: Uint8Array
  base?: ModelBase | null
  recentBlockhash?: string
  programId?: Key
}): Promise<VersionedTransaction> {
  const programId = key(params.programId ?? PROGRAM_ID)
  const owner = key(params.owner)
  const model = key(params.model)
  const mv = modelVersionPda(model, params.version, programId)
  const { voynich } = chainPrograms(params.connection, { programId })
  const baseArg = params.base
    ? {
        sha256: [...fromHex(params.base.sha256)],
        sizeBytes: new BN(params.base.sizeBytes),
        format: params.base.format,
        source: params.base.source,
      }
    : null
  const instruction = await voynich.methods
    .beginVersion(params.version, {
      manifest: Buffer.from(params.manifest),
      sizeBytes: new BN(params.sizeBytes.toString()),
      noncePrefix: [...params.noncePrefix],
      base: baseArg,
    })
    .accountsStrict({
      owner,
      model,
      modelVersion: mv,
      systemProgram: SystemProgram.programId,
      ...eventAccounts(programId),
    })
    .remainingAccounts(params.weights.map(w => ({ pubkey: key(w), isWritable: true, isSigner: false })))
    .instruction()
  const recentBlockhash = params.recentBlockhash ?? (await params.connection.getLatestBlockhash('confirmed')).blockhash
  return new VersionedTransaction(
    new TransactionMessage({ payerKey: owner, recentBlockhash, instructions: [instruction] }).compileToV0Message(),
  )
}

export async function buildPublishVersionTx(params: {
  connection: Connection
  owner: Key
  model: Key
  version: number
  weights: Key[]
  ciphertextSha256: Uint8Array | string
  recentBlockhash?: string
  programId?: Key
}): Promise<VersionedTransaction> {
  const programId = key(params.programId ?? PROGRAM_ID)
  const owner = key(params.owner)
  const model = key(params.model)
  const mv = modelVersionPda(model, params.version, programId)
  const hashBytes = typeof params.ciphertextSha256 === 'string' ? fromHex(params.ciphertextSha256) : params.ciphertextSha256
  const { voynich } = chainPrograms(params.connection, { programId })
  const instruction = await voynich.methods
    .publishVersion([...hashBytes])
    .accountsStrict({
      owner,
      model,
      modelVersion: mv,
      ...eventAccounts(programId),
    })
    .remainingAccounts(params.weights.map(w => ({ pubkey: key(w), isWritable: false, isSigner: false })))
    .instruction()
  const recentBlockhash = params.recentBlockhash ?? (await params.connection.getLatestBlockhash('confirmed')).blockhash
  return new VersionedTransaction(
    new TransactionMessage({ payerKey: owner, recentBlockhash, instructions: [instruction] }).compileToV0Message(),
  )
}

export type DecodedSessionAccount = {
  caller: PublicKey
  delegate: PublicKey
  nonce: BN
  mint: PublicKey
  model: PublicKey
  budget: BN
  spent: BN
  callsOpened: BN
  openedSlot: BN
  expiresAtSlot: BN
  status: 'open' | 'closed'
  bump: number
}

export function decodeSessionAccount(data: Uint8Array): DecodedSessionAccount {
  if (!matchesDisc(data, 'account:Session') || data.length < SESSION_SPACE) {
    throw new Error('Invalid Session account data')
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let offset = 8
  const caller = new PublicKey(data.subarray(offset, offset + 32)); offset += 32
  const delegate = new PublicKey(data.subarray(offset, offset + 32)); offset += 32
  const nonce = new BN(view.getBigUint64(offset, true).toString()); offset += 8
  const mint = new PublicKey(data.subarray(offset, offset + 32)); offset += 32
  const model = new PublicKey(data.subarray(offset, offset + 32)); offset += 32
  const budget = new BN(view.getBigUint64(offset, true).toString()); offset += 8
  const spent = new BN(view.getBigUint64(offset, true).toString()); offset += 8
  const callsOpened = new BN(view.getBigUint64(offset, true).toString()); offset += 8
  const openedSlot = new BN(view.getBigUint64(offset, true).toString()); offset += 8
  const expiresAtSlot = new BN(view.getBigUint64(offset, true).toString()); offset += 8
  const statusTag = data[offset++]!
  if (statusTag > 1) throw new Error(`Invalid SessionStatus tag: ${statusTag}`)
  const status = (['open', 'closed'] as const)[statusTag]!
  const bump = data[offset++]!
  return { caller, delegate, nonce, mint, model, budget, spent, callsOpened, openedSlot, expiresAtSlot, status, bump }
}

export async function buildOpenSessionTx(params: {
  connection: Connection
  caller: Key
  delegate: Key
  nonce: bigint | number | string
  budget: bigint | number | string
  expiresAtSlot: bigint | number | string
  mint?: Key | null
  model?: Key | null
  delegateGasLamports?: bigint | number | string
  recentBlockhash?: string
  programId?: Key
}): Promise<VersionedTransaction> {
  const programId = key(params.programId ?? PROGRAM_ID)
  const caller = key(params.caller)
  const delegate = key(params.delegate)
  const nonceBig = BigInt(params.nonce)
  const session = sessionPda(caller, delegate, nonceBig, programId)
  const mintKey = params.mint ? key(params.mint) : PublicKey.default
  const modelKey = params.model ? key(params.model) : PublicKey.default
  const { voynich } = chainPrograms(params.connection, { programId })
  const instruction = await voynich.methods
    .openSession({
      delegate,
      nonce: new BN(nonceBig.toString()),
      mint: mintKey,
      model: modelKey,
      budget: new BN(BigInt(params.budget).toString()),
      expiresAtSlot: new BN(BigInt(params.expiresAtSlot).toString()),
      delegateGasLamports: new BN(BigInt(params.delegateGasLamports ?? 0).toString()),
    })
    .accountsStrict({
      caller,
      delegate,
      session,
      mint: null,
      callerTokens: null,
      sessionEscrow: null,
      tokenProgram: null,
      associatedTokenProgram: null,
      systemProgram: SystemProgram.programId,
      ...eventAccounts(programId),
    })
    .instruction()
  const recentBlockhash = params.recentBlockhash ?? (await params.connection.getLatestBlockhash('confirmed')).blockhash
  return new VersionedTransaction(
    new TransactionMessage({ payerKey: caller, recentBlockhash, instructions: [instruction] }).compileToV0Message(),
  )
}

export async function buildCloseSessionTx(params: {
  connection: Connection
  closer: Key
  caller: Key
  session: Key
  recentBlockhash?: string
  programId?: Key
}): Promise<VersionedTransaction> {
  const programId = key(params.programId ?? PROGRAM_ID)
  const closer = key(params.closer)
  const caller = key(params.caller)
  const session = key(params.session)
  const { voynich } = chainPrograms(params.connection, { programId })
  const instruction = await voynich.methods
    .closeSession()
    .accountsStrict({
      closer,
      session,
      caller,
      sessionEscrow: null,
      callerTokens: null,
      tokenProgram: null,
      systemProgram: SystemProgram.programId,
      ...eventAccounts(programId),
    })
    .instruction()
  const recentBlockhash = params.recentBlockhash ?? (await params.connection.getLatestBlockhash('confirmed')).blockhash
  return new VersionedTransaction(
    new TransactionMessage({ payerKey: closer, recentBlockhash, instructions: [instruction] }).compileToV0Message(),
  )
}

export type DecodedSplitRecipient = {
  wallet: PublicKey
  shareBps: number
  accrued: BN
  claimed: BN
}

export type DecodedSplitAccount = {
  model: PublicKey
  authority: PublicKey
  mint: PublicKey
  active: boolean
  totalReceived: BN
  recipients: DecodedSplitRecipient[]
  updatedSlot: BN
  bump: number
}

export function decodeSplitAccount(data: Uint8Array): DecodedSplitAccount {
  if (!matchesDisc(data, 'account:Split') || data.length < 8 + 32 + 32 + 32 + 1 + 8 + 4 + 8 + 1) {
    throw new Error('Invalid Split account data')
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let offset = 8
  const model = new PublicKey(data.subarray(offset, offset + 32)); offset += 32
  const authority = new PublicKey(data.subarray(offset, offset + 32)); offset += 32
  const mint = new PublicKey(data.subarray(offset, offset + 32)); offset += 32
  const activeByte = data[offset++]!
  if (activeByte > 1) throw new Error(`Invalid Split active flag: ${activeByte}`)
  const active = activeByte === 1
  const totalReceived = new BN(view.getBigUint64(offset, true).toString()); offset += 8
  const updatedSlot = new BN(view.getBigUint64(offset, true).toString()); offset += 8
  const count = view.getUint32(offset, true); offset += 4
  if (count > 8 || offset + count * 50 + 1 > data.length) {
    throw new Error(`Invalid Split recipients length: ${count}`)
  }
  const recipients: DecodedSplitRecipient[] = []
  for (let i = 0; i < count; i++) {
    const wallet = new PublicKey(data.subarray(offset, offset + 32)); offset += 32
    const shareBps = view.getUint16(offset, true); offset += 2
    const accrued = new BN(view.getBigUint64(offset, true).toString()); offset += 8
    const claimed = new BN(view.getBigUint64(offset, true).toString()); offset += 8
    recipients.push({ wallet, shareBps, accrued, claimed })
  }
  const bump = data[offset++]!
  return { model, authority, mint, active, totalReceived, recipients, updatedSlot, bump }
}

export async function buildSetSplitTx(params: {
  connection: Connection
  owner: Key
  model: Key
  recipients: Array<{ wallet: Key; shareBps: number }>
  recentBlockhash?: string
  programId?: Key
}): Promise<VersionedTransaction> {
  const programId = key(params.programId ?? PROGRAM_ID)
  const owner = key(params.owner)
  const model = key(params.model)
  const split = splitPda(model, programId)
  const { voynich } = chainPrograms(params.connection, { programId })
  const instruction = await voynich.methods
    .setSplit(params.recipients.map(r => ({ wallet: key(r.wallet), shareBps: r.shareBps })))
    .accountsStrict({
      owner,
      model,
      split,
      systemProgram: SystemProgram.programId,
      ...eventAccounts(programId),
    })
    .instruction()
  const recentBlockhash = params.recentBlockhash ?? (await params.connection.getLatestBlockhash('confirmed')).blockhash
  return new VersionedTransaction(
    new TransactionMessage({ payerKey: owner, recentBlockhash, instructions: [instruction] }).compileToV0Message(),
  )
}

export async function buildClaimSplitTx(params: {
  connection: Connection
  payer: Key
  model: Key
  recipient?: Key
  splitEscrow?: Key | null
  recipientTokens?: Key | null
  tokenProgram?: Key | null
  recentBlockhash?: string
  programId?: Key
}): Promise<VersionedTransaction> {
  const programId = key(params.programId ?? PROGRAM_ID)
  const payer = key(params.payer)
  const model = key(params.model)
  const recipient = key(params.recipient ?? params.payer)
  const split = splitPda(model, programId)
  const { voynich } = chainPrograms(params.connection, { programId })
  const instruction = await voynich.methods
    .claimSplit()
    .accountsStrict({
      payer,
      split,
      recipient,
      splitEscrow: params.splitEscrow ? key(params.splitEscrow) : null,
      recipientTokens: params.recipientTokens ? key(params.recipientTokens) : null,
      tokenProgram: params.tokenProgram ? key(params.tokenProgram) : null,
      systemProgram: SystemProgram.programId,
      ...eventAccounts(programId),
    })
    .instruction()
  const recentBlockhash = params.recentBlockhash ?? (await params.connection.getLatestBlockhash('confirmed')).blockhash
  return new VersionedTransaction(
    new TransactionMessage({ payerKey: payer, recentBlockhash, instructions: [instruction] }).compileToV0Message(),
  )
}
