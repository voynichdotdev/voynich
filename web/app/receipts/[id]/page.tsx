import type { Metadata } from 'next'
import { api, fixtureFrom } from '@/lib/api'
import { loadReceipt } from '@/components/receipt/load'
import { ReceiptPage } from '@/components/receipt/ReceiptView'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Receipt' }

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params
  const fixture = fixtureFrom(await searchParams)
  const initial = await loadReceipt(api(fixture), id)
  return <ReceiptPage key={id} id={id} fixture={fixture} initial={initial} />
}
