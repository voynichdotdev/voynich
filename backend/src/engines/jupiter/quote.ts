// An exact-in quote, checked against what was asked before anything is built on it: the mints,
// the amount, the slippage, and a minimum that is Jupiter's own formula to the unit.

import type { PublicKey } from '@solana/web3.js'
import { JupiterError, type JupiterClient } from './http.js'
import { parse, quoteSchema, type JupiterQuote } from './schemas.js'

export type QuoteRequest = {
  inputMint: PublicKey | string
  outputMint: PublicKey | string
  /** base units of the input mint */
  amount: bigint
  slippageBps: number
  /** the route's account budget: leave room for the instructions the swap shares a transaction with */
  maxAccounts?: number
  /** Jupiter's venue labels; a label picks a venue, not one pool among several of the same venue */
  dexes?: string[]
  excludeDexes?: string[]
  onlyDirectRoutes?: boolean
  /** 'V2' asks for route_v2 instructions */
  instructionVersion?: 'V1' | 'V2'
}

export type Quote = {
  /** Jupiter's quote as sent, for swap-instructions */
  raw: JupiterQuote
  inputMint: string
  outputMint: string
  inAmount: bigint
  outAmount: bigint
  /** otherAmountThreshold: the least the route may deliver */
  minimumOut: bigint
  slippageBps: number
  contextSlot: number | null
}

/**
 * Jupiter's minimum: outAmount − floor(outAmount × slippageBps / 10000), so the minimum rounds
 * up. Code that recomputes it (server, client, a localnet stand-in) rounds the same way, or every
 * live quote is refused.
 */
export const minimumOut = (outAmount: bigint, slippageBps: number) => outAmount - (outAmount * BigInt(slippageBps)) / 10_000n

const text = (key: PublicKey | string) => (typeof key === 'string' ? key : key.toBase58())

export async function quoteExactIn(client: JupiterClient, request: QuoteRequest): Promise<Quote> {
  const { amount, slippageBps } = request
  if (amount <= 0n || amount > 18446744073709551615n) throw new RangeError('The amount must be a positive u64.')
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 10_000) throw new RangeError('Slippage is an integer from 0 to 10000 bps.')
  const inputMint = text(request.inputMint)
  const outputMint = text(request.outputMint)
  const query: Record<string, string> = { inputMint, outputMint, amount: amount.toString(), slippageBps: String(slippageBps), swapMode: 'ExactIn' }
  if (request.maxAccounts !== undefined) query.maxAccounts = String(request.maxAccounts)
  if (request.dexes?.length) query.dexes = request.dexes.join(',')
  if (request.excludeDexes?.length) query.excludeDexes = request.excludeDexes.join(',')
  if (request.onlyDirectRoutes) query.onlyDirectRoutes = 'true'
  if (request.instructionVersion) query.instructionVersion = request.instructionVersion

  const raw = parse(quoteSchema, await client.get('quote', query))
  const outAmount = BigInt(raw.outAmount)
  const bound =
    raw.inputMint === inputMint &&
    raw.outputMint === outputMint &&
    raw.swapMode === 'ExactIn' &&
    BigInt(raw.inAmount) === amount &&
    raw.slippageBps === slippageBps &&
    (raw.platformFee?.feeBps ?? 0) === 0 &&
    outAmount > 0n &&
    BigInt(raw.otherAmountThreshold) === minimumOut(outAmount, slippageBps)
  if (!bound) throw new JupiterError('MISMATCH', 'Jupiter quoted a different swap than the one requested. Request a new quote.')
  return {
    raw,
    inputMint,
    outputMint,
    inAmount: amount,
    outAmount,
    minimumOut: BigInt(raw.otherAmountThreshold),
    slippageBps,
    contextSlot: raw.contextSlot ?? null,
  }
}
