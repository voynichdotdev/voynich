'use client'

// The same call in each way the product offers it. The choice is shared by every <Ways> on the page.

import { isValidElement, useId, useSyncExternalStore } from 'react'
import { unwrap } from './unwrap'
import { play } from '@/lib/sound'
import s from './kit.module.css'

let chosen = ''
const listeners = new Set<() => void>()
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }

export function Way({ children }: { label: string; children?: React.ReactNode }) {
  return <>{children}</>
}

export function Ways({ children }: { children?: React.ReactNode }) {
  const id = useId()
  const pick = useSyncExternalStore(subscribe, () => chosen, () => '')
  const ways = unwrap(children).flatMap((c) =>
    isValidElement<{ label?: string; children?: React.ReactNode }>(c) && c.props.label ? [{ label: c.props.label, body: c.props.children }] : [],
  )
  const at = Math.max(0, ways.findIndex((w) => w.label === pick))
  const choose = (label: string) => { chosen = label; play('toggle'); listeners.forEach((l) => l()) }
  const key = (e: React.KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!d) return
    e.preventDefault()
    const next = (i + d + ways.length) % ways.length
    choose(ways[next]!.label)
    document.getElementById(`${id}-t${next}`)?.focus()
  }
  return (
    <div className={s.ways}>
      <div className={s.waysTabs}><div className="seg" role="tablist" aria-label="Ways to make this call">
        {ways.map((w, i) => (
          <button key={w.label} id={`${id}-t${i}`} type="button" role="tab" aria-selected={i === at} aria-controls={`${id}-p${i}`} tabIndex={i === at ? 0 : -1} onClick={() => choose(w.label)} onKeyDown={(e) => key(e, i)}>
            {w.label}
          </button>
        ))}
      </div></div>
      {ways.map((w, i) => (
        <div key={w.label} id={`${id}-p${i}`} role="tabpanel" aria-labelledby={`${id}-t${i}`} hidden={i !== at} className={s.waysPanel}>
          {w.body}
        </div>
      ))}
    </div>
  )
}
