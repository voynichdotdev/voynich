// A raw RPC transaction turned into named instructions, program events, token movements and the
// first failure, for the programs it is given. Anything it can't read becomes an issue on the
// transaction instead of a throw, so one odd instruction never stops an index.

import { fromBase64, toBase64 } from '../core/encoding.js'
import type { Fields } from './fields.js'
import { tokenFlows, type TokenFlow } from './token-flows.js'
import { normalizeTransaction, type DecodeIssue, type InstructionPath, type NormalizedInstruction, type NormalizedTransaction } from './transaction.js'

/** What the decoder needs to know about one program. anchorProgram(idl) builds it from an Anchor IDL. */
export interface ProgramDecoder {
  programId: string
  /** the program's `__event_authority` PDA; an emit_cpi event counts only when it signs */
  eventAuthority?: string
  /** name, args and the IDL's account names in order; null for an unknown discriminator */
  instruction?(data: Uint8Array): { name: string; args: Fields; accounts: string[] } | null
  /** an event from its discriminator and body; null when unknown */
  event?(bytes: Uint8Array): { name: string; data: Fields } | null
}

export interface DecodedInstruction extends NormalizedInstruction {
  name: string | null
  args: Fields | null
  namedAccounts: Record<string, string>
}
export interface DecodedEvent {
  programId: string
  name: string
  data: Fields
  source: 'cpi' | 'log'
  /** the instruction that emitted it */
  path: InstructionPath
  /** where its bytes were found: the self-CPI for emit_cpi, the instruction itself for a log */
  eventPath: InstructionPath
  bytes: string
}
export interface Failure { programId: string; code: number | null; message: string }
export interface DecodedTransaction extends Omit<NormalizedTransaction, 'instructions'> {
  instructions: DecodedInstruction[]
  events: DecodedEvent[]
  tokenFlows: TokenFlow[]
  firstFailure: Failure | null
}

// Anchor's emit_cpi instruction tag, ahead of the event's own discriminator.
const EVENT_CPI_TAG = [0xe4, 0x45, 0xa5, 0x2e, 0x51, 0xcb, 0x9a, 0x1d]
const isEventCpi = (data: Uint8Array) => data.length >= 8 && EVENT_CPI_TAG.every((b, i) => data[i] === b)
const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
const message = (error: unknown) => (error instanceof Error ? error.message : String(error))
const issue = (issues: DecodeIssue[], code: string, text: string, ix?: NormalizedInstruction) =>
  issues.push({ code, message: text, ...(ix ? { path: ix.path, programId: ix.programId } : {}) })

function decodeInstructions(tx: NormalizedTransaction, programs: Map<string, ProgramDecoder>): DecodedInstruction[] {
  return tx.instructions.map((ix) => {
    const out: DecodedInstruction = { ...ix, name: null, args: null, namedAccounts: {} }
    const program = programs.get(ix.programId)
    if (!program?.instruction || isEventCpi(ix.data)) return out
    try {
      const decoded = program.instruction(ix.data)
      if (!decoded) throw new Error(`Unknown instruction discriminator ${hex(ix.data.subarray(0, 8))}.`)
      if (ix.accounts.length < decoded.accounts.length) throw new Error('Instruction has fewer accounts than its IDL.')
      out.name = decoded.name
      out.args = decoded.args
      out.namedAccounts = Object.fromEntries(decoded.accounts.map((name, i) => [name, ix.accounts[i]!]))
    } catch (error) {
      issue(tx.issues, 'INSTRUCTION_DECODE', message(error), ix)
    }
    return out
  })
}

