// Server-Sent Events from one in-process hub. Each event is named by its type and its data is the
// whole JSON envelope. Nothing is replayed: a client reconnecting with Last-Event-ID is told to
// resync (refetch its snapshots), and a client that falls too far behind is resynced the same way.

import type { Context } from 'hono'
import { streamSSE } from 'hono/streaming'

export type StreamEvent<Type extends string = string, Data = unknown> = { type: Type; id: string; timestamp: string; data: Data }

let sequence = 0
export const streamEvent = <Type extends string, Data>(type: Type, data: Data): StreamEvent<Type, Data> => ({
  type,
  id: `${Date.now()}-${sequence++}`,
  timestamp: new Date().toISOString(),
  data,
})

export class EventHub<E extends StreamEvent = StreamEvent> {
  private listeners = new Set<(event: E) => void>()
  publish(event: E) {
    for (const listener of this.listeners) listener(event)
  }
  subscribe(listener: (event: E) => void) {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }
  get size() {
    return this.listeners.size
  }
}

export type StreamOptions<E extends StreamEvent> = {
  hub: EventHub<E>
  /** keep only what this client asked for (one coin, one wallet) */
  filter?: (event: E) => boolean
  /** sent first on every connection, e.g. the runtime status (waiting or live) */
  ready?: () => unknown
  /** a comment line this often keeps proxies from closing an idle stream */
  heartbeatMs?: number
  /** events queued for a slow client before it is told to resync instead */
  maxQueue?: number
}

export function streamEvents<E extends StreamEvent>(c: Context, options: StreamOptions<E>) {
  const { hub, filter, ready, heartbeatMs = 15_000, maxQueue = 500 } = options
  c.header('Cache-Control', 'no-cache')
  c.header('X-Accel-Buffering', 'no')
  return streamSSE(c, async (stream) => {
    const queue: StreamEvent[] = []
    let wake: (() => void) | null = null
    let closed = false
    const send = (e: StreamEvent) => stream.writeSSE({ event: e.type, id: e.id, data: JSON.stringify(e) })
    const off = hub.subscribe((e) => {
      if (filter && !filter(e)) return
      if (queue.length >= maxQueue) queue.splice(0, queue.length, streamEvent('resync', { reason: 'behind' }))
      else queue.push(e)
      wake?.()
    })
    stream.onAbort(() => {
      closed = true
      off()
      wake?.()
    })
    if (c.req.header('Last-Event-ID')) await send(streamEvent('resync', { reason: 'reconnected' }))
    if (ready) await send(streamEvent('ready', await ready()))
    while (!closed) {
      if (queue.length) {
        await send(queue.shift()!)
        continue
      }
      const idle = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(true), heartbeatMs)
        wake = () => {
          clearTimeout(timer)
          resolve(false)
        }
      })
      wake = null
      if (idle && !closed) await stream.write(': keepalive\n\n')
    }
  })
}
