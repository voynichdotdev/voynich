import type { Metadata } from 'next'
import Link from 'next/link'
import { api, fixtureFrom, read } from '@/lib/api'
import { short } from '@/lib/format'
import { QuorumView } from '@/components/quorum/QuorumView'
import { Empty, Failed } from '@/components/ui/kit'

export const dynamic = 'force-dynamic'

type Props = {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const addr = decodeURIComponent(id)
  return {
    title: `Quorum ${short(addr, 4)}`,
    description: `On-chain receipt-backed quorum consensus proof ${addr} on Voynich.`,
  }
}

export default async function QuorumPage({ params, searchParams }: Props) {
  const [{ id }, sp] = await Promise.all([params, searchParams])
  const address = decodeURIComponent(id)
  const fixture = fixtureFrom(sp)
  const q = fixture ? `?fixture=${fixture}` : ''
  const client = api(fixture)

  const res = await read(client.quorum(address))

  if (!res.ok) {
    const missing = res.status === 404 || res.code === 'QUORUM_NOT_FOUND' || res.code === 'VALIDATION_ERROR'
    return (
      <div className="container page">
        <nav className="crumb" aria-label="Breadcrumb">
          <Link href={`/models${q}`}>Models</Link>
          <span aria-hidden="true">/</span>
          <span className="mono">{short(address, 6)}</span>
        </nav>
        {missing ? (
          <Empty
            title="No quorum exists at this address"
            action={<Link href={`/models${q}`} className="btn" data-size="s">All models</Link>}
          >
            No on-chain <span className="mono">Quorum</span> account was found at <span className="mono">{address}</span>.
          </Empty>
        ) : (
          <Failed title="This quorum did not load" message={res.message} />
        )}
      </div>
    )
  }

  return <QuorumView fixture={fixture} initial={res.data} />
}
