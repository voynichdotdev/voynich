import type { Metadata } from 'next'
import Link from 'next/link'
import { PRODUCT, SKETCH32 } from '@/lib/facts'
import { Field } from '@/components/field/Field'
import { RAMP, sampleBytes } from '@/components/field/ramp'
import { ByteTiles, State, TileStrip, type TileState } from '@/components/tile/Tile'
import { Frame, Tick, Underline } from '@/components/drawn/Drawn'
import { Mark, Wordmark } from '@/components/nav/Mark'
import { Amount, Empty, Failed, Hash, Loading, Size, Stat } from '@/components/ui/kit'
import s from './board.module.css'

export const metadata: Metadata = { title: 'Brand board', robots: { index: false, follow: false } }

const COLOURS: [string, string, string][] = [
  ['--ground', '#05080f', 'the page, the field'],
  ['--surface', '#0a0f19', 'regions, panels'],
  ['--surface-2', '#101724', 'cards, inputs, overlays'],
  ['--line', '#182033', 'hairlines, the grid'],
  ['--line-2', '#26314a', 'edges of overlays and controls'],
  ['--slate-1', '#141c2c', 'the faintest cap'],
  ['--slate-2', '#223049', 'cap'],
  ['--slate-3', '#2f4062', 'the mass of ciphertext'],
  ['--slate-4', '#3c4f74', 'cap, high'],
  ['--cap', '#bfcade', 'the brightest cap'],
  ['--glyph', '#a8c0e0', 'glyphs on caps'],
  ['--text', '#e3e9f4', 'primary text'],
  ['--text-2', '#a3b0c8', 'secondary text'],
  ['--text-3', '#7684a0', 'labels, units'],
  ['--ochre', '#d9b45b', 'opened, verified, the subject, the primary action'],
  ['--crimson', '#b3203f', 'failed, expired, refused'],
  ['--blue', '#2c56a6', 'the flat field inside drawn diagrams'],
  ['--bone', '#c9c8c6', 'stipple inside drawn diagrams'],
  ['--pink', '#ff75b2', 'single glyphs inside ciphertext'],
  ['--yellow', '#eecc40', 'single glyphs inside ciphertext'],
]
const STATES: TileState[] = ['uploading', 'sealed', 'live', 'retired', 'open', 'settled', 'refundable', 'refunded', 'pending', 'passed', 'failed', 'expired']

