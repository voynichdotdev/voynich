// LaunchLab's constant-product bonding curve in integer math, rounded the way the program rounds:
// the launch's virtual reserves, the four trades with the full fee stack, the capped last buy,
// the buy that finishes the curve, spot price and price impact. Pure bigint, so one quote runs
// the same in a browser, an API and a keeper.

import { RATE_DENOMINATOR, ceilDiv, grossUp, minOf } from './math.js'

/** What shapes a curve: initialize_v2's ConstantCurve, the vesting lock, the GlobalConfig's migrate fee. */
export type CurveParams = {
  supply: bigint
  totalBaseSell: bigint
  totalQuoteFundRaising: bigint
  totalLockedAmount?: bigint
  migrateFee?: bigint
}

/** The PoolState fields a quote reads. `realBase` counts tokens sold off the curve, not the base vault's balance. */
export type CurveState = {
  virtualBase: bigint
  virtualQuote: bigint
  realBase: bigint
  realQuote: bigint
  totalBaseSell: bigint
}

/** Parts per million: GlobalConfig trade_fee_rate, PlatformConfig fee_rate and creator_fee_rate, the trade's share_fee_rate. */
export type CurveFeeRates = { protocol: bigint; platform: bigint; creator: bigint; share?: bigint }

export type CurveFees = { total: bigint; protocol: bigint; platform: bigint; creator: bigint; share: bigint }

export type CurveQuote = {
  side: 'buy' | 'sell'
  exactIn: boolean
  /** Base tokens leaving the curve on a buy, entering it on a sell. */
  base: bigint
  /** Quote the trader pays on a buy or receives on a sell, fees settled. */
  quote: bigint
  /** Quote that moves the curve: a buy's input after fees, a sell's output before fees. */
  curveQuote: bigint
  fees: CurveFees
  /** The buy reached the end of the curve and was cut to the base left for sale. */
  capped: boolean
  after: CurveState
}

/** Virtual reserves the program derives at launch (Raydium's getInitParam, integer for integer). */
export function initialReserves(p: CurveParams): { virtualBase: bigint; virtualQuote: bigint } {
  const migrateBase = p.supply - p.totalBaseSell - (p.totalLockedAmount ?? 0n)
  const raised = p.totalQuoteFundRaising - (p.migrateFee ?? 0n)
  if (migrateBase <= 0n) throw new RangeError('supply must exceed the base sold plus the base locked')
  if (raised <= 0n) throw new RangeError('the raise must exceed the migrate fee')
  const denominator = (raised * p.totalBaseSell) / migrateBase - p.totalQuoteFundRaising
  if (denominator <= 0n) throw new RangeError('these launch parameters describe no curve')
  return {
    virtualBase: (raised * p.totalBaseSell * p.totalBaseSell) / migrateBase / denominator,
    virtualQuote: (p.totalQuoteFundRaising * p.totalQuoteFundRaising) / denominator,
  }
}

/** A fresh pool's state, before any trade. */
export const launchState = (p: CurveParams): CurveState => ({ ...initialReserves(p), realBase: 0n, realQuote: 0n, totalBaseSell: p.totalBaseSell })

/** The reserves the constant product runs on. */
export const curveReserves = (s: CurveState) => ({ base: s.virtualBase - s.realBase, quote: s.virtualQuote + s.realQuote })

export const baseLeft = (s: CurveState) => s.totalBaseSell - s.realBase

export function totalFeeRate(r: CurveFeeRates): bigint {
  const rate = r.protocol + r.platform + r.creator + (r.share ?? 0n)
  if (rate >= RATE_DENOMINATOR) throw new RangeError('the fee rates add up to 100% or more')
  return rate
}

/** LaunchLab rounds the combined fee up once, floors each non-protocol share, and leaves the rest to the protocol. */
export function splitFees(total: bigint, r: CurveFeeRates): CurveFees {
  const rate = totalFeeRate(r)
  const part = (x: bigint) => (rate === 0n ? 0n : (total * x) / rate)
  const platform = part(r.platform), creator = part(r.creator), share = part(r.share ?? 0n)
  return { total, protocol: total - platform - creator - share, platform, creator, share }
}

