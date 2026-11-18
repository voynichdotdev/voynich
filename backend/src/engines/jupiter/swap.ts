// swap-instructions for a taker that signs at top level (a wallet, a keeper key): the checked
// route with its setup and cleanup, ready to place in a transaction.

import { PublicKey, SystemProgram, type TransactionInstruction } from '@solana/web3.js'
import { NATIVE_MINT, TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token'
import { JupiterError, type JupiterClient } from './http.js'
import { checkRoute, fetchSwapInstructions, readAtaCreate, uses } from './instructions.js'
import type { Quote } from './quote.js'
import type { RouteArgs } from './route-data.js'

export type SwapRequest = {
  quote: Quote
  taker: PublicKey
  /** the token account the output lands in; the taker's own ATA when omitted */
  destination?: PublicKey
  /** Jupiter wraps SOL in and unwraps SOL out through the taker's WSOL account (default true) */
  wrapAndUnwrapSol?: boolean
  useSharedAccounts?: boolean
}

export type SwapInstructions = {
  /** idempotent opens of the token accounts the route uses, then Jupiter's SOL wrap if any */
  setup: TransactionInstruction[]
  swap: TransactionInstruction
  /** the WSOL close when unwrapping */
  cleanup: TransactionInstruction[]
  /** Jupiter's tables; compile over them together with your own */
  lookupTables: PublicKey[]
  route: RouteArgs
}

const refuse = () => new JupiterError('MISMATCH', 'Jupiter returned setup this app does not build with. Request a new quote.')

// System transfer into the WSOL account, or SyncNative on it.
const wraps = (ix: TransactionInstruction, taker: PublicKey, wsol: PublicKey) =>
  (ix.programId.equals(SystemProgram.programId) && ix.keys[0]?.pubkey.equals(taker) && ix.keys[1]?.pubkey.equals(wsol)) ||
  (ix.programId.equals(TOKEN_PROGRAM_ID) && ix.data.length === 1 && ix.data[0] === 17 && ix.keys[0]?.pubkey.equals(wsol))

// CloseAccount of the WSOL account back to the taker.
const unwraps = (ix: TransactionInstruction, taker: PublicKey, wsol: PublicKey) =>
  ix.programId.equals(TOKEN_PROGRAM_ID) && ix.data.length === 1 && ix.data[0] === 9 && ix.keys[0]?.pubkey.equals(wsol) && ix.keys[1]?.pubkey.equals(taker) && ix.keys[2]?.pubkey.equals(taker)

export async function swapInstructions(client: JupiterClient, request: SwapRequest): Promise<SwapInstructions> {
  const { quote, taker, destination, wrapAndUnwrapSol = true, useSharedAccounts } = request
  const answer = await fetchSwapInstructions(client, {
    quoteResponse: quote.raw,
    userPublicKey: taker.toBase58(),
    wrapAndUnwrapSol,
    skipUserAccountsRpcCalls: true,
    dynamicComputeUnitLimit: false,
    ...(destination ? { destinationTokenAccount: destination.toBase58() } : {}),
    ...(useSharedAccounts !== undefined ? { useSharedAccounts } : {}),
  })
  const route = checkRoute(answer.swap, quote, taker, destination ? [destination] : [])
  const wsol = getAssociatedTokenAddressSync(NATIVE_MINT, taker, true)

  const opens: TransactionInstruction[] = []
  const wrap: TransactionInstruction[] = []
  for (const ix of answer.setup) {
    const create = readAtaCreate(ix)
    if (create) {
      if (!create.owner.equals(taker) || !create.payer.equals(taker)) throw refuse()
      // skipUserAccountsRpcCalls can open an output ATA no route meta uses; it is dropped.
      if (uses(answer.swap, create.ata)) opens.push(createAssociatedTokenAccountIdempotentInstruction(taker, create.ata, taker, create.mint, create.tokenProgram))
    } else if (wrapAndUnwrapSol && wraps(ix, taker, wsol)) wrap.push(ix)
    else throw refuse()
  }
  if (answer.cleanup && !(wrapAndUnwrapSol && unwraps(answer.cleanup, taker, wsol))) throw refuse()

  // Jupiter leaves out opening the WSOL account when it existed at build time, while its own
  // cleanup closes it: swaps built ahead, or sent after an unwrap, then fail inside the route.
  // Every swap through WSOL opens it idempotently first.
  const viaWsol = wrapAndUnwrapSol && (quote.inputMint === NATIVE_MINT.toBase58() || quote.outputMint === NATIVE_MINT.toBase58())
  if (viaWsol && !opens.some((ix) => ix.keys[1]!.pubkey.equals(wsol))) opens.unshift(createAssociatedTokenAccountIdempotentInstruction(taker, wsol, taker, NATIVE_MINT))

  return { setup: [...opens, ...wrap], swap: answer.swap, cleanup: answer.cleanup ? [answer.cleanup] : [], lookupTables: answer.lookupTables, route }
}
