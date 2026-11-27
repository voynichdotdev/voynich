'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { group, short } from '@/lib/format'
import {
  formatQuorumMode,
  formatQuorumStatus,
  formatQuorumVotes,
  loadQuorum,
  type QuorumRecord,
} from '@/lib/quorums'
import { State, TileStrip } from '@/components/tile/Tile'
import { Explorer, Hash, Stat } from '@/components/ui/kit'
import s from './quorum.module.css'

export function QuorumView({
  fixture,
  initial,
}: {
  fixture: string | null
  initial: QuorumRecord
}) {
  const [quorum, setQuorum] = useState<QuorumRecord>(initial)
  const q = fixture ? `?fixture=${fixture}` : ''
  const agreed = quorum.status === 'agreed'
  const modelLabel = quorum.modelName ?? short(quorum.model, 6)
  const modelHref = `/models/${encodeURIComponent(quorum.modelName ?? quorum.model)}${q}`
  const ratio = quorum.requiredVotes > 0 ? Math.min(1, quorum.voteCount / quorum.requiredVotes) : 0

  useEffect(() => {
    let live = true
    void loadQuorum(api(fixture), initial.address).then((fresh) => {
      if (live && fresh) setQuorum(fresh)
    })
    return () => { live = false }
  }, [fixture, initial.address])

  return (
    <div className={`container page ${s.page}`}>
      <header className={s.head}>
        <div className={s.title}>
          <nav className="crumb" aria-label="Breadcrumb">
            <Link href={`/models${q}`}>Models</Link>
            <span aria-hidden="true">/</span>
            <Link href={modelHref}>{modelLabel}</Link>
            <span aria-hidden="true">/</span>
            <span className="mono">Quorum {short(quorum.address, 4)}</span>
          </nav>
          <div className={s.nameRow}>
            <h1 className={s.name}>Quorum {short(quorum.address, 6)}</h1>
            <State state={agreed ? 'live' : 'uploading'} label={formatQuorumStatus(quorum.status)} />
          </div>
          <div className={s.address}>
            <Hash value={quorum.address} chars={10} label="quorum address" />
            <Explorer kind="address" id={quorum.address} />
          </div>
        </div>
        <div className={s.stats}>
          <Stat label="Votes">
            <span className={`t-fig t-fig-m ${agreed ? 'ochre' : ''}`}>
              {formatQuorumVotes(quorum.voteCount, quorum.requiredVotes)}
            </span>
          </Stat>
          <Stat label="Distinct enclaves">
            <span className="t-fig t-fig-m">{group(quorum.distinctEnclaves)}</span>
          </Stat>
          <Stat label="Mode">
            <span className={s.badge}>{formatQuorumMode(quorum.requireDistinctEnclaves)}</span>
          </Stat>
        </div>
      </header>

      <div className={`grid ${s.regions}`}>
        <section className={`panel ${s.proof}`} aria-labelledby="quorum-proof">
          <div className="panel-head">
            <h2 id="quorum-proof">Consensus proof</h2>
            <span className="t-small dim">Verified on chain from settled Receipt PDAs</span>
          </div>
          <div className={s.stripWrap}>
            <TileStrip
              parts={[{ share: ratio, step: agreed ? 14 : 9 }]}
              cells={36}
              height={14}
            />
            <span className="t-small dim">
              {agreed
                ? `${formatQuorumVotes(quorum.voteCount, quorum.requiredVotes)} receipts agree on one output SHA-256.`
                : `${formatQuorumVotes(quorum.voteCount, quorum.requiredVotes)} receipts recorded. Waiting for consensus finalization.`}
            </span>
          </div>
          <dl className={`kv ${s.kv}`}>
            <dt>Model</dt>
            <dd><Link href={modelHref} className="link mono">{modelLabel}</Link></dd>
            <dt>Caller</dt>
            <dd><Hash value={quorum.caller} chars={6} label="caller address" /></dd>
            <dt>Mode</dt>
            <dd>{formatQuorumMode(quorum.requireDistinctEnclaves)}</dd>
            <dt>Created slot</dt>
            <dd className="mono">{group(quorum.createdSlot)}</dd>
            <dt>Finalized slot</dt>
            <dd className="mono">{quorum.finalizedSlot ? group(quorum.finalizedSlot) : 'Open'}</dd>
            <dt className={s.wide}>Input SHA-256</dt>
            <dd className={s.wide}><Hash value={quorum.inputHash} full label="input hash" /></dd>
            <dt className={s.wide}>Agreed output SHA-256</dt>
            <dd className={s.wide}>
              {quorum.agreedOutputHash ? (
                <Hash value={quorum.agreedOutputHash} full label="agreed output hash" />
              ) : (
                <span className="sub">Set when the quorum finalizes on chain</span>
              )}
            </dd>
          </dl>
        </section>

        <section id="receipts" className={`panel ${s.receiptsPanel}`} aria-labelledby="quorum-receipts">
          <div className="panel-head">
            <h2 id="quorum-receipts">Cited receipts</h2>
            <span className="mono dim">{group(quorum.receipts.length)}</span>
          </div>
          {quorum.receipts.length === 0 ? (
            <div className="panel-body">
              <p className="t-small dim">No receipts cited yet. Finalize this quorum with settled receipts matching the same input and output hash.</p>
            </div>
          ) : (
            <ul className={s.receiptList}>
              {quorum.receipts.map((receipt, idx) => (
                <li key={receipt} className={s.receiptRow}>
                  <div className={s.receiptLeft}>
                    <span className={s.badge}>Vote {idx + 1}</span>
                    <Link href={`/receipts/${receipt}${q}`} className={s.receiptPill} title={receipt}>
                      {short(receipt, 6)}
                    </Link>
                  </div>
                  <Link href={`/receipts/${receipt}${q}`} className="link t-small" data-arrow>
                    Inspect 5/5 checks
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
