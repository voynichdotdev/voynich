// Raydium CPMM in integer math, rounded as the program's calculator rounds: both swap directions
// with the creator fee on the input or the output, the pool's tradable reserves, what a creator
// fee collect pays, and what a locked Fee Key has accrued. Pure bigint.

import { RATE_DENOMINATOR, ceilDiv, grossUp, isqrt } from './math.js'

/** AmmConfig rates in parts per million. Pass creator 0 when the pool's enable_creator_fee is off. */
export type CpmmRates = { trade: bigint; protocol: bigint; fund: bigint; creator: bigint }

export type CpmmSwap = {
  amountIn: bigint
  amountOut: bigint
  /** LP fee plus the protocol and fund cuts, always in the input token. */
  tradeFee: bigint
  protocolFee: bigint
  fundFee: bigint
  /** In the input token when creatorFeeOnInput, else in the output token. */
  creatorFee: bigint
  creatorFeeOnInput: boolean
  /** How the reserves move: input added after fees, output removed before an output-side creator fee. */
  reserveInDelta: bigint
  reserveOutDelta: bigint
}

/** PoolState creator_fee_on: 0 both tokens (always the input), 1 token 0 only, 2 token 1 only. */
export const creatorFeeOnInput = (creatorFeeOn: number, inputIsToken0: boolean) => creatorFeeOn === 0 || creatorFeeOn === (inputIsToken0 ? 1 : 2)

const cuts = (tradeFee: bigint, r: CpmmRates) => ({
  protocolFee: (tradeFee * r.protocol) / RATE_DENOMINATOR,
  fundFee: (tradeFee * r.fund) / RATE_DENOMINATOR,
})

/** swap_base_input: a creator fee on the input shares one rounded-up fee with the trade fee and is split out floored. */
export function swapBaseInput(amountIn: bigint, reserveIn: bigint, reserveOut: bigint, r: CpmmRates, onInput: boolean): CpmmSwap {
  let tradeFee: bigint, creatorFee = 0n, net: bigint
  if (onInput) {
    const total = ceilDiv(amountIn * (r.trade + r.creator), RATE_DENOMINATOR)
    creatorFee = r.trade + r.creator === 0n ? 0n : (total * r.creator) / (r.trade + r.creator)
    tradeFee = total - creatorFee
    net = amountIn - total
  } else {
    tradeFee = ceilDiv(amountIn * r.trade, RATE_DENOMINATOR)
    net = amountIn - tradeFee
  }
  const swapped = (net * reserveOut) / (reserveIn + net)
  if (!onInput) creatorFee = ceilDiv(swapped * r.creator, RATE_DENOMINATOR)
  const amountOut = onInput ? swapped : swapped - creatorFee
  return { amountIn, amountOut, tradeFee, ...cuts(tradeFee, r), creatorFee, creatorFeeOnInput: onInput, reserveInDelta: net, reserveOutDelta: swapped }
}

/** swap_base_output: the input that delivers exactly `amountOut`. */
export function swapBaseOutput(amountOut: bigint, reserveIn: bigint, reserveOut: bigint, r: CpmmRates, onInput: boolean): CpmmSwap {
  const swappedOut = onInput ? amountOut : grossUp(amountOut, r.creator)
  if (swappedOut >= reserveOut) throw new RangeError('the pool holds less than this swap needs')
  const swappedIn = ceilDiv(reserveIn * swappedOut, reserveOut - swappedOut)
  let tradeFee: bigint, creatorFee = swappedOut - amountOut, amountIn: bigint
  if (onInput) {
    amountIn = grossUp(swappedIn, r.trade + r.creator)
    const total = amountIn - swappedIn
    creatorFee = r.trade + r.creator === 0n ? 0n : (total * r.creator) / (r.trade + r.creator)
    tradeFee = total - creatorFee
  } else {
    amountIn = grossUp(swappedIn, r.trade)
    tradeFee = amountIn - swappedIn
  }
  return { amountIn, amountOut, tradeFee, ...cuts(tradeFee, r), creatorFee, creatorFeeOnInput: onInput, reserveInDelta: swappedIn, reserveOutDelta: swappedOut }
}

/** Tradable reserves: vault balances less the protocol, fund and creator fees the pool still holds. */
export type CpmmFeeCounters = {
  protocolFees0: bigint; protocolFees1: bigint
  fundFees0: bigint; fundFees1: bigint
  creatorFees0: bigint; creatorFees1: bigint
}
export const cpmmReserves = (vault0: bigint, vault1: bigint, c: CpmmFeeCounters) => ({
  reserve0: vault0 - c.protocolFees0 - c.fundFees0 - c.creatorFees0,
  reserve1: vault1 - c.protocolFees1 - c.fundFees1 - c.creatorFees1,
})

/**
 * What collect_creator_fee pays out of a booked creator fee: Raydium keeps floor(gross × share / 1e6),
 * the creator gets the rest. `shareRate` is the creator's own CreatorFeeShare when one exists, else
 * the AmmConfig's creator_fee_share_rate.
 */
export function creatorFeePayout(gross: bigint, shareRate: bigint) {
  const raydium = (gross * shareRate) / RATE_DENOMINATOR
  return { creator: gross - raydium, raydium }
}

/** LP-Lock's LockedCpLiquidityState fields that accrual reads. */
export type LockedLp = { lockedLpAmount: bigint; unclaimedLpAmount: bigint; lastLp: bigint; lastK: bigint }

/**
 * Fee LP a locked Fee Key can collect now: locked − locked·√lastK·lpSupply / (√k·lastLp), plus
 * what is already unclaimed, with k over the tradable reserves. It holds one LP unit back at each
 * integer root, so it never asks for more than LP-Lock's own collect pays.
 */
export function feeKeyAccrued(lock: LockedLp, lpSupply: bigint, reserve0: bigint, reserve1: bigint): bigint {
  if (lock.lastK === 0n || lock.lastLp === 0n) return lock.unclaimedLpAmount
  const now = isqrt(reserve0 * reserve1) * lock.lastLp, then = (isqrt(lock.lastK) + 1n) * lpSupply
  if (now <= then) return lock.unclaimedLpAmount
  const growth = (lock.lockedLpAmount * (now - then)) / now
  return lock.unclaimedLpAmount + (growth > 0n ? growth - 1n : 0n)
}

/** Tokens a withdrawal of `lp` returns, floored on each side. A side that floors to zero makes the withdraw fail. */
export const lpToTokens = (lp: bigint, lpSupply: bigint, reserve0: bigint, reserve1: bigint) => ({
  amount0: (lp * reserve0) / lpSupply,
  amount1: (lp * reserve1) / lpSupply,
})
