'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { PLACES, PRODUCT, SKETCH32 } from '@/lib/facts'
import { Underline } from '@/components/drawn/Drawn'
import { Wordmark } from './Mark'
import { WalletButton } from './WalletButton'
import { setSound, useSound } from '@/lib/sound'
import { useWallet } from '@/src/engines/wallet/react'
import { wallet } from '@/lib/wallet'
import s from './Nav.module.css'

export function Nav() {
  const path = usePathname()
  const home = path === '/'
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)
  const sound = useSound()
  const connected = useWallet(wallet).status === 'connected'

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8)
    on()
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])
  useEffect(() => setOpen(false), [path])
  useEffect(() => {
    if (!open) return
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    // the page under the sheet is out of reach until it closes
    const under = document.querySelectorAll<HTMLElement>('main, footer')
    under.forEach((el) => { el.inert = true })
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', key)
    return () => { under.forEach((el) => { el.inert = false }); document.body.style.overflow = ''; window.removeEventListener('keydown', key) }
  }, [open])

  const current = (href: string) => path === href || path.startsWith(href + '/')

  return (
    <header className={s.bar} data-over={home && !scrolled && !open ? 'field' : 'ground'}>
      <div className={`container ${s.row}`}>
        <Link href="/" className={s.brand} aria-label={`${PRODUCT.name}, home`}>
          <Wordmark />
        </Link>
        <nav className={s.places} aria-label="Places">
          {PLACES.map((p) => (
            <Link key={p.href} href={p.href} className={s.place} aria-current={current(p.href) ? 'page' : undefined}>
              {p.label}
              {current(p.href) ? <Underline className={s.under} /> : null}
            </Link>
          ))}
        </nav>
        <div className={s.right}>
          <button type="button" className={s.sound} aria-pressed={sound} aria-label={sound ? 'Turn sound off' : 'Turn sound on'} title={sound ? 'Sound on' : 'Sound off'} onClick={() => setSound(!sound)}>
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              {[3, 7, 11, 15].map((x, i) => (
                <rect key={x} x={x - 1} y={sound ? [6, 3, 5, 7][i] : 8} width="2" height={sound ? [6, 12, 8, 4][i] : 2} fill="currentColor" />
              ))}
            </svg>
          </button>
          {home && !connected ? (
            <Link href={`/models/${SKETCH32.id}`} className="btn" data-kind="primary" data-size="s">Call {SKETCH32.name}</Link>
          ) : (
            <WalletButton />
          )}
          <button type="button" className={s.menu} aria-expanded={open} aria-controls="nav-sheet" aria-label={open ? 'Close menu' : 'Open menu'} onClick={() => setOpen(!open)}>
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              {open ? <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.5" /> : <path d="M2 5.5h14M2 12.5h14" stroke="currentColor" strokeWidth="1.5" />}
            </svg>
          </button>
        </div>
      </div>
      {open ? (
        <div id="nav-sheet" className={s.sheet} role="dialog" aria-modal="true" aria-label="Places">
          <nav className="container">
            {PLACES.map((p) => (
              <Link key={p.href} href={p.href} className={s.sheetItem} aria-current={current(p.href) ? 'page' : undefined}>{p.label}</Link>
            ))}
            <Link href="/account" className={s.sheetItem} aria-current={current('/account') ? 'page' : undefined}>Account</Link>
          </nav>
        </div>
      ) : null}
    </header>
  )
}
