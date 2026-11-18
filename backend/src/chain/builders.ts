import { randomBytes } from 'node:crypto'
import { Ed25519Program, PublicKey, SYSVAR_INSTRUCTIONS_PUBKEY, SystemProgram, type TransactionInstruction } from '@solana/web3.js'
import { ACCOUNT_SIZE, ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token'
import type * as c from '@voynich/contract'
import { Address, MODEL_ACCOUNT_BYTES, SEAL_RANGE_CHUNKS } from '@voynich/contract'
import { BN, CALL_SPACE, MEASUREMENT_SPACE, RECEIPT_METERED_SPACE, decodeCallAccount, decodeConfigAccount, decodeMeasurementAccount, decodeWeightsHeader, eventAccounts } from 'voynich/program'
import { CIPHER_CHUNK_BYTES, fromBase64, fromHex, pieceMessage, toHex, verifyPiece } from 'voynich/crypto'
import { ApiFailure } from '../engines/server/errors.js'
import type { ChainRuntime } from '../runtime.js'
import { fail } from './errors.js'
import { transactions } from './transactions.js'
import { createModelInstruction } from './create-model.js'

function findModelPriceUnitOffset(data: Uint8Array): number | null {
  if (data.length < 8 + 32) return null
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let offset = 8
  const need = (n: number) => offset + n <= data.length
  const skip = (n: number) => { if (!need(n)) return false; offset += n; return true }
  const readU32 = () => { if (!need(4)) return -1; const v = view.getUint32(offset, true); offset += 4; return v }

  if (!skip(32)) return null // owner
  const nameLen = readU32(); if (nameLen < 0 || !skip(nameLen)) return null
  const manifestLen = readU32(); if (manifestLen < 0 || !skip(manifestLen)) return null
  const weightsLen = readU32(); if (weightsLen < 0 || !skip(weightsLen * 32)) return null
  if (!skip(8)) return null // size_bytes
  const cipherLen = readU32(); if (cipherLen < 0 || !skip(cipherLen)) return null
  if (!skip(16 + 32)) return null // nonce_prefix + ciphertext_sha256
  const measLen = readU32(); if (measLen < 0 || !skip(measLen * 48)) return null
  if (!skip(8 + 32 + 2 + 32 + 1 + 8 + 8 + 8 + 1)) return null // price..bump
  const uploadKeysLen = readU32(); if (uploadKeysLen < 0 || !skip(uploadKeysLen * 32)) return null
  if (!skip(1 + 4)) return null // hash_version + sealed_chunks
  const frontierLen = readU32(); if (frontierLen < 0 || !skip(frontierLen * 32)) return null
  if (!skip(4)) return null // merkle_frontier_mask
  if (!need(1)) return null
  const baseTag = data[offset++]!
  if (baseTag === 1) {
    if (!skip(32 + 8)) return null // sha256 + size_bytes
    const fmtLen = readU32(); if (fmtLen < 0 || !skip(fmtLen)) return null
    const srcLen = readU32(); if (srcLen < 0 || !skip(srcLen)) return null
  } else if (baseTag !== 0) {
    return null
  }
  return offset
}

/** Decodes on-chain Model accounts, tolerating pre-Build-4 stale Vec tail slack bytes where trailing price_unit sits. */
export function decodeModelAccountForBuilder(voynich: ChainRuntime['programs']['voynich'], data: Uint8Array) {
  const buf = Buffer.from(data)
  try {
    return voynich.coder.accounts.decode('model', buf)
  } catch (err) {
    const priceUnitOffset = findModelPriceUnitOffset(data)
    if (priceUnitOffset !== null && priceUnitOffset < data.length && data[priceUnitOffset] !== 0 && data[priceUnitOffset] !== 1) {
      const patched = Buffer.from(data)
      patched.fill(0, priceUnitOffset)
      return voynich.coder.accounts.decode('model', patched)
    }
    throw err
  }
}

export function builders(runtime: ChainRuntime) {
  const { voynich } = runtime.programs
  const a = runtime.addresses
  const events = eventAccounts(runtime.programId)
  const ledger = transactions(runtime)
  const publicKey = (value: string) => new PublicKey(value)
  const mint = (value: string | null) => value ? publicKey(value) : PublicKey.default
  const bn = (value: string | number | bigint) => new BN(value.toString())
  async function model(id: string) {
    const address = Address.safeParse(id)
    if (!address.success && id.length > 32) fail('VALIDATION_ERROR', 'Model names contain at most 32 bytes.', { stage: 'validation' })
    const key = address.success ? publicKey(id) : a.model(id)
    let value: Awaited<ReturnType<typeof voynich.account.model.fetchNullable>>
    try {
      value = await voynich.account.model.fetchNullable(key)
    } catch {
      const info = await runtime.rpc.connection.getAccountInfo(key, 'confirmed')
      if (!info || !info.owner.equals(runtime.programId)) fail('MODEL_NOT_FOUND', 'This model was not found.')
      value = decodeModelAccountForBuilder(voynich, info.data)
    }
    if (!value) fail('MODEL_NOT_FOUND', 'This model was not found.')
    return { key, value }
  }
  async function enclave(key: PublicKey) {
    const value = await voynich.account.enclave.fetchNullable(key)
    if (!value) fail('ENCLAVE_NOT_FOUND', 'This enclave was not found.')
    return value
  }
  async function requireEligibleEnclave(
    modelRow: Awaited<ReturnType<typeof model>>['value'],
    entry: Awaited<ReturnType<typeof enclave>>,
  ) {
    const measurement = toHex(Uint8Array.from(entry.measurement))
    const allowed = modelRow.allowedMeasurements.some(item => toHex(Uint8Array.from(item)) === measurement)
    if (!allowed) {
      fail('MEASUREMENT_NOT_ALLOWED', 'This enclave measurement is not allowed for this model.', { stage: 'build' })
    }
    const currentSlot = BigInt(await runtime.rpc.connection.getSlot('confirmed'))
    if (BigInt(entry.expiresAtSlot.toString()) <= currentSlot) {
      fail('ENCLAVE_EXPIRED', 'This enclave attestation has expired.', { stage: 'build' })
    }
  }
  async function weightsLayout(modelAddress: PublicKey, weightKeys: PublicKey[]) {
    const dbRows = await runtime.db.weights.findMany({ where: { modelAddress: modelAddress.toBase58() }, orderBy: { index: 'asc' } })
    if (dbRows.length === weightKeys.length && dbRows.every((row, index) => row.address === weightKeys[index]!.toBase58())) {
      return dbRows.map(row => ({ pubkey: publicKey(row.address), index: row.index, offset: Number(row.offset), size: Number(row.size) }))
    }
    const infos = await runtime.rpc.connection.getMultipleAccountsInfo(weightKeys, 'confirmed')
    return weightKeys.map((pubkey, index) => {
      const info = infos[index]
      if (!info || !info.owner.equals(runtime.programId)) fail('UPSTREAM_UNAVAILABLE', 'A model weights account could not be read.', { retryable: true })
      const header = decodeWeightsHeader(info.data)
      return { pubkey, index: header.index, offset: header.globalOffset, size: header.sizeBytes }
    }).sort((left, right) => left.index - right.index)
  }
  return {
    ledger,
    async create(body: c.CreateModelRequest) {
      if (body.name.length > 32 || body.name !== body.manifest.name) fail('VALIDATION_ERROR', 'Use a model name of at most 32 bytes matching the manifest.', { stage: 'validation' })
      if (!body.weights?.length) fail('VALIDATION_ERROR', 'Allocate the Weights accounts before creating this model.', { stage: 'validation', fieldErrors: { weights: ['Provide the preallocated Weights account addresses.'] } })
      if (body.allowedMeasurements.some(value => value.length !== 96)) fail('VALIDATION_ERROR', 'Each hardware measurement must contain 48 bytes.', { stage: 'validation' })
      const keys = body.weights.map(publicKey)
      const accounts = await runtime.rpc.connection.getMultipleAccountsInfo(keys, 'confirmed')
      const attachedBytes = accounts.reduce((sum, value) => sum + (value ? value.data.length - 56 : 0), 0)
      if (accounts.some(value => !value || !value.owner.equals(runtime.programId) || value.data.length <= 56) || attachedBytes <= 0 || attachedBytes > body.sizeBytes) fail('VALIDATION_ERROR', 'The Weights accounts do not match the allocated ciphertext size.', { stage: 'validation' })
      const owner = publicKey(body.wallet), address = a.model(body.name)
      const { instruction } = await createModelInstruction(voynich, a.config, address, body)
      const requiredLamports = BigInt(await runtime.rpc.connection.getMinimumBalanceForRentExemption(MODEL_ACCOUNT_BYTES, 'confirmed')) + BigInt(body.uploadFundingLamports)
      return ledger.build('create_model', owner, [instruction], { model: address.toBase58(), weights: body.weights, uploadKey: body.uploadKey }, requiredLamports)
    },
    async attachWeights(id: string, body: c.AttachWeightsRequest) {
      const row = await model(id)
      if (!('uploading' in row.value.status)) fail('MODEL_NOT_UPLOADING', 'This model is not accepting upload changes.', { stage: 'build' })
      const lastAttached = row.value.weights.at(-1)
      if (!lastAttached) fail('VALIDATION_ERROR', 'This model has no initial Weights account attached.', { stage: 'validation' })
      const newKeys = body.weights.map(publicKey)
      const accounts = await runtime.rpc.connection.getMultipleAccountsInfo(newKeys, 'confirmed')
      if (accounts.some(value => !value || !value.owner.equals(runtime.programId) || value.data.length <= 56)) fail('VALIDATION_ERROR', 'Each attached Weights account must be preallocated for Voynich.', { stage: 'validation' })
      const uploadKey = publicKey(body.wallet)
      const instruction = await voynich.methods.attachWeights().accountsStrict({ uploadKey, model: row.key, ...events }).remainingAccounts([
        { pubkey: lastAttached, isWritable: false, isSigner: false },
        ...newKeys.map(pubkey => ({ pubkey, isWritable: true, isSigner: false })),
      ]).instruction()
      return ledger.build('attach_weights', uploadKey, [instruction], { model: row.key.toBase58(), weights: body.weights, uploadKey: body.wallet }, 0n, undefined, { walletSigned: false })
    },
    async write(id: string, body: c.WriteWeightsRequest) {
      const row = await model(id)
      // Offsets in the HTTP contract span the concatenation; instruction offsets are account-local.
      const weights = await weightsLayout(row.key, row.value.weights)
      const bytes = fromBase64(body.bytesBase64)
      const destination = weights.find(value => body.offset >= value.offset && body.offset + bytes.length <= value.offset + value.size)
      if (!destination) fail('VALIDATION_ERROR', 'A write must fit within one allocated Weights account.', { stage: 'validation' })
      const uploadKey = publicKey(body.wallet)
      const instruction = await voynich.methods.writeWeights(body.offset - destination.offset, Buffer.from(bytes)).accountsStrict({ uploadKey, model: row.key, weights: destination.pubkey, ...events }).instruction()
      return ledger.build('write_weights', uploadKey, [instruction], { model: row.key.toBase58(), weights: [destination.pubkey.toBase58()], uploadKey: body.wallet }, 0n, undefined, { walletSigned: false })
    },
    async sealRange(id: string, body: c.SealRangeRequest) {
      const row = await model(id)
      if (!('uploading' in row.value.status)) fail('MODEL_NOT_UPLOADING', 'This model is not in upload state.', { stage: 'build' })
      const hashVersion = (row.value as { hashVersion?: number }).hashVersion ?? 0
      if (hashVersion !== 1) fail('PROGRAM_REFUSED', 'This legacy model seals in one transaction without range sealing.', { stage: 'build' })
      const sizeBytes = Number(row.value.sizeBytes.toString())
      const totalChunks = Math.ceil(sizeBytes / CIPHER_CHUNK_BYTES)
      const sealedChunks = (row.value as { sealedChunks?: number }).sealedChunks ?? 0
      if (sealedChunks >= totalChunks) fail('VALIDATION_ERROR', 'All ciphertext chunks have already been sealed.', { stage: 'validation' })
      const chunkCount = Math.min(body.chunkCount ?? SEAL_RANGE_CHUNKS, totalChunks - sealedChunks)
      const rangeStart = sealedChunks * CIPHER_CHUNK_BYTES
      const rangeEnd = Math.min((sealedChunks + chunkCount) * CIPHER_CHUNK_BYTES, sizeBytes)
      const layout = await weightsLayout(row.key, row.value.weights)
      const covering = layout.filter(item => item.offset < rangeEnd && item.offset + item.size > rangeStart)
      if (!covering.length) fail('UPLOAD_INCOMPLETE', 'Attach the remaining Weights accounts before sealing this range.', { stage: 'build' })
      const uploadKey = publicKey(body.wallet)
      const instruction = await voynich.methods.sealRange(chunkCount).accountsStrict({ uploadKey, model: row.key, ...events }).remainingAccounts(covering.map(item => ({ pubkey: item.pubkey, isWritable: false, isSigner: false }))).instruction()
      return ledger.build('seal_range', uploadKey, [instruction], { model: row.key.toBase58(), weights: covering.map(item => item.pubkey.toBase58()), uploadKey: body.wallet }, 0n, undefined, { walletSigned: false })
    },
    async seal(id: string, body: c.SealModelRequest) {
      const row = await model(id), owner = publicKey(body.wallet)
      const hashVersion = (row.value as { hashVersion?: number }).hashVersion ?? 0
      let remaining: { pubkey: PublicKey; isWritable: boolean; isSigner: boolean }[]
      if (hashVersion === 0) {
        remaining = row.value.weights.map(pubkey => ({ pubkey, isWritable: false, isSigner: false }))
      } else {
        const sizeBytes = Number(row.value.sizeBytes.toString())
        const totalChunks = Math.ceil(sizeBytes / CIPHER_CHUNK_BYTES)
        const sealedChunks = (row.value as { sealedChunks?: number }).sealedChunks ?? 0
        if (sealedChunks >= totalChunks) {
          remaining = []
        } else {
          if (totalChunks - sealedChunks > SEAL_RANGE_CHUNKS) fail('UPLOAD_INCOMPLETE', 'Seal the remaining ciphertext ranges before sealing this model.', { stage: 'build' })
          const rangeStart = sealedChunks * CIPHER_CHUNK_BYTES
          const layout = await weightsLayout(row.key, row.value.weights)
          remaining = layout.filter(item => item.offset < sizeBytes && item.offset + item.size > rangeStart).map(item => ({ pubkey: item.pubkey, isWritable: false, isSigner: false }))
        }
      }
      const instruction = await voynich.methods.sealModel([...fromHex(body.ciphertextSha256)]).accountsStrict({ owner, model: row.key, ...events }).remainingAccounts(remaining).instruction()
      const remainder = await runtime.rpc.connection.getBalance(row.value.uploadKey, 'confirmed')
      const sweep = SystemProgram.transfer({ fromPubkey: row.value.uploadKey, toPubkey: owner, lamports: remainder })
      return ledger.build('seal_model', owner, [instruction, sweep], { model: row.key.toBase58(), uploadKey: row.value.uploadKey.toBase58() })
    },
    async price(id: string, body: c.SetPriceRequest) {
      const row = await model(id), owner = publicKey(body.wallet)
      const currentUnit = 'token' in row.value.priceUnit ? 'token' : 'call'
      const nextUnit = body.priceUnit ?? currentUnit
      const priceUnit = nextUnit === 'token' ? { token: {} } : { call: {} }
      const instruction = await voynich.methods.setPrice(bn(body.price.amount), mint(body.price.mint), body.operatorShareBps, priceUnit).accountsStrict({ owner, config: a.config, model: row.key, ...events }).instruction()
      return ledger.build('set_price', owner, [instruction], { model: row.key.toBase58() })
    },
    async grant(id: string, body: c.GrantRequest) {
      const row = await model(id), owner = publicKey(body.wallet), targetEnclave = publicKey(body.enclave)
      const target = await enclave(targetEnclave)
      const grant = a.grant(row.key, targetEnclave)
      const rent = await runtime.rpc.connection.getAccountInfo(grant, 'confirmed') ? 0n : BigInt(await runtime.rpc.connection.getMinimumBalanceForRentExemption(223))
      const instruction = await voynich.methods.grantByOwner(Buffer.from(fromBase64(body.wrappedKey))).accountsStrict({ owner, payer: owner, config: a.config, model: row.key, targetEnclave, targetAttestationRecord: target.attestationRecord, grant: a.grant(row.key, targetEnclave), systemProgram: SystemProgram.programId, ...events }).instruction()
      return ledger.build('grant_by_owner', owner, [instruction], { model: row.key.toBase58() }, rent)
    },
    async retire(id: string, body: c.WalletRequest) {
      const row = await model(id), owner = publicKey(body.wallet)
      const instruction = await voynich.methods.retireModel().accountsStrict({ owner, config: a.config, model: row.key, ...events }).instruction()
      return ledger.build('retire_model', owner, [instruction], { model: row.key.toBase58() })
    },
    async revoke(id: string, body: c.RevokeGrantRequest) {
      const row = await model(id), owner = publicKey(body.wallet)
      const grant = a.grant(row.key, publicKey(body.enclave))
      if (!await voynich.account.grant.fetchNullable(grant)) fail('GRANT_REQUIRED', 'This enclave does not hold a grant for this model.', { stage: 'build' })
      const instruction = await voynich.methods.revokeGrant().accountsStrict({ owner, model: row.key, grant, ...events }).instruction()
      return ledger.build('revoke_grant', owner, [instruction], { model: row.key.toBase58() })
    },
    async open(body: c.OpenCallRequest) {
      const row = await model(body.model), caller = publicKey(body.wallet), target = publicKey(body.enclave)
      const entry = await enclave(target)
      await requireEligibleEnclave(row.value, entry)
      const nonce = body.nonce === undefined ? randomBytes(8).readBigUInt64LE() : BigInt(body.nonce)
      const call = a.call(caller, nonce)
      const priceUnit = 'token' in row.value.priceUnit ? 'token' : 'call'
      const unitPrice = BigInt(row.value.price.toString())
      let escrowAmount: bigint
      if (priceUnit === 'token') {
        if (body.ceiling === undefined) fail('VALIDATION_ERROR', 'Supply a ceiling for per-token models.', { stage: 'validation', fieldErrors: { ceiling: ['Required for per-token models.'] } })
        escrowAmount = BigInt(body.ceiling)
        if (escrowAmount < unitPrice || (unitPrice > 0n && escrowAmount === 0n)) {
          fail('VALIDATION_ERROR', 'Ceiling must be at least the per-token price.', { stage: 'validation', fieldErrors: { ceiling: ['Must be at least the per-token price.'] } })
        }
      } else {
        if (body.ceiling !== undefined) fail('VALIDATION_ERROR', 'Ceiling is only used for per-token models.', { stage: 'validation', fieldErrors: { ceiling: ['Not used for per-call models.'] } })
        escrowAmount = unitPrice
      }
      const token = !row.value.priceMint.equals(PublicKey.default)
      let requiredLamports = BigInt(await runtime.rpc.connection.getMinimumBalanceForRentExemption(CALL_SPACE))
      const callerTokens = token ? getAssociatedTokenAddressSync(row.value.priceMint, caller) : null
      if (token) {
        const escrow = getAssociatedTokenAddressSync(row.value.priceMint, call, true)
        if (!await runtime.rpc.connection.getAccountInfo(escrow, 'confirmed')) requiredLamports += BigInt(await runtime.rpc.connection.getMinimumBalanceForRentExemption(ACCOUNT_SIZE))
      } else requiredLamports += escrowAmount
      const answerMode = body.answerMode === 'open' ? { open: {} } : { sealed: {} }
      const accounts = {
        payer: caller, caller, config: a.config, model: row.key, enclave: target, attestationRecord: entry.attestationRecord, grant: a.grant(row.key, target), call,
        mint: token ? row.value.priceMint : null, callerTokens: token ? getAssociatedTokenAddressSync(row.value.priceMint, caller, true) : null,
        escrowTokens: token ? getAssociatedTokenAddressSync(row.value.priceMint, call, true) : null, tokenProgram: token ? TOKEN_PROGRAM_ID : null, associatedTokenProgram: token ? ASSOCIATED_TOKEN_PROGRAM_ID : null, systemProgram: SystemProgram.programId, ...events,
      }
      const instruction = priceUnit === 'token'
        ? await voynich.methods.openMeteredCall(bn(nonce), [...fromHex(body.inputHash)], answerMode, null, bn(escrowAmount)).accountsStrict(accounts).instruction()
        : await voynich.methods.openCall(bn(nonce), [...fromHex(body.inputHash)], answerMode, null).accountsStrict(accounts).instruction()
      return ledger.build('open_call', caller, [instruction], { model: row.key.toBase58(), call: call.toBase58() }, requiredLamports, token ? { mint: row.value.priceMint, account: callerTokens!, amount: escrowAmount } : undefined)
    },
    async settleMetered(id: string, body: c.SettleCallRequest) {
      const call = publicKey(id), wallet = publicKey(body.wallet)
      const callInfo = await runtime.rpc.connection.getAccountInfo(call, 'confirmed')
      const chainCall = callInfo && callInfo.owner.equals(runtime.programId) ? decodeCallAccount(callInfo.data) : null
      if (!chainCall) fail('CALL_NOT_FOUND', 'This call was not found.')
      if (!('open' in chainCall.status)) fail('CALL_NOT_OPEN', 'This call is no longer open.', { stage: 'build' })
      if (chainCall.priceUnit !== 'token') fail('PROGRAM_REFUSED', 'Only per-token calls support metered settlement.', { stage: 'build' })
      if (!wallet.equals(chainCall.caller) && !wallet.equals(chainCall.operator)) {
        throw new ApiFailure(403, { error: { code: 'UNAUTHORIZED', message: 'Only the caller or operator can settle this metered call.', retryable: false, stage: 'auth' } })
      }
      const currentSlot = BigInt(await runtime.rpc.connection.getSlot('confirmed'))
      if (currentSlot > BigInt(chainCall.deadlineSlot.toString())) {
        fail('CALL_DEADLINE_PASSED', 'The call settlement deadline has passed. Refund the call instead.', { stage: 'build' })
      }
      const row = await model(chainCall.model.toBase58())
      const entry = await enclave(chainCall.enclave)
      await requireEligibleEnclave(row.value, entry)
      const count = BigInt(body.count)
      const unitPrice = BigInt(chainCall.price.toString())
      const ceiling = BigInt(chainCall.ceiling.toString())
      if (count * unitPrice > ceiling) {
        fail('VALIDATION_ERROR', 'Delivered token total exceeds the escrowed ceiling.', { stage: 'validation', fieldErrors: { count: ['Exceeds escrowed ceiling.'] } })
      }
      const runningHash = fromHex(body.runningHash)
      const signature = fromBase64(body.signature)
      const baseSha256 = row.value.base ? Uint8Array.from(row.value.base.sha256) : null
      const validSig = verifyPiece(signature, entry.signingKey.toBytes(), call.toBytes(), Uint8Array.from(chainCall.inputHash), count, runningHash, baseSha256)
      if (!validSig) {
        fail('INVALID_ENVELOPE', 'The piece signature does not match the enclave signing key.', { stage: 'validation' })
      }
      const receipt = a.receipt(call)
      const token = !chainCall.priceMint.equals(PublicKey.default)
      const ata = (owner: PublicKey) => getAssociatedTokenAddressSync(chainCall.priceMint, owner, true)
      const uniqueOwners = token ? [...new Map([chainCall.owner, chainCall.operator, chainCall.feeRecipient, chainCall.caller].map(o => [o.toBase58(), o])).values()] : []
      const prepare = uniqueOwners.map(o => createAssociatedTokenAccountIdempotentInstruction(wallet, ata(o), o, chainCall.priceMint))
      let requiredLamports = BigInt(await runtime.rpc.connection.getMinimumBalanceForRentExemption(RECEIPT_METERED_SPACE))
      if (uniqueOwners.length) {
        const ataInfos = await runtime.rpc.connection.getMultipleAccountsInfo(uniqueOwners.map(ata), 'confirmed')
        const missingAtas = ataInfos.filter(info => !info).length
        if (missingAtas > 0) {
          requiredLamports += BigInt(missingAtas) * BigInt(await runtime.rpc.connection.getMinimumBalanceForRentExemption(ACCOUNT_SIZE))
        }
      }
      const verifyIx = Ed25519Program.createInstructionWithPublicKey({
        publicKey: entry.signingKey.toBytes(),
        message: pieceMessage(call.toBytes(), Uint8Array.from(chainCall.inputHash), count, runningHash, baseSha256),
        signature,
      })
      const callbackRemaining = !chainCall.callbackProgram.equals(PublicKey.default)
        ? [
            { pubkey: chainCall.callbackProgram, isWritable: false, isSigner: false },
            ...chainCall.callbackAccounts.map(account => ({ pubkey: account.pubkey, isWritable: account.isWritable, isSigner: false })),
          ]
        : []
      // buildUnsignedV0 prepends exactly 2 ComputeBudget instructions (setComputeUnitLimit, setComputeUnitPrice).
      const ed25519IxIndex = 2 + prepare.length
      const settleIx = await voynich.methods
        .settleMeteredCall(bn(count), [...runningHash], [...signature], ed25519IxIndex)
        .accountsStrict({
          payer: wallet, config: a.config, model: chainCall.model, enclave: chainCall.enclave,
          attestationRecord: entry.attestationRecord, call, receipt, caller: chainCall.caller,
          owner: chainCall.owner, operator: chainCall.operator, feeRecipient: chainCall.feeRecipient,
          instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
          escrowTokens: token ? ata(call) : null, ownerTokens: token ? ata(chainCall.owner) : null,
          operatorTokens: token ? ata(chainCall.operator) : null, protocolTokens: token ? ata(chainCall.feeRecipient) : null,
          callerTokens: token ? ata(chainCall.caller) : null, tokenProgram: token ? TOKEN_PROGRAM_ID : null,
          systemProgram: SystemProgram.programId, ...events,
        })
        .remainingAccounts(callbackRemaining)
        .instruction()
      return ledger.build('settle_metered_call', wallet, [...prepare, verifyIx, settleIx], { model: chainCall.model.toBase58(), call: id, receipt: receipt.toBase58() }, requiredLamports)
    },
    async refund(id: string, body: c.WalletRequest) {
      const call = publicKey(id), actor = publicKey(body.wallet)
      const callInfo = await runtime.rpc.connection.getAccountInfo(call, 'confirmed')
      const row = callInfo && callInfo.owner.equals(runtime.programId) ? decodeCallAccount(callInfo.data) : null
      if (!row) fail('CALL_NOT_FOUND', 'This call was not found.')
      const token = !row.priceMint.equals(PublicKey.default)
      const callerTokens = token ? getAssociatedTokenAddressSync(row.priceMint, row.caller, true) : null
      let requiredLamports = 0n
      const instructions: TransactionInstruction[] = []
      if (token && callerTokens) {
        if (!await runtime.rpc.connection.getAccountInfo(callerTokens, 'confirmed')) {
          requiredLamports = BigInt(await runtime.rpc.connection.getMinimumBalanceForRentExemption(ACCOUNT_SIZE))
        }
        instructions.push(createAssociatedTokenAccountIdempotentInstruction(actor, callerTokens, row.caller, row.priceMint))
      }
      instructions.push(await voynich.methods.refundCall().accountsStrict({ actor, call, caller: row.caller, escrowTokens: token ? getAssociatedTokenAddressSync(row.priceMint, call, true) : null, callerTokens, tokenProgram: token ? TOKEN_PROGRAM_ID : null, ...events }).instruction())
      return ledger.build('refund_call', actor, instructions, { model: row.model.toBase58(), call: id }, requiredLamports)
    },
    async postBounty(body: c.PostBountyRequest) {
      if (!runtime.programs.bounty || !runtime.bountyAddresses || !runtime.bountyProgramId) fail('PROGRAM_UNAVAILABLE', 'The bounty program is not configured yet.', { stage: 'build', retryable: true })
      const bountyProgram = runtime.programs.bounty
      const bountyEvents = eventAccounts(runtime.bountyProgramId)
      const row = await model(body.model), creator = publicKey(body.wallet)
      const nonce = body.nonce === undefined ? randomBytes(8).readBigUInt64LE() : BigInt(body.nonce)
      const bounty = runtime.bountyAddresses.bounty(creator, nonce)
      const token = body.reward.mint !== null
      const mintKey = token ? publicKey(body.reward.mint!) : null
      let requiredLamports = BigInt(await runtime.rpc.connection.getMinimumBalanceForRentExemption(278))
      const creatorTokens = token ? getAssociatedTokenAddressSync(mintKey!, creator, true) : null
      const bountyTokens = token ? getAssociatedTokenAddressSync(mintKey!, bounty, true) : null
      if (token) {
        if (!await runtime.rpc.connection.getAccountInfo(bountyTokens!, 'confirmed')) requiredLamports += BigInt(await runtime.rpc.connection.getMinimumBalanceForRentExemption(ACCOUNT_SIZE))
      } else requiredLamports += BigInt(body.reward.amount)
      const instruction = await bountyProgram.methods.post(bn(nonce), body.targetLabel, bn(body.reward.amount)).accountsStrict({
        creator, model: row.key, bounty, mint: mintKey, creatorTokens, bountyTokens,
        tokenProgram: token ? TOKEN_PROGRAM_ID : null, associatedTokenProgram: token ? ASSOCIATED_TOKEN_PROGRAM_ID : null,
        systemProgram: SystemProgram.programId, ...bountyEvents,
      }).instruction()
      return ledger.build('post_bounty', creator, [instruction], { model: row.key.toBase58(), bounty: bounty.toBase58() }, requiredLamports, token ? { mint: mintKey!, account: creatorTokens!, amount: BigInt(body.reward.amount) } : undefined)
    },
    async drawBounty(id: string, body: c.DrawBountyRequest) {
      if (!runtime.programs.bounty || !runtime.bountyAddresses || !runtime.bountyProgramId) fail('PROGRAM_UNAVAILABLE', 'The bounty program is not configured yet.', { stage: 'build', retryable: true })
      const bountyProgram = runtime.programs.bounty
      const bountyEvents = eventAccounts(runtime.bountyProgramId)
      const bountyKey = publicKey(id)
      const bountyAccount = await bountyProgram.account.bounty.fetchNullable(bountyKey)
      if (!bountyAccount) fail('BOUNTY_NOT_FOUND', 'This bounty was not found.')
      if (!('open' in bountyAccount.status)) fail('BOUNTY_NOT_OPEN', 'This bounty is no longer open.', { stage: 'build' })
      const row = await model(bountyAccount.model.toBase58()), drawer = publicKey(body.wallet), target = publicKey(body.enclave)
      if ('token' in row.value.priceUnit) fail('PROGRAM_REFUSED', 'Bounties only support per-call models.', { stage: 'build' })
      const entry = await enclave(target)
      await requireEligibleEnclave(row.value, entry)
      const caller = runtime.bountyAddresses.caller(bountyKey)
      const nonce = body.nonce === undefined ? randomBytes(8).readBigUInt64LE() : BigInt(body.nonce)
      const call = a.call(caller, nonce)
      const attempt = runtime.bountyAddresses.attempt(bountyKey, call)
      const token = !row.value.priceMint.equals(PublicKey.default)
      const bountyIsSpl = !bountyAccount.mint.equals(PublicKey.default)
      const callSpace = CALL_SPACE + 33 * (bountyIsSpl ? 6 : 4)
      let requiredLamports = BigInt(await runtime.rpc.connection.getMinimumBalanceForRentExemption(callSpace)) + BigInt(await runtime.rpc.connection.getMinimumBalanceForRentExemption(113))
      const drawerTokens = token ? getAssociatedTokenAddressSync(row.value.priceMint, drawer, true) : null
      const callerTokens = token ? getAssociatedTokenAddressSync(row.value.priceMint, caller, true) : null
      const escrowTokens = token ? getAssociatedTokenAddressSync(row.value.priceMint, call, true) : null
      const bountyTokens = bountyIsSpl ? getAssociatedTokenAddressSync(bountyAccount.mint, bountyKey, true) : null
      const drawerRewardTokens = bountyIsSpl ? getAssociatedTokenAddressSync(bountyAccount.mint, drawer, true) : null
      const checkAtas = [callerTokens, escrowTokens, drawerRewardTokens].filter((value): value is PublicKey => value !== null)
      if (checkAtas.length) {
        const infos = await runtime.rpc.connection.getMultipleAccountsInfo(checkAtas, 'confirmed')
        const ataRent = BigInt(await runtime.rpc.connection.getMinimumBalanceForRentExemption(ACCOUNT_SIZE))
        for (const info of infos) if (!info) requiredLamports += ataRent
      }
      if (!token) requiredLamports += BigInt(row.value.price.toString())
      const needsSplPrograms = token || bountyIsSpl
      const instruction = await bountyProgram.methods.draw(bn(nonce), [...fromHex(body.inputHash)]).accountsStrict({
        drawer, bounty: bountyKey, caller, attempt, config: a.config, model: row.key, enclave: target,
        attestationRecord: entry.attestationRecord, grant: a.grant(row.key, target), call,
        priceMint: token ? row.value.priceMint : null, drawerTokens, callerTokens, escrowTokens,
        bountyMint: bountyIsSpl ? bountyAccount.mint : null, bountyTokens, drawerRewardTokens,
        tokenProgram: needsSplPrograms ? TOKEN_PROGRAM_ID : null, associatedTokenProgram: needsSplPrograms ? ASSOCIATED_TOKEN_PROGRAM_ID : null,
        systemProgram: SystemProgram.programId, voynichEventAuthority: events.eventAuthority, voynichProgram: runtime.programId,
        ...bountyEvents,
      }).instruction()
      return ledger.build('draw_bounty', drawer, [instruction], { model: row.key.toBase58(), bounty: bountyKey.toBase58(), attempt: attempt.toBase58(), call: call.toBase58() }, requiredLamports, token ? { mint: row.value.priceMint, account: drawerTokens!, amount: BigInt(row.value.price.toString()) } : undefined)
    },
    async collectBounty(id: string, body: c.CollectBountyRequest) {
      if (!runtime.programs.bounty || !runtime.bountyAddresses || !runtime.bountyProgramId) fail('PROGRAM_UNAVAILABLE', 'The bounty program is not configured yet.', { stage: 'build', retryable: true })
      const bountyProgram = runtime.programs.bounty
      const bountyEvents = eventAccounts(runtime.bountyProgramId)
      const bountyKey = publicKey(id), actor = publicKey(body.wallet), callKey = publicKey(body.call)
      const bountyAccount = await bountyProgram.account.bounty.fetchNullable(bountyKey)
      if (!bountyAccount) fail('BOUNTY_NOT_FOUND', 'This bounty was not found.')
      if (!('open' in bountyAccount.status)) fail('BOUNTY_NOT_OPEN', 'This bounty is no longer open.', { stage: 'build' })
      const attemptKey = runtime.bountyAddresses.attempt(bountyKey, callKey)
      const attemptAccount = await bountyProgram.account.attempt.fetchNullable(attemptKey)
      if (!attemptAccount) fail('CALL_NOT_FOUND', 'No bounty attempt was found for this call.')
      const receiptKey = a.receipt(callKey)
      const token = !bountyAccount.mint.equals(PublicKey.default)
      const drawerTokens = token ? getAssociatedTokenAddressSync(bountyAccount.mint, attemptAccount.drawer, true) : null
      let requiredLamports = 0n
      const instructions: TransactionInstruction[] = []
      if (token && drawerTokens) {
        if (!await runtime.rpc.connection.getAccountInfo(drawerTokens, 'confirmed')) {
          requiredLamports = BigInt(await runtime.rpc.connection.getMinimumBalanceForRentExemption(ACCOUNT_SIZE))
        }
        instructions.push(createAssociatedTokenAccountIdempotentInstruction(actor, drawerTokens, attemptAccount.drawer, bountyAccount.mint))
      }
      instructions.push(await bountyProgram.methods.collect().accountsStrict({
        actor, bounty: bountyKey, attempt: attemptKey, call: callKey, receipt: receiptKey, drawer: attemptAccount.drawer,
        bountyTokens: token ? getAssociatedTokenAddressSync(bountyAccount.mint, bountyKey, true) : null,
        drawerTokens, tokenProgram: token ? TOKEN_PROGRAM_ID : null, ...bountyEvents,
      }).instruction())
      return ledger.build('collect_bounty', actor, instructions, { model: bountyAccount.model.toBase58(), bounty: bountyKey.toBase58(), attempt: attemptKey.toBase58(), call: callKey.toBase58() }, requiredLamports)
    },
    async cancelBounty(id: string, body: c.WalletRequest) {
      if (!runtime.programs.bounty || !runtime.bountyAddresses || !runtime.bountyProgramId) fail('PROGRAM_UNAVAILABLE', 'The bounty program is not configured yet.', { stage: 'build', retryable: true })
      const bountyProgram = runtime.programs.bounty
      const bountyEvents = eventAccounts(runtime.bountyProgramId)
      const bountyKey = publicKey(id), creator = publicKey(body.wallet)
      const bountyAccount = await bountyProgram.account.bounty.fetchNullable(bountyKey)
      if (!bountyAccount) fail('BOUNTY_NOT_FOUND', 'This bounty was not found.')
      if (!('open' in bountyAccount.status)) fail('BOUNTY_NOT_OPEN', 'This bounty is no longer open.', { stage: 'build' })
      const token = !bountyAccount.mint.equals(PublicKey.default)
      const creatorTokens = token ? getAssociatedTokenAddressSync(bountyAccount.mint, creator, true) : null
      let requiredLamports = 0n
      const instructions: TransactionInstruction[] = []
      if (token && creatorTokens) {
        if (!await runtime.rpc.connection.getAccountInfo(creatorTokens, 'confirmed')) {
          requiredLamports = BigInt(await runtime.rpc.connection.getMinimumBalanceForRentExemption(ACCOUNT_SIZE))
        }
        instructions.push(createAssociatedTokenAccountIdempotentInstruction(creator, creatorTokens, creator, bountyAccount.mint))
      }
      instructions.push(await bountyProgram.methods.cancel().accountsStrict({
        creator, bounty: bountyKey,
        bountyTokens: token ? getAssociatedTokenAddressSync(bountyAccount.mint, bountyKey, true) : null,
        creatorTokens, tokenProgram: token ? TOKEN_PROGRAM_ID : null, ...bountyEvents,
      }).instruction())
      return ledger.build('cancel_bounty', creator, instructions, { model: bountyAccount.model.toBase58(), bounty: bountyKey.toBase58() }, requiredLamports)
    },
    async publishMeasurement(body: c.PublishMeasurementRequest) {
      const publisher = publicKey(body.wallet)
      const digestBytes = fromHex(body.digest)
      const recipeBytes = fromHex(body.recipeHash)
      const measurement = a.measurement(digestBytes)
      const existing = await runtime.rpc.connection.getAccountInfo(measurement, 'confirmed')
      if (existing) fail('MEASUREMENT_ALREADY_EXISTS', 'A measurement record for this digest already exists.', { stage: 'build' })
      const requiredLamports = BigInt(await runtime.rpc.connection.getMinimumBalanceForRentExemption(MEASUREMENT_SPACE))
      const instruction = await voynich.methods
        .publishMeasurement([...digestBytes], body.sourceRepo, body.commitSha, [...recipeBytes], body.version)
        .accountsStrict({ publisher, measurement, systemProgram: SystemProgram.programId, ...events })
        .instruction()
      return ledger.build('publish_measurement', publisher, [instruction], { measurement: measurement.toBase58() }, requiredLamports)
    },
    async deprecateMeasurement(digest: string, body: c.WalletRequest) {
      const authority = publicKey(body.wallet)
      const digestBytes = fromHex(digest)
      const measurement = a.measurement(digestBytes)
      const [measurementInfo, configInfo] = await runtime.rpc.connection.getMultipleAccountsInfo([measurement, a.config], 'confirmed')
      if (!measurementInfo) fail('MEASUREMENT_NOT_FOUND', 'This measurement was not found.')
      const decoded = decodeMeasurementAccount(measurementInfo.data)
      if (decoded.status === 'deprecated') fail('MEASUREMENT_DEPRECATED', 'This measurement is already deprecated.', { stage: 'build' })
      const admin = configInfo ? decodeConfigAccount(configInfo.data).admin : null
      if (!authority.equals(decoded.publisher) && (!admin || !authority.equals(admin))) {
        fail('UNAUTHORIZED', 'Only the measurement publisher or protocol admin can deprecate this measurement.', { stage: 'build' })
      }
      const instruction = await voynich.methods
        .deprecateMeasurement()
        .accountsStrict({ authority, config: a.config, measurement, ...events })
        .instruction()
      return ledger.build('deprecate_measurement', authority, [instruction], { measurement: measurement.toBase58() })
    },
  }
}
