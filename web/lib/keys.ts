'use client'

// The keys this browser keeps, in one record encrypted under one password.
// The password is stretched with scrypt (a random salt sits beside the record) and the key it gives
// encrypts every saved secret with XChaCha20-Poly1305: the model key the owner's device draws at sealing,
// and the upload key's secret while a seal is being written. That key is held for this page load only,
// so the password is entered once each time the site is opened. Nothing secret is stored in the clear.

import { useSyncExternalStore } from 'react'
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { scryptAsync } from '@noble/hashes/scrypt.js'
import { fromBase64, toBase64 } from '@voynich/contract'

const STORE = 'voynich.vault'
const OLD_MODEL_KEY = 'voynich.modelkey.' // what earlier versions wrote in the clear
const OLD_SEAL = 'voynich.seal'
const CIPHER = 'xchacha20poly1305'
const CHECK = 'voynich.vault.v1'
const SCRYPT = { N: 2 ** 16, r: 8, p: 1, dkLen: 32 } as const
export const PASSWORD_MIN = 8

type Kdf = { name: 'scrypt'; N: number; r: number; p: number; dkLen: number; salt: string }
type Box = { nonce: string; data: string }
type Vault = { version: 1; cipher: typeof CIPHER; kdf: Kdf; check: Box; items: Record<string, Box> }

const utf8 = new TextEncoder()
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n))

function derive(password: string, kdf: Kdf): Promise<Uint8Array> {
  return scryptAsync(utf8.encode(password.normalize('NFKC')), fromBase64(kdf.salt), { N: kdf.N, r: kdf.r, p: kdf.p, dkLen: kdf.dkLen, asyncTick: 20 })
}
// Each value is bound to the name it is saved under, so one cannot be put in another's place.
function box(key: Uint8Array, id: string, plain: Uint8Array): Box {
  const nonce = random(24)
  return { nonce: toBase64(nonce), data: toBase64(xchacha20poly1305(key, nonce, utf8.encode(id)).encrypt(plain)) }
}
function unbox(key: Uint8Array, id: string, b: Box): Uint8Array | null {
  try { return xchacha20poly1305(key, fromBase64(b.nonce), utf8.encode(id)).decrypt(fromBase64(b.data)) } catch { return null }
}
const usable = (k: Partial<Kdf> | undefined): k is Kdf =>
  !!k && k.name === 'scrypt' && typeof k.salt === 'string' && k.dkLen === 32
  && Number.isInteger(k.N) && k.N! >= 2 && k.N! <= 2 ** 20 && (k.N! & (k.N! - 1)) === 0
  && Number.isInteger(k.r) && k.r! >= 1 && k.r! <= 32 && Number.isInteger(k.p) && k.p! >= 1 && k.p! <= 16

// ---------- the record on disk and the key in memory ----------

let held: Uint8Array | null = null // the derived key, for this page load

function readVault(): Vault | null {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? 'null') as Vault | null
    return v && v.version === 1 && usable(v.kdf) && v.check && v.items ? v : null
  } catch { return null }
}
function writeVault(v: Vault) { localStorage.setItem(STORE, JSON.stringify(v)) }

function plainLeft(): boolean {
  try {
    for (let i = 0; i < localStorage.length; i++) if (localStorage.key(i)!.startsWith(OLD_MODEL_KEY)) return true
    return !!(JSON.parse(localStorage.getItem(OLD_SEAL) ?? 'null') as { uploadSecret?: string } | null)?.uploadSecret
  } catch { return false }
}

// Values an earlier version left in the clear go into the record, and the plain copies are removed.
function adopt(v: Vault, key: Uint8Array) {
  const names: string[] = []
  for (let i = 0; i < localStorage.length; i++) { const n = localStorage.key(i)!; if (n.startsWith(OLD_MODEL_KEY)) names.push(n) }
  for (const n of names) {
    try {
      const bytes = fromBase64(localStorage.getItem(n) ?? '')
      const id = `model:${n.slice(OLD_MODEL_KEY.length)}`
      if (bytes.length === 32 && !v.items[id]) v.items[id] = box(key, id, bytes)
    } catch {}
  }
  let seal: { uploadSecret?: string; uploadKey?: string } | null = null
  try { seal = JSON.parse(localStorage.getItem(OLD_SEAL) ?? 'null') } catch {}
  if (seal?.uploadSecret && seal.uploadKey) {
    const id = `upload:${seal.uploadKey}`
    try { v.items[id] = box(key, id, fromBase64(seal.uploadSecret)) } catch {}
  }
  writeVault(v)
  for (const n of names) localStorage.removeItem(n)
  if (seal?.uploadSecret) { delete seal.uploadSecret; localStorage.setItem(OLD_SEAL, JSON.stringify(seal)) }
}

// ---------- what components read ----------

export type VaultStatus = { exists: boolean; unlocked: boolean; plain: boolean } // plain: old clear values wait to be moved in
const NONE: VaultStatus = { exists: false, unlocked: false, plain: false }
let status: VaultStatus | null = null
const listeners = new Set<() => void>()
const measure = (): VaultStatus => ({ exists: !!readVault(), unlocked: !!held, plain: plainLeft() })
function changed() { status = measure(); listeners.forEach((l) => l()) }
function subscribe(l: () => void) {
  listeners.add(l)
  window.addEventListener('storage', changed)
  return () => { listeners.delete(l); window.removeEventListener('storage', changed) }
}
export function useVault(): VaultStatus {
  return useSyncExternalStore(subscribe, () => (status ??= measure()), () => NONE)
}
export const vaultExists = () => !!readVault()
export const vaultUnlocked = () => !!held

