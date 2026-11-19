'use client'

// A code block's body: it scrolls sideways inside its own box. On a touch screen, where the browser
// keeps its scrollbar out of sight, a bar under the code shows that there is more and how far along it is.

import { useEffect, useRef } from 'react'
import s from './kit.module.css'

export function Scroll({ html }: { html: string }) {
  const box = useRef<HTMLDivElement>(null)
  const bar = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const el = box.current!, b = bar.current!
    const set = () => {
      const over = el.scrollWidth > el.clientWidth + 1
      b.hidden = !over
      if (!over) return
      const thumb = b.firstElementChild as HTMLElement
      thumb.style.width = `${(el.clientWidth / el.scrollWidth) * 100}%`
      thumb.style.marginLeft = `${(el.scrollLeft / el.scrollWidth) * 100}%`
    }
    set()
    const ro = new ResizeObserver(set)
    ro.observe(el)
    el.addEventListener('scroll', set, { passive: true })
    return () => { ro.disconnect(); el.removeEventListener('scroll', set) }
  }, [html])

  return (
    <>
      <div ref={box} className={s.codeBody} tabIndex={0} dangerouslySetInnerHTML={{ __html: html }} />
      <span ref={bar} className={s.codeBar} aria-hidden="true" hidden><i /></span>
    </>
  )
}
