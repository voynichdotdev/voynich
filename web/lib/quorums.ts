import type { VoynichClient } from '@voynich/contract'
import { read } from './api'

export type QuorumRecord = Awaited<ReturnType<VoynichClient['quorum']>>
export type QuorumsPage = Awaited<ReturnType<VoynichClient['quorums']>>

export function formatQuorumStatus(status: 'open' | 'agreed'): string {
  return status === 'agreed' ? 'Agreed' : 'Open'
}

export function formatQuorumVotes(voteCount: number, requiredVotes: number): string {
  return `${voteCount} / ${requiredVotes}`
}

export function formatQuorumMode(requireDistinctEnclaves: boolean): string {
  return requireDistinctEnclaves ? 'Distinct enclaves required' : 'Repeatability'
}

export function quorumRunCliCommand(
  modelName: string,
  votes = 2,
  inputFile = 'input.json',
  distinctEnclaves = false,
): string {
  const base = `voynich quorum run ${modelName} --votes ${votes} --input ${inputFile}`
  return distinctEnclaves ? `${base} --distinct-enclaves` : base
}

export async function loadQuorum(
  client: VoynichClient,
  address: string,
): Promise<QuorumRecord | null> {
  const res = await read(client.quorum(address))
  if (!res.ok) return null
  return res.data
}

export async function loadModelQuorums(
  client: VoynichClient,
  modelId: string,
): Promise<QuorumRecord[]> {
  const res = await read(client.modelQuorums(modelId, { limit: 20 }))
  if (!res.ok) return []
  return res.data.items
}

export async function loadQuorums(
  client: VoynichClient,
  query?: Parameters<VoynichClient['quorums']>[0],
): Promise<QuorumsPage | null> {
  const res = await read(client.quorums(query))
  if (!res.ok) return null
  return res.data
}