// ---------- the password ----------

// The first time a key has to be saved. With a record already there, this is an unlock.
export async function setVaultPassword(password: string): Promise<boolean> {
  if (readVault()) return unlockVault(password)
  const kdf: Kdf = { name: 'scrypt', ...SCRYPT, salt: toBase64(random(16)) }
  const key = await derive(password, kdf)
  const v: Vault = { version: 1, cipher: CIPHER, kdf, check: box(key, 'check', utf8.encode(CHECK)), items: {} }
  held = key
  adopt(v, key)
  changed()
  return true
}
// False when the password is not the one the record was made with.
export async function unlockVault(password: string): Promise<boolean> {
  const v = readVault()
  if (!v) return false
  const key = await derive(password, v.kdf)
  if (!unbox(key, 'check', v.check)) return false
  held = key
  if (plainLeft()) adopt(v, key)
  changed()
  return true
}

// ---------- saved secrets ----------

function put(id: string, plain: Uint8Array) {
  const v = readVault()
  if (!v || !held) throw new Error('Enter your password to save keys in this browser.')
  v.items[id] = box(held, id, plain)
  writeVault(v)
}
function take(id: string): Uint8Array | null {
  const v = readVault()
  const b = v?.items[id]
  return b && held ? unbox(held, id, b) : null
}

// By the model's address, or by its name before it has one.
export function saveModelKey(model: string, key: Uint8Array) { put(`model:${model}`, key) }
export function loadModelKey(model: string): Uint8Array | null { return take(`model:${model}`) }

// The one-time upload key(s) of a seal in progress, by address.
export function saveUploadSecret(uploadKey: string, secret: string) { put(`upload:${uploadKey}`, fromBase64(secret)) }
export function loadUploadSecret(uploadKey: string): string | null {
  const b = take(`upload:${uploadKey}`)
  return b ? toBase64(b) : null
}
export function forgetUploadSecret(uploadKey: string) {
  const v = readVault()
  if (!v?.items[`upload:${uploadKey}`]) return
  delete v.items[`upload:${uploadKey}`]
  writeVault(v)
}

export function saveUploadSecrets(entries: Record<string, string>) {
  const pairs = Object.entries(entries)
  if (!pairs.length) return
  const v = readVault()
  if (!v || !held) throw new Error('Enter your password to save keys in this browser.')
  for (const [address, secret] of pairs) v.items[`upload:${address}`] = box(held, `upload:${address}`, fromBase64(secret))
  writeVault(v)
}
export function loadUploadSecrets(addresses: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const address of addresses) {
    const secret = loadUploadSecret(address)
    if (secret) out[address] = secret
  }
  return out
}
export function forgetUploadSecrets(addresses: readonly string[]) {
  const v = readVault()
  if (!v) return
  let changedAny = false
  for (const address of addresses) {
    if (v.items[`upload:${address}`]) {
      delete v.items[`upload:${address}`]
      changedAny = true
    }
  }
  if (changedAny) writeVault(v)
}

// ---------- the key file ----------

export type SealedKeyFile = { model: string; kdf: Kdf; nonce: string; encryptedKey: string }

export function keyFileName(name: string) { return `${name}.voynich-key.json` }

// The model key under the same password as this browser's record: the file carries the salt and parameters that open it.
export function keyFileBody(model: string, name: string, key: Uint8Array): string {
  const v = readVault()
  if (!v || !held) throw new Error('Enter your password to write the key file.')
  const b = box(held, `keyfile:${model}`, key)
  return JSON.stringify({ format: 'voynich-key-v2', model, name, cipher: CIPHER, kdf: v.kdf, nonce: b.nonce, encryptedKey: b.data }, null, 2)
}

// A key file as read: the key itself (an earlier plain file, or one this browser's password already opens),
// or a sealed file that waits for its password.
export function parseKeyFile(text: string): { model: string; key: Uint8Array } | { model: string; sealed: SealedKeyFile } | null {
  try {
    const j = JSON.parse(text) as { model?: string; key?: string; kdf?: Partial<Kdf>; nonce?: string; encryptedKey?: string }
    if (!j.model) return null
    if (j.encryptedKey && j.nonce && usable(j.kdf)) {
      const sealed: SealedKeyFile = { model: j.model, kdf: j.kdf, nonce: j.nonce, encryptedKey: j.encryptedKey }
      const mine = readVault()?.kdf
      const key = held && mine && mine.salt === sealed.kdf.salt && mine.N === sealed.kdf.N && mine.r === sealed.kdf.r && mine.p === sealed.kdf.p ? openWith(held, sealed) : null
      return key ? { model: j.model, key } : { model: j.model, sealed }
    }
    if (!j.key) return null
    const key = fromBase64(j.key)
    return key.length === 32 ? { model: j.model, key } : null
  } catch { return null }
}
function openWith(key: Uint8Array, f: SealedKeyFile): Uint8Array | null {
  const out = unbox(key, `keyfile:${f.model}`, { nonce: f.nonce, data: f.encryptedKey })
  return out?.length === 32 ? out : null
}
// Null when the password is not the one the file was written under.
export async function openKeyFile(f: SealedKeyFile, password: string): Promise<Uint8Array | null> {
  try { return openWith(await derive(password, f.kdf), f) } catch { return null }
}
