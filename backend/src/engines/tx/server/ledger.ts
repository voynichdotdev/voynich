// The server's record of each transaction it built, and the two endpoints the client flow calls:
// submit (the wallet's signed copy or its signature) and status (one reconcile step per read).
//
// The signed bytes are written down before they are broadcast, so a restart reads the same
// signature instead of building again. Status reads rebroadcast those same bytes while their
// blockhash lives; a transaction the wallet sent itself is only ever read.

import { PublicKey, type Connection, type Keypair, type TransactionInstruction } from '@solana/web3.js'
import { type TxBuild, type TxFailure, type TxStatus, type TxStatusName, type TxSubmission, settled } from '../types.js'
import { TxError, failureFromLogs, toFailure, type ErrorRegistry } from './failure.js'
import { prepareRelay } from './relay.js'
import { blockhashExpired, type Broadcast } from './send.js'

export type TxRecord = TxBuild & {
  wallet: string
  /** the build's read slot (UnsignedBuild.contextSlot), for the expiry proof */
  contextSlot?: number
  status: TxStatusName
  signature?: string
  /** relay only: the exact bytes broadcast, journaled before the first send */
  signedBase64?: string
  submissionKey?: string
  error?: TxFailure
}

export interface TxStore {
  get(id: string): Promise<TxRecord | null>
  /** Moves a record from 'built' to 'submitted' with the patch, only if it is still 'built'. */
  claim(id: string, patch: Partial<TxRecord>): Promise<boolean>
  update(id: string, patch: Partial<TxRecord>): Promise<void>
}

export type LedgerDeps = {
  connection: Connection
  store: TxStore
  /** what each build is about, for the wallet-copy checks */
  action: (record: TxRecord) => { requiredProgram: PublicKey; allowedPrograms?: PublicKey[]; instructions?: TransactionInstruction[]; cosigner?: Keypair }
  broadcast?: Broadcast
  registry?: ErrorRegistry
  nextStep?: (e: TxError) => string | undefined
}

export class TxLedgerError extends TxError {
  constructor(readonly code: 'NOT_FOUND' | 'IDEMPOTENCY_CONFLICT', stage: 'build' | 'send' | 'confirm', message: string) {
    super(stage, message, { retryable: false })
    this.name = 'TxLedgerError'
  }
}

const view = (r: TxRecord): TxStatus => ({ id: r.id, status: r.status, ...(r.signature ? { signature: r.signature } : {}), ...(r.error ? { error: r.error } : {}) })
function priorSubmission(record: TxRecord, key: string): TxStatus {
  if (record.submissionKey !== key) throw new TxLedgerError('IDEMPOTENCY_CONFLICT', 'send', 'This build was already submitted with another idempotency key.')
  return view(record)
}

export async function submit(deps: LedgerDeps, input: TxSubmission): Promise<TxStatus> {
  const { connection, store } = deps
  const record = await store.get(input.buildId)
  if (!record) throw new TxLedgerError('NOT_FOUND', 'build', 'This transaction build was not found.')
  // The same submission twice (a retried request) answers with what the first one did.
  if (record.status !== 'built') return priorSubmission(record, input.idempotencyKey)
  if (input.mode === 'wallet-sent') {
    if (record.cosigned) throw new TxError('wallet-changed', 'This transaction needs the server signature; it cannot be sent by the wallet.', { retryable: false })
    await store.claim(record.id, { status: 'submitted', signature: input.signature, submissionKey: input.idempotencyKey })
    return priorSubmission((await store.get(record.id))!, input.idempotencyKey)
  }
  const action = deps.action(record)
  // A TxError thrown here carries its stage; the API maps it with toFailure().
  const prepared = await prepareRelay({
    connection,
    payer: new PublicKey(record.wallet),
    signedTransactionBase64: input.signedTransactionBase64,
    original: { transactionBase64: record.transactionBase64, instructions: action.instructions },
    requiredProgram: action.requiredProgram,
    allowedPrograms: action.allowedPrograms,
    cosigner: action.cosigner,
    registry: deps.registry,
  })
  const signedBase64 = Buffer.from(prepared.bytes).toString('base64')
  // Journal first: whoever wins the claim owns these bytes and their one signature.
  if (!(await store.claim(record.id, { status: 'submitted', signature: prepared.signature, signedBase64, submissionKey: input.idempotencyKey }))) {
    return priorSubmission((await store.get(record.id))!, input.idempotencyKey)
  }
  await rebroadcast(deps, prepared.bytes)
  return view((await store.get(record.id))!)
}

async function rebroadcast(deps: LedgerDeps, bytes: Uint8Array) {
  try {
    if (deps.broadcast) await deps.broadcast(bytes)
    else await deps.connection.sendRawTransaction(bytes, { skipPreflight: true, maxRetries: 0 })
  } catch {
    /* transport ambiguity: the next status read finds out */
  }
}

/** One reconcile step. Safe to call on every status read; never builds or signs anything. */
export async function refresh(deps: LedgerDeps, id: string): Promise<TxStatus> {
  const { connection, store } = deps
  const record = await store.get(id)
  if (!record) throw new TxLedgerError('NOT_FOUND', 'confirm', 'This transaction was not found.')
  if (record.status === 'built' || settled(record.status) || !record.signature) return view(record)

  const status = (await connection.getSignatureStatuses([record.signature], { searchTransactionHistory: true })).value[0]
  if (status?.err) {
    const tx = await connection.getTransaction(record.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }).catch(() => null)
    const error = toFailure(failureFromLogs('confirm', tx?.meta?.logMessages, deps.registry), deps.nextStep)
    await store.update(id, { status: 'failed', error })
  } else if (status?.confirmationStatus === 'finalized') await store.update(id, { status: 'finalized' })
  else if (status?.confirmationStatus === 'confirmed') await store.update(id, { status: 'confirmed' })
  else if (!status) {
    const height = await connection.getBlockHeight('confirmed')
    if (height <= record.lastValidBlockHeight) {
      if (record.signedBase64) await rebroadcast(deps, Buffer.from(record.signedBase64, 'base64'))
    } else if (record.signedBase64) {
      // Expired only with proof: blockhash dead at finalized (on a node past the build) and still no history.
      const expired = await blockhashExpired(connection, record)
      const again = (await connection.getSignatureStatuses([record.signature], { searchTransactionHistory: true })).value[0]
      if (!again && expired === true)
        await store.update(id, { status: 'expired', error: { stage: 'confirm', message: 'The transaction expired without landing. Nothing was spent.', nextStep: 'Build it again.', retryable: true } })
    } else if (record.status === 'submitted') {
      // Wallet-sent: the wallet may have re-dated it, so the build's lifetime proves nothing.
      await store.update(id, { status: 'unconfirmed' })
    }
  }
  return view((await store.get(id))!)
}
