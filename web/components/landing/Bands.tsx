import Link from 'next/link'
import type { Home } from '@voynich/contract'
import { LINKS, SDK, SKETCH32 } from '@/lib/facts'
import { group, b64ToBytes } from '@/lib/format'
import { sampleBytes } from '@/components/field/ramp'
import { Field } from '@/components/field/Field'
import { ByteTiles } from '@/components/tile/Tile'
import { Frame, Tick } from '@/components/drawn/Drawn'
import { DrawBand } from './DrawBand'
import s from './Bands.module.css'

// A hand-drawn mark standing for something a person made: a few strokes, never a picture of anything.
function Stroke({ w = 72, h = 44 }: { w?: number; h?: number }) {
  return (
    <svg width={w} height={h} viewBox="0 0 72 44" aria-hidden="true">
      <path d="M6 30 C 14 8, 24 6, 30 20 S 44 40, 52 22 S 62 8, 66 16" fill="none" stroke="var(--ochre)" strokeWidth="2.4" strokeLinecap="round" filter="url(#dry)" />
    </svg>
  )
}
// The act that carries the key from one place to the next, drawn by hand.
function Join() {
  return (
    <svg className={s.join} viewBox="0 0 80 14" preserveAspectRatio="none" aria-hidden="true">
      <path d="M2 7.6 C 18 5.4, 38 9.2, 58 6.6 S 72 7.2, 77 7" fill="none" stroke="var(--ochre)" strokeWidth="2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <path d="M70 2.5 77.5 7 70 11.5" fill="none" stroke="var(--ochre)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

export function Bands({ home, fixture }: { home: Home | null; fixture: string | null }) {
  const bytes = home?.ciphertext ? b64ToBytes(home.ciphertext.bytesBase64) : sampleBytes(256)
  const row = (from: number, n: number) => Array.from(bytes.slice(from, from + n))
  const stats = home?.stats

  return (
    <>
      {home?.model ? <DrawBand model={home.model} fixture={fixture} /> : null}

      <section className={s.acts} aria-labelledby="acts">
        <div className="container">
          <h2 id="acts" className="t-h1">Seal, grant, call</h2>
          <div className={s.path} role="img" aria-label="The model key leaves the owner's device only wrapped. The ciphertext sits on Solana. A granted enclave opens it and answers a caller.">
            <div className={s.station}>
              <div><Frame className={s.device}><span className="mono">weights.onnx</span><span className={s.key} /></Frame></div>
              <span className="t-label">Your device</span>
            </div>
            <Join />
            <div className={`${s.station} ${s.chain}`}>
              <div className={s.block}>
                {[0, 1, 2, 3].map((r) => <ByteTiles key={r} bytes={row(r * 18, 18)} size={26} />)}
              </div>
              <span className="t-label">On Solana, as ciphertext anyone can fetch</span>
            </div>
            <Join />
            <div className={s.station}>
              <div><Frame className={s.device}><span className="mono">enclave</span><span className={s.key} /></Frame></div>
              <span className="t-label">Attested hardware</span>
            </div>
            <Join />
            <div className={s.station}>
              <span className={s.answer}><Stroke /><Tick size={20} /><span className="mono">answer</span></span>
              <span className="t-label">A caller, with a receipt</span>
            </div>
          </div>
          <ol className={s.three}>
            <li>
              <h3 className="t-h2">Seal</h3>
              <p className="t-body">Your device draws a key and encrypts the weights. The ciphertext is written into Solana accounts and its hash is fixed. The model has an address.</p>
            </li>
            <li>
              <h3 className="t-h2">Grant</h3>
              <p className="t-body">The model key is wrapped to an enclave whose key the chain has recorded inside attested hardware. A granted enclave grants the next one.</p>
            </li>
            <li>
              <h3 className="t-h2">Call</h3>
              <p className="t-body">An input encrypted to the enclave, the price in escrow. The answer returns signed by the enclave, with a receipt on chain.</p>
            </li>
          </ol>
          <p className={s.more}><Link href="/sealing" className="link" data-arrow>How a model stays closed in public</Link></p>
        </div>
      </section>

      {stats ? (
        <section className={s.counts} aria-label="On chain now">
          <dl className={`container ${s.countRow}`}>
            <div><dt className="t-label">Sealed models</dt><dd className="t-fig">{group(stats.models)}</dd></div>
            <div><dt className="t-label">Enclaves</dt><dd className="t-fig">{group(stats.enclaves)}</dd></div>
            <div><dt className="t-label">Receipts</dt><dd className="t-fig">{group(stats.receipts)}</dd></div>
            <div><dt className="t-label">Program calls</dt><dd className="t-fig">{group(stats.programCalls)}</dd></div>
            <div className={s.countLinks}>
              <Link href="/models" className="link" data-arrow>Models</Link>
              <Link href="/bounties" className="link" data-arrow>Bounties</Link>
              <Link href="/enclaves" className="link" data-arrow>Enclaves</Link>
              <Link href="/receipts" className="link" data-arrow>Verify a receipt</Link>
            </div>
          </dl>
        </section>
      ) : null}

      <section className={s.one} aria-labelledby="one">
        <div className="container">
          <h2 id="one" className="t-label">One line from your code</h2>
          <pre className={s.code}><code><span className={s.kw}>await</span> voynich.<span className={s.fn}>call</span>(<span className={s.str}>&apos;{SKETCH32.id}&apos;</span>, input)</code></pre>
          <dl className={s.returns}>
            <div><dt className="mono">output</dt><dd className="t-small">The answer, decrypted on your side.</dd></div>
            <div><dt className="mono">receipt</dt><dd className="t-small">The record on chain of which model answered and inside which enclave.</dd></div>
            <div><dt className="mono">verified</dt><dd className="t-small">The signature, the attestation record and its expiry, checked before you read the answer.</dd></div>
          </dl>
          <p className={s.more}>
            <Link href={LINKS.quickstart} className="link" data-arrow>Call a model in five minutes</Link>
            <span className="mono sub">npm i {SDK.package}</span>
          </p>
        </div>
      </section>

      <section className={s.close} aria-labelledby="close">
        <Field form={5} hold level={0.8} place={{ x: 0.76, y: 0.52, size: 0.8 }} placePhone={{ x: 0.5, y: 0.28, size: 0.7 }} />
        <div className={`container ${s.closeIn}`}>
          <h2 id="close" className="t-display" data-field-clear>Put a model<br />on chain.</h2>
          <div className={s.closeActs} data-field-clear>
            <Link href="/seal" className="btn" data-kind="primary">Seal a model</Link>
            <Link href={LINKS.docsHome} className="btn">Read the docs</Link>
            <Link href="/operators" className="btn">Run an enclave</Link>
          </div>
        </div>
      </section>
    </>
  )
}
