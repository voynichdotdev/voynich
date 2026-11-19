import type { Metadata } from 'next'
import Link from 'next/link'
import { api, fixtureFrom, read } from '@/lib/api'
import { HARDWARE } from '@/lib/facts'
import { group, hardware, short } from '@/lib/format'
import { findMeasurement, loadMeasurements } from '@/lib/measurements'
import { Amount, Empty, Explorer, Failed, Hash } from '@/components/ui/kit'
import { MeasurementSource } from '@/components/ui/MeasurementSource'
import { ByteTiles, State, StateTile } from '@/components/tile/Tile'
import { Underline } from '@/components/drawn/Drawn'
import { Life, earned } from '@/components/enclave/parts'
import s from '@/components/enclave/enclave.module.css'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ key: string }>; searchParams: Promise<Record<string, string | undefined>> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { key } = await params
  return { title: `Enclave ${short(decodeURIComponent(key), 4)}` }
}

const caps = (address: string) => Array.from(address.slice(0, 4), (c) => c.charCodeAt(0))

export default async function EnclavePage({ params, searchParams }: Props) {
  const key = decodeURIComponent((await params).key)
  const fixture = fixtureFrom(await searchParams)
  const q = fixture ? `?fixture=${fixture}` : ''
  const client = api(fixture)
  const [r, stats, measurements] = await Promise.all([
    read(client.enclave(key)),
    read(client.stats()),
    loadMeasurements(client),
  ])

  if (!r.ok) {
    const missing = r.status === 404 || r.code === 'ENCLAVE_NOT_FOUND' || r.code === 'VALIDATION_ERROR'
    return (
      <div className="container page">
        <nav className="crumb" aria-label="Breadcrumb"><Link href={`/enclaves${q}`}>Enclaves</Link><span>/</span><span className="mono">{short(key, 6)}</span></nav>
        {missing ? (
          <Empty title="No enclave is registered at this key" action={<Link href={`/enclaves${q}`} className="btn" data-size="s">All enclaves</Link>}>
            <span className="mono" style={{ overflowWrap: 'anywhere' }}>{key}</span> is not an enclave address or a signing key the chain holds.
          </Empty>
        ) : (
          <Failed title="This enclave did not load" message={r.message} />
        )}
      </div>
    )
  }

  const { enclave: e, grants, receipts, earnings } = r.data
  const rec = e.attestation
  const expired = e.status === 'expired'

  return (
    <div className="container page">
      <div className={s.crumbRow}>
        <nav className="crumb" aria-label="Breadcrumb"><Link href={`/enclaves${q}`}>Enclaves</Link><span>/</span><span className="mono">{short(e.signingKey, 6)}</span></nav>
        <span className={s.out}><Explorer kind="address" id={e.address} /></span>
      </div>

      <header className={s.head}>
        <div className={s.headKey}>
          <ByteTiles bytes={caps(e.signingKey)} size={28} />
          <h1 title={e.signingKey}>{short(e.signingKey, 8)}</h1>
          <State state={e.status} label={expired ? 'Expired' : 'Live'} />
        </div>
        <dl className={s.headFacts}>
          <div><dt>Operator</dt><dd><Hash value={e.operator} chars={6} label="operator wallet" /></dd></div>
          <div><dt>Hardware</dt><dd>{hardware(e.hardwareType)}</dd></div>
          <div><dt>Models held</dt><dd className="mono">{group(e.modelsHeld)}</dd></div>
          <div><dt>Calls settled</dt><dd className="mono">{group(e.callsSettled)}</dd></div>
        </dl>
      </header>

      {expired ? (
        <p className={s.notice} role="status">
          <StateTile state="expired" />
          <span>This enclave&rsquo;s attestation record has expired. It cannot settle calls or receive grants until it attests again.</span>
        </p>
      ) : null}

      <div className={`grid ${s.regions}`}>
        <section className={s.record} data-expired={expired || undefined} aria-labelledby="record">
          <div className={s.recordHead}>
            <div>
              <div className={s.recordTitle}>
                <h2 id="record">Attestation record</h2>
                {expired ? null : <Underline />}
              </div>
              <p className={`t-small ${s.recordSays}`}>
                {rec.hardwareType === 'dev' ? (
                  <>What the chain holds for this standard-server enclave, written by <span className="mono">{HARDWARE.launchVerifier}</span>: the signing key, hardware type, measurement and expiry slot.</>
                ) : (
                  <>What the chain says about this hardware, written by {HARDWARE.attestation}: the signing key lives inside {hardware(rec.hardwareType)} running the measured software until the expiry slot.</>
                )}
              </p>
            </div>
            <State state={expired ? 'expired' : 'sealed'} label={expired ? 'Expired' : 'Recorded'} />
          </div>

          <dl className={s.recordList}>
            <dt>Record address</dt><dd><Hash value={rec.address} full label="record address" /></dd>
            <dt>Signing key</dt><dd><Hash value={rec.signingKey} full label="signing key" /></dd>
            <dt>Encryption key</dt><dd><Hash value={rec.encryptionKey} full label="encryption key" /></dd>
            <dt>Hardware type</dt><dd>{hardware(rec.hardwareType)}</dd>
            <dt>Measurement</dt>
            <dd>
              <Hash value={rec.measurement} full label="measurement" />
              <MeasurementSource record={findMeasurement(measurements, rec.measurement)} />
            </dd>
          </dl>

          {stats.ok ? <Life record={rec} currentSlot={stats.data.currentSlot} expired={expired} /> : (
            <p className="t-small">Recorded at slot <span className="mono">{group(rec.recordedSlot)}</span>. Expires at slot <span className={`mono ${expired ? 'bad' : ''}`}>{group(rec.expiresAtSlot)}</span>.</p>
          )}
        </section>

        <div className={s.side}>
          <section className="panel" aria-labelledby="earnings">
            <div className="panel-head"><h2 id="earnings">Earnings</h2><span className="t-small dim">operator share, by mint</span></div>
            <div className="panel-body">
              {earnings.length ? (
                <div className={s.figures}>
                  {earnings.map((x) => {
                    const m = earned(x)
                    return <Amount key={x.mint ?? 'sol'} value={m} size="m" />
                  })}
                </div>
              ) : (
                <p className="t-small dim">Nothing earned yet. The operator share lands here with each call this enclave settles.</p>
              )}
            </div>
          </section>

          <section className="panel" aria-labelledby="grants">
            <div className="panel-head"><h2 id="grants">Grants</h2><span className={s.headCount}>{group(grants.length)}</span></div>
            {grants.length ? (
              <ul className={s.items}>
                {grants.map((g) => (
                  <li key={g.address} className={s.item}>
                    <Link className={`link ${s.itemName}`} href={`/models/${g.modelName}${q}`} title={g.model}>{g.modelName}</Link>
                    <State state={g.status} label={g.status === 'live' ? 'Live' : g.status === 'expired' ? 'Expired' : 'Revoked'} />
                    <div className={s.itemSub}>
                      <span>Granted by <span className="mono" title={g.grantedBy}>{short(g.grantedBy, 4)}</span></span>
                      <span>Slot <span className="mono">{group(g.grantedSlot)}</span></span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={s.none}>No grants yet. A grant wraps a model&rsquo;s key to this enclave&rsquo;s encryption key.</p>
            )}
          </section>

          <section className="panel" aria-labelledby="receipts">
            <div className="panel-head"><h2 id="receipts">Receipts</h2><span className={s.headCount}>{group(receipts.length)}</span></div>
            {receipts.length ? (
              <ul className={s.items}>
                {receipts.map((x) => (
                  <li key={x.address} className={s.item}>
                    <Hash value={x.address} chars={6} href={`/receipts/${x.address}${q}`} label="receipt address" />
                    <Amount value={earned({ ...earnings.find((m) => m.mint === x.payments.mint), mint: x.payments.mint, amount: x.payments.operator.amount })} />
                    <div className={s.itemSub}>
                      <span>Slot <span className="mono">{group(x.slot)}</span></span>
                      <span>Model <Link className="mono link" href={`/models/${x.modelName}${q}`} title={x.model}>{x.modelName}</Link></span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={s.none}>No receipts yet. Each call this enclave settles leaves one.</p>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
