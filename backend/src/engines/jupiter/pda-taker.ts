// swap-instructions for a program PDA as Jupiter's taker (a buyback vault, a fee PDA). The
// route goes into the program's CPI and is signed there with invoke_signed; whatever a PDA can't
// do at top level (pay for an account) moves to the crank's payer.
//
// The PDA's signature reaches every program the route calls. The program itself, after the CPI,
// checks each taker token account the route touched: still owned by the PDA, no delegate, no
// close authority, and no smaller than before unless it is the source.

import { type AccountMeta, PublicKey, type TransactionInstruction } from '@solana/web3.js'
import { createAssociatedTokenAccountIdempotentInstruction } from '@solana/spl-token'
import { JupiterError, type JupiterClient } from './http.js'
import { JUPITER_PROGRAM_ID, checkRoute, fetchSwapInstructions, readAtaCreate, uses } from './instructions.js'
import type { Quote } from './quote.js'
import type { RouteArgs } from './route-data.js'

export type PdaSwapRequest = {
  quote: Quote
  /** the PDA holding the input; the program signs the route for it */
  taker: PublicKey
  /** the crank's fee payer, which opens any taker token account the route needs */
  payer: PublicKey
  /** the PDA's token account the input leaves from */
  source: PublicKey
  /** the token account the output lands in */
  destination: PublicKey
  /** false by default: the route then moves middle mints through the taker's own accounts, where the program can check them */
  useSharedAccounts?: boolean
}

export type PdaSwap = {
  /** idempotent opens of the taker's token accounts the route uses, paid by `payer` */
  setup: TransactionInstruction[]
  /** Jupiter's route as the program must invoke it (the taker marked signer) */
  swap: TransactionInstruction
  /** [Jupiter program, ...route metas] with no signer flag, for the outer instruction's remaining accounts */
  remainingAccounts: AccountMeta[]
  /** taker token accounts that only carry middle mints of a multi-hop route */
  hops: PublicKey[]
  lookupTables: PublicKey[]
  route: RouteArgs
}

export async function pdaSwapInstructions(client: JupiterClient, request: PdaSwapRequest): Promise<PdaSwap> {
  const { quote, taker, payer, source, destination } = request
  const answer = await fetchSwapInstructions(client, {
    quoteResponse: quote.raw,
    userPublicKey: taker.toBase58(),
    destinationTokenAccount: destination.toBase58(),
    wrapAndUnwrapSol: false,
    useSharedAccounts: request.useSharedAccounts ?? false,
    skipUserAccountsRpcCalls: true,
    dynamicComputeUnitLimit: false,
  })
  if (answer.cleanup) throw new JupiterError('MISMATCH', 'Jupiter returned a cleanup step a PDA taker cannot run. Request a new quote.')
  const route = checkRoute(answer.swap, quote, taker, [source, destination])

  const setup: TransactionInstruction[] = []
  const hops: PublicKey[] = []
  for (const ix of answer.setup) {
    const create = readAtaCreate(ix)
    if (!create || !create.owner.equals(taker)) throw new JupiterError('MISMATCH', 'Jupiter returned setup a PDA taker cannot run. Request a new quote.')
    // With skipUserAccountsRpcCalls, Jupiter opens the taker's output ATA even when the
    // destination names another account. A create no route meta uses is dropped.
    if (!uses(answer.swap, create.ata)) continue
    setup.push(createAssociatedTokenAccountIdempotentInstruction(payer, create.ata, taker, create.mint, create.tokenProgram))
    if (!create.ata.equals(source) && !create.ata.equals(destination)) hops.push(create.ata)
  }

  const remainingAccounts = [
    { pubkey: JUPITER_PROGRAM_ID, isSigner: false, isWritable: false },
    ...answer.swap.keys.map((k) => ({ ...k, isSigner: false })),
  ]
  return { setup, swap: answer.swap, remainingAccounts, hops, lookupTables: answer.lookupTables, route }
}
