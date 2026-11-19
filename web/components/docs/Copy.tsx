'use client'

import { useState } from 'react'
import { play } from '@/lib/sound'
import s from './kit.module.css'

export function Copy({ text, label = 'code' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    void navigator.clipboard?.writeText(text)
    play('copy')
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }
  return (
    <button type="button" className={s.copy} onClick={copy} data-copied={copied || undefined} aria-label={`Copy ${label}`}>
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        {copied ? <path d="M2 6.4 4.8 9 10 3" fill="none" stroke="currentColor" strokeWidth="1.5" /> : <><rect x="3.75" y="3.75" width="6.5" height="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M1.75 8V1.75H8" fill="none" stroke="currentColor" strokeWidth="1.5" /></>}
      </svg>
      <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
    </button>
  )
}
