import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export function sealingKey(value = process.env.DEV_SEALING_KEY, localOperatorSecret?: Uint8Array): Buffer {
  // Named local stand-in only; remote clusters must supply an explicit sealing key.
  if (!value && process.env.CLUSTER === 'localnet' && localOperatorSecret) return createHash('sha256').update('voynich/dev-sealing/v1').update(localOperatorSecret).digest()
  if (!value || !/^[0-9a-fA-F]{64}$/.test(value)) throw new Error('DEV_SEALING_KEY must be a 32-byte hexadecimal development sealing key.')
  return Buffer.from(value, 'hex')
}

/** Development stand-in for hardware sealing; the key comes from the process environment. */
export function readSealed<T>(path: string, key: Uint8Array): T | null {
  if (!existsSync(path)) return null
  const envelope = JSON.parse(readFileSync(path, 'utf8')) as { version: number; nonce: string; tag: string; ciphertext: string }
  if (envelope.version !== 1) throw new Error('Unsupported development sealed-state version.')
  const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.nonce, 'base64'))
  cipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
  return JSON.parse(Buffer.concat([cipher.update(Buffer.from(envelope.ciphertext, 'base64')), cipher.final()]).toString('utf8')) as T
}

export function writeSealed(path: string, key: Uint8Array, value: unknown): void {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.tmp`
  writeFileSync(temporary, JSON.stringify({ version: 1, nonce: nonce.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') }) + '\n', { mode: 0o600 })
  renameSync(temporary, path)
}
