import { ComputeBudgetProgram, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage } from '@solana/web3.js'
import { ATTACH_WEIGHTS_BATCH, DEFAULT_UPLOAD_KEYS, INITIAL_CREATE_WEIGHTS, MODEL_ACCOUNT_BYTES, SEAL_RANGE_CHUNKS, WRITE_CHUNK_BYTES, type ModelCostQuote, type ModelCostRequest } from '@voynich/contract'
import { CIPHER_CHUNK_BYTES, sha256, utf8 } from 'voynich/crypto'
import { MAX_COMPUTE_UNITS } from '../engines/tx/server/build.js'
import type { ChainRuntime } from '../runtime.js'
import { fail } from './errors.js'
import { loadLookupTables } from '../engines/tx/server/lookup-tables.js'
import { createModelFootprint } from './create-model.js'

const WEIGHTS_HEADER_BYTES = 56
const WEIGHTS_PAYLOAD_BYTES = 10 * 1024 * 1024 - WEIGHTS_HEADER_BYTES
// Public placeholders only: fee quotation never signs, simulates or broadcasts.
const key = (label: string) => new PublicKey(sha256(utf8(`voynich/cost-quote/${label}`)))
const owner = key('owner'), uploadKey = key('upload-key')

export async function quoteModelCost(runtime: ChainRuntime, request: ModelCostRequest): Promise<ModelCostQuote> {
  const { sizeBytes } = request
  const connection = runtime.rpc.connection
  const count = Math.ceil(sizeBytes / WEIGHTS_PAYLOAD_BYTES)
  const parts = Array.from({ length: count }, (_, index) => ({ index, payloadBytes: Math.min(WEIGHTS_PAYLOAD_BYTES, sizeBytes - index * WEIGHTS_PAYLOAD_BYTES) }))
  const [latest, modelRent, uploadMinimum, weightsRent] = await Promise.all([
    connection.getLatestBlockhashAndContext('confirmed'),
    connection.getMinimumBalanceForRentExemption(MODEL_ACCOUNT_BYTES, 'confirmed'),
    connection.getMinimumBalanceForRentExemption(0, 'confirmed'),
    Promise.all(parts.map(part => connection.getMinimumBalanceForRentExemption(part.payloadBytes + WEIGHTS_HEADER_BYTES, 'confirmed'))),
  ])
  const lamports = (value: unknown): bigint => {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) fail('UPSTREAM_UNAVAILABLE', 'The RPC returned an invalid lamport amount.', { retryable: true })
    return BigInt(value)
  }
  async function fee(instructions: TransactionInstruction[], payer: PublicKey) {
    const message = new TransactionMessage({ payerKey: payer, recentBlockhash: latest.value.blockhash, instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: MAX_COMPUTE_UNITS }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 0 }), ...instructions,
    ] }).compileToV0Message()
    const result = await connection.getFeeForMessage(message, 'confirmed')
    if (result.value === null) fail('UPSTREAM_UNAVAILABLE', 'The RPC did not return a transaction fee.', { retryable: true })
    return { lamports: lamports(result.value), signatures: message.header.numRequiredSignatures }
  }
  // With the API's zero priority price, the required signatures determine these fees.
  const transfer = (fromPubkey: PublicKey, toPubkey: PublicKey) => SystemProgram.transfer({ fromPubkey, toPubkey, lamports: 0 })
  const [allocation, create, write, seal] = await Promise.all([
    fee([SystemProgram.createAccount({ fromPubkey: owner, newAccountPubkey: key('weights'), lamports: 0, space: parts[0]!.payloadBytes + WEIGHTS_HEADER_BYTES, programId: runtime.programId })], owner),
    fee([new TransactionInstruction({ programId: runtime.programId, keys: [{ pubkey: owner, isSigner: true, isWritable: true }, { pubkey: uploadKey, isSigner: true, isWritable: true }], data: Buffer.alloc(0) })], owner),
    fee([new TransactionInstruction({ programId: runtime.programId, keys: [{ pubkey: uploadKey, isSigner: true, isWritable: true }], data: Buffer.alloc(0) })], uploadKey),
    fee([transfer(uploadKey, owner)], owner),
  ])
  const uploadKeyCount = request.uploadKeyCount ?? request.create?.uploadKeys?.length ?? DEFAULT_UPLOAD_KEYS
  const weights = parts.map((part, index) => ({ ...part, accountBytes: part.payloadBytes + WEIGHTS_HEADER_BYTES, rentLamports: lamports(weightsRent[index]).toString(), writeCount: Math.ceil(part.payloadBytes / WRITE_CHUNK_BYTES) }))
  const writeCount = weights.reduce((total, part) => total + part.writeCount, 0)
  const weightsRentLamports = weights.reduce((total, part) => total + BigInt(part.rentLamports), 0n)
  const modelRentLamports = lamports(modelRent), uploadKeyMinimumLamports = lamports(uploadMinimum)
  const allocationFeesLamports = allocation.lamports * BigInt(weights.length)
  const attachWeightsCount = weights.length > INITIAL_CREATE_WEIGHTS ? Math.ceil((weights.length - INITIAL_CREATE_WEIGHTS) / ATTACH_WEIGHTS_BATCH) : 0
  const attachWeightsFeesLamports = write.lamports * BigInt(attachWeightsCount)
  const writeFeesLamports = write.lamports * BigInt(writeCount)
  const totalChunks = Math.ceil(sizeBytes / CIPHER_CHUNK_BYTES)
  const sealRangeCount = Math.max(0, Math.ceil(totalChunks / SEAL_RANGE_CHUNKS) - 1)
  const sealRangeFeesLamports = write.lamports * BigInt(sealRangeCount)
  const perKeyWrites = Math.ceil(writeCount / uploadKeyCount)
  const perKeyFunding = BigInt(perKeyWrites) * write.lamports + attachWeightsFeesLamports + sealRangeFeesLamports + uploadKeyMinimumLamports + seal.lamports
  const uploadFundingLamports = perKeyFunding * BigInt(uploadKeyCount)
  const extraSweepFeesLamports = BigInt(uploadKeyCount - 1) * write.lamports
  const returnedUploadReserveLamports = uploadFundingLamports - writeFeesLamports - attachWeightsFeesLamports - sealRangeFeesLamports - extraSweepFeesLamports
  const estimatedCostLamports = modelRentLamports + weightsRentLamports + allocationFeesLamports + create.lamports + attachWeightsFeesLamports + writeFeesLamports + sealRangeFeesLamports + extraSweepFeesLamports + seal.lamports
  const footprint = request.create ? await createModelFootprint(runtime.programs.voynich, runtime.addresses.config, runtime.addresses.model(request.create.name), { ...request.create, sizeBytes, uploadFundingLamports: uploadFundingLamports.toString() }, runtime.env.LOOKUP_TABLE ? await loadLookupTables(connection, [new PublicKey(runtime.env.LOOKUP_TABLE)]) : []) : { createTransactionBytes: null, createTransactionMaxBytes: 1104 as const, manifestBytes: null, canCreate: null }
  return { fixture: false, asOfSlot: latest.context.slot.toString(), sizeBytes, writeChunkBytes: WRITE_CHUNK_BYTES, writeCount, modelAccountBytes: MODEL_ACCOUNT_BYTES,
    ...footprint,
    modelRentLamports: modelRentLamports.toString(), weights, weightsRentLamports: weightsRentLamports.toString(), uploadKeyCount, uploadKeyMinimumLamports: uploadKeyMinimumLamports.toString(),
    signaturesPerTransaction: { allocation: allocation.signatures, createModel: create.signatures, write: write.signatures, seal: seal.signatures },
    allocationFeeLamports: allocation.lamports.toString(), allocationFeesLamports: allocationFeesLamports.toString(), createFeeLamports: create.lamports.toString(),
    attachWeightsCount, attachWeightsFeesLamports: attachWeightsFeesLamports.toString(),
    writeFeeLamports: write.lamports.toString(), writeFeesLamports: writeFeesLamports.toString(),
    sealRangeCount, sealRangeFeesLamports: sealRangeFeesLamports.toString(),
    sealFeeLamports: seal.lamports.toString(),
    uploadFundingLamports: uploadFundingLamports.toString(), returnedUploadReserveLamports: returnedUploadReserveLamports.toString(), estimatedCostLamports: estimatedCostLamports.toString(), requiredUpfrontLamports: (estimatedCostLamports + returnedUploadReserveLamports).toString() }
}
