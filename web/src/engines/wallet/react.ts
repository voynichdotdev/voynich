'use client'

// The React side of the wallet store: one hook, no provider.

import { useSyncExternalStore } from 'react'
import { EMPTY_WALLET_STATE, type WalletState, type WalletStore } from './store'

/**
 * The store's state. The server snapshot is always the empty state, so a wallet that registered
 * before hydration can't make the first client render differ from the server's.
 */
export function useWallet(store: WalletStore): WalletState {
  return useSyncExternalStore(store.subscribe, store.getState, () => EMPTY_WALLET_STATE)
}
