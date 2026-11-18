import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { ed25519, x25519 } from '@noble/curves/ed25519.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils.js'
import { Keypair, PublicKey } from '@solana/web3.js'

export { sha256, randomBytes }
export const toHex = bytesToHex
export const fromHex = hexToBytes
export const utf8 = (value: string): Uint8Array => new TextEncoder().encode(value)

export function toBase64(bytes: Uint8Array): string {
  let value = ''
  for (const byte of bytes) value += String.fromCharCode(byte)
  return btoa(value)
}

export function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0))
}

export const WEIGHTS_CIPHER = 'xchacha20poly1305-64k-v1' as const
export const WEIGHTS_CHUNK_BYTES = 65_536 as const
const TAG_BYTES = 16
export const CIPHER_CHUNK_BYTES = 65_552 as const
const CHUNK_HASH_DOMAIN = utf8('voynich/chunk/v1')
const NODE_HASH_DOMAIN = utf8('voynich/node/v1')
const ENVELOPE_VERSION = 1
const ENVELOPE_HEADER_BYTES = 1 + 32 + 24

export interface WeightsCipherHeader {
  cipher: typeof WEIGHTS_CIPHER
  /** Raw 16 bytes; base64 in the HTTP contract. */
  noncePrefix: Uint8Array
  plaintextBytes: number
  chunkBytes: typeof WEIGHTS_CHUNK_BYTES
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

function sized(bytes: Uint8Array, length: number, name: string): void {
  if (bytes.length !== length) throw new Error(`${name} must be ${length} bytes`)
}

function weightsNonce(prefix: Uint8Array, chunk: number): Uint8Array {
  const nonce = new Uint8Array(24)
  nonce.set(prefix)
  new DataView(nonce.buffer).setBigUint64(16, BigInt(chunk), true)
  return nonce
}

export function chunkLeafHash(chunkIndex: number, chunkBytes: Uint8Array): Uint8Array {
  const indexBytes = new Uint8Array(4)
  new DataView(indexBytes.buffer).setUint32(0, chunkIndex, true)
  return sha256(concat(CHUNK_HASH_DOMAIN, indexBytes, chunkBytes))
}

export function merkleParentHash(left: Uint8Array, right: Uint8Array): Uint8Array {
  sized(left, 32, 'Merkle left hash')
  sized(right, 32, 'Merkle right hash')
  return sha256(concat(NODE_HASH_DOMAIN, left, right))
}

/** Computes the voynich/node/v1 binary Merkle root directly from precomputed 32-byte chunk leaf hashes. */
export function merkleRootFromLeaves(leaves: readonly Uint8Array[]): Uint8Array {
  if (leaves.length === 0) throw new Error('Merkle tree requires at least one leaf')
  const frontier: (Uint8Array | undefined)[] = []
  let mask = 0
  for (const leaf of leaves) {
    sized(leaf, 32, 'Merkle leaf hash')
    let h = leaf
    let level = 0
    while ((mask & (1 << level)) !== 0) {
      const left = frontier[level]!
      mask &= ~(1 << level)
      h = merkleParentHash(left, h)
      level++
    }
    frontier[level] = h
    mask |= 1 << level
  }
  let acc: Uint8Array | undefined
  for (let level = 0; level < frontier.length; level++) {
    if ((mask & (1 << level)) !== 0) {
      const peak = frontier[level]!
      acc = acc === undefined ? peak : merkleParentHash(peak, acc)
    }
  }
  if (!acc) throw new Error('Merkle tree requires at least one leaf')
  return acc
}

/** Domain-separated binary Merkle root over 65,552-byte ciphertext chunks matching on-chain seal_range. */
export function ciphertextMerkleRoot(ciphertext: Uint8Array): Uint8Array {
  if (ciphertext.length === 0) throw new Error('Ciphertext must not be empty')
  const leaves: Uint8Array[] = []
  for (let offset = 0, index = 0; offset < ciphertext.length; offset += CIPHER_CHUNK_BYTES, index++) {
    leaves.push(chunkLeafHash(index, ciphertext.subarray(offset, Math.min(offset + CIPHER_CHUNK_BYTES, ciphertext.length))))
  }
  return merkleRootFromLeaves(leaves)
}

export function ciphertextHash(ciphertext: Uint8Array, hashVersion = 1): Uint8Array {
  return hashVersion === 0 ? sha256(ciphertext) : ciphertextMerkleRoot(ciphertext)
}

export interface SealedWeights {
  key: Uint8Array
  header: WeightsCipherHeader
  ciphertext: Uint8Array
  sha256: Uint8Array
  merkleRoot: Uint8Array
}

/** Fresh seals choose a random nonce prefix; an original key and header reconstruct a saved seal. */
export function sealWeights(plaintext: Uint8Array, key?: Uint8Array): SealedWeights
export function sealWeights(plaintext: Uint8Array, key: Uint8Array, header: WeightsCipherHeader): SealedWeights
export function sealWeights(plaintext: Uint8Array, key?: Uint8Array, cipherHeader?: WeightsCipherHeader): SealedWeights {
  if (cipherHeader && key === undefined) throw new Error('Reconstructing a seal requires the original model key')
  const modelKey = key === undefined ? randomBytes(32) : key
  sized(modelKey, 32, 'Model key')
  const header: WeightsCipherHeader = cipherHeader ?? {
    cipher: WEIGHTS_CIPHER,
    noncePrefix: randomBytes(16),
    plaintextBytes: plaintext.length,
    chunkBytes: WEIGHTS_CHUNK_BYTES,
  }
  if (cipherHeader) {
    if (header.cipher !== WEIGHTS_CIPHER || header.chunkBytes !== WEIGHTS_CHUNK_BYTES) throw new Error('Unsupported weights cipher')
    sized(header.noncePrefix, 16, 'Weights nonce prefix')
    if (header.plaintextBytes !== plaintext.length) throw new Error('The weights length does not match the original cipher header')
  }
  const ciphertext = new Uint8Array(plaintext.length + Math.ceil(plaintext.length / WEIGHTS_CHUNK_BYTES) * TAG_BYTES)
  for (let offset = 0, chunk = 0; offset < plaintext.length; offset += WEIGHTS_CHUNK_BYTES, chunk++) {
    const sealed = xchacha20poly1305(modelKey, weightsNonce(header.noncePrefix, chunk))
      .encrypt(plaintext.subarray(offset, offset + WEIGHTS_CHUNK_BYTES))
    ciphertext.set(sealed, chunk * (WEIGHTS_CHUNK_BYTES + TAG_BYTES))
  }
  return { key: modelKey, header, ciphertext, sha256: sha256(ciphertext), merkleRoot: ciphertextMerkleRoot(ciphertext) }
}

/** Maps a plaintext range to the complete sealed chunks needed to authenticate it. */
export function weightsCipherRange(header: WeightsCipherHeader, offset: number, length: number): {
  offset: number
  length: number
  firstChunk: number
} {
  if (header.cipher !== WEIGHTS_CIPHER || header.chunkBytes !== WEIGHTS_CHUNK_BYTES) throw new Error('Unsupported weights cipher')
  sized(header.noncePrefix, 16, 'Weights nonce prefix')
  if (!Number.isSafeInteger(header.plaintextBytes) || header.plaintextBytes < 0 ||
      !Number.isSafeInteger(offset) || !Number.isSafeInteger(length) ||
      offset < 0 || length < 0 || offset + length > header.plaintextBytes) {
    throw new Error('Weights range is outside the plaintext')
  }
  const firstChunk = Math.floor(offset / WEIGHTS_CHUNK_BYTES)
  const cipherOffset = firstChunk * (WEIGHTS_CHUNK_BYTES + TAG_BYTES)
  if (length === 0) return { offset: cipherOffset, length: 0, firstChunk }
  const lastChunk = Math.floor((offset + length - 1) / WEIGHTS_CHUNK_BYTES)
  const lastPlaintextBytes = Math.min(WEIGHTS_CHUNK_BYTES, header.plaintextBytes - lastChunk * WEIGHTS_CHUNK_BYTES)
  const cipherEnd = lastChunk * (WEIGHTS_CHUNK_BYTES + TAG_BYTES) + lastPlaintextBytes + TAG_BYTES
  return { offset: cipherOffset, length: cipherEnd - cipherOffset, firstChunk }
}

/**
 * Decrypts a plaintext range from the ciphertext slice returned by weightsCipherRange.
 * Every intersecting chunk, including bytes outside the requested plaintext range,
 * is authenticated before any plaintext is returned.
 */
export function openWeightsRange(
  ciphertextRange: Uint8Array,
  key: Uint8Array,
  header: WeightsCipherHeader,
  offset: number,
  length: number,
): Uint8Array {
  sized(key, 32, 'Model key')
  const range = weightsCipherRange(header, offset, length)
  sized(ciphertextRange, range.length, 'Weights ciphertext range')
  if (length === 0) return new Uint8Array()
  const plaintext = new Uint8Array(length)
  for (let cursor = 0, chunk = range.firstChunk; cursor < ciphertextRange.length; chunk++) {
    const chunkStart = chunk * WEIGHTS_CHUNK_BYTES
    const chunkLength = Math.min(WEIGHTS_CHUNK_BYTES, header.plaintextBytes - chunkStart)
    const sealedLength = chunkLength + TAG_BYTES
    const opened = xchacha20poly1305(key, weightsNonce(header.noncePrefix, chunk))
      .decrypt(ciphertextRange.subarray(cursor, cursor + sealedLength))
    const start = Math.max(offset, chunkStart)
    const end = Math.min(offset + length, chunkStart + chunkLength)
    plaintext.set(opened.subarray(start - chunkStart, end - chunkStart), start - offset)
    cursor += sealedLength
  }
  return plaintext
}

/**
 * Authenticates and decrypts a single 64 KiB ciphertext chunk while returning its
 * voynich/chunk/v1 Merkle leaf hash in one pass.
 */
export function openWeightsChunk(
  chunkCiphertext: Uint8Array,
  chunkIndex: number,
  key: Uint8Array,
  header: WeightsCipherHeader,
): { plaintext: Uint8Array; leafHash: Uint8Array } {
  sized(key, 32, 'Model key')
  if (header.cipher !== WEIGHTS_CIPHER || header.chunkBytes !== WEIGHTS_CHUNK_BYTES) throw new Error('Unsupported weights cipher')
  sized(header.noncePrefix, 16, 'Weights nonce prefix')
  if (!Number.isSafeInteger(header.plaintextBytes) || header.plaintextBytes <= 0 || !Number.isSafeInteger(chunkIndex) || chunkIndex < 0) {
    throw new Error('Weights chunk index is outside the plaintext')
  }
  const chunkStart = chunkIndex * WEIGHTS_CHUNK_BYTES
  if (chunkStart >= header.plaintextBytes) throw new Error('Weights chunk index is outside the plaintext')
  const expectedPlaintextBytes = Math.min(WEIGHTS_CHUNK_BYTES, header.plaintextBytes - chunkStart)
  sized(chunkCiphertext, expectedPlaintextBytes + TAG_BYTES, 'Weights ciphertext chunk')
  const plaintext = xchacha20poly1305(key, weightsNonce(header.noncePrefix, chunkIndex)).decrypt(chunkCiphertext)
  const leafHash = chunkLeafHash(chunkIndex, chunkCiphertext)
  return { plaintext, leafHash }
}

export const generateEncryptionKeyPair = (): { secretKey: Uint8Array; publicKey: Uint8Array } => x25519.keygen()
export const encryptionPublicKey = (secretKey: Uint8Array): Uint8Array => x25519.getPublicKey(secretKey)
export const signingPublicKey = (seed: Uint8Array): Uint8Array => ed25519.getPublicKey(seed)

type EnvelopeContext = 'voynich/grant/v1' | 'voynich/call-input/v1' | 'voynich/call-output/v1'

function envelopeKey(secretKey: Uint8Array, peerPublicKey: Uint8Array, sender: Uint8Array, recipient: Uint8Array, context: EnvelopeContext): Uint8Array {
  const shared = x25519.getSharedSecret(secretKey, peerPublicKey)
  // RFC 5869: IKM = X25519 shared secret, salt = sender || recipient, info = UTF-8 context.
  return hkdf(sha256, shared, concat(sender, recipient), utf8(context), 32)
}

/** Wire: 0x01 || ephemeral X25519 public key (32) || nonce (24) || ciphertext || tag (16). No AAD. */
function encryptEnvelope(plaintext: Uint8Array, recipient: Uint8Array, context: EnvelopeContext): Uint8Array {
  sized(recipient, 32, 'Recipient encryption key')
  const sender = generateEncryptionKeyPair()
  const nonce = randomBytes(24)
  const key = envelopeKey(sender.secretKey, recipient, sender.publicKey, recipient, context)
  const ciphertext = xchacha20poly1305(key, nonce).encrypt(plaintext)
  return concat(Uint8Array.of(ENVELOPE_VERSION), sender.publicKey, nonce, ciphertext)
}

function decryptEnvelope(envelope: Uint8Array, recipientSecret: Uint8Array, context: EnvelopeContext): Uint8Array {
  if (envelope.length < ENVELOPE_HEADER_BYTES + TAG_BYTES || envelope[0] !== ENVELOPE_VERSION) throw new Error('Invalid v1 encrypted envelope')
  sized(recipientSecret, 32, 'Recipient encryption secret')
  const sender = envelope.subarray(1, 33)
  const nonce = envelope.subarray(33, ENVELOPE_HEADER_BYTES)
  const recipient = encryptionPublicKey(recipientSecret)
  const key = envelopeKey(recipientSecret, sender, sender, recipient, context)
  return xchacha20poly1305(key, nonce).decrypt(envelope.subarray(ENVELOPE_HEADER_BYTES))
}

export function wrapKey(key: Uint8Array, recipientPublicKey: Uint8Array): Uint8Array {
  sized(key, 32, 'Model key')
  return encryptEnvelope(key, recipientPublicKey, 'voynich/grant/v1')
}

export function unwrapKey(envelope: Uint8Array, recipientSecret: Uint8Array): Uint8Array {
  const key = decryptEnvelope(envelope, recipientSecret, 'voynich/grant/v1')
  sized(key, 32, 'Unwrapped model key')
  return key
}

/** Input plaintext is UTF-8 JSON { input, outputPublicKey }, with a base64 reply public key. */
export const encryptCallInput = (plaintext: Uint8Array, enclavePublicKey: Uint8Array): Uint8Array =>
  encryptEnvelope(plaintext, enclavePublicKey, 'voynich/call-input/v1')
export const decryptCallInput = (envelope: Uint8Array, enclaveSecret: Uint8Array): Uint8Array =>
  decryptEnvelope(envelope, enclaveSecret, 'voynich/call-input/v1')
export const encryptCallOutput = (plaintext: Uint8Array, callerPublicKey: Uint8Array): Uint8Array =>
  encryptEnvelope(plaintext, callerPublicKey, 'voynich/call-output/v1')
export const decryptCallOutput = (envelope: Uint8Array, callerSecret: Uint8Array): Uint8Array =>
  decryptEnvelope(envelope, callerSecret, 'voynich/call-output/v1')

/** Domain bytes have no trailing NUL or length prefix; addresses and hashes are raw 32-byte values.
 * When baseSha256 (32B) is provided, produces the 146-byte voynich/receipt/v2 message;
 * otherwise produces the 114-byte voynich/receipt/v1 message. */
export function receiptMessage(call: Uint8Array, inputHash: Uint8Array, outputHash: Uint8Array, baseSha256?: Uint8Array | null): Uint8Array {
  sized(call, 32, 'Call address')
  sized(inputHash, 32, 'Input hash')
  sized(outputHash, 32, 'Output hash')
  if (baseSha256 != null) {
    sized(baseSha256, 32, 'Base SHA-256')
    return concat(utf8('voynich/receipt/v2'), call, inputHash, outputHash, baseSha256)
  }
  return concat(utf8('voynich/receipt/v1'), call, inputHash, outputHash)
}

export function signReceipt(seed: Uint8Array, call: Uint8Array, inputHash: Uint8Array, outputHash: Uint8Array, baseSha256?: Uint8Array | null): Uint8Array {
  return ed25519.sign(receiptMessage(call, inputHash, outputHash, baseSha256), seed)
}

export function verifyReceipt(signature: Uint8Array, signingKey: Uint8Array, call: Uint8Array, inputHash: Uint8Array, outputHash: Uint8Array, baseSha256?: Uint8Array | null): boolean {
  if (signature.length !== 64 || signingKey.length !== 32) return false
  if (baseSha256 != null && baseSha256.length !== 32) return false
  return ed25519.verify(signature, receiptMessage(call, inputHash, outputHash, baseSha256), signingKey, { zip215: false })
}

const STREAM_INIT_DOMAIN = utf8('voynich/stream-init/v1')
const STREAM_PIECE_DOMAIN = utf8('voynich/stream-piece/v1')
const PIECE_V1_DOMAIN = utf8('voynich/piece/v1')
const PIECE_V2_DOMAIN = utf8('voynich/piece/v2')

function encodeU64Le(value: number | bigint, name: string): Uint8Array {
  const big = typeof value === 'bigint' ? value : BigInt(value)
  if (big < 0n || big > 0xffff_ffff_ffff_ffffn) throw new Error(`${name} must be a valid unsigned 64-bit integer`)
  const out = new Uint8Array(8)
  new DataView(out.buffer).setBigUint64(0, big, true)
  return out
}

/** Initial 32-byte running hash binding a metered stream to one Call and encrypted input hash. */
export function streamInitialHash(call: Uint8Array, inputHash: Uint8Array): Uint8Array {
  sized(call, 32, 'Call address')
  sized(inputHash, 32, 'Input hash')
  return sha256(concat(STREAM_INIT_DOMAIN, call, inputHash))
}

/** Advances the 32-byte stream running hash with cumulative token count and encrypted piece bytes. */
export function streamNextHash(prevHash: Uint8Array, count: number | bigint, pieceBytes: Uint8Array): Uint8Array {
  sized(prevHash, 32, 'Previous running hash')
  return sha256(concat(STREAM_PIECE_DOMAIN, prevHash, encodeU64Le(count, 'Token count'), sha256(pieceBytes)))
}

/**
 * Domain-separated piece signature message:
 * - 120 bytes (voynich/piece/v1) for standalone models (baseSha256 omitted/null)
 * - 152 bytes (voynich/piece/v2) for adapter models (32-byte baseSha256 appended)
 */
export function pieceMessage(
  call: Uint8Array,
  inputHash: Uint8Array,
  count: number | bigint,
  runningHash: Uint8Array,
  baseSha256?: Uint8Array | null,
): Uint8Array {
  sized(call, 32, 'Call address')
  sized(inputHash, 32, 'Input hash')
  sized(runningHash, 32, 'Running hash')
  const countBytes = encodeU64Le(count, 'Token count')
  if (baseSha256 != null) {
    sized(baseSha256, 32, 'Base SHA-256')
    return concat(PIECE_V2_DOMAIN, call, inputHash, countBytes, runningHash, baseSha256)
  }
  return concat(PIECE_V1_DOMAIN, call, inputHash, countBytes, runningHash)
}

export function signPiece(
  seed: Uint8Array,
  call: Uint8Array,
  inputHash: Uint8Array,
  count: number | bigint,
  runningHash: Uint8Array,
  baseSha256?: Uint8Array | null,
): Uint8Array {
  return ed25519.sign(pieceMessage(call, inputHash, count, runningHash, baseSha256), seed)
}

export function verifyPiece(
  signature: Uint8Array,
  signingKey: Uint8Array,
  call: Uint8Array,
  inputHash: Uint8Array,
  count: number | bigint,
  runningHash: Uint8Array,
  baseSha256?: Uint8Array | null,
): boolean {
  if (signature.length !== 64 || signingKey.length !== 32) return false
  if (baseSha256 != null && baseSha256.length !== 32) return false
  try {
    return ed25519.verify(signature, pieceMessage(call, inputHash, count, runningHash, baseSha256), signingKey, { zip215: false })
  } catch {
    return false
  }
}

export const SEAL_DERIVATION_UPLOAD_KEYS = 8 as const
const SEAL_DERIVATION_SALT = utf8('voynich/seal-secrets/v1')

export type SealDerivationSigner =
  | Keypair
  | { publicKey: PublicKey; signMessage(message: Uint8Array): Promise<Uint8Array> }

export interface DerivedSealSecrets {
  signature: Uint8Array
  modelKey: Uint8Array
  noncePrefix: Uint8Array
  uploadKey: Keypair
  uploadKeys: Keypair[]
  weightsKeys: Keypair[]
}

/** Canonical domain-separated message signed by the model owner to derive resumable sealing secrets. */
export function sealDerivationMessage(programId: string | PublicKey, modelAddress: string | PublicKey): Uint8Array {
  const program = typeof programId === 'string' ? new PublicKey(programId).toBase58() : programId.toBase58()
  const model = typeof modelAddress === 'string' ? new PublicKey(modelAddress).toBase58() : modelAddress.toBase58()
  return utf8(`voynich/seal/v1\nprogram: ${program}\nmodel: ${model}`)
}

/** Enforces canonical 64-byte Ed25519 signature verification over a seal derivation message. */
export function verifySealDerivationSignature(
  message: Uint8Array,
  signature: Uint8Array,
  ownerPublicKey: Uint8Array | PublicKey | string,
): boolean {
  if (signature.length !== 64) return false
  let ownerBytes: Uint8Array
  try {
    ownerBytes = ownerPublicKey instanceof Uint8Array
      ? ownerPublicKey
      : typeof ownerPublicKey === 'string'
        ? new PublicKey(ownerPublicKey).toBytes()
        : ownerPublicKey.toBytes()
  } catch {
    return false
  }
  if (ownerBytes.length !== 32) return false
  return ed25519.verify(signature, message, ownerBytes, { zip215: false })
}

/**
 * Deterministically derives the model encryption key, weights cipher nonce prefix,
 * upload key pool (default 8), and optional Weights account keypairs from a verified 64-byte signature.
 */
export function deriveSealSecrets(
  signature: Uint8Array,
  options: { uploadKeyCount?: number; weightsKeyCount?: number } = {},
): DerivedSealSecrets {
  sized(signature, 64, 'Seal derivation signature')
  const uploadKeyCount = options.uploadKeyCount ?? SEAL_DERIVATION_UPLOAD_KEYS
  const weightsKeyCount = options.weightsKeyCount ?? 0
  if (!Number.isSafeInteger(uploadKeyCount) || uploadKeyCount < 1 || uploadKeyCount > SEAL_DERIVATION_UPLOAD_KEYS) {
    throw new Error(`uploadKeyCount must be between 1 and ${SEAL_DERIVATION_UPLOAD_KEYS}`)
  }
  if (!Number.isSafeInteger(weightsKeyCount) || weightsKeyCount < 0 || weightsKeyCount > 64) {
    throw new Error('weightsKeyCount must be between 0 and 64')
  }
  const modelKey = hkdf(sha256, signature, SEAL_DERIVATION_SALT, utf8('model-key'), 32)
  const noncePrefix = hkdf(sha256, signature, SEAL_DERIVATION_SALT, utf8('nonce-prefix'), 16)
  const uploadKeys = Array.from({ length: uploadKeyCount }, (_, index) =>
    Keypair.fromSeed(hkdf(sha256, signature, SEAL_DERIVATION_SALT, utf8(`upload-key/${index}`), 32)),
  )
  const weightsKeys = Array.from({ length: weightsKeyCount }, (_, index) =>
    Keypair.fromSeed(hkdf(sha256, signature, SEAL_DERIVATION_SALT, utf8(`weights-key/${index}`), 32)),
  )
  return {
    signature: signature.slice(),
    modelKey,
    noncePrefix,
    uploadKey: uploadKeys[0]!,
    uploadKeys,
    weightsKeys,
  }
}

/**
 * Signs the canonical derivation message with a Keypair or async wallet signMessage callback,
 * verifies the returned Ed25519 signature, and derives deterministic seal secrets.
 */
export async function signSealDerivation(
  signer: SealDerivationSigner,
  programId: string | PublicKey,
  modelAddress: string | PublicKey,
  options: { uploadKeyCount?: number; weightsKeyCount?: number } = {},
): Promise<DerivedSealSecrets> {
  const message = sealDerivationMessage(programId, modelAddress)
  const raw = 'secretKey' in signer
    ? ed25519.sign(message, signer.secretKey.subarray(0, 32))
    : await signer.signMessage(message)
  const signature = raw instanceof Uint8Array ? raw : Uint8Array.from(raw)
  if (!verifySealDerivationSignature(message, signature, signer.publicKey)) {
    throw new Error('Seal derivation signature failed canonical Ed25519 verification')
  }
  return deriveSealSecrets(signature, options)
}
