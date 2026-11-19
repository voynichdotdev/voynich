'use client'

// The model's ciphertext, read from chain a range at a time and set as tiles: an offset, then each byte as a pair
// of hex caps whose brightness is the byte's value. Bytes not written yet are empty cells.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { WeightsRange } from '@voynich/contract'
import { api, read } from '@/lib/api'
import { b64ToBytes, group } from '@/lib/format'
import { BARE_BELOW, C, HEX, RAMP, capFill } from '@/components/field/ramp'
import { Failed, Hash, Size } from '@/components/ui/kit'
import s from './cipher.module.css'
import v from './model-view.module.css'

type Layout = { bpr: number; p: number; gap: number; offW: number; rowH: number; width: number }

const ROW_H = 1.5 // the cell is 2:3
const COLLAPSED_ACCOUNTS = 3

// The widest row that fits: 32 bytes, then 16, then 8, each nibble on a cell between 13 and 16 px wide.
function layoutFor(width: number, offChars: number): Layout {
  for (const bpr of [32, 16, 8]) {
    for (let p = 16; p >= 13; p--) {
      const gap = Math.round(p * 0.25)
      const offW = Math.ceil(offChars * 7.3) + 16
      const need = offW + bpr * (2 * p + gap) - gap
      if (need <= width || (bpr === 8 && p === 13)) return { bpr, p, gap, offW, rowH: Math.round(p * ROW_H), width: need }
    }
  }
  return { bpr: 8, p: 13, gap: 3, offW: Math.ceil(offChars * 7.3) + 16, rowH: 20, width }
}

const hexOffset = (n: number, chars: number) => n.toString(16).padStart(chars, '0')

type Props = { model: string; fixture: string | null; rows?: number; compact?: boolean; hashVersion?: number }

