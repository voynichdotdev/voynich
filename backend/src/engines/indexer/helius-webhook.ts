// Helius webhooks as wake-ups: an authenticated POST wakes the indexer, and the webhook's address
// list follows the indexer's watched set. The payload is never read for data. The cursors fetch
// every transaction, so the route acks at once and a lost delivery costs one poll interval.
//
// `handler` is a fetch-style route (Hono `c.req.raw`, a Next.js route handler); `stream` goes to
// the indexer's `stream` option.

import { timingSafeEqual } from 'node:crypto'

export type HeliusWebhookOptions = {
  apiKey: string
  webhookId: string
  /** the public HTTPS URL of `handler` */
  webhookUrl: string
  /** the secret Helius sends back in the Authorization header */
  authorization: string
  apiUrl?: string
  fetch?: typeof fetch
  log?(entry: Record<string, unknown>): void
}

const MAX_ADDRESSES = 100_000

export function heliusWebhook(options: HeliusWebhookOptions) {
  const expected = Buffer.from(options.authorization)
  let wake = () => {}
  let registered = ''
  let nextAttempt = 0

  async function register(addresses: string[]) {
    if (addresses.length > MAX_ADDRESSES) throw new Error(`A Helius webhook follows at most ${MAX_ADDRESSES} addresses.`)
    const base = (options.apiUrl ?? 'https://api-mainnet.helius-rpc.com/v0/webhooks').replace(/\/$/, '')
    const url = new URL(`${base}/${encodeURIComponent(options.webhookId)}`)
    url.searchParams.set('api-key', options.apiKey)
    const response = await (options.fetch ?? fetch)(url, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ webhookURL: options.webhookUrl, transactionTypes: ['ANY'], accountAddresses: addresses, webhookType: 'raw', authHeader: options.authorization }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) throw new Error(`Helius webhook update failed (HTTP ${response.status}).`)
  }

  return {
    async handler(request: Request): Promise<Response> {
      const actual = Buffer.from(request.headers.get('authorization') ?? '')
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return Response.json({ error: 'unauthorized' }, { status: 401 })
      wake()
      return Response.json({ status: 'accepted' })
    },

    async stream(onWake: () => void) {
      wake = onWake
      return {
        // Registers only when the set changed, and waits a minute after a failed attempt.
        async setAddresses(addresses: string[]) {
          const sorted = [...new Set(addresses)].sort(), key = sorted.join(',')
          if (key === registered || Date.now() < nextAttempt) return
          try {
            await register(sorted)
            registered = key
            options.log?.({ event: 'helius_webhook_registered', addresses: sorted.length })
          } catch (error) {
            nextAttempt = Date.now() + 60_000
            const message = (error instanceof Error ? error.message : String(error)).replaceAll(options.apiKey, '[redacted]')
            options.log?.({ event: 'helius_webhook_registration_failed', message })
          }
        },
        async close() {
          wake = () => {}
        },
      }
    },
  }
}
