'use client'

// The drawing surface: a square a person draws on in the dry-edged ochre line, over the model's 28x28 grid.
// When the input is encrypted the same square shows the envelope's bytes as tiles, taken in a cell at a time.

import { useEffect, useRef } from 'react'
import { BARE_BELOW, C, RAMP, capFill, cellHash } from '@/components/field/ramp'
import { play } from '@/lib/sound'
import { RESOLVE_TICK_MS } from '@/lib/motion'
import { SIDE, type Point, type Stroke } from './sketch'
import s from './call-panel.module.css'

// The tile grid over the square: 28 cells across at 2:3 comes to 19 rows.
const COLS = 28
const ROWS = 19
const SWEEP_TICKS = 10

function monoFamily() {
  return getComputedStyle(document.documentElement).getPropertyValue('--font-jetbrains').trim() || 'monospace'
}

// One byte as a tile in a cell at (x, y) of pitch (w, h).
export function drawTile(g: CanvasRenderingContext2D, b: number, x: number, y: number, w: number, h: number, family: string) {
  const step = Math.min(RAMP.length - 1, Math.floor((b / 256) * RAMP.length))
  const glyph = RAMP[step]!
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  if (step < BARE_BELOW) {
    g.font = `500 ${Math.round(w * 0.62)}px ${family}`
    g.fillStyle = C.speck
    g.fillText(glyph, x + w / 2, y + h / 2)
    return
  }
  const cw = w * 0.75, ch = h * 0.75
  g.fillStyle = capFill(step)
  g.beginPath()
  g.roundRect(x + (w - cw) / 2, y + (h - ch) / 2, cw, ch, cw * 0.12)
  g.fill()
  g.font = `700 ${Math.round(w * 0.74)}px ${family}`
  g.fillStyle = step === RAMP.length - 1 ? C.ground : b % 19 === 0 ? C.pink : b % 9 === 0 ? C.yellow : C.glyph
  g.fillText(glyph, x + w / 2, y + h / 2 + h * 0.02)
}

function drawStrokes(g: CanvasRenderingContext2D, strokes: Stroke[], size: number) {
  const base = Math.max(3, size * 0.013)
  g.lineCap = g.lineJoin = 'round'
  g.strokeStyle = g.fillStyle = C.ochre
  strokes.forEach((st, k) => {
    const a = st[0]
    if (!a) return
    if (st.length === 1) {
      g.beginPath(); g.arc(a.x * size, a.y * size, base * 0.6, 0, Math.PI * 2); g.fill()
      return
    }
    for (let i = 1; i < st.length; i++) {
      const p = st[i - 1]!, q = st[i]!
      // The dry edge: the line thins and swells along its run, and now and then lets go of the ground.
      const slow = cellHash(Math.floor(i / 5), k * 31 + 7)
      const fast = cellHash(i, k * 17 + 3)
      if (st.length > 10 && fast < 0.06) continue
      g.lineWidth = base * (0.62 + 0.5 * slow + 0.22 * fast)
      g.beginPath()
      g.moveTo(p.x * size, p.y * size)
      g.lineTo(q.x * size, q.y * size)
      g.stroke()
    }
  })
}

type Props = {
  strokes: Stroke[]
  onChange: (next: Stroke[]) => void
  // The encrypted input. While set, the square shows it as tiles and takes no strokes.
  cipher: Uint8Array | null
  disabled?: boolean
  label: string
}

