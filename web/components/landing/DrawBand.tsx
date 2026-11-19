import Link from 'next/link'
import type { Model } from '@voynich/contract'
import { CallPanel } from '@/components/model/CallPanel'
import { CipherView } from '@/components/model/CipherView'
import s from './DrawBand.module.css'

// The band where the sealed model answers: the same call panel as the model's page, beside its bytes.
export function DrawBand({ model, fixture }: { model: Model; fixture: string | null }) {
  return (
    <section className={s.band} aria-labelledby="draw">
      <div className="container">
        <header className={s.head}>
          <h2 id="draw" className="t-h1">Draw. The sealed model answers.</h2>
          <p className="t-lead">Your drawing is encrypted on this device, opened inside an enclave, and the answer comes back signed with a receipt.</p>
        </header>
        <div className={s.work}>
          <div className={s.call}><CallPanel model={model} fixture={fixture} compact /></div>
          <aside className={s.cipher} aria-label="Ciphertext on chain">
            <div className={`panel ${s.cipherPanel}`}>
              <div className="panel-head"><h3>The same model, as the chain holds it</h3></div>
              <div className="panel-body"><CipherView model={model.name} fixture={fixture} rows={10} compact /></div>
            </div>
            <Link href={`/models/${model.name}`} className="link" data-arrow>Everything about {model.name}</Link>
          </aside>
        </div>
      </div>
    </section>
  )
}
