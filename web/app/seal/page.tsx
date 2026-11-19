import type { Metadata } from 'next'
import { fixtureFrom } from '@/lib/api'
import { SealFlow } from '@/components/seal/SealFlow'

export const metadata: Metadata = { title: 'Seal a model', description: 'Encrypt a model on your own device, write its ciphertext to Solana and grant an enclave the key.' }

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams
  const fixture = fixtureFrom(sp)
  const resumeModel = typeof sp.resume === 'string' && sp.resume.trim() ? sp.resume.trim() : null
  return <SealFlow key={`${fixture ?? ''}:${resumeModel ?? ''}`} fixture={fixture} resumeModel={resumeModel} />
}