export function DrawPad({ strokes, onChange, cipher, disabled, label }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const live = useRef<Stroke | null>(null)
  const state = useRef({ strokes, cipher, sweep: cipher ? 1 : 0 })
  const paint = useRef<() => void>(() => {})

  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const family = monoFamily()
    const draw = () => {
      const size = el.clientWidth
      if (!size) return
      const dpr = window.devicePixelRatio || 1
      if (el.width !== Math.round(size * dpr)) el.width = el.height = Math.round(size * dpr)
      const g = el.getContext('2d')
      if (!g) return
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.fillStyle = C.ground
      g.fillRect(0, 0, size, size)
      g.strokeStyle = C.line
      g.lineWidth = 1
      g.beginPath()
      for (let i = 1; i < SIDE; i++) {
        const v = Math.round((i * size) / SIDE) + 0.5
        g.moveTo(v, 0); g.lineTo(v, size); g.moveTo(0, v); g.lineTo(size, v)
      }
      g.stroke()
      const st = state.current
      drawStrokes(g, live.current ? [...st.strokes, live.current] : st.strokes, size)
      if (st.cipher && st.sweep > 0) {
        const w = size / COLS, h = size / ROWS
        for (let i = 0; i < COLS * ROWS; i++) {
          if (cellHash(i, 408) >= st.sweep) continue
          const x = (i % COLS) * w, y = Math.floor(i / COLS) * h
          g.fillStyle = C.ground
          g.fillRect(x, y, Math.ceil(w), Math.ceil(h))
          drawTile(g, st.cipher[i % st.cipher.length]!, x, y, w, h, family)
        }
      }
    }
    paint.current = draw
    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(el)
    void document.fonts?.ready.then(draw)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    state.current.strokes = strokes
    paint.current()
  }, [strokes])

  // The input turning into ciphertext: cells go over in steps, never a fade.
  useEffect(() => {
    const st = state.current
    const was = st.cipher
    st.cipher = cipher
    if (!cipher) { st.sweep = 0; paint.current(); return }
    if (was || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { st.sweep = 1; paint.current(); return }
    let tick = 0
    st.sweep = 0
    const id = setInterval(() => {
      tick++
      st.sweep = tick / SWEEP_TICKS
      paint.current()
      if (tick >= SWEEP_TICKS) clearInterval(id)
    }, RESOLVE_TICK_MS)
    return () => { clearInterval(id); st.sweep = 1 }
  }, [cipher])

  const locked = disabled || !!cipher
  const at = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }
  }
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (locked || (e.pointerType === 'mouse' && e.button !== 0)) return
    e.currentTarget.setPointerCapture(e.pointerId)
    live.current = [at(e)]
    paint.current()
  }
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const cur = live.current
    if (!cur) return
    const size = e.currentTarget.clientWidth
    const events = e.nativeEvent.getCoalescedEvents?.() ?? []
    for (const ev of events.length ? events : [e.nativeEvent]) {
      const r = e.currentTarget.getBoundingClientRect()
      const p = { x: Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)) }
      const last = cur[cur.length - 1]!
      if (Math.hypot(p.x - last.x, p.y - last.y) * size >= 2) cur.push(p)
    }
    paint.current()
  }
  const up = () => {
    const cur = live.current
    if (!cur) return
    live.current = null
    play('stroke')
    onChange([...state.current.strokes, cur])
  }

  return (
    <canvas
      ref={canvas}
      className={s.pad}
      role="img"
      aria-label={label}
      data-locked={locked || undefined}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    />
  )
}

// What the model receives: the 28x28 values as a small grid of caps, brighter where there is more ink.
export function InputGrid({ values, cell = 4 }: { values: number[]; cell?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const dpr = window.devicePixelRatio || 1
    const size = SIDE * cell
    el.width = el.height = Math.round(size * dpr)
    const g = el.getContext('2d')
    if (!g) return
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.fillStyle = C.ground
    g.fillRect(0, 0, size, size)
    const top = RAMP.length - 1
    for (let i = 0; i < SIDE * SIDE; i++) {
      const v = values[i] ?? 0
      const x = (i % SIDE) * cell, y = Math.floor(i / SIDE) * cell
      if (v < 0.04) {
        g.fillStyle = C.line
        g.fillRect(x + cell / 2 - 0.5, y + cell / 2 - 0.5, 1, 1)
        continue
      }
      g.fillStyle = capFill(BARE_BELOW + Math.round(v * (top - BARE_BELOW)))
      g.fillRect(x + 0.5, y + 0.5, cell - 1, cell - 1)
    }
  }, [values, cell])
  return <canvas ref={canvas} className={s.inputGrid} style={{ width: SIDE * cell, height: SIDE * cell }} role="img" aria-label="The 28 by 28 input the model receives" />
}
