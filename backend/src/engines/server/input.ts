// Reading a request's body, query and path through the contract's schemas, so every route answers
// bad input with the same VALIDATION_ERROR and per-field messages.

import type { Context } from 'hono'
import type { z } from 'zod'
import { fail, parse } from './errors.js'

/**
 * A JSON body, required to say so: an HTML form can't send application/json, and a cross-origin
 * fetch that does must pass a CORS preflight first, so this check is half of the CSRF defence.
 */
export async function readJson<S extends z.ZodType>(c: Context, schema: S): Promise<z.output<S>> {
  if (!c.req.header('content-type')?.toLowerCase().startsWith('application/json')) {
    fail('UNSUPPORTED_MEDIA_TYPE', 'Send an application/json body.', { stage: 'validation' })
  }
  let value: unknown
  try {
    value = await c.req.json()
  } catch (error) {
    if (error instanceof SyntaxError) fail('VALIDATION_ERROR', 'The JSON body is invalid.', { stage: 'validation' })
    throw error
  }
  return parse(schema, value)
}

/** The query without transport-only keys (the fixture scenario an EventSource puts there). */
export function readQuery<S extends z.ZodType>(c: Context, schema: S, omit: readonly string[] = ['fixture']): z.output<S> {
  const values = Object.fromEntries(Object.entries(c.req.query()).filter(([k]) => !omit.includes(k)))
  return parse(schema, values)
}

export const readParam = <S extends z.ZodType>(c: Context, name: string, schema: S): z.output<S> => parse(schema, c.req.param(name))
