// Phones. Android: Mobile Wallet Adapter registers itself as one more Wallet Standard wallet,
// so the store lists it with the rest. iOS has no MWA: the site opens inside the wallet's own
// browser, where the wallet injects itself as on desktop.

import type { SolanaChain } from './features'

export type AppIdentity = { name: string; uri: string; icon: string }

/**
 * Call once in the browser before (or right after) store.start(). No-op off Android.
 * Needs @solana-mobile/wallet-standard-mobile, imported on demand so desktop bundles skip it.
 */
export async function registerMobileWallet(identity: AppIdentity, chain: SolanaChain) {
  if (typeof navigator === 'undefined' || !/android/i.test(navigator.userAgent)) return
  const mwa = await import('@solana-mobile/wallet-standard-mobile')
  mwa.registerMwa({
    appIdentity: identity,
    authorizationCache: mwa.createDefaultAuthorizationCache(),
    chains: [chain],
    chainSelector: mwa.createDefaultChainSelector(),
    onWalletNotFound: mwa.createDefaultWalletNotFoundHandler(),
  })
}

export const isIOS = () => typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent)

/** iOS: links that open `url` inside each wallet's in-app browser. `ref` is the site's origin. */
export function inWalletBrowserLinks(url: string, ref: string) {
  const u = encodeURIComponent(url)
  const r = encodeURIComponent(ref)
  return [
    { name: 'Phantom', href: `https://phantom.app/ul/browse/${u}?ref=${r}` },
    { name: 'Solflare', href: `https://solflare.com/ul/v1/browse/${u}?ref=${r}` },
    { name: 'Backpack', href: `https://backpack.app/ul/v1/browse/${u}?ref=${r}` },
  ]
}
