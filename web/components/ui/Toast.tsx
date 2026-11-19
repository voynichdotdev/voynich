'use client'

import { useSyncExternalStore } from 'react'
import { StateTile, type TileState } from '@/components/tile/Tile'
import s from './Toast.module.css'

type Toast = { id: number; state: TileState; text: string; href?: string; hrefLabel?: string }
let items: Toast[] = []
let n = 0
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function toast(t: Omit<Toast, 'id'>, ms = 6000) {
  const id = ++n
  items = [...items, { ...t, id }].slice(-3)
  emit()
  setTimeout(() => { items = items.filter((x) => x.id !== id); emit() }, ms)
}

export function Toasts() {
  const list = useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => items, () => items)
  return (
    <div className={s.stack} role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={s.toast}>
          <StateTile state={t.state} />
          <span>{t.text}</span>
          {t.href ? <a className="link" href={t.href}>{t.hrefLabel ?? 'Open'}</a> : null}
        </div>
      ))}
    </div>
  )
}
