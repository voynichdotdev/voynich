import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import anchor from '@coral-xyz/anchor'
import {
  ComputeBudgetProgram, Connection, Ed25519Program, Keypair, PublicKey, SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY, SYSVAR_SLOT_HASHES_PUBKEY, Transaction,
  type Signer, type TransactionInstruction,
} from '@solana/web3.js'
import {
  ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, createMint,
  getAssociatedTokenAddressSync, getOrCreateAssociatedTokenAccount, mintTo,
} from '@solana/spl-token'
import { IDL as VOYNICH_IDL, type Voynich } from '../sdk/src/generated/voynich.js'
import { IDL as ATTEST_IDL, type Attest } from '../sdk/src/generated/attest.js'
import { IDL as BOUNTY_IDL, type Bounty } from '../sdk/src/generated/bounty.js'
import {
  CIPHER_CHUNK_BYTES, ciphertextMerkleRoot, generateEncryptionKeyPair, pieceMessage, receiptMessage, sealWeights, sha256,
  signPiece, signReceipt, utf8, wrapKey,
} from '../sdk/src/crypto.js'
import { decodeReceiptAccount, RECEIPT_METERED_SPACE } from '../sdk/src/program.js'

const { AnchorProvider, BN, Program, Wallet } = anchor
const LOADER = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111')
const PRICE = 1_000_003n
const OPERATOR_BPS = 2500
const PROTOCOL_BPS = 500
const DEADLINE_SLOTS = 8
const MAX_REPORT_AGE_SLOTS = 64
const RECORD_LIFETIME_SLOTS = 64
const MEASUREMENT = Array.from({ length: 48 }, (_, index) => index + 1)
const bn = (value: number | bigint) => new BN(value.toString())
const pause = () => new Promise<void>(resolve => setTimeout(resolve, 100))
const pda = (program: PublicKey, ...seeds: Uint8Array[]) =>
  PublicKey.findProgramAddressSync(seeds.map(seed => Buffer.from(seed)), program)[0]
const u64le = (value: bigint) => {
  const bytes = Buffer.alloc(8)
  bytes.writeBigUInt64LE(value)
  return bytes
}

