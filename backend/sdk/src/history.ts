import type { Connection, PublicKey } from '@solana/web3.js'
import type { Program } from '@coral-xyz/anchor'
import type { Attest } from './generated/attest.js'
import type { Voynich } from './generated/voynich.js'
import { eventAccounts, normalizeLegacyVoynichEvent } from './program.js'
import { fromBase58, type Receipt } from '@voynich/contract'
import { toBase64, toHex } from './crypto.js'

type RawInstruction = { programIdIndex: number; accounts: number[]; data: string; stackHeight?: number }
type RawTransaction = { slot: number; transaction: { message: { accountKeys: string[]; instructions: RawInstruction[] } }; meta: { err: unknown; loadedAddresses?: { writable: string[]; readonly: string[] }; innerInstructions?: { index: number; instructions: RawInstruction[] }[] } }

/** A pasted transaction signature must prove this receipt's settlement, not merely exist. */
export async function transactionSettledReceipt(connection: Connection, voynich: Program<Voynich>, signature: string, receipt: Receipt, fetcher: typeof fetch, signal?: AbortSignal): Promise<boolean> {
  const response = await fetcher(connection.rpcEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTransaction', params: [signature, { encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 1 }] }) })
  if (!response.ok) throw new Error('The RPC could not read the settlement transaction')
  const body = await response.json() as { error?: unknown; result?: RawTransaction | null }
  if (body.error || !body.result) throw new Error('The RPC did not retain the settlement transaction')
  const tx = body.result
  if (!tx.transaction?.message || !tx.meta || tx.meta.err !== null || !Array.isArray(tx.transaction.message.accountKeys) || BigInt(tx.slot) !== BigInt(receipt.slot)) return false
  const keys = [...tx.transaction.message.accountKeys, ...(tx.meta.loadedAddresses?.writable ?? []), ...(tx.meta.loadedAddresses?.readonly ?? [])]
  const authority = eventAccounts(voynich.programId).eventAuthority.toBase58()
  for (const group of tx.meta.innerInstructions ?? []) {
    const outer = tx.transaction.message.instructions[group.index]
    if (!outer) throw new Error('Invalid settlement inner-instruction group')
    const parents = new Map<number, string>([[1, keys[outer.programIdIndex]!]])
    for (const instruction of group.instructions) {
      const level = instruction.stackHeight
      if (level === undefined || level < 2) throw new Error('Settlement RPC evidence omits CPI stack heights')
      const program = keys[instruction.programIdIndex], parent = parents.get(level - 1)
      parents.set(level, program!)
      for (const depth of parents.keys()) if (depth > level) parents.delete(depth)
      if (program !== voynich.programId.toBase58() || parent !== program || keys[instruction.accounts[0]!] !== authority) continue
      const bytes = fromBase58(instruction.data)
      if (toHex(bytes.subarray(0, 8)) !== 'e445a52e51cb9a1d') continue
      const event = voynich.coder.events.decode(toBase64(normalizeLegacyVoynichEvent(bytes.subarray(8))))
      if (!event || event.name !== 'callSettled') continue
      const data = event.data as { receipt: PublicKey; call: PublicKey; model: PublicKey; enclave: PublicKey; inputHash: number[]; outputHash: number[]; signature: number[]; slot: { toString(): string } }
      if (data.receipt.toBase58() === receipt.address && data.call.toBase58() === receipt.call && data.model.toBase58() === receipt.model && data.enclave.toBase58() === receipt.enclave && toHex(Uint8Array.from(data.inputHash)) === receipt.inputHash && toHex(Uint8Array.from(data.outputHash)) === receipt.outputHash && toBase64(Uint8Array.from(data.signature)) === receipt.signature && data.slot.toString() === receipt.slot) return true
    }
  }
  return false
}
/** Reads successful, authenticated self-CPI RecordUpdated events; log text is never evidence. */
export async function historicalAttestation(connection: Connection, attest: Program<Attest>, record: PublicKey, atSlot: bigint, fetcher: typeof fetch) {
  let before: string | undefined
  const authority = eventAccounts(attest.programId).eventAuthority.toBase58()
  for (;;) {
    const signatures = await connection.getSignaturesForAddress(record, { before, limit: 100 }, 'confirmed')
    if (!signatures.length) throw new Error('The RPC has no retained attestation history for this receipt')
    for (const signature of signatures) {
      if (signature.err || BigInt(signature.slot) > atSlot) continue
      const response = await fetcher(connection.rpcEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTransaction', params: [signature.signature, { encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 1 }] }) })
      if (!response.ok) throw new Error('The RPC could not read historical attestation evidence')
      const body = await response.json() as { error?: unknown; result?: RawTransaction | null }
      if (body.error || !body.result) throw new Error('The RPC did not retain a required attestation transaction')
      const tx = body.result
      if (!tx.transaction?.message || !tx.meta || tx.meta.err || !Array.isArray(tx.transaction.message.accountKeys)) throw new Error('Invalid attestation transaction from RPC')
      const keys = [...tx.transaction.message.accountKeys, ...(tx.meta.loadedAddresses?.writable ?? []), ...(tx.meta.loadedAddresses?.readonly ?? [])]
      const found: { signingKey: PublicKey; hardwareType: 'dev' | 'tdx' | 'sev-snp'; measurement: string; recordedSlot: bigint; expiresAtSlot: bigint; reportSlot: bigint; layoutVersion: number }[] = []
      for (const group of tx.meta.innerInstructions ?? []) {
        const outer = tx.transaction.message.instructions[group.index]
        if (!outer) throw new Error('Invalid historical inner-instruction group')
        const parents = new Map<number, string>([[1, keys[outer.programIdIndex]!]])
        for (const instruction of group.instructions) {
          const level = instruction.stackHeight
          if (level === undefined || level < 2) throw new Error('Historical RPC evidence omits CPI stack heights')
          const program = keys[instruction.programIdIndex]
          const parent = parents.get(level - 1)
          parents.set(level, program!)
          for (const depth of parents.keys()) if (depth > level) parents.delete(depth)
          if (program !== attest.programId.toBase58() || parent !== program || keys[instruction.accounts[0]!] !== authority) continue
          const bytes = fromBase58(instruction.data)
          if (toHex(bytes.subarray(0, 8)) !== 'e445a52e51cb9a1d') continue
          const event = attest.coder.events.decode(toBase64(bytes.subarray(8)))
          if (!event || event.name !== 'recordUpdated') continue
          const data = event.data as { record: PublicKey; signingKey: PublicKey; hardwareType: number; measurement: number[]; recordedSlot: { toString(): string }; expiresAtSlot: { toString(): string }; reportSlot: { toString(): string } }
          if (!data.record.equals(record) || data.hardwareType > 2) continue
          const recordedSlot = BigInt(data.recordedSlot.toString())
          if (recordedSlot > atSlot || recordedSlot !== BigInt(tx.slot)) continue
          found.push({ layoutVersion: 1, signingKey: data.signingKey, hardwareType: (['dev', 'tdx', 'sev-snp'] as const)[data.hardwareType]!, measurement: toHex(Uint8Array.from(data.measurement)), recordedSlot, expiresAtSlot: BigInt(data.expiresAtSlot.toString()), reportSlot: BigInt(data.reportSlot.toString()) })
        }
      }
      if (found.length) return found[found.length - 1]!
    }
    before = signatures[signatures.length - 1]!.signature
  }
}
