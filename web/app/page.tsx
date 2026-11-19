import Link from 'next/link'
import { api, fixtureFrom, read } from '@/lib/api'
import { PRODUCT, SKETCH32 } from '@/lib/facts'
import { bytes, group, short, b64ToBytes } from '@/lib/format'
import { Field } from '@/components/field/Field'
import { State } from '@/components/tile/Tile'
import { Bands } from '@/components/landing/Bands'
import s from './page.module.css'

export const dynamic = 'force-dynamic'

export default async function Landing({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const fixture = fixtureFrom(await searchParams)
  const home = await read(api(fixture).home())
  const model = home.ok ? home.data.model : null
  const cipher = home.ok && home.data.ciphertext ? b64ToBytes(home.data.ciphertext.bytesBase64) : undefined
  const size = model ? bytes(model.sizeBytes) : null

  return (
    <>
      <section className={s.hero} aria-labelledby="line">
        <Field bytes={cipher} interactive arrival place={{ x: 0.7, y: 0.5, size: 0.74 }} placePhone={{ x: 0.5, y: 0.3, size: 0.86 }} />
        <div className={`container ${s.heroIn}`}>
          <div className={s.say}>
            <h1 id="line" className={`t-display ${s.line}`} data-field-clear>
              Hide your model<br />in plain sight.
            </h1>
            <p className={`t-lead ${s.lead}`} data-field-clear>
              These bytes are <span className="mono">{SKETCH32.name}</span>, a real model, on {PRODUCT.chain} as ciphertext. Draw something and it answers.
            </p>
            <div className={s.acts} data-field-clear>
              <Link href={`/models/${SKETCH32.id}`} className="btn" data-kind="primary">Call {SKETCH32.name}</Link>
              <Link href="/seal" className="btn">Seal a model</Link>
            </div>
          </div>
          {model ? (
            <dl className={s.reading} data-field-clear>
              <div><dt>Model</dt><dd><Link href={`/models/${model.name}`} className="mono link">{short(model.address, 6)}</Link></dd></div>
              <div><dt>Ciphertext</dt><dd className="mono">{size!.value}<span className="unit">{size!.unit}</span></dd></div>
              <div><dt>Calls settled</dt><dd className="mono">{group(model.callsSettled)}</dd></div>
              <div><dt>Status</dt><dd><State state={model.status} /></dd></div>
            </dl>
          ) : null}
        </div>
      </section>
      <Bands home={home.ok ? home.data : null} fixture={fixture} />
    </>
  )
}
