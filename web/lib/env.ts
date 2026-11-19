// Configuration read from the environment. Defaults target local development ports.
export const CLUSTER = process.env.NEXT_PUBLIC_CLUSTER || 'localnet'
export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:9702'
// Server components reach the API here (a private address on a deploy); the browser uses API_URL.
export const API_URL_SERVER = process.env.API_URL || API_URL
export const EXPLORER = process.env.NEXT_PUBLIC_EXPLORER_URL || 'https://explorer.solana.com'

export function siteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  if (!raw) return 'http://127.0.0.1:9701'
  try {
    return new URL(raw).origin
  } catch {
    return 'http://127.0.0.1:9701'
  }
}

export function explorerUrl(kind: 'tx' | 'address', id: string, cluster = CLUSTER) {
  const q =
    cluster === 'mainnet' || cluster === 'mainnet-beta'
      ? ''
      : cluster === 'devnet'
        ? '?cluster=devnet'
        : `?cluster=custom&customUrl=${encodeURIComponent(process.env.NEXT_PUBLIC_RPC_URL || 'http://127.0.0.1:9704')}`
  return `${EXPLORER}/${kind}/${id}${q}`
}
