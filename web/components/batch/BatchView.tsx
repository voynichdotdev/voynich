'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import {
  formatBatchProgress,
  formatBatchStatus,
  loadBatch,
  type BatchRecord,
} from '@/lib/batches'
import { group, short } from '@/lib/format'
import { State, TileStrip } from '@/components/tile/Tile'
import { Explorer, Hash, Stat } from '@/components/ui/kit'
import s from '@/components/quorum/quorum.module.css'

export function BatchView({
  fixture,
  initial,
}: {
  fixture: string | null
  initial: BatchRecord
}) {
  const [batch, setBatch] = useState<BatchRecord>(initial)
  const q = fixture ? `?fixture=${fixture}` : ''
  const completed = batch.status === 'completed'
  const modelLabel = batch.modelName ?? short(batch.model, 6)
  const modelHref = `/models/${encodeURIComponent(batch.modelName ?? batch.model)}${q}`
  const ratio = batch.totalCount > 0 ? Math.min(1, batch.completedCount / batch.totalCount) : 0

  useEffect(() => {
    let live = true
    void loadBatch(api(fixture), initial.address).then((fresh) => {
      if (live && fresh) setBatch(fresh)
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
            <span className="mono">Batch {short(batch.address, 4)}</span>
          </nav>
          <div className={s.nameRow}>
            <h1 className={s.name}>Batch {short(batch.address, 6)}</h1>
            <State state={completed ? 'live' : 'uploading'} label={formatBatchStatus(batch.status)} />
          </div>
          <div className={s.address}>
            <Hash value={batch.address} chars={10} label="batch address" />
            <Explorer kind="address" id={batch.address} />
          </div>
        </div>
        <div className={s.stats}>
          <Stat label="Progress">
            <span className={`t-fig t-fig-m ${completed ? 'ochre' : ''}`}>
              {formatBatchProgress(batch.completedCount, batch.totalCount)}
            </span>
          </Stat>
          <Stat label="Receipts committed">
            <span className="t-fig t-fig-m">{group(batch.receipts.length)}</span>
          </Stat>
          <Stat label="Status">
            <span className={s.badge}>{formatBatchStatus(batch.status)}</span>
          </Stat>
        </div>
      </header>

      <div className={`grid ${s.regions}`}>
        <section className={`panel ${s.proof}`} aria-labelledby="batch-proof">
          <div className="panel-head">
            <h2 id="batch-proof">Batch proof</h2>
            <span className="t-small dim">Chained on chain from settled Receipt PDAs</span>
          </div>
          <div className={s.stripWrap}>
            <TileStrip
              parts={[{ share: ratio, step: completed ? 14 : 9 }]}
              cells={36}
              height={14}
            />
            <span className="t-small dim">
              {completed
                ? `${formatBatchProgress(batch.completedCount, batch.totalCount)} receipts chained into one on-chain receipts root.`
                : `${formatBatchProgress(batch.completedCount, batch.totalCount)} receipts committed. Waiting for remaining items.`}
            </span>
          </div>
          <dl className={`kv ${s.kv}`}>
            <dt>Model</dt>
            <dd><Link href={modelHref} className="link mono">{modelLabel}</Link></dd>
            <dt>Caller</dt>
            <dd><Hash value={batch.caller} chars={6} label="caller address" /></dd>
            <dt>Created slot</dt>
            <dd className="mono">{group(batch.createdSlot)}</dd>
            <dt>Completed slot</dt>
            <dd className="mono">{batch.completedSlot ? group(batch.completedSlot) : 'Open'}</dd>
            <dt className={s.wide}>Manifest SHA-256</dt>
            <dd className={s.wide}><Hash value={batch.manifestHash} full label="manifest hash" /></dd>
            <dt className={s.wide}>Chained receipts root</dt>
            <dd className={s.wide}><Hash value={batch.receiptsRoot} full label="receipts root" /></dd>
          </dl>
        </section>

        <section id="receipts" className={`panel ${s.receiptsPanel}`} aria-labelledby="batch-receipts">
          <div className="panel-head">
            <h2 id="batch-receipts">Committed receipts</h2>
            <span className="mono dim">{group(batch.receipts.length)}</span>
          </div>
          {batch.receipts.length === 0 ? (
            <div className="panel-body">
              <p className="t-small dim">No receipts committed yet. Append settled receipts in chunks of up to 16 to advance the receipts root.</p>
            </div>
          ) : (
            <ul className={s.receiptList}>
              {batch.receipts.map((receipt, idx) => (
                <li key={receipt} className={s.receiptRow}>
                  <div className={s.receiptLeft}>
                    <span className={s.badge}>Item {idx + 1}</span>
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
