import { PublicKey, type Connection } from '@solana/web3.js'
import { unpackMint, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { decodeManifest } from '@voynich/contract'
import type { DecodedTransaction } from '../engines/indexer/decoder.js'
import type { Json } from '../engines/indexer/fields.js'

export type EventFact = { name: string; data: Record<string, Json> }
export type Facts = { events: EventFact[]; weights: { address: string; size: string; written: string }[]; mints: { mint: string; decimals: number; symbol: string }[]; addresses: string[]; issues: string[] }
const camel = (name: string) => name.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
const normalize = (value: Json): Json => Array.isArray(value) ? value.map(normalize) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [camel(key), normalize(item)])) : value
export const eventName = (name: string) => name.replaceAll('_', '').toLowerCase()
export const text = (data: Record<string, Json>, key: string) => data[key] as string
export const bytes = (data: Record<string, Json>, key: string) => Uint8Array.from(data[key] as number[])
export const hex = (data: Record<string, Json>, key: string) => Buffer.from(bytes(data, key)).toString('hex')
export const mint = (value: string) => value === PublicKey.default.toBase58() ? null : value

/** Facts and immutable account metadata are collected before the engine opens its apply transaction. */
export function createFacts(connection: Connection) {
  return async (transaction: DecodedTransaction): Promise<Facts> => {
    const facts: Facts = { events: transaction.events.filter(event => event.source === 'cpi').map(event => ({ name: eventName(event.name), data: normalize(event.data) as Record<string, Json> })), weights: [], mints: [], addresses: [], issues: transaction.issues.map(issue => `${issue.code}: ${issue.message}`) }
    if (transaction.failed) return { ...facts, events: [] }
    const weights = new Set<string>()
    const mints = new Set<string>()
    for (const event of facts.events) {
      if (event.name === 'modelcreated') {
        event.data.manifestBytes = event.data.manifest!
        const manifest = new TextDecoder().decode(bytes(event.data, 'manifest'))
        try { event.data.manifest = decodeManifest(manifest) as unknown as Json }
        catch { event.data.manifest = manifest; event.data.indexingIssue = 'The on-chain model manifest is invalid.'; transaction.issues.push({ code: 'INVALID_MANIFEST', message: `Invalid manifest on ${String(event.data.model)}.` }) }
        for (const address of event.data.weights as string[]) weights.add(address)
      } else if (event.name === 'weightsattached') {
        for (const address of event.data.weights as string[]) weights.add(address)
      }
      for (const key of ['model', 'enclave', 'call', 'receipt', 'record', 'grant', 'weights', 'uploadKey', 'bounty', 'attempt', 'measurement', 'policy']) {
        const value = event.data[key]
        if (typeof value === 'string' && value !== PublicKey.default.toBase58()) facts.addresses.push(value)
      }
      const priceMint = event.data.priceMint
      if (typeof priceMint === 'string' && mint(priceMint)) mints.add(priceMint)
      const bountyMint = event.data.mint
      if (typeof bountyMint === 'string' && mint(bountyMint)) mints.add(bountyMint)
    }
    if (weights.size) {
      const keys = [...weights]
      const accounts = await connection.getMultipleAccountsInfo(keys.map(value => new PublicKey(value)), { commitment: 'confirmed', minContextSlot: transaction.slot })
      for (let index = 0; index < keys.length; index++) {
        const account = accounts[index]
        if (!account || account.data.length < 56) throw new Error('The created weights account is unavailable.')
        facts.weights.push({ address: keys[index]!, size: String(account.data.length - 56), written: String(account.data.readUInt32LE(48)) })
      }
    }
    for (const address of mints) {
      const key = new PublicKey(address)
      const account = await connection.getAccountInfo(key, { commitment: 'confirmed', minContextSlot: transaction.slot })
      try {
        const value = unpackMint(key, account, TOKEN_PROGRAM_ID)
        facts.mints.push({ mint: address, decimals: value.decimals, symbol: address })
      } catch {
        for (const event of facts.events) if (event.data.priceMint === address) event.data.indexingIssue = 'The on-chain price mint is not an initialized SPL mint.'
        transaction.issues.push({ code: 'INVALID_PRICE_MINT', message: `Invalid price mint ${address}.` })
      }
    }
    facts.addresses = [...new Set([...facts.addresses, ...weights])]
    return facts
  }
}
