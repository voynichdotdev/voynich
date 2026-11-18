// One shape for every transaction RPC returns as raw JSON (encoding 'json', legacy, v0 and v1):
// resolved account keys, every instruction outer and inner with its place in the call tree,
// token balances and logs. Nothing here throws on odd input; problems become issues, and a
// transaction that can't be read at all comes back with valid: false.

import { fromBase58 } from '../core/encoding.js'

export interface InstructionPath {
  /** index of the top-level instruction */
  outer: number
  /** index inside that instruction's inner list, null for the top-level one itself */
  inner: number | null
  /** position in the flattened list, outer and inner in execution order */
  index: number
}
export interface DecodeIssue { code: string; message: string; path?: InstructionPath; programId?: string }
export interface TransactionKey { address: string; signer: boolean; writable: boolean }
export interface NormalizedInstruction {
  programId: string
  accounts: string[]
  accountIndexes: number[]
  data: Uint8Array
  dataBase58: string
  path: InstructionPath
  /** flattened index of the instruction that invoked this one */
  parentIndex: number | null
  stackHeight: number
}
export interface TokenBalance { account: string; mint: string; owner: string | null; decimals: number; raw: string; side: 'pre' | 'post' }
export interface NormalizedTransaction {
  valid: boolean
  signature: string
  slot: number
  blockTime: number | null
  version: 'legacy' | 0 | 1
  failed: boolean
  feeRaw: string | null
  signers: string[]
  keys: TransactionKey[]
  instructions: NormalizedInstruction[]
  tokenBalances: TokenBalance[]
  logs: string[]
  /** the runtime cut the logs short; events read from logs may be missing */
  logsTruncated: boolean
  issues: DecodeIssue[]
}

type Obj = Record<string, unknown>
const object = (value: unknown): Obj => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON object.')
  return value as Obj
}
const array = (value: unknown): unknown[] => {
  if (!Array.isArray(value)) throw new Error('Expected a JSON array.')
  return value
}
const integer = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error(`Expected a safe unsigned integer for ${label}.`)
  return value
}
const address = (value: unknown): string => {
  if (typeof value !== 'string' || fromBase58(value).length !== 32) throw new Error('Expected a Solana address.')
  return value
}
const amount = (value: unknown): string => {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)) throw new Error('Expected an exact raw token amount string.')
  return value
}
const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * Account keys are the message's static keys, then for legacy and v0 the lookup-table addresses
 * (writable, then readonly). A v1 message carries every key inline and has no lookup tables.
 */
