// The venue SDKs' math is the quote boundary. Their refusals become three answers a trader can
// act on: the amount is too small, the curve is complete, or the pool cannot quote right now.

export type QuoteErrorCode = 'QUOTE_TOO_SMALL' | 'CURVE_COMPLETE' | 'QUOTE_UNAVAILABLE'

export class QuoteError extends Error {
  constructor(
    readonly code: QuoteErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'QuoteError'
  }
}

export const curveComplete = () =>
  new QuoteError('CURVE_COMPLETE', 'This curve is complete and moving to its graduated pool. Refresh in a moment to trade there.')

export const tooSmall = () =>
  new QuoteError('QUOTE_TOO_SMALL', 'This amount produces no output after fees and slippage. Increase the amount or lower the slippage, then quote again.')

export function quoteMath<T>(calculate: () => T): T {
  try {
    return calculate()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/Pool is completed/.test(message)) throw curveComplete()
    if (/Amount is zero|Amount cannot be zero|Amount (in|out) must be greater than 0|division by zero|Assertion failed/i.test(message)) throw tooSmall()
    throw new QuoteError('QUOTE_UNAVAILABLE', 'The pool cannot quote this amount now. Reduce the amount or wait for the pool to open, then quote again.')
  }
}