export function CipherView({ model, fixture, rows = 8, compact = false, hashVersion }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [layout, setLayout] = useState<Layout | null>(null)
  const [offset, setOffset] = useState(0)
  const [range, setRange] = useState<WeightsRange | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [reason, setReason] = useState('')
  const [jump, setJump] = useState('')
  const [jumpErr, setJumpErr] = useState('')
  const [again, setAgain] = useState(0)
  const [showAllAccounts, setShowAllAccounts] = useState(false)

  const total = range?.totalBytes ?? 0
  const offChars = total > 0xffffff ? 8 : 6

  useEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => setLayout((prev) => {
      const next = layoutFor(el.clientWidth, offChars)
      return prev && prev.bpr === next.bpr && prev.p === next.p && prev.offW === next.offW ? prev : next
    })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [offChars])

  const bpr = layout?.bpr ?? 0
  const pageBytes = bpr * rows

  useEffect(() => {
    if (!pageBytes) return
    let stale = false
    setState('loading')
    void read(api(fixture).weights(model, { offset, length: pageBytes })).then((r) => {
      if (stale) return
      if (r.ok) { setRange(r.data); setState('ready') } else { setReason(r.message); setState('failed') }
    })
    return () => { stale = true }
  }, [model, fixture, offset, pageBytes, again])

  // A byte is written when a Weights account's written range covers it.
  const written = useCallback((at: number) => {
    if (!range) return false
    for (const a of range.accounts) for (const w of a.writtenRanges) if (at >= w.offset && at < w.offset + w.length) return true
    return false
  }, [range])

  useEffect(() => {
    const el = canvas.current
    if (!el || !layout) return
    const draw = () => {
      const { bpr, p, gap, offW, rowH } = layout
      const w = layout.width, h = rows * rowH
      const dpr = window.devicePixelRatio || 1
      el.width = Math.round(w * dpr)
      el.height = Math.round(h * dpr)
      el.style.width = `${w}px`
      el.style.height = `${h}px`
      const g = el.getContext('2d')
      if (!g) return
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.fillStyle = C.ground
      g.fillRect(0, 0, w, h)
      const family = getComputedStyle(document.documentElement).getPropertyValue('--font-jetbrains').trim() || 'monospace'
      const bytes = range && range.offset === offset ? b64ToBytes(range.bytesBase64) : null
      const total = range?.totalBytes ?? Infinity
      const cw = Math.round(p * 0.78), ch = Math.round(rowH * 0.78)
      g.textBaseline = 'middle'
      for (let r = 0; r < rows; r++) {
        const y = r * rowH
        const rowAt = offset + r * bpr
        if (rowAt >= total) break
        g.font = `400 12px ${family}`
        g.textAlign = 'left'
        g.fillStyle = '#7684a0'
        g.fillText(hexOffset(rowAt, offChars), 0, y + rowH / 2 + 0.5)
        for (let i = 0; i < bpr; i++) {
          const at = rowAt + i
          if (at >= total) break
          const x = offW + i * (2 * p + gap)
          const b = bytes?.[r * bpr + i]
          const has = b !== undefined && written(at)
          for (let n = 0; n < 2; n++) {
            const cx = x + n * p + (p - cw) / 2, cy = y + (rowH - ch) / 2
            if (!has) {
              // not here yet, or not written yet: the cell and nothing on it
              g.strokeStyle = C.caps[0]
              g.lineWidth = 1
              g.strokeRect(Math.round(cx) + 0.5, Math.round(cy) + 0.5, cw - 1, ch - 1)
              continue
            }
            const step = Math.min(RAMP.length - 1, Math.floor((b / 256) * RAMP.length))
            const ch16 = HEX[n === 0 ? b >> 4 : b & 15]!
            g.textAlign = 'center'
            if (step < BARE_BELOW) {
              g.font = `500 ${Math.round(p * 0.74)}px ${family}`
              g.fillStyle = C.speck
            } else {
              g.fillStyle = capFill(step)
              g.beginPath()
              g.roundRect(cx, cy, cw, ch, 2)
              g.fill()
              g.font = `700 ${Math.round(p * 0.8)}px ${family}`
              g.fillStyle = step === RAMP.length - 1 ? C.ground : b % 37 === 0 ? C.pink : b % 19 === 0 ? C.yellow : C.glyph
            }
            g.fillText(ch16, x + n * p + p / 2, y + rowH / 2 + 0.5)
          }
        }
      }
    }
    draw()
    void document.fonts?.ready.then(draw)
  }, [layout, range, offset, rows, written, offChars])

  const end = Math.min(total, offset + pageBytes)
  const go = (to: number) => {
    if (!pageBytes) return
    const max = total > 0 ? Math.floor((total - 1) / pageBytes) * pageBytes : 0
    setOffset(Math.max(0, Math.min(max, Math.floor(to / pageBytes) * pageBytes)))
  }
  const submitJump = (e: React.FormEvent) => {
    e.preventDefault()
    const t = jump.trim().toLowerCase()
    const n = /^0x[0-9a-f]+$/.test(t) ? parseInt(t.slice(2), 16) : /^[0-9][0-9,]*$/.test(t) ? Number(t.replaceAll(',', '')) : NaN
    if (!Number.isFinite(n) || (total > 0 && n >= total)) { setJumpErr(total ? `Enter an offset below ${group(total)}.` : 'Enter an offset.'); return }
    setJumpErr('')
    go(n)
  }
  const accounts = range?.accounts ?? []
  const visibleAccounts = showAllAccounts || accounts.length <= COLLAPSED_ACCOUNTS + 1 ? accounts : accounts.slice(0, COLLAPSED_ACCOUNTS)
  const writtenBytes = accounts.reduce((sum, a) => sum + a.writtenRanges.reduce((x, w) => x + w.length, 0), 0)
  const whole = accounts.reduce((sum, a) => sum + a.sizeBytes, 0)
  const hashLabel = hashVersion === undefined ? null : hashVersion === 1 ? '64 KiB chunk Merkle root' : 'Flat SHA-256 (legacy)'

  return (
    <div className={s.view} data-compact={compact || undefined}>
      <div className={s.top}>
        <div className={s.accountGroup}>
          <ul className={s.accounts} aria-label="Weights accounts">
            {visibleAccounts.length ? visibleAccounts.map((a) => (
              <li key={a.address}>
                <span className="t-label">Weights account {a.index}</span>
                <Hash value={a.address} chars={compact ? 4 : 6} label="Weights account address" />
                <button type="button" className={`mono dim ${s.rangeJump}`} onClick={() => go(a.offset)} title="Jump to account offset">
                  {group(a.offset)} to {group(a.offset + a.sizeBytes)}
                </button>
              </li>
            )) : <li><span className="skeleton" style={{ width: 260 }} /></li>}
          </ul>
          {accounts.length > COLLAPSED_ACCOUNTS + 1 ? (
            <button type="button" className={`link t-small ${s.moreAccounts}`} onClick={() => setShowAllAccounts((prev) => !prev)}>
              {showAllAccounts ? 'Show fewer accounts' : `Show all ${group(accounts.length)} Weights accounts`}
            </button>
          ) : null}
        </div>
        <div className={s.total}>
          {total ? <Size n={total} size="s" /> : null}
          {accounts.length > 1 ? <span className="mono dim">{group(accounts.length)} accounts</span> : null}
          {hashLabel ? <span className="t-label">{hashLabel}</span> : null}
          {whole > 0 && writtenBytes < whole ? <span className="t-small dim">{group(writtenBytes)} of {group(whole)} bytes written</span> : null}
        </div>
      </div>

      <div ref={box} className={`${s.dump} ${v.fail}`} data-state={state}>
        {state === 'failed' ? (
          <Failed title="The ciphertext did not load" message={reason} retry={<button type="button" className="btn" data-size="s" onClick={() => setAgain((n) => n + 1)}>Try again</button>} />
        ) : (
          <canvas ref={canvas} className={state === 'loading' ? 'stepping' : undefined} role="img" aria-label={total ? `Ciphertext bytes ${group(offset)} to ${group(end)} of ${group(total)}, as hex` : 'Reading the ciphertext from chain'} />
        )}
      </div>

      <div className={s.foot}>
        <span className="mono dim" aria-live="polite">
          {state === 'loading' && !total ? 'Reading from chain' : <>{hexOffset(offset, offChars)} to {hexOffset(Math.max(offset, end - 1), offChars)} <span className={s.of}>of {group(total)} bytes</span></>}
        </span>
        <div className={s.pager}>
          {compact ? null : (
            <form className={s.jump} onSubmit={submitJump} noValidate>
              <label htmlFor={`jump-${model}`} className="t-label">Offset</label>
              <input id={`jump-${model}`} className="input mono" inputMode="text" autoComplete="off" spellCheck={false} placeholder="0x000000" value={jump} onChange={(e) => { setJump(e.target.value); setJumpErr('') }} aria-invalid={jumpErr ? true : undefined} aria-describedby={jumpErr ? `jump-err-${model}` : undefined} />
              <button type="submit" className="btn" data-size="s">Go</button>
            </form>
          )}
          <button type="button" className="btn" data-size="s" onClick={() => go(offset - pageBytes)} disabled={offset <= 0 || state === 'failed'}>Previous</button>
          <button type="button" className="btn" data-size="s" onClick={() => go(offset + pageBytes)} disabled={!total || end >= total || state === 'failed'}>Next</button>
        </div>
      </div>
      {jumpErr ? <p id={`jump-err-${model}`} className={`t-small bad ${s.jumpErr}`} role="alert">{jumpErr}</p> : null}
    </div>
  )
}
