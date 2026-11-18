// Wake-ups from a validator's own websocket: one logsSubscribe per watched address. Enough for
// localnet and small deployments; the log contents are ignored, a hint is all it gives.

import { Connection, PublicKey } from '@solana/web3.js'

export function logsStream(options: { rpcUrl: string; wsUrl?: string }) {
  return async (wake: () => void) => {
    const connection = new Connection(options.rpcUrl, { commitment: 'confirmed', wsEndpoint: options.wsUrl })
    const subscriptions = new Map<string, number>()
    return {
      async setAddresses(addresses: string[]) {
        for (const address of addresses) {
          if (!subscriptions.has(address)) subscriptions.set(address, connection.onLogs(new PublicKey(address), () => wake(), 'confirmed'))
        }
      },
      async close() {
        await Promise.all([...subscriptions.values()].map((id) => connection.removeOnLogsListener(id)))
        subscriptions.clear()
      },
    }
  }
}
