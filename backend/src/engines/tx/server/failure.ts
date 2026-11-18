// Why a transaction failed, named by stage and by the program that raised it.
// Every failure the API returns says which stage broke (build, the wallet refused, the wallet
// changed it, simulation, send, confirmation), so the UI never shows one blanket message.

import type { TxFailure, TxStage } from '../types.js'

export type { TxStage }

export type ProgramFailure = {
  /** the program that raised the error (the first to fail, never one of its callers) */
  address: string
  code: number | null
  name: string | null
  message: string | null
}

export class TxError extends Error {
  readonly retryable: boolean
  readonly program: ProgramFailure | null
  readonly logs: readonly string[]
  constructor(
    readonly stage: TxStage,
    message: string,
    options: { retryable?: boolean; program?: ProgramFailure | null; logs?: readonly string[] } = {},
  ) {
    super(message)
    this.name = 'TxError'
    this.retryable = options.retryable ?? stage !== 'wallet-changed'
    this.program = options.program ?? null
    this.logs = options.logs ?? []
  }
}

export class InsufficientFundsError extends TxError {
  readonly funding: { mint: string | null; required: string; available: string; shortfall: string }
  constructor(mint: string | null, required: bigint, available: bigint) {
    const shortfall = required - available
    super('simulation', `This action needs ${required} ${mint ? 'token base units' : 'lamports'}, but this wallet has ${available}. Add ${shortfall} ${mint ? 'token base units' : 'lamports'}.`, { retryable: false })
    this.name = 'InsufficientFundsError'
    this.funding = { mint, required: required.toString(), available: available.toString(), shortfall: shortfall.toString() }
  }
}

export function insufficientFundsOutcome(error: unknown, logs: readonly string[] | null | undefined): boolean {
  const name = typeof error === 'string' ? error : error && typeof error === 'object' ? Object.keys(error)[0] : ''
  return name === 'AccountNotFound' || name === 'InsufficientFundsForFee' || name === 'InsufficientFundsForRent' ||
    (logs ?? []).some(line => /insufficient (?:funds|lamports)|no record of a prior credit/i.test(line))
}

/** program address → error code → name and message */
export type ErrorRegistry = Map<string, Map<number, { name: string; msg?: string }>>

type IdlLike = { address: string; errors?: readonly { code: number; name: string; msg?: string }[] }

/** Builds the registry from Anchor IDLs (each carries its program address and error list). */
export function registryFromIdls(...idls: IdlLike[]): ErrorRegistry {
  const registry: ErrorRegistry = new Map()
  for (const idl of idls) registry.set(idl.address, new Map((idl.errors ?? []).map((e) => [e.code, { name: e.name, msg: e.msg }])))
  return registry
}

/** SPL Token and Token-2022 share these codes; add them under each token program's address. */
export const TOKEN_ERRORS = new Map<number, { name: string; msg: string }>([
  [0, { name: 'NotRentExempt', msg: 'The account is not rent-exempt.' }],
  [1, { name: 'InsufficientFunds', msg: 'Not enough tokens in the account.' }],
  [2, { name: 'InvalidMint', msg: 'The mint is invalid.' }],
  [3, { name: 'MintMismatch', msg: 'The account belongs to another mint.' }],
  [4, { name: 'OwnerMismatch', msg: 'The account belongs to another owner.' }],
  [17, { name: 'AccountFrozen', msg: 'The token account is frozen.' }],
  [18, { name: 'MintDecimalsMismatch', msg: 'The decimals do not match the mint.' }],
])

const INVOKE = /^Program (\S+) invoke \[(\d+)\]$/
const SUCCESS = /^Program (\S+) success$/
const FAILED = /^Program (\S+) failed: (.+)$/
const ANCHOR = /Error Code: ([A-Za-z][A-Za-z0-9_]*)\. Error Number: (\d+)\./
const CUSTOM = /^custom program error: (0x[0-9a-f]+|\d+)$/i

type Frame = { address: string; depth: number; anchor: { name: string; code: number } | null }

/**
 * The first "Program X failed" line owns the custom code; the programs that called it fail after
 * it with the same code and must not be blamed. Anchor programs all number their errors from
 * 6000, so a code means nothing without the program that raised it. An Anchor log line names
 * the error only when its number is the code that failed.
 */
export function firstProgramFailure(logs: readonly string[], registry: ErrorRegistry = new Map()): ProgramFailure | null {
  const stack: Frame[] = []
  for (const line of logs) {
    const invoke = INVOKE.exec(line)
    if (invoke) {
      const depth = Number(invoke[2])
      while (stack.length && stack[stack.length - 1]!.depth >= depth) stack.pop()
      stack.push({ address: invoke[1]!, depth, anchor: null })
      continue
    }
    const anchor = ANCHOR.exec(line)
    if (anchor && stack.length) stack[stack.length - 1]!.anchor = { name: anchor[1]!, code: Number(anchor[2]) }

    const failed = FAILED.exec(line)
    if (failed) {
      const frame = [...stack].reverse().find((f) => f.address === failed[1])
      const custom = CUSTOM.exec(failed[2]!)
      const code = custom ? Number(custom[1]) : null
      const known = code === null ? undefined : registry.get(failed[1]!)?.get(code)
      const named = frame?.anchor && frame.anchor.code === code ? frame.anchor.name : null
      return { address: failed[1]!, code, name: named ?? known?.name ?? null, message: known?.msg ?? (custom ? null : failed[2]!) }
    }
    const success = SUCCESS.exec(line)
    if (success) {
      const at = stack.map((f) => f.address).lastIndexOf(success[1]!)
      if (at >= 0) stack.splice(at)
    }
  }
  return null
}

/** The wire shape of a TxError; `nextStep` comes from the product's own copy for the error name. */
export function toFailure(e: TxError, nextStep?: (e: TxError) => string | undefined): TxFailure {
  const p = e.program
  return {
    stage: e.stage,
    message: e.message,
    nextStep: nextStep?.(e),
    retryable: e.retryable,
    ...(p ? { program: { address: p.address, code: p.code, name: p.name } } : {}),
  }
}

/** A TxError for a failed simulation or landed transaction, named by its program. */
export function failureFromLogs(stage: TxStage, logs: readonly string[] | null | undefined, registry?: ErrorRegistry, fallback = 'The chain refused this transaction.'): TxError {
  const program = firstProgramFailure(logs ?? [], registry)
  const message = program?.message ?? program?.name ?? (program?.code != null ? `Custom(${program.code})` : fallback)
  return new TxError(stage, message, { program, logs: logs ?? [] })
}
