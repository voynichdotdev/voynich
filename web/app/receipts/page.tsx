import type { Metadata } from 'next'
import Link from 'next/link'
import { api, fixtureFrom, read } from '@/lib/api'
import { RECEIPT_CHECKS } from '@/lib/facts'
import { group, short } from '@/lib/format'
import { StateTile } from '@/components/tile/Tile'
import { Amount, Empty, Failed } from '@/components/ui/kit'
import { ReceiptField } from '@/components/receipt/ReceiptField'
import { moneyOf, q } from '@/components/receipt/shared'
import s from '@/components/receipt/receipt.module.css'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Receipts', description: 'Verify one answer: paste a receipt id, a call address or a transaction signature and the checks run in this browser.' }

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const fixture = fixtureFrom(await searchParams)
  const home = await read(api(fixture).home())
  const model = home.ok ? home.data.model : null

  return (
    <div className="container page">
      <div className="page-head">
        <div>
          <h1 className="t-h1">Verify a receipt</h1>
          <p className="t-small">Every answer leaves a receipt on chain. Its checks run in this browser.</p>
        </div>
      </div>

      <div className={`grid ${s.verify}`}>
        <div className={s.ask}>
          <ReceiptField fixture={fixture} />
          <section aria-labelledby="checks">
            <h2 id="checks" className="sr-only">The checks</h2>
            <ol className={s.what}>
              {RECEIPT_CHECKS.map((c) => (
                <li key={c.id}>
                  <StateTile state="waiting" />
                  <div>
                    <h3>{c.label}</h3>
                    <p className="t-small dim">{c.says}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <section className={s.recent} aria-labelledby="recent">
          <div className="panel">
            <div className="panel-head"><h2 id="recent">Latest receipts</h2>{home.ok ? <span className="mono dim">{group(home.data.recentReceipts.length)}</span> : null}</div>
            {!home.ok ? (
              <div className="panel-body"><Failed title="The latest receipts did not load" message={home.message} /></div>
            ) : home.data.recentReceipts.length === 0 ? (
              <div className="panel-body">
                <Empty title="No receipts yet" action={<Link href={`/models${q(fixture)}`} className="btn" data-kind="primary">Browse models</Link>}>
                  The first settled call writes one.
                </Empty>
              </div>
            ) : (
              <ul className={s.list}>
                <li className={`${s.row} ${s.head}`} aria-hidden="true"><span>Receipt</span><span>Model</span><span className={s.num}>Slot</span><span className={s.num}>Paid</span><span /></li>
                {home.data.recentReceipts.map((r) => (
                  <li key={r.address}>
                    <Link href={`/receipts/${r.address}${q(fixture)}`} className={s.row}>
                      <span className="mono">{short(r.address, 8)}</span>
                      <span><span className="t-label">Model</span><span className="mono">{r.modelName}</span></span>
                      <span className={s.num}><span className="t-label">Slot</span><span className="mono">{group(r.slot)}</span></span>
                      <span className={s.num}><Amount value={moneyOf(r.payments.total, r.payments.mint, [model?.address === r.model ? model.price : null])} /></span>
                      <span className={s.go} aria-hidden="true">→</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
