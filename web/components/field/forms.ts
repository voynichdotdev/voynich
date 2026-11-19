// Outlines the field's mass takes: things sketch-32 names, drawn for this product as a few strokes
// in a unit box (0..1, y down). Each is a list of polylines; `fill` closes and fills the first.

export type Form = { name: string; strokes: number[][]; fill?: boolean }

const arc = (cx: number, cy: number, r: number, a0: number, a1: number, n = 14, ry = r): number[] => {
  const out: number[] = []
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n
    out.push(+(cx + Math.cos(a) * r).toFixed(4), +(cy + Math.sin(a) * ry).toFixed(4))
  }
  return out
}
const PI = Math.PI

export const FORMS: Form[] = [
  {
    name: 'house',
    fill: true,
    strokes: [
      [0.14, 0.92, 0.14, 0.46, 0.5, 0.1, 0.86, 0.46, 0.86, 0.92, 0.14, 0.92],
      [0.42, 0.92, 0.42, 0.64, 0.58, 0.64, 0.58, 0.92],
      [0.04, 0.5, 0.5, 0.06, 0.96, 0.5],
    ],
  },
  {
    name: 'star',
    fill: true,
    strokes: [
      [0.5, 0.04, 0.62, 0.36, 0.97, 0.38, 0.69, 0.6, 0.79, 0.95, 0.5, 0.74, 0.21, 0.95, 0.31, 0.6, 0.03, 0.38, 0.38, 0.36, 0.5, 0.04],
    ],
  },
  {
    name: 'tree',
    fill: true,
    strokes: [
      [...arc(0.5, 0.36, 0.34, PI * 0.72, PI * 2.28, 22, 0.3), 0.58, 0.62, 0.6, 0.95, 0.4, 0.95, 0.42, 0.62],
    ],
  },
  {
    name: 'cup',
    fill: true,
    strokes: [
      [0.16, 0.2, 0.74, 0.2, 0.68, 0.86, 0.22, 0.86, 0.16, 0.2],
      arc(0.76, 0.48, 0.17, -PI * 0.42, PI * 0.42, 10, 0.2),
    ],
  },
  {
    name: 'umbrella',
    fill: true,
    strokes: [
      [...arc(0.5, 0.5, 0.46, PI, PI * 2, 20, 0.4), 0.72, 0.42, 0.5, 0.5, 0.28, 0.42, 0.04, 0.5],
      [0.5, 0.5, 0.5, 0.86, ...arc(0.42, 0.86, 0.08, 0, PI, 6)],
    ],
  },
  {
    name: 'moon',
    fill: true,
    strokes: [
      [...arc(0.5, 0.5, 0.44, PI * 0.28, PI * 1.72, 26), ...arc(0.72, 0.5, 0.36, PI * 1.36, PI * 0.64, 22)],
    ],
  },
  {
    name: 'light bulb',
    fill: true,
    strokes: [
      [...arc(0.5, 0.38, 0.3, PI * 0.68, PI * 2.32, 22), 0.6, 0.7, 0.6, 0.94, 0.4, 0.94, 0.4, 0.7],
    ],
  },
  {
    name: 'mountain',
    fill: true,
    strokes: [
      [0.02, 0.88, 0.34, 0.2, 0.52, 0.52, 0.66, 0.34, 0.98, 0.88, 0.02, 0.88],
      [0.24, 0.42, 0.32, 0.5, 0.38, 0.42, 0.44, 0.5],
    ],
  },
  {
    name: 'cloud',
    fill: true,
    strokes: [
      [
        ...arc(0.28, 0.6, 0.2, PI * 0.5, PI * 1.4, 8),
        ...arc(0.46, 0.4, 0.22, PI * 1.05, PI * 1.9, 9),
        ...arc(0.72, 0.56, 0.2, PI * 1.45, PI * 2.5, 9),
        0.28, 0.8,
      ],
    ],
  },
  {
    name: 'envelope',
    fill: true,
    strokes: [
      [0.06, 0.22, 0.94, 0.22, 0.94, 0.8, 0.06, 0.8, 0.06, 0.22],
      [0.06, 0.22, 0.5, 0.56, 0.94, 0.22],
    ],
  },
]

// A form as a soft value map (w x h, 0..1): the core is full, the edge falls off over a few cells.
// Built with plain 2D canvas strokes at decreasing widths, so it needs no filter support.
export function rasterize(form: Form, w: number, h: number, soft: number): Float32Array {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d', { willReadFrequently: true })!
  g.fillStyle = '#000'
  g.fillRect(0, 0, w, h)
  g.lineJoin = 'round'
  g.lineCap = 'round'
  const path = (s: number[]) => {
    g.beginPath()
    for (let i = 0; i < s.length; i += 2) {
      const x = s[i]! * w
      const y = s[i + 1]! * h
      if (i === 0) g.moveTo(x, y)
      else g.lineTo(x, y)
    }
  }
  // the body is faint and the strokes are full, so the mass reads as a drawing made of cells
  g.fillStyle = 'rgb(52,52,52)'
  path(form.strokes[0]!)
  if (form.fill) g.fill()
  const levels = 6
  g.globalCompositeOperation = 'lighter'
  for (let l = 0; l < levels; l++) {
    const t = l / (levels - 1)
    const a = Math.round(235 / levels)
    g.strokeStyle = `rgb(${a},${a},${a})`
    g.lineWidth = Math.max(0.8, soft * (1 - t * 0.85) * 1.7)
    for (const st of form.strokes) {
      path(st)
      g.stroke()
    }
  }
  const d = g.getImageData(0, 0, w, h).data
  const out = new Float32Array(w * h)
  for (let i = 0; i < out.length; i++) out[i] = Math.min(1, d[i * 4]! / 250)
  return out
}
