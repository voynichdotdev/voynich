'use client'

// The seal flow's device side: what is kept between reloads, the upload key, and the chunk writer.
// The ciphertext stays in IndexedDB; the rest of the state, none of it secret, lives in localStorage.

import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { ed25519 } from '@noble/curves/ed25519.js'
import {
  ATTACH_WEIGHTS_BATCH, DEFAULT_UPLOAD_KEYS, INITIAL_CREATE_WEIGHTS, MAX_WEIGHTS, SEAL_RANGE_CHUNKS, WRITE_CHUNK_BYTES,
  fromBase64, toBase58, toBase64,
  type ByteRange, type CipherHeader, type Manifest, type Model, type ModelBase, type ModelBaseFormat, type Money, type TxStatus, type VoynichClient,
} from '@voynich/contract'
import { decodeAdapter, verifyOnnxAdapterCompatibility } from 'voynich/adapter'
import { CIPHER_CHUNK_BYTES, ciphertextHash, deriveSealSecrets, sealDerivationMessage, sha256, signSealDerivation, toHex, utf8, verifySealDerivationSignature } from 'voynich/crypto'
import { forgetUploadSecret, forgetUploadSecrets } from './keys'
import { TxError } from './tx'
import { wallet } from './wallet'
import { signMessage, signTransaction } from '@/src/engines/wallet/sign'
import { walletFailure } from '@/src/engines/tx/client/flow'

export {
  ATTACH_WEIGHTS_BATCH, CIPHER_CHUNK_BYTES, INITIAL_CREATE_WEIGHTS, MAX_WEIGHTS, SEAL_RANGE_CHUNKS,
  deriveSealSecrets, sealDerivationMessage, signSealDerivation, verifySealDerivationSignature,
}
export const WRITE_BYTES = WRITE_CHUNK_BYTES // the contract's limit for one write
export const WRITE_PARALLEL = DEFAULT_UPLOAD_KEYS
export const WRITE_LANES_PER_KEY = 2
const WRITE_POLL_MS = 250
const SIGNATURE_LAMPORTS = 5000n
const UPLOAD_KEY_RENT_LAMPORTS = 890_880n
const COMPUTE_BUDGET_PROGRAM = 'ComputeBudget111111111111111111111111111111'
const TAG_BYTES = 16
// One weights account holds at most 10 MiB, its 56-byte header included; a model has up to 64.
const WEIGHTS_HEADER = 56
export const WEIGHTS_CAPACITY = 10 * 1024 * 1024 - WEIGHTS_HEADER
export const weightsCount = (size: number) => Math.max(1, Math.min(MAX_WEIGHTS, Math.ceil(size / WEIGHTS_CAPACITY)))
export const sealChunkCount = (size: number) => Math.max(1, Math.ceil(size / CIPHER_CHUNK_BYTES))
export const attachBatchCount = (totalWeights: number) =>
  totalWeights <= INITIAL_CREATE_WEIGHTS ? 0 : Math.ceil((totalWeights - INITIAL_CREATE_WEIGHTS) / ATTACH_WEIGHTS_BATCH)
export const sealRangeCount = (size: number) => {
  const chunks = sealChunkCount(size)
  return chunks <= SEAL_RANGE_CHUNKS ? 0 : Math.ceil((chunks - SEAL_RANGE_CHUNKS) / SEAL_RANGE_CHUNKS)
}

export type SealStepId = 'prepare' | 'encrypt' | 'create' | 'write' | 'seal' | 'grant' | 'done'

export type SealMetrics = {
  startedAtMs?: number
  finishedAtMs?: number
  bytesWritten: number
  transactionsSent: number
  feesLamports: string
}

// What a seal in progress is, once the weights are encrypted.
export type SealState = {
  step: SealStepId
  fileName: string | null
  name: string
  manifest: Manifest
  price: Money
  operatorShareBps: number
  allowedMeasurements: string[]
  plaintextBytes: number
  sizeBytes: number
  sha256: string | null
  hashVersion?: number
  sealedChunks?: number
  cipher: CipherHeader
  uploadSecret?: string
  uploadKey?: string
  uploadKeys?: string[]
  uploadSecrets?: Record<string, string>
  // the weights accounts allocated for the ciphertext, in order, and what the API quoted for the upload key
  weights?: string[]
  uploadFunding?: string
  writeChunkBytes?: number
  owner?: string
  model?: string
  base?: ModelBase | null
  derived?: boolean
  metrics?: SealMetrics
}

