import { readFile, rename, writeFile } from 'node:fs/promises'
import { scrypt } from 'node:crypto'
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { Keypair } from '@solana/web3.js'
import { randomBytes, fromBase64, toBase64, utf8 } from './crypto.js'
import type { SealResume } from './client.js'

async function derive(password: string, salt: Uint8Array) {
  return new Promise<Uint8Array>((resolve, reject) => scrypt(password, salt, 32, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(new Uint8Array(key))))
}
/** The ciphertext, model key and one-time upload key stay in one password-encrypted file. */
export async function saveOwnerFile(path: string, state: SealResume, password: string): Promise<void> {
  const salt = randomBytes(16), nonce = randomBytes(24), key = await derive(password, salt)
  try {
    const uploadKeys = state.uploadKeys?.length ? state.uploadKeys : [state.uploadKey]
    const payload = {
      model: state.model,
      ciphertext: toBase64(state.ciphertext),
      modelKey: toBase64(state.modelKey),
      uploadKey: toBase64(state.uploadKey.secretKey),
      uploadKeys: uploadKeys.map(pair => toBase64(pair.secretKey)),
      plaintextSizeBytes: state.plaintextSizeBytes,
      noncePrefix: toBase64(state.noncePrefix),
      weightsKeys: state.weightsKeys?.map(pair => toBase64(pair.secretKey)),
    }
    const encrypted = xchacha20poly1305(key, nonce).encrypt(utf8(JSON.stringify(payload)))
    await writeFile(path + '.tmp', JSON.stringify({ version: 1, kdf: 'scrypt-N131072-r8-p1', salt: toBase64(salt), nonce: toBase64(nonce), ciphertext: toBase64(encrypted) }) + '\n', { mode: 0o600 })
    await rename(path + '.tmp', path)
  } finally { key.fill(0) }
}
export async function loadOwnerFile(path: string, password: string): Promise<SealResume> {
  const file = JSON.parse(await readFile(path, 'utf8')) as { version: number; kdf: string; salt: string; nonce: string; ciphertext: string }
  if (file.version !== 1 || file.kdf !== 'scrypt-N131072-r8-p1') throw new Error('Unsupported owner key file format')
  const key = await derive(password, fromBase64(file.salt))
  try {
    const raw = JSON.parse(new TextDecoder().decode(xchacha20poly1305(key, fromBase64(file.nonce)).decrypt(fromBase64(file.ciphertext)))) as { model: string; ciphertext: string; modelKey: string; uploadKey: string; uploadKeys?: string[]; plaintextSizeBytes: number; noncePrefix: string; weightsKeys?: string[] }
    const uploadKey = Keypair.fromSecretKey(fromBase64(raw.uploadKey))
    const uploadKeys = raw.uploadKeys?.length ? raw.uploadKeys.map(value => Keypair.fromSecretKey(fromBase64(value))) : [uploadKey]
    return { model: raw.model, ciphertext: fromBase64(raw.ciphertext), modelKey: fromBase64(raw.modelKey), uploadKey, uploadKeys, plaintextSizeBytes: raw.plaintextSizeBytes, noncePrefix: fromBase64(raw.noncePrefix), weightsKeys: raw.weightsKeys?.map(value => Keypair.fromSecretKey(fromBase64(value))) }
  } finally { key.fill(0) }
}
