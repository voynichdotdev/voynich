// A Wallet Standard wallet for localnet runs: it signs with a tester key the app hands it, so
// flows can be driven end to end (by hand or by a browser script) without an extension.
// Register it only on localnet builds; serve the key from a dev-only route that 404s elsewhere.

import { getWallets } from '@wallet-standard/app'
import type { Wallet, WalletAccount } from '@wallet-standard/base'
import { toBase58 } from '../core/encoding'

export type DevWalletOptions = {
  /** 64-byte secret key (seed + public key) or a 32-byte seed */
  secretKey: Uint8Array
  name?: string
  /** data: URL; a plain square by default */
  icon?: string
}

const DEFAULT_ICON =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiBmaWxsPSIjMjIyIi8+PC9zdmc+'

const CHAINS = ['solana:localnet', 'solana:devnet', 'solana:mainnet'] as const

// Compact-u16 length prefix used by Solana's wire format.
function shortvec(bytes: Uint8Array, at: number) {
  let len = 0
  let size = 0
  for (;;) {
    const b = bytes[at + size]
    if (b === undefined) throw new Error('the transaction ends inside a length prefix')
    len |= (b & 0x7f) << (size * 7)
    size++
    if ((b & 0x80) === 0) break
  }
  return { len, size }
}

/** Puts this key's signature into its slot of a serialized legacy or v0 transaction. */
function signWire(tx: Uint8Array, pub: Uint8Array, sign: (msg: Uint8Array) => Uint8Array) {
  const sigs = shortvec(tx, 0)
  const msg = tx.slice(sigs.size + sigs.len * 64)
  let o = msg[0]! & 0x80 ? 1 : 0 // v0 messages start with a version byte
  const required = msg[o]
  if (required === undefined) throw new Error('the transaction has no message header')
  o += 3 // numRequiredSignatures, numReadonlySigned, numReadonlyUnsigned
  const keys = shortvec(msg, o)
  o += keys.size
  let slot = -1
  for (let k = 0; k < Math.min(required, keys.len); k++) {
    const key = msg.subarray(o + k * 32, o + k * 32 + 32)
    if (key.every((b, i) => b === pub[i])) slot = k
  }
  if (slot < 0) throw new Error('the dev wallet is not a signer of this transaction')
  const out = tx.slice()
  out.set(sign(msg), sigs.size + slot * 64)
  return out
}

export async function registerDevWallet(options: DevWalletOptions) {
  const { ed25519 } = await import('@noble/curves/ed25519.js')
  const seed = options.secretKey.slice(0, 32)
  const pub = options.secretKey.length >= 64 ? options.secretKey.slice(32, 64) : ed25519.getPublicKey(seed)
  const account: WalletAccount = {
    address: toBase58(pub),
    publicKey: pub,
    chains: CHAINS,
    features: ['solana:signTransaction', 'solana:signMessage'],
  }
  let connected = false
  const listeners = new Set<(p: { accounts?: readonly WalletAccount[] }) => void>()
  const sign = (msg: Uint8Array) => ed25519.sign(msg, seed)

  const wallet = {
    version: '1.0.0',
    name: options.name ?? 'Dev wallet (localnet)',
    icon: options.icon ?? DEFAULT_ICON,
    chains: CHAINS,
    get accounts() {
      return connected ? [account] : []
    },
    features: {
      'standard:connect': {
        version: '1.0.0',
        connect: async () => {
          connected = true
          listeners.forEach((l) => l({ accounts: [account] }))
          return { accounts: [account] }
        },
      },
      'standard:disconnect': {
        version: '1.0.0',
        disconnect: async () => {
          connected = false
        },
      },
      'standard:events': {
        version: '1.0.0',
        on: (_event: 'change', l: (p: { accounts?: readonly WalletAccount[] }) => void) => {
          listeners.add(l)
          return () => listeners.delete(l)
        },
      },
      'solana:signTransaction': {
        version: '1.0.0',
        supportedTransactionVersions: ['legacy', 0],
        signTransaction: async (...inputs: { transaction: Uint8Array }[]) =>
          inputs.map((i) => ({ signedTransaction: signWire(i.transaction, pub, sign) })),
      },
      'solana:signMessage': {
        version: '1.0.0',
        signMessage: async (...inputs: { message: Uint8Array }[]) =>
          inputs.map((i) => ({ signedMessage: i.message, signature: sign(i.message) })),
      },
    },
  } as unknown as Wallet
  getWallets().register(wallet)
  return account.address
}
