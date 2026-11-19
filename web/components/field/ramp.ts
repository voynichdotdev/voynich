// The tile's ramp and colours. One table read by the canvas field, the DOM tiles and the OG image.

export const RAMP = ['`', "'", '.', '-', ':', ';', '!', 't', 'o', 'S', '%', 'X', '8', '#', '@'] as const
export const BARE_BELOW = 3 // ramp steps under this have no cap: a grey glyph alone on the field

export const C = {
  ground: '#05080f',
  line: '#101622',
  speck: '#798088',
  caps: ['#141c2c', '#1a2437', '#223049', '#293957', '#2f4062', '#364969', '#3c4f74'],
  capTop: '#bfcade',
  glyph: '#a8c0e0',
  glyphDim: '#7f93b4',
  yellow: '#eecc40',
  pink: '#ff75b2',
  ochre: '#d9b45b',
  ochreCap: '#3a3018',
} as const

// A cap's fill for a ramp step (BARE_BELOW..14). The top step inverts.
export function capFill(step: number): string {
  if (step >= RAMP.length - 1) return C.capTop
  const t = (step - BARE_BELOW) / (RAMP.length - 2 - BARE_BELOW)
  return C.caps[Math.max(0, Math.min(C.caps.length - 1, Math.round(t * (C.caps.length - 1))))]!
}

// Deterministic hash in [0, 1) for a cell.
export function cellHash(i: number, salt = 0): number {
  let h = (i * 374761393 + salt * 668265263) | 0
  h = (h ^ (h >>> 13)) * 1274126177
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

// Bytes to show when the chain's are not here yet: a fixed stream, never Math.random, so server and client agree.
export function sampleBytes(n: number, seed = 408): Uint8Array {
  const out = new Uint8Array(n)
  let s = seed >>> 0
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    out[i] = s >>> 24
  }
  return out
}

export const HEX = '0123456789abcdef'
