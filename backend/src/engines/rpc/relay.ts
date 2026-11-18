// A JSON-RPC relay for browsers: the page's web3.js Connection points at the API's /rpc, so the
// provider key stays on the server. One request at a time, an allowlist of methods, read and write
// limits per client, and the service's own budget, which a relayed call never queues on for long.

import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { clientIp, createWindows } from '../server/limits.js'
import { RpcError, type Rpc } from './client.js'

export const RELAY_METHODS = [
  'getAccountInfo',
  'getMultipleAccounts',
  'getBalance',
  'getTokenAccountBalance',
  'getSlot',
  'getBlockHeight',
  'getLatestBlockhash',
  'isBlockhashValid',
  'getFeeForMessage',
  'getMinimumBalanceForRentExemption',
  'getSignatureStatuses',
  'getTransaction',
  'getSignaturesForAddress',
  'getGenesisHash',
  'getVersion',
  'simulateTransaction',
  'sendTransaction',
] as const

/**
 * The relay's CORS headers: web3.js adds `solana-client` to every request, and a preflight that
 * doesn't allow it fails every call in the browser while server-side checks pass.
 */
export const RELAY_HEADERS = ['Content-Type', 'solana-client'] as const

export type RelayOptions = {
  rpc: Pick<Rpc, 'forward'>
  methods?: readonly string[]
  writes?: readonly string[]
  readsPerMinute?: number
  writesPerMinute?: number
  /** how long a relayed call may queue on the service budget before it is refused */
  maxWaitMs?: number
  /** false while the program isn't deployed: answered locally, no RPC */
  ready?: () => boolean
  /** after a write, e.g. to drop a cached balance */
  onWrite?: () => void
}

type Id = string | number | null
const rpcError = (id: Id, code: number, message: string) => ({ jsonrpc: '2.0' as const, id, error: { code, message } })

/** `app.route('/rpc', rpcRelay({ rpc }))` */
export function rpcRelay(options: RelayOptions) {
  const { rpc, methods = RELAY_METHODS, writes = ['sendTransaction'], readsPerMinute = 600, writesPerMinute = 30, maxWaitMs = 1000 } = options
  const allowed = new Set(methods)
  const hit = createWindows()
  const app = new Hono()

  app.use('*', bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json(rpcError(null, -32600, 'The request is too large.'), 413) }))

  app.post('/', async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json(rpcError(null, -32700, 'Invalid JSON.'), 400)
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return c.json(rpcError(null, -32600, 'Send one request; batches are not relayed.'), 400)
    const r = body as Record<string, unknown>
    const id: Id = typeof r.id === 'string' || (typeof r.id === 'number' && Number.isSafeInteger(r.id)) ? r.id : null
    if (r.jsonrpc !== '2.0' || id === null || typeof r.method !== 'string' || (r.params !== undefined && !Array.isArray(r.params))) {
      return c.json(rpcError(id, -32600, 'Expected jsonrpc 2.0 with an id, a method and array params.'), 400)
    }
    if (!allowed.has(r.method)) return c.json(rpcError(id, -32601, `${r.method} is not relayed.`), 400)

    const write = writes.includes(r.method)
    const retryAfter = hit(clientIp(c), write ? 'write' : 'read', write ? writesPerMinute : readsPerMinute)
    if (retryAfter !== null) {
      c.header('Retry-After', String(retryAfter))
      return c.json(rpcError(id, -32005, 'Too many requests. Try again shortly.'), 429)
    }
    if (options.ready && !options.ready()) return c.json(rpcError(id, -32004, 'The program is not deployed yet.'))

    try {
      // Rebuilt from the parsed fields: a body with duplicate keys can't show one method to the
      // allowlist and another to the provider.
      const text = await rpc.forward({ id, method: r.method, params: (r.params as unknown[] | undefined) ?? [] }, maxWaitMs)
      if (write) options.onWrite?.()
      return c.body(text, 200, { 'Content-Type': 'application/json' })
    } catch (error) {
      if (error instanceof RpcError && error.code === 429) {
        c.header('Retry-After', '1')
        return c.json(rpcError(id, -32005, 'The service is at its RPC budget. Try again shortly.'), 429)
      }
      return c.json(rpcError(id, -32603, 'The cluster RPC is unavailable.'), 502)
    }
  })

  return app
}
