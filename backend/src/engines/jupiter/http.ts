// Jupiter's swap API (api.jup.ag/swap/v1) behind one paced queue. Keyless use allows about one
// request every two seconds per IP across quote and swap-instructions together; an API key
// raises it. Jupiter answers 503 in short bursts: one retry, then an error the caller can show.

export type JupiterErrorCode = 'RETRY' | 'NO_ROUTE' | 'REFUSED' | 'INVALID_RESPONSE' | 'MISMATCH'

export class JupiterError extends Error {
  constructor(
    readonly code: JupiterErrorCode,
    message: string,
    readonly retryable = false,
    /** Jupiter's own errorCode, when it sent one */
    readonly upstream?: string,
  ) {
    super(message)
    this.name = 'JupiterError'
  }
}

export type JupiterClientOptions = {
  apiKey?: string
  /** lite-api.jup.ag stopped serving on 30 October 2026; api.jup.ag takes the same paths */
  baseUrl?: string
  /** spacing between this client's requests; 2 s keyless, none with a key unless set */
  intervalMs?: number
  timeoutMs?: number
  fetch?: typeof fetch
}

export type JupiterClient = {
  get(path: string, query: Record<string, string>): Promise<unknown>
  post(path: string, body: unknown): Promise<unknown>
}

async function refusal(response: Response): Promise<JupiterError> {
  const { status } = response
  if (status === 429 || status === 503) {
    const wait = response.headers.get('retry-after') ?? 'a few'
    return new JupiterError('RETRY', `Jupiter is ${status === 429 ? 'rate limiting requests' : 'briefly unavailable'}. Wait ${wait} seconds and request a new quote.`, true)
  }
  const body = (await response.json().catch(() => null)) as { errorCode?: unknown; error?: unknown } | null
  const upstream = typeof body?.errorCode === 'string' ? body.errorCode : typeof body?.error === 'string' ? body.error : undefined
  if (status === 400 || status === 404) return new JupiterError('NO_ROUTE', 'Jupiter found no route for these tokens and amount.', false, upstream)
  return new JupiterError('REFUSED', `Jupiter returned HTTP ${status}.`, status >= 500, upstream)
}

/** One client per process: the pacing is this object's, the allowance is the IP's. */
export function createJupiterClient(options: JupiterClientOptions = {}): JupiterClient {
  const { apiKey, timeoutMs = 15_000, fetch: request = fetch } = options
  const base = (options.baseUrl ?? 'https://api.jup.ag/swap/v1').replace(/\/$/, '')
  const interval = options.intervalMs ?? (apiKey ? 0 : 2000)
  let next = 0

  const send = async (url: string, init: RequestInit) => {
    const at = Math.max(Date.now(), next)
    next = at + interval
    if (at > Date.now()) await new Promise((r) => setTimeout(r, at - Date.now()))
    try {
      return await request(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
    } catch {
      throw new JupiterError('RETRY', 'Jupiter could not be reached. Request a new quote.', true)
    }
  }

  const call = async (url: string, init: RequestInit) => {
    let response = await send(url, init)
    if (response.status === 503) response = await send(url, init)
    if (!response.ok) throw await refusal(response)
    try {
      return (await response.json()) as unknown
    } catch {
      throw new JupiterError('INVALID_RESPONSE', 'Jupiter returned an unreadable response. Request a new quote.', true)
    }
  }

  const headers = (json: boolean) => ({
    Accept: 'application/json',
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(apiKey ? { 'x-api-key': apiKey } : {}),
  })

  return {
    get: (path, query) => call(`${base}/${path}?${new URLSearchParams(query)}`, { headers: headers(false) }),
    post: (path, body) => call(`${base}/${path}`, { method: 'POST', headers: headers(true), body: JSON.stringify(body) }),
  }
}
