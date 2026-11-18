// The HTTP core of a contract client: native fetch, the same zod schemas the server validated with,
// and one error class carrying the envelope. A product's client is a list of one-line methods over
// get/post, so it runs unchanged in the browser, in server components and in scripts.

import type { z } from 'zod'
import type { ApiErrorBody } from './errors.js'

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody,
  ) {
    super(body.error.message)
    this.name = 'ApiClientError'
  }
  get code() {
    return this.body.error.code
  }
}

export type HttpOptions = {
  /** the contract's ApiError schema (from defineErrors) */
  apiError: z.ZodType<ApiErrorBody>
  fetch?: typeof globalThis.fetch
  /** 'include' when the API keeps a session cookie */
  credentials?: RequestCredentials
  headers?: Record<string, string>
  /** fixture scenario sent with every request; a call can override it */
  fixture?: string
  fixtureHeader?: string
}

export type CallOptions = { query?: object; signal?: AbortSignal; fixture?: string; headers?: Record<string, string> }

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

/** A body that isn't the envelope (a proxy's HTML page, an empty 502) still becomes one. */
const fallback = (status: number): ApiErrorBody => ({
  error: {
    code: status >= 500 ? 'UPSTREAM_UNAVAILABLE' : 'INTERNAL_ERROR',
    message: `The API answered HTTP ${status}.`,
    retryable: status >= 500,
    stage: 'read',
  },
})

export function createHttp(baseUrl: string, options: HttpOptions) {
  const base = baseUrl.replace(/\/+$/, '')
  // A bare `fetch` stored on an object throws "Illegal invocation" in browsers; bind it.
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis)
  const fixtureHeader = options.fixtureHeader ?? 'X-Fixture'

  function url(path: string, query?: object) {
    const u = new URL(base + path)
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null) u.searchParams.set(k, String(v))
    return u
  }

  async function request<S extends z.ZodType>(method: Method, path: string, schema: S, body?: unknown, call: CallOptions = {}): Promise<z.output<S>> {
    const headers = new Headers({ Accept: 'application/json', ...options.headers, ...call.headers })
    const fixture = call.fixture ?? options.fixture
    if (fixture) headers.set(fixtureHeader, fixture)
    const form = body instanceof FormData
    if (body !== undefined && !form) headers.set('Content-Type', 'application/json')
    const response = await fetcher(url(path, call.query), {
      method,
      headers,
      credentials: options.credentials,
      signal: call.signal,
      body: body === undefined ? undefined : form ? body : JSON.stringify(body),
    })
    const text = await response.text()
    let value: unknown
    try {
      value = text ? JSON.parse(text) : undefined
    } catch {
      throw new ApiClientError(response.status, fallback(response.status))
    }
    // An envelope is an error whatever the status (a waiting service may answer 200 with one).
    const failure = options.apiError.safeParse(value)
    if (failure.success) throw new ApiClientError(response.status, failure.data)
    if (!response.ok) throw new ApiClientError(response.status, fallback(response.status))
    // Parsing with the server's own schema makes contract drift fail here, not deep in a component.
    return schema.parse(value)
  }

  return {
    url,
    request,
    get: <S extends z.ZodType>(path: string, schema: S, call?: CallOptions) => request('GET', path, schema, undefined, call),
    post: <S extends z.ZodType>(path: string, schema: S, body?: unknown, call?: CallOptions) => request('POST', path, schema, body, call),
    /** An EventSource URL: EventSource can't set headers, so the fixture rides in the query. */
    streamUrl: (path: string, query: object = {}) => url(path, { fixture: options.fixture, ...query }).toString(),
  }
}

export type Http = ReturnType<typeof createHttp>
