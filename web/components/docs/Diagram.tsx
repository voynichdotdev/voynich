// Diagrams in the brand's two hands: tiles and mono for what the chain holds, the drawn line for what
// a person or an enclave does, ochre where the model key exists. One markup, a row shape and a column
// shape, swapped by the width of the diagram's own box.

import { Frame } from '@/components/drawn/Drawn'
import { ByteTiles, State, StateTile } from '@/components/tile/Tile'
import { sampleBytes } from '@/components/field/ramp'
import { RECEIPT_CHECKS, SEAL_STEPS } from '@/lib/facts'
import s from './diagram.module.css'

type Station = {
  /** chain: an account, set as tiles and mono. hand: a device or an enclave, inside a drawn frame. */
  hand: 'chain' | 'hand'
  title: string
  says: string
  /** the model key exists here in plaintext */
  key?: boolean
  tiles?: React.ReactNode
  /** what the escrow does at this station */
  escrow?: string
}
type Track = { title?: string; stations: Station[]; links?: string[]; perRow?: number }
type Spec = { label: string; tracks: Track[] }

const step = (id: (typeof SEAL_STEPS)[number]['id']) => SEAL_STEPS.find((x) => x.id === id)!

const SPECS: Record<string, Spec> = {
  custody: {
    label: 'The chain of custody: from the owner’s device, to ciphertext on chain, to an enclave, to a receipt.',
    tracks: [{
      links: ['write', 'grant, fetch', 'sign, settle'],
      stations: [
        { hand: 'hand', key: true, title: 'Owner’s device', says: 'Encrypts the weights.' },
        { hand: 'chain', title: 'Weights', tiles: <ByteTiles bytes={sampleBytes(5, 408)} size={18} />, says: 'Ciphertext anyone can fetch.' },
        { hand: 'hand', key: true, title: 'Enclave', says: 'Opens the weights inside attested hardware.' },
        { hand: 'chain', title: 'Receipt', tiles: <State state="settled" />, says: 'The enclave’s signature on the answer.' },
      ],
    }],
  },
  seal: {
    label: 'Sealing a model in six steps: prepare, encrypt, create, write, seal, grant.',
    tracks: [{
      perRow: 3,
      stations: [
        { hand: 'hand', title: step('prepare').label, says: step('prepare').says },
        { hand: 'hand', key: true, title: step('encrypt').label, says: step('encrypt').says },
        { hand: 'chain', title: step('create').label, tiles: <State state="uploading" />, says: step('create').says },
        { hand: 'chain', title: step('write').label, tiles: <ByteTiles bytes={sampleBytes(5, 32)} size={18} />, says: step('write').says },
        { hand: 'chain', title: step('seal').label, tiles: <State state="sealed" />, says: step('seal').says },
        { hand: 'chain', title: step('grant').label, tiles: <State state="live" />, says: step('grant').says },
      ],
    }],
  },
  call: {
    label: 'A call in five steps: encrypt, open, answer, settle, verify, with the price moving through escrow.',
    tracks: [{
      perRow: 3,
      stations: [
        { hand: 'hand', title: 'Encrypt', says: 'The caller’s device encrypts the input to the enclave’s key.' },
        { hand: 'chain', title: 'Open', tiles: <State state="open" />, says: 'The call opens with the hash of the encrypted input.', escrow: 'price → escrow' },
        { hand: 'hand', key: true, title: 'Answer', says: 'The enclave runs the model and signs the call, the input hash and the output hash.', escrow: 'escrow held' },
        { hand: 'chain', title: 'Settle', tiles: <State state="settled" />, says: 'The program checks the signature and writes the receipt.', escrow: 'escrow → owner, operator, protocol' },
        { hand: 'hand', title: 'Verify', tiles: <span className={s.ticks}>{RECEIPT_CHECKS.map((c) => <StateTile key={c.id} state="passed" />)}</span>, says: 'The caller’s device checks the signature, the attestation record and its expiry.' },
      ],
    }],
  },
  grant: {
    label: 'How the model key moves: from the owner to an enclave, and from a granted enclave to the next.',
    tracks: [
      {
        title: 'Owner to enclave',
        links: ['grant', 'unwrap'],
        stations: [
          { hand: 'hand', key: true, title: 'Owner’s device', says: 'Wraps the model key to the enclave’s encryption key.' },
          { hand: 'chain', title: 'Grant', tiles: <ByteTiles bytes={sampleBytes(5, 7)} size={18} />, says: 'The model key, wrapped. Only that enclave can unwrap it.' },
          { hand: 'hand', key: true, title: 'Enclave', says: 'Unwraps the key inside the hardware and opens the weights.' },
        ],
      },
      {
        title: 'Enclave to enclave',
        links: ['grant', 'unwrap'],
        stations: [
          { hand: 'hand', key: true, title: 'Granted enclave', says: 'Checks the next enclave’s attestation record, wraps the key inside the hardware and signs the grant.' },
          { hand: 'chain', title: 'Grant', tiles: <ByteTiles bytes={sampleBytes(5, 19)} size={18} />, says: 'The model key, wrapped to the next enclave.' },
          { hand: 'hand', key: true, title: 'Next enclave', says: 'Unwraps the key inside the hardware and starts answering.' },
        ],
      },
    ],
  },
}

