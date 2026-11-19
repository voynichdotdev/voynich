// The checks a browser runs on a receipt (facts: RECEIPT_CHECKS). Each returns passed or failed with what it saw.
// Used by the receipt page and by the call panel before it shows an answer.

import { ModelBaseSchema, fromBase58, fromBase64, toBase58, type Config, type ModelBase, type ReceiptView } from '@voynich/contract'
import { fromHex, sha256, toHex, utf8, verifyPiece, verifyReceipt } from 'voynich/crypto'
import { group } from './format'

export type CheckId = 'signature' | 'record' | 'expiry' | 'answer' | 'base'
export type CheckResult = { id: CheckId; passed: boolean; detail: string }

export const RECEIPT_LEGACY_SPACE = 401
export const RECEIPT_METERED_EXTENSION = 16
export const RECEIPT_METERED_SPACE = 423
const RECEIPT_DISC = sha256(utf8('account:Receipt')).subarray(0, 8)
const MODEL_DISC = sha256(utf8('account:Model')).subarray(0, 8)
const utf8Decoder = new TextDecoder('utf-8', { fatal: true })

export type DecodedReceiptBytes = {
  era: 'legacy' | 'step1' | 'step2' | 'metered'
  call: string
  model: string
  enclave: string
  inputHash: string
  outputHash: string
  slot: bigint
  answerMode: 'sealed' | 'open'
  openAnswer: Uint8Array
  callerIsProgram: boolean
  deliveredCount: bigint | null
  returnedAmount: bigint | null
}