// Exact lamports fee of a VersionedTransaction: 5,000 per required signature plus ComputeBudget priority fee.
export function txFeeLamports(tx: {
  message: {
    header: { numRequiredSignatures: number }
    staticAccountKeys: { toBase58(): string }[]
    compiledInstructions: { programIdIndex: number; data: Uint8Array }[]
  }
}): bigint {
  const base = BigInt(tx.message.header.numRequiredSignatures) * SIGNATURE_LAMPORTS
  let cuLimit = 200_000n
  let cuPrice = 0n
  for (const ix of tx.message.compiledInstructions) {
    const program = tx.message.staticAccountKeys[ix.programIdIndex]?.toBase58()
    if (program !== COMPUTE_BUDGET_PROGRAM || ix.data.length < 5) continue
    const view = new DataView(ix.data.buffer, ix.data.byteOffset, ix.data.byteLength)
    if (ix.data[0] === 2 && ix.data.length >= 5) cuLimit = BigInt(view.getUint32(1, true))
    else if (ix.data[0] === 3 && ix.data.length >= 9) cuPrice = view.getBigUint64(1, true)
  }
  const priority = cuPrice > 0n ? (cuLimit * cuPrice + 999_999n) / 1_000_000n : 0n
  return base + priority
}

export async function buildFeeLamports(build: { transactionBase64: string; requiredSigners: string[]; fixture: boolean }): Promise<bigint> {
  if (build.fixture) return BigInt(Math.max(1, build.requiredSigners.length)) * SIGNATURE_LAMPORTS
  try {
    const { VersionedTransaction } = await import('@solana/web3.js')
    return txFeeLamports(VersionedTransaction.deserialize(fromBase64(build.transactionBase64)))
  } catch {
    return BigInt(Math.max(1, build.requiredSigners.length)) * SIGNATURE_LAMPORTS
  }
}

export function addSealMetrics(
  prev: SealMetrics | undefined,
  delta: { bytesWritten?: number; transactionsSent?: number; feesLamports?: bigint; startedAtMs?: number; finishedAtMs?: number },
): SealMetrics {
  const prevFees = prev?.feesLamports ? BigInt(prev.feesLamports) : 0n
  return {
    startedAtMs: prev?.startedAtMs ?? delta.startedAtMs,
    finishedAtMs: delta.finishedAtMs ?? prev?.finishedAtMs,
    bytesWritten: delta.bytesWritten ?? prev?.bytesWritten ?? 0,
    transactionsSent: (prev?.transactionsSent ?? 0) + (delta.transactionsSent ?? 0),
    feesLamports: (prevFees + (delta.feesLamports ?? 0n)).toString(),
  }
}

export function sealSummary(st: SealState): {
  bytesWritten: number
  transactionsSent: number
  elapsedSeconds: number | null
  feesLamports: string
} {
  const bytesWritten = st.metrics?.bytesWritten && st.metrics.bytesWritten > 0 ? st.metrics.bytesWritten : st.sizeBytes
  const chunkBytes = st.writeChunkBytes ?? WRITE_BYTES
  const estimatedTx = weightsCount(st.sizeBytes) + 1 + chunkCount(st.sizeBytes, chunkBytes) + 1 + (st.step === 'done' ? 1 : 0)
  const transactionsSent = st.metrics && st.metrics.transactionsSent > 0 ? st.metrics.transactionsSent : estimatedTx
  const feesLamports =
    st.metrics && BigInt(st.metrics.feesLamports) > 0n
      ? st.metrics.feesLamports
      : (BigInt(transactionsSent) * SIGNATURE_LAMPORTS).toString()
  const elapsedSeconds =
    st.metrics?.startedAtMs !== undefined
      ? Math.max(0, ((st.metrics.finishedAtMs ?? Date.now()) - st.metrics.startedAtMs) / 1000)
      : null
  return { bytesWritten, transactionsSent, elapsedSeconds, feesLamports }
}

const STORE = 'voynich.seal'

export function loadSeal(): SealState | null {
  try {
    const v = localStorage.getItem(STORE)
    return v ? (JSON.parse(v) as SealState) : null
  } catch { return null }
}
// The upload key secrets are never part of what is written here: they are kept in the vault, under the password.
export function saveSeal(state: SealState) {
  try { localStorage.setItem(STORE, JSON.stringify({ ...state, uploadSecret: undefined, uploadSecrets: undefined })) } catch {}
}
export function clearSeal() {
  try {
    const saved = loadSeal()
    const keys = saved?.uploadKeys?.length ? saved.uploadKeys : saved?.uploadKey ? [saved.uploadKey] : []
    if (keys.length > 1) forgetUploadSecrets(keys)
    else if (keys[0]) forgetUploadSecret(keys[0])
    localStorage.removeItem(STORE)
  } catch {}
  void idb('readwrite', (s) => s.delete('ciphertext')).catch(() => {})
}

