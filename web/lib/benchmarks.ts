import type { VoynichClient } from '@voynich/contract'
import { read } from './api'

export type BenchmarksPage = Awaited<ReturnType<VoynichClient['benchmarks']>>
export type BenchmarkRecord = BenchmarksPage['items'][number]

export function formatScorePct(scoreBps: number): string {
  const pct = scoreBps / 100
  if (Number.isInteger(pct)) return `${pct.toFixed(0)}%`
  return `${Number(pct.toFixed(2))}%`
}

export function benchmarkRunCliCommand(
  modelName: string,
  suiteFile = 'eval-suite.json',
): string {
  return `voynich benchmark run ${modelName} --suite ${suiteFile}`
}

export async function loadBenchmarks(
  client: VoynichClient,
  query?: Parameters<VoynichClient['benchmarks']>[0],
): Promise<BenchmarksPage | null> {
  const res = await read(client.benchmarks(query))
  if (!res.ok) return null
  return res.data
}

export async function loadModelBenchmarks(
  client: VoynichClient,
  modelId: string,
): Promise<BenchmarkRecord[]> {
  const res = await read(client.modelBenchmarks(modelId, { limit: 20 }))
  if (!res.ok) return []
  return res.data.items
}
