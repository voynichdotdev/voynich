// A program's refusal as an API error. Custom codes overlap between programs (every Anchor program
// numbers from 6000), so a code means nothing without the program that raised it: the failing
// program is read from the logs, first failure first, and its own catalog names the error.

import { ApiFailure } from './errors.js'
import type { ErrorStage } from './contract/errors.js'

export type ProgramErrorEntry = { code: number; name: string; message: string }
export type ProgramCatalog = { name: string; errors: readonly ProgramErrorEntry[] }
/** program id → its catalog */
export type Catalogs = Record<string, ProgramCatalog>

/** A catalog from an Anchor IDL's `errors`; hand-write `message` where the IDL's text isn't fit to show. */
export const catalogFromIdl = (name: string, idl: { errors?: readonly { code: number; name: string; msg?: string }[] }): ProgramCatalog => ({
  name,
  errors: (idl.errors ?? []).map((e) => ({ code: e.code, name: e.name, message: e.msg ?? e.name })),
})

/** The instruction index and custom code of `{ InstructionError: [index, { Custom: code }] }`. */
export function customError(err: unknown): { index: number; code: number } | null {
  const ie = (err as { InstructionError?: [number, unknown] } | null)?.InstructionError
  const custom = (ie?.[1] as { Custom?: number } | undefined)?.Custom
  return ie && typeof custom === 'number' ? { index: ie[0], code: custom } : null
}

const FAILED = /^Program (\w{32,44}) failed: custom program error: 0x([0-9a-f]+)$/i

/**
 * The program that first failed. A CPI failure is logged by the inner program and then re-logged by
 * every caller up the stack with the same code; only the first line names the program that refused.
 */
export function firstFailure(logs: readonly string[] | null | undefined): { programId: string; code: number } | null {
  for (const line of logs ?? []) {
    const m = FAILED.exec(line)
    if (m) return { programId: m[1]!, code: parseInt(m[2]!, 16) }
  }
  return null
}

export function programFailure(catalogs: Catalogs, failure: { programId: string; code: number }, stage: ErrorStage = 'simulation'): ApiFailure {
  const catalog = catalogs[failure.programId]
  const entry = catalog?.errors.find((e) => e.code === failure.code)
  const program = catalog?.name ?? 'A program'
  return new ApiFailure(422, {
    error: {
      code: 'CHAIN_REFUSED',
      message: entry?.message ?? `${program} refused the transaction (custom error ${failure.code}).`,
      retryable: false,
      stage,
      programError: { programId: failure.programId, name: entry?.name ?? 'UnknownProgramError', number: failure.code },
    },
  })
}