// Decodes raw on-chain Receipt account bytes across all four eras:
// 401 bytes (legacy sealed), 406 + N bytes (Step 1 open answers), 407 + N bytes (Step 2 caller_is_program),
// and 423 + N bytes (metered stream receipt with trailing delivered_count + returned_amount).
export function decodeReceiptBytes(data: Uint8Array): DecodedReceiptBytes {
  if (data.length < 8 || RECEIPT_DISC.some((b, i) => data[i] !== b)) {
    throw new Error('Invalid Receipt account discriminator.')
  }
  if (data.length !== RECEIPT_LEGACY_SPACE && data.length < RECEIPT_LEGACY_SPACE + 5) {
    throw new Error('Invalid Receipt account length.')
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let era: DecodedReceiptBytes['era'] = 'legacy'
  let answerMode: 'sealed' | 'open' = 'sealed'
  let openAnswer: Uint8Array = new Uint8Array(0)
  let callerIsProgram = false
  let deliveredCount: bigint | null = null
  let returnedAmount: bigint | null = null
  if (data.length !== RECEIPT_LEGACY_SPACE) {
    if (data[401] === 0) answerMode = 'sealed'
    else if (data[401] === 1) answerMode = 'open'
    else throw new Error('Invalid Receipt answer mode.')
    const len = view.getUint32(402, true)
    const step1Len = 406 + len
    const step2Len = step1Len + 1
    const meteredLen = step2Len + RECEIPT_METERED_EXTENSION
    if (data.length !== step1Len && data.length !== step2Len && data.length !== meteredLen) {
      throw new Error('Invalid Receipt open answer length.')
    }
    openAnswer = data.subarray(406, step1Len)
    if (data.length === step1Len) {
      era = 'step1'
    } else {
      if (data[step1Len] === 0) callerIsProgram = false
      else if (data[step1Len] === 1) callerIsProgram = true
      else throw new Error('Invalid Receipt callerIsProgram flag.')
      if (data.length === step2Len) {
        era = 'step2'
      } else {
        era = 'metered'
        deliveredCount = view.getBigUint64(step2Len, true)
        returnedAmount = view.getBigUint64(step2Len + 8, true)
      }
    }
  }
  return {
    era,
    call: toBase58(data.subarray(8, 40)),
    model: toBase58(data.subarray(40, 72)),
    enclave: toBase58(data.subarray(72, 104)),
    inputHash: toHex(data.subarray(104, 136)),
    outputHash: toHex(data.subarray(136, 168)),
    slot: view.getBigUint64(232, true),
    answerMode,
    openAnswer,
    callerIsProgram,
    deliveredCount,
    returnedAmount,
  }
}

// Decodes the trailing Option<ModelBase> from raw on-chain Model account bytes without Anchor
// or Node-only dependencies, handling both legacy 6,000-byte accounts (returns null) and
// current 8,192-byte accounts with or without a base model.
export function decodeModelBaseBytes(data: Uint8Array): ModelBase | null {
  if (data.length < 8 + 32 || MODEL_DISC.some((b, i) => data[i] !== b)) {
    throw new Error('Invalid Model account data.')
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let offset = 8
  const need = (n: number) => {
    if (offset + n > data.length) throw new Error('Truncated Model account data.')
  }
  const skip = (n: number) => { need(n); offset += n }
  const readU32 = () => { need(4); const v = view.getUint32(offset, true); offset += 4; return v }
  const readU64Number = () => {
    need(8)
    const n = Number(view.getBigUint64(offset, true))
    offset += 8
    if (!Number.isSafeInteger(n)) throw new Error('Model base sizeBytes exceeds safe integer range.')
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
  if (offset + 4 > data.length) return null
  skip(readU32() * 32) // upload_keys
  if (offset + 1 + 4 + 4 > data.length) return null
  skip(1) // hash_version
  skip(4) // sealed_chunks
  skip(readU32() * 32) // merkle_frontier
  if (offset + 4 + 1 > data.length) return null
  skip(4) // merkle_frontier_mask
  const tag = data[offset++]
  if (tag === 0) return null
  if (tag !== 1) throw new Error(`Invalid Model base option tag: ${tag}.`)
  need(32)
  const sha256Hex = toHex(data.subarray(offset, offset + 32))
  offset += 32
  const sizeBytes = readU64Number()
  const format = readString()
  const source = readString()
  return ModelBaseSchema.parse({ sha256: sha256Hex, sizeBytes, format, source })
}

function sameBase(a: ModelBase | null, b: ModelBase | null): boolean {
  if (a === null && b === null) return true
  if (!a || !b) return false
  return a.sha256 === b.sha256 && a.sizeBytes === b.sizeBytes && a.format === b.format && a.source === b.source
}

function verifySig(v: ReceiptView, baseSha256?: Uint8Array | null): boolean {
  try {
    const sig = fromBase64(v.receipt.signature)
    const key = fromBase58(v.enclaveSigningKey)
    const call = fromBase58(v.receipt.call)
    const inHash = fromHex(v.receipt.inputHash)
    const outHash = fromHex(v.receipt.outputHash)
    if (v.receipt.deliveredCount !== null && v.receipt.deliveredCount !== undefined) {
      return verifyPiece(sig, key, call, inHash, BigInt(v.receipt.deliveredCount), outHash, baseSha256)
    }
    return verifyReceipt(sig, key, call, inHash, outHash, baseSha256)
  } catch {
    return false
  }
}

export function checkSignature(v: ReceiptView): CheckResult {
  const base = v.modelBase ?? null
  const metered = v.receipt.deliveredCount !== null && v.receipt.deliveredCount !== undefined
  if (base) {
    if (verifySig(v, fromHex(base.sha256))) {
      return {
        id: 'signature',
        passed: true,
        detail: metered
          ? `Ed25519 piece signature (v2) over the call, input hash, delivered count (${group(v.receipt.deliveredCount!)}), running hash and base model SHA-256 is valid for the enclave key.`
          : 'Ed25519 signature (v2) over the call, input hash, output hash and base model SHA-256 is valid for the enclave key.',
      }
    }
    // Separate legacy pre-v2 adapter receipts (valid v1 signature without base commitment) from forged signatures.
    if (verifySig(v)) {
      return {
        id: 'signature',
        passed: true,
        detail: 'Ed25519 signature (legacy v1) is valid for the enclave key, without a base model commitment.',
      }
    }
    return { id: 'signature', passed: false, detail: 'The signature does not match the enclave key and these hashes.' }
  }
  const passed = verifySig(v)
  return {
    id: 'signature',
    passed,
    detail: passed
      ? metered
        ? `Ed25519 piece signature over the call, input hash, delivered count (${group(v.receipt.deliveredCount!)}) and running hash is valid for the enclave key.`
        : 'Ed25519 signature over the call, input hash and output hash is valid for the enclave key.'
      : 'The signature does not match the enclave key and these hashes.',
  }
}

// The key the receipt names must be the key the attestation record holds. Against a live cluster the record
// account itself is read from RPC: it must exist, belong to the attestation program and carry that key.
export async function checkRecord(v: ReceiptView, config: Config | null): Promise<CheckResult> {
  const a = v.attestationRecord
  if (a.signingKey !== v.enclaveSigningKey) return { id: 'record', passed: false, detail: 'The attestation record holds a different key.' }
  if (config && config.mode === 'chain') {
    try {
      const r = await fetch(config.rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAccountInfo', params: [a.address, { encoding: 'base64', commitment: 'confirmed' }] }),
      })
      const info = ((await r.json()) as { result?: { value?: { owner: string; data: [string, string] } | null } }).result?.value
      if (!info) return { id: 'record', passed: false, detail: 'The record account is not on chain.' }
      if (info.owner !== v.attestationProgramId || (config.attestationProgramId && info.owner !== config.attestationProgramId)) return { id: 'record', passed: false, detail: 'The record account is not owned by the attestation program.' }
      const data = fromBase64(info.data[0])
      const key = fromBase58(a.signingKey)
      let found = false
      for (let i = 0; i + key.length <= data.length && !found; i++) {
        let same = true
        for (let k = 0; k < key.length; k++) if (data[i + k] !== key[k]) { same = false; break }
        found = same
      }
      if (!found) return { id: 'record', passed: false, detail: 'The record on chain does not carry this key.' }
      return { id: 'record', passed: true, detail: 'Read from chain: the record is owned by the attestation program and carries the enclave key.' }
    } catch {
      return { id: 'record', passed: false, detail: 'The record could not be read from the cluster.' }
    }
  }
  return { id: 'record', passed: true, detail: 'The attestation record holds the enclave key.' }
}

// The record is in force up to, not at, its expiry slot.
export function checkExpiry(v: ReceiptView): CheckResult {
  const slot = BigInt(v.receipt.slot)
  const passed = BigInt(v.attestationRecord.recordedSlot) <= slot && slot < BigInt(v.attestationRecord.expiresAtSlot)
  return { id: 'expiry', passed, detail: passed ? `Settled at slot ${group(v.receipt.slot)}; the record runs from slot ${group(v.attestationRecord.recordedSlot)} to ${group(v.attestationRecord.expiresAtSlot)}.` : `Settled at slot ${group(v.receipt.slot)}, outside the record's slots ${group(v.attestationRecord.recordedSlot)} to ${group(v.attestationRecord.expiresAtSlot)}.` }
}

// For an open call, the raw answer bytes stored on chain must hash to the signed output hash.
// Sealed and legacy receipts carry only the hash of the encrypted reply, so this check passes cleanly.
// Against a live cluster the receipt account itself (401B, 406+N, or 407+N) is decoded from RPC.
export async function checkAnswer(v: ReceiptView, config: Config | null = null): Promise<CheckResult> {
  const mode = v.receipt.answerMode ?? 'sealed'
  const expectedProgramCaller = v.receipt.callerIsProgram ?? false
  let localBytes: Uint8Array | null = null
  if (mode !== 'open') {
    if (v.receipt.openAnswer !== null && v.receipt.openAnswer !== undefined) {
      return { id: 'answer', passed: false, detail: 'Sealed receipt unexpectedly carries open answer bytes.' }
    }
  } else {
    if (!v.receipt.openAnswer) {
      return { id: 'answer', passed: false, detail: 'Open call receipt is missing its on-chain answer bytes.' }
    }
    try {
      localBytes = fromBase64(v.receipt.openAnswer)
    } catch {
      return { id: 'answer', passed: false, detail: 'The on-chain open answer could not be decoded.' }
    }
    if (localBytes.length === 0 || toHex(sha256(localBytes)) !== v.receipt.outputHash) {
      return { id: 'answer', passed: false, detail: 'The on-chain open answer bytes do not hash to the signed output hash.' }
    }
  }

  if (config && config.mode === 'chain') {
    try {
      const r = await fetch(config.rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAccountInfo', params: [v.receipt.address, { encoding: 'base64', commitment: 'confirmed' }] }),
      })
      const info = ((await r.json()) as { result?: { value?: { owner: string; data: [string, string] } | null } }).result?.value
      if (!info) return { id: 'answer', passed: false, detail: 'The receipt account is not on chain.' }
      if (config.programId && info.owner !== config.programId) {
        return { id: 'answer', passed: false, detail: 'The receipt account is not owned by the Voynich program.' }
      }
      const decoded = decodeReceiptBytes(fromBase64(info.data[0]))
      const chainDelivered = decoded.deliveredCount?.toString() ?? null
      const chainReturned = decoded.returnedAmount?.toString() ?? null
      if (
        decoded.call !== v.receipt.call ||
        decoded.outputHash !== v.receipt.outputHash ||
        decoded.answerMode !== mode ||
        decoded.callerIsProgram !== expectedProgramCaller ||
        chainDelivered !== (v.receipt.deliveredCount ?? null) ||
        chainReturned !== (v.receipt.returnedAmount ?? null)
      ) {
        return { id: 'answer', passed: false, detail: 'The receipt on chain does not match this call, mode, count or output hash.' }
      }
      if (mode === 'open') {
        if (decoded.openAnswer.length === 0 || toHex(sha256(decoded.openAnswer)) !== v.receipt.outputHash) {
          return { id: 'answer', passed: false, detail: 'The on-chain open answer bytes do not hash to the signed output hash.' }
        }
        return { id: 'answer', passed: true, detail: `Read from chain: SHA-256 of the ${group(decoded.openAnswer.length)}-byte open answer matches the signed output hash.` }
      }
      if (decoded.openAnswer.length !== 0) {
        return { id: 'answer', passed: false, detail: 'Sealed receipt on chain unexpectedly carries open answer bytes.' }
      }
      return { id: 'answer', passed: true, detail: 'Read from chain: sealed call, only the hash of the encrypted answer is on chain.' }
    } catch {
      return { id: 'answer', passed: false, detail: 'The receipt account could not be read from the cluster.' }
    }
  }

  return mode === 'open'
    ? { id: 'answer', passed: true, detail: `SHA-256 of the ${group(localBytes!.length)}-byte open answer on chain matches the signed output hash.` }
    : { id: 'answer', passed: true, detail: 'Sealed call: the answer stayed encrypted to the caller; only its hash is on chain.' }
}

// For a sealed adapter, reads the on-chain Model account (in chain mode) to verify its base metadata
// and confirms the enclave Ed25519 signature commits to that exact base SHA-256 (voynich/receipt/v2).
// Standalone models (base === null) pass cleanly; pre-v2 adapter receipts fail this check while keeping signature valid.
export async function checkBase(v: ReceiptView, config: Config | null = null): Promise<CheckResult> {
  let expectedBase: ModelBase | null = v.modelBase ?? null
  let fromChain = false

  if (config && config.mode === 'chain') {
    try {
      const r = await fetch(config.rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAccountInfo', params: [v.receipt.model, { encoding: 'base64', commitment: 'confirmed' }] }),
      })
      const info = ((await r.json()) as { result?: { value?: { owner: string; data: [string, string] } | null } }).result?.value
      if (!info) return { id: 'base', passed: false, detail: 'The model account is not on chain.' }
      if (config.programId && info.owner !== config.programId) {
        return { id: 'base', passed: false, detail: 'The model account is not owned by the Voynich program.' }
      }
      const chainBase = decodeModelBaseBytes(fromBase64(info.data[0]))
      if (!sameBase(chainBase, expectedBase)) {
        return { id: 'base', passed: false, detail: 'The base model reported by the API does not match the on-chain Model account.' }
      }
      expectedBase = chainBase
      fromChain = true
    } catch {
      return { id: 'base', passed: false, detail: 'The model account could not be read from the cluster.' }
    }
  }

  if (!expectedBase) {
    return {
      id: 'base',
      passed: true,
      detail: fromChain
        ? 'Read from chain: standalone sealed model, no open base required.'
        : 'Standalone sealed model: no open base required.',
    }
  }

  if (verifySig(v, fromHex(expectedBase.sha256))) {
    return {
      id: 'base',
      passed: true,
      detail: fromChain
        ? 'Read from chain: enclave signature (v2) commits to the on-chain base model SHA-256.'
        : 'Enclave signature (v2) commits to the base model SHA-256.',
    }
  }

  if (verifySig(v)) {
    return {
      id: 'base',
      passed: false,
      detail: 'Legacy v1 receipt: the enclave signature predates v2 base model commitments.',
    }
  }

  return {
    id: 'base',
    passed: false,
    detail: 'The enclave signature does not commit to this base model SHA-256.',
  }
}

export async function verifyAll(v: ReceiptView, config: Config | null, onCheck?: (r: CheckResult) => void, gapMs = 300): Promise<CheckResult[]> {
  const out: CheckResult[] = []
  const steps: (() => CheckResult | Promise<CheckResult>)[] = [
    () => checkSignature(v),
    () => checkRecord(v, config),
    () => checkExpiry(v),
    () => checkAnswer(v, config),
    () => checkBase(v, config),
  ]
  for (const step of steps) {
    const r = await step()
    out.push(r)
    onCheck?.(r)
    if (gapMs) await new Promise((res) => setTimeout(res, gapMs))
  }
  return out
}
