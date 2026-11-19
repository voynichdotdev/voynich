// Parts the enclave screens share: an enclave's life against the current slot, and earnings as figures.
import type { AttestationRecord } from '@voynich/contract'
import { group, short, type MoneyLike } from '@/lib/format'
import s from './enclave.module.css'

// Earnings are money. A receipt's payment carries a mint and an amount only: no mint is SOL, another mint is shown in its base units under its address.
export function earned(e: { mint: string | null; amount: string; decimals?: number; symbol?: string }): MoneyLike {
  if (e.decimals !== undefined && e.symbol) return { amount: e.amount, decimals: e.decimals, symbol: e.symbol }
  return e.mint === null ? { amount: e.amount, decimals: 9, symbol: 'SOL' } : { amount: e.amount, decimals: 0, symbol: short(e.mint, 4) }
}

export function lifeOf(record: Pick<AttestationRecord, 'recordedSlot' | 'expiresAtSlot'>, currentSlot: string) {
  const from = BigInt(record.recordedSlot), to = BigInt(record.expiresAtSlot), now = BigInt(currentSlot)
  const span = to > from ? to - from : 1n
  const gone = now <= from ? 0n : now >= to ? span : now - from
  const share = Number((gone * 10000n) / span) / 10000
  return { share, left: to > now ? to - now : 0n, past: now > to ? now - to : 0n, expired: now >= to }
}

const percent = (share: number) => (share > 0 && share < 0.0001 ? 'under 0.01%' : `${(share * 100).toFixed(share < 0.1 ? 2 : 0).replace(/\.?0+$/, '') || '0'}%`)

// A record's life as one run of caps from its recorded slot to its expiry slot. The part gone is bright,
// the part left is dim; an expired record is the whole run in crimson. What is left is written on it.
export function Track({ gone, over, cells, children }: { gone: number; over: boolean; cells: number; children?: React.ReactNode }) {
  const lit = over ? cells : gone > 0 ? Math.max(1, Math.round(gone * cells)) : 0
  return (
    <span className={s.track} data-over={over || undefined}>
      <span className={s.trackCells} aria-hidden="true" style={{ gridTemplateColumns: `repeat(${cells}, minmax(0, 1fr))` }}>
        {Array.from({ length: cells }, (_, i) => <i key={i} data-gone={i < lit || undefined} />)}
      </span>
      {children ? <span className={s.trackSays}><span>{children}</span></span> : null}
    </span>
  )
}

const left = (l: ReturnType<typeof lifeOf>) => (
  l.expired
    ? <>Expired <span className="mono">{group(l.past.toString())}</span> slots ago</>
    : <><span className="mono">{group(l.left.toString())}</span> slots left</>
)

// The life of a record on its own page.
export function Life({ record, currentSlot, expired, cells = 48 }: { record: AttestationRecord; currentSlot: string; expired?: boolean; cells?: number }) {
  const l = lifeOf(record, currentSlot)
  const over = expired || l.expired
  return (
    <div className={s.life}>
      <div className={s.lifeEnds}>
        <span><span className="t-label">Recorded at slot</span> <span className="mono">{group(record.recordedSlot)}</span></span>
        <span><span className="t-label">Expires at slot</span> <span className={`mono ${over ? 'bad' : ''}`}>{group(record.expiresAtSlot)}</span></span>
      </div>
      <Track gone={l.share} over={over} cells={cells}>{left({ ...l, expired: over })}</Track>
      <p className="t-small" aria-live="polite">
        {over ? (
          <span className="bad">The record ran out at slot <span className="mono">{group(record.expiresAtSlot)}</span>. The chain is at slot <span className="mono">{group(currentSlot)}</span>.</span>
        ) : (
          <><span className="mono" style={{ color: 'var(--text)' }}>{percent(l.share)}</span> of its life is gone at slot <span className="mono">{group(currentSlot)}</span>.</>
        )}
      </p>
    </div>
  )
}

// The same life, short, for a row of the registry.
export function LifeShort({ record, currentSlot, expired }: { record: Pick<AttestationRecord, 'recordedSlot' | 'expiresAtSlot'>; currentSlot: string; expired?: boolean }) {
  const l = lifeOf(record, currentSlot)
  const over = expired || l.expired
  return (
    <span className={s.lifeShort} data-over={over || undefined}>
      <Track gone={l.share} over={over} cells={16} />
      <span className={s.lifeShortSays}>{left({ ...l, expired: over })}</span>
    </span>
  )
}
