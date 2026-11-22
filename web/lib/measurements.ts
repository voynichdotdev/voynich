import type { MeasurementRecord, VoynichClient } from '@voynich/contract'
import { read } from './api'

export type MeasurementMap = Record<string, MeasurementRecord>

export function indexMeasurements(items: readonly MeasurementRecord[]): MeasurementMap {
  const map: MeasurementMap = {}
  for (const item of items) {
    map[item.digest.toLowerCase()] = item
  }
  return map
}

export async function loadMeasurements(
  client: VoynichClient,
  status?: 'active' | 'deprecated',
): Promise<MeasurementMap> {
  const res = await read(client.measurements({ limit: 100, ...(status ? { status } : {}) }))
  if (!res.ok) return {}
  return indexMeasurements(res.data.items)
}

export function findMeasurement(
  map: MeasurementMap | null | undefined,
  digest: string | null | undefined,
): MeasurementRecord | null {
  if (!map || !digest) return null
  return map[digest.toLowerCase()] ?? null
}

export function isHttpUrl(sourceRepo: string): boolean {
  return sourceRepo.startsWith('https://') || sourceRepo.startsWith('http://')
}

export function formatMeasurementLabel(record: Pick<MeasurementRecord, 'version' | 'commitSha' | 'sourceRepo'>): string {
  return `v${record.version} · ${record.commitSha.slice(0, 7)} · ${record.sourceRepo}`
}
