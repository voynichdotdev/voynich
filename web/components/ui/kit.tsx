'use client'

// The kit's small parts, used by every surface. One file so nothing is styled on its own.

import Link from 'next/link'
import { useState } from 'react'
import { StateTile } from '@/components/tile/Tile'
import { bytes as fmtBytes, money, short, type MoneyLike } from '@/lib/format'
import { explorerUrl } from '@/lib/env'
import { play } from '@/lib/sound'
import s from './kit.module.css'

// A value the chain holds: mono, middle-truncated, the whole of it on focus or hover, copied on press.
export function Hash({ value, chars = 6, full = false, href, label }: { value: string; chars?: number; full?: boolean; href?: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    void navigator.clipboard?.writeText(value)
    play('copy')
    setCopied(true)
    setTimeout(() => setCopied(false), 900)
  }
  const text = full ? value : short(value, chars)
  return (
    <span className={s.hash} data-full={full || undefined}>
      {href ? <Link href={href} className={`mono link ${s.hashText}`} title={value}>{text}</Link> : <span className={`mono ${s.hashText}`} title={value}>{text}</span>}
      <button type="button" className={s.copy} onClick={copy} aria-label={`Copy ${label ?? 'value'}`} data-copied={copied || undefined}>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          {copied ? <path d="M2 6.4 4.8 9 10 3" fill="none" stroke="currentColor" strokeWidth="1.5" /> : <><rect x="3.75" y="3.75" width="6.5" height="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M1.75 8V1.75H8" fill="none" stroke="currentColor" strokeWidth="1.5" /></>}
        </svg>
      </button>
    </span>
  )
}

export function Explorer({ kind, id, children }: { kind: 'tx' | 'address'; id: string; children?: React.ReactNode }) {
  return <a className="link" href={explorerUrl(kind, id)} target="_blank" rel="noreferrer">{children ?? 'Explorer'} ↗</a>
}

export function Amount({ value, size }: { value: MoneyLike; size?: 'l' | 'm' | 's' }) {
  return <span className={size ? `t-fig t-fig-${size}` : 'mono'}>{money(value)}<span className="unit">{value.symbol}</span></span>
}

export function Size({ n, size }: { n: number; size?: 'l' | 'm' | 's' }) {
  const b = fmtBytes(n)
  return <span className={size ? `t-fig t-fig-${size}` : 'mono'}>{b.value}<span className="unit">{b.unit}</span></span>
}

export function Stat({ label, children, note }: { label: string; children: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div className={s.stat}>
      <div className="t-label">{label}</div>
      <div className={s.statValue}>{children}</div>
      {note ? <div className="t-small dim">{note}</div> : null}
    </div>
  )
}

// First use and empty: cells with nothing in them yet, one line, one action. Dashed is the grammar's "not yet".
export function Empty({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className={s.empty}>
      <span className={s.emptyCells} aria-hidden="true">{Array.from({ length: 12 }, (_, i) => <span key={i} />)}</span>
      <h3 className="t-h3">{title}</h3>
      {children ? <p className="t-small">{children}</p> : null}
      {action ? <div className={s.emptyAct}>{action}</div> : null}
    </div>
  )
}

export function Failed({ title = 'This did not load', message, retry }: { title?: string; message: string; retry?: React.ReactNode }) {
  return (
    <div className={s.failed} role="alert">
      <StateTile state="failed" />
      <div>
        <h3 className="t-h3">{title}</h3>
        <p className="t-small">{message}</p>
      </div>
      {retry ?? <a className="btn" data-size="s" href="">Try again</a>}
    </div>
  )
}

export function Loading({ rows = 4, label = 'Reading from chain' }: { rows?: number; label?: string }) {
  return (
    <div className={s.loading} role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => <span key={i} className="skeleton" style={{ width: `${88 - ((i * 23) % 40)}%`, animationDelay: `${i * 0.11}s` }} />)}
      <span className="sr-only">{label}</span>
    </div>
  )
}

export function Tabs<T extends string>({ value, onChange, items, label }: { value: T; onChange: (v: T) => void; items: { id: T; label: string }[]; label: string }) {
  return (
    <div className="seg" role="tablist" aria-label={label}>
      {items.map((i) => (
        <button key={i.id} type="button" role="tab" aria-selected={value === i.id} onClick={() => { play('toggle'); onChange(i.id) }}>{i.label}</button>
      ))}
    </div>
  )
}
