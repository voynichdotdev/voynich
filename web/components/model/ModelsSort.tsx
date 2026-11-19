'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Tabs } from '@/components/ui/kit'
import s from './model-view.module.css'

export type Sort = 'calls' | 'newest' | 'price'

// The list's order, kept in the address as `?sort=` so a sorted list can be linked.
export function ModelsSort({ value }: { value: Sort }) {
  const router = useRouter()
  const path = usePathname()
  const params = useSearchParams()
  const set = (next: Sort) => {
    const p = new URLSearchParams(params.toString())
    p.delete('cursor')
    if (next === 'calls') p.delete('sort')
    else p.set('sort', next)
    const q = p.toString()
    router.replace(q ? `${path}?${q}` : path, { scroll: false })
  }
  return (
    <div className={s.headActs}>
      <span className={s.sortLabel} id="sort-label">Sort by</span>
      <Tabs<Sort> value={value} onChange={set} label="Sort models by" items={[{ id: 'calls', label: 'Calls' }, { id: 'newest', label: 'Newest' }, { id: 'price', label: 'Price' }]} />
    </div>
  )
}
