// Integer helpers the curve and pool quotes share: ceiling division, slippage bounds, the integer
// square root, and exact decimal text for prices. Rates everywhere are parts per million, the
// way Raydium stores them. No imports, so it runs in a browser as well as on a server.

export const RATE_DENOMINATOR = 1_000_000n

export const ceilDiv = (numerator: bigint, denominator: bigint) => (numerator + denominator - 1n) / denominator

export const minOf = (a: bigint, b: bigint) => (a < b ? a : b)

/** Amount before a fee at `rate` that leaves `net` after it (Raydium's pre-fee gross-up, rounded up). */
export function grossUp(net: bigint, rate: bigint): bigint {
  if (rate === 0n) return net
  if (rate >= RATE_DENOMINATOR) throw new RangeError('fee rate must be below 1,000,000')
  return ceilDiv(net * RATE_DENOMINATOR, RATE_DENOMINATOR - rate)
}

/** The least a trade should accept at `slippageBps`, rounded down. */
export const minimumOut = (amount: bigint, slippageBps: number) => (amount * BigInt(10_000 - slippageBps)) / 10_000n

/** The most a trade should pay at `slippageBps`, rounded up. */
export const maximumIn = (amount: bigint, slippageBps: number) => ceilDiv(amount * BigInt(10_000 + slippageBps), 10_000n)

/** Floor of the square root. */
export function isqrt(value: bigint): bigint {
  if (value < 2n) return value
  let x = value
  let next = (x + 1n) / 2n
  while (next < x) {
    x = next
    next = (x + value / x) / 2n
  }
  return x
}

/** numerator / denominator as decimal text, truncated to `precision` places, trailing zeros dropped. */
export function ratioText(numerator: bigint, denominator: bigint, precision = 18): string {
  const scale = 10n ** BigInt(precision)
  const scaled = (numerator * scale) / denominator
  const fraction = (scaled % scale).toString().padStart(precision, '0').replace(/0+$/, '')
  return fraction ? `${scaled / scale}.${fraction}` : `${scaled / scale}`
}

/** Price of one whole base token in whole quote tokens, from reserves in base units. */
export const priceText = (quoteReserve: bigint, baseReserve: bigint, baseDecimals: number, quoteDecimals: number, precision = 18) =>
  ratioText(quoteReserve * 10n ** BigInt(baseDecimals), baseReserve * 10n ** BigInt(quoteDecimals), precision)

/** Decimal text ("1.5") to base units, dropping digits past `decimals`. Never route settlement through Number. */
export function toUnits(text: string, decimals: number): bigint {
  const negative = text.startsWith('-')
  const [whole, fraction = ''] = text.replace(/^-/, '').split('.')
  const units = BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0').slice(0, decimals) || '0')
  return negative ? -units : units
}

/** Base units to decimal text with every place shown ("1.500000000"). */
export function formatUnits(units: bigint, decimals: number): string {
  const sign = units < 0n ? '-' : ''
  const digits = (units < 0n ? -units : units).toString().padStart(decimals + 1, '0')
  return decimals ? `${sign}${digits.slice(0, -decimals)}.${digits.slice(-decimals)}` : `${sign}${digits}`
}
