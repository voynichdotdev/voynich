// The Wallet Standard features this engine speaks, typed locally so the engine needs only
// @wallet-standard/app and @wallet-standard/base (no adapter packages, no feature packages).

import type { Wallet, WalletAccount } from '@wallet-standard/base'

export type SolanaChain = `solana:${string}`

/** Wallet Standard chain id for a cluster name, whichever spelling the config uses. */
export function solanaChain(cluster: string): SolanaChain {
  if (cluster === 'mainnet' || cluster === 'mainnet-beta') return 'solana:mainnet'
  return `solana:${cluster}` as SolanaChain
}

export type SignInInput = {
  domain?: string
  address?: string
  statement?: string
  uri?: string
  version?: string
  chainId?: string
  nonce?: string
  issuedAt?: string
  expirationTime?: string
  notBefore?: string
  requestId?: string
  resources?: string[]
}
export type SignInOutput = { account: WalletAccount; signedMessage: Uint8Array; signature: Uint8Array; signatureType?: 'ed25519' }

export type Features = {
  'standard:connect'?: { connect(input?: { silent?: boolean }): Promise<{ accounts: readonly WalletAccount[] }> }
  'standard:disconnect'?: { disconnect(): Promise<void> }
  'standard:events'?: { on(event: 'change', fn: (p: { accounts?: readonly WalletAccount[] }) => void): () => void }
  'solana:signTransaction'?: {
    signTransaction(
      ...inputs: { account: WalletAccount; transaction: Uint8Array; chain?: string }[]
    ): Promise<readonly { signedTransaction: Uint8Array }[]>
  }
  'solana:signAndSendTransaction'?: {
    signAndSendTransaction(
      ...inputs: { account: WalletAccount; transaction: Uint8Array; chain: string; options?: { skipPreflight?: boolean; maxRetries?: number } }[]
    ): Promise<readonly { signature: Uint8Array }[]>
  }
  'solana:signMessage'?: {
    signMessage(...inputs: { account: WalletAccount; message: Uint8Array }[]): Promise<readonly { signedMessage: Uint8Array; signature: Uint8Array }[]>
  }
  'solana:signIn'?: { signIn(...inputs: SignInInput[]): Promise<readonly SignInOutput[]> }
}

export const features = (w: Wallet) => w.features as unknown as Features

export const speaksSolana = (w: Wallet) => w.chains.some((c) => c.startsWith('solana:'))

/** The first account the wallet shares on a Solana chain. */
export const solanaAccount = (accounts: readonly WalletAccount[]): WalletAccount | null =>
  accounts.find((a) => a.chains.some((c) => c.startsWith('solana:'))) ?? accounts[0] ?? null

/** USB hardware wallets are never offered. */
export const HARDWARE = /ledger|trezor|keystone|lattice|ngrave|ellipal/i
