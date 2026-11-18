import { ComputeBudgetProgram, PublicKey, SystemProgram, TransactionMessage, type AddressLookupTableAccount, type MessageV0 } from '@solana/web3.js'
import type { Program } from '@coral-xyz/anchor'
import { encodeManifest, PROGRAM_LIMITS, type CreateModelRequest } from '@voynich/contract'
import { BN, eventAccounts, type Voynich } from 'voynich/program'
import { fromBase64, fromHex } from 'voynich/crypto'
import { MAX_COMPUTE_UNITS, PACKET_BYTES, WALLET_GUARD_BYTES } from '../engines/tx/server/build.js'

export async function createModelInstruction(program: Program<Voynich>, config: PublicKey, model: PublicKey, body: CreateModelRequest) {
  const manifest = encodeManifest(body.manifest)
  return { instruction: await instructionForManifest(program, config, model, body, manifest), manifestBytes: manifest.length }
}

async function instructionForManifest(program: Program<Voynich>, config: PublicKey, model: PublicKey, body: CreateModelRequest, manifest: Uint8Array) {
  const uploadKeys = body.uploadKeys?.length ? body.uploadKeys : [body.uploadKey]
  const extraUploadKeys = uploadKeys.slice(1)
  const instruction = await program.methods.createModel({
    name: body.name,
    manifest: Buffer.from(manifest),
    sizeBytes: new BN(body.sizeBytes.toString()),
    cipher: body.cipher.id,
    noncePrefix: [...fromBase64(body.cipher.noncePrefix)],
    allowedMeasurements: body.allowedMeasurements.map(value => [...fromHex(value)]),
    price: new BN(body.price.amount),
    priceMint: body.price.mint ? new PublicKey(body.price.mint) : PublicKey.default,
    operatorShareBps: body.operatorShareBps,
    uploadFundingLamports: new BN(body.uploadFundingLamports),
    extraUploadKeyCount: extraUploadKeys.length,
    base: body.base
      ? {
          sha256: [...fromHex(body.base.sha256)],
          sizeBytes: new BN(body.base.sizeBytes.toString()),
          format: body.base.format,
          source: body.base.source,
        }
      : null,
    priceUnit: body.priceUnit === 'token' ? { token: {} } : { call: {} },
  })
    .accountsStrict({ owner: new PublicKey(body.wallet), uploadKey: new PublicKey(body.uploadKey), config, model, systemProgram: SystemProgram.programId, ...eventAccounts(program.programId) })
    .remainingAccounts([
      ...body.weights!.map(value => ({ pubkey: new PublicKey(value), isWritable: true, isSigner: false })),
      ...extraUploadKeys.map(value => ({ pubkey: new PublicKey(value), isWritable: true, isSigner: false })),
    ]).instruction()
  return instruction
}

function shortVectorBytes(value: number): number { let length = 1; while (value >= 128) { value = Math.floor(value / 128); length++ }; return length }
/** Counts the v0 wire layout without the serializer's fixed packet buffer, including oversize messages. */
function transactionBytes(message: MessageV0): number {
  const signatures = message.header.numRequiredSignatures
  return shortVectorBytes(signatures) + signatures * 64 + 1 + 3 + shortVectorBytes(message.staticAccountKeys.length) + message.staticAccountKeys.length * 32 + 32 +
    shortVectorBytes(message.compiledInstructions.length) + message.compiledInstructions.reduce((sum, instruction) => sum + 1 + shortVectorBytes(instruction.accountKeyIndexes.length) + instruction.accountKeyIndexes.length + shortVectorBytes(instruction.data.length) + instruction.data.length, 0) +
    shortVectorBytes(message.addressTableLookups.length) + message.addressTableLookups.reduce((sum, table) => sum + 32 + shortVectorBytes(table.writableIndexes.length) + table.writableIndexes.length + shortVectorBytes(table.readonlyIndexes.length) + table.readonlyIndexes.length, 0)
}

export async function createModelFootprint(program: Program<Voynich>, config: PublicKey, model: PublicKey, body: CreateModelRequest, lookupTables: AddressLookupTableAccount[] = []) {
  const manifestBytes = encodeManifest(body.manifest).length
  // The vector's Borsh length prefix is always four bytes. Counting its payload separately
  // also reports oversize metadata beyond Anchor's instruction encoder scratch buffer.
  const instruction = await instructionForManifest(program, config, model, body, new Uint8Array())
  instruction.data = Buffer.alloc(instruction.data.length + manifestBytes)
  const message = new TransactionMessage({ payerKey: new PublicKey(body.wallet), recentBlockhash: PublicKey.default.toBase58(), instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: MAX_COMPUTE_UNITS }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 0 }), instruction] }).compileToV0Message(lookupTables)
  const createTransactionBytes = transactionBytes(message)
  const createTransactionMaxBytes = PACKET_BYTES - WALLET_GUARD_BYTES
  return { createTransactionBytes, createTransactionMaxBytes: createTransactionMaxBytes as 1104, manifestBytes, canCreate: createTransactionBytes <= createTransactionMaxBytes && manifestBytes <= PROGRAM_LIMITS.manifestBytes }
}
