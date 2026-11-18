// Failures as values the API frame turns into the one error envelope: thrown from any depth as
// ApiFailure, with zod issues becoming per-field messages and anything unexpected an INTERNAL_ERROR
// that carries the request id and nothing else.

import { ZodError, type z } from 'zod'
import { BASE_ERROR_STATUS, type ApiErrorBody, type BaseErrorCode } from './contract/errors.js'

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody,
  ) {
    super(body.error.message)
    this.name = 'ApiFailure'
  }
}

export type FailOptions = Partial<Omit<ApiErrorBody['error'], 'code' | 'message'>>
export type Fail<Code extends string> = (code: Code, message: string, options?: FailOptions) => never

/**
 * A typed `fail` for the product's own error table. Annotate the export so TypeScript treats every
 * call as never returning: `export const fail: Fail<ErrorCode> = failer(errors.status)`.
 */
export function failer<Code extends string>(status: Record<Code, number>): Fail<Code> {
  return (code, message, options = {}) => {
    throw new ApiFailure(status[code], { error: { code, message, retryable: false, stage: 'read', ...options } })
  }
}

/** `fail` for the base codes, which every product table includes. */
export function fail(code: BaseErrorCode, message: string, options: FailOptions = {}): never {
  throw new ApiFailure(BASE_ERROR_STATUS[code], { error: { code, message, retryable: false, stage: 'read', ...options } })
}

export function fieldErrors(error: ZodError) {
  const out: Record<string, string[]> = {}
  for (const issue of error.issues) (out[issue.path.join('.') || 'form'] ??= []).push(issue.message)
  return out
}

/** Validates input, answering VALIDATION_ERROR with a message per field. */
export function parse<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value)
  if (result.success) return result.data
  return fail('VALIDATION_ERROR', 'Check the highlighted fields.', { stage: 'validation', fieldErrors: fieldErrors(result.error) })
}

/** Error text can carry a keyed RPC or database URL (in its query, path or userinfo); keep the host. */
export const redact = (text: string) => text.replace(/\b([a-z][a-z0-9+.-]*:\/\/)(?:[^\s/@]*@)?([^\s/?#]+)\S*/gi, '$1$2/…')

/** Whatever was thrown, as the envelope the client will read. */
export function toFailure(error: unknown, requestId: string): ApiFailure {
  if (error instanceof ApiFailure) return error
  if (error instanceof ZodError) {
    return new ApiFailure(400, {
      error: { code: 'VALIDATION_ERROR', message: 'Check the highlighted fields.', retryable: false, stage: 'validation', fieldErrors: fieldErrors(error), requestId },
    })
  }
  return new ApiFailure(500, { error: { code: 'INTERNAL_ERROR', message: 'The request could not be completed.', retryable: true, stage: 'read', requestId } })
}