// A seal the chain already holds, read back as the flow's state (a return on a device without the saved flow).
export function stateFromModel(m: Model, step: SealStepId): SealState {
  const uploadKeys = m.upload?.uploadKeys?.length ? m.upload.uploadKeys : m.upload?.uploadKey ? [m.upload.uploadKey] : undefined
  return {
    step, fileName: null, name: m.name, manifest: m.manifest, price: m.price, operatorShareBps: m.operatorShareBps,
    allowedMeasurements: m.allowedMeasurements, plaintextBytes: m.plaintextSizeBytes, sizeBytes: m.sizeBytes,
    sha256: m.ciphertextSha256, hashVersion: m.hashVersion, sealedChunks: m.sealedChunks, cipher: m.cipher, uploadKey: m.upload?.uploadKey, uploadKeys, weights: m.weights.map((x) => x.address), owner: m.owner, model: m.address, base: m.base ?? null,
  }
}

// ---------- the ciphertext, in IndexedDB ----------

function idb<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('voynich.seal', 1)
    open.onupgradeneeded = () => open.result.createObjectStore('bytes')
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result
      const req = run(db.transaction('bytes', mode).objectStore('bytes'))
      req.onsuccess = () => { resolve(req.result); db.close() }
      req.onerror = () => { reject(req.error); db.close() }
    }
  })
}
export async function putCiphertext(hash: string, bytes: Uint8Array) {
  try { await idb('readwrite', (s) => s.put({ hash, bytes }, 'ciphertext')) } catch {}
}
export async function getCiphertext(hash: string | null): Promise<Uint8Array | null> {
  try {
    const row = (await idb('readonly', (s) => s.get('ciphertext'))) as { hash: string; bytes: Uint8Array } | undefined
    return row && hash && row.hash === hash ? row.bytes : null
  } catch { return null }
}

// ---------- encryption with a known header ----------

// The same bytes `sealWeights` writes, for a key and nonce prefix that already exist: a second device
// rebuilds the ciphertext from the weights file instead of drawing a new one.
export function reseal(plaintext: Uint8Array, key: Uint8Array, header: CipherHeader, hashVersion = 1): { ciphertext: Uint8Array; sha256: string } {
  const chunk = header.chunkSizeBytes
  const prefix = fromBase64(header.noncePrefix)
  const ciphertext = new Uint8Array(plaintext.length + Math.ceil(plaintext.length / chunk) * TAG_BYTES)
  for (let offset = 0, i = 0; offset < plaintext.length; offset += chunk, i++) {
    const nonce = new Uint8Array(24)
    nonce.set(prefix)
    new DataView(nonce.buffer).setBigUint64(16, BigInt(i), true)
    ciphertext.set(xchacha20poly1305(key, nonce).encrypt(plaintext.subarray(offset, offset + chunk)), i * (chunk + TAG_BYTES))
  }
  return { ciphertext, sha256: toHex(ciphertextHash(ciphertext, hashVersion)) }
}

// ---------- the upload keys ----------

export function newUploadKey(): { secret: string; address: string } {
  const { secretKey, publicKey } = ed25519.keygen()
  return { secret: toBase64(secretKey), address: toBase58(publicKey) }
}

export function newUploadKeys(count: number = DEFAULT_UPLOAD_KEYS): { secret: string; address: string }[] {
  return Array.from({ length: Math.max(1, count) }, () => newUploadKey())
}

// Canonical PDA for a Voynich Model account, matching voynich's ["model", name] seeds.
export async function modelPdaAddress(programId: string, name: string): Promise<string> {
  const { PublicKey } = await import('@solana/web3.js')
  return PublicKey.findProgramAddressSync([utf8('model'), utf8(name)], new PublicKey(programId))[0]!.toBase58()
}

// Copyable CLI command to finish an interrupted upload from any terminal without an owner state file.
export function resumeCliCommand(fileName: string | null | undefined, modelNameOrAddress: string, base?: ModelBase | null): string {
  const file = fileName && fileName.trim() ? fileName.trim() : base ? '<adapter.voya>' : '<weights.onnx>'
  if (!base) return `voynich seal ${file} --model ${modelNameOrAddress} --resume`
  return `voynich seal ${file} --model ${modelNameOrAddress} --base ${base.source} --base-sha256 ${base.sha256} --base-size ${base.sizeBytes} --base-format ${base.format} --resume`
}

