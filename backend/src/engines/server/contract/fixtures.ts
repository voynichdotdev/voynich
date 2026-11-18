// Fixture material the web builds against before any chain exists: deterministic sample keys and
// signatures, transaction bytes that can never be signed for real, and an error body for every code
// so each failure state can be forced and drawn.

import { toBase58, toBase64 } from '../../core/encoding.js'
import type { ApiErrorBody, ErrorStage } from './errors.js'

/** FNV-1a, so string seeds ("coin-3-mint") work as well as numbers. */
const seedOf = (seed: number | string) => {
  if (typeof seed === 'number') return seed >>> 0
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193) >>> 0
  return h
}

function sampleBytes(seed: number | string, length: number) {
  const s = seedOf(seed)
  let state = s + 1
  const bytes = Uint8Array.from({ length }, (_, i) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return (state >>> 24) ^ ((i * 17) & 255)
  })
  // The seed itself closes the key, so two seeds never produce the same sample.
  for (let i = 0; i < 4; i++) bytes[length - 4 + i] = (s >>> ((3 - i) * 8)) & 255
  return bytes
}

export const fixtureAddress = (seed: number | string) => toBase58(sampleBytes(seed, 32))
export const fixtureSignature = (seed: number | string) => toBase58(sampleBytes(seed, 64))

/** Base64 that decodes to a label, not a transaction: a wallet or RPC handed it refuses it outright. */
export const fixtureTransaction = (label: string) => toBase64(new TextEncoder().encode(`FIXTURE_NOT_A_SOLANA_TRANSACTION:${label}`))

export type ErrorDetails<Code extends string> = Record<Code, readonly [message: string, retryable: boolean, stage: ErrorStage]>

/** One sample envelope per code; `extra` adds the fields a screen needs to draw (fieldErrors, programError). */
export function fixtureErrors<Code extends string>(
  details: ErrorDetails<Code>,
  extra: Partial<Record<Code, Partial<Omit<ApiErrorBody['error'], 'code'>>>> = {},
): Record<Code, ApiErrorBody<Code>> {
  const out = {} as Record<Code, ApiErrorBody<Code>>
  for (const code of Object.keys(details) as Code[]) {
    const [message, retryable, stage] = details[code]
    out[code] = { error: { code, message, retryable, stage, ...extra[code] } }
  }
  return out
}
