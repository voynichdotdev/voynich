// The API's frame, before any route: a request id, one JSON log line per request, CORS from an exact
// origin allowlist plus an explicit ORIGIN_NOT_ALLOWED refusal, a body limit, the contract version
// on every response, and one error envelope for every failure.

import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { cors } from 'hono/cors'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { fail, redact, toFailure } from './errors.js'

export type ApiOptions = {
  /** exact origins (scheme://host[:port]) allowed to call from a browser */
  origins: readonly string[]
  /** request headers beyond Content-Type: the fixture header, Last-Event-ID, solana-client for an RPC relay */
  allowHeaders?: readonly string[]
  exposeHeaders?: readonly string[]
  /** true when the API keeps a session cookie */
  credentials?: boolean
  /** the largest body any route takes (an upload plus multipart overhead); default 1 MiB */
  maxBodyBytes?: number
  /** sent as X-Contract-Version, so a web built against an older contract can tell */
  contractVersion?: string
}

export type ApiVariables = { requestId: string }

/** V types the variables the product's own middleware sets (a session, a fixture scenario). */
export function createApi<V extends object = {}>(options: ApiOptions) {
  const app = new Hono<{ Variables: ApiVariables }>()
  const origins = new Set(options.origins)

  app.use('*', async (c, next) => {
    const started = Date.now()
    const requestId = randomUUID()
    c.set('requestId', requestId)
    c.header('X-Request-Id', requestId)
    c.header('X-Content-Type-Options', 'nosniff')
    // Per-wallet answers must never be cached by a proxy; a cacheable route sets its own header.
    c.header('Cache-Control', 'no-store')
    if (options.contractVersion) c.header('X-Contract-Version', options.contractVersion)
    await next()
    // The route pattern, not the path: addresses and signatures in paths stay out of logs.
    console.log(JSON.stringify({ level: 'info', event: 'http', requestId, method: c.req.method, route: c.req.routePath, status: c.res.status, ms: Date.now() - started }))
  })

  app.use(
    '*',
    cors({
      origin: (origin) => (origins.has(origin) ? origin : null),
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', ...(options.allowHeaders ?? [])],
      exposeHeaders: ['X-Request-Id', 'Retry-After', ...(options.contractVersion ? ['X-Contract-Version'] : []), ...(options.exposeHeaders ?? [])],
      credentials: options.credentials ?? false,
      maxAge: 600,
    }),
  )

  // CORS only stops a browser from reading the answer; a simple POST from another site still runs.
  // Refusing unknown origins outright is what keeps cookie sessions safe from cross-site requests.
  app.use('*', async (c, next) => {
    const origin = c.req.header('Origin')
    if (origin && !origins.has(origin)) fail('ORIGIN_NOT_ALLOWED', 'This origin is not allowed.', { stage: 'validation' })
    await next()
  })

  app.use(
    '*',
    bodyLimit({
      maxSize: options.maxBodyBytes ?? 1024 * 1024,
      onError: () => fail('PAYLOAD_TOO_LARGE', 'The request body is too large.', { stage: 'validation' }),
    }),
  )

  app.onError((error, c) => {
    const failure = toFailure(error, c.get('requestId') ?? randomUUID())
    const { code, requestId, retryAfterSeconds } = failure.body.error
    if (failure.status >= 500) {
      console.error(JSON.stringify({ level: 'error', event: 'api_error', code, requestId, name: error.name, message: redact(error.message) }))
    }
    if (retryAfterSeconds) c.header('Retry-After', String(retryAfterSeconds))
    return c.json(failure.body, failure.status as ContentfulStatusCode)
  })

  app.notFound(() => fail('NOT_FOUND', 'This API route was not found.'))

  return app as unknown as Hono<{ Variables: V & ApiVariables }>
}
