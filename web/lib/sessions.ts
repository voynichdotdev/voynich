'use client'

// Ephemeral browser delegate keypairs and one-signature Session lifecycle helpers.

import { Keypair, VersionedTransaction } from '@solana/web3.js'
import { fromBase64, toBase64, type Build, type Model, type Session, type TxStatus, type VoynichClient } from '@voynich/contract'
import { followStatus, type TxApi } from '@/src/engines/tx/client/flow'
import { indexed, read } from './api'
import { send, TxError, type TxStageName } from './tx'

export const SESSION_DELEGATES_KEY = 'voynich.session.delegate.v1'
export const DEFAULT_SESSION_TTL_SLOTS = '1800'
export const DEFAULT_DELEGATE_GAS_LAMPORTS = '5000000'

type DelegateMap = Record<string, string>

function delegateEntryKey(wallet: string, sessionAddress: string): string {
  return `${wallet}:${sessionAddress}`
}

function readDelegateMap(): DelegateMap {
  if (typeof globalThis.sessionStorage === 'undefined') return {}
  try {
    const raw = globalThis.sessionStorage.getItem(SESSION_DELEGATES_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed as DelegateMap
  } catch {
    return {}
  }
}

function writeDelegateMap(map: DelegateMap): void {
  if (typeof globalThis.sessionStorage === 'undefined') return
  try {
    if (Object.keys(map).length === 0) globalThis.sessionStorage.removeItem(SESSION_DELEGATES_KEY)
    else globalThis.sessionStorage.setItem(SESSION_DELEGATES_KEY, JSON.stringify(map))
  } catch {}
}

export function saveSessionDelegate(wallet: string, sessionAddress: string, secretKey: Uint8Array): void {
  const map = readDelegateMap()
  map[delegateEntryKey(wallet, sessionAddress)] = toBase64(secretKey)
  writeDelegateMap(map)
}

export function loadSessionDelegate(wallet: string, sessionAddress: string): Keypair | null {
  const map = readDelegateMap()
  const encoded = map[delegateEntryKey(wallet, sessionAddress)]
  if (!encoded) return null
  try {
    return Keypair.fromSecretKey(fromBase64(encoded))
  } catch {
    return null
  }
}

export function removeSessionDelegate(wallet: string, sessionAddress: string): void {
  const map = readDelegateMap()
  const k = delegateEntryKey(wallet, sessionAddress)
  if (!(k in map)) return
  delete map[k]
  writeDelegateMap(map)
}

export type ActiveBrowserSession = {
  session: Session
  delegate: Keypair
}

export function findActiveBrowserSession(
  wallet: string,
  sessions: readonly Session[],
  modelAddress: string,
  mint: string | null,
): ActiveBrowserSession | null {
  for (const session of sessions) {
    if (session.status !== 'open') continue
    if (session.mint !== mint) continue
    if (session.model !== null && session.model !== modelAddress) continue
    if (BigInt(session.remaining) <= 0n) continue
    const delegate = loadSessionDelegate(wallet, session.address)
    if (!delegate) continue
    if (delegate.publicKey.toBase58() !== session.delegate) continue
    return { session, delegate }
  }
  return null
}

export async function loadAccountSessions(client: VoynichClient, wallet: string): Promise<Session[]> {
  const res = await read(client.accountSessions(wallet))
  return res.ok ? res.data.items : []
}

export async function submitDelegateBuild(
  client: VoynichClient,
  build: Build,
  delegate: Keypair,
  onStage?: (s: TxStageName) => void,
): Promise<TxStatus> {
  onStage?.('signing')
  let signedTransactionBase64 = build.transactionBase64
  if (!build.fixture) {
    const tx = VersionedTransaction.deserialize(fromBase64(build.transactionBase64))
    tx.sign([delegate])
    signedTransactionBase64 = toBase64(tx.serialize())
  }
  const first = await client.submitTransaction({
    mode: 'relay',
    buildId: build.id,
    signedTransactionBase64,
    idempotencyKey: build.id,
  })
  onStage?.('confirming')
  const txApi: TxApi = {
    submit: async (input) => client.submitTransaction(input) as Promise<TxStatus> as ReturnType<TxApi['submit']>,
    status: (id) => client.transaction(id) as ReturnType<TxApi['status']>,
  }
  const last = (await followStatus(txApi, first as never, { intervalMs: 500, timeoutMs: 90_000 })) as TxStatus
  if (last.status === 'failed' || last.status === 'expired') {
    throw new TxError(
      last.error?.message ?? 'The delegated call transaction did not confirm.',
      last.error?.stage ?? 'confirm',
      last.error?.retryable ?? true,
      last.error?.nextStep,
    )
  }
  return last
}

export async function openBrowserSession(o: {
  client: VoynichClient
  wallet: string
  model: Pick<Model, 'address' | 'price'>
  budget: string
  durationSlots?: string
  delegateGasLamports?: string
  onStage?: (s: TxStageName) => void
}): Promise<ActiveBrowserSession> {
  const delegate = Keypair.generate()
  const build = await o.client.openSession({
    wallet: o.wallet,
    delegate: delegate.publicKey.toBase58(),
    mint: o.model.price.mint,
    model: o.model.address,
    budget: o.budget,
    durationSlots: o.durationSlots ?? DEFAULT_SESSION_TTL_SLOTS,
    delegateGasLamports: o.delegateGasLamports ?? DEFAULT_DELEGATE_GAS_LAMPORTS,
  })
  await send(o.client, build, o.onStage)
  const sessionAddress = build.addresses.session
  if (!sessionAddress) throw new Error('The session opened without an address.')
  saveSessionDelegate(o.wallet, sessionAddress, delegate.secretKey)
  const session = await indexed(() => o.client.session(sessionAddress), 'SESSION_NOT_FOUND')
  return { session, delegate }
}

export async function closeBrowserSession(o: {
  client: VoynichClient
  wallet: string
  sessionAddress: string
  onStage?: (s: TxStageName) => void
}): Promise<Session | null> {
  const build = await o.client.closeSession(o.sessionAddress, { wallet: o.wallet })
  await send(o.client, build, o.onStage)
  removeSessionDelegate(o.wallet, o.sessionAddress)
  const updated = await read(o.client.session(o.sessionAddress))
  return updated.ok ? updated.data : null
}
