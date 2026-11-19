# wallet

Browser wallet connection through Wallet Standard, with no adapter library. Every wallet that
registers itself (Phantom, Solflare, Backpack, Android's Mobile Wallet Adapter, the localnet dev
wallet) shows up in one list; the app connects, follows account switches, reconnects silently on
the next visit, and signs what the server built.

## Modules

| File | What it does | Needs |
|---|---|---|
| `features.ts` | Locally typed Wallet Standard features, `solanaChain(cluster)`, account picking, the USB-hardware filter | `@wallet-standard/base` (types) |
| `store.ts` | `createWalletStore({ chain, storageKey })`: discovery, connect, disconnect, silent reconnect, account-change following. Framework-free | `@wallet-standard/app` |
| `sign.ts` | `signTransaction`, `signAndSendTransaction`, `signMessage`, `signIn`, `WalletError` with a stage | `../core/encoding.ts` |
| `react.ts` | `useWallet(store)` over `useSyncExternalStore`, hydration-safe | `react` |
| `mobile.ts` | `registerMobileWallet()` on Android, `inWalletBrowserLinks()` for iOS | `@solana-mobile/wallet-standard-mobile` (lazy) |
| `dev-wallet.ts` | A Wallet Standard wallet that signs with a tester key, for localnet runs | `@noble/curves`, `../core/encoding.ts` |

Copy the files you use plus `core/encoding.ts`. Nothing here imports from another engine.

## Assembly

```ts
// lib/wallet.ts
'use client'
import { createWalletStore } from './engines/wallet/store'
import { solanaChain } from './engines/wallet/features'

export const wallet = createWalletStore({
  chain: solanaChain(process.env.NEXT_PUBLIC_CLUSTER ?? 'mainnet'),
  storageKey: 'myapp.wallet',
})
```

```tsx
// a button
const w = useWallet(wallet)
if (w.status === 'connected') return <button onClick={wallet.disconnect}>{shortAddress(w.address!)}</button>
return w.wallets.map((x) => (
  <button key={x.name} onClick={() => wallet.connect(x.name)}><img src={x.icon} alt="" /> {x.name}</button>
))
```

```ts
// signing a transaction the API built
const signed = await signTransaction(wallet.connection(), fromBase64(build.transactionBase64))
```

Phones: call `registerMobileWallet({ name, uri, icon }, wallet.chain)` once on mount. On iOS,
when `w.ready && w.wallets.length === 0`, offer `inWalletBrowserLinks(location.href, origin)`.

Localnet: on a localnet build only, fetch the tester key from a dev-only route and call
`registerDevWallet({ secretKey })`. It registers like any extension, so the same store lists it.

## Behaviour worth knowing

- `useWallet` returns the empty state on the server and during hydration; `ready` turns true once
  discovery has run, so "no wallets installed" is shown only when it is true.
- The silent reconnect waits up to `reconnectWaitMs` (4 s) for the remembered extension to
  register; extensions register at different moments after load.
- A wallet that answers an approved connect with an empty account list is read from
  `wallet.accounts` instead.
- An account switched inside the wallet becomes the connected account; an empty list is a
  disconnect and forgets the remembered wallet.
- USB hardware wallets (Ledger and the like) are filtered out by name.
- Single-signer transactions go through `signAndSendTransaction` where the wallet has it, with
  `signTransaction` plus a server relay as the fallback. A transaction another key co-signs (a
  vanity mint) is signed by the wallet first and co-signed on the server after: Phantom blocks a
  request that already carries another signature. The `tx` engine's client flow makes that choice.
- Phantom rewrites what it signs (ComputeBudget, Lighthouse guards). Never require the signed copy
  to be byte-identical to the build; the `tx` engine checks only what a server signature covers.
