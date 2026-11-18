// The four JSON-RPC reads the indexer makes, over a one-method RPC port that any transport can
// fill: plain fetch, or the project's existing web3 Connection with its limiter and logging.
//
// Transactions are read as raw JSON with maxSupportedTransactionVersion 1 and normalized here.
// web3.js v1's getTransaction only parses legacy and v0, so it can't be the read path.

import type { Connection } from '@solana/web3.js'
import { z } from 'zod'

export interface Rpc {
  call<T = unknown>(method: string, params?: unknown[]): Promise<T>
}

export class RpcError extends Error {
  constructor(
    readonly method: string,
    readonly code: number | null,
    message: string,
  ) {
    super(`${method}: ${message}`)
    this.name = 'RpcError'
  }
}

/** JSON-RPC over fetch. Errors name the method only: RPC URLs carry API keys. */
export function httpRpc(url: string, options: { fetch?: typeof fetch; timeoutMs?: number } = {}): Rpc {
  const send = options.fetch ?? fetch
  let id = 0
  return {
    async call<T>(method: string, params: unknown[] = []) {
      const response = await send(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
      })
      if (!response.ok) throw new RpcError(method, response.status, `HTTP ${response.status}`)
      const body = (await response.json()) as { result?: T; error?: { code: number; message: string } }
      if (body.error) throw new RpcError(method, body.error.code, body.error.message)
      if (!('result' in body)) throw new RpcError(method, null, 'response has no result')
      return body.result as T
    },
  }
}

/** The RPC port over an existing Connection's transport (its fetch middleware, limiter and logging). */
export function connectionRpc(connection: Connection): Rpc {
  const transport = connection as unknown as {
    _rpcRequest(method: string, args: unknown[]): Promise<{ result?: unknown; error?: { code: number; message: string } }>
  }
  return {
    async call<T>(method: string, params: unknown[] = []) {
      const response = await transport._rpcRequest(method, params)
      if (response.error) throw new RpcError(method, response.error.code, response.error.message)
      return response.result as T
    },
  }
}

export type SignatureInfo = { signature: string; slot: number; blockTime: number | null; err: unknown }

const signatureList = z.array(
  z.object({ signature: z.string(), slot: z.number().int().nonnegative(), blockTime: z.number().int().nullish(), err: z.unknown() }),
)

/** One page of an address's signatures, newest first, stopping before `until`. */
export async function signaturePage(rpc: Rpc, address: string, page: { before?: string; until?: string | null; limit: number }): Promise<SignatureInfo[]> {
  const options = { commitment: 'confirmed', limit: page.limit, ...(page.before ? { before: page.before } : {}), ...(page.until ? { until: page.until } : {}) }
  const rows = signatureList.parse(await rpc.call('getSignaturesForAddress', [address, options]))
  return rows.map((row) => ({ signature: row.signature, slot: row.slot, blockTime: row.blockTime ?? null, err: row.err ?? null }))
}

/** The raw transaction for normalizeTransaction, or null while the node can't serve it yet. */
export function readTransaction(rpc: Rpc, signature: string): Promise<unknown | null> {
  return rpc.call('getTransaction', [signature, { commitment: 'confirmed', encoding: 'json', maxSupportedTransactionVersion: 1 }])
}

/** A block's transaction signatures in execution order. */
export async function blockSignatures(rpc: Rpc, slot: number): Promise<string[]> {
  const block = z.object({ signatures: z.array(z.string()) }).parse(
    await rpc.call('getBlock', [slot, { commitment: 'confirmed', transactionDetails: 'signatures', rewards: false, maxSupportedTransactionVersion: 1 }]),
  )
  return block.signatures
}

export async function confirmedSlot(rpc: Rpc): Promise<number> {
  return z.number().int().nonnegative().parse(await rpc.call('getSlot', [{ commitment: 'confirmed' }]))
}
