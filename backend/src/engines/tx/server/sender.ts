// Helius Sender as the broadcast path: staked routing for transactions the server sends (keepers,
// relayed user transactions). The tip and a positive compute-unit price are part of the signed
// bytes, so they go in before anyone signs, and a wallet's recompile must keep them.

import { ComputeBudgetProgram, PublicKey, SystemProgram, TransactionMessage, type AddressLookupTableAccount, type TransactionInstruction, type VersionedTransaction } from '@solana/web3.js'
import { randomInt } from 'node:crypto'
import { toBase58 } from '../../core/encoding.js'
import type { Broadcast } from './send.js'

/** Sender's designated tip accounts (helius.dev/docs/sending-transactions/sender). */
export const SENDER_TIP_ACCOUNTS = [
  '4ACfpUFoaSD9bfPdeu6DBt89gB6ENTeHBXCAi87NhDEE',
  'D2L6yPZ2FmmmTKPgzaMKdhu6EWZcTpLy1Vhx8uvZe7NZ',
  '9bnz4RShgq1hAnLnZbP8kbgBg1kEmcJBYQq3gQbmnSta',
  '5VY91ws6B2hMmBFRsXkoAAdsPHBJwRfBht4DXox3xkwn',
  '2nyhqdwKcJZR2vcqCyrYsaPVdAnFoJjiksCXJ7hfEYgD',
  '2q5pghRs6arqVjRvT5gfgWfWcHWmw1ZuCzphgd5KfWGJ',
  'wyvPkWjVZz1M8fHQnMMCDTQDbkManefNNhweYk5WkcF',
  '3KCKozbAaF75qEU33jtzozcJ29yJuaLJTy2jFdzUY8bT',
  '4vieeGHPYPG2MmyPRcYjdiDmmhN3ww7hsFNap8pVN3Ey',
  '4TQLFNWK8AovT1gFvda5jfw2oJeRMKEmw7aH6MGBJ3or',
].map((a) => new PublicKey(a))

export type SenderConfig = {
  /** e.g. https://sender.helius-rpc.com/fast?swqos_only=true */
  url: string
  apiKey?: string
  tipLamports: bigint
  microLamports: bigint
}

/** SWQoS-only routing takes a 5,000-lamport tip; full Sender routing takes 1,000,000. */
export function checkSenderConfig(config: SenderConfig): URL {
  const url = new URL(config.url)
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('The Sender URL must be HTTPS without credentials.')
  const swqosOnly = url.searchParams.get('swqos_only') === 'true'
  const minimum = swqosOnly ? 5_000n : 1_000_000n
  if (config.tipLamports < minimum) throw new Error(`Sender${swqosOnly ? ' (SWQoS-only)' : ''} needs a tip of at least ${minimum} lamports.`)
  if (config.microLamports <= 0n) throw new Error('Sender needs a positive compute-unit price.')
  if (config.apiKey) url.searchParams.set('api-key', config.apiKey)
  return url
}

/** The tip transfer to add to the build, paid by the fee payer. */
export function senderTip(payer: PublicKey, config: SenderConfig): TransactionInstruction {
  return SystemProgram.transfer({ fromPubkey: payer, toPubkey: SENDER_TIP_ACCOUNTS[randomInt(SENDER_TIP_ACCOUNTS.length)]!, lamports: config.tipLamports })
}

/** Whether a (possibly wallet-recompiled) transaction still carries the tip and the price. */
export function keepsSenderFees(tx: VersionedTransaction, tables: readonly AddressLookupTableAccount[], config: SenderConfig): boolean {
  const message = TransactionMessage.decompile(tx.message, { addressLookupTableAccounts: [...tables] })
  const tip = message.instructions.some(
    (ix) =>
      ix.programId.equals(SystemProgram.programId) &&
      ix.data.length === 12 &&
      ix.data.readUInt32LE(0) === 2 && // SystemInstruction::Transfer
      ix.keys[0]?.pubkey.equals(message.payerKey) &&
      SENDER_TIP_ACCOUNTS.some((a) => ix.keys[1]?.pubkey.equals(a)) &&
      ix.data.readBigUInt64LE(4) >= config.tipLamports,
  )
  const price = message.instructions.some(
    (ix) => ix.programId.equals(ComputeBudgetProgram.programId) && ix.data.length === 9 && ix.data[0] === 3 && ix.data.readBigUInt64LE(1) >= config.microLamports,
  )
  return tip && price
}

/** A Broadcast for send.ts. Retries go to the same URL with the same bytes. */
export function senderBroadcast(config: SenderConfig, fetchImpl: typeof fetch = fetch): Broadcast {
  const url = checkSenderConfig(config)
  return async (bytes) => {
    const id = toBase58(bytes.subarray(1, 65)) // the payer's signature, first in the wire format
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method: 'sendTransaction', params: [Buffer.from(bytes).toString('base64'), { encoding: 'base64', skipPreflight: true, maxRetries: 0 }] }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) throw new Error(`Sender HTTP ${response.status}`)
    const body = (await response.json()) as { result?: string; error?: { code?: number; message?: string } }
    if (!body.result) throw new Error(`Sender refused the transaction (${body.error?.code ?? 'no result'}).`)
    return body.result
  }
}