export function normalizeTransaction(raw: unknown, suppliedSignature?: string): NormalizedTransaction {
  const issues: DecodeIssue[] = []
  try {
    const tx = object(raw), transaction = object(tx.transaction), msg = object(transaction.message), meta = object(tx.meta)
    const version = tx.version ?? 'legacy'
    if (version !== 'legacy' && version !== 0 && version !== 1) throw new Error(`Unsupported transaction version: ${String(version)}`)
    const header = object(msg.header), staticKeys = array(msg.accountKeys), signatures = array(transaction.signatures)
    const signature = suppliedSignature ?? (typeof signatures[0] === 'string' ? signatures[0] : '')
    if (!signature) throw new Error('A transaction signature is required.')
    const required = integer(header.numRequiredSignatures, 'required signatures')
    const readonlySigned = integer(header.numReadonlySignedAccounts, 'readonly signers')
    const readonlyUnsigned = integer(header.numReadonlyUnsignedAccounts, 'readonly accounts')
    const keys: TransactionKey[] = staticKeys.map((entry, index) => {
      const key = typeof entry === 'string' ? null : object(entry)
      return {
        address: address(key ? key.pubkey : entry),
        signer: key ? key.signer === true : index < required,
        writable: key ? key.writable === true : index < required ? index < required - readonlySigned : index < staticKeys.length - readonlyUnsigned,
      }
    })
    const loaded = meta.loadedAddresses == null ? { writable: [], readonly: [] } : object(meta.loadedAddresses)
    if (version !== 1) {
      for (const [name, writable] of [['writable', true], ['readonly', false]] as const) {
        for (const entry of array(loaded[name] ?? [])) keys.push({ address: address(entry), signer: false, writable })
      }
    } else if (array(loaded.writable ?? []).length || array(loaded.readonly ?? []).length) {
      issues.push({ code: 'V1_LOADED_ADDRESSES', message: 'A v1 transaction reported lookup-table addresses; its inline keys stay authoritative.' })
    }

    const instructions: NormalizedInstruction[] = []
    const innerGroups = array(meta.innerInstructions ?? []).map(object)
    let next = 0
    const append = (value: unknown, outer: number, inner: number | null, ancestors: NormalizedInstruction[]) => {
      const path: InstructionPath = { outer, inner, index: next++ }
      try {
        const ix = object(value)
        const programIndex = integer(ix.programIdIndex, 'program index')
        const accountIndexes = array(ix.accounts).map((i) => integer(i, 'account index'))
        if (!keys[programIndex] || accountIndexes.some((i) => !keys[i])) throw new Error('Instruction account index is outside the transaction keys.')
        if (typeof ix.data !== 'string') throw new Error('Raw RPC instruction data must be base58.')
        const stackHeight = ix.stackHeight == null ? (inner === null ? 1 : 2) : integer(ix.stackHeight, 'stack height')
        while (ancestors.length && ancestors[ancestors.length - 1]!.stackHeight >= stackHeight) ancestors.pop()
        const normalized: NormalizedInstruction = {
          programId: keys[programIndex].address,
          accounts: accountIndexes.map((i) => keys[i]!.address),
          accountIndexes,
          data: fromBase58(ix.data),
          dataBase58: ix.data,
          path,
          parentIndex: ancestors[ancestors.length - 1]?.path.index ?? null,
          stackHeight,
        }
        instructions.push(normalized)
        ancestors.push(normalized)
      } catch (error) {
        issues.push({ code: 'INVALID_INSTRUCTION', path, message: message(error) })
      }
    }
    array(msg.instructions).forEach((ix, outer) => {
      const ancestors: NormalizedInstruction[] = []
      append(ix, outer, null, ancestors)
      const group = innerGroups.find((g) => g.index === outer)
      if (group) array(group.instructions).forEach((child, inner) => append(child, outer, inner, ancestors))
    })

    const tokenBalances: TokenBalance[] = []
    for (const side of ['pre', 'post'] as const) {
      for (const value of array(meta[`${side}TokenBalances`] ?? [])) {
        try {
          const balance = object(value), ui = object(balance.uiTokenAmount)
          const key = keys[integer(balance.accountIndex, 'token balance index')]
          if (!key) throw new Error('Token balance index is outside the transaction keys.')
          tokenBalances.push({
            account: key.address,
            mint: address(balance.mint),
            owner: balance.owner == null ? null : address(balance.owner),
            decimals: integer(ui.decimals, 'mint decimals'),
            raw: amount(ui.amount),
            side,
          })
        } catch (error) {
          issues.push({ code: 'INVALID_TOKEN_BALANCE', message: message(error) })
        }
      }
    }

    const logs = array(meta.logMessages ?? []).map((line) => {
      if (typeof line !== 'string') throw new Error('Transaction logs must be strings.')
      return line
    })
    const feeRaw = meta.fee == null ? null : typeof meta.fee === 'string' ? amount(meta.fee) : String(integer(meta.fee, 'transaction fee'))
    return {
      valid: true,
      signature,
      slot: integer(tx.slot, 'slot'),
      blockTime: tx.blockTime == null ? null : integer(tx.blockTime, 'block time'),
      version,
      failed: meta.err != null,
      feeRaw,
      signers: keys.filter((k) => k.signer).map((k) => k.address),
      keys,
      instructions,
      tokenBalances,
      logs,
      logsTruncated: logs.some((line) => /log truncated/i.test(line)),
      issues,
    }
  } catch (error) {
    return {
      valid: false, signature: suppliedSignature ?? '', slot: 0, blockTime: null, version: 'legacy', failed: false, feeRaw: null,
      signers: [], keys: [], instructions: [], tokenBalances: [], logs: [], logsTruncated: false,
      issues: [...issues, { code: 'INVALID_TRANSACTION', message: message(error) }],
    }
  }
}
