'use client'

// A value shown whole where it is checked. It sits on one row when the row holds it and breaks at its half when not.

import { useState } from 'react'
import { play } from '@/lib/sound'
import s from './shared.module.css'

export function HalfHash({ value, label = 'value' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const half = Math.ceil(value.length / 2)
  const copy = () => {
    void navigator.clipboard?.writeText(value)
    play('copy')
    setCopied(true)
    setTimeout(() => setCopied(false), 900)
  }
  return (
    <span className={s.half}>
      <span className="mono"><span>{value.slice(0, half)}</span><span>{value.slice(half)}</span></span>
      <button type="button" className={s.copy} onClick={copy} aria-label={`Copy ${label}`} data-copied={copied || undefined}>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          {copied ? <path d="M2 6.4 4.8 9 10 3" fill="none" stroke="currentColor" strokeWidth="1.5" /> : <><rect x="3.75" y="3.75" width="6.5" height="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M1.75 8V1.75H8" fill="none" stroke="currentColor" strokeWidth="1.5" /></>}
        </svg>
      </button>
    </span>
  )
}
