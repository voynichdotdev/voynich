// The zod building blocks every contract shares: keys, signatures, integer amounts, times, pages.
// The contract is the single source for the server's validation, the client's response parsing and
// the OpenAPI document, so these run in the browser too.

import { z } from 'zod'
import { fromBase58, fromBase64, toBase64 } from './encoding.js'

export const U64_MAX = 18446744073709551615n

const encodes = (bytes: number) => (value: string) => {
  try {
    return fromBase58(value).length === bytes
  } catch {
    return false
  }
}

export const Address = z.string().min(32).max(44).refine(encodes(32), 'Must be a base58 address of 32 bytes.')
export const Signature = z.string().min(64).max(88).refine(encodes(64), 'Must be a base58 signature of 64 bytes.')

/** Unsigned integer base units as a decimal string. Arithmetic happens in BigInt, never Number. */
export const BaseUnits = z.string().max(78).regex(/^(0|[1-9][0-9]*)$/, 'Must be an unsigned integer string.')
export const U64 = BaseUnits.refine((v) => BigInt(v) <= U64_MAX, 'Must fit an unsigned 64-bit integer.')
export const PositiveU64 = U64.refine((v) => v !== '0', 'Must be greater than zero.')

export const Base64 = z.string().regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/, 'Must be padded base64.').refine((value) => {
  try { return toBase64(fromBase64(value)) === value } catch { return false }
}, 'Must be canonical padded base64.')
export const Timestamp = z.iso.datetime()
export type Address = z.output<typeof Address>
export type Signature = z.output<typeof Signature>
export type BaseUnits = z.output<typeof BaseUnits>
export type U64 = z.output<typeof U64>
export type PositiveU64 = z.output<typeof PositiveU64>
export type Base64 = z.output<typeof Base64>
export type Timestamp = z.output<typeof Timestamp>

/** Offset cursors as strings, so a later switch to opaque cursors changes no client. */
export const PageQuery = z.strictObject({
  cursor: z.string().regex(/^[0-9]+$/).max(12).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(24),
})
export type PageQuery = z.output<typeof PageQuery>

export const PageInfo = z.strictObject({ nextCursor: z.string().nullable(), hasMore: z.boolean() })
export type PageInfo = z.output<typeof PageInfo>
export const page = <T extends z.ZodType>(item: T) => z.strictObject({ items: z.array(item), page: PageInfo, asOf: Timestamp })

/** One page of an in-memory list, in the shape `page(item)` describes. */
export function paginate<T>(rows: readonly T[], q: PageQuery, asOf = new Date().toISOString()) {
  const start = Number(q.cursor ?? 0)
  const hasMore = start + q.limit < rows.length
  return { items: rows.slice(start, start + q.limit), page: { nextCursor: hasMore ? String(start + q.limit) : null, hasMore }, asOf }
}
