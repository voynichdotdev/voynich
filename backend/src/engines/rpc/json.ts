// JSON-RPC bodies parsed without losing u64s. JSON.parse turns 18446744073709551615 into a nearby
// double; on Node 22+ its reviver sees each number's source text, so an integer past 2^53 keeps its
// exact digits as a string. Amounts then become BigInt at the boundary that does arithmetic.

type Reviver = (this: unknown, key: string, value: unknown, context?: { source?: string }) => unknown

export function parseExact(text: string): unknown {
  return (JSON.parse as (text: string, reviver: Reviver) => unknown)(text, (_key, value, context) => {
    if (typeof value !== 'number' || !Number.isInteger(value) || Number.isSafeInteger(value)) return value
    if (!context?.source) throw new Error('This runtime cannot keep RPC integers exact; run Node 22 or later.')
    return /^-?\d+$/.test(context.source) ? context.source : value
  })
}

/** An integer amount from RPC JSON (lamports, token units, slots) in whichever form it arrived. */
export function toU64(value: unknown): bigint {
  if (typeof value === 'bigint' && value >= 0n) return value
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value)
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value)
  throw new Error(`Not an unsigned integer: ${String(value)}`)
}
