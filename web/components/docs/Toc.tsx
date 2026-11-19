'use client'

// The page's sections, with the one being read marked.

import { useEffect, useState } from 'react'
import type { Heading } from '@/lib/docs'
import s from './docs.module.css'

export function Toc({ headings }: { headings: Heading[] }) {
  const [active, setActive] = useState(headings[0]?.id ?? '')

  useEffect(() => {
    const els = headings.map((h) => document.getElementById(h.id)).filter((e): e is HTMLElement => !!e)
    if (!els.length) return
    const inBand = new Set<string>()
    // the first heading in the reading band; with none there, the last one already passed
    const mark = () => {
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) return setActive(els[els.length - 1]!.id)
      const first = els.find((e) => inBand.has(e.id))
      if (first) return setActive(first.id)
      const passed = els.filter((e) => e.getBoundingClientRect().top < 120)
      setActive((passed[passed.length - 1] ?? els[0]!).id)
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) inBand.add(e.target.id)
          else inBand.delete(e.target.id)
        }
        mark()
      },
      { rootMargin: '-72px 0px -60% 0px' },
    )
    els.forEach((e) => io.observe(e))
    // a jump (End, a far anchor) can cross the band without touching it
    window.addEventListener('scrollend', mark)
    return () => { io.disconnect(); window.removeEventListener('scrollend', mark) }
  }, [headings])

  if (headings.length < 2) return <div className={s.toc} />
  return (
    <nav className={s.toc} aria-label="On this page">
      <h2 className={s.tocTitle}>On this page</h2>
      <ul>
        {headings.map((h) => (
          <li key={h.id}>
            <a href={`#${h.id}`} className={s.tocLink} data-depth={h.depth} aria-current={h.id === active ? 'location' : undefined}>
              {h.id === active ? (
                <svg className={s.here} viewBox="0 0 6 20" aria-hidden="true">
                  <path d="M3.3 1.5 C 2.4 6, 3.9 11, 2.9 18.5" fill="none" stroke="var(--ochre)" strokeWidth="2" strokeLinecap="round" />
                </svg>
              ) : null}
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
