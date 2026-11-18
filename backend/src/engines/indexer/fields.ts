// Decoded program data as plain JSON, and typed readers for it. Fact builders read instruction
// args and event fields through these: amounts stay exact decimal strings from decode to database,
// and a field that isn't what the builder expects throws, which the builder records as an issue.

export type Json = null | string | number | boolean | Json[] | { [key: string]: Json }
export type Fields = { [key: string]: Json }

export function text(value: Json | undefined): string {
  if (typeof value !== 'string') throw new Error('Expected a string in decoded program data.')
  return value
}

/** An exact unsigned integer amount (u64, u128), kept as its decimal string. */
export function raw(value: Json | undefined): string {
  const result = text(value)
  if (!/^(0|[1-9]\d*)$/.test(result)) throw new Error('Expected an exact unsigned raw amount.')
  return result
}

export function int(value: Json | undefined): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error('Expected an integer in decoded program data.')
  return value
}

export function nested(value: Json | undefined): Fields {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a decoded struct.')
  return value
}

/** The variant of a decoded enum (`{ buy: {} }` reads as 'buy'), lowercased. */
export function variant(value: Json | undefined): string {
  const name = Object.keys(nested(value))[0]
  if (!name) throw new Error('Expected a decoded enum variant.')
  return name.toLowerCase()
}