const quoteOf = (side: 'buy' | 'sell', exactIn: boolean, base: bigint, quote: bigint, curveQuote: bigint, total: bigint, r: CurveFeeRates, s: CurveState, capped = false): CurveQuote => {
  if (side === 'buy' && baseLeft(s) <= 0n) throw new RangeError('the curve is sold out')
  if (base <= 0n || quote <= 0n) throw new RangeError('the amount is too small to trade')
  const after = side === 'buy'
    ? { ...s, realBase: s.realBase + base, realQuote: s.realQuote + curveQuote }
    : { ...s, realBase: s.realBase - base, realQuote: s.realQuote - curveQuote }
  return { side, exactIn, base, quote, curveQuote, fees: splitFees(total, r), capped, after }
}

/**
 * Spend `quoteIn`. A buy larger than the base left for sale is cut to that base and charged only
 * what it costs: the program's capped last buy, which is what moves the pool to status Migrate.
 */
export function buyExactIn(s: CurveState, quoteIn: bigint, r: CurveFeeRates): CurveQuote {
  const rate = totalFeeRate(r), { base, quote } = curveReserves(s)
  const total = ceilDiv(quoteIn * rate, RATE_DENOMINATOR), net = quoteIn - total
  const out = (net * base) / (quote + net)
  if (out <= baseLeft(s)) return quoteOf('buy', true, out, quoteIn, net, total, r, s)
  const capNet = ceilDiv(quote * baseLeft(s), base - baseLeft(s)), paid = grossUp(capNet, rate)
  return quoteOf('buy', true, baseLeft(s), paid, capNet, paid - capNet, r, s, true)
}

/** Receive `baseOut` (cut to the base left for sale). */
export function buyExactOut(s: CurveState, baseOut: bigint, r: CurveFeeRates): CurveQuote {
  const rate = totalFeeRate(r), { base, quote } = curveReserves(s), out = minOf(baseOut, baseLeft(s))
  const net = ceilDiv(quote * out, base - out), paid = grossUp(net, rate)
  return quoteOf('buy', false, out, paid, net, paid - net, r, s, out < baseOut)
}

/** Sell `baseIn`; fees come out of the quote it returns. */
export function sellExactIn(s: CurveState, baseIn: bigint, r: CurveFeeRates): CurveQuote {
  const rate = totalFeeRate(r), { base, quote } = curveReserves(s)
  const gross = (baseIn * quote) / (base + baseIn), total = ceilDiv(gross * rate, RATE_DENOMINATOR)
  return quoteOf('sell', true, baseIn, gross - total, gross, total, r, s)
}

/** Receive `quoteOut` after fees. Throws when the curve holds less quote, or fewer sold tokens, than that needs. */
export function sellExactOut(s: CurveState, quoteOut: bigint, r: CurveFeeRates): CurveQuote {
  const rate = totalFeeRate(r), { base, quote } = curveReserves(s), gross = grossUp(quoteOut, rate)
  if (gross > s.realQuote) throw new RangeError('the curve holds less quote than this sale needs')
  const baseIn = ceilDiv(base * gross, quote - gross)
  if (baseIn > s.realBase) throw new RangeError('this sale needs more tokens than the curve has sold')
  return quoteOf('sell', false, baseIn, quoteOut, gross, gross - quoteOut, r, s)
}

/**
 * The input that buys every token left for sale, so the pool completes (status Migrate) and waits
 * for the migration crank. The curve completes when its base is sold out, not when realQuote
 * reaches totalQuoteFundRaising: rounded buys and sells move the cost away from the nominal raise.
 * One extra quote unit before the gross-up keeps the rounded fee from leaving the buy a unit short,
 * so it takes the capped branch and is charged only the exact cost.
 */
export function completionQuote(s: CurveState, r: CurveFeeRates): { base: bigint; quote: bigint } {
  const left = baseLeft(s)
  if (left <= 0n) return { base: 0n, quote: 0n }
  const { base, quote } = curveReserves(s)
  return { base: left, quote: grossUp(ceilDiv(quote * left, base - left) + 1n, totalFeeRate(r)) }
}

/** Spot price as a ratio of quote units to base units. */
export const spotPrice = (s: CurveState) => {
  const { base, quote } = curveReserves(s)
  return { quote, base }
}

/** How far a trade's pre-fee execution price sits from the spot price before it, in basis points. */
export function priceImpactBps(s: CurveState, q: Pick<CurveQuote, 'base' | 'curveQuote'>): number {
  const { base, quote } = curveReserves(s)
  const ideal = q.base * quote, actual = q.curveQuote * base
  return Number(((actual > ideal ? actual - ideal : ideal - actual) * 10_000n) / ideal)
}

/** Share of the curve sold, in basis points. */
export const progressBps = (s: CurveState) => Number((s.realBase * 10_000n) / s.totalBaseSell)
