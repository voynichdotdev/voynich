// What every swap-instructions answer is checked for, whoever the taker is: Jupiter's program,
// the taker as the only signer, the quoted amounts in the route data, no platform fee, and setup
// that does nothing but open the taker's own token accounts.

import { PublicKey, type TransactionInstruction } from '@solana/web3.js'
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token'
import { JupiterError, type JupiterClient } from './http.js'
import type { Quote } from './quote.js'
import { readRouteArgs, type RouteArgs } from './route-data.js'
import { instructionFromWire, parse, swapInstructionsSchema } from './schemas.js'

export const JUPITER_PROGRAM_ID = new PublicKey('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4')

const mismatch = (what: string) => new JupiterError('MISMATCH', `Jupiter returned ${what}. Request a new quote.`)

export const uses = (ix: TransactionInstruction, key: PublicKey) => ix.keys.some((k) => k.pubkey.equals(key))

export type AtaCreate = { payer: PublicKey; ata: PublicKey; owner: PublicKey; mint: PublicKey; tokenProgram: PublicKey }

/** An associated-token-account create (plain or idempotent) whose address really derives from its owner and mint. */
export function readAtaCreate(ix: TransactionInstruction): AtaCreate | null {
  const plain = ix.data.length === 0 || (ix.data.length === 1 && ix.data[0] === 1)
  if (!ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID) || ix.keys.length < 6 || !plain) return null
  const [payer, ata, owner, mint, , tokenProgram] = ix.keys.map((k) => k.pubkey) as [PublicKey, PublicKey, PublicKey, PublicKey, PublicKey, PublicKey]
  if (!tokenProgram.equals(TOKEN_PROGRAM_ID) && !tokenProgram.equals(TOKEN_2022_PROGRAM_ID)) return null
  if (!ata.equals(getAssociatedTokenAddressSync(mint, owner, true, tokenProgram))) return null
  return { payer, ata, owner, mint, tokenProgram }
}

export type JupiterAnswer = {
  setup: TransactionInstruction[]
  swap: TransactionInstruction
  cleanup: TransactionInstruction | null
  lookupTables: PublicKey[]
}

/** Jupiter's compute-budget instructions are dropped: the transaction builder sets its own. */
export async function fetchSwapInstructions(client: JupiterClient, body: Record<string, unknown>): Promise<JupiterAnswer> {
  const wire = parse(swapInstructionsSchema, await client.post('swap-instructions', body))
  if (wire.tokenLedgerInstruction || wire.otherInstructions.length) throw mismatch('instructions this app does not build with')
  return {
    setup: wire.setupInstructions.map(instructionFromWire),
    swap: instructionFromWire(wire.swapInstruction),
    cleanup: wire.cleanupInstruction ? instructionFromWire(wire.cleanupInstruction) : null,
    lookupTables: wire.addressLookupTableAddresses.map((a) => new PublicKey(a)),
  }
}

/** The route moves exactly the quote, is signed by the taker alone, and writes every account in `writes`. */
export function checkRoute(swap: TransactionInstruction, quote: Quote, taker: PublicKey, writes: PublicKey[]): RouteArgs {
  if (!swap.programId.equals(JUPITER_PROGRAM_ID)) throw mismatch('a swap for another program')
  const signers = swap.keys.filter((k) => k.isSigner)
  if (!signers.length || signers.some((k) => !k.pubkey.equals(taker))) throw mismatch('a swap with an unexpected signer')
  if (writes.some((a) => !swap.keys.some((k) => k.isWritable && k.pubkey.equals(a)))) throw mismatch('a swap that skips the given token accounts')
  const route = readRouteArgs(swap.data)
  const bound =
    route.inAmount === quote.inAmount &&
    route.quotedOutAmount === quote.outAmount &&
    route.slippageBps === quote.slippageBps &&
    route.platformFeeBps === 0 &&
    route.positiveSlippageBps === 0
  if (!bound) throw mismatch('a route whose amounts differ from the quote')
  return route
}
