import type { Metadata } from 'next'
import { fixtureFrom } from '@/lib/api'
import { AccountView } from '@/components/account/AccountView'

export const metadata: Metadata = { title: 'Account' }

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams
  const rawWallet = typeof sp.wallet === 'string' ? sp.wallet.trim() : ''
  const walletAddress = BASE58.test(rawWallet) ? rawWallet : null
  return <AccountView fixture={fixtureFrom(sp)} as={sp.as === 'owner' ? 'owner' : null} walletAddress={walletAddress} />
}
