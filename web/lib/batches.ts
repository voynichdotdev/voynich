import type { VoynichClient } from '@voynich/contract'
import { read } from './api'

export type BatchRecord = Awaited<ReturnType<VoynichClient['batch']>>
export type BatchesPage = Awaited<ReturnType<VoynichClient['batches']>>

export function formatBatchStatus(status: 'open' | 'completed'): string {
  return status === 'completed' ? 'Completed' : 'Open'
}

export function formatBatchProgress(completedCount: number, totalCount: number): string {
  return `${completedCount} / ${totalCount}`
}

export function batchRunCliCommand(
  modelName: string,
  inputsFile = 'inputs.json',
  chunkSize?: number,
): string {
  const base = `voynich batch run ${modelName} --inputs ${inputsFile}`
  return chunkSize !== undefined ? `${base} --chunk-size ${chunkSize}` : base
}

export async function loadBatch(
  client: VoynichClient,
  address: string,
): Promise<BatchRecord | null> {
  const res = await read(client.batch(address))
  if (!res.ok) return null
  return res.data
}

export async function loadModelBatches(
  client: VoynichClient,
  modelId: string,
): Promise<BatchRecord[]> {
  const res = await read(client.modelBatches(modelId, { limit: 20 }))
  if (!res.ok) return []
  return res.data.items
}

export async function loadBatches(
  client: VoynichClient,
  query?: Parameters<VoynichClient['batches']>[0],
): Promise<BatchesPage | null> {
  const res = await read(client.batches(query))
  if (!res.ok) return null
  return res.data
}
