'use client'

import { createWalletStore } from '@/src/engines/wallet/store'
import { solanaChain } from '@/src/engines/wallet/features'
import { CLUSTER } from './env'

export const wallet = createWalletStore({ chain: solanaChain(CLUSTER), storageKey: 'voynich.wallet' })

let devRegistered = false
// On localnet the tester key registers as a Wallet Standard wallet, so the same list shows it.
export async function registerLocalWallet() {
  if (devRegistered || CLUSTER !== 'localnet') return
  devRegistered = true
  try {
    const r = await fetch('/dev-wallet')
    if (!r.ok) return
    const { wallets } = (await r.json()) as { wallets: { name: string; secretKey: number[] }[] }
    const { registerDevWallet } = await import('@/src/engines/wallet/dev-wallet')
    for (const w of wallets) await registerDevWallet({ secretKey: Uint8Array.from(w.secretKey), name: w.name })
  } catch {}
}
