// Binds a Hono app to PORT and HOST and wires graceful shutdown: stop accepting, cut open
// connections (an SSE stream would otherwise hold close() forever), then close the runtime.

import { serve as listen } from '@hono/node-server'
import type { Server } from 'node:http'
import type { Hono } from 'hono'
import { createShutdown, onShutdownSignals } from './lifecycle.js'

export type ServeOptions = {
  /** from the PORT variable Railway injects; never a constant in the start script */
  port: number
  host: string
  /** closes what the runtime opened: loops, leases, the database */
  close?: () => Promise<void>
  /** false when a test drives shutdown itself */
  signals?: boolean
}

export function serve(app: Hono<any, any, any>, options: ServeOptions) {
  const server = listen({ fetch: app.fetch, port: options.port, hostname: options.host }, (info) => {
    console.log(JSON.stringify({ level: 'info', event: 'listening', host: options.host, port: info.port }))
  }) as Server
  const { shutdown, signal } = createShutdown(async () => {
    const closed = new Promise<void>((resolve) => server.close(() => resolve()))
    server.closeAllConnections()
    try {
      await options.close?.()
    } finally {
      await closed
    }
  })
  if (options.signals !== false) onShutdownSignals(shutdown)
  return { server, shutdown, signal }
}
