// Account reads in pages of 100 (getMultipleAccounts' limit) through the paced call, with data as
// bytes and lamports as BigInt, so the money boundary never rounds.

import { fromBase64 } from '../core/encoding.js'
import type { Rpc } from './client.js'
import { toU64 } from './json.js'

export type Account = { address: string; owner: string; lamports: bigint; executable: boolean; data: Uint8Array }

type Raw = { data: [string, string]; owner: string; lamports: number | string; executable: boolean } | null

const decode = (address: string, raw: Raw): Account | null =>
  raw && { address, owner: raw.owner, lamports: toU64(raw.lamports), executable: raw.executable, data: fromBase64(raw.data[0]) }

export async function getAccounts(rpc: Pick<Rpc, 'call'>, addresses: readonly string[], commitment = 'confirmed'): Promise<(Account | null)[]> {
  const out: (Account | null)[] = []
  for (let i = 0; i < addresses.length; i += 100) {
    const page = addresses.slice(i, i + 100)
    const { value } = await rpc.call<{ value: Raw[] }>('getMultipleAccounts', [page, { encoding: 'base64', commitment }])
    if (value.length !== page.length) throw new Error(`getMultipleAccounts answered ${value.length} accounts for ${page.length} addresses.`)
    out.push(...value.map((raw, j) => decode(page[j]!, raw)))
  }
  return out
}

export async function getAccount(rpc: Pick<Rpc, 'call'>, address: string, commitment = 'confirmed'): Promise<Account | null> {
  const { value } = await rpc.call<{ value: Raw }>('getAccountInfo', [address, { encoding: 'base64', commitment }])
  return decode(address, value)
}
