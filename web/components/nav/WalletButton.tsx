'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useWallet } from '@/src/engines/wallet/react'
import { shortAddress } from '@/src/engines/core/encoding'
import { wallet } from '@/lib/wallet'
import s from './WalletButton.module.css'

export function WalletButton({ label = 'Connect wallet', kind }: { label?: string; kind?: 'primary' }) {
  const w = useWallet(wallet)
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('pointerdown', away)
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('pointerdown', away); window.removeEventListener('keydown', key) }
  }, [open])

  const connected = w.status === 'connected' && w.address
  return (
    <div className={s.box} ref={box}>
      <button type="button" className="btn" data-size="s" data-kind={connected ? undefined : kind} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} data-pending={w.status === 'connecting'}>
        {connected ? <span className="mono">{shortAddress(w.address!)}</span> : w.status === 'connecting' ? 'Connecting' : label}
      </button>
      {open ? (
        <div className={s.menu} role="menu">
          {connected ? (
            <>
              <Link role="menuitem" href="/account" className={s.item} onClick={() => setOpen(false)}>Account</Link>
              <button role="menuitem" type="button" className={s.item} onClick={() => { void navigator.clipboard?.writeText(w.address!); setOpen(false) }}>Copy address</button>
              <button role="menuitem" type="button" className={s.item} onClick={() => { void wallet.disconnect(); setOpen(false) }}>Disconnect</button>
            </>
          ) : !w.ready ? (
            <p className={s.note}>Looking for wallets</p>
          ) : w.wallets.length === 0 ? (
            <p className={s.note}>No Solana wallet found in this browser. Install one, then reload.</p>
          ) : (
            w.wallets.map((x) => (
              <button key={x.name} role="menuitem" type="button" className={s.item} onClick={() => { void wallet.connect(x.name); setOpen(false) }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={x.icon} alt="" width={18} height={18} />
                {x.name}
              </button>
            ))
          )}
          {w.error ? <p className={`${s.note} bad`}>{w.error}</p> : null}
        </div>
      ) : null}
    </div>
  )
}
