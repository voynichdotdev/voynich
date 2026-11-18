// Wake-ups from Helius LaserStream (the Yellowstone gRPC protocol) for every watched address. It
// subscribes to transaction statuses only, the lightest feed that says something happened at an
// address; the indexer reads what happened over RPC. The pure-JS client runs the same on Windows
// and Linux, so development and deployment share one package.

import { createRequire } from 'node:module'
import type { CommitmentLevel, SubscribeRequest, SubscribeUpdate } from '@triton-one/yellowstone-grpc'

type Stream = {
  write(request: SubscribeRequest, callback: (error?: Error | null) => void): boolean
  on(event: 'data', listener: (update: SubscribeUpdate) => void): unknown
  on(event: 'error' | 'end' | 'close', listener: () => void): unknown
  cancel(): void
}
type Client = { subscribe(): Promise<Stream>; _client: { close(): void } }

// v4's CJS and ESM export maps disagree about the default export under NodeNext. Load the CJS
// build once, here at the package boundary, and type only what this file uses.
const yellowstone = createRequire(import.meta.url)('@triton-one/yellowstone-grpc') as {
  default: new (endpoint: string, token: string | undefined, options: Record<string, unknown> | undefined) => Client
  CommitmentLevel: typeof CommitmentLevel
}

export function laserStream(options: { endpoint: string; apiKey: string; reconnectMs?: number; log?(entry: Record<string, unknown>): void }) {
  return async (wake: () => void) => {
    let accounts: string[] = []
    let subscribed = ''
    let stopped = false
    let client: Client | undefined
    let stream: Stream | undefined
    let reconnect: ReturnType<typeof setTimeout> | undefined

    const request = (): SubscribeRequest => ({
      accounts: {}, slots: {}, transactions: {}, blocks: {}, blocksMeta: {}, entry: {}, accountsDataSlice: [],
      transactionsStatus: { watched: { accountInclude: accounts, accountExclude: [], accountRequired: [], vote: false, failed: false } },
      commitment: yellowstone.CommitmentLevel.CONFIRMED,
    })
    const write = (s: Stream, r: SubscribeRequest) => new Promise<void>((resolve, reject) => s.write(r, (e) => (e ? reject(e) : resolve())))

    const retry = () => {
      client?._client.close()
      if (stopped || reconnect) return
      options.log?.({ event: 'laserstream_disconnected' })
      reconnect = setTimeout(() => {
        reconnect = undefined
        void connect().catch(retry)
      }, options.reconnectMs ?? 60_000)
      reconnect.unref?.()
    }

    const connect = async () => {
      if (stopped || !accounts.length) return
      const c = new yellowstone.default(options.endpoint, options.apiKey, { 'grpc.max_receive_message_length': 4 * 1024 * 1024 })
      client = c
      const s = await c.subscribe()
      if (stopped) {
        s.cancel()
        c._client.close()
        return
      }
      stream = s
      const lost = () => {
        if (stream !== s) return
        stream = undefined
        s.cancel()
        c._client.close()
        retry()
      }
      s.on('data', (update) => {
        // The server pings to keep the stream open and drops one that doesn't answer.
        if (update.ping) void write(s, { ...request(), ping: { id: 1 } }).catch(lost)
        else if (update.transactionStatus) wake()
      })
      s.on('error', lost)
      s.on('end', lost)
      s.on('close', lost)
      await write(s, request())
      subscribed = accounts.join(',')
      // Whatever landed while it was down sits behind the cursors: catch up now.
      wake()
    }

    return {
      async setAddresses(addresses: string[]) {
        accounts = [...new Set(addresses)].sort()
        const key = accounts.join(',')
        if (key === subscribed) return
        if (stream) {
          await write(stream, request())
          subscribed = key
        } else if (!client && !reconnect) await connect().catch(retry)
      },
      async close() {
        stopped = true
        clearTimeout(reconnect)
        const s = stream
        stream = undefined
        s?.cancel()
        client?._client.close()
        client = undefined
      },
    }
  }
}
