// Per-client limits: who the client is behind a proxy, and fixed one-minute windows counted per
// client and bucket. In-process, so each replica counts its own share.

import { BlockList, isIPv6 } from 'node:net'
import { getConnInfo } from '@hono/node-server/conninfo'
import type { Context, MiddlewareHandler } from 'hono'
import { fail } from './errors.js'

// A peer on a private or loopback address is a proxy (Railway's edge, a local Caddy); its
// X-Forwarded-For is believed. A peer anywhere else is the client itself.
const PROXIES = new BlockList()
PROXIES.addSubnet('127.0.0.0', 8)
PROXIES.addSubnet('10.0.0.0', 8)
PROXIES.addSubnet('172.16.0.0', 12)
PROXIES.addSubnet('192.168.0.0', 16)
PROXIES.addSubnet('100.64.0.0', 10)
PROXIES.addAddress('::1', 'ipv6')
PROXIES.addSubnet('fc00::', 7, 'ipv6')

/** The caller's address. The proxy appends the address it saw, so the last entry is the one a client can't forge. */
export function clientIp(c: Context): string {
  let peer: string | undefined
  try {
    peer = getConnInfo(c).remote.address
  } catch {
    // app.request() in tests and rehearsals has no socket
  }
  if (peer?.startsWith('::ffff:')) peer = peer.slice(7)
  if (peer && !PROXIES.check(peer, isIPv6(peer) ? 'ipv6' : 'ipv4')) return peer
  return c.req.header('x-forwarded-for')?.split(',').at(-1)?.trim() || peer || 'local'
}

/** Fixed windows: hit() returns null while under the limit, else the seconds until the window resets. */
export function createWindows(windowMs = 60_000, maxClients = 10_000) {
  const windows = new Map<string, { start: number; counts: Map<string, number> }>()
  return function hit(client: string, bucket: string, limit: number): number | null {
    const now = Date.now()
    let w = windows.get(client)
    if (!w || now - w.start >= windowMs) {
      w = { start: now, counts: new Map() }
      windows.set(client, w)
      if (windows.size > maxClients) for (const [k, v] of windows) if (now - v.start >= windowMs) windows.delete(k)
    }
    const count = (w.counts.get(bucket) ?? 0) + 1
    w.counts.set(bucket, count)
    return count > limit ? Math.max(1, Math.ceil((w.start + windowMs - now) / 1000)) : null
  }
}

/** Limits writes (uploads, builds, sign-ins) per client per minute; reads stay unlimited. */
export function writeLimit(perMinute: number, methods: readonly string[] = ['POST', 'PUT', 'PATCH', 'DELETE']): MiddlewareHandler {
  const hit = createWindows()
  return async (c, next) => {
    if (methods.includes(c.req.method)) {
      const retryAfterSeconds = hit(clientIp(c), 'write', perMinute)
      if (retryAfterSeconds !== null) {
        fail('RATE_LIMITED', 'Too many requests. Try again in a minute.', { stage: 'validation', retryable: true, retryAfterSeconds })
      }
    }
    await next()
  }
}
