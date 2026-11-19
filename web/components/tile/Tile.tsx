// The tile outside the canvas: one cap with one glyph, the unit of every status mark.
import { RAMP, capFill, C, BARE_BELOW } from '@/components/field/ramp'
import { Tick } from '@/components/drawn/Drawn'

export type TileState =
  | 'uploading' | 'sealed' | 'live' | 'retired' | 'open' | 'settled' | 'refundable' | 'refunded'
  | 'expired' | 'revoked' | 'pending' | 'passed' | 'failed' | 'waiting'

// A state is one cap: its brightness says how far along the thing is. No glyph: beside a word, a letter reads as a typo.
const TABLE: Record<TileState, { fill: string | null; edge?: string; step?: boolean }> = {
  uploading: { fill: 'var(--slate-2)', step: true },
  sealed: { fill: 'var(--slate-4)' },
  live: { fill: 'var(--cap)' },
  retired: { fill: null, edge: 'var(--line-2)' },
  open: { fill: 'var(--slate-3)', step: true },
  settled: { fill: 'var(--slate-4)' },
  refundable: { fill: 'var(--crimson)' },
  refunded: { fill: null, edge: 'var(--line-2)' },
  expired: { fill: 'var(--crimson)' },
  revoked: { fill: null, edge: 'var(--crimson)' },
  pending: { fill: 'var(--slate-2)', step: true },
  waiting: { fill: null, edge: 'var(--line-2)' },
  passed: { fill: null },
  failed: { fill: 'var(--crimson)' },
}

export function StateTile({ state, size = 16 }: { state: TileState; size?: number }) {
  const s = TABLE[state]
  if (state === 'passed') return <Tick size={size} />
  const h = Math.max(10, Math.round(size * 0.8))
  return (
    <span
      aria-hidden="true"
      className={s.step ? 'stepping' : undefined}
      style={{
        display: 'inline-block', flex: 'none', width: Math.round(h * 0.68), height: h, borderRadius: 2,
        background: s.fill ?? 'transparent', boxShadow: s.edge ? `inset 0 0 0 1px ${s.edge}` : undefined,
      }}
    />
  )
}

const WARM: TileState[] = ['passed']
const BAD: TileState[] = ['failed', 'expired', 'refundable', 'revoked']

export function State({ state, label }: { state: TileState; label?: string }) {
  return (
    <span className="chip">
      <StateTile state={state} />
      <span style={WARM.includes(state) ? { color: 'var(--ochre)' } : BAD.includes(state) ? { color: 'var(--crimson-text)' } : undefined}>
        {label ?? state}
      </span>
    </span>
  )
}

// A run of caps: a quantity, a share, a progress. `parts` are fractions of the whole, each at its own ramp step (99 is ochre).
export function TileStrip({ parts, cells = 40, height = 18 }: { parts: { share: number; step: number }[]; cells?: number; height?: number }) {
  const out: number[] = []
  let acc = 0
  parts.forEach((p, k) => {
    acc += p.share
    const upto = k === parts.length - 1 && acc > 0.999 ? cells : Math.round(acc * cells)
    while (out.length < upto) out.push(p.step)
  })
  while (out.length < cells) out.push(-1)
  return (
    <span aria-hidden="true" style={{ display: 'grid', gridTemplateColumns: `repeat(${cells}, minmax(0, 1fr))`, gap: 2, width: '100%' }}>
      {out.map((step, i) => (
        <span key={i} style={{ height, borderRadius: 2, background: step < 0 ? 'transparent' : step === 99 ? C.ochre : capFill(step), boxShadow: step < 0 ? 'inset 0 0 0 1px var(--line)' : undefined }} />
      ))}
    </span>
  )
}

// Bytes as tiles in the DOM, for short runs (an address's first bytes, a strip under a figure).
export function ByteTiles({ bytes, size = 18 }: { bytes: ArrayLike<number>; size?: number }) {
  const cells = Array.from({ length: bytes.length }, (_, i) => bytes[i]!)
  return (
    <span aria-hidden="true" style={{ display: 'inline-flex', gap: Math.max(2, Math.round(size * 0.14)) }}>
      {cells.map((b, i) => {
        const step = Math.min(RAMP.length - 1, BARE_BELOW + (b % (RAMP.length - BARE_BELOW)))
        const top = step === RAMP.length - 1
        return (
          <span key={i} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: Math.round(size * 0.72), height: size, borderRadius: 2, background: capFill(step), color: top ? C.ground : b % 19 === 0 ? C.pink : b % 9 === 0 ? C.yellow : C.glyph, fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: Math.round(size * 0.62), lineHeight: 1 }}>
            {RAMP[step]}
          </span>
        )
      })}
    </span>
  )
}