// Run against a fresh local validator with both programs deployed.
// The wallet must be both programs' upgrade authority and hold local development SOL.
test('Voynich program flows on the supplied local validator', { timeout: 180_000 }, async t => {
  const rpcUrl = process.env.ANCHOR_PROVIDER_URL ?? process.env.SOLANA_RPC_URL
  assert(rpcUrl, 'Set ANCHOR_PROVIDER_URL or SOLANA_RPC_URL to the supplied local validator')
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(rpcUrl).hostname), 'Program tests require a loopback RPC endpoint')
  const walletPath = process.env.ANCHOR_WALLET
  assert(walletPath, 'Set ANCHOR_WALLET to the local deployer keypair path')
  const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(walletPath, 'utf8')) as number[]))
  const connection = new Connection(rpcUrl, 'confirmed')
  const provider = new AnchorProvider(connection, new Wallet(admin), { commitment: 'confirmed', preflightCommitment: 'confirmed' })
  const voynich = new Program<Voynich>(VOYNICH_IDL, provider)
  const attest = new Program<Attest>(ATTEST_IDL, provider)
  const config = pda(voynich.programId, utf8('config'))
  const attestConfig = pda(attest.programId, utf8('config'))
  const owner = Keypair.generate()
  const caller = Keypair.generate()
  const feeRecipient = Keypair.generate()
  // The immutable verifier config must retain a root that setup and runtimes can use later.
  const developmentRootPath = process.env.DEV_ATTESTATION_ROOT_KEYPAIR?.trim() || '.local/keys/attest-root.json'
  let developmentRoot: Keypair
  try { developmentRoot = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(developmentRootPath, 'utf8')) as number[])) }
  catch { throw new Error('DEV_ATTESTATION_ROOT_KEYPAIR must name a readable, valid persistent development root keypair.') }
  const events = (program: PublicKey) => ({
    eventAuthority: pda(program, utf8('__event_authority')),
    program,
  })
  const configArgs = (deadline = DEADLINE_SLOTS, maxOpenAnswerBytes = 1024) => ({
    attestationProgram: attest.programId, recordLayoutVersion: 1,
    feeRecipient: feeRecipient.publicKey, protocolShareBps: PROTOCOL_BPS,
    callDeadlineSlots: bn(deadline),
    maxOpenAnswerBytes,
  })
  const execute = (instructions: TransactionInstruction[], signers: Signer[] = []) =>
    provider.sendAndConfirm(new Transaction().add(...instructions), signers)
  const transaction = async (signature: string) => {
    const row = await connection.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })
    assert(row?.meta, 'The confirmed local transaction must have balance metadata')
    return row
  }
  type ChainTransaction = Awaited<ReturnType<typeof transaction>>
  const accountIndex = (row: ChainTransaction, key: PublicKey) => {
    const index = row.transaction.message.getAccountKeys().staticAccountKeys.findIndex(item => item.equals(key))
    assert(index >= 0, `Transaction must include ${key.toBase58()}`)
    return index
  }
  const solChange = (row: ChainTransaction, key: PublicKey) => {
    assert(row.meta)
    const index = accountIndex(row, key)
    return BigInt(row.meta.postBalances[index]!) - BigInt(row.meta.preBalances[index]!)
  }
  const tokenChange = (row: ChainTransaction, key: PublicKey) => {
    assert(row.meta)
    const index = accountIndex(row, key)
    const before = row.meta.preTokenBalances?.find(item => item.accountIndex === index)
    const after = row.meta.postTokenBalances?.find(item => item.accountIndex === index)
    assert(before && after, 'The settling transaction must contain both token balance snapshots')
    return BigInt(after.uiTokenAmount.amount) - BigInt(before.uiTokenAmount.amount)
  }
  const waitPast = async (slot: bigint) => {
    while (BigInt(await connection.getSlot('confirmed')) <= slot) await pause()
  }
  const enclave = () => {
    const signing = Keypair.generate()
    return {
      signing, encryption: generateEncryptionKeyPair(), operator: Keypair.generate(),
      address: pda(voynich.programId, utf8('enclave'), signing.publicKey.toBytes()),
      record: pda(attest.programId, utf8('record'), signing.publicKey.toBytes()),
      reportSlot: -1n,
    }
  }
  const first = enclave()
  const second = enclave()
  type TestEnclave = ReturnType<typeof enclave>
  const attestEnclave = async (entry: TestEnclave) => {
    let slot: bigint
    let hash: Buffer
    for (;;) {
      const slotHashes = await connection.getAccountInfo(SYSVAR_SLOT_HASHES_PUBKEY, 'confirmed')
      assert(slotHashes && slotHashes.data.length >= 48, 'Local SlotHashes must contain a recent entry')
      slot = slotHashes.data.readBigUInt64LE(8)
      hash = slotHashes.data.subarray(16, 48)
      if (slot > entry.reportSlot) break
      await pause()
    }
    const message = Buffer.concat([
      Buffer.from(utf8('voynich/attestation/v1')), Buffer.from([1, 0]),
      entry.signing.publicKey.toBuffer(), Buffer.from(MEASUREMENT), u64le(slot), hash,
    ])
    const verify = Ed25519Program.createInstructionWithPrivateKey({ privateKey: developmentRoot.secretKey, message })
    const signatureOffset = verify.data.readUInt16LE(2)
    const signature = [...verify.data.subarray(signatureOffset, signatureOffset + 64)]
    const submit = await attest.methods.submitReport(1, 0, entry.signing.publicKey, MEASUREMENT, bn(slot), [...hash], signature, 0)
      .accountsStrict({
        payer: admin.publicKey, config: attestConfig, record: entry.record,
        slotHashes: SYSVAR_SLOT_HASHES_PUBKEY, instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
        systemProgram: SystemProgram.programId, ...events(attest.programId),
      }).instruction()
    await execute([verify, submit])
    entry.reportSlot = slot
  }
  const refresh = async (entry: TestEnclave) => {
    await attestEnclave(entry)
    await execute([await voynich.methods.refreshEnclave('http://127.0.0.1:9707')
      .accountsStrict({
        signingKey: entry.signing.publicKey, config, attestationRecord: entry.record,
        enclave: entry.address, ...events(voynich.programId),
      }).instruction()], [entry.signing])
  }
  const createModel = async (name: string, mint = PublicKey.default) => {
    const address = pda(voynich.programId, utf8('model'), utf8(name))
    const upload = Keypair.generate()
    const weights = Keypair.generate()
    const sealed = sealWeights(Uint8Array.from({ length: 128 }, (_, index) => index))
    const space = 56 + sealed.ciphertext.length
    const createWeights = SystemProgram.createAccount({
      fromPubkey: admin.publicKey, newAccountPubkey: weights.publicKey,
      lamports: await connection.getMinimumBalanceForRentExemption(space), space, programId: voynich.programId,
    })
    const create = await voynich.methods.createModel({
      name, manifest: Buffer.from(JSON.stringify({ name, inputKind: 'tensor', inputShape: [1, 4], labels: ['sample'] })),
      sizeBytes: bn(sealed.ciphertext.length), cipher: sealed.header.cipher,
      noncePrefix: [...sealed.header.noncePrefix], allowedMeasurements: [MEASUREMENT],
      price: bn(PRICE), priceMint: mint, operatorShareBps: OPERATOR_BPS,
      uploadFundingLamports: bn(10_000_000), extraUploadKeyCount: 0, base: null, priceUnit: { call: {} },
    }).accountsStrict({
      owner: owner.publicKey, uploadKey: upload.publicKey, config, model: address,
      systemProgram: SystemProgram.programId, ...events(voynich.programId),
    }).remainingAccounts([{ pubkey: weights.publicKey, isWritable: true, isSigner: false }]).instruction()
    await execute([createWeights, create], [owner, upload, weights])
    return { address, weights: weights.publicKey, upload, sealed, mint }
  }
  type TestModel = Awaited<ReturnType<typeof createModel>>
  const write = (model: TestModel, offset: number, bytes: Uint8Array) => voynich.methods.writeWeights(offset, Buffer.from(bytes))
    .accountsStrict({ uploadKey: model.upload.publicKey, model: model.address, weights: model.weights, ...events(voynich.programId) }).instruction()
  const seal = async (model: TestModel) => [
    await voynich.methods.sealModel([...model.sealed.merkleRoot])
      .accountsStrict({ owner: owner.publicKey, model: model.address, ...events(voynich.programId) })
      .remainingAccounts([{ pubkey: model.weights, isWritable: false, isSigner: false }]).instruction(),
    // The System Program returns the upload key's remainder after seal removes its authority.
    SystemProgram.transfer({
      fromPubkey: model.upload.publicKey, toPubkey: owner.publicKey,
      lamports: await connection.getBalance(model.upload.publicKey, 'confirmed'),
    }),
  ]
  const uploadAndSeal = async (model: TestModel) => {
    await execute([await write(model, 0, model.sealed.ciphertext)], [model.upload])
    await execute(await seal(model), [owner, model.upload])
  }
  const grantAddress = (model: TestModel, entry: TestEnclave) =>
    pda(voynich.programId, utf8('grant'), model.address.toBytes(), entry.address.toBytes())
  const ownerGrant = (model: TestModel, target: TestEnclave) => voynich.methods
    .grantByOwner(Buffer.from(wrapKey(model.sealed.key, target.encryption.publicKey)))
    .accountsStrict({
      owner: owner.publicKey, payer: admin.publicKey, config, model: model.address,
      targetEnclave: target.address, targetAttestationRecord: target.record,
      grant: grantAddress(model, target), systemProgram: SystemProgram.programId, ...events(voynich.programId),
    }).instruction()
  const enclaveGrant = (model: TestModel, source: TestEnclave, target: TestEnclave) => voynich.methods
    .grantByEnclave(Buffer.from(wrapKey(model.sealed.key, target.encryption.publicKey)))
    .accountsStrict({
      signingKey: source.signing.publicKey, payer: admin.publicKey, config, model: model.address,
      sourceEnclave: source.address, sourceGrant: grantAddress(model, source), sourceAttestationRecord: source.record,
      targetEnclave: target.address, targetAttestationRecord: target.record,
      grant: grantAddress(model, target), systemProgram: SystemProgram.programId, ...events(voynich.programId),
    }).instruction()
  let nonce = 0n
  const callArgs = (model: TestModel) => {
    const value = ++nonce
    const address = pda(voynich.programId, utf8('call'), caller.publicKey.toBytes(), u64le(value))
    return { address, nonce: value, model, inputHash: sha256(utf8(`input-${value}`)) }
  }
  type TestCall = ReturnType<typeof callArgs>
  const openInstruction = (call: TestCall, answerMode: 'sealed' | 'open' = 'sealed') => {
    const token = !call.model.mint.equals(PublicKey.default)
    const mode = answerMode === 'open' ? { open: {} } : { sealed: {} }
    return voynich.methods.openCall(bn(call.nonce), [...call.inputHash], mode, null).accountsStrict({
      payer: caller.publicKey, caller: caller.publicKey, config, model: call.model.address, enclave: first.address,
      attestationRecord: first.record, grant: grantAddress(call.model, first), call: call.address,
      mint: token ? call.model.mint : null,
      callerTokens: token ? getAssociatedTokenAddressSync(call.model.mint, caller.publicKey) : null,
      escrowTokens: token ? getAssociatedTokenAddressSync(call.model.mint, call.address, true) : null,
      tokenProgram: token ? TOKEN_PROGRAM_ID : null,
      associatedTokenProgram: token ? ASSOCIATED_TOKEN_PROGRAM_ID : null,
      systemProgram: SystemProgram.programId, ...events(voynich.programId),
    }).instruction()
  }
  const open = async (model: TestModel, answerMode: 'sealed' | 'open' = 'sealed') => {
    const call = callArgs(model)
    await execute([await openInstruction(call, answerMode)], [caller])
    return call
  }
  const settleInstructions = async (call: TestCall, opts: {
    openAnswer?: Uint8Array
    outputHash?: Uint8Array
    callerKey?: PublicKey
    baseSha256?: Uint8Array | null
    remainingAccounts?: { pubkey: PublicKey; isWritable: boolean; isSigner: boolean }[]
  } = {}) => {
    const openAnswer = opts.openAnswer ?? new Uint8Array(0)
    const callerKey = opts.callerKey ?? caller.publicKey
    const outputHash = opts.outputHash ?? (openAnswer.length > 0 ? sha256(openAnswer) : sha256(utf8(`output-${call.nonce}`)))
    const signature = signReceipt(first.signing.secretKey.subarray(0, 32), call.address.toBytes(), call.inputHash, outputHash, opts.baseSha256)
    const verify = Ed25519Program.createInstructionWithPublicKey({
      publicKey: first.signing.publicKey.toBytes(),
      message: receiptMessage(call.address.toBytes(), call.inputHash, outputHash, opts.baseSha256), signature,
    })
    const token = !call.model.mint.equals(PublicKey.default)
    const receipt = pda(voynich.programId, utf8('receipt'), call.address.toBytes())
    const settle = await voynich.methods.settleCall([...outputHash], [...signature], 0, Buffer.from(openAnswer)).accountsStrict({
      payer: admin.publicKey, config, model: call.model.address, enclave: first.address,
      attestationRecord: first.record, call: call.address, receipt,
      caller: callerKey, owner: owner.publicKey, operator: first.operator.publicKey,
      feeRecipient: feeRecipient.publicKey, instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      escrowTokens: token ? getAssociatedTokenAddressSync(call.model.mint, call.address, true) : null,
      ownerTokens: token ? getAssociatedTokenAddressSync(call.model.mint, owner.publicKey) : null,
      operatorTokens: token ? getAssociatedTokenAddressSync(call.model.mint, first.operator.publicKey) : null,
      protocolTokens: token ? getAssociatedTokenAddressSync(call.model.mint, feeRecipient.publicKey) : null,
      callerTokens: token ? getAssociatedTokenAddressSync(call.model.mint, callerKey, true) : null,
      tokenProgram: token ? TOKEN_PROGRAM_ID : null,
      systemProgram: SystemProgram.programId, ...events(voynich.programId),
    }).remainingAccounts(opts.remainingAccounts ?? []).instruction()
    return { instructions: [verify, settle], receipt, outputHash }
  }

  // Setup uses a distinct fee/rent payer, so receipt recipient deltas are the split itself.
  await execute([owner, caller, feeRecipient, first.operator, second.operator, first.signing, second.signing].map(key =>
    SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: key.publicKey, lamports: 1_000_000_000 })))
  await execute([await attest.methods.initialize(developmentRoot.publicKey, bn(MAX_REPORT_AGE_SLOTS), bn(RECORD_LIFETIME_SLOTS)).accountsStrict({
    admin: admin.publicKey, config: attestConfig, selfProgram: attest.programId,
    programData: pda(LOADER, attest.programId.toBytes()), systemProgram: SystemProgram.programId, ...events(attest.programId),
  }).instruction()])
  await execute([await voynich.methods.initialize(configArgs()).accountsStrict({
    admin: admin.publicKey, config, programAccount: voynich.programId,
    programData: pda(LOADER, voynich.programId.toBytes()), systemProgram: SystemProgram.programId, ...events(voynich.programId),
  }).instruction()])

  let solModel: TestModel
  let tokenModel: TestModel
  let baseModel: TestModel
  const baseModelSha = sha256(utf8('open-base-weights-v1'))

  await t.test('seal: create, write, seal, retain the hash, and refuse later writes', async () => {
    solModel = await createModel('program-test-sol')
    const created = await voynich.account.model.fetch(solModel.address)
    assert.deepEqual(created.status, { uploading: {} })
    const half = solModel.sealed.ciphertext.length / 2
    await execute([await write(solModel, 0, solModel.sealed.ciphertext.subarray(0, half))], [solModel.upload])
    await execute([await write(solModel, half, solModel.sealed.ciphertext.subarray(half))], [solModel.upload])
    await execute(await seal(solModel), [owner, solModel.upload])
    const sealedModel = await voynich.account.model.fetch(solModel.address)
    assert.deepEqual(sealedModel.status, { sealed: {} })
    assert(sealedModel.uploadKey.equals(PublicKey.default))
    assert.equal(await connection.getBalance(solModel.upload.publicKey, 'confirmed'), 0)
    assert.deepEqual(Buffer.from(sealedModel.ciphertextSha256), Buffer.from(solModel.sealed.merkleRoot))
    await assert.rejects(execute([await write(solModel, 0, Uint8Array.of(255))], [solModel.upload]), /Unauthorized/)
    const after = await voynich.account.model.fetch(solModel.address)
    assert.deepEqual(Buffer.from(after.ciphertextSha256), Buffer.from(solModel.sealed.merkleRoot))
    const weights = await connection.getAccountInfo(solModel.weights, 'confirmed')
    assert(weights)
    assert.deepEqual(weights.data.subarray(56), Buffer.from(solModel.sealed.ciphertext))
  })

  await t.test('multi-key sealing: create_model with 4 upload keys, concurrent writes, unauthorized rejection, and seal clearing upload_keys', async () => {
    const name = 'program-test-multikey'
    const address = pda(voynich.programId, utf8('model'), utf8(name))
    const uploadKeys = Array.from({ length: 4 }, () => Keypair.generate())
    const rogueKey = Keypair.generate()
    const weightsKey = Keypair.generate()
    const sealed = sealWeights(Uint8Array.from({ length: 256 }, (_, index) => (index * 7) & 255))
    const space = 56 + sealed.ciphertext.length
    const funding = 12_000_003n // intentionally non-divisible by 4 to test remainder -> primary key
    const createWeights = SystemProgram.createAccount({
      fromPubkey: admin.publicKey, newAccountPubkey: weightsKey.publicKey,
      lamports: await connection.getMinimumBalanceForRentExemption(space), space, programId: voynich.programId,
    })
    const createIx = await voynich.methods.createModel({
      name, manifest: Buffer.from(JSON.stringify({ name, inputKind: 'tensor', inputShape: [1, 4], labels: ['sample'] })),
      sizeBytes: bn(sealed.ciphertext.length), cipher: sealed.header.cipher,
      noncePrefix: [...sealed.header.noncePrefix], allowedMeasurements: [MEASUREMENT],
      price: bn(PRICE), priceMint: PublicKey.default, operatorShareBps: OPERATOR_BPS,
      uploadFundingLamports: bn(funding), extraUploadKeyCount: 3, base: null, priceUnit: { call: {} },
    }).accountsStrict({
      owner: owner.publicKey, uploadKey: uploadKeys[0]!.publicKey, config, model: address,
      systemProgram: SystemProgram.programId, ...events(voynich.programId),
    }).remainingAccounts([
      { pubkey: weightsKey.publicKey, isWritable: true, isSigner: false },
      ...uploadKeys.slice(1).map(pair => ({ pubkey: pair.publicKey, isWritable: true, isSigner: false })),
    ]).instruction()
    await execute([createWeights, createIx], [owner, uploadKeys[0]!, weightsKey])

    // Verify funding split (primary gets base + remainder; extras get base) and stored uploadKeys.
    const created = await voynich.account.model.fetch(address)
    assert(created.uploadKey.equals(uploadKeys[0]!.publicKey))
    assert.equal(created.uploadKeys.length, 4)
    for (let i = 0; i < 4; i++) assert(created.uploadKeys[i]!.equals(uploadKeys[i]!.publicKey))
    assert.equal(BigInt(await connection.getBalance(uploadKeys[0]!.publicKey, 'confirmed')), funding / 4n + (funding % 4n))
    for (let i = 1; i < 4; i++) assert.equal(BigInt(await connection.getBalance(uploadKeys[i]!.publicKey, 'confirmed')), funding / 4n)

    // Write 4 disjoint slices concurrently across all 4 upload keys.
    const quarter = Math.ceil(sealed.ciphertext.length / 4)
    await Promise.all(uploadKeys.map(async (pair, index) => {
      const start = index * quarter
      const slice = sealed.ciphertext.subarray(start, Math.min(sealed.ciphertext.length, start + quarter))
      const ix = await voynich.methods.writeWeights(start, Buffer.from(slice)).accountsStrict({
        uploadKey: pair.publicKey, model: address, weights: weightsKey.publicKey, ...events(voynich.programId),
      }).instruction()
      await execute([ix], [pair])
    }))

    // Unauthorized 5th key must be rejected.
    await assert.rejects(
      execute([await voynich.methods.writeWeights(0, Buffer.from([1])).accountsStrict({
        uploadKey: rogueKey.publicKey, model: address, weights: weightsKey.publicKey, ...events(voynich.programId),
      }).instruction()], [rogueKey]),
      /Unauthorized/,
    )

    // Extra keys self-sweep back to owner before seal_model; primary sweeps inside seal_model.
    for (const extra of uploadKeys.slice(1)) {
      const bal = await connection.getBalance(extra.publicKey, 'confirmed')
      await execute([SystemProgram.transfer({ fromPubkey: extra.publicKey, toPubkey: owner.publicKey, lamports: bal })], [extra])
      assert.equal(await connection.getBalance(extra.publicKey, 'confirmed'), 0)
    }
    const primaryRemainder = await connection.getBalance(uploadKeys[0]!.publicKey, 'confirmed')
    await execute([
      await voynich.methods.sealModel([...sealed.merkleRoot]).accountsStrict({
        owner: owner.publicKey, model: address, ...events(voynich.programId),
      }).remainingAccounts([{ pubkey: weightsKey.publicKey, isWritable: false, isSigner: false }]).instruction(),
      SystemProgram.transfer({ fromPubkey: uploadKeys[0]!.publicKey, toPubkey: owner.publicKey, lamports: primaryRemainder }),
    ], [owner, uploadKeys[0]!])

    const sealedAccount = await voynich.account.model.fetch(address)
    assert.deepEqual(sealedAccount.status, { sealed: {} })
    assert(sealedAccount.uploadKey.equals(PublicKey.default))
    assert.equal(sealedAccount.uploadKeys.length, 0)
    await assert.rejects(
      execute([await voynich.methods.writeWeights(0, Buffer.from([2])).accountsStrict({
        uploadKey: uploadKeys[2]!.publicKey, model: address, weights: weightsKey.publicKey, ...events(voynich.programId),
      }).instruction()], [uploadKeys[2]!]),
      /Unauthorized/,
    )
  })

  await t.test('range sealing (10 weights accounts > 8): attach_weights across boundaries + seal_range + zero-remaining seal_model', async () => {
    const name = 'program-test-ten-weights'
    const address = pda(voynich.programId, utf8('model'), utf8(name))
    const uploadKey = Keypair.generate()
    // 10 accounts * 13,111 bytes = 131,110 bytes (> 2 full 65,552B chunks, forcing chunks to cross multiple account boundaries).
    const perAccount = 13_111
    const totalBytes = perAccount * 10
    const ciphertext = new Uint8Array(totalBytes)
    for (let i = 0; i < 10; i++) {
      ciphertext[i * perAccount] = (i * 19 + 3) & 255
      ciphertext[(i + 1) * perAccount - 1] = (i * 31 + 11) & 255
    }
    const expectedRoot = ciphertextMerkleRoot(ciphertext)
    const weightsKeys = Array.from({ length: 10 }, () => Keypair.generate())
    const accountSpace = 56 + perAccount
    const rent = await connection.getMinimumBalanceForRentExemption(accountSpace)
    for (let i = 0; i < 10; i += 2) {
      const pair = weightsKeys.slice(i, i + 2)
      await execute(pair.map(k => SystemProgram.createAccount({
        fromPubkey: admin.publicKey, newAccountPubkey: k.publicKey, lamports: rent, space: accountSpace, programId: voynich.programId,
      })), pair)
    }
    // Attach 2 weights accounts in create_model, then 8 more via attach_weights.
    await execute([await voynich.methods.createModel({
      name, manifest: Buffer.from(JSON.stringify({ name, inputKind: 'tensor', inputShape: [1, 4], labels: ['sample'] })),
      sizeBytes: bn(totalBytes), cipher: 'xchacha20poly1305-64k-v1',
      noncePrefix: Array(16).fill(5), allowedMeasurements: [MEASUREMENT],
      price: bn(PRICE), priceMint: PublicKey.default, operatorShareBps: OPERATOR_BPS,
      uploadFundingLamports: bn(20_000_000), extraUploadKeyCount: 0, base: null, priceUnit: { call: {} },
    }).accountsStrict({
      owner: owner.publicKey, uploadKey: uploadKey.publicKey, config, model: address,
      systemProgram: SystemProgram.programId, ...events(voynich.programId),
    }).remainingAccounts(weightsKeys.slice(0, 2).map(k => ({ pubkey: k.publicKey, isWritable: true, isSigner: false }))).instruction()], [owner, uploadKey])

    await execute([await voynich.methods.attachWeights().accountsStrict({
      uploadKey: uploadKey.publicKey, model: address, ...events(voynich.programId),
    }).remainingAccounts([
      { pubkey: weightsKeys[1]!.publicKey, isWritable: false, isSigner: false },
      ...weightsKeys.slice(2).map(k => ({ pubkey: k.publicKey, isWritable: true, isSigner: false })),
    ]).instruction()], [uploadKey])

    const afterAttach = await voynich.account.model.fetch(address)
    assert.equal(afterAttach.weights.length, 10)
    assert.equal(afterAttach.hashVersion, 1)

    // Write first and last byte of each of the 10 accounts so written_bytes == perAccount and bytes match ciphertext.
    for (let i = 0; i < 10; i++) {
      const startByte = ciphertext.subarray(i * perAccount, i * perAccount + 1)
      const endByte = ciphertext.subarray((i + 1) * perAccount - 1, (i + 1) * perAccount)
      await execute([
        await voynich.methods.writeWeights(0, Buffer.from(startByte)).accountsStrict({
          uploadKey: uploadKey.publicKey, model: address, weights: weightsKeys[i]!.publicKey, ...events(voynich.programId),
        }).instruction(),
        await voynich.methods.writeWeights(perAccount - 1, Buffer.from(endByte)).accountsStrict({
          uploadKey: uploadKey.publicKey, model: address, weights: weightsKeys[i]!.publicKey, ...events(voynich.programId),
        }).instruction(),
      ], [uploadKey])
    }

    // Seal chunk 0 (bytes 0..65552 -> accounts 0..4), chunk 1 (bytes 65552..131104 -> accounts 4..9), chunk 2 (bytes 131104..131110 -> account 9).
    await execute([await voynich.methods.sealRange(1).accountsStrict({
      uploadKey: uploadKey.publicKey, model: address, ...events(voynich.programId),
    }).remainingAccounts(weightsKeys.slice(0, 5).map(k => ({ pubkey: k.publicKey, isWritable: false, isSigner: false }))).instruction()], [uploadKey])

    await execute([await voynich.methods.sealRange(2).accountsStrict({
      uploadKey: uploadKey.publicKey, model: address, ...events(voynich.programId),
    }).remainingAccounts(weightsKeys.slice(4, 10).map(k => ({ pubkey: k.publicKey, isWritable: false, isSigner: false }))).instruction()], [uploadKey])

    // All 3 chunks already hashed -> seal_model succeeds with EMPTY remainingAccounts!
    const primaryRemainder = await connection.getBalance(uploadKey.publicKey, 'confirmed')
    await execute([
      await voynich.methods.sealModel([...expectedRoot]).accountsStrict({
        owner: owner.publicKey, model: address, ...events(voynich.programId),
      }).remainingAccounts([]).instruction(),
      SystemProgram.transfer({ fromPubkey: uploadKey.publicKey, toPubkey: owner.publicKey, lamports: primaryRemainder }),
    ], [owner, uploadKey])

    const sealedTen = await voynich.account.model.fetch(address)
    assert.deepEqual(sealedTen.status, { sealed: {} })
    assert.equal(sealedTen.weights.length, 10)
    assert.equal(sealedTen.sealedChunks, 3)
    assert.equal(sealedTen.merkleFrontier.length, 0)
    assert.deepEqual(Buffer.from(sealedTen.ciphertextSha256), Buffer.from(expectedRoot))
  })

  await t.test('range sealing (2 MiB / 32 chunks): 4x seal_range(8) + seal_model within compute budget', async () => {
    const name = 'program-test-two-mib'
    const address = pda(voynich.programId, utf8('model'), utf8(name))
    const uploadKey = Keypair.generate()
    const weightsKey = Keypair.generate()
    const totalBytes = 32 * CIPHER_CHUNK_BYTES // 2,097,664 bytes (> 2 MiB, 32 exact chunks)
    const ciphertext = new Uint8Array(totalBytes)
    ciphertext[0] = 0x55
    ciphertext[16 * CIPHER_CHUNK_BYTES] = 0x77
    ciphertext[totalBytes - 1] = 0xaa
    const expectedRoot = ciphertextMerkleRoot(ciphertext)
    const space = 56 + totalBytes
    await execute([SystemProgram.createAccount({
      fromPubkey: admin.publicKey, newAccountPubkey: weightsKey.publicKey,
      lamports: await connection.getMinimumBalanceForRentExemption(space), space, programId: voynich.programId,
    })], [weightsKey])
    await execute([await voynich.methods.createModel({
      name, manifest: Buffer.from(JSON.stringify({ name, inputKind: 'tensor', inputShape: [1, 4], labels: ['sample'] })),
      sizeBytes: bn(totalBytes), cipher: 'xchacha20poly1305-64k-v1',
      noncePrefix: Array(16).fill(9), allowedMeasurements: [MEASUREMENT],
      price: bn(PRICE), priceMint: PublicKey.default, operatorShareBps: OPERATOR_BPS,
      uploadFundingLamports: bn(20_000_000), extraUploadKeyCount: 0, base: null, priceUnit: { call: {} },
    }).accountsStrict({
      owner: owner.publicKey, uploadKey: uploadKey.publicKey, config, model: address,
      systemProgram: SystemProgram.programId, ...events(voynich.programId),
    }).remainingAccounts([{ pubkey: weightsKey.publicKey, isWritable: true, isSigner: false }]).instruction()], [owner, uploadKey])

    // Write the 3 non-zero marker bytes (final write sets written_bytes = totalBytes).
    for (const [offset, byte] of [[0, 0x55], [16 * CIPHER_CHUNK_BYTES, 0x77], [totalBytes - 1, 0xaa]] as const) {
      await execute([await voynich.methods.writeWeights(offset, Buffer.from([byte])).accountsStrict({
        uploadKey: uploadKey.publicKey, model: address, weights: weightsKey.publicKey, ...events(voynich.programId),
      }).instruction()], [uploadKey])
    }

    // 3x seal_range(8) = 24 chunks, leaving 8 chunks for seal_model inline (matching SDK path).
    for (let batch = 0; batch < 3; batch++) {
      await execute([
        ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
        await voynich.methods.sealRange(8).accountsStrict({
          uploadKey: uploadKey.publicKey, model: address, ...events(voynich.programId),
        }).remainingAccounts([{ pubkey: weightsKey.publicKey, isWritable: false, isSigner: false }]).instruction(),
      ], [uploadKey])
    }
    const mid = await voynich.account.model.fetch(address)
    assert.equal(mid.sealedChunks, 24)

    const primaryRemainder = await connection.getBalance(uploadKey.publicKey, 'confirmed')
    await execute([
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
      await voynich.methods.sealModel([...expectedRoot]).accountsStrict({
        owner: owner.publicKey, model: address, ...events(voynich.programId),
      }).remainingAccounts([{ pubkey: weightsKey.publicKey, isWritable: false, isSigner: false }]).instruction(),
      SystemProgram.transfer({ fromPubkey: uploadKey.publicKey, toPubkey: owner.publicKey, lamports: primaryRemainder }),
    ], [owner, uploadKey])

    const sealedTwo = await voynich.account.model.fetch(address)
    assert.deepEqual(sealedTwo.status, { sealed: {} })
    assert.equal(sealedTwo.sealedChunks, 32)
    assert.equal(sealedTwo.merkleFrontier.length, 0)
    assert.deepEqual(Buffer.from(sealedTwo.ciphertextSha256), Buffer.from(expectedRoot))
    assert.equal(sealedTwo.base, null)
  })

  await t.test('base on model: create_model with ModelBase, reject invalid base, and emit base_sha256 on seal_model', async () => {
    const name = 'program-test-base-model'
    const address = pda(voynich.programId, utf8('model'), utf8(name))
    const uploadKey = Keypair.generate()
    const weightsKey = Keypair.generate()
    const sealed = sealWeights(Uint8Array.from({ length: 128 }, (_, i) => (i * 11 + 3) & 255))
    const space = 56 + sealed.ciphertext.length
    await execute([SystemProgram.createAccount({
      fromPubkey: admin.publicKey, newAccountPubkey: weightsKey.publicKey,
      lamports: await connection.getMinimumBalanceForRentExemption(space), space, programId: voynich.programId,
    })], [weightsKey])

    const validBase = {
      sha256: Array.from(baseModelSha),
      sizeBytes: bn(4_294_967_296n),
      format: 'safetensors',
      source: 'hf://voynich/open-base/model.safetensors',
    }

    // Invalid base (zero hash, bad format, bad scheme) must be rejected before creating the model.
    for (const badBase of [
      { ...validBase, sha256: Array(32).fill(0) },
      { ...validBase, sizeBytes: bn(0) },
      { ...validBase, format: 'pt' },
      { ...validBase, source: 'file:///etc/passwd' },
    ]) {
      await assert.rejects(
        execute([await voynich.methods.createModel({
          name, manifest: Buffer.from(JSON.stringify({ name, inputKind: 'tensor', inputShape: [1, 4], labels: ['sample'] })),
          sizeBytes: bn(sealed.ciphertext.length), cipher: sealed.header.cipher,
          noncePrefix: [...sealed.header.noncePrefix], allowedMeasurements: [MEASUREMENT],
          price: bn(PRICE), priceMint: PublicKey.default, operatorShareBps: OPERATOR_BPS,
          uploadFundingLamports: bn(10_000_000), extraUploadKeyCount: 0, base: badBase, priceUnit: { call: {} },
        }).accountsStrict({
          owner: owner.publicKey, uploadKey: uploadKey.publicKey, config, model: address,
          systemProgram: SystemProgram.programId, ...events(voynich.programId),
        }).remainingAccounts([{ pubkey: weightsKey.publicKey, isWritable: true, isSigner: false }]).instruction()], [owner, uploadKey]),
        /InvalidModel/,
      )
    }

    await execute([await voynich.methods.createModel({
      name, manifest: Buffer.from(JSON.stringify({ name, inputKind: 'tensor', inputShape: [1, 4], labels: ['sample'] })),
      sizeBytes: bn(sealed.ciphertext.length), cipher: sealed.header.cipher,
      noncePrefix: [...sealed.header.noncePrefix], allowedMeasurements: [MEASUREMENT],
      price: bn(PRICE), priceMint: PublicKey.default, operatorShareBps: OPERATOR_BPS,
      uploadFundingLamports: bn(10_000_000), extraUploadKeyCount: 0, base: validBase, priceUnit: { call: {} },
    }).accountsStrict({
      owner: owner.publicKey, uploadKey: uploadKey.publicKey, config, model: address,
      systemProgram: SystemProgram.programId, ...events(voynich.programId),
    }).remainingAccounts([{ pubkey: weightsKey.publicKey, isWritable: true, isSigner: false }]).instruction()], [owner, uploadKey])

    const created = await voynich.account.model.fetch(address)
    assert(created.base, 'Model account must store ModelBase')
    assert.deepEqual(created.base.sha256, validBase.sha256)
    assert.equal(created.base.sizeBytes.toString(), '4294967296')
    assert.equal(created.base.format, 'safetensors')
    assert.equal(created.base.source, 'hf://voynich/open-base/model.safetensors')

    await execute([await voynich.methods.writeWeights(0, Buffer.from(sealed.ciphertext)).accountsStrict({
      uploadKey: uploadKey.publicKey, model: address, weights: weightsKey.publicKey, ...events(voynich.programId),
    }).instruction()], [uploadKey])

    const remainder = await connection.getBalance(uploadKey.publicKey, 'confirmed')
    const sealSig = await execute([
      await voynich.methods.sealModel([...sealed.merkleRoot]).accountsStrict({
        owner: owner.publicKey, model: address, ...events(voynich.programId),
      }).remainingAccounts([{ pubkey: weightsKey.publicKey, isWritable: false, isSigner: false }]).instruction(),
      SystemProgram.transfer({ fromPubkey: uploadKey.publicKey, toPubkey: owner.publicKey, lamports: remainder }),
    ], [owner, uploadKey])

    const sealedModel = await voynich.account.model.fetch(address)
    assert.deepEqual(sealedModel.status, { sealed: {} })
    assert(sealedModel.base)
    assert.deepEqual(sealedModel.base.sha256, validBase.sha256)

    // Verify ModelSealed CPI event carries base_sha256 = Some(validBase.sha256).
    const txRow = await transaction(sealSig)
    const inner = txRow.meta?.innerInstructions?.flatMap(group => group.instructions) ?? []
    const bs58Mod = await import('@coral-xyz/anchor/dist/cjs/utils/bytes/bs58.js')
    const base58Decode = (bs58Mod.default?.decode ?? (bs58Mod as unknown as { decode: (v: string) => Uint8Array }).decode)
    let foundBaseSha: number[] | null = null
    for (const ix of inner) {
      const raw = Buffer.from(base58Decode(ix.data))
      if (raw.length > 8) {
        const decoded = voynich.coder.events.decode(raw.subarray(8).toString('base64'))
        if (decoded?.name === 'modelSealed') {
          foundBaseSha = (decoded.data as { baseSha256: number[] | null }).baseSha256
        }
      }
    }
    assert.deepEqual(foundBaseSha, validBase.sha256, 'ModelSealed event must emit base_sha256 matching Model.base.sha256')
    baseModel = { address, weights: weightsKey.publicKey, upload: uploadKey, sealed, mint: PublicKey.default }
  })

  await t.test('register enclaves from unexpired attestation records', async () => {
    for (const entry of [first, second]) {
      await attestEnclave(entry)
      await execute([await voynich.methods.registerEnclave([...entry.encryption.publicKey], 'http://127.0.0.1:9707')
        .accountsStrict({
          operator: entry.operator.publicKey, signingKey: entry.signing.publicKey, config,
          attestationRecord: entry.record, enclave: entry.address,
          systemProgram: SystemProgram.programId, ...events(voynich.programId),
        }).instruction()], [entry.operator, entry.signing])
      const registered = await voynich.account.enclave.fetch(entry.address)
      const record = await attest.account.attestationRecord.fetch(entry.record)
      assert(registered.signingKey.equals(entry.signing.publicKey))
      assert.deepEqual(Buffer.from(registered.encryptionKey), Buffer.from(entry.encryption.publicKey))
      assert.equal(registered.expiresAtSlot.toString(), record.expiresAtSlot.toString())
    }
  })

  await t.test('grant by owner and by an already granted enclave', async () => {
    await execute([await ownerGrant(solModel, first)], [owner])
    await execute([await enclaveGrant(solModel, first, second)], [first.signing])
    const ownerGranted = await voynich.account.grant.fetch(grantAddress(solModel, first))
    const delegated = await voynich.account.grant.fetch(grantAddress(solModel, second))
    assert(ownerGranted.grantedBy.equals(owner.publicKey))
    assert(delegated.grantedBy.equals(first.address))
    assert.equal(delegated.revoked, false)
    assert.deepEqual((await voynich.account.model.fetch(solModel.address)).status, { live: {} })
  })

  await t.test('call and settle: check SOL and SPL splits from each settling transaction', async () => {
    const expectedOperator = PRICE * BigInt(OPERATOR_BPS) / 10_000n
    const expectedProtocol = PRICE * BigInt(PROTOCOL_BPS) / 10_000n
    const expectedOwner = PRICE - expectedOperator - expectedProtocol
    await refresh(first)
    const nativeCall = await open(solModel)
    const nativeSettlement = await settleInstructions(nativeCall)
    const nativeTransaction = await transaction(await execute(nativeSettlement.instructions))
    assert.equal(solChange(nativeTransaction, owner.publicKey), expectedOwner)
    assert.equal(solChange(nativeTransaction, first.operator.publicKey), expectedOperator)
    assert.equal(solChange(nativeTransaction, feeRecipient.publicKey), expectedProtocol)
    const nativeReceipt = await voynich.account.receipt.fetch(nativeSettlement.receipt)
    assert.equal(nativeReceipt.ownerAmount.toString(), expectedOwner.toString())
    assert.equal(nativeReceipt.operatorAmount.toString(), expectedOperator.toString())
    assert.equal(nativeReceipt.protocolAmount.toString(), expectedProtocol.toString())
    assert.deepEqual((await voynich.account.call.fetch(nativeCall.address)).status, { settled: {} })

    const mint = await createMint(connection, admin, admin.publicKey, null, 6, undefined, { commitment: 'confirmed' })
    for (const recipient of [owner.publicKey, first.operator.publicKey, feeRecipient.publicKey, caller.publicKey]) {
      await getOrCreateAssociatedTokenAccount(connection, admin, mint, recipient, false, 'confirmed', { commitment: 'confirmed' })
    }
    await mintTo(connection, admin, mint, getAssociatedTokenAddressSync(mint, caller.publicKey), admin, PRICE * 3n, [], { commitment: 'confirmed' })
    tokenModel = await createModel('program-test-token', mint)
    await uploadAndSeal(tokenModel)
    await refresh(first)
    await execute([await ownerGrant(tokenModel, first)], [owner])
    const tokenCall = await open(tokenModel)
    const tokenSettlement = await settleInstructions(tokenCall)
    const tokenTransaction = await transaction(await execute(tokenSettlement.instructions))
    assert.equal(tokenChange(tokenTransaction, getAssociatedTokenAddressSync(mint, owner.publicKey)), expectedOwner)
    assert.equal(tokenChange(tokenTransaction, getAssociatedTokenAddressSync(mint, first.operator.publicKey)), expectedOperator)
    assert.equal(tokenChange(tokenTransaction, getAssociatedTokenAddressSync(mint, feeRecipient.publicKey)), expectedProtocol)
    assert.deepEqual((await voynich.account.call.fetch(tokenCall.address)).status, { settled: {} })
  })

  await t.test('open answers: verify open settlement, hash mismatch, size limit, and sealed rejection', async () => {
    await refresh(first)
    const openCall = await open(solModel, 'open')
    const openCallAccount = await voynich.account.call.fetch(openCall.address)
    assert.deepEqual(openCallAccount.answerMode, { open: {} })

    // Empty open_answer rejected on open call
    const emptySettle = await settleInstructions(openCall, { openAnswer: new Uint8Array(0) })
    await assert.rejects(execute(emptySettle.instructions), /InvalidOpenAnswer/)

    // Hash mismatch rejected on open call
    const validPayload = utf8(JSON.stringify({ label: 'clock', probability: 0.97 }))
    const mismatchedSettle = await settleInstructions(openCall, {
      openAnswer: validPayload,
      outputHash: sha256(utf8('different-answer')),
    })
    await assert.rejects(execute(mismatchedSettle.instructions), /InvalidOpenAnswer/)

    // Oversized payload rejected against Config.max_open_answer_bytes
    await execute([await voynich.methods.setConfig(configArgs(DEADLINE_SLOTS, 16)).accountsStrict({
      admin: admin.publicKey, config, ...events(voynich.programId),
    }).instruction()])
    const oversizedSettle = await settleInstructions(openCall, { openAnswer: validPayload })
    await assert.rejects(execute(oversizedSettle.instructions), /InvalidOpenAnswer/)
    await execute([await voynich.methods.setConfig(configArgs(DEADLINE_SLOTS, 1024)).accountsStrict({
      admin: admin.publicKey, config, ...events(voynich.programId),
    }).instruction()])

    // Valid open answer settles and stores exact bytes on Receipt
    const validSettle = await settleInstructions(openCall, { openAnswer: validPayload })
    await execute(validSettle.instructions)
    const openReceipt = await voynich.account.receipt.fetch(validSettle.receipt)
    assert.deepEqual(openReceipt.answerMode, { open: {} })
    assert.deepEqual(Buffer.from(openReceipt.openAnswer), Buffer.from(validPayload))
    assert.deepEqual(Buffer.from(openReceipt.outputHash), Buffer.from(sha256(validPayload)))

    // Non-empty open_answer rejected on sealed call
    await refresh(first)
    const sealedCall = await open(solModel, 'sealed')
    const badSealedSettle = await settleInstructions(sealedCall, { openAnswer: validPayload })
    await assert.rejects(execute(badSealedSettle.instructions), /InvalidOpenAnswer/)
    const goodSealedSettle = await settleInstructions(sealedCall)
    await execute(goodSealedSettle.instructions)
    const sealedReceipt = await voynich.account.receipt.fetch(goodSealedSettle.receipt)
    assert.deepEqual(sealedReceipt.answerMode, { sealed: {} })
    assert.equal(sealedReceipt.openAnswer.length, 0)
  })

  await t.test('receipt v2 base commitment: settle_call enforces voynich/receipt/v2 when Model.base is Some and rejects v1 or wrong base', async () => {
    await refresh(first)
    await execute([await ownerGrant(baseModel, first)], [owner])
    const baseCall = await open(baseModel, 'sealed')

    // Legacy v1 signature must be rejected on a model with Model.base = Some(...).
    const v1Settle = await settleInstructions(baseCall)
    await assert.rejects(execute(v1Settle.instructions), /InvalidSignature/)

    // Wrong base SHA-256 in v2 message must be rejected.
    const wrongBaseSettle = await settleInstructions(baseCall, { baseSha256: Uint8Array.from({ length: 32 }, () => 0x99) })
    await assert.rejects(execute(wrongBaseSettle.instructions), /InvalidSignature/)

    // Matching v2 signature settles cleanly with unchanged 407B Receipt layout.
    const v2Settle = await settleInstructions(baseCall, { baseSha256: baseModelSha })
    await execute(v2Settle.instructions)
    const receiptInfo = await connection.getAccountInfo(v2Settle.receipt, 'confirmed')
    assert.equal(receiptInfo?.data.length, 407)
    const settledCall = await voynich.account.call.fetch(baseCall.address)
    assert.deepEqual(settledCall.status, { settled: {} })
  })

  await t.test('set_allowed_measurements and migrate_config validation', async () => {
    const secondMeasurement = Array.from({ length: 48 }, (_, index) => 200 - index)
    await assert.rejects(
      execute([await voynich.methods.setAllowedMeasurements([MEASUREMENT, secondMeasurement]).accountsStrict({
        owner: caller.publicKey, config, model: solModel.address, ...events(voynich.programId),
      }).instruction()], [caller]),
      /Unauthorized/,
    )
    await assert.rejects(
      execute([await voynich.methods.setAllowedMeasurements([]).accountsStrict({
        owner: owner.publicKey, config, model: solModel.address, ...events(voynich.programId),
      }).instruction()], [owner]),
      /InvalidModel/,
    )
    await execute([await voynich.methods.setAllowedMeasurements([MEASUREMENT, secondMeasurement]).accountsStrict({
      owner: owner.publicKey, config, model: solModel.address, ...events(voynich.programId),
    }).instruction()], [owner])
    const updatedModel = await voynich.account.model.fetch(solModel.address)
    assert.equal(updatedModel.allowedMeasurements.length, 2)
    assert.deepEqual(updatedModel.allowedMeasurements[1], secondMeasurement)
    await execute([await voynich.methods.setAllowedMeasurements([MEASUREMENT]).accountsStrict({
      owner: owner.publicKey, config, model: solModel.address, ...events(voynich.programId),
    }).instruction()], [owner])

    // Already-118B Config rejects migrate_config with InvalidConfig
    await assert.rejects(
      execute([await voynich.methods.migrateConfig(1024).accountsStrict({
        admin: admin.publicKey, config, systemProgram: SystemProgram.programId, ...events(voynich.programId),
      }).instruction()]),
      /InvalidConfig/,
    )
  })

  await t.test('program caller via CPI: open_call, settle_call with caller_is_program, and refund_call (SOL & SPL)', async () => {
    const cpiIdl = JSON.parse(readFileSync(new URL('../programs/artifacts/cpi-caller.json', import.meta.url), 'utf8'))
    const cpiCaller = new Program(cpiIdl, provider)
    const cpiMethods = cpiCaller.methods as unknown as {
      openCall: (nonce: anchor.BN, inputHash: number[], openAnswer: boolean, fundLamports: anchor.BN) => { accountsStrict: (accounts: Record<string, PublicKey | null>) => { instruction: () => Promise<TransactionInstruction> } }
      verifyReceipt: (expectedOpenAnswer: Buffer) => { accountsStrict: (accounts: Record<string, PublicKey | null>) => { instruction: () => Promise<TransactionInstruction> } }
      refundCall: () => { accountsStrict: (accounts: Record<string, PublicKey | null>) => { instruction: () => Promise<TransactionInstruction> } }
      withdrawSol: (amount: anchor.BN) => { accountsStrict: (accounts: Record<string, PublicKey | null>) => { instruction: () => Promise<TransactionInstruction> } }
      withdrawTokens: (amount: anchor.BN) => { accountsStrict: (accounts: Record<string, PublicKey | null>) => { instruction: () => Promise<TransactionInstruction> } }
    }
    const callerPda = pda(cpiCaller.programId, utf8('caller'), caller.publicKey.toBytes())
    const voynichEventAuthority = pda(voynich.programId, utf8('__event_authority'))

    // 1. SOL CPI open-answer call + settlement
    await refresh(first)
    const cpiNonce1 = ++nonce
    const cpiCall1Addr = pda(voynich.programId, utf8('call'), callerPda.toBytes(), u64le(cpiNonce1))
    const cpiInputHash1 = sha256(utf8(`cpi-input-${cpiNonce1}`))
    const openIx1 = await cpiMethods.openCall(bn(cpiNonce1), [...cpiInputHash1], true, bn(PRICE)).accountsStrict({
      payer: admin.publicKey,
      authority: caller.publicKey,
      caller: callerPda,
      config,
      model: solModel.address,
      enclave: first.address,
      attestationRecord: first.record,
      grant: grantAddress(solModel, first),
      call: cpiCall1Addr,
      mint: null,
      callerTokens: null,
      escrowTokens: null,
      tokenProgram: null,
      associatedTokenProgram: null,
      systemProgram: SystemProgram.programId,
      eventAuthority: voynichEventAuthority,
      voynichProgram: voynich.programId,
    }).instruction()
    await execute([openIx1], [caller])

    const cpiCall1Info = await connection.getAccountInfo(cpiCall1Addr, 'confirmed')
    assert.equal(cpiCall1Info?.data.length, 349)
    const cpiCall1Account = await voynich.account.call.fetch(cpiCall1Addr)
    assert(cpiCall1Account.caller.equals(callerPda))
    assert.equal(cpiCall1Account.callerIsProgram, true)
    assert.deepEqual(cpiCall1Account.answerMode, { open: {} })

    const openPayload = utf8(JSON.stringify({ label: 'clock', probability: 0.97 }))
    const cpiSettle1 = await settleInstructions(
      { address: cpiCall1Addr, nonce: cpiNonce1, model: solModel, inputHash: cpiInputHash1 },
      { openAnswer: openPayload, callerKey: callerPda },
    )
    await execute(cpiSettle1.instructions)
    const cpiReceipt1Info = await connection.getAccountInfo(cpiSettle1.receipt, 'confirmed')
    assert.equal(cpiReceipt1Info?.data.length, 407 + openPayload.length)
    const cpiReceipt1 = await voynich.account.receipt.fetch(cpiSettle1.receipt)
    assert.equal(cpiReceipt1.callerIsProgram, true)
    assert.deepEqual(cpiReceipt1.answerMode, { open: {} })
    assert.deepEqual(Buffer.from(cpiReceipt1.openAnswer), Buffer.from(openPayload))

    // Verify on-chain Receipt reading through voynich-cpi inside cpi-caller::verify_receipt
    const verifyOkIx = await cpiMethods.verifyReceipt(Buffer.from(openPayload)).accountsStrict({
      receipt: cpiSettle1.receipt,
      model: solModel.address,
      call: cpiCall1Addr,
    }).instruction()
    await execute([verifyOkIx])

    // Negative checks: wrong expected open answer, wrong model, wrong PDA, wrong owner
    const verifyBadAnswerIx = await cpiMethods.verifyReceipt(Buffer.from(utf8('{"label":"cat"}'))).accountsStrict({
      receipt: cpiSettle1.receipt,
      model: solModel.address,
      call: cpiCall1Addr,
    }).instruction()
    await assert.rejects(execute([verifyBadAnswerIx]), /AnswerMismatch/)

    const verifyWrongModelIx = await cpiMethods.verifyReceipt(Buffer.from(openPayload)).accountsStrict({
      receipt: cpiSettle1.receipt,
      model: tokenModel.address,
      call: cpiCall1Addr,
    }).instruction()
    await assert.rejects(execute([verifyWrongModelIx]), /ModelMismatch|custom program error/)

    const verifyWrongPdaIx = await cpiMethods.verifyReceipt(Buffer.from(openPayload)).accountsStrict({
      receipt: cpiCall1Addr,
      model: solModel.address,
      call: cpiCall1Addr,
    }).instruction()
    await assert.rejects(execute([verifyWrongPdaIx]), /InvalidReceiptPda|custom program error/)

    const verifyWrongOwnerIx = await cpiMethods.verifyReceipt(Buffer.from(openPayload)).accountsStrict({
      receipt: caller.publicKey,
      model: solModel.address,
      call: cpiCall1Addr,
    }).instruction()
    await assert.rejects(execute([verifyWrongOwnerIx]), /InvalidReceiptOwner|custom program error/)

    // 2. SOL CPI refund returns escrow to caller PDA, then authority withdraws
    await refresh(first)
    const cpiNonce2 = ++nonce
    const cpiCall2Addr = pda(voynich.programId, utf8('call'), callerPda.toBytes(), u64le(cpiNonce2))
    const cpiInputHash2 = sha256(utf8(`cpi-input-${cpiNonce2}`))
    const openIx2 = await cpiMethods.openCall(bn(cpiNonce2), [...cpiInputHash2], false, bn(PRICE)).accountsStrict({
      payer: admin.publicKey,
      authority: caller.publicKey,
      caller: callerPda,
      config,
      model: solModel.address,
      enclave: first.address,
      attestationRecord: first.record,
      grant: grantAddress(solModel, first),
      call: cpiCall2Addr,
      mint: null,
      callerTokens: null,
      escrowTokens: null,
      tokenProgram: null,
      associatedTokenProgram: null,
      systemProgram: SystemProgram.programId,
      eventAuthority: voynichEventAuthority,
      voynichProgram: voynich.programId,
    }).instruction()
    await execute([openIx2], [caller])
    const cpiCall2Account = await voynich.account.call.fetch(cpiCall2Addr)
    await waitPast(BigInt(cpiCall2Account.deadlineSlot.toString()))

    const refundIx2 = await cpiMethods.refundCall().accountsStrict({
      authority: caller.publicKey,
      caller: callerPda,
      call: cpiCall2Addr,
      escrowTokens: null,
      callerTokens: null,
      tokenProgram: null,
      eventAuthority: voynichEventAuthority,
      voynichProgram: voynich.programId,
    }).instruction()
    const refundedTx2 = await transaction(await execute([refundIx2], [caller]))
    assert.equal(solChange(refundedTx2, callerPda), PRICE)
    assert.deepEqual((await voynich.account.call.fetch(cpiCall2Addr)).status, { refunded: {} })

    const withdrawSolIx = await cpiMethods.withdrawSol(bn(PRICE)).accountsStrict({
      authority: caller.publicKey,
      caller: callerPda,
      systemProgram: SystemProgram.programId,
    }).instruction()
    const withdrawSolTx = await transaction(await execute([withdrawSolIx], [caller]))
    assert.equal(solChange(withdrawSolTx, caller.publicKey), PRICE)

    // 3. SPL CPI open_call (payer funds Call + escrow ATA, caller PDA supplies SPL tokens) + CPI refund + withdraw
    const pdaAta = (await getOrCreateAssociatedTokenAccount(connection, admin, tokenModel.mint, callerPda, true, 'confirmed', { commitment: 'confirmed' })).address
    await mintTo(connection, admin, tokenModel.mint, pdaAta, admin, PRICE, [], { commitment: 'confirmed' })
    await refresh(first)
    const cpiNonce3 = ++nonce
    const cpiCall3Addr = pda(voynich.programId, utf8('call'), callerPda.toBytes(), u64le(cpiNonce3))
    const cpiInputHash3 = sha256(utf8(`cpi-input-${cpiNonce3}`))
    const escrowAta3 = getAssociatedTokenAddressSync(tokenModel.mint, cpiCall3Addr, true)
    const openIx3 = await cpiMethods.openCall(bn(cpiNonce3), [...cpiInputHash3], false, bn(0)).accountsStrict({
      payer: admin.publicKey,
      authority: caller.publicKey,
      caller: callerPda,
      config,
      model: tokenModel.address,
      enclave: first.address,
      attestationRecord: first.record,
      grant: grantAddress(tokenModel, first),
      call: cpiCall3Addr,
      mint: tokenModel.mint,
      callerTokens: pdaAta,
      escrowTokens: escrowAta3,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      eventAuthority: voynichEventAuthority,
      voynichProgram: voynich.programId,
    }).instruction()
    await execute([openIx3], [caller])
    const cpiCall3Account = await voynich.account.call.fetch(cpiCall3Addr)
    assert.equal(cpiCall3Account.callerIsProgram, true)
    await waitPast(BigInt(cpiCall3Account.deadlineSlot.toString()))

    const refundIx3 = await cpiMethods.refundCall().accountsStrict({
      authority: caller.publicKey,
      caller: callerPda,
      call: cpiCall3Addr,
      escrowTokens: escrowAta3,
      callerTokens: pdaAta,
      tokenProgram: TOKEN_PROGRAM_ID,
      eventAuthority: voynichEventAuthority,
      voynichProgram: voynich.programId,
    }).instruction()
    const refundedTx3 = await transaction(await execute([refundIx3], [caller]))
    assert.equal(tokenChange(refundedTx3, pdaAta), PRICE)

    const authorityAta = getAssociatedTokenAddressSync(tokenModel.mint, caller.publicKey)
    const withdrawTokIx = await cpiMethods.withdrawTokens(bn(PRICE)).accountsStrict({
      authority: caller.publicKey,
      caller: callerPda,
      callerTokens: pdaAta,
      authorityTokens: authorityAta,
      tokenProgram: TOKEN_PROGRAM_ID,
    }).instruction()
    const withdrawTokTx = await transaction(await execute([withdrawTokIx], [caller]))
    assert.equal(tokenChange(withdrawTokTx, authorityAta), PRICE)
  })

  await t.test('bounty program: SOL and SPL post, draw, atomic one-tx on_receipt settlement, race safety, cancel, and refund_attempt', async () => {
    const bountyProg = new Program<Bounty>(BOUNTY_IDL, provider)
    const bountyEventAuthority = pda(bountyProg.programId, utf8('__event_authority'))
    const voynichEventAuthority = pda(voynich.programId, utf8('__event_authority'))
    const drawer = Keypair.generate()
    const splDrawer = Keypair.generate()
    await execute([drawer, splDrawer].map(key =>
      SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: key.publicKey, lamports: 1_000_000_000 })))

    const callbackRemaining = async (callAddress: PublicKey) => {
      const opened = await voynich.account.call.fetch(callAddress)
      assert(opened.callbackProgram.equals(bountyProg.programId))
      return [
        { pubkey: opened.callbackProgram, isWritable: false, isSigner: false },
        ...opened.callbackAccounts.map(account => ({
          pubkey: account.pubkey,
          isWritable: account.isWritable,
          isSigner: false,
        })),
      ]
    }

    // 1. SOL bounty: post -> wrong-label draw settles cleanly -> right-label draw settles and pays in ONE tx -> racing draw settles cleanly
    const rewardLamports = 5_000_000n
    const bNonce1 = 101n
    const bounty1 = pda(bountyProg.programId, utf8('bounty'), owner.publicKey.toBytes(), u64le(bNonce1))
    const callerPda1 = pda(bountyProg.programId, utf8('caller'), bounty1.toBytes())
    await execute([await bountyProg.methods.post(bn(bNonce1), 'clock', bn(rewardLamports)).accountsStrict({
      creator: owner.publicKey,
      model: solModel.address,
      bounty: bounty1,
      mint: null,
      creatorTokens: null,
      bountyTokens: null,
      tokenProgram: null,
      associatedTokenProgram: null,
      systemProgram: SystemProgram.programId,
      eventAuthority: bountyEventAuthority,
      program: bountyProg.programId,
    }).instruction()], [owner])
    const posted1 = await bountyProg.account.bounty.fetch(bounty1)
    assert.equal(posted1.targetLabel, 'clock')
    assert.deepEqual(posted1.status, { open: {} })

    // Draw #1 -> settle with wrong label "cat" via on_receipt -> settles cleanly, bounty stays open, legacy collect still rejects
    await refresh(first)
    const drawNonce1 = ++nonce
    const drawCall1 = pda(voynich.programId, utf8('call'), callerPda1.toBytes(), u64le(drawNonce1))
    const drawAttempt1 = pda(bountyProg.programId, utf8('attempt'), bounty1.toBytes(), drawCall1.toBytes())
    const drawHash1 = sha256(utf8(`bounty-draw-${drawNonce1}`))
    await execute([await bountyProg.methods.draw(bn(drawNonce1), [...drawHash1]).accountsStrict({
      drawer: drawer.publicKey,
      bounty: bounty1,
      caller: callerPda1,
      attempt: drawAttempt1,
      config,
      model: solModel.address,
      enclave: first.address,
      attestationRecord: first.record,
      grant: grantAddress(solModel, first),
      call: drawCall1,
      priceMint: null,
      drawerTokens: null,
      callerTokens: null,
      escrowTokens: null,
      bountyMint: null,
      bountyTokens: null,
      drawerRewardTokens: null,
      tokenProgram: null,
      associatedTokenProgram: null,
      systemProgram: SystemProgram.programId,
      voynichEventAuthority,
      voynichProgram: voynich.programId,
      eventAuthority: bountyEventAuthority,
      program: bountyProg.programId,
    }).instruction()], [drawer])
    const openedDraw1 = await voynich.account.call.fetch(drawCall1)
    assert.equal(openedDraw1.callerIsProgram, true)
    assert(openedDraw1.callbackProgram.equals(bountyProg.programId))
    assert.equal(openedDraw1.callbackAccounts.length, 4)

    const wrongPayload = utf8(JSON.stringify({ label: 'cat', probability: 0.91 }))
    const wrongSettle = await settleInstructions(
      { address: drawCall1, nonce: drawNonce1, model: solModel, inputHash: drawHash1 },
      { openAnswer: wrongPayload, callerKey: callerPda1, remainingAccounts: await callbackRemaining(drawCall1) },
    )
    const wrongTx = await transaction(await execute(wrongSettle.instructions))
    assert.equal(solChange(wrongTx, drawer.publicKey), 0n)
    assert.deepEqual((await bountyProg.account.bounty.fetch(bounty1)).status, { open: {} })
    await assert.rejects(
      execute([await bountyProg.methods.collect().accountsStrict({
        actor: drawer.publicKey,
        bounty: bounty1,
        attempt: drawAttempt1,
        call: drawCall1,
        receipt: wrongSettle.receipt,
        drawer: drawer.publicKey,
        bountyTokens: null,
        drawerTokens: null,
        tokenProgram: null,
        eventAuthority: bountyEventAuthority,
        program: bountyProg.programId,
      }).instruction()], [drawer]),
      /LabelMismatch/,
    )

    // Open Draw #2 (winner) and Draw #3 (concurrent race) while bounty1 is still open
    await refresh(first)
    const drawNonce2 = ++nonce
    const drawCall2 = pda(voynich.programId, utf8('call'), callerPda1.toBytes(), u64le(drawNonce2))
    const drawAttempt2 = pda(bountyProg.programId, utf8('attempt'), bounty1.toBytes(), drawCall2.toBytes())
    const drawHash2 = sha256(utf8(`bounty-draw-${drawNonce2}`))
    await execute([await bountyProg.methods.draw(bn(drawNonce2), [...drawHash2]).accountsStrict({
      drawer: drawer.publicKey,
      bounty: bounty1,
      caller: callerPda1,
      attempt: drawAttempt2,
      config,
      model: solModel.address,
      enclave: first.address,
      attestationRecord: first.record,
      grant: grantAddress(solModel, first),
      call: drawCall2,
      priceMint: null,
      drawerTokens: null,
      callerTokens: null,
      escrowTokens: null,
      bountyMint: null,
      bountyTokens: null,
      drawerRewardTokens: null,
      tokenProgram: null,
      associatedTokenProgram: null,
      systemProgram: SystemProgram.programId,
      voynichEventAuthority,
      voynichProgram: voynich.programId,
      eventAuthority: bountyEventAuthority,
      program: bountyProg.programId,
    }).instruction()], [drawer])

    const drawNonceRace = ++nonce
    const drawCallRace = pda(voynich.programId, utf8('call'), callerPda1.toBytes(), u64le(drawNonceRace))
    const drawAttemptRace = pda(bountyProg.programId, utf8('attempt'), bounty1.toBytes(), drawCallRace.toBytes())
    const drawHashRace = sha256(utf8(`bounty-draw-${drawNonceRace}`))
    await execute([await bountyProg.methods.draw(bn(drawNonceRace), [...drawHashRace]).accountsStrict({
      drawer: splDrawer.publicKey,
      bounty: bounty1,
      caller: callerPda1,
      attempt: drawAttemptRace,
      config,
      model: solModel.address,
      enclave: first.address,
      attestationRecord: first.record,
      grant: grantAddress(solModel, first),
      call: drawCallRace,
      priceMint: null,
      drawerTokens: null,
      callerTokens: null,
      escrowTokens: null,
      bountyMint: null,
      bountyTokens: null,
      drawerRewardTokens: null,
      tokenProgram: null,
      associatedTokenProgram: null,
      systemProgram: SystemProgram.programId,
      voynichEventAuthority,
      voynichProgram: voynich.programId,
      eventAuthority: bountyEventAuthority,
      program: bountyProg.programId,
    }).instruction()], [splDrawer])

    // Settle Draw #2 with matching label "clock" -> settles AND pays rewardLamports to drawer in ONE tx (no collect)
    const rightPayload = utf8(JSON.stringify({ label: 'clock', probability: 0.97 }))
    const rightSettle = await settleInstructions(
      { address: drawCall2, nonce: drawNonce2, model: solModel, inputHash: drawHash2 },
      { openAnswer: rightPayload, callerKey: callerPda1, remainingAccounts: await callbackRemaining(drawCall2) },
    )
    const rightTx = await transaction(await execute(rightSettle.instructions))
    assert.equal(solChange(rightTx, drawer.publicKey), rewardLamports)
    const claimed1 = await bountyProg.account.bounty.fetch(bounty1)
    assert.deepEqual(claimed1.status, { claimed: {} })
    assert(claimed1.winner.equals(drawer.publicKey))
    assert(claimed1.winningReceipt.equals(rightSettle.receipt))
    assert.equal(claimed1.attempts.toString(), '3')

    // Settle Draw #3 (already-claimed race) -> settles cleanly without reverting; winner stays drawer
    const raceSettle = await settleInstructions(
      { address: drawCallRace, nonce: drawNonceRace, model: solModel, inputHash: drawHashRace },
      { openAnswer: rightPayload, callerKey: callerPda1, remainingAccounts: await callbackRemaining(drawCallRace) },
    )
    const raceTx = await transaction(await execute(raceSettle.instructions))
    assert.equal(solChange(raceTx, splDrawer.publicKey), 0n)
    const stillClaimed1 = await bountyProg.account.bounty.fetch(bounty1)
    assert(stillClaimed1.winner.equals(drawer.publicKey))
    assert(stillClaimed1.winningReceipt.equals(rightSettle.receipt))

    // 2. SPL bounty: post -> draw (expired) -> refund_attempt -> cancel returns SPL reward to creator
    const rewardMint = await createMint(connection, admin, admin.publicKey, null, 6, undefined, { commitment: 'confirmed' })
    const ownerRewardAta = (await getOrCreateAssociatedTokenAccount(connection, admin, rewardMint, owner.publicKey, false, 'confirmed', { commitment: 'confirmed' })).address
    const drawerRewardAta = getAssociatedTokenAddressSync(rewardMint, drawer.publicKey)
    const splDrawerRewardAta = getAssociatedTokenAddressSync(rewardMint, splDrawer.publicKey)
    const rewardTokens = 2_500_000n
    await mintTo(connection, admin, rewardMint, ownerRewardAta, admin, rewardTokens * 2n, [], { commitment: 'confirmed' })

    const bNonce2 = 102n
    const bounty2 = pda(bountyProg.programId, utf8('bounty'), owner.publicKey.toBytes(), u64le(bNonce2))
    const bounty2Ata = getAssociatedTokenAddressSync(rewardMint, bounty2, true)
    const callerPda2 = pda(bountyProg.programId, utf8('caller'), bounty2.toBytes())
    await execute([await bountyProg.methods.post(bn(bNonce2), 'star', bn(rewardTokens)).accountsStrict({
      creator: owner.publicKey,
      model: solModel.address,
      bounty: bounty2,
      mint: rewardMint,
      creatorTokens: ownerRewardAta,
      bountyTokens: bounty2Ata,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      eventAuthority: bountyEventAuthority,
      program: bountyProg.programId,
    }).instruction()], [owner])

    // Draw then let call expire -> refund_attempt returns SOL price directly to drawer
    await refresh(first)
    const drawNonce3 = ++nonce
    const drawCall3 = pda(voynich.programId, utf8('call'), callerPda2.toBytes(), u64le(drawNonce3))
    const drawAttempt3 = pda(bountyProg.programId, utf8('attempt'), bounty2.toBytes(), drawCall3.toBytes())
    const drawHash3 = sha256(utf8(`bounty-draw-${drawNonce3}`))
    await execute([await bountyProg.methods.draw(bn(drawNonce3), [...drawHash3]).accountsStrict({
      drawer: drawer.publicKey,
      bounty: bounty2,
      caller: callerPda2,
      attempt: drawAttempt3,
      config,
      model: solModel.address,
      enclave: first.address,
      attestationRecord: first.record,
      grant: grantAddress(solModel, first),
      call: drawCall3,
      priceMint: null,
      drawerTokens: null,
      callerTokens: null,
      escrowTokens: null,
      bountyMint: rewardMint,
      bountyTokens: bounty2Ata,
      drawerRewardTokens: drawerRewardAta,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      voynichEventAuthority,
      voynichProgram: voynich.programId,
      eventAuthority: bountyEventAuthority,
      program: bountyProg.programId,
    }).instruction()], [drawer])
    const expiredCall3 = await voynich.account.call.fetch(drawCall3)
    assert.equal(expiredCall3.callbackAccounts.length, 6)
    await waitPast(BigInt(expiredCall3.deadlineSlot.toString()))
    const refundAttemptTx = await transaction(await execute([await bountyProg.methods.refundAttempt().accountsStrict({
      actor: admin.publicKey,
      bounty: bounty2,
      caller: callerPda2,
      attempt: drawAttempt3,
      call: drawCall3,
      drawer: drawer.publicKey,
      escrowTokens: null,
      callerTokens: null,
      drawerTokens: null,
      tokenProgram: null,
      systemProgram: SystemProgram.programId,
      voynichEventAuthority,
      voynichProgram: voynich.programId,
      eventAuthority: bountyEventAuthority,
      program: bountyProg.programId,
    }).instruction()]))
    assert.equal(solChange(refundAttemptTx, drawer.publicKey), PRICE)

    // Cancel SPL bounty returns full rewardTokens to creator
    const cancelTx = await transaction(await execute([await bountyProg.methods.cancel().accountsStrict({
      creator: owner.publicKey,
      bounty: bounty2,
      bountyTokens: bounty2Ata,
      creatorTokens: ownerRewardAta,
      tokenProgram: TOKEN_PROGRAM_ID,
      eventAuthority: bountyEventAuthority,
      program: bountyProg.programId,
    }).instruction()], [owner]))
    assert.equal(tokenChange(cancelTx, ownerRewardAta), rewardTokens)
    assert.deepEqual((await bountyProg.account.bounty.fetch(bounty2)).status, { cancelled: {} })

    // 3. SPL bounty post -> draw (creates splDrawerRewardAta) -> atomic settle_call pays SPL rewardTokens in ONE tx
    const bNonce3 = 103n
    const bounty3 = pda(bountyProg.programId, utf8('bounty'), owner.publicKey.toBytes(), u64le(bNonce3))
    const bounty3Ata = getAssociatedTokenAddressSync(rewardMint, bounty3, true)
    const callerPda3 = pda(bountyProg.programId, utf8('caller'), bounty3.toBytes())
    await execute([await bountyProg.methods.post(bn(bNonce3), 'star', bn(rewardTokens)).accountsStrict({
      creator: owner.publicKey,
      model: solModel.address,
      bounty: bounty3,
      mint: rewardMint,
      creatorTokens: ownerRewardAta,
      bountyTokens: bounty3Ata,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      eventAuthority: bountyEventAuthority,
      program: bountyProg.programId,
    }).instruction()], [owner])
    await refresh(first)
    const drawNonce4 = ++nonce
    const drawCall4 = pda(voynich.programId, utf8('call'), callerPda3.toBytes(), u64le(drawNonce4))
    const drawAttempt4 = pda(bountyProg.programId, utf8('attempt'), bounty3.toBytes(), drawCall4.toBytes())
    const drawHash4 = sha256(utf8(`bounty-draw-${drawNonce4}`))
    assert.equal(await connection.getAccountInfo(splDrawerRewardAta, 'confirmed'), null)
    await execute([await bountyProg.methods.draw(bn(drawNonce4), [...drawHash4]).accountsStrict({
      drawer: splDrawer.publicKey,
      bounty: bounty3,
      caller: callerPda3,
      attempt: drawAttempt4,
      config,
      model: solModel.address,
      enclave: first.address,
      attestationRecord: first.record,
      grant: grantAddress(solModel, first),
      call: drawCall4,
      priceMint: null,
      drawerTokens: null,
      callerTokens: null,
      escrowTokens: null,
      bountyMint: rewardMint,
      bountyTokens: bounty3Ata,
      drawerRewardTokens: splDrawerRewardAta,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      voynichEventAuthority,
      voynichProgram: voynich.programId,
      eventAuthority: bountyEventAuthority,
      program: bountyProg.programId,
    }).instruction()], [splDrawer])
    const starSettle = await settleInstructions(
      { address: drawCall4, nonce: drawNonce4, model: solModel, inputHash: drawHash4 },
      { openAnswer: utf8(JSON.stringify({ label: 'star', probability: 0.95 })), callerKey: callerPda3, remainingAccounts: await callbackRemaining(drawCall4) },
    )
    const starTx = await transaction(await execute(starSettle.instructions))
    assert.equal(tokenChange(starTx, splDrawerRewardAta), rewardTokens)
    const claimed3 = await bountyProg.account.bounty.fetch(bounty3)
    assert.deepEqual(claimed3.status, { claimed: {} })
    assert(claimed3.winner.equals(splDrawer.publicKey))
    assert(claimed3.winningReceipt.equals(starSettle.receipt))
  })

  await t.test('price per token: set_price(Token), open_metered_call SOL & SPL ceiling escrow, settle_call guard, and full-ceiling refund_call', async () => {
    await refresh(first)
    const unitPriceSol = 2_000n
    const ceilingSol = 128_000n // 64 tokens * 2,000 lamports

    // open_metered_call on a PriceUnit::Call model must fail with InvalidCall.
    const wrongUnitCall = callArgs(solModel)
    await assert.rejects(
      execute([await voynich.methods.openMeteredCall(bn(wrongUnitCall.nonce), [...wrongUnitCall.inputHash], { sealed: {} }, null, bn(PRICE)).accountsStrict({
        payer: caller.publicKey, caller: caller.publicKey, config, model: solModel.address, enclave: first.address,
        attestationRecord: first.record, grant: grantAddress(solModel, first), call: wrongUnitCall.address,
        mint: null, callerTokens: null, escrowTokens: null, tokenProgram: null, associatedTokenProgram: null,
        systemProgram: SystemProgram.programId, ...events(voynich.programId),
      }).instruction()], [caller]),
      /InvalidCall/,
    )

    // Switch baseModel to PriceUnit::Token with unitPriceSol via set_price.
    await execute([await voynich.methods.setPrice(bn(unitPriceSol), PublicKey.default, OPERATOR_BPS, { token: {} }).accountsStrict({
      owner: owner.publicKey, config, model: baseModel.address, ...events(voynich.programId),
    }).instruction()], [owner])
    const tokenPricedSol = await voynich.account.model.fetch(baseModel.address)
    assert.deepEqual(tokenPricedSol.priceUnit, { token: {} })
    assert.equal(tokenPricedSol.price.toString(), unitPriceSol.toString())

    // Flat open_call on a PriceUnit::Token model must fail with InvalidCall.
    await assert.rejects(execute([await openInstruction(callArgs(baseModel))], [caller]), /InvalidCall/)

    // open_metered_call with ceiling < unitPrice must fail with InvalidCall.
    const lowCeilingCall = callArgs(baseModel)
    await assert.rejects(
      execute([await voynich.methods.openMeteredCall(bn(lowCeilingCall.nonce), [...lowCeilingCall.inputHash], { sealed: {} }, null, bn(unitPriceSol - 1n)).accountsStrict({
        payer: caller.publicKey, caller: caller.publicKey, config, model: baseModel.address, enclave: first.address,
        attestationRecord: first.record, grant: grantAddress(baseModel, first), call: lowCeilingCall.address,
        mint: null, callerTokens: null, escrowTokens: null, tokenProgram: null, associatedTokenProgram: null,
        systemProgram: SystemProgram.programId, ...events(voynich.programId),
      }).instruction()], [caller]),
      /InvalidCall/,
    )

    // Valid SOL open_metered_call escrows full ceilingSol, rejects flat settle_call, and refunds full ceilingSol after deadline.
    const meteredSolCall = callArgs(baseModel)
    const openSolSig = await execute([await voynich.methods.openMeteredCall(bn(meteredSolCall.nonce), [...meteredSolCall.inputHash], { sealed: {} }, null, bn(ceilingSol)).accountsStrict({
      payer: caller.publicKey, caller: caller.publicKey, config, model: baseModel.address, enclave: first.address,
      attestationRecord: first.record, grant: grantAddress(baseModel, first), call: meteredSolCall.address,
      mint: null, callerTokens: null, escrowTokens: null, tokenProgram: null, associatedTokenProgram: null,
      systemProgram: SystemProgram.programId, ...events(voynich.programId),
    }).instruction()], [caller])
    const openSolTx = await transaction(openSolSig)
    const callInfo = await connection.getAccountInfo(meteredSolCall.address, 'confirmed')
    assert.equal(callInfo?.data.length, 349)
    const callRent = BigInt(await connection.getMinimumBalanceForRentExemption(349))
    assert.equal(solChange(openSolTx, meteredSolCall.address), callRent + ceilingSol)
    const openedSol = await voynich.account.call.fetch(meteredSolCall.address)
    assert.deepEqual(openedSol.priceUnit, { token: {} })
    assert.equal(openedSol.price.toString(), unitPriceSol.toString())
    assert.equal(openedSol.ceiling.toString(), ceilingSol.toString())

    // settle_call is guarded against PriceUnit::Token calls in Step 1.
    const blockedSettle = await settleInstructions(meteredSolCall, { baseSha256: baseModelSha })
    await assert.rejects(execute(blockedSettle.instructions), /InvalidCall/)

    // Refund after deadline returns full ceilingSol (not just unitPriceSol).
    await waitPast(BigInt(openedSol.deadlineSlot.toString()))
    const refundSolTx = await transaction(await execute([await voynich.methods.refundCall().accountsStrict({
      actor: admin.publicKey, call: meteredSolCall.address, caller: caller.publicKey,
      escrowTokens: null, callerTokens: null, tokenProgram: null, ...events(voynich.programId),
    }).instruction()]))
    assert.equal(solChange(refundSolTx, caller.publicKey), ceilingSol)
    assert.deepEqual((await voynich.account.call.fetch(meteredSolCall.address)).status, { refunded: {} })

    // SPL per-token model: open_metered_call escrows full SPL ceiling, rejects settle_call, and refunds full SPL ceiling after deadline.
    const unitPriceSpl = 5_000n
    const ceilingSpl = 250_000n
    const callerSplAta = getAssociatedTokenAddressSync(tokenModel.mint, caller.publicKey)
    await mintTo(connection, admin, tokenModel.mint, callerSplAta, admin, ceilingSpl, [], { commitment: 'confirmed' })
    await execute([await voynich.methods.setPrice(bn(unitPriceSpl), tokenModel.mint, OPERATOR_BPS, { token: {} }).accountsStrict({
      owner: owner.publicKey, config, model: tokenModel.address, ...events(voynich.programId),
    }).instruction()], [owner])
    await refresh(first)
    const meteredSplCall = callArgs(tokenModel)
    const splEscrowAta = getAssociatedTokenAddressSync(tokenModel.mint, meteredSplCall.address, true)
    const openSplTx = await transaction(await execute([await voynich.methods.openMeteredCall(bn(meteredSplCall.nonce), [...meteredSplCall.inputHash], { sealed: {} }, null, bn(ceilingSpl)).accountsStrict({
      payer: caller.publicKey, caller: caller.publicKey, config, model: tokenModel.address, enclave: first.address,
      attestationRecord: first.record, grant: grantAddress(tokenModel, first), call: meteredSplCall.address,
      mint: tokenModel.mint, callerTokens: callerSplAta, escrowTokens: splEscrowAta,
      tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId, ...events(voynich.programId),
    }).instruction()], [caller]))
    assert.equal(tokenChange(openSplTx, callerSplAta), -ceilingSpl)
    assert.equal((await connection.getTokenAccountBalance(splEscrowAta, 'confirmed')).value.amount, ceilingSpl.toString())
    const openedSpl = await voynich.account.call.fetch(meteredSplCall.address)
    assert.deepEqual(openedSpl.priceUnit, { token: {} })
    assert.equal(openedSpl.price.toString(), unitPriceSpl.toString())
    assert.equal(openedSpl.ceiling.toString(), ceilingSpl.toString())
    const blockedSplSettle = await settleInstructions(meteredSplCall)
    await assert.rejects(execute(blockedSplSettle.instructions), /InvalidCall/)
    await waitPast(BigInt(openedSpl.deadlineSlot.toString()))
    const refundSplTx = await transaction(await execute([await voynich.methods.refundCall().accountsStrict({
      actor: admin.publicKey, call: meteredSplCall.address, caller: caller.publicKey,
      escrowTokens: splEscrowAta, callerTokens: callerSplAta, tokenProgram: TOKEN_PROGRAM_ID, ...events(voynich.programId),
    }).instruction()]))
    assert.equal(tokenChange(refundSplTx, callerSplAta), ceilingSpl)
    assert.deepEqual((await voynich.account.call.fetch(meteredSplCall.address)).status, { refunded: {} })

    // Restore tokenModel back to PriceUnit::Call for the remaining test subtest.
    await execute([await voynich.methods.setPrice(bn(PRICE), tokenModel.mint, OPERATOR_BPS, { call: {} }).accountsStrict({
      owner: owner.publicKey, config, model: tokenModel.address, ...events(voynich.programId),
    }).instruction()], [owner])
  })

  await t.test('metered settlement: SOL & SPL settle_metered_call partial return, count=0 100% return, total>ceiling & wrong-sig rejections, and 1-lamport receipt PDA DoS test', async () => {
    await refresh(first)
    const unitPriceSol = 2_000n
    const ceilingSol = 200_000n // 100 tokens max
    // Ensure baseModel is PriceUnit::Token at 2,000 lamports/token (has Model.base = Some(baseModelSha)).
    await execute([await voynich.methods.setPrice(bn(unitPriceSol), PublicKey.default, OPERATOR_BPS, { token: {} }).accountsStrict({
      owner: owner.publicKey, config, model: baseModel.address, ...events(voynich.programId),
    }).instruction()], [owner])

    const buildMeteredSettle = async (
      call: { address: PublicKey; model: { address: PublicKey; mint: PublicKey }; inputHash: Uint8Array },
      count: bigint,
      opts: { baseSha256?: Uint8Array | null; useReceiptMsg?: boolean; sigCount?: bigint; payer?: PublicKey } = {},
    ) => {
      const receipt = pda(voynich.programId, utf8('receipt'), call.address.toBytes())
      const runningHash = sha256(utf8(`metered-running-${call.address.toBase58()}-${count.toString()}`))
      const base = opts.baseSha256 === undefined ? null : opts.baseSha256
      const message = opts.useReceiptMsg
        ? receiptMessage(call.address.toBytes(), call.inputHash, runningHash, base)
        : pieceMessage(call.address.toBytes(), call.inputHash, opts.sigCount ?? count, runningHash, base)
      const signature = opts.useReceiptMsg
        ? signReceipt(first.signing.secretKey.slice(0, 32), call.address.toBytes(), call.inputHash, runningHash, base)
        : signPiece(first.signing.secretKey.slice(0, 32), call.address.toBytes(), call.inputHash, opts.sigCount ?? count, runningHash, base)
      const token = !call.model.mint.equals(PublicKey.default)
      const ata = (wallet: PublicKey) => getAssociatedTokenAddressSync(call.model.mint, wallet, true)
      const verify = Ed25519Program.createInstructionWithPublicKey({
        publicKey: first.signing.publicKey.toBytes(),
        message,
        signature,
      })
      const settle = await voynich.methods.settleMeteredCall(bn(count), [...runningHash], [...signature], 0).accountsStrict({
        payer: opts.payer ?? first.operator.publicKey, config, model: call.model.address, enclave: first.address,
        attestationRecord: first.record, call: call.address, receipt, caller: caller.publicKey,
        owner: owner.publicKey, operator: first.operator.publicKey, feeRecipient: feeRecipient.publicKey,
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
        escrowTokens: token ? ata(call.address) : null,
        ownerTokens: token ? ata(owner.publicKey) : null,
        operatorTokens: token ? ata(first.operator.publicKey) : null,
        protocolTokens: token ? ata(feeRecipient.publicKey) : null,
        callerTokens: token ? ata(caller.publicKey) : null,
        tokenProgram: token ? TOKEN_PROGRAM_ID : null,
        systemProgram: SystemProgram.programId, ...events(voynich.programId),
      }).instruction()
      return { receipt, runningHash, signature, instructions: [verify, settle] }
    }

    const openMeteredSol = async (ceiling: bigint) => {
      const c = callArgs(baseModel)
      await execute([await voynich.methods.openMeteredCall(bn(c.nonce), [...c.inputHash], { sealed: {} }, null, bn(ceiling)).accountsStrict({
        payer: caller.publicKey, caller: caller.publicKey, config, model: baseModel.address, enclave: first.address,
        attestationRecord: first.record, grant: grantAddress(baseModel, first), call: c.address,
        mint: null, callerTokens: null, escrowTokens: null, tokenProgram: null, associatedTokenProgram: null,
        systemProgram: SystemProgram.programId, ...events(voynich.programId),
      }).instruction()], [caller])
      return c
    }

    // 1. SOL metered call: partial return (count = 61 -> total = 122,000, returned = 78,000), rejects unauthorized payer, over-ceiling & wrong sigs.
    const solCall1 = await openMeteredSol(ceilingSol)
    // Unauthorized third-party payer (neither operator nor caller) rejected with Unauthorized.
    const badPayer = await buildMeteredSettle(solCall1, 61n, { baseSha256: baseModelSha, payer: admin.publicKey })
    await assert.rejects(execute(badPayer.instructions), /Unauthorized/)
    // total > ceiling (count = 101 -> 202,000 > 200,000) rejected with InsufficientEscrow.
    const overCeiling = await buildMeteredSettle(solCall1, 101n, { baseSha256: baseModelSha })
    await assert.rejects(execute(overCeiling.instructions, [first.operator]), /InsufficientEscrow/)
    // Wrong message domain (receiptMessage instead of pieceMessage) rejected with InvalidSignature.
    const badDomain = await buildMeteredSettle(solCall1, 61n, { baseSha256: baseModelSha, useReceiptMsg: true })
    await assert.rejects(execute(badDomain.instructions, [first.operator]), /InvalidSignature/)
    // Standalone v1 piece message on adapter model rejected with InvalidSignature.
    const badV1 = await buildMeteredSettle(solCall1, 61n, { baseSha256: null })
    await assert.rejects(execute(badV1.instructions, [first.operator]), /InvalidSignature/)
    // Wrong count signed vs passed rejected with InvalidSignature.
    const badCountSig = await buildMeteredSettle(solCall1, 61n, { baseSha256: baseModelSha, sigCount: 60n })
    await assert.rejects(execute(badCountSig.instructions, [first.operator]), /InvalidSignature/)

    // Valid settle_metered_call (count = 61, v2 with baseModelSha): 3-way split of 122,000 + 78,000 returned to caller in one tx!
    const receiptRent423 = BigInt(await connection.getMinimumBalanceForRentExemption(RECEIPT_METERED_SPACE))
    const okSol1 = await buildMeteredSettle(solCall1, 61n, { baseSha256: baseModelSha })
    const okSol1Tx = await transaction(await execute(okSol1.instructions, [first.operator]))
    const total1 = 61n * unitPriceSol // 122_000
    const returned1 = ceilingSol - total1 // 78_000
    const opAmt1 = (total1 * BigInt(OPERATOR_BPS)) / 10_000n
    const protoAmt1 = (total1 * BigInt(PROTOCOL_BPS)) / 10_000n
    const ownerAmt1 = total1 - opAmt1 - protoAmt1
    assert.equal(solChange(okSol1Tx, owner.publicKey), ownerAmt1)
    assert.equal(solChange(okSol1Tx, first.operator.publicKey), opAmt1 - receiptRent423)
    assert.equal(solChange(okSol1Tx, feeRecipient.publicKey), protoAmt1)
    assert.equal(solChange(okSol1Tx, caller.publicKey), returned1)
    const r1Info = await connection.getAccountInfo(okSol1.receipt, 'confirmed')
    assert.equal(r1Info?.data.length, RECEIPT_METERED_SPACE)
    const r1 = decodeReceiptAccount(r1Info!.data)
    assert.equal(r1.deliveredCount?.toString(), '61')
    assert.equal(r1.returnedAmount?.toString(), returned1.toString())
    assert.equal(r1.total.toString(), total1.toString())
    assert.deepEqual((await voynich.account.call.fetch(solCall1.address)).status, { settled: {} })

    // 2. count == 0 is valid and returns 100% of ceiling to caller (caller self-settlement SOL path).
    const solCallZero = await openMeteredSol(ceilingSol)
    const zeroSettle = await buildMeteredSettle(solCallZero, 0n, { baseSha256: baseModelSha, payer: caller.publicKey })
    const zeroTx = await transaction(await execute(zeroSettle.instructions, [caller]))
    assert.equal(solChange(zeroTx, owner.publicKey), 0n)
    assert.equal(solChange(zeroTx, first.operator.publicKey), 0n)
    assert.equal(solChange(zeroTx, feeRecipient.publicKey), 0n)
    assert.equal(solChange(zeroTx, caller.publicKey), ceilingSol - receiptRent423)
    const rZero = decodeReceiptAccount((await connection.getAccountInfo(zeroSettle.receipt, 'confirmed'))!.data)
    assert.equal(rZero.deliveredCount?.toString(), '0')
    assert.equal(rZero.returnedAmount?.toString(), ceilingSol.toString())
    assert.equal(rZero.total.toString(), '0')

    // 3. DoS resistance: pre-fund canonical receipt PDA with 0-byte rent-exempt dust before settle_metered_call.
    const solCallDust = await openMeteredSol(ceilingSol)
    const dustReceiptPda = pda(voynich.programId, utf8('receipt'), solCallDust.address.toBytes())
    const zeroRentDust = await connection.getMinimumBalanceForRentExemption(0)
    await execute([SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: dustReceiptPda, lamports: zeroRentDust })])
    const dustSettle = await buildMeteredSettle(solCallDust, 10n, { baseSha256: baseModelSha })
    const dustTx = await transaction(await execute(dustSettle.instructions, [first.operator]))
    assert.equal(solChange(dustTx, caller.publicKey), ceilingSol - 10n * unitPriceSol)
    const rDustInfo = await connection.getAccountInfo(dustReceiptPda, 'confirmed')
    assert.equal(rDustInfo?.data.length, 423)
    const rDust = decodeReceiptAccount(rDustInfo!.data)
    assert.equal(rDust.deliveredCount?.toString(), '10')
    assert.equal(rDust.returnedAmount?.toString(), (ceilingSol - 10n * unitPriceSol).toString())

    // 4. SPL metered caller self-settlement: payer=caller splits count * unitPriceSpl + returns remainder to caller_tokens + closes escrow_tokens.
    const unitPriceSpl = 5_000n
    const ceilingSpl = 100_000n // 20 tokens max
    const callerSplAta = getAssociatedTokenAddressSync(tokenModel.mint, caller.publicKey)
    const ownerSplAta = getAssociatedTokenAddressSync(tokenModel.mint, owner.publicKey)
    const operatorSplAta = getAssociatedTokenAddressSync(tokenModel.mint, first.operator.publicKey)
    const feeSplAta = getAssociatedTokenAddressSync(tokenModel.mint, feeRecipient.publicKey)
    await mintTo(connection, admin, tokenModel.mint, callerSplAta, admin, ceilingSpl, [], { commitment: 'confirmed' })
    await execute([await voynich.methods.setPrice(bn(unitPriceSpl), tokenModel.mint, OPERATOR_BPS, { token: {} }).accountsStrict({
      owner: owner.publicKey, config, model: tokenModel.address, ...events(voynich.programId),
    }).instruction()], [owner])
    await refresh(first)
    const splCall = callArgs(tokenModel)
    const splEscrowAta = getAssociatedTokenAddressSync(tokenModel.mint, splCall.address, true)
    await execute([await voynich.methods.openMeteredCall(bn(splCall.nonce), [...splCall.inputHash], { sealed: {} }, null, bn(ceilingSpl)).accountsStrict({
      payer: caller.publicKey, caller: caller.publicKey, config, model: tokenModel.address, enclave: first.address,
      attestationRecord: first.record, grant: grantAddress(tokenModel, first), call: splCall.address,
      mint: tokenModel.mint, callerTokens: callerSplAta, escrowTokens: splEscrowAta,
      tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId, ...events(voynich.programId),
    }).instruction()], [caller])
    const splSettle = await buildMeteredSettle(splCall, 7n, { baseSha256: null, payer: caller.publicKey })
    const latestBh = await connection.getLatestBlockhash('confirmed')
    const splTxRaw = new Transaction({ feePayer: caller.publicKey, recentBlockhash: latestBh.blockhash }).add(...splSettle.instructions)
    splTxRaw.sign(caller)
    const splSig = await connection.sendRawTransaction(splTxRaw.serialize(), { preflightCommitment: 'confirmed' })
    await connection.confirmTransaction({ signature: splSig, ...latestBh }, 'confirmed')
    const splTx = await transaction(splSig)
    const splTotal = 7n * unitPriceSpl // 35_000
    const splReturned = ceilingSpl - splTotal // 65_000
    const splOp = (splTotal * BigInt(OPERATOR_BPS)) / 10_000n
    const splProto = (splTotal * BigInt(PROTOCOL_BPS)) / 10_000n
    const splOwner = splTotal - splOp - splProto
    assert.equal(tokenChange(splTx, ownerSplAta), splOwner)
    assert.equal(tokenChange(splTx, operatorSplAta), splOp)
    assert.equal(tokenChange(splTx, feeSplAta), splProto)
    assert.equal(tokenChange(splTx, callerSplAta), splReturned)
    assert.equal(await connection.getAccountInfo(splEscrowAta, 'confirmed'), null, 'SPL escrow ATA must be closed')
    const rSplInfo = await connection.getAccountInfo(splSettle.receipt, 'confirmed')
    assert.equal(rSplInfo?.data.length, 423)
    const rSpl = decodeReceiptAccount(rSplInfo!.data)
    assert.equal(rSpl.deliveredCount?.toString(), '7')
    assert.equal(rSpl.returnedAmount?.toString(), splReturned.toString())

    // 5. Past-deadline settle_metered_call rejected with CallDeadlinePassed while refund_call returns 100% ceiling.
    const solCallExpired = await openMeteredSol(ceilingSol)
    const openedExpired = await voynich.account.call.fetch(solCallExpired.address)
    await waitPast(BigInt(openedExpired.deadlineSlot.toString()))
    const lateSettle = await buildMeteredSettle(solCallExpired, 5n, { baseSha256: baseModelSha, payer: caller.publicKey })
    await assert.rejects(execute(lateSettle.instructions, [caller]), /CallDeadlinePassed/)
    const refundLateIx = await voynich.methods.refundCall().accountsStrict({
      actor: admin.publicKey, call: solCallExpired.address, caller: caller.publicKey,
      escrowTokens: null, callerTokens: null, tokenProgram: null, ...events(voynich.programId),
    }).instruction()
    const refundLateTx = await transaction(await execute([refundLateIx]))
    assert.equal(solChange(refundLateTx, caller.publicKey), ceilingSol)

    // Restore tokenModel back to PriceUnit::Call for the remaining test subtests.
    await execute([await voynich.methods.setPrice(bn(PRICE), tokenModel.mint, OPERATOR_BPS, { call: {} }).accountsStrict({
      owner: owner.publicKey, config, model: tokenModel.address, ...events(voynich.programId),
    }).instruction()], [owner])
  })

  await t.test('refund after the deadline returns the complete SOL price', async () => {
    await refresh(first)
    const call = await open(solModel)
    const opened = await voynich.account.call.fetch(call.address)
    await waitPast(BigInt(opened.deadlineSlot.toString()))
    const refund = await voynich.methods.refundCall().accountsStrict({
      actor: admin.publicKey, call: call.address, caller: caller.publicKey,
      escrowTokens: null, callerTokens: null, tokenProgram: null, ...events(voynich.programId),
    }).instruction()
    const refunded = await transaction(await execute([refund]))
    assert.equal(solChange(refunded, caller.publicKey), PRICE)
    assert.deepEqual((await voynich.account.call.fetch(call.address)).status, { refunded: {} })
  })

  await t.test('retire prevents new calls', async () => {
    await refresh(first)
    await execute([await voynich.methods.retireModel().accountsStrict({
      owner: owner.publicKey, config, model: solModel.address, ...events(voynich.programId),
    }).instruction()], [owner])
    assert.deepEqual((await voynich.account.model.fetch(solModel.address)).status, { retired: {} })
    await assert.rejects(execute([await openInstruction(callArgs(solModel))], [caller]), /ModelNotLive/)
  })

  await t.test('expired attestation refuses settlement and both grant paths', async () => {
    await execute([await voynich.methods.setConfig(configArgs(RECORD_LIFETIME_SLOTS + 32)).accountsStrict({
      admin: admin.publicKey, config, ...events(voynich.programId),
    }).instruction()])
    await refresh(first)
    const call = await open(tokenModel)
    const record = await attest.account.attestationRecord.fetch(first.record)
    await waitPast(BigInt(record.expiresAtSlot.toString()))
    const settlement = await settleInstructions(call)
    await assert.rejects(execute(settlement.instructions), /InvalidAttestation/)
    await assert.rejects(execute([await ownerGrant(tokenModel, first)], [owner]), /InvalidAttestation/)
    await assert.rejects(execute([await enclaveGrant(tokenModel, first, second)], [first.signing]), /InvalidAttestation/)
  })

  await t.test('Build 5 Step 2: Measurement PDA publish, duplicate rejection, deprecate by publisher/admin, and Unauthorized rejection', async () => {
    const { decodeMeasurementAccount, measurementPda, MEASUREMENT_SPACE } = await import('../sdk/src/program.js')
    const publisher = Keypair.generate()
    const outsider = Keypair.generate()
    await execute([
      SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: publisher.publicKey, lamports: 50_000_000 }),
      SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: outsider.publicKey, lamports: 50_000_000 }),
    ])

    const digest1 = Uint8Array.from({ length: 48 }, (_, i) => (i + 1) & 0xff)
    const digest2 = Uint8Array.from({ length: 48 }, (_, i) => (i + 0x50) & 0xff)
    const recipeHash = Uint8Array.from({ length: 32 }, (_, i) => (i + 0x20) & 0xff)
    const m1Pda = measurementPda(digest1, voynich.programId)
    const m2Pda = measurementPda(digest2, voynich.programId)

    // 1. Invalid inputs rejected before init
    const zeroDigest = new Uint8Array(48)
    await assert.rejects(
      execute([await voynich.methods.publishMeasurement([...zeroDigest], 'https://github.com/voynich-dev/voynich', 'abcdef1234567890', [...recipeHash], '0.1.3').accountsStrict({
        publisher: publisher.publicKey, measurement: measurementPda(zeroDigest, voynich.programId), systemProgram: SystemProgram.programId, ...events(voynich.programId),
      }).instruction()], [publisher]),
      /InvalidMeasurement/,
    )
    await assert.rejects(
      execute([await voynich.methods.publishMeasurement([...digest1], 'https://github.com/voynich-dev/voynich', 'not-a-hex-sha', [...recipeHash], '0.1.3').accountsStrict({
        publisher: publisher.publicKey, measurement: m1Pda, systemProgram: SystemProgram.programId, ...events(voynich.programId),
      }).instruction()], [publisher]),
      /InvalidMeasurement/,
    )

    // 2. Publish measurement #1 by publisher
    await execute([await voynich.methods.publishMeasurement([...digest1], 'https://github.com/voynich-dev/voynich', 'abcdef1234567890abcdef1234567890abcdef12', [...recipeHash], '0.1.3').accountsStrict({
      publisher: publisher.publicKey, measurement: m1Pda, systemProgram: SystemProgram.programId, ...events(voynich.programId),
    }).instruction()], [publisher])

    const m1Info = await connection.getAccountInfo(m1Pda, 'confirmed')
    assert.equal(m1Info?.data.length, MEASUREMENT_SPACE)
    const decoded1 = decodeMeasurementAccount(m1Info!.data)
    assert.equal(decoded1.digest, Buffer.from(digest1).toString('hex'))
    assert(decoded1.publisher.equals(publisher.publicKey))
    assert.equal(decoded1.sourceRepo, 'https://github.com/voynich-dev/voynich')
    assert.equal(decoded1.commitSha, 'abcdef1234567890abcdef1234567890abcdef12')
    assert.equal(decoded1.recipeHash, Buffer.from(recipeHash).toString('hex'))
    assert.equal(decoded1.version, '0.1.3')
    assert.equal(decoded1.status, 'active')
    assert(decoded1.createdSlot.gtn(0))

    // 3. Duplicate digest rejected
    await assert.rejects(
      execute([await voynich.methods.publishMeasurement([...digest1], 'https://github.com/voynich-dev/voynich', 'abcdef1234567890abcdef1234567890abcdef12', [...recipeHash], '0.1.3').accountsStrict({
        publisher: publisher.publicKey, measurement: m1Pda, systemProgram: SystemProgram.programId, ...events(voynich.programId),
      }).instruction()], [publisher]),
      /already in use|0x0/i,
    )

    // 4. Outsider cannot deprecate
    await assert.rejects(
      execute([await voynich.methods.deprecateMeasurement().accountsStrict({
        authority: outsider.publicKey, config, measurement: m1Pda, ...events(voynich.programId),
      }).instruction()], [outsider]),
      /Unauthorized/,
    )

    // 5. Publisher deprecates measurement #1; double-deprecate rejected
    await execute([await voynich.methods.deprecateMeasurement().accountsStrict({
      authority: publisher.publicKey, config, measurement: m1Pda, ...events(voynich.programId),
    }).instruction()], [publisher])
    const m1After = decodeMeasurementAccount((await connection.getAccountInfo(m1Pda, 'confirmed'))!.data)
    assert.equal(m1After.status, 'deprecated')
    await assert.rejects(
      execute([await voynich.methods.deprecateMeasurement().accountsStrict({
        authority: publisher.publicKey, config, measurement: m1Pda, ...events(voynich.programId),
      }).instruction()], [publisher]),
      /InvalidMeasurement/,
    )

    // 6. Publish measurement #2 by publisher, then deprecate by config.admin
    await execute([await voynich.methods.publishMeasurement([...digest2], 'https://github.com/voynich-dev/voynich', '1234567890abcdef', [...recipeHash], '0.1.4').accountsStrict({
      publisher: publisher.publicKey, measurement: m2Pda, systemProgram: SystemProgram.programId, ...events(voynich.programId),
    }).instruction()], [publisher])
    await execute([await voynich.methods.deprecateMeasurement().accountsStrict({
      authority: admin.publicKey, config, measurement: m2Pda, ...events(voynich.programId),
    }).instruction()])
    const m2After = decodeMeasurementAccount((await connection.getAccountInfo(m2Pda, 'confirmed'))!.data)
    assert.equal(m2After.status, 'deprecated')
  })

  await t.test('Build 7 Step 1: Policy PDA set_policy, PolicyRequired, PolicyCallerDenied, PolicyOperatorDenied (grant_by_owner & grant_by_enclave), and clear_policy', async () => {
    const { decodePolicyAccount, policyPda, POLICY_SPACE } = await import('../sdk/src/program.js')
    await execute([await voynich.methods.setConfig(configArgs(RECORD_LIFETIME_SLOTS)).accountsStrict({
      admin: admin.publicKey, config, ...events(voynich.programId),
    }).instruction()])
    await refresh(first)
    await refresh(second)

    const policyKey = policyPda(tokenModel.address, voynich.programId)
    const deniedCaller = Keypair.generate()
    await execute([
      SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: deniedCaller.publicKey, lamports: 50_000_000 }),
    ])

    // 1. Invalid policy args rejected (mismatched rate limit, invalid region, unauthorized non-owner)
    await assert.rejects(
      execute([await voynich.methods.setPolicy({
        allowListEnabled: true, allowedCallers: [caller.publicKey], maxCallsPerCallerPerWindow: 5, windowSlots: bn(0), allowedOperators: [], allowedRegions: [],
      }).accountsStrict({ owner: owner.publicKey, model: tokenModel.address, policy: policyKey, systemProgram: SystemProgram.programId, ...events(voynich.programId) }).instruction()], [owner]),
      /InvalidPolicy/,
    )
    await assert.rejects(
      execute([await voynich.methods.setPolicy({
        allowListEnabled: false, allowedCallers: [], maxCallsPerCallerPerWindow: 0, windowSlots: bn(0), allowedOperators: [], allowedRegions: ['US_EAST'],
      }).accountsStrict({ owner: owner.publicKey, model: tokenModel.address, policy: policyKey, systemProgram: SystemProgram.programId, ...events(voynich.programId) }).instruction()], [owner]),
      /InvalidPolicy/,
    )
    await assert.rejects(
      execute([await voynich.methods.setPolicy({
        allowListEnabled: false, allowedCallers: [], maxCallsPerCallerPerWindow: 0, windowSlots: bn(0), allowedOperators: [], allowedRegions: [],
      }).accountsStrict({ owner: deniedCaller.publicKey, model: tokenModel.address, policy: policyKey, systemProgram: SystemProgram.programId, ...events(voynich.programId) }).instruction()], [deniedCaller]),
      /Unauthorized/,
    )

    // 2. Owner sets policy allowing only `caller` and `first.operator` (excluding `second.operator`) in region `us-east`
    await execute([await voynich.methods.setPolicy({
      allowListEnabled: true,
      allowedCallers: [caller.publicKey],
      maxCallsPerCallerPerWindow: 10,
      windowSlots: bn(150),
      allowedOperators: [first.operator.publicKey],
      allowedRegions: ['us-east'],
    }).accountsStrict({
      owner: owner.publicKey, model: tokenModel.address, policy: policyKey, systemProgram: SystemProgram.programId, ...events(voynich.programId),
    }).instruction()], [owner])

    const policyInfo = await connection.getAccountInfo(policyKey, 'confirmed')
    assert.equal(policyInfo?.data.length, POLICY_SPACE)
    const decoded = decodePolicyAccount(policyInfo!.data)
    assert(decoded.model.equals(tokenModel.address))
    assert.equal(decoded.allowListEnabled, true)
    assert.equal(decoded.allowedCallers.length, 1)
    assert(decoded.allowedCallers[0]!.equals(caller.publicKey))
    assert.equal(decoded.maxCallsPerCallerPerWindow, 10)
    assert.equal(decoded.windowSlots.toString(), '150')
    assert.equal(decoded.allowedOperators.length, 1)
    assert(decoded.allowedOperators[0]!.equals(first.operator.publicKey))
    assert.deepEqual(decoded.allowedRegions, ['us-east'])
    assert.equal((await voynich.account.model.fetch(tokenModel.address)).hasPolicy, true)

    // 3. open_call without Policy PDA in remainingAccounts -> PolicyRequired
    const openNoPolicy = await openInstruction(callArgs(tokenModel))
    await assert.rejects(execute([openNoPolicy], [caller]), /PolicyRequired/)

    // 4. open_call with Policy PDA by deniedCaller -> PolicyCallerDenied
    const deniedAta = await getOrCreateAssociatedTokenAccount(connection, admin, tokenModel.mint, deniedCaller.publicKey)
    await mintTo(connection, admin, tokenModel.mint, deniedAta.address, admin, PRICE * 2n)
    const deniedNonce = ++nonce
    const deniedCallAddr = pda(voynich.programId, utf8('call'), deniedCaller.publicKey.toBytes(), u64le(deniedNonce))
    const deniedEscrow = getAssociatedTokenAddressSync(tokenModel.mint, deniedCallAddr, true)
    const openDenied = await voynich.methods.openCall(bn(deniedNonce), [...sha256(utf8('denied'))], { sealed: {} }, null).accountsStrict({
      payer: admin.publicKey, caller: deniedCaller.publicKey, config, model: tokenModel.address, enclave: first.address, attestationRecord: first.record,
      grant: grantAddress(tokenModel, first), call: deniedCallAddr, mint: tokenModel.mint, callerTokens: deniedAta.address, escrowTokens: deniedEscrow,
      tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId, ...events(voynich.programId),
    }).remainingAccounts([{ pubkey: policyKey, isSigner: false, isWritable: false }]).instruction()
    await assert.rejects(execute([openDenied], [deniedCaller]), /PolicyCallerDenied/)

    // 5. open_call with Policy PDA by allowed caller succeeds
    const allowedArgs = callArgs(tokenModel)
    const openAllowed = await voynich.methods.openCall(bn(allowedArgs.nonce), [...allowedArgs.inputHash], { sealed: {} }, null).accountsStrict({
      payer: admin.publicKey, caller: caller.publicKey, config, model: tokenModel.address, enclave: first.address, attestationRecord: first.record,
      grant: grantAddress(tokenModel, first), call: allowedArgs.address, mint: tokenModel.mint, callerTokens: getAssociatedTokenAddressSync(tokenModel.mint, caller.publicKey), escrowTokens: getAssociatedTokenAddressSync(tokenModel.mint, allowedArgs.address, true),
      tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId, ...events(voynich.programId),
    }).remainingAccounts([{ pubkey: policyKey, isSigner: false, isWritable: false }]).instruction()
    await execute([openAllowed], [caller])
    assert.deepEqual((await voynich.account.call.fetch(allowedArgs.address)).status, { open: {} })

    // 6. grant_by_owner & grant_by_enclave: PolicyRequired when omitted, PolicyOperatorDenied for second.operator
    const wrapped = Buffer.from(wrapKey(tokenModel.sealed.key, second.encryption.publicKey))
    await assert.rejects(
      execute([await voynich.methods.grantByOwner(wrapped).accountsStrict({
        owner: owner.publicKey, payer: admin.publicKey, config, model: tokenModel.address, targetEnclave: second.address, targetAttestationRecord: second.record, grant: grantAddress(tokenModel, second), systemProgram: SystemProgram.programId, ...events(voynich.programId),
      }).instruction()], [owner]),
      /PolicyRequired/,
    )
    await assert.rejects(
      execute([await voynich.methods.grantByOwner(wrapped).accountsStrict({
        owner: owner.publicKey, payer: admin.publicKey, config, model: tokenModel.address, targetEnclave: second.address, targetAttestationRecord: second.record, grant: grantAddress(tokenModel, second), systemProgram: SystemProgram.programId, ...events(voynich.programId),
      }).remainingAccounts([{ pubkey: policyKey, isSigner: false, isWritable: false }]).instruction()], [owner]),
      /PolicyOperatorDenied/,
    )
    await assert.rejects(
      execute([await voynich.methods.grantByEnclave(wrapped).accountsStrict({
        signingKey: first.signing.publicKey, payer: admin.publicKey, config, model: tokenModel.address, sourceEnclave: first.address, sourceGrant: grantAddress(tokenModel, first), sourceAttestationRecord: first.record, targetEnclave: second.address, targetAttestationRecord: second.record, grant: grantAddress(tokenModel, second), systemProgram: SystemProgram.programId, ...events(voynich.programId),
      }).remainingAccounts([{ pubkey: policyKey, isSigner: false, isWritable: false }]).instruction()], [first.signing]),
      /PolicyOperatorDenied/,
    )

    // 7. clear_policy closes PDA, resets hasPolicy=false, and allows open_call without remainingAccounts
    await execute([await voynich.methods.clearPolicy().accountsStrict({
      owner: owner.publicKey, model: tokenModel.address, policy: policyKey, ...events(voynich.programId),
    }).instruction()], [owner])
    assert.equal(await connection.getAccountInfo(policyKey, 'confirmed'), null)
    assert.equal((await voynich.account.model.fetch(tokenModel.address)).hasPolicy, false)
    await open(tokenModel)
  })

  await t.test('Build 9 Step 1: set_quote on Grant, two enclaves with different quoted_operator_share_bps settle with exact operator/owner splits', async () => {
    const { decodeGrantAccount, GRANT_SPACE } = await import('../sdk/src/program.js')
    const quoteModel = await createModel('quote-model')
    await uploadAndSeal(quoteModel)
    await refresh(first)
    await refresh(second)
    await execute([await ownerGrant(quoteModel, first)], [owner])
    await execute([await ownerGrant(quoteModel, second)], [owner])

    const grantFirst = grantAddress(quoteModel, first)
    const grantSecond = grantAddress(quoteModel, second)

    // 1. Non-operator cannot set_quote -> Unauthorized
    await assert.rejects(
      execute([await voynich.methods.setQuote(1000).accountsStrict({
        operator: owner.publicKey, model: quoteModel.address, enclave: first.address, grant: grantFirst, systemProgram: SystemProgram.programId, ...events(voynich.programId),
      }).instruction()], [owner]),
      /Unauthorized/,
    )

    // 2. Quote above model.operator_share_bps (OPERATOR_BPS) -> InvalidQuote
    await assert.rejects(
      execute([await voynich.methods.setQuote(OPERATOR_BPS + 1).accountsStrict({
        operator: first.operator.publicKey, model: quoteModel.address, enclave: first.address, grant: grantFirst, systemProgram: SystemProgram.programId, ...events(voynich.programId),
      }).instruction()], [first.operator]),
      /InvalidQuote/,
    )

    // 3. Two enclaves set distinct quotes: first = 1000 bps (10%), second = 2000 bps (20%)
    const quoteFirst = 1000
    const quoteSecond = 2000
    await execute([await voynich.methods.setQuote(quoteFirst).accountsStrict({
      operator: first.operator.publicKey, model: quoteModel.address, enclave: first.address, grant: grantFirst, systemProgram: SystemProgram.programId, ...events(voynich.programId),
    }).instruction()], [first.operator])
    await execute([await voynich.methods.setQuote(quoteSecond).accountsStrict({
      operator: second.operator.publicKey, model: quoteModel.address, enclave: second.address, grant: grantSecond, systemProgram: SystemProgram.programId, ...events(voynich.programId),
    }).instruction()], [second.operator])

    const infoFirst = await connection.getAccountInfo(grantFirst, 'confirmed')
    const infoSecond = await connection.getAccountInfo(grantSecond, 'confirmed')
    assert.ok(infoFirst && infoSecond)
    assert.equal(infoFirst.data.length, GRANT_SPACE)
    assert.equal(infoSecond.data.length, GRANT_SPACE)
    assert.equal(decodeGrantAccount(infoFirst.data).quotedOperatorShareBps, quoteFirst)
    assert.equal(decodeGrantAccount(infoSecond.data).quotedOperatorShareBps, quoteSecond)

    // Helper to open & settle on a specific enclave and return the Receipt account
    const openAndSettleOn = async (target: TestEnclave) => {
      const c = callArgs(quoteModel)
      const openIx = await voynich.methods.openCall(bn(c.nonce), [...c.inputHash], { sealed: {} }, null).accountsStrict({
        payer: caller.publicKey, caller: caller.publicKey, config, model: quoteModel.address, enclave: target.address,
        attestationRecord: target.record, grant: grantAddress(quoteModel, target), call: c.address,
        mint: null, callerTokens: null, escrowTokens: null, tokenProgram: null, associatedTokenProgram: null,
        systemProgram: SystemProgram.programId, ...events(voynich.programId),
      }).instruction()
      await execute([openIx], [caller])
      const outputHash = sha256(utf8(`quote-out-${c.nonce}`))
      const sig = signReceipt(target.signing.secretKey.subarray(0, 32), c.address.toBytes(), c.inputHash, outputHash)
      const verifyIx = Ed25519Program.createInstructionWithPublicKey({
        publicKey: target.signing.publicKey.toBytes(),
        message: receiptMessage(c.address.toBytes(), c.inputHash, outputHash),
        signature: sig,
      })
      const receiptAddr = pda(voynich.programId, utf8('receipt'), c.address.toBytes())
      const settleIx = await voynich.methods.settleCall([...outputHash], [...sig], 0, Buffer.alloc(0)).accountsStrict({
        payer: admin.publicKey, config, model: quoteModel.address, enclave: target.address, attestationRecord: target.record,
        call: c.address, receipt: receiptAddr, caller: caller.publicKey, owner: owner.publicKey,
        operator: target.operator.publicKey, feeRecipient: feeRecipient.publicKey, instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
        escrowTokens: null, ownerTokens: null, operatorTokens: null, protocolTokens: null, callerTokens: null, tokenProgram: null,
        systemProgram: SystemProgram.programId, ...events(voynich.programId),
      }).instruction()
      await execute([verifyIx, settleIx])
      return { call: await voynich.account.call.fetch(c.address), receipt: await voynich.account.receipt.fetch(receiptAddr) }
    }

    // 4. First enclave settles at 10% operator / 5% protocol / 85% owner
    const res1 = await openAndSettleOn(first)
    assert.equal(res1.call.operatorShareBps, quoteFirst)
    const expOp1 = (PRICE * BigInt(quoteFirst)) / 10_000n
    const expProto = (PRICE * BigInt(PROTOCOL_BPS)) / 10_000n
    const expOwner1 = PRICE - expOp1 - expProto
    assert.equal(BigInt(res1.receipt.operatorAmount.toString()), expOp1)
    assert.equal(BigInt(res1.receipt.protocolAmount.toString()), expProto)
    assert.equal(BigInt(res1.receipt.ownerAmount.toString()), expOwner1)

    // 5. Second enclave settles at 20% operator / 5% protocol / 75% owner
    const res2 = await openAndSettleOn(second)
    assert.equal(res2.call.operatorShareBps, quoteSecond)
    const expOp2 = (PRICE * BigInt(quoteSecond)) / 10_000n
    const expOwner2 = PRICE - expOp2 - expProto
    assert.equal(BigInt(res2.receipt.operatorAmount.toString()), expOp2)
    assert.equal(BigInt(res2.receipt.protocolAmount.toString()), expProto)
    assert.equal(BigInt(res2.receipt.ownerAmount.toString()), expOwner2)

    // 6. Clearing quote (null) reverts snapshot to model.operator_share_bps
    await execute([await voynich.methods.setQuote(null).accountsStrict({
      operator: first.operator.publicKey, model: quoteModel.address, enclave: first.address, grant: grantFirst, systemProgram: SystemProgram.programId, ...events(voynich.programId),
    }).instruction()], [first.operator])
    const res3 = await openAndSettleOn(first)
    assert.equal(res3.call.operatorShareBps, OPERATOR_BPS)
    assert.equal(BigInt(res3.receipt.operatorAmount.toString()), (PRICE * BigInt(OPERATOR_BPS)) / 10_000n)

    // 7. Revoking grant blocks set_quote with GrantRequired
    await execute([await voynich.methods.revokeGrant().accountsStrict({
      owner: owner.publicKey, model: quoteModel.address, grant: grantSecond, ...events(voynich.programId),
    }).instruction()], [owner])
    await assert.rejects(
      execute([await voynich.methods.setQuote(500).accountsStrict({
        operator: second.operator.publicKey, model: quoteModel.address, enclave: second.address, grant: grantSecond, systemProgram: SystemProgram.programId, ...events(voynich.programId),
      }).instruction()], [second.operator]),
      /GrantRequired/,
    )
  })
})
