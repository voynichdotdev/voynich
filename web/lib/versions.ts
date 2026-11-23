import type { Model, ModelVersion, ModelVersions, VoynichClient } from '@voynich/contract'
import { read } from './api'

export function effectiveModelVersion(model: { currentVersion?: number | null } | null | undefined): number {
  const v = model?.currentVersion
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : 1
}

export async function loadModelVersions(
  client: VoynichClient,
  modelId: string,
): Promise<ModelVersions | null> {
  const res = await read(client.modelVersions(modelId))
  if (!res.ok) return null
  return res.data
}

export function fallbackModelVersions(model: Pick<Model, 'address' | 'status' | 'sizeBytes' | 'ciphertextSha256' | 'base' | 'manifest' | 'sealedSlot' | 'currentVersion'>): ModelVersion[] {
  return [
    {
      model: model.address,
      version: effectiveModelVersion(model),
      address: null,
      status: model.status === 'uploading' ? 'uploading' : 'live',
      sizeBytes: model.sizeBytes,
      ciphertextSha256: model.ciphertextSha256,
      base: model.base,
      manifest: model.manifest,
      publishedSlot: model.sealedSlot,
    },
  ]
}

export function matchReceiptVersion(
  receiptSlot: string | bigint,
  versions: readonly ModelVersion[] | null | undefined,
): ModelVersion | null {
  if (!versions || versions.length === 0) return null
  const slot = typeof receiptSlot === 'bigint' ? receiptSlot : BigInt(receiptSlot)
  const published = versions
    .filter((v) => v.status !== 'uploading')
    .sort((a, b) => a.version - b.version)
  if (published.length === 0) return null
  let matched: ModelVersion | null = null
  for (const v of published) {
    const vSlot = v.publishedSlot !== null && v.publishedSlot !== undefined ? BigInt(v.publishedSlot) : 0n
    if (vSlot <= slot) {
      matched = v
    }
  }
  return matched ?? published[0]!
}

export function upgradeCliCommand(modelName: string, hasBase: boolean): string {
  return hasBase
    ? `voynich model upgrade ${modelName} <adapter.voya> --base <base-url> --base-file <base.onnx>`
    : `voynich model upgrade ${modelName} <weights.onnx>`
}
