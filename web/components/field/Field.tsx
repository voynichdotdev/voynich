'use client'

// The field: ciphertext set in a fixed grid of character tiles. The grid never moves; a mass of lit
// cells takes the outline of something sketch-32 names, drifts and re-forms slowly, while the glyphs
// inside it re-resolve fast. A pointer leaves an ochre stroke the cells take in.

import { useEffect, useRef } from 'react'
import { BARE_BELOW, C, RAMP, capFill, cellHash, sampleBytes } from './ramp'
import { FORMS, rasterize } from './forms'
import { play } from '@/lib/sound'

type Props = {
  bytes?: Uint8Array
  /** where the mass sits, in fractions of the canvas; size is a fraction of the shorter side */
  place?: { x: number; y: number; size: number }
  placePhone?: { x: number; y: number; size: number }
  /** cell width in px; height is 1.5 times it */
  pitch?: number
  interactive?: boolean
  arrival?: boolean
  /** index of the first outline, and whether it holds still on it */
  form?: number
  hold?: boolean
  /** overall brightness of the mass, 0..1 */
  level?: number
  className?: string
}

const HOLD = 6.5
const TURN = 2.6

export function Field({
  bytes,
  place = { x: 0.68, y: 0.52, size: 0.72 },
  placePhone,
  pitch,
  interactive = false,
  arrival = false,
  form = 0,
  hold = false,
  level = 1,
  className,
}: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const bytesRef = useRef<Uint8Array>(bytes ?? sampleBytes(4096))
  if (bytes && bytes.length) bytesRef.current = bytes

  useEffect(() => {
    const canvas = ref.current!
    const parent = canvas.parentElement!
    const g = canvas.getContext('2d')!
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    const family = getComputedStyle(document.documentElement).getPropertyValue('--font-jetbrains').trim() || 'monospace'

    let W = 0, H = 0, pw = 16, ph = 24, cols = 0, rows = 0, dpr = 1
    let maps: Float32Array[] = []
    let fw = 0, fh = 0
    let cleared = new Uint8Array(0)
    let ptr = new Uint16Array(0) // each cell's offset into the bytes
    const marks = new Map<number, number>() // cell -> time an ochre stroke crossed it
    const trail: { x: number; y: number; t: number }[] = []
    let raf = 0, running = false, visible = true, t0 = 0, last = 0, tickAt = 0
    const seen = arrival && !reduced && !sessionStorage.getItem('voynich.arrived')
    if (arrival) sessionStorage.setItem('voynich.arrived', '1')

    const layout = () => {
      const r = parent.getBoundingClientRect()
      W = Math.max(1, Math.round(r.width))
      H = Math.max(1, Math.round(r.height))
      dpr = Math.min(2, window.devicePixelRatio || 1)
      pw = pitch ?? Math.max(11, Math.min(20, W * 0.0098))
      pw = Math.round(pw * dpr) / dpr
      ph = Math.round(pw * 1.5 * dpr) / dpr
      cols = Math.ceil(W / pw)
      rows = Math.ceil(H / ph)
      canvas.width = Math.round(W * dpr)
      canvas.height = Math.round(H * dpr)
      canvas.style.width = W + 'px'
      canvas.style.height = H + 'px'

      const p = W < 720 && placePhone ? placePhone : place
      const side = Math.min(W, H) * p.size
      fw = Math.max(8, Math.round(side / pw))
      fh = Math.max(6, Math.round(side / ph))
      maps = FORMS.map((f) => rasterize(f, fw, fh, Math.max(1.6, fh * 0.07)))

      ptr = new Uint16Array(cols * rows)
      for (let i = 0; i < ptr.length; i++) ptr[i] = Math.floor(cellHash(i, 7) * 65535)

      cleared = new Uint8Array(cols * rows)
      parent.querySelectorAll<HTMLElement>('[data-field-clear]').forEach((el) => {
        const b = el.getBoundingClientRect()
        const x0 = Math.floor((b.left - r.left - pw) / pw), x1 = Math.ceil((b.right - r.left + pw) / pw)
        const y0 = Math.floor((b.top - r.top - ph * 0.5) / ph), y1 = Math.ceil((b.bottom - r.top + ph * 0.5) / ph)
        for (let y = Math.max(0, y0); y < Math.min(rows, y1); y++)
          for (let x = Math.max(0, x0); x < Math.min(cols, x1); x++) cleared[y * cols + x] = 1
      })
    }

    const sample = (m: Float32Array, u: number, v: number) => {
      if (u < 0 || v < 0 || u >= fw - 1 || v >= fh - 1) return 0
      const x = Math.floor(u), y = Math.floor(v), ax = u - x, ay = v - y
      const i = y * fw + x
      return (m[i]! * (1 - ax) + m[i + 1]! * ax) * (1 - ay) + (m[i + fw]! * (1 - ax) + m[i + fw + 1]! * ax) * ay
    }

    // smooth value noise on a coarse lattice, 0..1
    const grain = (x: number, y: number) => {
      const xi = Math.floor(x), yi = Math.floor(y), ax = x - xi, ay = y - yi
      const sx = ax * ax * (3 - 2 * ax), sy = ay * ay * (3 - 2 * ay)
      const a = cellHash(xi + yi * 57, 21), b2 = cellHash(xi + 1 + yi * 57, 21)
      const c = cellHash(xi + (yi + 1) * 57, 21), d = cellHash(xi + 1 + (yi + 1) * 57, 21)
      return (a * (1 - sx) + b2 * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy
    }

    const draw = (t: number) => {
      const b = bytesRef.current
      const p = W < 720 && placePhone ? placePhone : place
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.fillStyle = C.ground
      g.fillRect(0, 0, W, H)

      // the grid
      g.fillStyle = C.line
      for (let x = 1; x < cols; x++) g.fillRect(Math.round(x * pw * dpr) / dpr, 0, 1 / dpr, H)
      for (let y = 1; y < rows; y++) g.fillRect(0, Math.round(y * ph * dpr) / dpr, W, 1 / dpr)

      // which outlines, and how far the turn from one to the next has gone
      const cycle = HOLD + TURN
      const n = hold ? 0 : Math.floor(t / cycle)
      const within = hold ? 0 : t - n * cycle
      const turn = within > HOLD ? (within - HOLD) / TURN : 0
      const A = maps[(form + n) % maps.length]!
      const B = maps[(form + n + 1) % maps.length]!

      // the mass drifts by fractions of a cell: the grid stays, the picture moves through it
      const ox = p.x * cols - fw / 2 + Math.sin(t * 0.11) * fw * 0.06
      const oy = p.y * rows - fh / 2 + Math.cos(t * 0.083) * fh * 0.05

      const capW = pw * 0.76, capH = ph * 0.78, capX = (pw - capW) / 2, capY = (ph - capH) / 2
      const rad = Math.max(1, capW * 0.12)
      const fontPx = ph * 0.6
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      const big = `700 ${fontPx}px ${family}`
      const small = `600 ${fontPx * 0.82}px ${family}`
      let font = ''
      const setFont = (f: string) => { if (font !== f) { g.font = f; font = f } }

      const arr = seen ? (t < 0.4 ? 1 : Math.max(0, 1 - (t - 0.4) / 0.9)) : 0

      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const i = y * cols + x
          const h = cellHash(i)
          let v = 0
          const u = x - ox, w = y - oy
          if (u > -1 && w > -1 && u < fw && w < fh) v = (turn > h ? sample(B, u, w) : sample(A, u, w)) * level
          if (cleared[i]) v = 0
          const byte = b[(ptr[i]! + i) % b.length]!
          const mark = marks.get(i)
          const age = mark === undefined ? -1 : t - mark
          const lit = age >= 0.25 && age < 1.3

          let step = -1
          if (v > 0.05) {
            // darker runs cross the mass and describe it the way shading would
            const n = grain(x * 0.16 + t * 0.05, y * 0.24 - t * 0.03)
            const body = v * (0.5 + 0.62 * n)
            step = Math.round(body * (RAMP.length - 1)) + [-2, -1, 0, 1][byte & 3]! - (h > 0.9 ? 4 : 0)
            if (step < 0) step = 0
          }
          if (arr > 0 && !cleared[i] && cellHash(i, 3) < arr) step = Math.max(step, BARE_BELOW + (byte & 3))
          if (lit) step = Math.max(step, 8 + (byte & 3))
          if (step < 0) {
            // loose specks: fixed in place for good
            if (!cleared[i] && cellHash(i, 11) < 0.0045) {
              setFont(small)
              g.fillStyle = C.speck
              g.fillText(["'", '.', 'o', '-'][byte & 3]!, x * pw + pw / 2, y * ph + ph / 2)
            }
            continue
          }
          step = Math.min(RAMP.length - 1, step)
          const ch = RAMP[step]!
          const cx = x * pw, cy = y * ph
          if (step < BARE_BELOW) {
            setFont(small)
            g.fillStyle = C.speck
            g.fillText(ch, cx + pw / 2, cy + ph / 2)
            continue
          }
          g.fillStyle = lit ? C.ochreCap : capFill(step)
          g.beginPath()
          g.roundRect(cx + capX, cy + capY, capW, capH, rad)
          g.fill()
          setFont(big)
          g.fillStyle = lit ? C.ochre : step === RAMP.length - 1 ? C.ground : byte % 19 === 0 ? C.pink : byte % 9 === 0 ? C.yellow : step < 6 ? C.glyphDim : C.glyph
          g.fillText(ch, cx + pw / 2, cy + ph / 2 + fontPx * 0.04)
        }
      }

      // the stroke itself, before the cells take it in
      if (trail.length > 1) {
        g.lineCap = 'round'
        g.lineJoin = 'round'
        for (let k = 1; k < trail.length; k++) {
          const a = trail[k - 1]!, c = trail[k]!
          if (t - c.t > 0.3 || c.t - a.t > 0.12) continue
          // a dry edge: the line breaks where its hash says the pigment missed
          if (cellHash(Math.round(c.x * 3 + c.y * 7), 5) < 0.12) continue
          g.strokeStyle = C.ochre
          g.lineWidth = 2.5 + cellHash(k, 9) * 1.2
          g.beginPath()
          g.moveTo(a.x, a.y)
          g.lineTo(c.x, c.y)
          g.stroke()
        }
      }
    }

    const tick = (t: number) => {
      // fast tempo: about a fifth of the cells take their next byte, fifteen times a second
      const count = Math.floor(ptr.length * 0.2)
      for (let k = 0; k < count; k++) {
        const i = Math.floor(cellHash(k, Math.floor(t * 15)) * ptr.length)
        ptr[i] = (ptr[i]! + 1) & 0xffff
      }
      for (const [i, at] of marks) if (t - at > 1.4) marks.delete(i)
      while (trail.length && t - trail[0]!.t > 0.4) trail.shift()
    }

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      if (now - last < 30) return
      last = now
      const t = Math.max(0, (now - t0) / 1000)
      if (t - tickAt >= 1 / 15) { tickAt = t; tick(t) }
      draw(t)
    }
    const start = () => {
      if (running || reduced || !visible || document.hidden) return
      running = true
      raf = requestAnimationFrame(frame)
    }
    const stop = () => { running = false; cancelAnimationFrame(raf) }

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || !(e.movementX || e.movementY)) return
      const r = canvas.getBoundingClientRect()
      const x = e.clientX - r.left, y = e.clientY - r.top
      if (x < 0 || y < 0 || x > W || y > H) return
      const t = (performance.now() - t0) / 1000
      const prev = trail[trail.length - 1]
      trail.push({ x, y, t })
      // mark every cell the segment crosses
      const x0 = prev && t - prev.t < 0.12 ? prev.x : x, y0 = prev && t - prev.t < 0.12 ? prev.y : y
      const steps = Math.max(1, Math.ceil(Math.hypot(x - x0, y - y0) / (pw * 0.5)))
      let fresh = false
      for (let s = 0; s <= steps; s++) {
        const i = Math.floor((y0 + ((y - y0) * s) / steps) / ph) * cols + Math.floor((x0 + ((x - x0) * s) / steps) / pw)
        if (!marks.has(i)) { marks.set(i, t); fresh = true }
      }
      if (fresh) play('tick')
    }

    layout()
    t0 = performance.now()
    draw(reduced ? 3 : 0)
    document.fonts.load(`700 16px ${family}`).then(() => { if (!running) draw(reduced ? 3 : 0) })

    const ro = new ResizeObserver(() => { layout(); if (!running) draw(reduced ? 3 : 0) })
    ro.observe(parent)
    const io = new IntersectionObserver(([e]) => { visible = !!e?.isIntersecting; if (visible) start(); else stop() })
    io.observe(canvas)
    const onVis = () => (document.hidden ? stop() : start())
    document.addEventListener('visibilitychange', onVis)
    if (interactive && !reduced) window.addEventListener('pointermove', onMove, { passive: true })
    start()

    return () => {
      stop()
      ro.disconnect()
      io.disconnect()
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('pointermove', onMove)
    }
  }, [place.x, place.y, place.size, placePhone?.x, placePhone?.y, placePhone?.size, pitch, interactive, arrival, form, hold, level])

  return <canvas ref={ref} className={className} aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
}
