import { readFile } from 'node:fs/promises'
import { ModelBaseSchema, type ModelBase } from '@voynich/contract'
import { decodeAdapter, verifyOnnxAdapterCompatibility } from './adapter.js'
import { sha256, toHex } from './crypto.js'

const BASE_URI_RE = /^(?:https?:\/\/|ipfs:\/\/|hf:\/\/)/

export type CliBaseFlags = {
  base?: string
  baseFile?: string
  baseSha256?: string
  baseSize?: string
  baseFormat?: string
}

function inferFormatFromPath(filePath: string): ModelBase['format'] | undefined {
  const lower = filePath.toLowerCase()
  if (lower.endsWith('.onnx')) return 'onnx'
  if (lower.endsWith('.safetensors')) return 'safetensors'
  if (lower.endsWith('.gguf')) return 'gguf'
  return undefined
}

/**
 * Resolves CLI --base (JSON file or source URL), --base-file (auto-hashed local base),
 * --base-sha256, --base-size, and --base-format flags, inheriting existingModelBase on
 * zero-state-file --resume, and runs pre-flight adapter/ONNX compatibility checks before signing.
 */
export async function resolveCliSealBase(params: {
  flags: CliBaseFlags
  weights?: Uint8Array
  existingBase?: ModelBase | null
}): Promise<ModelBase | undefined> {
  const { flags, weights, existingBase } = params
  const hasExplicit = Boolean(
    flags.base !== undefined ||
    flags.baseFile !== undefined ||
    flags.baseSha256 !== undefined ||
    flags.baseSize !== undefined ||
    flags.baseFormat !== undefined,
  )

  if (!hasExplicit) {
    if (!existingBase) return undefined
    const inherited = ModelBaseSchema.parse(existingBase)
    if (weights) {
      const decoded = decodeAdapter(weights)
      if (decoded.baseSha256 !== inherited.sha256) {
        throw new Error(`Adapter baseSha256 (${decoded.baseSha256}) does not match existing model base.sha256 (${inherited.sha256}).`)
      }
    }
    return inherited
  }

  let source: string | undefined
  let sha256Hex: string | undefined
  let sizeBytes: number | undefined
  let format: string | undefined

  if (flags.base !== undefined) {
    if (BASE_URI_RE.test(flags.base)) {
      source = flags.base
    } else {
      let rawJson: unknown
      try {
        rawJson = JSON.parse(await readFile(flags.base, 'utf8'))
      } catch (error) {
        throw new Error(`Could not read --base JSON file ${flags.base}: ${error instanceof Error ? error.message : 'invalid JSON'}`)
      }
      if (!rawJson || typeof rawJson !== 'object' || Array.isArray(rawJson)) {
        throw new Error('--base JSON file must contain an object with base model fields.')
      }
      const record = rawJson as Record<string, unknown>
      if (typeof record.source === 'string') source = record.source
      if (typeof record.sha256 === 'string') sha256Hex = record.sha256.toLowerCase()
      if (typeof record.sizeBytes === 'number') sizeBytes = record.sizeBytes
      if (typeof record.format === 'string') format = record.format
    }
  }

  if (flags.baseSha256 !== undefined) sha256Hex = flags.baseSha256.toLowerCase()
  if (flags.baseSize !== undefined) {
    const parsedSize = Number(flags.baseSize)
    if (!Number.isSafeInteger(parsedSize) || parsedSize <= 0) {
      throw new Error('--base-size must be a positive integer.')
    }
    sizeBytes = parsedSize
  }
  if (flags.baseFormat !== undefined) format = flags.baseFormat

  let baseFileBytes: Uint8Array | undefined
  if (flags.baseFile !== undefined) {
    baseFileBytes = new Uint8Array(await readFile(flags.baseFile))
    const fileSha = toHex(sha256(baseFileBytes))
    const fileSize = baseFileBytes.length
    if (sha256Hex !== undefined && sha256Hex !== fileSha) {
      throw new Error(`--base-sha256 (${sha256Hex}) does not match local --base-file SHA-256 (${fileSha}).`)
    }
    if (sizeBytes !== undefined && sizeBytes !== fileSize) {
      throw new Error(`--base-size (${sizeBytes}) does not match local --base-file size (${fileSize}).`)
    }
    sha256Hex = fileSha
    sizeBytes = fileSize
    if (format === undefined) {
      format = inferFormatFromPath(flags.baseFile)
    }
  }

  const parsed = ModelBaseSchema.parse({
    source,
    sha256: sha256Hex,
    sizeBytes,
    format,
  })

  if (weights) {
    const decoded = decodeAdapter(weights)
    if (decoded.baseSha256 !== parsed.sha256) {
      throw new Error(`Adapter baseSha256 (${decoded.baseSha256}) does not match base.sha256 (${parsed.sha256}).`)
    }
    if (baseFileBytes && parsed.format === 'onnx') {
      verifyOnnxAdapterCompatibility(baseFileBytes, decoded, parsed.sha256)
    }
  }

  return parsed
}
