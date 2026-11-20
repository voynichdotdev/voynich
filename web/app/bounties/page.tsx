import type { Metadata } from 'next'
import Link from 'next/link'
import { api, fixtureFrom, read } from '@/lib/api'
import { PROGRAM, SKETCH32 } from '@/lib/facts'
import { group } from '@/lib/format'
import { BountiesView } from '@/components/bounties/BountiesView'
import s from '@/components/bounties/bounties.module.css'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Bounties',
  description: 'On-chain drawing bounties settled by Voynich receipts. Draw the target label, verify the open answer, and collect directly from the bounty program.',
}

export default async function BountiesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams
  const fixture = fixtureFrom(sp)
  const q = fixture ? `?fixture=${fixture}` : ''
  const client = api(fixture)

  const [bountiesRes, modelRes, configRes] = await Promise.all([
    read(client.bounties({ limit: 50 })),
    read(client.model(SKETCH32.id)),
    read(client.config()),
  ])

  const items = bountiesRes.ok ? bountiesRes.data.items : []
  const openCount = items.filter((b) => b.status === 'open').length
  const claimedCount = items.filter((b) => b.status === 'claimed').length
  const bountyProgramId = (configRes.ok ? configRes.data.bountyProgramId : null) || PROGRAM.bountyProgramId || null

  return (
    <div className="container page">
      <header className="page-head">
        <div>
          <h1 className="t-h1">Bounties</h1>
          <p className="t-small">
            {!bountiesRes.ok ? (
              'On-chain drawing bounties settled by Voynich receipts.'
            ) : (
              <>
                <span className="mono">{group(openCount)}</span> open, <span className="mono">{group(claimedCount)}</span> claimed. A Solana program calls {SKETCH32.name} via CPI, verifies the open receipt on chain, and pays the matching drawer.
              </>
            )}
          </p>
        </div>
        <div className={s.headMeta}>
          <Link href={`/models/${SKETCH32.id}${q}`} className="btn" data-size="s">Inspect {SKETCH32.name}</Link>
          <Link href={`/docs/program/calling-a-model${q}`} className="link" data-arrow>How programs call models</Link>
        </div>
      </header>

      <BountiesView
        initialBounties={items}
        model={modelRes.ok ? modelRes.data : null}
        bountyProgramId={bountyProgramId}
        fixture={fixture}
        loadError={bountiesRes.ok ? null : bountiesRes.message}
      />
    </div>
  )
}
