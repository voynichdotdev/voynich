// An Anchor IDL as a ProgramDecoder: instructions with their account names, events from logs and
// emit_cpi, and account decoding, with every BN, bigint and PublicKey turned into JSON text so
// facts store exactly.

import anchor from '@coral-xyz/anchor'
import type { Idl } from '@coral-xyz/anchor'
import { PublicKey } from '@solana/web3.js'
import type { ProgramDecoder } from './decoder.js'
import type { Fields, Json } from './fields.js'

// Anchor ships CommonJS that Node ESM can't read named exports from; take them off the default.
const { BN, BorshCoder } = anchor

/** Decoded program data as JSON: integers wider than 32 bits and keys become strings. */
export function toJson(value: unknown): Json {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return value
  if (value === undefined) return null
  if (typeof value === 'bigint') return value.toString()
  if (BN.isBN(value)) return (value as { toString(radix: number): string }).toString(10)
  if (value instanceof PublicKey) return value.toBase58()
  if (value instanceof Uint8Array) return Array.from(value)
  if (Array.isArray(value)) return value.map(toJson)
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toJson(v)]))
  throw new Error('Unsupported value in decoded IDL data.')
}

type AccountItem = { name: string; accounts?: AccountItem[] }
// Composite account groups are flattened in order, the way the instruction lists them.
const flatten = (items: AccountItem[]): string[] => items.flatMap((item) => (item.accounts ? flatten(item.accounts) : [item.name]))

export type AnchorProgram = ProgramDecoder & {
  idl: Idl
  /** decodes an account by its IDL name, checking the discriminator */
  account(name: string, data: Uint8Array): Fields
}

export function anchorProgram(idl: Idl): AnchorProgram {
  const coder = new BorshCoder(idl)
  const programId = new PublicKey(idl.address)
  const accounts = new Map(idl.instructions.map((ix) => [ix.name, flatten(ix.accounts as AccountItem[])]))
  return {
    idl,
    programId: programId.toBase58(),
    eventAuthority: PublicKey.findProgramAddressSync([Buffer.from('__event_authority')], programId)[0].toBase58(),
    instruction(data) {
      const decoded = coder.instruction.decode(Buffer.from(data))
      return decoded ? { name: decoded.name, args: toJson(decoded.data) as Fields, accounts: accounts.get(decoded.name) ?? [] } : null
    },
    event(bytes) {
      const decoded = coder.events.decode(Buffer.from(bytes).toString('base64'))
      return decoded ? { name: decoded.name, data: toJson(decoded.data) as Fields } : null
    },
    account: (name, data) => toJson(coder.accounts.decode(name, Buffer.from(data))) as Fields,
  }
}
