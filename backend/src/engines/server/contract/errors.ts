// One error envelope for every failed response: a stable code the UI branches on, a sentence it can
// show, whether retrying can help, and the stage of the flow that failed. Each code carries its HTTP
// status, so the server, the OpenAPI document and the fixtures read one table.

import { z } from 'zod'
import { Address, U64 } from './primitives.js'

/** The codes every API speaks. A product adds its own with defineErrors. */
export const BASE_ERROR_STATUS = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  ORIGIN_NOT_ALLOWED: 403,
  NOT_FOUND: 404,
  PROGRAM_UNAVAILABLE: 409,
  CONFIGURATION_REQUIRED: 409,
  IDEMPOTENCY_CONFLICT: 409,
  TRANSACTION_EXPIRED: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  SIMULATION_FAILED: 422,
  CHAIN_REFUSED: 422,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  UPSTREAM_UNAVAILABLE: 502,
} as const
export type BaseErrorCode = keyof typeof BASE_ERROR_STATUS

export const ErrorStage = z.enum(['validation', 'auth', 'read', 'upload', 'build', 'wallet', 'co_sign', 'simulation', 'send', 'confirmation'])
export type ErrorStage = z.output<typeof ErrorStage>

/** The program that refused a transaction, by address, so overlapping custom codes stay unambiguous. */
export const ProgramError = z.strictObject({ programId: Address, name: z.string(), number: z.int().optional() })

const fields = <C extends z.ZodType<string>>(code: C) =>
  z.strictObject({
    code,
    message: z.string(),
    retryable: z.boolean(),
    stage: ErrorStage,
    fieldErrors: z.record(z.string(), z.array(z.string())).optional(),
    programError: ProgramError.optional(),
    funding: z.strictObject({ mint: Address.nullable(), required: U64, available: U64, shortfall: U64 }).optional(),
    retryAfterSeconds: z.int().optional(),
    requestId: z.string().optional(),
  })

export type ApiErrorBody<Code extends string = string> = {
  error: {
    code: Code
    message: string
    retryable: boolean
    stage: ErrorStage
    fieldErrors?: Record<string, string[]>
    programError?: z.output<typeof ProgramError>
    funding?: { mint: string | null; required: string; available: string; shortfall: string }
    retryAfterSeconds?: number
    requestId?: string
  }
}

/** The product's error table: the base codes plus its own, as a status map and zod schemas. */
export function defineErrors<const Extra extends Record<string, number>>(extra: Extra) {
  const status = { ...BASE_ERROR_STATUS, ...extra } as typeof BASE_ERROR_STATUS & Extra
  type Code = keyof typeof status & string
  const ErrorCode = z.enum(Object.keys(status) as [Code, ...Code[]])
  const ApiError = z.strictObject({ error: fields(ErrorCode) })
  return { status, ErrorCode, ApiError }
}

export const baseErrors = defineErrors({})
