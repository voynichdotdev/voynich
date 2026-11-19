// Byte encodings that behave the same in the browser and on Node, with no dependencies.
// Wallets hand back raw bytes; APIs move transactions as base64 and keys/signatures as base58.

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const INDEX = new Map([...ALPHABET].map((c, i) => [c, i]))

/** base64 of any length (a loop rather than spreading the bytes into one call). */
export function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!)
  return btoa(s)
}

export function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0))
}

export function toBase58(bytes: Uint8Array): string {
  let n = 0n
  for (const b of bytes) n = n * 256n + BigInt(b)
  let s = ''
  while (n > 0n) {
    s = ALPHABET[Number(n % 58n)] + s
    n /= 58n
  }
  for (const b of bytes) {
    if (b !== 0) break
    s = '1' + s
  }
  return s
}

export function fromBase58(text: string): Uint8Array {
  let n = 0n
  for (const c of text) {
    const v = INDEX.get(c)
    if (v === undefined) throw new Error(`not base58: ${c}`)
    n = n * 58n + BigInt(v)
  }
  const out: number[] = []
  while (n > 0n) {
    out.unshift(Number(n % 256n))
    n /= 256n
  }
  for (const c of text) {
    if (c !== '1') break
    out.unshift(0)
  }
  return Uint8Array.from(out)
}

/** First and last characters of an address, the way every screen prints it. */
export const shortAddress = (a: string, n = 4) => (a.length > 2 * n + 1 ? `${a.slice(0, n)}…${a.slice(-n)}` : a)
