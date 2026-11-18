export type Stroke = readonly (readonly [number, number])[]
export type SketchInput = readonly number[] | readonly (readonly number[])[] | Float32Array | Float64Array | { strokes: readonly Stroke[]; width: number; height: number }

/** Manifest preprocessing: crop ink, preserve aspect within 24px, center in 28px. */
export function preprocessSketch(input: SketchInput): number[] {
  let source: number[], width: number, height: number
  if (ArrayBuffer.isView(input)) {
    source = Array.from(input); width = height = 28
    if (source.length !== 784) throw new Error('A sketch tensor must contain 784 values')
  } else if (!Array.isArray(input)) {
    const drawing = input as { strokes: readonly Stroke[]; width: number; height: number }
    width = drawing.width; height = drawing.height
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 4_194_304) throw new Error('Drawing dimensions must be positive and at most 4 megapixels')
    source = new Array<number>(width * height).fill(0)
    const dot = (x: number, y: number) => { const cx = Math.round(x), cy = Math.round(y); for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const px = cx + dx, py = cy + dy; if (px >= 0 && px < width && py >= 0 && py < height) source[py * width + px] = 1 } }
    for (const stroke of drawing.strokes) for (let i = 0; i < stroke.length; i++) {
      const current = stroke[i]!, previous = stroke[Math.max(0, i - 1)]!
      if (![...current, ...previous].every(Number.isFinite) || current[0] < 0 || current[0] > width || current[1] < 0 || current[1] > height) throw new Error('Stroke coordinates must be finite and inside the drawing dimensions')
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(current[0] - previous[0]), Math.abs(current[1] - previous[1]))))
      for (let step = 0; step <= steps; step++) dot(previous[0] + (current[0] - previous[0]) * step / steps, previous[1] + (current[1] - previous[1]) * step / steps)
    }
  } else if (Array.isArray(input[0])) {
    const rows = input as readonly (readonly number[])[]
    if (rows.length !== 28 || rows.some(row => row.length !== 28)) throw new Error('A sketch matrix must be 28 by 28')
    width = height = 28; source = rows.flatMap(row => [...row])
  } else {
    source = [...input as readonly number[]]; width = height = 28
    if (source.length !== 784) throw new Error('A sketch tensor must contain 784 values')
  }
  if (source.some(value => !Number.isFinite(value) || value < 0 || value > 1)) throw new Error('Sketch values must be finite floats from 0 (background) to 1 (ink)')
  let minX = width, minY = height, maxX = -1, maxY = -1
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (source[y * width + x]! > 0) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y) }
  const output = new Array<number>(784).fill(0)
  if (maxX < 0) return output
  const cropW = maxX - minX + 1, cropH = maxY - minY + 1
  const scale = 24 / Math.max(cropW, cropH), targetW = Math.max(1, Math.round(cropW * scale)), targetH = Math.max(1, Math.round(cropH * scale))
  const offsetX = Math.floor((28 - targetW) / 2), offsetY = Math.floor((28 - targetH) / 2)
  for (let y = 0; y < targetH; y++) for (let x = 0; x < targetW; x++) {
    const sx = Math.min(maxX, minX + (x + 0.5) * cropW / targetW - 0.5), sy = Math.min(maxY, minY + (y + 0.5) * cropH / targetH - 0.5)
    const x0 = Math.max(minX, Math.floor(sx)), y0 = Math.max(minY, Math.floor(sy)), x1 = Math.min(maxX, x0 + 1), y1 = Math.min(maxY, y0 + 1)
    const fx = Math.max(0, sx - x0), fy = Math.max(0, sy - y0)
    const top = source[y0 * width + x0]! * (1 - fx) + source[y0 * width + x1]! * fx
    const bottom = source[y1 * width + x0]! * (1 - fx) + source[y1 * width + x1]! * fx
    output[(offsetY + y) * 28 + offsetX + x] = Math.fround(top * (1 - fy) + bottom * fy)
  }
  return output
}