// Derives deterministic model key, cipher nonce prefix, upload key pool, and Weights account keypairs
// from one canonical wallet signMessage signature (zero state file required to resume on another device).
export async function deriveWalletSealSecrets(o: {
  programId: string
  modelAddress: string
  weightsKeyCount: number
  uploadKeyCount?: number
}): Promise<{
  modelKey: Uint8Array
  noncePrefix: Uint8Array
  uploadKeys: { address: string; secret: string }[]
  weightsPlan: { addresses: string[]; secrets: Uint8Array[] }
}> {
  const conn = wallet.connection()
  if (!conn) throw new TxError('Connect a wallet first.', 'build', true)
  const { PublicKey } = await import('@solana/web3.js')
  let derived
  try {
    derived = await signSealDerivation(
      {
        publicKey: new PublicKey(conn.account.address),
        signMessage: async (message) => (await signMessage(conn, message)).signature,
      },
      o.programId,
      o.modelAddress,
      { uploadKeyCount: o.uploadKeyCount ?? DEFAULT_UPLOAD_KEYS, weightsKeyCount: o.weightsKeyCount },
    )
  } catch (e) {
    const f = walletFailure(e)
    throw new TxError(f.message, f.stage, f.retryable, f.nextStep)
  }
  return {
    modelKey: derived.modelKey,
    noncePrefix: derived.noncePrefix,
    uploadKeys: derived.uploadKeys.map((kp) => ({
      address: kp.publicKey.toBase58(),
      secret: toBase64(kp.secretKey.slice(0, 32)),
    })),
    weightsPlan: {
      addresses: derived.weightsKeys.map((kp) => kp.publicKey.toBase58()),
      secrets: derived.weightsKeys.map((kp) => kp.secretKey),
    },
  }
}

// Partitions unwritten chunk indices into contiguous per-key slices so each upload key writes independently.
export function partitionChunks(todo: readonly number[], keyCount: number): number[][] {
  const k = Math.max(1, Math.min(keyCount, todo.length))
  if (todo.length === 0) return []
  const out: number[][] = []
  const base = Math.floor(todo.length / k)
  const extra = todo.length % k
  let start = 0
  for (let i = 0; i < k; i++) {
    const len = base + (i < extra ? 1 : 0)
    out.push(todo.slice(start, start + len))
    start += len
  }
  return out
}

// Self-sweeps extra upload keys (uploadKeys[1..]) back to owner before seal_model; zero owner wallet prompt.
export async function sweepExtraUploadKeys(o: {
  rpcUrl: string
  owner: string
  extraKeys: { address: string; secret: string }[]
  fixture?: boolean
}): Promise<{ transactionsSent: number; feesLamports: bigint }> {
  if (o.fixture || o.extraKeys.length === 0) return { transactionsSent: 0, feesLamports: 0n }
  const { Connection, Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } = await import('@solana/web3.js')
  const rpc = new Connection(o.rpcUrl, 'confirmed')
  const owner = new PublicKey(o.owner)
  let transactionsSent = 0
  let feesLamports = 0n
  await Promise.all(
    o.extraKeys.map(async ({ secret }) => {
      const kp = Keypair.fromSeed(fromBase64(secret))
      const balance = await rpc.getBalance(kp.publicKey, 'confirmed')
      const fee = Number(SIGNATURE_LAMPORTS)
      if (balance <= fee) return
      const life = await rpc.getLatestBlockhash('confirmed')
      const message = new TransactionMessage({
        payerKey: kp.publicKey,
        recentBlockhash: life.blockhash,
        instructions: [SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: owner, lamports: balance - fee })],
      }).compileToV0Message()
      const tx = new VersionedTransaction(message)
      tx.sign([kp])
      const sig = await rpc.sendRawTransaction(tx.serialize(), { maxRetries: 0 })
      await landed(rpc, sig, life.lastValidBlockHeight)
      transactionsSent++
      feesLamports += txFeeLamports(tx)
    }),
  )
  return { transactionsSent, feesLamports }
}

// Adds the upload key's signature to a transaction the API built.
export async function signWithUploadKey(transactionBase64: string, secret: string): Promise<string> {
  const { Keypair, VersionedTransaction } = await import('@solana/web3.js')
  const tx = VersionedTransaction.deserialize(fromBase64(transactionBase64))
  tx.sign([Keypair.fromSeed(fromBase64(secret))])
  return toBase64(tx.serialize())
}

// ---------- the weights accounts ----------

type Rpc = InstanceType<typeof import('@solana/web3.js').Connection>

