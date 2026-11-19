// The parts the drawings of /sealing and /operators are made from, in the two hands: tiles and mono for
// what the chain holds, the dry-edged ochre line for what a person or an enclave does.
import { Frame } from '@/components/drawn/Drawn'
import { BARE_BELOW, C, RAMP, capFill } from '@/components/field/ramp'
import s from './diagram.module.css'

// The filter the joins' drawn lines ask for. One per page.
export function JoinDefs() {
  return (
    <svg className={s.defs} aria-hidden="true" focusable="false">
      <filter id="dry-join" filterUnits="userSpaceOnUse" x="-10" y="-10" width="130" height="130">
        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="408" result="n" />
        <feDisplacementMap in="SourceGraphic" in2="n" scale="1.6" xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </svg>
  )
}

// Bytes as the chain holds them: slate caps on a grid that takes as many columns as its box has room for.
// `rows` cuts the wall to whole rows.
export function Wall({ bytes, n, size = 's', rows, className }: { bytes: ArrayLike<number>; n?: number; size?: 's' | 'm' | 'l'; rows?: number; className?: string }) {
  const count = Math.min(n ?? bytes.length, bytes.length)
  return (
    <span className={`${s.wall} ${className ?? ''}`} data-size={size} data-rows={rows !== undefined || undefined} style={rows !== undefined ? ({ '--rows': rows } as React.CSSProperties) : undefined} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => {
        const b = bytes[i]!
        const step = Math.min(RAMP.length - 1, BARE_BELOW + (b % (RAMP.length - BARE_BELOW)))
        const top = step === RAMP.length - 1
        return <i key={i} style={{ background: capFill(step), color: top ? C.ground : b % 19 === 0 ? C.pink : b % 9 === 0 ? C.yellow : C.glyph }}>{RAMP[step]}</i>
      })}
    </span>
  )
}

// Bytes in plaintext, inside a device or an enclave: warm caps in the drawn contour.
export function Plain({ n = 6, seed = 0, size = 's', bare }: { n?: number; seed?: number; size?: 's' | 'm' | 'l'; bare?: boolean }) {
  const caps = (
    <span className={s.plainCaps} data-size={size} aria-hidden="true">
      {Array.from({ length: n }, (_, i) => <i key={i}>{RAMP[6 + ((i * 5 + seed * 3) % 9)]}</i>)}
    </span>
  )
  // `bare`: the place around it already carries the contour.
  return bare ? caps : <Frame className={s.plain}>{caps}</Frame>
}

// Bytes that exist but are not on chain yet.
export function Pending({ n = 6 }: { n?: number }) {
  return <span className={s.pend} aria-hidden="true">{Array.from({ length: n }, (_, i) => <i key={i} />)}</span>
}

// The swatch a note uses to name the ochre contour.
export function Contour() {
  return (
    <svg className={s.swatch} viewBox="0 0 18 12" aria-hidden="true">
      <path d="M1.4 1.6 C 6 1, 12 1.9, 16.6 1.3 C 17 4, 16.4 8, 16.8 10.6 C 12 11.1, 6 10.3, 1.2 10.8 C 0.9 8, 1.6 4, 1.4 1.6 Z" fill="none" stroke="var(--ochre)" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  )
}

// A mark made by hand: an enclave's signature.
export function Signature() {
  return (
    <svg width="64" height="26" viewBox="0 0 64 26" aria-hidden="true">
      <path d="M3 17 C 8 4, 13 5, 11 14 S 16 24, 21 11 S 27 6, 28 15 S 36 20, 40 10 M34 21 C 44 19, 52 20, 61 17" fill="none" stroke="var(--ochre)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" filter="url(#dry)" />
    </svg>
  )
}

export type JoinKind = 'act' | 'holds' | 'pending'

const H = 'M1 8.6 C 18 6.4, 34 10.2, 52 8 S 84 6.8, 97 8.3'
const V = 'M8.4 1 C 6.4 18, 10.2 34, 8 52 S 6.8 84, 8.2 97'

// One line with its end. `act`: a person or an enclave does it. `holds`: it merely connects. `pending`: not yet.
export function Line({ kind, vertical }: { kind: JoinKind; vertical?: boolean }) {
  const box = vertical ? '0 0 16 100' : '0 0 100 16'
  const straight = vertical ? 'M8 1 V97' : 'M1 8 H97'
  return (
    <span className={vertical ? s.v : s.h} aria-hidden="true">
      <svg viewBox={box} preserveAspectRatio="none">
        {kind === 'act' ? (
          <path d={vertical ? V : H} fill="none" stroke="var(--ochre)" strokeWidth="2" strokeLinecap="round" vectorEffect="non-scaling-stroke" filter="url(#dry-join)" />
        ) : (
          <path d={straight} fill="none" stroke={kind === 'pending' ? 'var(--text-3)' : 'var(--line-2)'} strokeWidth="1" strokeDasharray={kind === 'pending' ? '2 2' : undefined} vectorEffect="non-scaling-stroke" shapeRendering="crispEdges" />
        )}
      </svg>
      <svg className={s.end} width="10" height="12" viewBox="0 0 10 12">
        {kind === 'act' ? (
          <path d="M1.6 1.6 8.4 6.2 2 10.6" fill="none" stroke="var(--ochre)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" filter="url(#dry-join)" />
        ) : kind === 'pending' ? (
          <rect x="3.5" y="3.5" width="5" height="5" fill="var(--ground)" stroke="var(--text-3)" strokeWidth="1" />
        ) : (
          <rect x="3" y="3" width="6" height="6" fill="var(--slate-4)" />
        )}
      </svg>
    </span>
  )
}

// What joins two places: across when the drawing has room, down when it does not.
export function Join({ kind = 'holds', label }: { kind?: JoinKind; label?: string }) {
  return (
    <div className={s.join} data-kind={kind} aria-hidden={label ? undefined : true}>
      <Line kind={kind} />
      <Line kind={kind} vertical />
      {label ? <span className={s.joinLabel}>{label}</span> : null}
    </div>
  )
}

export { s as diagram }
