'use client'

// One transaction's life as React state: build (and hold it for review), sign, submit, follow.
// The failing stage is always named.

import { useCallback, useState } from 'react'
import type { WalletStore } from '../../wallet/store.js'
import type { TxBuild, TxFailure, TxStatus } from '../types.js'
import { chooseRoute, followStatus, signAndSubmit, TxFlowError, type TxApi } from './flow.js'

export type TxStep = 'idle' | 'building' | 'review' | 'signing' | 'confirming' | 'confirmed' | 'failed'

export type UseTxOptions = {
  api: TxApi
  wallet: WalletStore
  /** false on localnet: a wallet's own RPC can't reach it, so everything is relayed */
  walletReachesCluster: boolean
  /** maps an API error thrown by `make` or `submit` to a failure; default reads `failure` off the error */
  toFailure?: (e: unknown, stage: TxFailure['stage']) => TxFailure
}

const defaultFailure = (e: unknown, stage: TxFailure['stage']): TxFailure => {
  const f = (e as { failure?: TxFailure })?.failure
  return f ?? { stage, message: e instanceof Error && e.message ? e.message : 'The API did not answer.', nextStep: 'Try again in a moment.', retryable: true }
}

export function useTx({ api, wallet, walletReachesCluster, toFailure = defaultFailure }: UseTxOptions) {
  const [step, setStep] = useState<TxStep>('idle')
  const [build, setBuild] = useState<TxBuild | null>(null)
  const [status, setStatus] = useState<TxStatus | null>(null)
  const [failure, setFailure] = useState<TxFailure | null>(null)

  const reset = useCallback(() => {
    setStep('idle')
    setBuild(null)
    setStatus(null)
    setFailure(null)
  }, [])

  const fail = (f: TxFailure) => {
    setFailure(f)
    setStep('failed')
  }

  /** Builds through the API and holds the result for review; `send` signs the held build. */
  const prepare = useCallback(async (make: () => Promise<TxBuild>) => {
    setFailure(null)
    setStatus(null)
    setStep('building')
    try {
      const b = await make()
      setBuild(b)
      setStep('review')
      return b
    } catch (e) {
      fail(toFailure(e, 'build'))
      return null
    }
  }, [toFailure])

  const send = useCallback(
    async (b: TxBuild) => {
      setFailure(null)
      setStep('signing')
      const conn = wallet.connection()
      let first: TxStatus
      try {
        first = await signAndSubmit(conn, b, api, chooseRoute(conn, b, walletReachesCluster))
      } catch (e) {
        return fail(e instanceof TxFlowError ? e.failure : toFailure(e, 'send'))
      }
      setStatus(first)
      setStep('confirming')
      const last = await followStatus(api, first, { onUpdate: setStatus })
      setStatus(last)
      if (last.status === 'confirmed' || last.status === 'finalized') setStep('confirmed')
      else if (last.status === 'failed' || last.status === 'expired')
        fail(last.error ?? { stage: 'confirm', message: `The transaction ${last.status}.`, nextStep: 'Build it again.', retryable: true })
      else setStep('confirming') // still not seen landing: offer `check` instead of a new signature
    },
    [api, wallet, walletReachesCluster, toFailure],
  )

  /** Reads an unsettled transaction again without sending anything. */
  const check = useCallback(async () => {
    if (!status) return
    const last = await followStatus(api, status, { onUpdate: setStatus, timeoutMs: 30_000 })
    setStatus(last)
    if (last.status === 'confirmed' || last.status === 'finalized') setStep('confirmed')
    else if (last.status === 'failed' || last.status === 'expired') fail(last.error ?? { stage: 'confirm', message: `The transaction ${last.status}.`, retryable: true })
  }, [api, status])

  return { step, build, status, failure, prepare, send, check, reset }
}