async function landed(rpc: Rpc, signature: string, lastValidBlockHeight: number): Promise<void> {
  for (;;) {
    const st = (await rpc.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0]
    if (st?.err) throw new TxError('The chain refused the weights account.', 'confirm', true)
    if (st?.confirmationStatus === 'confirmed' || st?.confirmationStatus === 'finalized') return
    if ((await rpc.getBlockHeight('confirmed')) > lastValidBlockHeight) throw new TxError('The weights account did not confirm in time. Nothing was created.', 'confirm', true, 'Create the model again.')
    await new Promise((r) => setTimeout(r, 600))
  }
}

// The program writes into accounts that already exist: each one is allocated by the owner, one signature
// each, before the model is created. An account a past attempt already allocated is kept.
// The addresses are drawn first, so the API can quote the create transaction for them before any rent is spent.
export async function planWeights(
  sizeBytes: number,
  known?: string[],
  derived?: { addresses: string[]; secrets: (Uint8Array | null)[] } | null,
): Promise<{ addresses: string[]; secrets: (Uint8Array | null)[] }> {
  const { Keypair } = await import('@solana/web3.js')
  const addresses: string[] = []
  const secrets: (Uint8Array | null)[] = []
  for (let i = 0; i < weightsCount(sizeBytes); i++) {
    if (known?.[i]) { addresses.push(known[i]!); secrets.push(null); continue }
    if (derived?.addresses[i]) { addresses.push(derived.addresses[i]!); secrets.push(derived.secrets[i] ?? null); continue }
    const k = Keypair.generate()
    addresses.push(k.publicKey.toBase58())
    secrets.push(k.secretKey)
  }
  return { addresses, secrets }
}

export async function allocateWeights(o: {
  rpcUrl: string; programId: string; owner: string; sizeBytes: number; known?: string[]
  plan?: { addresses: string[]; secrets: (Uint8Array | null)[] }
  onStage?: (s: 'signing' | 'confirming') => void; onAllocated?: (addresses: string[], feeLamports: bigint) => void
}): Promise<{ addresses: string[]; transactionsSent: number; feesLamports: bigint }> {
  const { Connection, Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } = await import('@solana/web3.js')
  const rpc = new Connection(o.rpcUrl, 'confirmed')
  const program = new PublicKey(o.programId)
  const owner = new PublicKey(o.owner)
  const out: string[] = []
  let transactionsSent = 0
  let feesLamports = 0n
  for (let i = 0; i < weightsCount(o.sizeBytes); i++) {
    const space = WEIGHTS_HEADER + Math.min(WEIGHTS_CAPACITY, o.sizeBytes - i * WEIGHTS_CAPACITY)
    const before = o.known?.[i]
    if (before) {
      const info = await rpc.getAccountInfo(new PublicKey(before), 'confirmed')
      if (info && info.owner.equals(program) && info.data.length === space) { out.push(before); continue }
    }
    const rent = await rpc.getMinimumBalanceForRentExemption(space)
    if ((await rpc.getBalance(owner, 'confirmed')) < rent) {
      throw new TxError(`The wallet holds too little SOL. This weights account takes ${(rent / 1e9).toFixed(4)} SOL of rent.`, 'build', true, 'Add SOL to the wallet, then create the model again.')
    }
    const planned = o.plan?.secrets[i]
    const account = planned ? Keypair.fromSecretKey(planned) : Keypair.generate()
    const life = await rpc.getLatestBlockhash('confirmed')
    const message = new TransactionMessage({
      payerKey: owner, recentBlockhash: life.blockhash,
      instructions: [SystemProgram.createAccount({ fromPubkey: owner, newAccountPubkey: account.publicKey, lamports: rent, space, programId: program })],
    }).compileToV0Message()
    o.onStage?.('signing')
    let signed: Uint8Array
    try {
      signed = await signTransaction(wallet.connection(), new VersionedTransaction(message).serialize())
    } catch (e) {
      const f = walletFailure(e)
      throw new TxError(f.message, f.stage, f.retryable, f.nextStep)
    }
    // The wallet signs first; the new account's own key signs what the wallet returned.
    const tx = VersionedTransaction.deserialize(signed)
    tx.sign([account])
    const fee = txFeeLamports(tx)
    o.onStage?.('confirming')
    let signature: string
    try {
      signature = await rpc.sendRawTransaction(tx.serialize(), { maxRetries: 0 })
    } catch {
      throw new TxError('The chain refused the weights account.', 'send', true, 'Check the wallet holds enough SOL for its rent, then create the model again.')
    }
    await landed(rpc, signature, life.lastValidBlockHeight)
    transactionsSent++
    feesLamports += fee
    out.push(account.publicKey.toBase58())
    o.onAllocated?.([...out], fee)
  }
  return { addresses: out, transactionsSent, feesLamports }
}

