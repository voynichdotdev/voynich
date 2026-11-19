// Parts the receipt, the account and the seal flow share: the scenario query, money for a bare amount, the split strip.

import type { Money } from '@voynich/contract'
import { capFill } from '@/components/field/ramp'
import { TileStrip } from '@/components/tile/Tile'
import { short, type MoneyLike } from '@/lib/format'
import s from './shared.module.css'

// Carries the page's scenario onto a link.
export const q = (fixture: string | null | undefined) => (fixture ? `?fixture=${fixture}` : '')

// An amount the chain gives without its unit takes it from a price in the same mint; SOL is known.
export function moneyOf(amount: string, mint: string | null, known: (Money | null | undefined)[] = []): MoneyLike {
  if (mint === null) return { amount, decimals: 9, symbol: 'SOL' }
  const hit = known.find((k) => k && k.mint === mint)
  return hit ? { amount, decimals: hit.decimals, symbol: hit.symbol } : { amount, decimals: 0, symbol: short(mint, 4) }
}

export const SPLIT_STEPS = { owner: 13, operator: 9, protocol: 5 } as const

export type SplitPart = { id: keyof typeof SPLIT_STEPS; label: string; share: number; value?: React.ReactNode; note?: React.ReactNode }

// A price as one run of caps, each recipient at its own brightness, the values written under it.
export function Split({ parts, cells = 40 }: { parts: SplitPart[]; cells?: number }) {
  return (
    <div className={s.split}>
      <TileStrip cells={cells} height={16} parts={parts.map((p) => ({ share: p.share, step: SPLIT_STEPS[p.id] }))} />
      <dl className={s.legend}>
        {parts.map((p) => (
          <div key={p.id}>
            <dt><span className={s.swatch} style={{ background: capFill(SPLIT_STEPS[p.id]) }} aria-hidden="true" />{p.label}</dt>
            <dd className="mono">{p.value ?? `${Math.round(p.share * 1000) / 10}%`}</dd>
            {p.note ? <dd className={s.note}>{p.note}</dd> : null}
          </div>
        ))}
      </dl>
    </div>
  )
}
