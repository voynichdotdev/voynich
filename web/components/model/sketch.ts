// A drawing as the model takes it. The preprocessing is the manifest's, the same on every client:
// crop to the ink, scale the longer side to 24 px keeping aspect, center in 28x28, background 0, ink 1.

export type Point = { x: number; y: number } // in the surface's own box, 0..1
export type Stroke = Point[]

export const SIDE = 28
const BOX = 24
// The line's weight in the 28 px frame. The training bitmaps carry lines about 2 px wide.
const LINE = 2
const SUPER = 8

export function hasInk(strokes: Stroke[]): boolean {
  return strokes.some((s) => s.length > 0)
}

// 784 values, row-major, 0 (ground) to 1 (ink).
export function rasterize(strokes: Stroke[]): number[] {
  const out = new Array<number>(SIDE * SIDE).fill(0)
  const pts = strokes.flat()
  if (!pts.length || typeof document === 'undefined') return out
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0
  for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y) }
  const long = Math.max(x1 - x0, y1 - y0)
  // The ink's box includes the line's own weight, so the path fits in what is left of 24 px.
  const k = long > 1e-4 ? (BOX - LINE) / long : 0
  const ox = SIDE / 2 - ((x0 + x1) / 2) * k
  const oy = SIDE / 2 - ((y0 + y1) / 2) * k

  const c = document.createElement('canvas')
  c.width = c.height = SIDE * SUPER
  const g = c.getContext('2d', { willReadFrequently: true })
  if (!g) return out
  g.fillStyle = '#000'
  g.fillRect(0, 0, c.width, c.height)
  g.scale(SUPER, SUPER)
  g.strokeStyle = g.fillStyle = '#fff'
  g.lineWidth = LINE
  g.lineCap = g.lineJoin = 'round'
  for (const s of strokes) {
    const a = s[0]
    if (!a) continue
    if (s.length === 1) {
      g.beginPath(); g.arc(a.x * k + ox, a.y * k + oy, LINE / 2, 0, Math.PI * 2); g.fill()
      continue
    }
    g.beginPath()
    g.moveTo(a.x * k + ox, a.y * k + oy)
    for (let i = 1; i < s.length; i++) g.lineTo(s[i]!.x * k + ox, s[i]!.y * k + oy)
    g.stroke()
  }
  const px = g.getImageData(0, 0, c.width, c.height).data
  const n = SUPER * SUPER * 255
  for (let y = 0; y < SIDE; y++) {
    for (let x = 0; x < SIDE; x++) {
      let sum = 0
      for (let dy = 0; dy < SUPER; dy++) {
        let i = ((y * SUPER + dy) * c.width + x * SUPER) * 4
        for (let dx = 0; dx < SUPER; dx++, i += 4) sum += px[i]!
      }
      out[y * SIDE + x] = Math.round((sum / n) * 1000) / 1000
    }
  }
  return out
}

// A drawing for the stages that open already under way, when nobody has drawn yet: a few plain strokes.
export function heldStrokes(): Stroke[] {
  const arc = (cx: number, cy: number, r: number, from: number, to: number, n = 28): Stroke =>
    Array.from({ length: n + 1 }, (_, i) => {
      const t = from + ((to - from) * i) / n
      return { x: cx + Math.cos(t) * r * (1 + 0.03 * Math.sin(t * 3)), y: cy + Math.sin(t) * r * 0.9 }
    })
  const line = (ax: number, ay: number, bx: number, by: number, n = 8): Stroke =>
    Array.from({ length: n + 1 }, (_, i) => ({ x: ax + ((bx - ax) * i) / n, y: ay + ((by - ay) * i) / n + 0.006 * Math.sin(i * 1.7) }))
  return [
    arc(0.5, 0.56, 0.27, -0.2, Math.PI * 2 - 0.3),
    [...line(0.29, 0.42, 0.27, 0.2, 5), ...line(0.27, 0.2, 0.42, 0.32, 5)],
    [...line(0.58, 0.32, 0.73, 0.2, 5), ...line(0.73, 0.2, 0.71, 0.42, 5)],
    arc(0.41, 0.52, 0.025, 0, Math.PI * 2, 8),
    arc(0.59, 0.52, 0.025, 0, Math.PI * 2, 8),
    line(0.47, 0.62, 0.53, 0.62, 3),
    line(0.36, 0.63, 0.2, 0.6),
    line(0.36, 0.67, 0.2, 0.7),
    line(0.64, 0.63, 0.8, 0.6),
    line(0.64, 0.67, 0.8, 0.7),
  ]
}