// ---------- chunks ----------

export const chunkCount = (size: number, chunkBytes: number = WRITE_BYTES) => Math.ceil(size / chunkBytes)

// One flag per chunk: 1 where the chain already holds every byte of it.
export function chunkFlags(size: number, ranges: ByteRange[], chunkBytes: number = WRITE_BYTES): Uint8Array {
  const flags = new Uint8Array(chunkCount(size, chunkBytes))
  for (let i = 0; i < flags.length; i++) {
    const a = i * chunkBytes
    const b = Math.min(size, a + chunkBytes)
    if (ranges.some((r) => r.offset <= a && r.offset + r.length >= b)) flags[i] = 1
  }
  return flags
}

export function progressOf(size: number, flags: Uint8Array, chunkBytes: number = WRITE_BYTES): { bytes: number; transactions: number; firstUnwritten: number | null } {
  let bytes = 0
  let transactions = 0
  let first: number | null = null
  for (let i = 0; i < flags.length; i++) {
    if (flags[i]) { transactions++; bytes += Math.min(size, (i + 1) * chunkBytes) - i * chunkBytes } else if (first === null) first = i * chunkBytes
  }
  return { bytes, transactions, firstUnwritten: first }
}

// What the upload key(s) are funded with: signature fees for every write, attach_weights and seal_range batches,
// retry margin, plus per-key rent and sweep fees.
export function uploadFunding(size: number, chunkBytes: number = WRITE_BYTES, keyCount = 1): bigint {
  const n = chunkCount(size, chunkBytes)
  const k = BigInt(Math.max(1, keyCount))
  const extraTxs = BigInt(attachBatchCount(weightsCount(size)) + sealRangeCount(size))
  const writeFees = (BigInt(n + Math.max(8, Math.ceil(n / 10))) + extraTxs) * SIGNATURE_LAMPORTS
  if (k === 1n) return writeFees
  const extraSweeps = (k - 1n) * SIGNATURE_LAMPORTS
  return writeFees + extraSweeps + k * UPLOAD_KEY_RENT_LAMPORTS
}

const settled = (s: TxStatus['status']) => s === 'confirmed' || s === 'finalized' || s === 'failed' || s === 'expired'

async function relayUploadSigned(
  client: VoynichClient,
  build: { id: string; transactionBase64: string; requiredSigners: string[]; fixture: boolean },
  uploadSecret: string | undefined,
  failMessage: string,
): Promise<{ transactionsSent: number; feesLamports: bigint }> {
  let signed = build.transactionBase64
  if (!build.fixture) {
    if (!uploadSecret) throw new Error('The upload key is not on this device.')
    signed = await signWithUploadKey(signed, uploadSecret)
  }
  const fee = await buildFeeLamports({ transactionBase64: signed, requiredSigners: build.requiredSigners, fixture: build.fixture })
  let status = await client.submitTransaction({ mode: 'relay', buildId: build.id, signedTransactionBase64: signed, idempotencyKey: build.id })
  const started = performance.now()
  while (!settled(status.status) && performance.now() - started < 90_000) {
    await new Promise((r) => setTimeout(r, WRITE_POLL_MS))
    try { status = await client.transaction(status.id) } catch {}
  }
  if (status.status !== 'confirmed' && status.status !== 'finalized') throw new Error(status.error?.message ?? failMessage)
  return { transactionsSent: 1, feesLamports: fee }
}

// Attaches extra preallocated Weights accounts beyond INITIAL_CREATE_WEIGHTS in batches of ATTACH_WEIGHTS_BATCH,
// signed locally by the primary upload key (no owner wallet prompt).
export async function attachWeights(o: {
  client: VoynichClient
  model: string
  extraWeights: readonly string[]
  uploadKey: string
  uploadSecret?: string
  onBatch?: (attached: number, total: number, delta: { transactionsSent: number; feesLamports: bigint }) => void
}): Promise<{ transactionsSent: number; feesLamports: bigint }> {
  if (o.extraWeights.length === 0) return { transactionsSent: 0, feesLamports: 0n }
  let transactionsSent = 0
  let feesLamports = 0n
  for (let i = 0; i < o.extraWeights.length; i += ATTACH_WEIGHTS_BATCH) {
    const batch = o.extraWeights.slice(i, i + ATTACH_WEIGHTS_BATCH)
    const build = await o.client.attachWeights(o.model, { wallet: o.uploadKey, weights: batch })
    const delta = await relayUploadSigned(o.client, build, o.uploadSecret, 'Attaching extra weights accounts did not confirm.')
    transactionsSent += delta.transactionsSent
    feesLamports += delta.feesLamports
    o.onBatch?.(Math.min(o.extraWeights.length, i + batch.length), o.extraWeights.length, delta)
  }
  return { transactionsSent, feesLamports }
}

