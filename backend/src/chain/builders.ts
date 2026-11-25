import { randomBytes } from 'node:crypto'
import { Ed25519Program, PublicKey, SYSVAR_INSTRUCTIONS_PUBKEY, SystemProgram, type TransactionInstruction } from '@solana/web3.js'
import { ACCOUNT_SIZE, ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token'
import type * as c from '@voynich/contract'
import { Address, MODEL_ACCOUNT_BYTES, SEAL_RANGE_CHUNKS } from '@voynich/contract'
import { BN, BOND_SPACE, CALL_SPACE, GRANT_SPACE, MEASUREMENT_SPACE, MODEL_VERSION_SPACE, POLICY_SPACE, RECEIPT_METERED_SPACE, SESSION_SPACE, SPLIT_SPACE, decodeBondAccount, decodeCallAccount, decodeConfigAccount, decodeGrantAccount, decodeMeasurementAccount, decodeModelVersionAccount, decodePolicyAccount, decodeSessionAccount, decodeSplitAccount, decodeWeightsHeader, eventAccounts } from 'voynich/program'
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
    if (priceUnitOffset !== null && priceUnitOffset < data.length) {
      const invalidPriceUnit = data[priceUnitOffset] !== 0 && data[priceUnitOffset] !== 1
      const invalidHasPolicy = priceUnitOffset + 1 < data.length && data[priceUnitOffset + 1] !== 0 && data[priceUnitOffset + 1] !== 1
      const invalidHasSplit = priceUnitOffset + 6 < data.length && data[priceUnitOffset + 6] !== 0 && data[priceUnitOffset + 6] !== 1
      if (invalidPriceUnit || invalidHasPolicy || invalidHasSplit) {
        const patched = Buffer.from(data)
        const start = invalidPriceUnit ? priceUnitOffset : invalidHasPolicy ? priceUnitOffset + 1 : priceUnitOffset + 6
        patched.fill(0, start)
        return voynich.coder.accounts.decode('model', patched)
      }
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
      const rent = await runtime.rpc.connection.getAccountInfo(grant, 'confirmed') ? 0n : BigInt(await runtime.rpc.connection.getMinimumBalanceForRentExemption(GRANT_SPACE))
      const policyRemaining: { pubkey: PublicKey; isWritable: boolean; isSigner: boolean }[] = []
      if ((row.value as { hasPolicy?: boolean }).hasPolicy) {
        const policyKey = a.policy(row.key)
        const policyInfo = await runtime.rpc.connection.getAccountInfo(policyKey, 'confirmed')
        if (policyInfo) {
          const policy = decodePolicyAccount(policyInfo.data)
          if (policy.allowedOperators.length > 0 && !policy.allowedOperators.some(op => op.equals(target.operator))) {
            fail('POLICY_OPERATOR_DENIED', 'The enclave operator is not allowed by this model policy.', { stage: 'build' })
          }
        }
        policyRemaining.push({ pubkey: policyKey, isWritable: false, isSigner: false })
      }
      const instruction = await voynich.methods.grantByOwner(Buffer.from(fromBase64(body.wrappedKey))).accountsStrict({ owner, payer: owner, config: a.config, model: row.key, targetEnclave, targetAttestationRecord: target.attestationRecord, grant: a.grant(row.key, targetEnclave), systemProgram: SystemProgram.programId, ...events }).remainingAccounts(policyRemaining).instruction()
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
      const grantInfo = await runtime.rpc.connection.getAccountInfo(grant, 'confirmed')
      if (!grantInfo || !grantInfo.owner.equals(voynich.programId)) fail('GRANT_REQUIRED', 'This enclave does not hold a grant for this model.', { stage: 'build' })
      decodeGrantAccount(grantInfo.data)
      const instruction = await voynich.methods.revokeGrant().accountsStrict({ owner, model: row.key, grant, ...events }).instruction()
      return ledger.build('revoke_grant', owner, [instruction], { model: row.key.toBase58(), grant: grant.toBase58() })
    },
    async setQuote(enclaveKey: string, body: c.SetQuoteRequest) {
      const targetEnclave = publicKey(enclaveKey)
      const entry = await enclave(targetEnclave)
      const row = await model(body.model)
      const operator = body.payer ? publicKey(body.payer) : entry.operator
      if (!operator.equals(entry.operator)) {
        fail('UNAUTHORIZED', 'Only the enclave operator may set a quote for this grant.', { stage: 'build' })
      }
      const grant = a.grant(row.key, targetEnclave)
      const grantInfo = await runtime.rpc.connection.getAccountInfo(grant, 'confirmed')
      if (!grantInfo || !grantInfo.owner.equals(voynich.programId)) {
        fail('GRANT_REQUIRED', 'This enclave does not hold a grant for this model.', { stage: 'build' })
      }
      const decoded = decodeGrantAccount(grantInfo.data)
      if (decoded.revoked) {
        fail('GRANT_REQUIRED', 'Cannot set a quote on a revoked grant.', { stage: 'build' })
      }
      if (body.operatorShareBps !== null && body.operatorShareBps > row.value.operatorShareBps) {
        fail('INVALID_QUOTE', 'The quoted operator share exceeds the model maximum operator share.', { stage: 'build' })
      }
      let rentDelta = 0n
      if (grantInfo.data.length < GRANT_SPACE) {
        const minRent = BigInt(await runtime.rpc.connection.getMinimumBalanceForRentExemption(GRANT_SPACE))
        if (BigInt(grantInfo.lamports) < minRent) rentDelta = minRent - BigInt(grantInfo.lamports)
      }
      const instruction = await voynich.methods
        .setQuote(body.operatorShareBps)
        .accountsStrict({ operator, model: row.key, enclave: targetEnclave, grant, systemProgram: SystemProgram.programId, ...events })
        .instruction()
      return ledger.build('set_quote', operator, [instruction], { model: row.key.toBase58(), grant: grant.toBase58() }, rentDelta)
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
      const policyRemaining: { pubkey: PublicKey; isWritable: boolean; isSigner: boolean }[] = []
      if ((row.value as { hasPolicy?: boolean }).hasPolicy) {
        const policyKey = a.policy(row.key)
        const policyInfo = await runtime.rpc.connection.getAccountInfo(policyKey, 'confirmed')
        if (policyInfo) {
          const policy = decodePolicyAccount(policyInfo.data)
          if (policy.allowListEnabled && !policy.allowedCallers.some(c => c.equals(caller))) {
            fail('POLICY_CALLER_DENIED', 'This wallet is not on the model allow list.', { stage: 'build' })
          }
        }
        policyRemaining.push({ pubkey: policyKey, isWritable: false, isSigner: false })
      }
      const instruction = priceUnit === 'token'
        ? await voynich.methods.openMeteredCall(bn(nonce), [...fromHex(body.inputHash)], answerMode, null, bn(escrowAmount)).accountsStrict(accounts).remainingAccounts(policyRemaining).instruction()
        : await voynich.methods.openCall(bn(nonce), [...fromHex(body.inputHash)], answerMode, null).accountsStrict(accounts).remainingAccounts(policyRemaining).instruction()
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
      const hasSplit = Boolean((row.value as { hasSplit?: boolean }).hasSplit)
      const splitKey = hasSplit ? a.split(chainCall.model) : null
      const uniqueOwners = token ? [...new Map([chainCall.owner, chainCall.operator, chainCall.feeRecipient, chainCall.caller, ...(splitKey ? [splitKey] : [])].map(o => [o.toBase58(), o])).values()] : []
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
      const splitRemaining = splitKey
        ? [
            { pubkey: splitKey, isWritable: true, isSigner: false },
            ...(token ? [{ pubkey: ata(splitKey), isWritable: true, isSigner: false }] : []),
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
        .remainingAccounts([...callbackRemaining, ...splitRemaining])
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
      const bondKey = a.bond(row.enclave)
      const bondInfo = await runtime.rpc.connection.getAccountInfo(bondKey, 'confirmed')
      const bondRemaining = bondInfo && bondInfo.owner.equals(runtime.programId)
        ? (() => {
            try {
              const decoded = decodeBondAccount(bondInfo.data)
              return BigInt(decoded.bondedLamports.toString()) > 0n ? [{ pubkey: bondKey, isWritable: true, isSigner: false }] : []
            } catch {
              return []
            }
          })()
        : []
      const refundBuilder = voynich.methods.refundCall().accountsStrict({ actor, call, caller: row.caller, escrowTokens: token ? getAssociatedTokenAddressSync(row.priceMint, call, true) : null, callerTokens, tokenProgram: token ? TOKEN_PROGRAM_ID : null, ...events })
      instructions.push(await (bondRemaining.length > 0 ? refundBuilder.remainingAccounts(bondRemaining) : refundBuilder).instruction())
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
    async setPolicy(id: string, body: c.SetPolicyRequest) {
      const row = await model(id), owner = publicKey(body.wallet)
      if (!row.value.owner.equals(owner)) fail('UNAUTHORIZED', 'Only the model owner can update its policy.', { stage: 'build' })
      const policy = a.policy(row.key)
      const existing = await runtime.rpc.connection.getAccountInfo(policy, 'confirmed')
      const requiredLamports = existing ? 0n : BigInt(await runtime.rpc.connection.getMinimumBalanceForRentExemption(POLICY_SPACE))
      const instruction = await voynich.methods
        .setPolicy({
          allowListEnabled: body.allowListEnabled,
          allowedCallers: body.allowedCallers.map(publicKey),
          maxCallsPerCallerPerWindow: body.maxCallsPerCallerPerWindow,
          windowSlots: bn(body.windowSlots),
          allowedOperators: body.allowedOperators.map(publicKey),
          allowedRegions: body.allowedRegions,
        })
        .accountsStrict({ owner, model: row.key, policy, systemProgram: SystemProgram.programId, ...events })
        .instruction()
      return ledger.build('set_policy', owner, [instruction], { model: row.key.toBase58(), policy: policy.toBase58() }, requiredLamports)
    },
    async clearPolicy(id: string, body: c.WalletRequest) {
      const row = await model(id), owner = publicKey(body.wallet)
      if (!row.value.owner.equals(owner)) fail('UNAUTHORIZED', 'Only the model owner can clear its policy.', { stage: 'build' })
      const policy = a.policy(row.key)
      const existing = await runtime.rpc.connection.getAccountInfo(policy, 'confirmed')
      if (!existing) fail('POLICY_NOT_FOUND', 'No policy is configured for this model.')
      const instruction = await voynich.methods
        .clearPolicy()
        .accountsStrict({ owner, model: row.key, policy, ...events })
        .instruction()
      return ledger.build('clear_policy', owner, [instruction], { model: row.key.toBase58(), policy: policy.toBase58() })
    },
    async beginVersion(id: string, body: c.BeginVersionRequest) {
      const row = await model(id), owner = publicKey(body.wallet)
      if (!row.value.owner.equals(owner)) fail('UNAUTHORIZED', 'Only the model owner can publish a new version.', { stage: 'build' })
      const currentVersion = Math.max(1, Number((row.value as { currentVersion?: number }).currentVersion ?? 0))
      const version = body.version ?? (currentVersion + 1)
      if (version !== currentVersion + 1) fail('INVALID_VERSION', `Expected next version ${currentVersion + 1}.`, { stage: 'build' })
      const modelVersion = a.modelVersion(row.key, version)
      const rent = BigInt(await runtime.rpc.connection.getMinimumBalanceForRentExemption(MODEL_VERSION_SPACE))
      const baseArg = body.base
        ? { sha256: [...fromHex(body.base.sha256)], sizeBytes: bn(body.base.sizeBytes), format: body.base.format, source: body.base.source }
        : null
      const instruction = await voynich.methods
        .beginVersion(version, {
          manifest: Buffer.from(JSON.stringify(body.manifest)),
          sizeBytes: bn(body.sizeBytes),
          noncePrefix: [...fromBase64(body.noncePrefix)],
          base: baseArg,
        })
        .accountsStrict({ owner, model: row.key, modelVersion, systemProgram: SystemProgram.programId, ...events })
        .remainingAccounts(body.weights.map(w => ({ pubkey: publicKey(w), isWritable: true, isSigner: false })))
        .instruction()
      return ledger.build('begin_version', owner, [instruction], { model: row.key.toBase58(), modelVersion: modelVersion.toBase58(), weights: body.weights }, rent)
    },
    async writeVersionWeights(id: string, body: c.WriteVersionWeightsRequest) {
      const row = await model(id), owner = publicKey(body.wallet)
      if (!row.value.owner.equals(owner)) fail('UNAUTHORIZED', 'Only the model owner can write version weights.', { stage: 'build' })
      const modelVersion = a.modelVersion(row.key, body.version)
      const instruction = await voynich.methods
        .writeVersionWeights(body.offset, Buffer.from(fromBase64(body.bytesBase64)))
        .accountsStrict({ owner, model: row.key, modelVersion, weights: publicKey(body.weights), ...events })
        .instruction()
      return ledger.build('write_version_weights', owner, [instruction], { model: row.key.toBase58(), modelVersion: modelVersion.toBase58(), weights: [body.weights] })
    },
    async sealVersionRange(id: string, body: c.SealVersionRangeRequest) {
      const row = await model(id), owner = publicKey(body.wallet)
      if (!row.value.owner.equals(owner)) fail('UNAUTHORIZED', 'Only the model owner can seal version ranges.', { stage: 'build' })
      const modelVersion = a.modelVersion(row.key, body.version)
      const mvInfo = await runtime.rpc.connection.getAccountInfo(modelVersion, 'confirmed')
      if (!mvInfo) fail('INVALID_VERSION', 'This staged model version was not found.', { stage: 'build' })
      const mv = decodeModelVersionAccount(mvInfo.data)
      const total = Math.ceil(Number(mv.sizeBytes.toString()) / CIPHER_CHUNK_BYTES)
      const count = Math.min(body.chunkCount ?? SEAL_RANGE_CHUNKS, Math.max(0, total - mv.sealedChunks))
      if (count <= 0) fail('INVALID_VERSION', 'All version chunks are already sealed.', { stage: 'build' })
      const instruction = await voynich.methods
        .sealVersionRange(count)
        .accountsStrict({ owner, model: row.key, modelVersion, ...events })
        .remainingAccounts(mv.weights.map(pubkey => ({ pubkey, isWritable: false, isSigner: false })))
        .instruction()
      return ledger.build('seal_version_range', owner, [instruction], { model: row.key.toBase58(), modelVersion: modelVersion.toBase58() })
    },
    async publishVersion(id: string, body: c.PublishVersionRequest) {
      const row = await model(id), owner = publicKey(body.wallet)
      if (!row.value.owner.equals(owner)) fail('UNAUTHORIZED', 'Only the model owner can publish this version.', { stage: 'build' })
      const modelVersion = a.modelVersion(row.key, body.version)
      const mvInfo = await runtime.rpc.connection.getAccountInfo(modelVersion, 'confirmed')
      if (!mvInfo) fail('INVALID_VERSION', 'This staged model version was not found.', { stage: 'build' })
      const mv = decodeModelVersionAccount(mvInfo.data)
      const instruction = await voynich.methods
        .publishVersion([...fromHex(body.ciphertextSha256)])
        .accountsStrict({ owner, model: row.key, modelVersion, ...events })
        .remainingAccounts(mv.weights.map(pubkey => ({ pubkey, isWritable: false, isSigner: false })))
        .instruction()
      return ledger.build('publish_version', owner, [instruction], { model: row.key.toBase58(), modelVersion: modelVersion.toBase58() })
    },
    async openSession(body: c.OpenSessionRequest) {
      const caller = publicKey(body.wallet)
      const delegate = publicKey(body.delegate)
      if (delegate.equals(PublicKey.default)) fail('INVALID_SESSION', 'Delegate key must be non-zero.', { stage: 'validation' })
      const nonce = body.nonce === undefined ? randomBytes(8).readBigUInt64LE() : BigInt(body.nonce)
      const budget = BigInt(body.budget)
      if (budget <= 0n) fail('INVALID_SESSION', 'Session budget must be positive.', { stage: 'validation' })
      const delegateGasLamports = body.delegateGasLamports === undefined ? 0n : BigInt(body.delegateGasLamports)
      const currentSlot = BigInt(await runtime.rpc.connection.getSlot('confirmed'))
      const expiresAtSlot = body.expiresAtSlot !== undefined
        ? BigInt(body.expiresAtSlot)
        : currentSlot + BigInt(body.durationSlots ?? '18000')
      if (expiresAtSlot <= currentSlot) fail('INVALID_SESSION', 'expiresAtSlot must be in the future.', { stage: 'validation' })
      const modelKey = body.model ? (await model(body.model)).key : PublicKey.default
      const mintKey = body.mint ? publicKey(body.mint) : PublicKey.default
      const token = !mintKey.equals(PublicKey.default)
      const session = a.session(caller, delegate, nonce)
      let requiredLamports = BigInt(await runtime.rpc.connection.getMinimumBalanceForRentExemption(SESSION_SPACE)) + delegateGasLamports
      const callerTokens = token ? getAssociatedTokenAddressSync(mintKey, caller) : null
      const sessionEscrow = token ? getAssociatedTokenAddressSync(mintKey, session, true) : null
      if (token) {
        if (!await runtime.rpc.connection.getAccountInfo(sessionEscrow!, 'confirmed')) {
          requiredLamports += BigInt(await runtime.rpc.connection.getMinimumBalanceForRentExemption(ACCOUNT_SIZE))
        }
      } else {
        requiredLamports += budget
      }
      const instruction = await voynich.methods
        .openSession({
          delegate,
          nonce: bn(nonce),
          mint: mintKey,
          model: modelKey,
          budget: bn(budget),
          expiresAtSlot: bn(expiresAtSlot),
          delegateGasLamports: bn(delegateGasLamports),
        })
        .accountsStrict({
          caller,
          delegate,
          session,
          mint: token ? mintKey : null,
          callerTokens: token ? getAssociatedTokenAddressSync(mintKey, caller, true) : null,
          sessionEscrow,
          tokenProgram: token ? TOKEN_PROGRAM_ID : null,
          associatedTokenProgram: token ? ASSOCIATED_TOKEN_PROGRAM_ID : null,
          systemProgram: SystemProgram.programId,
          ...events,
        })
        .instruction()
      return ledger.build(
        'open_session',
        caller,
        [instruction],
        { session: session.toBase58(), ...(modelKey.equals(PublicKey.default) ? {} : { model: modelKey.toBase58() }) },
        requiredLamports,
        token ? { mint: mintKey, account: callerTokens!, amount: budget } : undefined,
      )
    },
    async closeSession(address: string, body: c.WalletRequest) {
      const sessionKey = publicKey(address)
      const closer = publicKey(body.wallet)
      const info = await runtime.rpc.connection.getAccountInfo(sessionKey, 'confirmed')
      const chainSession = info && info.owner.equals(runtime.programId) ? decodeSessionAccount(info.data) : null
      if (!chainSession) fail('SESSION_NOT_FOUND', 'This session was not found.')
      if (chainSession.status !== 'open') fail('INVALID_SESSION', 'This session is already closed.', { stage: 'build' })
      const slot = BigInt(await runtime.rpc.connection.getSlot('confirmed'))
      if (!closer.equals(chainSession.caller) && slot <= BigInt(chainSession.expiresAtSlot.toString())) {
        fail('UNAUTHORIZED', 'Only the caller can close an active session before expiry.', { stage: 'build' })
      }
      const token = !chainSession.mint.equals(PublicKey.default)
      const callerTokens = token ? getAssociatedTokenAddressSync(chainSession.mint, chainSession.caller, true) : null
      const instructions: TransactionInstruction[] = []
      let requiredLamports = 0n
      if (token && callerTokens) {
        if (!await runtime.rpc.connection.getAccountInfo(callerTokens, 'confirmed')) {
          requiredLamports = BigInt(await runtime.rpc.connection.getMinimumBalanceForRentExemption(ACCOUNT_SIZE))
        }
        instructions.push(createAssociatedTokenAccountIdempotentInstruction(closer, callerTokens, chainSession.caller, chainSession.mint))
      }
      instructions.push(
        await voynich.methods
          .closeSession()
          .accountsStrict({
            closer,
            session: sessionKey,
            caller: chainSession.caller,
            sessionEscrow: token ? getAssociatedTokenAddressSync(chainSession.mint, sessionKey, true) : null,
            callerTokens,
            tokenProgram: token ? TOKEN_PROGRAM_ID : null,
            systemProgram: SystemProgram.programId,
            ...events,
          })
          .instruction(),
      )
      return ledger.build('close_session', closer, instructions, { session: address }, requiredLamports)
    },
    async openSessionCall(address: string, body: c.OpenSessionCallRequest) {
      const sessionKey = publicKey(address)
      const delegate = publicKey(body.delegate)
      const info = await runtime.rpc.connection.getAccountInfo(sessionKey, 'confirmed')
      const chainSession = info && info.owner.equals(runtime.programId) ? decodeSessionAccount(info.data) : null
      if (!chainSession) fail('SESSION_NOT_FOUND', 'This session was not found.')
      if (chainSession.status !== 'open') fail('INVALID_SESSION', 'This session is closed.', { stage: 'build' })
      if (!chainSession.delegate.equals(delegate)) fail('UNAUTHORIZED', 'Only the session delegate can open calls on this session.', { stage: 'build' })
      const slot = BigInt(await runtime.rpc.connection.getSlot('confirmed'))
      if (slot > BigInt(chainSession.expiresAtSlot.toString())) fail('INVALID_SESSION', 'This session has expired.', { stage: 'build' })
      const row = await model(body.model)
      const target = publicKey(body.enclave)
      const entry = await enclave(target)
      await requireEligibleEnclave(row.value, entry)
      if (!chainSession.model.equals(PublicKey.default) && !chainSession.model.equals(row.key)) {
        fail('INVALID_SESSION', 'This session is scoped to a different model.', { stage: 'build' })
      }
      if (!chainSession.mint.equals(row.value.priceMint)) {
        fail('INVALID_SESSION', 'This session mint does not match the model price mint.', { stage: 'build' })
      }
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
      const remaining = BigInt(chainSession.budget.toString()) - BigInt(chainSession.spent.toString())
      if (remaining < escrowAmount) fail('INVALID_SESSION', 'Session budget remaining is less than the call escrow.', { stage: 'build' })
      const nonce = body.nonce === undefined ? randomBytes(8).readBigUInt64LE() : BigInt(body.nonce)
      const call = a.call(chainSession.caller, nonce)
      const token = !row.value.priceMint.equals(PublicKey.default)
      let requiredLamports = BigInt(await runtime.rpc.connection.getMinimumBalanceForRentExemption(CALL_SPACE))
      if (token) {
        const escrow = getAssociatedTokenAddressSync(row.value.priceMint, call, true)
        if (!await runtime.rpc.connection.getAccountInfo(escrow, 'confirmed')) {
          requiredLamports += BigInt(await runtime.rpc.connection.getMinimumBalanceForRentExemption(ACCOUNT_SIZE))
        }
      }
      const answerMode = body.answerMode === 'open' ? { open: {} } : { sealed: {} }
      const accounts = {
        delegate,
        session: sessionKey,
        config: a.config,
        model: row.key,
        enclave: target,
        attestationRecord: entry.attestationRecord,
        grant: a.grant(row.key, target),
        call,
        mint: token ? row.value.priceMint : null,
        sessionEscrow: token ? getAssociatedTokenAddressSync(row.value.priceMint, sessionKey, true) : null,
        escrowTokens: token ? getAssociatedTokenAddressSync(row.value.priceMint, call, true) : null,
        tokenProgram: token ? TOKEN_PROGRAM_ID : null,
        associatedTokenProgram: token ? ASSOCIATED_TOKEN_PROGRAM_ID : null,
        systemProgram: SystemProgram.programId,
        ...events,
      }
      const policyRemaining: { pubkey: PublicKey; isWritable: boolean; isSigner: boolean }[] = []
      if ((row.value as { hasPolicy?: boolean }).hasPolicy) {
        const policyKey = a.policy(row.key)
        const policyInfo = await runtime.rpc.connection.getAccountInfo(policyKey, 'confirmed')
        if (policyInfo) {
          const policy = decodePolicyAccount(policyInfo.data)
          if (policy.allowListEnabled && !policy.allowedCallers.some(c => c.equals(chainSession.caller))) {
            fail('POLICY_CALLER_DENIED', 'The session caller is not on the model allow list.', { stage: 'build' })
          }
        }
        policyRemaining.push({ pubkey: policyKey, isWritable: false, isSigner: false })
      }
      const instruction = priceUnit === 'token'
        ? await voynich.methods.openSessionMeteredCall(bn(nonce), [...fromHex(body.inputHash)], answerMode, null, bn(escrowAmount)).accountsStrict(accounts).remainingAccounts(policyRemaining).instruction()
        : await voynich.methods.openSessionCall(bn(nonce), [...fromHex(body.inputHash)], answerMode, null).accountsStrict(accounts).remainingAccounts(policyRemaining).instruction()
      return ledger.build('open_session_call', delegate, [instruction], { session: address, model: row.key.toBase58(), call: call.toBase58() }, requiredLamports)
    },
    async setSplit(id: string, body: c.SetSplitRequest) {
      const row = await model(id)
      const owner = publicKey(body.wallet)
      if (!row.value.owner.equals(owner)) fail('UNAUTHORIZED', 'Only the model owner can configure a revenue split.', { stage: 'build' })
      const split = a.split(row.key)
      const existingInfo = await runtime.rpc.connection.getAccountInfo(split, 'confirmed')
      let requiredLamports = existingInfo ? 0n : BigInt(await runtime.rpc.connection.getMinimumBalanceForRentExemption(SPLIT_SPACE))
      const token = !row.value.priceMint.equals(PublicKey.default)
      const instructions: TransactionInstruction[] = []
      if (token && body.recipients.length > 0) {
        const splitEscrow = getAssociatedTokenAddressSync(row.value.priceMint, split, true)
        if (!await runtime.rpc.connection.getAccountInfo(splitEscrow, 'confirmed')) {
          requiredLamports += BigInt(await runtime.rpc.connection.getMinimumBalanceForRentExemption(ACCOUNT_SIZE))
        }
        instructions.push(createAssociatedTokenAccountIdempotentInstruction(owner, splitEscrow, split, row.value.priceMint))
      }
      instructions.push(
        await voynich.methods
          .setSplit(body.recipients.map(r => ({ wallet: publicKey(r.wallet), shareBps: r.shareBps })))
          .accountsStrict({
            owner,
            model: row.key,
            split,
            systemProgram: SystemProgram.programId,
            ...events,
          })
          .instruction(),
      )
      return ledger.build('set_split', owner, instructions, { model: row.key.toBase58(), split: split.toBase58() }, requiredLamports)
    },
    async claimSplit(id: string, body: c.ClaimSplitRequest) {
      const row = await model(id)
      const payer = publicKey(body.wallet)
      const recipient = publicKey(body.recipient ?? body.wallet)
      const split = a.split(row.key)
      const splitInfo = await runtime.rpc.connection.getAccountInfo(split, 'confirmed')
      const chainSplit = splitInfo && splitInfo.owner.equals(runtime.programId) ? decodeSplitAccount(splitInfo.data) : null
      if (!chainSplit) fail('SPLIT_NOT_FOUND', 'No revenue split is configured for this model.')
      const entry = chainSplit.recipients.find(r => r.wallet.equals(recipient))
      if (!entry || BigInt(entry.accrued.toString()) <= BigInt(entry.claimed.toString())) {
        fail('INVALID_SPLIT', 'No unclaimed split balance is available for this recipient.', { stage: 'build' })
      }
      const token = !chainSplit.mint.equals(PublicKey.default)
      const splitEscrow = token ? getAssociatedTokenAddressSync(chainSplit.mint, split, true) : null
      const recipientTokens = token ? getAssociatedTokenAddressSync(chainSplit.mint, recipient, true) : null
      let requiredLamports = 0n
      const instructions: TransactionInstruction[] = []
      if (token && recipientTokens) {
        if (!await runtime.rpc.connection.getAccountInfo(recipientTokens, 'confirmed')) {
          requiredLamports += BigInt(await runtime.rpc.connection.getMinimumBalanceForRentExemption(ACCOUNT_SIZE))
        }
        instructions.push(createAssociatedTokenAccountIdempotentInstruction(payer, recipientTokens, recipient, chainSplit.mint))
      }
      instructions.push(
        await voynich.methods
          .claimSplit()
          .accountsStrict({
            payer,
            split,
            recipient,
            splitEscrow,
            recipientTokens,
            tokenProgram: token ? TOKEN_PROGRAM_ID : null,
            systemProgram: SystemProgram.programId,
            ...events,
          })
          .instruction(),
      )
      return ledger.build('claim_split', payer, instructions, { model: row.key.toBase58(), split: split.toBase58() }, requiredLamports)
    },
    async depositBond(enclaveKeyRaw: string, body: c.DepositBondRequest) {
      const targetKey = publicKey(enclaveKeyRaw)
      const resolved = await runtime.db.enclave.findFirst({ where: { OR: [{ address: enclaveKeyRaw }, { signingKey: enclaveKeyRaw }] }, select: { address: true } })
      const enclaveKey = resolved ? publicKey(resolved.address) : targetKey
      const entry = await enclave(enclaveKey)
      const operator = publicKey(body.wallet)
      if (!entry.operator.equals(operator)) fail('UNAUTHORIZED', 'Only the enclave operator can deposit into its bond.', { stage: 'build' })
      const amount = BigInt(body.amountLamports)
      if (amount <= 0n) fail('INVALID_BOND', 'Bond deposit amount must be positive.', { stage: 'build' })
      const bond = a.bond(enclaveKey)
      const existingInfo = await runtime.rpc.connection.getAccountInfo(bond, 'confirmed')
      const rent = existingInfo ? 0n : BigInt(await runtime.rpc.connection.getMinimumBalanceForRentExemption(BOND_SPACE))
      const instruction = await voynich.methods
        .depositBond(bn(amount))
        .accountsStrict({
          operator,
          enclave: enclaveKey,
          bond,
          systemProgram: SystemProgram.programId,
          ...events,
        })
        .instruction()
      return ledger.build('deposit_bond', operator, [instruction], { bond: bond.toBase58() }, rent + amount)
    },
    async withdrawBond(enclaveKeyRaw: string, body: c.WithdrawBondRequest) {
      const targetKey = publicKey(enclaveKeyRaw)
      const resolved = await runtime.db.enclave.findFirst({ where: { OR: [{ address: enclaveKeyRaw }, { signingKey: enclaveKeyRaw }] }, select: { address: true } })
      const enclaveKey = resolved ? publicKey(resolved.address) : targetKey
      const entry = await enclave(enclaveKey)
      const operator = publicKey(body.wallet)
      if (!entry.operator.equals(operator)) fail('UNAUTHORIZED', 'Only the enclave operator can withdraw from its bond.', { stage: 'build' })
      const amount = BigInt(body.amountLamports)
      const bond = a.bond(enclaveKey)
      const bondInfo = await runtime.rpc.connection.getAccountInfo(bond, 'confirmed')
      const chainBond = bondInfo && bondInfo.owner.equals(runtime.programId) ? decodeBondAccount(bondInfo.data) : null
      if (!chainBond) fail('BOND_NOT_FOUND', 'No operator bond is configured for this enclave.')
      if (amount <= 0n || amount > BigInt(chainBond.bondedLamports.toString())) {
        fail('INVALID_BOND', 'Withdraw amount exceeds the available bonded lamports.', { stage: 'build' })
      }
      const instruction = await voynich.methods
        .withdrawBond(bn(amount))
        .accountsStrict({
          operator,
          enclave: enclaveKey,
          bond,
          systemProgram: SystemProgram.programId,
          ...events,
        })
        .instruction()
      return ledger.build('withdraw_bond', operator, [instruction], { bond: bond.toBase58() }, 0n)
    },
  }
}
