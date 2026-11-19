// Formatting helpers for on-chain values, amounts, and addresses.

export type MoneyLike = { amount: string; decimals: number; symbol: string }

// Base units to a decimal string with at most `max` places, trailing zeros dropped, thousands grouped.
export function units(amount: string | bigint, decimals: number, max = 6): string {
  const v = BigInt(amount)
  const neg = v < 0n
  const a = neg ? -v : v
  const base = 10n ** BigInt(decimals)
  const whole = a / base
  let frac = (a % base).toString().padStart(decimals, '0').slice(0, max).replace(/0+$/, '')
  if (!frac && whole === 0n && a > 0n) frac = (a % base).toString().padStart(decimals, '0').replace(/0+$/, '')
  return `${neg ? '-' : ''}${group(whole.toString())}${frac ? '.' + frac : ''}`
}
export const money = (m: MoneyLike) => units(m.amount, m.decimals)
export const sol = (lamports: string | bigint) => units(lamports, 9)

export function group(n: string | number | bigint): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

export function bytes(n: number): { value: string; unit: string } {
  if (n < 1024) return { value: group(n), unit: 'B' }
  if (n < 1024 * 1024) return { value: (n / 1024).toFixed(n < 10240 ? 2 : 1), unit: 'KB' }
  return { value: (n / 1024 / 1024).toFixed(2), unit: 'MB' }
}

export const bps = (b: number) => `${(b / 100).toFixed(b % 100 === 0 ? 0 : 2)}%`
export const short = (s: string, n = 4) => (s.length > 2 * n + 1 ? `${s.slice(0, n)}…${s.slice(-n)}` : s)
export const hardware = (h: string) => (h === 'tdx' ? 'Intel TDX' : h === 'sev-snp' ? 'AMD SEV-SNP' : 'dev')

export function b64ToBytes(b64: string): Uint8Array {
  if (typeof atob === 'function') {
    const s = atob(b64)
    const out = new Uint8Array(s.length)
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
    return out
  }
  return new Uint8Array(Buffer.from(b64, 'base64'))
}