// Hashes 64 KiB ciphertext chunks into the on-chain Merkle frontier via seal_range (signed locally by uploadKey),
// leaving at most SEAL_RANGE_CHUNKS (8) final chunks for seal_model to fold inline.
export async function sealRanges(o: {
  client: VoynichClient
  model: string
  sizeBytes: number
  sealedChunks?: number
  uploadKey: string
  uploadSecret?: string
  onRange?: (doneChunks: number, totalChunks: number, delta: { transactionsSent: number; feesLamports: bigint }) => void
}): Promise<{ sealedChunks: number; transactionsSent: number; feesLamports: bigint }> {
  const totalChunks = sealChunkCount(o.sizeBytes)
  let done = Math.max(0, o.sealedChunks ?? 0)
  let transactionsSent = 0
  let feesLamports = 0n
  while (totalChunks - done > SEAL_RANGE_CHUNKS) {
    const count = Math.min(SEAL_RANGE_CHUNKS, totalChunks - done)
    const build = await o.client.sealRange(o.model, { wallet: o.uploadKey, chunkCount: count })
    const delta = await relayUploadSigned(o.client, build, o.uploadSecret, 'A seal_range batch did not confirm.')
    done += count
    transactionsSent += delta.transactionsSent
    feesLamports += delta.feesLamports
    o.onRange?.(done, totalChunks, delta)
  }
  return { sealedChunks: done, transactionsSent, feesLamports }
}

async function writePart(client: VoynichClient, model: string, ciphertext: Uint8Array, offset: number, end: number, uploadKey: string, uploadSecret: string | undefined): Promise<{ transactionsSent: number; feesLamports: bigint }> {
  const build = await client.writeWeights(model, { wallet: uploadKey, offset, bytesBase64: toBase64(ciphertext.subarray(offset, end)) })
  return relayUploadSigned(client, build, uploadSecret, 'A write did not confirm.')
}

// One chunk is one write, except where it crosses from one weights account into the next: a write stays inside one account.
async function writeOne(client: VoynichClient, model: string, ciphertext: Uint8Array, index: number, uploadKey: string, uploadSecret: string | undefined, chunkBytes: number = WRITE_BYTES): Promise<{ transactionsSent: number; feesLamports: bigint }> {
  const offset = index * chunkBytes
  const end = Math.min(ciphertext.length, offset + chunkBytes)
  const edge = (Math.floor(offset / WEIGHTS_CAPACITY) + 1) * WEIGHTS_CAPACITY
  if (edge < end) {
    const a = await writePart(client, model, ciphertext, offset, edge, uploadKey, uploadSecret)
    const b = await writePart(client, model, ciphertext, edge, end, uploadKey, uploadSecret)
    return { transactionsSent: a.transactionsSent + b.transactionsSent, feesLamports: a.feesLamports + b.feesLamports }
  }
  return writePart(client, model, ciphertext, offset, end, uploadKey, uploadSecret)
}

// Writes every chunk whose flag is 0, partitioning contiguous slices across all upload keys in parallel.
// The first failure stops new writes; what landed stays flagged.
export async function writeChunks(o: {
  client: VoynichClient; model: string; ciphertext: Uint8Array; flags: Uint8Array
  uploadKey: string; uploadSecret?: string; uploadKeys?: string[]; uploadSecrets?: Record<string, string>
  chunkBytes?: number; onChunk: (delta: { transactionsSent: number; feesLamports: bigint }) => void; stop: { now: boolean }
}): Promise<{ transactionsSent: number; feesLamports: bigint }> {
  const chunkBytes = o.chunkBytes ?? WRITE_BYTES
  const todo: number[] = []
  o.flags.forEach((f, i) => { if (!f) todo.push(i) })
  if (todo.length === 0) return { transactionsSent: 0, feesLamports: 0n }

  const rawKeys = o.uploadKeys?.length ? o.uploadKeys : [o.uploadKey]
  const resolved = rawKeys.map((address) => ({
    address,
    secret: o.uploadSecrets?.[address] ?? (address === o.uploadKey ? o.uploadSecret : undefined),
  }))
  const withSecrets = resolved.filter((k) => !!k.secret)
  const activeKeys = (withSecrets.length ? withSecrets : resolved).slice(0, WRITE_PARALLEL)
  const slices = partitionChunks(todo, activeKeys.length)

  let failure: unknown = null
  let transactionsSent = 0
  let feesLamports = 0n

  const runKeyPool = async (key: { address: string; secret?: string }, slice: number[]) => {
    let next = 0
    const lanes = Math.min(WRITE_LANES_PER_KEY, slice.length)
    const worker = async () => {
      while (!failure && !o.stop.now) {
        const i = slice[next++]
        if (i === undefined) return
        try {
          const delta = await writeOne(o.client, o.model, o.ciphertext, i, key.address, key.secret, chunkBytes)
          o.flags[i] = 1
          transactionsSent += delta.transactionsSent
          feesLamports += delta.feesLamports
          o.onChunk(delta)
        } catch (e) { failure ??= e }
      }
    }
    await Promise.all(Array.from({ length: lanes }, worker))
  }

  await Promise.all(slices.map((slice, idx) => runKeyPool(activeKeys[idx]!, slice)))
  if (failure) throw failure
  return { transactionsSent, feesLamports }
}

