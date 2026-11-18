// Numbers at the SDK boundary: bigint inside the engine, BN inside Meteora's SDKs, and the
// Q64.64 sqrt prices both venues store, turned into an exact price.

import BN from 'bn.js'

export const U64_MAX = 0xffff_ffff_ffff_ffffn

export function bn(value: bigint): BN {
  if (value < 0n || value > U64_MAX) throw new RangeError('Amounts are u64.')
  return new BN(value.toString())
}

export const big = (value: BN) => BigInt(value.toString())

export function checkSlippage(bps: number) {
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) throw new RangeError('Slippage is an integer from 0 to 10000 bps.')
}

const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? a : gcd(b, a % b))

/** A Q64.64 sqrt price as quote atoms per whole base token, exactly: sqrt² · 10^baseDecimals / 2^128. */
export function spotPrice(sqrtPrice: bigint, baseDecimals: number): { numerator: bigint; denominator: bigint } {
  const numerator = sqrtPrice * sqrtPrice * 10n ** BigInt(baseDecimals)
  const denominator = 1n << 128n
  const d = gcd(numerator, denominator) || 1n
  return { numerator: numerator / d, denominator: denominator / d }
}