function decodeEvents(tx: DecodedTransaction, programs: Map<string, ProgramDecoder>) {
  const add = (programId: string, bytes: Uint8Array, source: 'cpi' | 'log', path: InstructionPath, eventPath: InstructionPath) => {
    try {
      const decoded = programs.get(programId)!.event!(bytes)
      if (!decoded) throw new Error(`Unknown event discriminator ${hex(bytes.subarray(0, 8))}.`)
      const encoded = toBase64(bytes)
      const event: DecodedEvent = { programId, name: decoded.name, data: decoded.data, source, path, eventPath, bytes: encoded }
      // The same event seen both ways is kept once, as the CPI copy.
      const previous = tx.events.findIndex((e) => e.programId === programId && e.path.index === path.index && e.bytes === encoded)
      if (previous < 0) tx.events.push(event)
      else if (source === 'cpi') tx.events[previous] = event
    } catch (error) {
      tx.issues.push({ code: 'EVENT_DECODE', path: eventPath, programId, message: message(error) })
    }
  }

  // emit_cpi: a self-invocation signed by the program's event authority, directly under the program.
  // Anyone can call a program with the tag; only the authority check makes the event the program's.
  const byIndex = new Map(tx.instructions.map((ix) => [ix.path.index, ix]))
  for (const ix of tx.instructions) {
    const program = programs.get(ix.programId)
    if (!program?.event || !isEventCpi(ix.data)) continue
    const parent = ix.parentIndex === null ? undefined : byIndex.get(ix.parentIndex)
    if (!program.eventAuthority || ix.accounts[0] !== program.eventAuthority || parent?.programId !== ix.programId) {
      issue(tx.issues, 'EVENT_CPI_AUTHORITY', 'An event CPI is not nested under its program with the canonical event authority.', ix)
      continue
    }
    add(ix.programId, ix.data.subarray(8), 'cpi', parent.path, ix.path)
  }

  // "Program data:" log lines, attributed to the program on top of the invoke stack. Log lines are
  // matched to instructions by program and stack height, in order.
  const stack: { programId: string; depth: number; ix?: DecodedInstruction }[] = []
  let cursor = 0
  for (const line of tx.logs) {
    const invoked = /^Program (\S+) invoke \[(\d+)\]$/.exec(line)
    if (invoked) {
      const programId = invoked[1]!, depth = Number(invoked[2])
      const found = tx.instructions.findIndex((ix, i) => i >= cursor && ix.programId === programId && ix.stackHeight === depth)
      if (found >= 0) cursor = found + 1
      while (stack.length && stack[stack.length - 1]!.depth >= depth) stack.pop()
      stack.push({ programId, depth, ix: found >= 0 ? tx.instructions[found] : undefined })
      continue
    }
    const finished = /^Program (\S+) (success|failed: (.*))$/.exec(line)
    if (finished) {
      if (finished[2] !== 'success' && tx.firstFailure === null) {
        const code = /custom program error: (0x[0-9a-f]+|\d+)/i.exec(finished[3] ?? '')
        tx.firstFailure = { programId: finished[1]!, code: code ? Number(code[1]) : null, message: finished[3] ?? '' }
      }
      let i = stack.length - 1
      while (i >= 0 && stack[i]!.programId !== finished[1]) i--
      if (i >= 0) stack.splice(i)
      continue
    }
    if (!line.startsWith('Program data: ')) continue
    const frame = stack[stack.length - 1]
    if (!frame || !programs.get(frame.programId)?.event) continue
    if (!frame.ix) {
      issue(tx.issues, 'UNSCOPED_EVENT', 'A program event could not be matched to its instruction.')
      continue
    }
    try {
      add(frame.programId, fromBase64(line.slice('Program data: '.length).split(' ')[0]!), 'log', frame.ix.path, frame.ix.path)
    } catch (error) {
      tx.issues.push({ code: 'EVENT_DECODE', path: frame.ix.path, programId: frame.programId, message: message(error) })
    }
  }
}

/** Decodes one raw `getTransaction` result (encoding 'json'). */
export function decodeTransaction(raw: unknown, programs: ProgramDecoder[], signature?: string): DecodedTransaction {
  const normalized = normalizeTransaction(raw, signature)
  const byId = new Map(programs.map((p) => [p.programId, p]))
  const tx: DecodedTransaction = { ...normalized, instructions: decodeInstructions(normalized, byId), events: [], tokenFlows: [], firstFailure: null }
  if (!normalized.valid) return tx
  decodeEvents(tx, byId)
  tx.tokenFlows = tokenFlows(tx)
  return tx
}

/** The named event one instruction emitted, by either route. */
export function eventFor(tx: DecodedTransaction, instruction: DecodedInstruction, name: string): DecodedEvent | undefined {
  return tx.events.find((e) => e.programId === instruction.programId && e.name === name && e.path.index === instruction.path.index)
}