// ---------- the Prepare form's values ----------

// A decimal amount as base units, or null when it is not one.
export function toBaseUnits(text: string, decimals: number): string | null {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(text.trim())
  if (!m) return null
  const frac = m[2] ?? ''
  if (frac.length > decimals) return null
  const v = BigInt(m[1]! + frac.padEnd(decimals, '0'))
  return v <= 18446744073709551615n ? v.toString() : null
}

export const parseShape = (text: string) => text.split(/[\s,x×]+/).filter(Boolean).map(Number)
export const parseLabels = (text: string) => text.split(/\r?\n|,/).map((l) => l.trim()).filter(Boolean)

// ---------- sealed adapter inspection & local base verification ----------

export type SealKind = 'full' | 'adapter'

export type AdapterSummary = {
  baseSha256: string
  format: 'onnx'
  tensorCount: number
  ops: Record<'replace' | 'delta' | 'lora', number>
}

export type BaseCheck = {
  fileName: string
  sizeBytes: number
  sha256: string
  compatible: boolean | null
  error: string | null
}

export function inspectAdapterBytes(bytes: Uint8Array): { ok: true; info: AdapterSummary } | { ok: false; error: string } {
  try {
    const decoded = decodeAdapter(bytes)
    const ops: Record<'replace' | 'delta' | 'lora', number> = { replace: 0, delta: 0, lora: 0 }
    for (const t of decoded.tensors) ops[t.op]++
    return {
      ok: true,
      info: {
        baseSha256: decoded.baseSha256,
        format: decoded.format,
        tensorCount: decoded.tensors.length,
        ops,
      },
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Not a valid voynich/adapter/v1 file.' }
  }
}

export function formatAdapterOps(info: AdapterSummary): string {
  const parts: string[] = []
  if (info.ops.lora) parts.push(`${info.ops.lora} lora`)
  if (info.ops.delta) parts.push(`${info.ops.delta} delta`)
  if (info.ops.replace) parts.push(`${info.ops.replace} replace`)
  return `${info.tensorCount} ${info.tensorCount === 1 ? 'tensor' : 'tensors'}${parts.length ? ` (${parts.join(', ')})` : ''}`
}

export function inferBaseFormat(fileName: string): ModelBaseFormat | null {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.onnx')) return 'onnx'
  if (lower.endsWith('.safetensors')) return 'safetensors'
  if (lower.endsWith('.gguf')) return 'gguf'
  return null
}

export function checkLocalBaseFile(
  baseBytes: Uint8Array,
  fileName: string,
  adapterBytes: Uint8Array | null,
  format: ModelBaseFormat,
): BaseCheck {
  const sha = toHex(sha256(baseBytes))
  const sizeBytes = baseBytes.length
  if (!adapterBytes) {
    return { fileName, sizeBytes, sha256: sha, compatible: null, error: null }
  }
  try {
    if (format === 'onnx') {
      verifyOnnxAdapterCompatibility(baseBytes, adapterBytes, sha)
    } else {
      const decoded = decodeAdapter(adapterBytes)
      if (decoded.baseSha256 !== sha) {
        throw new Error(`Adapter baseSha256 (${decoded.baseSha256.slice(0, 12)}...) does not match local base SHA-256 (${sha.slice(0, 12)}...).`)
      }
    }
    return { fileName, sizeBytes, sha256: sha, compatible: true, error: null }
  } catch (err) {
    return {
      fileName,
      sizeBytes,
      sha256: sha,
      compatible: false,
      error: err instanceof Error ? err.message : 'Local base file does not match this adapter.',
    }
  }
}
