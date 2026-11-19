'use client'

// One way every screen sends what the API built: sign with the connected wallet, submit, follow to the end.
// A fixture-mode API hands back builds that are not transactions; those are echoed to it unsigned.

import type { Build, TxStatus, VoynichClient } from '@voynich/contract'
import { chooseRoute, followStatus, signAndSubmit, walletFailure, type TxApi, type TxRoute } from '@/src/engines/tx/client/flow'
import type { Connection } from '@/src/engines/wallet/store'
import { wallet } from './wallet'
import { CLUSTER } from './env'
import { units } from './format'

export class TxError extends Error {
  constructor(message: string, readonly stage: string, readonly retryable: boolean, readonly nextStep?: string) { super(message) }
}

export type TxStageName = 'signing' | 'confirming'
export type Cosign = (signedTransactionBase64: string) => Promise<string>
export type SendOptions = {
  cosign?: Cosign
  connection?: Connection | null
  cluster?: string
}

/**
 * Selects `'relay'` whenever a transaction has server or client co-signers (`cosigned`, `cosign`,
 * or multiple `requiredSigners`), so the wallet always signs the unsigned build first and extra
 * signers sign the wallet's returned copy afterward.
 */
export function txRouteFor(
  conn: Connection | null,
  build: Pick<Build, 'cosigned' | 'requiredSigners'>,
  cluster = CLUSTER,
  hasClientCosign = false,
): TxRoute {
  const needsCosign = build.cosigned || hasClientCosign || build.requiredSigners.length > 1
  return chooseRoute(conn, { id: '', transactionBase64: '', blockhash: '', lastValidBlockHeight: 0, cosigned: needsCosign }, cluster !== 'localnet')
}

export async function send(client: VoynichClient, build: Build, onStage?: (s: TxStageName) => void, options?: Cosign | SendOptions): Promise<TxStatus> {
  const opts = typeof options === 'function' ? { cosign: options } : options ?? {}
  const { cosign, connection = wallet.connection(), cluster = CLUSTER } = opts
  const txApi: TxApi = {
    submit: async (input) => {
      const signed = input.mode === 'relay' && cosign ? { ...input, signedTransactionBase64: await cosign(input.signedTransactionBase64) } : input
      return client.submitTransaction(signed) as Promise<TxStatus> as ReturnType<TxApi['submit']>
    },
    status: (id) => client.transaction(id) as ReturnType<TxApi['status']>,
  }
  let first: TxStatus
  onStage?.('signing')
  if (build.fixture) {
    first = await client.submitTransaction({ mode: 'relay', buildId: build.id, signedTransactionBase64: build.transactionBase64, idempotencyKey: build.id })
  } else {
    if (!build.cosigned && build.requiredSigners.length > 1 && !cosign) {
      throw new TxError('This transaction requires a co-signature that is not available on this device.', 'build', false)
    }
    const route = txRouteFor(connection, build, cluster, !!cosign)
    try {
      // Wallet-first: sign the unsigned build with the wallet, then apply any co-signature inside submit().
      first = (await signAndSubmit(connection, build, txApi, route)) as TxStatus
    } catch (e) {
      const f = (e as { failure?: ReturnType<typeof walletFailure> }).failure
      if (!f) throw e
      throw new TxError(f.message, f.stage, f.retryable, f.nextStep)
    }
  }
  onStage?.('confirming')
  const last = (await followStatus(txApi, first as never, { intervalMs: 600, timeoutMs: 90_000 })) as TxStatus
  if (last.status === 'failed' || last.status === 'expired') {
    throw new TxError(last.error?.message ?? 'The transaction did not confirm.', last.error?.stage ?? 'confirm', last.error?.retryable ?? true, last.error?.nextStep)
  }
  return last
}

// What went wrong, in a sentence a person can act on: the API's own reason, a wallet's refusal with what to do
// next, and plain words for a request that never arrived or an answer this site cannot read.
export function errorMessage(e: unknown): string {
  const x = e as { body?: { error?: { message?: string; code?: string; funding?: { mint: string | null; required: string; available: string; shortfall: string } } }; message?: string; name?: string; nextStep?: string }
  const f = x?.body?.error?.funding
  if (x?.body?.error?.code === 'INSUFFICIENT_FUNDS' && f && f.mint === null) {
    // Every lamport shown: a shortfall cut to six places would leave the wallet still short.
    const exact = (l: string) => units(l, 9, 9)
    return `The wallet holds ${exact(f.available)} SOL and this needs ${exact(f.required)} SOL. Add ${exact(f.shortfall)} SOL to the wallet, then try again.`
  }
  if (x?.body?.error?.message) return x.body.error.message
  if (e instanceof TypeError) return 'The API did not answer. Check the connection and try again.'
  if (x?.name === 'ZodError') return 'The API answered in a form this site does not read. Reload the page and try again.'
  const message = x?.message || 'Something went wrong.'
  return e instanceof TxError && e.nextStep ? `${/[.!?]$/.test(message) ? message : `${message}.`} ${e.nextStep}` : message
}
