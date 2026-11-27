import type { Metadata } from 'next'
import { fixtureFrom } from '@/lib/api'
import { ClaimView } from '@/components/claim/ClaimView'

export const metadata: Metadata = { title: 'SOL Claim' }

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const rawWallet = typeof sp.wallet === 'string' ? sp.wallet.trim() : ''
  const walletAddress = BASE58.test(rawWallet) ? rawWallet : null
  return <ClaimView fixture={fixtureFrom(sp)} initialWallet={walletAddress} />
}