export const DIAGRAMS = Object.keys(SPECS)

function Arrow() {
  return (
    <span className={s.arrow} aria-hidden="true">
      <svg className={s.arrowH} viewBox="0 0 100 12" preserveAspectRatio="none">
        <path d="M1 6.4 C 24 4.8, 48 7.6, 72 5.6 S 94 6.6, 99 6" vectorEffect="non-scaling-stroke" />
      </svg>
      <svg className={s.arrowV} viewBox="0 0 12 100" preserveAspectRatio="none">
        <path d="M6.4 1 C 4.8 24, 7.6 48, 5.6 72 S 6.6 94, 6 99" vectorEffect="non-scaling-stroke" />
      </svg>
      <svg className={s.arrowHead} viewBox="0 0 12 12" width="12" height="12">
        <path d="M3 1.8 9.4 6 3 10.2" />
      </svg>
    </span>
  )
}

// The turn from the end of one row to the start of the next.
function Turn() {
  return (
    <span className={s.turn} aria-hidden="true">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        <path d="M84 0 C 84.5 18, 83.6 34, 84 50 C 60 51.5, 40 48.6, 16 50 C 16.4 66, 15.6 82, 16 99" vectorEffect="non-scaling-stroke" />
      </svg>
      <svg className={s.turnHead} viewBox="0 0 12 12" width="12" height="12">
        <path d="M1.8 3 6 9.4 10.2 3" />
      </svg>
    </span>
  )
}

function StationBox({ st }: { st: Station }) {
  const body = (
    <>
      {st.tiles ? <div className={s.tiles}>{st.tiles}</div> : null}
      <div className={s.title}>{st.title}</div>
      <p className={s.says}>{st.says}</p>
      {st.key ? <div className={s.key}>model key</div> : null}
      {st.escrow ? <div className={s.escrow}>{st.escrow}</div> : null}
    </>
  )
  return st.hand === 'hand'
    ? <Frame className={s.box} color={st.key ? 'var(--ochre)' : 'var(--slate-4)'}>{body}</Frame>
    : <div className={s.box} data-chain="">{body}</div>
}

export function Diagram({ name }: { name: string }) {
  const spec = SPECS[name]
  if (!spec) throw new Error(`<Diagram name="${name}">: the diagrams are ${DIAGRAMS.join(', ')}.`)
  const dashed = spec.tracks.some((t) => t.stations.some((x) => x.escrow))
  return (
    <figure className={s.diagram} aria-label={spec.label}>
      <div className={s.inner}>
        {spec.tracks.map((t, k) => (
          <div key={k} className={s.track}>
            {t.title ? <div className={s.trackTitle}>{t.title}</div> : null}
            <ol className={s.line} data-per-row={t.perRow} style={{ '--n': t.perRow ?? t.stations.length } as React.CSSProperties}>
              {t.stations.map((st, i) => {
                const last = i === t.stations.length - 1
                const turn = !last && t.perRow !== undefined && (i + 1) % t.perRow === 0
                return [
                  <li key={`s${i}`} className={s.station}><StationBox st={st} /></li>,
                  last ? null : (
                    <li key={`l${i}`} className={s.link} data-turn={turn || undefined}>
                      {t.links?.[i] ? <span className={s.linkLabel}>{t.links[i]}</span> : null}
                      <Arrow />
                      {turn ? <Turn /> : null}
                    </li>
                  ),
                ]
              })}
            </ol>
          </div>
        ))}
        <figcaption className={s.legend}>
          {name === 'custody' ? (
            <span>
              <svg width="22" height="12" viewBox="0 0 22 12" aria-hidden="true"><path d="M1.4 1.6 C 8 1, 14 2, 20.6 1.3 C 21 4.6, 20.5 7.6, 20.8 10.6 C 14 11.2, 8 10.3, 1.2 10.8 C 0.9 7.6, 1.6 4.4, 1.4 1.6 Z" fill="none" stroke="var(--ochre)" strokeWidth="1.6" /></svg>
              The model key exists in plaintext here, and nowhere else.
            </span>
          ) : (
            <>
              <span>
                <svg width="22" height="12" viewBox="0 0 22 12" aria-hidden="true"><path d="M1 6.4 C 6 4.8, 11 7.6, 16 5.6 S 20 6.4, 21 6" fill="none" stroke="var(--ochre-2)" strokeWidth="1.75" strokeLinecap="round" /></svg>
                Drawn line: an act by a person or an enclave
              </span>
              <span><i className={s.legendCap} aria-hidden="true" />Cap: what the chain holds</span>
              {dashed ? <span><i className={s.legendDash} aria-hidden="true" />Dashed: pending</span> : null}
            </>
          )}
        </figcaption>
      </div>
    </figure>
  )
}
