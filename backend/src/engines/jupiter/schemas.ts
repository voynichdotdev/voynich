// The shapes of Jupiter's answers, validated before anything reads them. Quotes stay loose (every
// field Jupiter sent is kept), because swap-instructions wants the quote back exactly as given.

import { PublicKey, TransactionInstruction } from '@solana/web3.js'
import { z } from 'zod'
import { JupiterError } from './http.js'

const U64_MAX = 18446744073709551615n
const u64 = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .refine((v) => BigInt(v) <= U64_MAX)

export const quoteSchema = z.looseObject({
  inputMint: z.string(),
  outputMint: z.string(),
  inAmount: u64,
  outAmount: u64,
  otherAmountThreshold: u64,
  swapMode: z.enum(['ExactIn', 'ExactOut']),
  slippageBps: z.number().int(),
  platformFee: z.looseObject({ feeBps: z.number().int() }).nullable().optional(),
  routePlan: z.array(z.looseObject({ percent: z.number().nullable().optional(), swapInfo: z.looseObject({ ammKey: z.string(), label: z.string().optional() }) })).min(1),
  contextSlot: z.number().int().optional(),
})
export type JupiterQuote = z.output<typeof quoteSchema>

const wireInstruction = z.object({
  programId: z.string(),
  accounts: z.array(z.object({ pubkey: z.string(), isSigner: z.boolean(), isWritable: z.boolean() })).max(256),
  data: z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/),
})
export type WireInstruction = z.output<typeof wireInstruction>

export const swapInstructionsSchema = z.looseObject({
  computeBudgetInstructions: z.array(wireInstruction).default([]),
  setupInstructions: z.array(wireInstruction).default([]),
  swapInstruction: wireInstruction,
  cleanupInstruction: wireInstruction.nullable().optional(),
  otherInstructions: z.array(wireInstruction).default([]),
  tokenLedgerInstruction: wireInstruction.nullable().optional(),
  addressLookupTableAddresses: z.array(z.string()).default([]),
})

export function parse<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw new JupiterError('INVALID_RESPONSE', 'Jupiter returned a response this app cannot read. Request a new quote.', true)
  return parsed.data
}

export function instructionFromWire(wire: WireInstruction): TransactionInstruction {
  try {
    return new TransactionInstruction({
      programId: new PublicKey(wire.programId),
      keys: wire.accounts.map((a) => ({ pubkey: new PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })),
      data: Buffer.from(wire.data, 'base64'),
    })
  } catch {
    throw new JupiterError('INVALID_RESPONSE', 'Jupiter returned an instruction with an invalid address.', true)
  }
}
