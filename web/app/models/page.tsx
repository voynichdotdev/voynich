import type { Metadata } from 'next'
import Link from 'next/link'
import { api, fixtureFrom, read } from '@/lib/api'
import type { WeightsRange } from '@voynich/contract'
import { b64ToBytes, group, short } from '@/lib/format'
import { ByteTiles, State } from '@/components/tile/Tile'
import { Amount, Empty, Failed, Size } from '@/components/ui/kit'
import { ModelsSort, type Sort } from '@/components/model/ModelsSort'
import s from '@/components/model/model-view.module.css'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Models', description: 'Every sealed model on Voynich: its owner, size, price, the enclaves holding it and the calls it has settled.' }

const SORTS: Sort[] = ['calls', 'newest', 'price']
const HEAD_BYTES = 24

// The model's first bytes, as far as they are written, in groups of four.
function firstBytes(w: WeightsRange): number[][] {
  const bytes = b64ToBytes(w.bytesBase64)
  const written = (at: number) => w.accounts.some((a) => a.writtenRanges.some((x) => at >= x.offset && at < x.offset + x.length))
  let n = 0
  while (n < bytes.length && written(w.offset + n)) n++
  const groups: number[][] = []
  for (let i = 0; i < n; i += 4) groups.push(Array.from(bytes.slice(i, Math.min(n, i + 4))))
  return groups
}

export default async function ModelsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams
  const fixture = fixtureFrom(sp)
  const sort = SORTS.find((x) => x === sp.sort) ?? 'calls'
  const cursor = typeof sp.cursor === 'string' && /^[0-9]{1,12}$/.test(sp.cursor) ? sp.cursor : undefined
  const r = await read(api(fixture).models({ sort, cursor, limit: 24 }))
  const items = r.ok ? r.data.items : []
  const largestSealed = items
    .filter((m) => m.status !== 'uploading')
    .reduce<(typeof items)[number] | null>((best, m) => (!best || m.sizeBytes > best.sizeBytes ? m : best), null)
  const heads = await Promise.all(items.map((m) => read(api(fixture).weights(m.address, { offset: 0, length: HEAD_BYTES }))))
  const empty = r.ok && items.length === 0 && !cursor
  const query = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams()
    if (fixture) p.set('fixture', fixture)
    if (sort !== 'calls') p.set('sort', sort)
    for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v)
    const q = p.toString()
    return q ? `?${q}` : ''
  }
  const q = fixture ? `?fixture=${fixture}` : ''

  return (
    <div className="container page">
      <header className="page-head">
        <div>
          <h1 className="t-h1">Models</h1>
          <p className="t-small">
            {!r.ok ? 'Sealed models, read from chain.'
              : empty ? 'No sealed models yet.'
              : <>
                <span className="mono">{group(items.length)}</span> sealed {items.length === 1 ? 'model' : 'models'}{r.data.page.hasMore || cursor ? ' on this page' : ''}. Their weights are on chain as ciphertext.
                {largestSealed ? <> Largest sealed: <Size n={largestSealed.sizeBytes} /> (<span className="mono">{largestSealed.name}</span>).</> : null}
              </>}
          </p>
        </div>
        <div className={s.headActs}>
          {r.ok && !empty ? <ModelsSort value={sort} /> : null}
          <Link href={`/seal${q}`} className="btn" data-kind={empty ? undefined : 'primary'}>Seal a model</Link>
        </div>
      </header>

      {!r.ok ? (
        <div className={s.fail}><Failed title="The models did not load" message={r.message} /></div>
      ) : empty ? (
        <Empty title="No sealed models yet" action={<Link href={`/seal${q}`} className="btn" data-kind="primary">Seal a model</Link>}>
          Seal one from this browser: the weights are encrypted on your device and written to chain as ciphertext.
        </Empty>
      ) : (
        <>
          <ul className={`panel ${s.registry}`}>
            {items.map((m, i) => {
              const head = heads[i]
              const groups = head?.ok ? firstBytes(head.data) : []
              return (
                <li key={m.address}>
                  <Link href={`/models/${m.name}${q}`} className={`${s.entry} row-link`}>
                    <div className={s.entryName}>
                      <span className={s.modelName}>{m.name}</span>
                      <State state={m.status} />
                      <span className={s.entryOwner}>
                        <span className="t-label">Owner</span>
                        <span className="mono">{short(m.owner, 4)}</span>
                        <span className={s.kindBadge}>{m.manifest.inputKind}</span>
                        {m.base ? <span className={s.programBadge}>Adapter</span> : null}
                      </span>
                    </div>
                    <div className={s.entryBytes} aria-hidden="true">
                      {groups.map((g, k) => <ByteTiles key={k} bytes={g} size={18} />)}
                    </div>
                    <dl className={s.entryStats}>
                      <div><dt>Size</dt><dd><Size n={m.sizeBytes} size="s" /></dd></div>
                      <div><dt>{m.priceUnit === 'token' ? 'Price a token' : 'Price a call'}</dt><dd><Amount value={m.price} size="s" />{m.priceUnit === 'token' ? <span className="t-small dim"> / token</span> : null}</dd></div>
                      <div><dt>Enclaves</dt><dd className="t-fig t-fig-s">{group(m.enclavesHolding)}</dd></div>
                      <div><dt>Calls settled</dt><dd className="t-fig t-fig-s">{group(m.callsSettled)}</dd></div>
                    </dl>
                  </Link>
                </li>
              )
            })}
          </ul>
          {r.data.page.hasMore || cursor ? (
            <p className={`${s.more} ${s.headActs}`}>
              {cursor ? <Link href={`/models${query({})}`} className="btn" data-size="s">First page</Link> : null}
              {r.data.page.nextCursor ? <Link href={`/models${query({ cursor: r.data.page.nextCursor })}`} className="btn" data-size="s">Next page</Link> : null}
            </p>
          ) : null}
        </>
      )}
    </div>
  )
}
