import type { Metadata } from 'next'
import Link from 'next/link'
import { api, fixtureFrom, read } from '@/lib/api'
import { HARDWARE, LINKS } from '@/lib/facts'
import { group, hardware, short } from '@/lib/format'
import { findMeasurement, loadMeasurements } from '@/lib/measurements'
import { Empty, Failed } from '@/components/ui/kit'
import { MeasurementSource } from '@/components/ui/MeasurementSource'
import { ByteTiles, State } from '@/components/tile/Tile'
import { LifeShort } from '@/components/enclave/parts'
import s from '@/components/enclave/enclave.module.css'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Enclaves', description: 'Every enclave registered to serve sealed models, with its attestation record.' }

const caps = (address: string) => Array.from(address.slice(0, 4), (c) => c.charCodeAt(0))

export default async function Enclaves({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams
  const fixture = fixtureFrom(sp)
  const cursor = typeof sp.cursor === 'string' ? sp.cursor : undefined
  const client = api(fixture)
  const [r, stats, measurements] = await Promise.all([
    read(client.enclaves(cursor ? { cursor } : {})),
    read(client.stats()),
    loadMeasurements(client),
  ])
  const q = fixture ? `?fixture=${fixture}` : ''
  const items = r.ok ? r.data.items : []
  const whole = r.ok && !r.data.page.hasMore && !cursor

  return (
    <div className="container page">
      <header className="page-head">
        <div>
          <h1 className="t-h1">Enclaves</h1>
          <p className="t-body">
            {r.ok ? (
              <>
                <span className="mono" style={{ color: 'var(--text)' }}>{group(items.length)}</span>
                {whole ? ' registered. ' : ' on this page. '}
              </>
            ) : null}
            Each signing key carries an onchain attestation record written by the configured verifier (<span className="mono">{HARDWARE.launchVerifier}</span> at launch, switching to {HARDWARE.attestation} via <span className="mono">set_config</span>).
          </p>
        </div>
        <Link href="/operators" className="btn">Run an enclave</Link>
      </header>

      {!r.ok ? (
        <Failed title="The enclaves did not load" message={r.message} />
      ) : items.length === 0 ? (
        <Empty title="No enclaves registered yet" action={<Link href={LINKS.operators.run} className="btn" data-kind="primary" data-size="s">Run the enclave runtime</Link>}>
          An enclave appears here once its key is recorded and it registers. The first one to hold a grant starts answering calls.
        </Empty>
      ) : (
        <>
          <div className={s.registry}>
            <div className={s.cols} aria-hidden="true">
              <span>Signing key</span>
              <span>Hardware</span>
              <span>Measurement</span>
              <span>Attestation record</span>
              <span className={s.right}>Models held</span>
              <span className={s.right}>Calls settled</span>
              <span className={s.right}>Status</span>
            </div>
            <ul>
              {items.map((e) => (
                <li key={e.address} className={s.entry}>
                  <div className={s.who}>
                    <ByteTiles bytes={caps(e.signingKey)} size={28} />
                    <div className={s.whoText}>
                      <Link href={`/enclaves/${e.address}${q}`} className={s.keyLink} title={e.signingKey}>{short(e.signingKey, 6)}</Link>
                      <span className={s.whoSub}>Operator <span className="mono" title={e.operator}>{short(e.operator, 4)}</span></span>
                    </div>
                  </div>
                  <div className={s.cell}><span className={s.cellLabel}>Hardware</span>{hardware(e.hardwareType)}</div>
                  <div className={s.cell}>
                    <span className={s.cellLabel}>Measurement</span>
                    <span className={`mono ${s.quiet}`} title={e.measurement}>{short(e.measurement, 6)}</span>
                    <MeasurementSource record={findMeasurement(measurements, e.measurement)} compact />
                  </div>
                  <div className={`${s.cell} ${s.lifeCell}`}>
                    <span className={s.cellLabel}>Attestation record</span>
                    {stats.ok ? (
                      <LifeShort record={e.attestation} currentSlot={stats.data.currentSlot} expired={e.status === 'expired'} />
                    ) : (
                      <span className={e.status === 'expired' ? 'bad' : s.quiet}>Expires at slot <span className="mono">{group(e.expiresAtSlot)}</span></span>
                    )}
                  </div>
                  <div className={`${s.cell} ${s.right}`}><span className={s.cellLabel}>Models held</span><span className={s.figure}>{group(e.modelsHeld)}</span></div>
                  <div className={`${s.cell} ${s.right}`}><span className={s.cellLabel}>Calls settled</span><span className={s.figure}>{group(e.callsSettled)}</span></div>
                  <div className={`${s.cell} ${s.right} ${s.status}`}><span className={s.cellLabel}>Status</span><State state={e.status} label={e.status === 'live' ? 'Live' : 'Expired'} /></div>
                </li>
              ))}
            </ul>
            {whole ? (
              <div className={s.next}>
                <span className={s.nextSays}>
                  <span className={s.nextCells} aria-hidden="true"><i /><i /><i /><i /></span>
                  The next enclave to register is listed here.
                </span>
                <Link className="link" data-arrow href={LINKS.operators.register}>Register and get granted</Link>
              </div>
            ) : null}
          </div>

          {r.data.page.hasMore && r.data.page.nextCursor ? (
            <div className={s.more}>
              <Link className="btn" href={`/enclaves?cursor=${encodeURIComponent(r.data.page.nextCursor)}${fixture ? `&fixture=${fixture}` : ''}`}>More enclaves</Link>
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}
