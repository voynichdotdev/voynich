// DAMM v2 trades on a graduated pool: exact-in quotes from the SDK's swap math and swap
// instructions. Token decimals come from the mints themselves, read once per mint.

import type { Commitment, Connection, PublicKey, TransactionInstruction } from '@solana/web3.js'
import { getMint } from '@solana/spl-token'
import { CpAmm, SwapMode, TradeDirection, getFeeMode, getTokenProgram, type PoolState, type Quote2Result } from '@meteora-ag/cp-amm-sdk'
import { ownedBy, withTokenAccounts, withoutComputeBudget, type MintRef } from './instructions.js'
import { big, bn, checkSlippage } from './math.js'
import { quoteMath, tooSmall } from './quote-error.js'

export type DammQuote = {
  pool: PublicKey
  inputMint: PublicKey
  outputMint: PublicKey
  amountIn: bigint
  amountOut: bigint
  minimumOut: bigint
  fee: bigint
  feeMint: PublicKey
  priceImpactBps: number
  nextSqrtPrice: bigint
  raw: Quote2Result
}

export type Damm = ReturnType<typeof createDamm>

/** The pool's mint, vault and token-program accounts, as every DAMM builder takes them. */
export const dammAccounts = (state: PoolState) => ({
  tokenAMint: state.tokenAMint,
  tokenBMint: state.tokenBMint,
  tokenAVault: state.tokenAVault,
  tokenBVault: state.tokenBVault,
  tokenAProgram: getTokenProgram(state.tokenAFlag),
  tokenBProgram: getTokenProgram(state.tokenBFlag),
})

/** The pool's A and B mints with their token programs. */
export const dammMints = (state: PoolState): MintRef[] => [
  { mint: state.tokenAMint, program: getTokenProgram(state.tokenAFlag) },
  { mint: state.tokenBMint, program: getTokenProgram(state.tokenBFlag) },
]

const sides = (state: PoolState, inputMint: PublicKey) => {
  const aToB = inputMint.equals(state.tokenAMint)
  if (!aToB && !inputMint.equals(state.tokenBMint)) throw new Error('The input mint does not belong to this DAMM v2 pool.')
  return { aToB, outputMint: aToB ? state.tokenBMint : state.tokenAMint }
}

export function createDamm(connection: Connection, commitment: Commitment = 'confirmed') {
  const amm = new CpAmm(connection)
  const decimals = new Map<string, Promise<number>>()

  const mintDecimals = (mint: PublicKey, program: PublicKey) => {
    const key = mint.toBase58()
    let pending = decimals.get(key)
    if (!pending) {
      pending = getMint(connection, mint, commitment, program).then((m) => m.decimals)
      pending.catch(() => decimals.delete(key))
      decimals.set(key, pending)
    }
    return pending
  }

  const pool = (address: PublicKey) => amm.fetchPoolState(address)

  async function currentPoint(state: PoolState): Promise<bigint> {
    return state.activationType === 0 ? BigInt(await connection.getSlot(commitment)) : BigInt(Math.floor(Date.now() / 1000))
  }

  async function quote(args: { pool: PublicKey; inputMint: PublicKey; amountIn: bigint; slippageBps: number; poolState?: PoolState; currentPoint?: bigint }): Promise<DammQuote> {
    checkSlippage(args.slippageBps)
    const state = args.poolState ?? (await pool(args.pool))
    const { aToB, outputMint } = sides(state, args.inputMint)
    const accounts = dammAccounts(state)
    const [tokenADecimal, tokenBDecimal, point] = await Promise.all([
      mintDecimals(state.tokenAMint, accounts.tokenAProgram),
      mintDecimals(state.tokenBMint, accounts.tokenBProgram),
      args.currentPoint ?? currentPoint(state),
    ])
    const raw = quoteMath(() =>
      amm.getQuote2({
        poolState: state,
        inputTokenMint: args.inputMint,
        swapMode: SwapMode.ExactIn,
        amountIn: bn(args.amountIn),
        slippage: args.slippageBps,
        currentPoint: bn(point),
        tokenADecimal,
        tokenBDecimal,
        hasReferral: false,
      }),
    )
    const amountOut = big(raw.outputAmount)
    const minimumOut = raw.minimumAmountOut ? big(raw.minimumAmountOut) : 0n
    if (amountOut <= 0n || minimumOut <= 0n) throw tooSmall()
    const feeMode = getFeeMode(state.collectFeeMode, aToB ? TradeDirection.AtoB : TradeDirection.BtoA, false)
    return {
      pool: args.pool,
      inputMint: args.inputMint,
      outputMint,
      amountIn: big(raw.includedFeeInputAmount),
      amountOut,
      minimumOut,
      fee: big(raw.claimingFee.add(raw.protocolFee).add(raw.compoundingFee).add(raw.referralFee)),
      feeMint: feeMode.feesOnTokenA ? state.tokenAMint : state.tokenBMint,
      priceImpactBps: raw.priceImpact.mul(100).floor().toNumber(),
      nextSqrtPrice: big(raw.nextSqrtPrice),
      raw,
    }
  }

  async function swap(args: { owner: PublicKey; pool: PublicKey; inputMint: PublicKey; amountIn: bigint; minimumOut: bigint; poolState?: PoolState }): Promise<TransactionInstruction[]> {
    const state = args.poolState ?? (await pool(args.pool))
    const { outputMint } = sides(state, args.inputMint)
    const accounts = dammAccounts(state)
    const tx = await amm.swap2({
      payer: args.owner,
      pool: args.pool,
      poolState: state,
      inputTokenMint: args.inputMint,
      outputTokenMint: outputMint,
      ...accounts,
      swapMode: SwapMode.ExactIn,
      amountIn: bn(args.amountIn),
      minimumAmountOut: bn(args.minimumOut),
      referralTokenAccount: null,
    })
    return withTokenAccounts(withoutComputeBudget(tx.instructions), args.owner, ownedBy(args.owner, dammMints(state)))
  }

  return { amm, connection, pool, mintDecimals, currentPoint, quote, swap }
}
