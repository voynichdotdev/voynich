// LaunchLab's captured mainnet IDL as encoder and decoder. Instructions are built by IDL name in
// the IDL's account order, with its signer/writable flags and fixed addresses; accounts and
// events decode into plain values (bigint for integers, camelCase keys, enum variants as names).

// BN from bn.js itself: anchor's CommonJS build does not expose BN as a named export to Node's ESM loader.
import BN from 'bn.js'
import { BorshCoder, type Idl } from '@coral-xyz/anchor'
import { PublicKey, TransactionInstruction, type AccountMeta } from '@solana/web3.js'
import idl from '../idls/launchlab.json' with { type: 'json' }

export const LAUNCHLAB_IDL = idl as unknown as Idl
const coder = new BorshCoder(LAUNCHLAB_IDL)

type IdlAccountItem = Idl['instructions'][number]['accounts'][number]
type IdlAccount = Exclude<IdlAccountItem, { accounts: unknown }>
const flatten = (items: IdlAccountItem[]): IdlAccount[] => items.flatMap((a) => ('accounts' in a ? flatten(a.accounts) : [a]))

/** bigint → BN all the way down, so callers write amounts as bigint. */
const toBorsh = (v: unknown): unknown =>
  typeof v === 'bigint' ? new BN(v.toString())
    : Array.isArray(v) ? v.map(toBorsh)
    : v && typeof v === 'object' && !(v instanceof PublicKey) && !(v instanceof Uint8Array) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toBorsh(x)]))
    : v

/**
 * A LaunchLab instruction by its IDL name. `args` and `accounts` use the IDL's snake_case names;
 * accounts the IDL pins (programs, sysvars) fill themselves. `remaining` go after the IDL's own.
 */
export function launchlabInstruction(name: string, args: Record<string, unknown>, accounts: Record<string, PublicKey>, remaining: AccountMeta[] = []) {
  const ix = LAUNCHLAB_IDL.instructions.find((i) => i.name === name)
  if (!ix) throw new Error(`${name} is not in the LaunchLab IDL`)
  const keys = flatten(ix.accounts).map((a) => {
    const pubkey = accounts[a.name] ?? (a.address ? new PublicKey(a.address) : undefined)
    if (!pubkey) throw new Error(`${name} needs account ${a.name}`)
    return { pubkey, isSigner: !!a.signer, isWritable: !!a.writable }
  })
  return new TransactionInstruction({
    programId: new PublicKey(LAUNCHLAB_IDL.address),
    keys: [...keys, ...remaining],
    data: coder.instruction.encode(name, toBorsh(args)),
  })
}

/** snake_case fields and PascalCase enum variants both come out camelCase. */
const camel = (k: string) => k[0]!.toLowerCase() + k.slice(1).replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())

/**
 * Decoded Borsh to plain values. A fieldless enum variant ({ QuoteToken: {} }) becomes its name
 * ('quoteToken'); fixed byte arrays stay number[].
 */
export function plain(v: unknown): unknown {
  if (BN.isBN(v)) return BigInt((v as BN).toString())
  if (v instanceof PublicKey || v instanceof Uint8Array) return v
  if (Array.isArray(v)) return v.map(plain)
  if (v && typeof v === 'object') {
    const entries = Object.entries(v)
    const only = entries.length === 1 ? entries[0]![1] : undefined
    if (only && Object.getPrototypeOf(only) === Object.prototype && Object.keys(only).length === 0) return camel(entries[0]![0])
    return Object.fromEntries(entries.map(([k, x]) => [camel(k), plain(x)]))
  }
  return v
}

/** Decodes a LaunchLab account by IDL type name; the 8-byte discriminator is checked. */
export const decodeLaunchlabAccount = <T>(name: string, data: Buffer) => plain(coder.accounts.decode(name, data)) as T

export const accountDiscriminator = (name: string) => Buffer.from(LAUNCHLAB_IDL.accounts!.find((a) => a.name === name)!.discriminator)

/** Decodes an event body (after Anchor's 8-byte event-CPI tag), or null when it is not a LaunchLab event. */
export function decodeLaunchlabEvent(data: Buffer): { name: string; data: unknown } | null {
  const event = coder.events.decode(data.toString('base64'))
  return event ? { name: event.name, data: plain(event.data) } : null
}
