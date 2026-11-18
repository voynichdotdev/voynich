// SPL Token and Token-2022 movements read from the token instructions themselves (Transfer, MintTo,
// Burn and their Checked forms), each tied to its place in the call tree. A fact builder asks what
// moved under one program instruction and takes amounts from the token program, which can't
// disagree with balances, rather than from the program's own event.

import type { InstructionPath, NormalizedInstruction, NormalizedTransaction } from './transaction.js'

export const TOKEN_PROGRAMS = new Set(['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'])

export interface TokenFlow {
  path: InstructionPath
  parentIndex: number | null
  kind: 'transfer' | 'mint' | 'burn'
  /** null for a plain Transfer whose accounts have no token balance entry */
  mint: string | null
  amountRaw: string
  source: string | null
  destination: string | null
  authority: string
}

// Tag → kind. Transfer 3, MintTo 7, Burn 8, TransferChecked 12, MintToChecked 14, BurnChecked 15.
const KINDS: Record<number, TokenFlow['kind']> = { 3: 'transfer', 7: 'mint', 8: 'burn', 12: 'transfer', 14: 'mint', 15: 'burn' }
const CHECKED = new Set([12, 14, 15])

/** Every token movement in the transaction, in execution order. Unreadable ones become issues. */
export function tokenFlows(tx: NormalizedTransaction): TokenFlow[] {
  const mintOf = new Map(tx.tokenBalances.map((b) => [b.account, b.mint]))
  const flows: TokenFlow[] = []
  for (const ix of tx.instructions) {
    if (!TOKEN_PROGRAMS.has(ix.programId)) continue
    const tag = ix.data[0] ?? -1
    const kind = KINDS[tag] as TokenFlow['kind'] | undefined
    if (!kind) continue
    try {
      if (ix.data.length < (CHECKED.has(tag) ? 10 : 9)) throw new Error('Token instruction data is truncated.')
      const amountRaw = new DataView(ix.data.buffer, ix.data.byteOffset, ix.data.byteLength).getBigUint64(1, true).toString()
      const a = ix.accounts
      const source = kind === 'mint' ? null : a[0]
      const destination = kind === 'burn' ? null : kind === 'mint' ? a[1] : a[tag === 12 ? 2 : 1]
      const authority = a[tag === 12 ? 3 : 2]
      const mint = tag === 3 ? (mintOf.get(source!) ?? mintOf.get(destination!) ?? null) : kind === 'mint' ? a[0] : a[1]
      if (!authority || (kind !== 'mint' && !source) || (kind !== 'burn' && !destination)) throw new Error('Token instruction accounts are truncated.')
      flows.push({ path: ix.path, parentIndex: ix.parentIndex, kind, mint: mint ?? null, amountRaw, source: source ?? null, destination: destination ?? null, authority })
    } catch (error) {
      tx.issues.push({ code: 'TOKEN_FLOW_DECODE', message: error instanceof Error ? error.message : String(error), path: ix.path, programId: ix.programId })
    }
  }
  return flows
}

/** The token movements anywhere beneath one instruction in the call tree. */
export function descendants(tx: { instructions: NormalizedInstruction[]; tokenFlows: TokenFlow[] }, instruction: NormalizedInstruction): TokenFlow[] {
  const parentOf = new Map(tx.instructions.map((ix) => [ix.path.index, ix.parentIndex]))
  return tx.tokenFlows.filter((flow) => {
    let parent = flow.parentIndex
    while (parent !== null) {
      if (parent === instruction.path.index) return true
      parent = parentOf.get(parent) ?? null
    }
    return false
  })
}

/** Total transferred out of (source) or into (destination) one token account, or null if nothing. */
export function amountMoved(flows: TokenFlow[], account: string, direction: 'source' | 'destination'): string | null {
  const hits = flows.filter((f) => f.kind === 'transfer' && f[direction] === account)
  return hits.length ? hits.reduce((sum, f) => sum + BigInt(f.amountRaw), 0n).toString() : null
}

/** The wallet that owns a token account, from the transaction's token balances. */
export function walletFor(tx: NormalizedTransaction, tokenAccount: string, fallback: string): string {
  return tx.tokenBalances.find((b) => b.account === tokenAccount && b.owner)?.owner ?? fallback
}
