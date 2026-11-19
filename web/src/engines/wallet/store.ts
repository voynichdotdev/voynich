// Browser wallets through Wallet Standard, with no adapter library: every wallet that registers
// itself (Phantom, Solflare, Backpack, Mobile Wallet Adapter, the localnet dev wallet) and can sign
// Solana transactions. One store per app; the React hook and the signing helpers read it.
//
// The store never touches `window` until start() runs, so it is safe to import from server code.

import { getWallets } from '@wallet-standard/app'
import type { Wallet, WalletAccount } from '@wallet-standard/base'
import { HARDWARE, features, solanaAccount, speaksSolana, type SolanaChain } from './features'
import { canSignMessage as supportsSignMessage, signMessage as signWalletMessage } from './sign'

export type WalletView = { name: string; icon: string }
export type WalletStatus = 'idle' | 'connecting' | 'connected'

export type WalletState = {
  /** discovery has run once in this browser (before that, an empty list means "not looked yet") */
  ready: boolean
  wallets: WalletView[]
  status: WalletStatus
  name: string | null
  address: string | null
  canSignMessage: boolean
  error: string | null
}

/** What the signing helpers need: the wallet, the account it shared, and the chain to sign for. */
export type Connection = { wallet: Wallet; account: WalletAccount; chain: SolanaChain }

export type WalletStoreOptions = {
  chain: SolanaChain
  /** localStorage key that remembers the last wallet, for the silent reconnect */
  storageKey: string
  /** extra filter on top of "speaks Solana, can connect, can sign, is not USB hardware" */
  accept?: (w: Wallet) => boolean
  /** how long to wait for the remembered wallet to register before giving up on reconnecting */
  reconnectWaitMs?: number
}

export type WalletStore = ReturnType<typeof createWalletStore>

export const EMPTY_WALLET_STATE: WalletState = { ready: false, wallets: [], status: 'idle', name: null, address: null, canSignMessage: false, error: null }

const usable = (w: Wallet) => {
  const f = features(w)
  return speaksSolana(w) && !!f['standard:connect'] && !!(f['solana:signTransaction'] || f['solana:signAndSendTransaction']) && !HARDWARE.test(w.name)
}

const remember = (key: string, name: string | null) => {
  try {
    if (name) localStorage.setItem(key, name)
    else localStorage.removeItem(key)
  } catch {
    /* private mode */
  }
}

const recall = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function createWalletStore(options: WalletStoreOptions) {
  const { chain, storageKey, accept = () => true, reconnectWaitMs = 4000 } = options
  let state = EMPTY_WALLET_STATE
  let started = false
  let current: Connection | null = null
  let offChange: (() => void) | null = null
  const byName = new Map<string, Wallet>()
  const listeners = new Set<() => void>()

  const set = (next: Partial<WalletState>) => {
    state = { ...state, ...next }
    listeners.forEach((l) => l())
  }

  const refresh = (list: readonly Wallet[]) => {
    byName.clear()
    for (const w of list) if (usable(w) && accept(w)) byName.set(w.name, w)
    set({ ready: true, wallets: [...byName.values()].map((w) => ({ name: w.name, icon: w.icon })) })
  }

  const clear = () => {
    current = null
    offChange?.()
    offChange = null
    set({ status: 'idle', name: null, address: null, canSignMessage: false })
  }

  const use = (wallet: Wallet, account: WalletAccount) => {
    current = { wallet, account, chain }
    set({ status: 'connected', name: wallet.name, address: account.address, canSignMessage: supportsSignMessage(current), error: null })
  }

  const bind = (wallet: Wallet, account: WalletAccount) => {
    offChange?.()
    // An account switched inside the wallet is the account from then on; none left is a disconnect.
    // The handler never subscribes again: a wallet whose emitter walks a Set would visit the new
    // listener in the same dispatch and loop forever.
    offChange =
      features(wallet)['standard:events']?.on('change', ({ accounts }) => {
        if (!accounts || current?.wallet !== wallet) return
        const next = solanaAccount(accounts)
        if (next) use(wallet, next)
        else {
          clear()
          remember(storageKey, null)
        }
      }) ?? null
    use(wallet, account)
  }

  async function connect(name: string, silent = false) {
    const wallet = byName.get(name)
    if (!wallet) {
      if (!silent) set({ error: `${name} is not installed in this browser.` })
      return
    }
    set({ status: 'connecting', name, error: null })
    try {
      const { accounts } = await features(wallet)['standard:connect']!.connect(silent ? { silent: true } : undefined)
      // Some wallets answer an approved connect with an empty list and fill wallet.accounts instead.
      const account = solanaAccount(accounts) ?? solanaAccount(wallet.accounts)
      if (!account) throw new Error(`${wallet.name} shared no account.`)
      bind(wallet, account)
      remember(storageKey, wallet.name)
    } catch (e) {
      clear()
      if (!silent) set({ error: e instanceof Error && e.message ? e.message : `${wallet.name} declined to connect.` })
    }
  }

  async function disconnect() {
    const wallet = current?.wallet
    clear()
    remember(storageKey, null)
    if (wallet) await features(wallet)['standard:disconnect']?.disconnect().catch(() => {})
  }

  /** Discovers wallets once and reconnects silently to the one used last time. Browser only. */
  function start() {
    if (started || typeof window === 'undefined') return
    started = true
    const api = getWallets()
    refresh(api.get())
    api.on('register', () => refresh(api.get()))
    api.on('unregister', () => refresh(api.get()))

    const last = recall(storageKey)
    if (!last) return
    // Extensions register at different moments after load; wait a little for the remembered one.
    const tryLast = () => {
      if (!byName.has(last) || state.status !== 'idle') return false
      void connect(last, true)
      return true
    }
    if (!tryLast()) {
      const off = api.on('register', () => {
        if (tryLast()) off()
      })
      setTimeout(off, reconnectWaitMs)
    }
  }

  return {
    chain,
    start,
    connect,
    disconnect,
    /** the live connection for the signing helpers, or null */
    connection: () => current,
    canSignMessage: () => supportsSignMessage(current),
    signMessage: (message: Uint8Array) => signWalletMessage(current, message),
    getState: () => state,
    subscribe(l: () => void) {
      start()
      listeners.add(l)
      return () => {
        listeners.delete(l)
      }
    },
  }
}
