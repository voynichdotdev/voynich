import { Manifest } from './schemas.js'

export const SKETCH_INPUT_SHAPE = [1, 1, 28, 28] as const
export const SKETCH_PREPROCESS = 'Crop the drawing to its ink, scale the longer side to 24 px keeping aspect, center it in 28x28; float32, background 0, ink 1.'

/** Compact on-chain JSON; only known sketch defaults are omitted. */
export function encodeManifest(value: Manifest): Uint8Array {
  const manifest = Manifest.parse(value)
  const stored: Partial<Manifest> = { ...manifest }
  if (manifest.inputKind === 'sketch') {
    if (manifest.inputShape && manifest.inputShape.length === 4 && manifest.inputShape.every((size, index) => size === SKETCH_INPUT_SHAPE[index])) delete stored.inputShape
    if (manifest.inputName === 'input') delete stored.inputName
    if (manifest.outputName === 'logits') delete stored.outputName
    if (manifest.preprocess === SKETCH_PREPROCESS) delete stored.preprocess
  }
  return new TextEncoder().encode(JSON.stringify(stored))
}

/** Reads compact storage and legacy full JSON, restoring the sketch's public defaults. */
export function decodeManifest(value: unknown): Manifest {
  const json = value instanceof Uint8Array ? JSON.parse(new TextDecoder().decode(value)) : typeof value === 'string' ? JSON.parse(value) : value
  if (json && typeof json === 'object' && !Array.isArray(json) && (json as { inputKind?: unknown }).inputKind === 'sketch') {
    return Manifest.parse({
      inputShape: [...SKETCH_INPUT_SHAPE], inputName: 'input', outputName: 'logits', preprocess: SKETCH_PREPROCESS, ...(json as Record<string, unknown>),
    })
  }
  return Manifest.parse(json)
}