export default function Board() {
  const bytes = sampleBytes(64)
  return (
    <div className={`container ${s.board}`}>
      <header className={s.head}>
        <h1 className="t-h1">{PRODUCT.name}: brand board</h1>
        <p className="t-lead">Everyone can see it, only the enclave can read it, and the moment it is read is the only warm thing on the screen.</p>
      </header>

      <section>
        <h2 className="t-label">The field</h2>
        <div className={s.field}><Field form={0} place={{ x: 0.5, y: 0.5, size: 0.86 }} interactive /></div>
        <p className="t-small">The model&apos;s ciphertext in a fixed 2:3 grid. The mass takes the outline of something {SKETCH32.name} names, re-forms about every nine seconds, and its glyphs re-resolve fifteen times a second. A pointer leaves an ochre stroke the cells take in.</p>
      </section>

      <section>
        <h2 className="t-label">The two hands</h2>
        <div className={s.two}>
          <div>
            <h3 className="t-h3">What the chain holds</h3>
            <div className={s.ramp}><ByteTiles bytes={[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]} size={32} /></div>
            <p className="mono dim">{RAMP.join(' ')}</p>
            <div className={s.rows}><ByteTiles bytes={Array.from(bytes.slice(0, 24))} size={22} /><ByteTiles bytes={Array.from(bytes.slice(24, 48))} size={22} /></div>
          </div>
          <div>
            <h3 className="t-h3">What a person or an enclave does</h3>
            <div className={s.drawn}>
              <Frame style={{ padding: '14px 18px' }}><span className="mono ochre">opened</span></Frame>
              <span className={s.inline}><Tick size={22} /> <span className="ochre">Verified</span></span>
              <span className={s.under}>Sealing<Underline /></span>
              <svg width="160" height="48" viewBox="0 0 160 48" aria-hidden="true"><path d="M6 34 C 24 6, 44 8, 58 24 S 92 44, 108 22 S 136 6, 152 20" fill="none" stroke="var(--ochre)" strokeWidth="3" strokeLinecap="round" filter="url(#dry-l)" /></svg>
            </div>
          </div>
        </div>
      </section>

      <section>
        <h2 className="t-label">The mark</h2>
        <div className={s.marks}><Mark size={72} small={false} /><Wordmark cap={28} /><Wordmark /></div>
      </section>

      <section>
        <h2 className="t-label">Type</h2>
        <div className={s.type}>
          <p className="t-display">{PRODUCT.line}</p>
          <p className="t-h1">How a model stays closed in public</p>
          <p className="t-h2">Seal, grant, call</p>
          <p className="t-h3">Attestation record</p>
          <p className="t-body" style={{ maxWidth: '60ch' }}>A model owner seals a model: the weights are encrypted on the owner&apos;s device and written into Solana accounts. An enclave whose key the chain has recorded opens it inside its hardware and answers calls.</p>
          <p className="t-small">Small: the enclave signs the call, the input hash and the output hash.</p>
          <p className="t-label">Label: ciphertext SHA-256</p>
          <p className="t-fig t-fig-l">252,081<span className="unit">B</span></p>
          <p className="mono">9f3a71c0e4b208dd5c11a0b7f2e6d4c39a8e01b6f7c2d5e4a3b2c1d0e9f8a7b6</p>
        </div>
      </section>

      <section>
        <h2 className="t-label">Colour by role</h2>
        <ul className={s.colours}>
          {COLOURS.map(([name, hex, use]) => (
            <li key={name}><span className={s.swatch} style={{ background: hex }} /><span className="mono">{name}</span><span className="mono dim">{hex}</span><span className="t-small">{use}</span></li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="t-label">Actions and fields</h2>
        <div className={s.rowWrap}>
          <button className="btn" data-kind="primary">Call</button>
          <button className="btn">Seal a model</button>
          <button className="btn" data-kind="danger">Retire</button>
          <button className="btn" disabled>Call</button>
          <button className="btn" data-kind="primary" data-size="s">Verify</button>
          <button className="btn" data-size="s">Refund</button>
          <Link href="/sealing" className="link" data-arrow>How a model stays closed in public</Link>
        </div>
        <div className={s.rowWrap}>
          <div className="field" style={{ width: 280 }}><label htmlFor="b1">Price per call</label><div className="input-row"><input id="b1" className="input mono" defaultValue="0.0001" /><span className="suffix">SOL</span></div><span className="help">Paid into escrow when a call opens.</span></div>
          <div className="field" style={{ width: 280 }}><label htmlFor="b2">Name</label><input id="b2" className="input" aria-invalid="true" defaultValue="Sketch 32" /><span className="err">Lowercase letters, digits and hyphens.</span></div>
          <div className="seg" role="group" aria-label="Sort"><button aria-pressed="true">Calls</button><button aria-pressed="false">Newest</button><button aria-pressed="false">Price</button></div>
        </div>
      </section>

      <section>
        <h2 className="t-label">States, figures, values</h2>
        <div className={s.rowWrap}>{STATES.map((st) => <State key={st} state={st} />)}</div>
        <div className={s.stats}>
          <Stat label="Ciphertext"><Size n={252081} size="m" /></Stat>
          <Stat label="Price per call"><Amount value={{ amount: '100000', decimals: 9, symbol: 'SOL' }} size="m" /></Stat>
          <Stat label="Model"><Hash value="HVNDQXk2pQe8sT4mZc1yBn7Rf3aWd9uJg5rWgpt" /></Stat>
        </div>
        <div style={{ maxWidth: 560 }}><TileStrip parts={[{ share: 0.7, step: 12 }, { share: 0.25, step: 8 }, { share: 0.05, step: 4 }]} /></div>
      </section>

      <section>
        <h2 className="t-label">Loading, empty, failed</h2>
        <div className={s.two}>
          <div className="panel"><div className="panel-head"><h3>Receipts</h3></div><div className="panel-body"><Loading /></div></div>
          <div>
            <Empty title="No sealed models yet" action={<Link href="/seal" className="btn" data-kind="primary" data-size="s">Seal a model</Link>}>The first model sealed appears here with its address.</Empty>
            <Failed message="The API did not answer." />
          </div>
        </div>
      </section>
    </div>
  )
}
