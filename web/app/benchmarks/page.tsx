import type { Metadata } from 'next'
import Link from 'next/link'
import { api, fixtureFrom, read } from '@/lib/api'
import { benchmarkRunCliCommand, formatScorePct } from '@/lib/benchmarks'
import { group, short } from '@/lib/format'
import { Empty, Failed, Hash } from '@/components/ui/kit'
import s from './benchmarks.module.css'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Benchmarks',
  description: 'Verifiable on-chain benchmark scores backed by settled Receipt PDAs on Solana.',
}

export default async function BenchmarksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const sp = await searchParams
  const fixture = fixtureFrom(sp)
  const cursor = typeof sp.cursor === 'string' ? sp.cursor : undefined
  const model = typeof sp.model === 'string' ? sp.model : undefined
  const q = fixture ? `?fixture=${fixture}` : ''
  const client = api(fixture)

  const res = await read(
    client.benchmarks({
      limit: 50,
      ...(cursor ? { cursor } : {}),
      ...(model ? { model } : {}),
    }),
  )

  const items = res.ok ? res.data.items : []
  const whole = res.ok && !res.data.page.hasMore && !cursor
  const cliCmd = benchmarkRunCliCommand('sketch-32', 'eval-suite.json')

  return (
    <div className="container page">
      <header className="page-head">
        <div>
          <h1 className="t-h1">Benchmarks</h1>
          <p className="t-body">
            {res.ok ? (
              <>
                <span className="mono" style={{ color: 'var(--text)' }}>{group(items.length)}</span>
                {whole ? ' on-chain scores. ' : ' on this page. '}
              </>
            ) : null}
            Every score is anchored to settled <span className="mono">Receipt</span> PDAs verified on chain by the Voynich program. Click any receipt to inspect all five checks.
          </p>
        </div>
        <Link href={`/models${q}`} className="btn">All models</Link>
      </header>

      {!res.ok ? (
        <Failed title="The benchmarks did not load" message={res.message} />
      ) : items.length === 0 ? (
        <Empty
          title="No on-chain benchmarks published yet"
          action={<Link href={`/models${q}`} className="btn" data-kind="primary" data-size="s">Browse sealed models</Link>}
        >
          Run an evaluation suite against any live sealed model and anchor its receipts on chain with <span className="mono">{cliCmd}</span>.
        </Empty>
      ) : (
        <>
          <div className={s.board}>
            <div className={s.cols} aria-hidden="true">
              <span>Model</span>
              <span>Suite &amp; dataset</span>
              <span>Score</span>
              <span className={s.right}>Passed</span>
              <span>Publisher</span>
              <span>Receipts</span>
            </div>
            <ul>
              {items.map((b) => {
                const modelHref = `/models/${encodeURIComponent(b.modelName ?? b.model)}${q}`
                const isHttp = b.datasetUri.startsWith('https://') || b.datasetUri.startsWith('http://')
                return (
                  <li key={b.address} className={s.entry}>
                    <div className={s.modelCell}>
                      <div className={s.modelRow}>
                        <Link href={modelHref} className={`link ${s.modelLink}`}>{b.modelName ?? short(b.model, 6)}</Link>
                        <span className={s.versionBadge}>v{b.modelVersion}</span>
                      </div>
                      <span className={s.metaLine}>
                        <span>Slot <span className="mono">{group(b.publishedSlot)}</span></span>
                        <Hash value={b.address} chars={4} label="benchmark account" />
                      </span>
                    </div>

                    <div className={`${s.cell} ${s.suiteCell}`}>
                      <span className={s.cellLabel}>Suite &amp; dataset</span>
                      <span className={s.suiteName}>{b.name}</span>
                      <span className={s.metaLine}>
                        <Hash value={b.datasetSha256} chars={6} label="dataset sha256" />
                        {isHttp ? (
                          <a href={b.datasetUri} target="_blank" rel="noreferrer" className={`link mono ${s.uriLink}`}>
                            {b.datasetUri.replace(/^https?:\/\//, '')}
                          </a>
                        ) : (
                          <span className={`mono ${s.uriLink}`}>{b.datasetUri}</span>
                        )}
                      </span>
                    </div>

                    <div className={s.cell}>
                      <span className={s.cellLabel}>Score</span>
                      <div className={s.scoreCell}>
                        <span className={s.scoreFig}>{formatScorePct(b.scoreBps)}</span>
                        <span className={s.scoreTrack} aria-hidden="true">
                          <span className={s.scoreFill} style={{ width: `${Math.min(100, b.scoreBps / 100)}%` }} />
                        </span>
                      </div>
                    </div>

                    <div className={`${s.cell} ${s.right}`}>
                      <span className={s.cellLabel}>Passed</span>
                      <span className={s.passed}>{group(b.passedCount)} / {group(b.sampleCount)}</span>
                    </div>

                    <div className={s.cell}>
                      <span className={s.cellLabel}>Publisher</span>
                      <Hash value={b.publisher} chars={4} label="publisher wallet" />
                    </div>

                    <div className={`${s.cell} ${s.receiptsCell}`}>
                      <span className={s.cellLabel}>Receipts</span>
                      <div className={s.receipts}>
                        {b.receipts.slice(0, 4).map((r) => (
                          <Link key={r} href={`/receipts/${r}${q}`} className={s.receiptPill} title={r}>
                            {short(r, 4)}
                          </Link>
                        ))}
                        {b.receipts.length > 4 ? (
                          <span className={s.versionBadge}>+{b.receipts.length - 4}</span>
                        ) : null}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>

          {res.data.page.hasMore && res.data.page.nextCursor ? (
            <div className={s.more}>
              <Link
                className="btn"
                href={`/benchmarks?cursor=${encodeURIComponent(res.data.page.nextCursor)}${model ? `&model=${encodeURIComponent(model)}` : ''}${fixture ? `&fixture=${fixture}` : ''}`}
              >
                More benchmarks
              </Link>
            </div>
          ) : null}
        </>
      )}

      <div className={s.cliFoot}>
        <span className="t-small dim">Publish a permissionless receipt-backed benchmark from the CLI:</span>
        <code className={`mono ${s.cliCode}`}>{cliCmd}</code>
      </div>
    </div>
  )
}
