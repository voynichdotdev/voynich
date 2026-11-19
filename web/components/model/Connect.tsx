'use client'

// The panel's own way in: the primary action while no wallet is connected. One wallet connects on the press;
// several are listed in place.

import { useEffect, useRef, useState } from 'react'
import { useWallet } from '@/src/engines/wallet/react'
import { wallet } from '@/lib/wallet'
import s from './call-panel.module.css'

export function Connect({ label = 'Connect wallet' }: { label?: string }) {
  const w = useWallet(wallet)
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('pointerdown', away)
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('pointerdown', away); window.removeEventListener('keydown', key) }
  }, [open])

  const press = () => {
    const only = w.wallets.length === 1 ? w.wallets[0] : undefined
    if (only) void wallet.connect(only.name)
    else setOpen(!open)
  }
  const connecting = w.status === 'connecting'

  return (
    <div className={s.connect} ref={box}>
      <button type="button" className="btn" data-kind="primary" aria-haspopup={w.wallets.length === 1 ? undefined : 'menu'} aria-expanded={w.wallets.length === 1 ? undefined : open} data-pending={connecting || undefined} onClick={press}>
        {connecting ? 'Connecting' : label}
      </button>
      {open ? (
        <div className={s.wallets} role="menu">
          {!w.ready ? <p className="t-small">Looking for wallets</p>
            : w.wallets.length === 0 ? <p className="t-small">No Solana wallet found in this browser. Install one, then reload.</p>
            : w.wallets.map((x) => (
              <button key={x.name} role="menuitem" type="button" onClick={() => { void wallet.connect(x.name); setOpen(false) }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={x.icon} alt="" width={18} height={18} />
                {x.name}
              </button>
            ))}
        </div>
      ) : null}
      {w.error && !open ? <p className="t-small bad" role="alert">{w.error}</p> : null}
    </div>
  )
}
