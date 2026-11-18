// The environment as one typed object, checked once at boot. .env is read when present (a deployed
// service has none), an empty value means unset (lines copied from .env.example stay harmless), and
// every problem is reported at once by variable name, never with its value.

import { z } from 'zod'
import { fromBase58 } from '../core/encoding.js'

export function readEnv(file = '.env'): Record<string, string | undefined> {
  try {
    process.loadEnvFile(file)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  return Object.fromEntries(Object.entries(process.env).map(([k, v]) => [k, v?.trim() === '' ? undefined : v]))
}

export function parseEnv<S extends z.ZodType>(schema: S, input: Record<string, string | undefined> = readEnv()): z.output<S> {
  const result = schema.safeParse(input)
  if (result.success) return result.data
  const lines = result.error.issues.map((i) => `${i.path.join('.') || 'environment'}: ${i.message}`)
  throw new Error(`Invalid environment:\n  ${lines.join('\n  ')}`)
}

export const port = (fallback: number) => z.coerce.number().int().min(1).max(65535).default(fallback)

/**
 * '::' on Railway: dual-stack, so the public edge and the IPv6-only private network both reach the
 * service. Loopback anywhere else, since a dev machine may sit on a public address.
 */
export const host = () => z.string().default(process.env.RAILWAY_ENVIRONMENT_ID ? '::' : '127.0.0.1')

/** A comma list of origins, normalized: a trailing slash would otherwise never match a browser's Origin. */
export const origins = z.string().transform((value, ctx) => {
  const out: string[] = []
  for (const item of value.split(',').map((s) => s.trim()).filter(Boolean)) {
    try {
      out.push(new URL(item).origin)
    } catch {
      ctx.addIssue({ code: 'custom', message: `Not an origin: ${item}` })
    }
  }
  return [...new Set(out)]
})

const urlWith = (protocols: string[]) =>
  z.url().refine((v) => protocols.includes(new URL(v).protocol), `Must be a ${protocols.join(' or ')} URL.`)
export const httpUrl = urlWith(['http:', 'https:'])
export const wsUrl = urlWith(['ws:', 'wss:'])

export const address = z.string().refine((v) => {
  try {
    return fromBase58(v).length === 32
  } catch {
    return false
  }
}, 'Must be a base58 public key.')

export const flag = (fallback = false) =>
  z
    .enum(['true', 'false'])
    .default(fallback ? 'true' : 'false')
    .transform((v) => v === 'true')

export const u64 = z
  .string()
  .regex(/^\d+$/, 'Must be an unsigned integer.')
  .transform(BigInt)
  .refine((v) => v <= 18446744073709551615n, 'Must fit a u64.')

export const cluster = z.enum(['localnet', 'devnet', 'mainnet']).default('localnet')

/** For superRefine: `keys` must be set whenever `key` equals `value` (mainnet needs its RPC and program id). */
export function requireWhen<T extends Record<string, unknown>>(key: keyof T & string, value: unknown, keys: (keyof T & string)[]) {
  return (data: T, ctx: z.RefinementCtx) => {
    if (data[key] !== value) return
    for (const k of keys) if (data[k] === undefined) ctx.addIssue({ code: 'custom', path: [k], message: `${k} is required when ${key} is ${String(value)}.` })
  }
}
