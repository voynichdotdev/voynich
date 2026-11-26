import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ed25519 } from '@noble/curves/ed25519.js'
import { ComputeBudgetProgram, Keypair, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js'
import { CallPieces, DEFAULT_UPLOAD_KEYS, MAX_UPLOAD_KEYS, Manifest, MODEL_BASE_FORMATS, ModelBaseSchema, PriceUnit, ProgramEvent, SettleCallRequest, StopCallAccepted, StopCallRequest, StreamPiece, TOKENIZER_FORMATS, WRITE_CHUNK_BYTES, createClient } from '@voynich/contract'
import { ADAPTER_MAGIC, ADAPTER_VERSION, applyOnnxAdapter, decodeAdapter, encodeAdapter, inspectOnnxInitializers, verifyOnnxAdapterCompatibility } from 'voynich/adapter'
import { ciphertextMerkleRoot, decryptCallOutput, encryptCallOutput, fromHex, generateEncryptionKeyPair, merkleRootFromLeaves, openWeightsChunk, pieceMessage, sealWeights, sha256, signPiece, signReceipt, streamInitialHash, streamNextHash, toBase64, toHex, utf8, verifyPiece } from 'voynich/crypto'
import { decodeModelBaseBytes as sdkDecodeModelBaseBytes, decodeReceiptAccount as sdkDecodeReceiptAccount } from 'voynich/program'
import { fetchBountyAfterSettle, parseSolToLamports, refreshBounties } from '@/lib/bounties'
import { benchmarkRunCliCommand, formatScorePct, loadBenchmarks, loadModelBenchmarks } from '@/lib/benchmarks'
import { DEFAULT_BOND_SLASH_BPS, bondCliCommand, computeUptimePct, formatBondSol, loadEnclaveBond } from '@/lib/bonds'
import { STREAM_PIECES_MAX_ENTRIES, STREAM_PIECES_STORAGE_KEY, STREAM_PIECES_TTL_MS, decodeOpenAnswer, decodeOutput, effectiveShareBps, eligibleEnclaves, follow, followStream, formatLatency, getSavedStreamPiece, loadLastPieceFromApi, loadSavedStreamPieces, parseCeiling, parseTensor, pickEnclave, removeSavedStreamPiece, saveStreamPiece, selectEnclave, settleMeteredStream, verifyBrowserStreamPiece, type CallState } from '@/lib/call'
import { explorerUrl, siteUrl } from '@/lib/env'
import { CALL_STAGES, LINKS, PLACES, RECEIPT_CHECKS } from '@/lib/facts'
import { findMeasurement, formatMeasurementLabel, indexMeasurements, isHttpUrl, loadMeasurements } from '@/lib/measurements'
import { EMPTY_POLICY_DRAFT, formatRateCeiling, isCallerAllowedByPolicy, loadModelPolicy, parseAddressList, parseRegionList, policyEquals, policyToDraft, validatePolicyDraft } from '@/lib/policy'
import { buyModelPass, closeModelPass, computePassSavingsPct, findActiveModelPass, loadAccountPasses, loadModelPassPlan, passPlanCliCommand, setModelPassPlan } from '@/lib/passes'
import { MAX_REFERRAL_SHARE_BPS, buildReferralLink, claimModelReferral, formatReferralBalance, formatReferralShare, loadAccountReferrals, loadModelReferralConfig, parseReferralFromParams, referralSetCliCommand, setModelReferralConfig } from '@/lib/referrals'
import { SESSION_DELEGATES_KEY, findActiveBrowserSession, loadAccountSessions, loadSessionDelegate, removeSessionDelegate, saveSessionDelegate, submitDelegateBuild } from '@/lib/sessions'
import { SPLIT_LIMITS, claimModelSplit, formatSplitPct, loadModelSplit, pctToBps, setModelSplit, splitEquals, splitSetCliCommand, splitToDraft, totalUnclaimedLamports, validateSplitDraft } from '@/lib/splits'
import { effectiveModelVersion, fallbackModelVersions, loadModelVersions, matchReceiptVersion, upgradeCliCommand } from '@/lib/versions'
import {
  ATTACH_WEIGHTS_BATCH, CIPHER_CHUNK_BYTES, INITIAL_CREATE_WEIGHTS, MAX_WEIGHTS, SEAL_RANGE_CHUNKS, WEIGHTS_CAPACITY, WRITE_BYTES, WRITE_PARALLEL,
  addSealMetrics, attachWeights, checkLocalBaseFile, chunkCount, deriveSealSecrets, formatAdapterOps, inferBaseFormat, inspectAdapterBytes, modelPdaAddress, newUploadKeys, partitionChunks, reseal, resumeCliCommand, saveSeal, sealChunkCount, sealDerivationMessage, sealRangeCount, sealRanges, sealSummary, signSealDerivation, signWithUploadKey, stateFromModel, txFeeLamports, uploadFunding, verifySealDerivationSignature, weightsCount, writeChunks, type SealState,
} from '@/lib/seal'
import { TxError, errorMessage, send, txRouteFor } from '@/lib/tx'
import { checkAnswer, checkBase, checkSignature, decodeModelBaseBytes, decodeReceiptBytes, RECEIPT_LEGACY_SPACE, RECEIPT_METERED_EXTENSION, RECEIPT_METERED_SPACE, verifyAll } from '@/lib/verify'
import { chooseRoute } from '@/src/engines/tx/client/flow'
import * as sitemapMod from '@/app/sitemap'
import * as robotsMod from '@/app/robots'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('Blocking #1: multi-signer /seal tx signs wallet-first, cosigns uploadKey after, and relays on mainnet-beta', async () => {
  const owner = Keypair.generate()
  const upload = Keypair.generate()
  const blockhash = Keypair.generate().publicKey.toBase58()
  const baseIxs = [SystemProgram.transfer({ fromPubkey: upload.publicKey, toPubkey: owner.publicKey, lamports: 1000 })]
  const unsigned = new VersionedTransaction(
    new TransactionMessage({ payerKey: owner.publicKey, recentBlockhash: blockhash, instructions: baseIxs }).compileToV0Message()
  )
  const build = {
    id: 'build-1',
    action: 'seal_model' as const,
    transactionBase64: Buffer.from(unsigned.serialize()).toString('base64'),
    blockhash,
    lastValidBlockHeight: 100,
    cosigned: false,
    requiredSigners: [owner.publicKey.toBase58(), upload.publicKey.toBase58()],
    fixture: false,
    addresses: {},
  }

  let walletSawUnsigned = false
  let walletSentCalled = false
  const mockConn = {
    wallet: {
      name: 'MockPhantom',
      features: {
        'solana:signTransaction': {
          signTransaction: async ({ transaction }: { transaction: Uint8Array }) => {
            const incoming = VersionedTransaction.deserialize(transaction)
            walletSawUnsigned = incoming.signatures.every((sig) => sig.every((b) => b === 0))
            // Simulate Phantom adding ComputeBudget before signing as fee payer
            const modified = new VersionedTransaction(
              new TransactionMessage({
                payerKey: owner.publicKey,
                recentBlockhash: blockhash,
                instructions: [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 5000 }), ...baseIxs],
              }).compileToV0Message()
            )
            modified.sign([owner])
            return [{ signedTransaction: modified.serialize() }]
          },
        },
        'solana:signAndSendTransaction': {
          signAndSendTransaction: async () => {
            walletSentCalled = true
            throw new Error('wallet-sent must not be used for co-signed builds')
          },
        },
      },
    },
    account: { address: owner.publicKey.toBase58(), publicKey: owner.publicKey.toBytes() },
    chain: 'solana:mainnet',
  } as unknown as Parameters<typeof chooseRoute>[0]

  // Even with cosigned:false and mainnet-beta, txRouteFor sees multiple requiredSigners and chooses relay
  assert.equal(txRouteFor(mockConn, build, 'mainnet-beta'), 'relay')
  assert.equal(txRouteFor(mockConn, build, 'mainnet-beta', true), 'relay')

  // Missing cosign callback on multi-signer build fails early rather than falling back to wallet-sent
  await assert.rejects(
    () => send({} as never, build, undefined, { connection: mockConn, cluster: 'mainnet-beta' }),
    (err: unknown) => err instanceof TxError && err.stage === 'build'
  )

  let submittedMode: string | null = null
  let submittedBytesBase64 = ''
  const mockClient = {
    submitTransaction: async (input: { mode: string; signedTransactionBase64?: string }) => {
      submittedMode = input.mode
      submittedBytesBase64 = input.signedTransactionBase64 ?? ''
      return { id: 'build-1', status: 'confirmed', signature: 'sig-ok' }
    },
    transaction: async () => ({ id: 'build-1', status: 'confirmed', signature: 'sig-ok' }),
  } as unknown as Parameters<typeof send>[0]

  const uploadSecretB64 = Buffer.from(upload.secretKey.slice(0, 32)).toString('base64')
  const status = await send(mockClient, build, undefined, {
    connection: mockConn,
    cluster: 'mainnet-beta',
    cosign: (txB64) => signWithUploadKey(txB64, uploadSecretB64),
  })

  assert.equal(status.status, 'confirmed')
  assert.equal(walletSentCalled, false, 'wallet-sent must never be called for co-signed transactions')
  assert.equal(walletSawUnsigned, true, 'wallet must receive unsigned transaction before uploadKey signs')
  assert.equal(submittedMode, 'relay')

  const finalTx = VersionedTransaction.deserialize(Buffer.from(submittedBytesBase64, 'base64'))
  const msgBytes = finalTx.message.serialize()
  const signers = finalTx.message.staticAccountKeys.slice(0, finalTx.message.header.numRequiredSignatures)
  const ownerSlot = signers.findIndex((k) => k.equals(owner.publicKey))
  const uploadSlot = signers.findIndex((k) => k.equals(upload.publicKey))
  assert.ok(ownerSlot >= 0 && uploadSlot >= 0)
  assert.equal(ed25519.verify(finalTx.signatures[ownerSlot]!, msgBytes, owner.publicKey.toBytes()), true, 'owner signature valid on modified msg')
  assert.equal(ed25519.verify(finalTx.signatures[uploadSlot]!, msgBytes, upload.publicKey.toBytes()), true, 'uploadKey signature valid on modified msg')

  const sealFlow = fs.readFileSync(path.join(ROOT, 'components/seal/SealFlow.tsx'), 'utf8')
  assert.doesNotMatch(sealFlow, /build\s*=\s*\{\s*\.\.\.build,\s*transactionBase64:\s*await\s+signWithUploadKey\(/)
})

test('Blocking #2: Railway config, mainnet-beta explorer URL, and empty NEXT_PUBLIC_SITE_URL safety', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { scripts: { start: string }; engines?: { node?: string } }
  assert.equal(pkg.engines?.node, '22.x')
  assert.equal(pkg.scripts.start, 'node scripts/start.mjs')
  assert.ok(fs.existsSync(path.join(ROOT, 'scripts/start.mjs')))
  const startScript = fs.readFileSync(path.join(ROOT, 'scripts/start.mjs'), 'utf8')
  assert.match(startScript, /process\.env\.HOST/)
  assert.match(startScript, /process\.env\.PORT/)


  assert.equal(explorerUrl('tx', 'abc123', 'mainnet-beta'), 'https://explorer.solana.com/tx/abc123')
  assert.equal(explorerUrl('address', 'addr123', 'mainnet'), 'https://explorer.solana.com/address/addr123')
  assert.match(explorerUrl('tx', 'abc123', 'localnet'), /^\S+\?cluster=custom&customUrl=/)

  const layoutSrc = fs.readFileSync(path.join(ROOT, 'app/layout.tsx'), 'utf8')
  assert.match(layoutSrc, /export function generateMetadata/)
  assert.match(layoutSrc, /new URL\(siteUrl\(\)\)/)

  const prevSiteUrl = process.env.NEXT_PUBLIC_SITE_URL
  try {
    process.env.NEXT_PUBLIC_SITE_URL = ''
    assert.equal(siteUrl(), 'http://127.0.0.1:9701')
    assert.equal(new URL(siteUrl()).toString(), 'http://127.0.0.1:9701/')

    assert.equal(sitemapMod.dynamic, 'force-dynamic')
    assert.equal(robotsMod.dynamic, 'force-dynamic')
    const sm = sitemapMod.default()
    assert.ok(sm.length > 0 && sm.every((entry) => new URL(entry.url).hostname === '127.0.0.1'))
    const rb = robotsMod.default()
    assert.equal(rb.sitemap, 'http://127.0.0.1:9701/sitemap.xml')

    process.env.NEXT_PUBLIC_SITE_URL = 'https://voynich.example/sub'
    assert.equal(siteUrl(), 'https://voynich.example')
    assert.equal(new URL(siteUrl()).toString(), 'https://voynich.example/')
    assert.equal(robotsMod.default().sitemap, 'https://voynich.example/sitemap.xml')
  } finally {
    if (prevSiteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL
    else process.env.NEXT_PUBLIC_SITE_URL = prevSiteUrl
  }
})

test('Blocking #3: UI copy reflects attest + dev standard-server launch without confidential-VM-only claims', () => {
  const enclaveDetail = fs.readFileSync(path.join(ROOT, 'app/enclaves/[key]/page.tsx'), 'utf8')
  assert.ok(enclaveDetail.includes("rec.hardwareType === 'dev'"))
  assert.ok(!enclaveDetail.includes('written by {HARDWARE.attestation}: the signing key lives only inside it'))

  const enclavesList = fs.readFileSync(path.join(ROOT, 'app/enclaves/page.tsx'), 'utf8')
  assert.ok(!enclavesList.includes('living inside attested hardware'))

  const operators = fs.readFileSync(path.join(ROOT, 'app/operators/page.tsx'), 'utf8')
  assert.ok(!operators.includes('inside a confidential VM.'))
  assert.ok(operators.includes('HARDWARE.launchMode') && operators.includes('HARDWARE.launchVerifier'))

  const sealing = fs.readFileSync(path.join(ROOT, 'app/sealing/page.tsx'), 'utf8')
  assert.ok(!sealing.includes('is a process inside a confidential VM'))
  assert.ok(!sealing.includes('inside its hardware'))

  const diagrams = fs.readFileSync(path.join(ROOT, 'components/pages/diagrams.tsx'), 'utf8')
  assert.ok(!diagrams.includes('starts inside the confidential VM'))
  assert.ok(!diagrams.includes('living inside attested hardware'))

  assert.equal(LINKS.x, 'https://x.com/voynichdotdev')
})

test('Promoted Backlog: parseTensor flattens nested arrays matching manifest.inputShape', () => {
  assert.deepEqual(parseTensor('[[1, 2, 3], [4, 5, 6]]', [2, 3]), { ok: true, value: [1, 2, 3, 4, 5, 6] })
  assert.deepEqual(parseTensor('[[[1, 2], [3, 4]], [[5, 6], [7, 8]]]', [2, 2, 2]), { ok: true, value: [1, 2, 3, 4, 5, 6, 7, 8] })
  assert.deepEqual(parseTensor('[1, 2, 3, 4, 5, 6]', [2, 3]), { ok: true, value: [1, 2, 3, 4, 5, 6] })
  assert.deepEqual(parseTensor('[[42]]', [1, 1]), { ok: true, value: [42] })
  assert.equal(parseTensor('[[1, 2], [3, 4, 5, 6]]', [2, 3]).ok, false)
  assert.equal(parseTensor('[[1, 2, 3], [4, 5, "x"]]', [2, 3]).ok, false)
})

test('Build 1 Step 1: open answers check, legacy sealed pass, decodeOpenAnswer, and follow() without outputEnvelope', async () => {
  assert.equal(RECEIPT_CHECKS.length, 5)
  assert.equal(RECEIPT_CHECKS[3]?.id, 'answer')

  const enclaveKey = Keypair.generate()
  const callAddr = Keypair.generate().publicKey
  const modelAddr = Keypair.generate().publicKey
  const enclaveAddr = Keypair.generate().publicKey
  const recordAddr = Keypair.generate().publicKey
  const attestProg = Keypair.generate().publicKey
  const inputHashBytes = sha256(utf8('encrypted-input'))
  const inputHash = toHex(inputHashBytes)
  const payload = JSON.stringify({ label: 'clock', probability: 0.97 })
  const payloadBytes = utf8(payload)
  const outputHashBytes = sha256(payloadBytes)
  const outputHash = toHex(outputHashBytes)
  const sig = signReceipt(enclaveKey.secretKey.slice(0, 32), callAddr.toBytes(), inputHashBytes, outputHashBytes)
  const measurement = 'a'.repeat(96)

  const callerAddr = Keypair.generate().publicKey
  const makeView = (answerMode: 'sealed' | 'open', openAnswer: string | null, callerIsProgram = false) => ({
    receipt: {
      address: Keypair.generate().publicKey.toBase58(),
      call: callAddr.toBase58(),
      caller: callerAddr.toBase58(),
      callerIsProgram,
      model: modelAddr.toBase58(),
      modelName: 'sketch-32',
      enclave: enclaveAddr.toBase58(),
      inputHash,
      outputHash,
      signature: toBase64(sig),
      answerMode,
      openAnswer,
      slot: '150',
      transactionSignature: '5'.repeat(88),
      deliveredCount: null,
      returnedAmount: null,
      payments: {
        mint: null,
        total: '10000000',
        owner: { recipient: Keypair.generate().publicKey.toBase58(), amount: '7000000' },
        operator: { recipient: Keypair.generate().publicKey.toBase58(), amount: '2500000' },
        protocol: { recipient: Keypair.generate().publicKey.toBase58(), amount: '500000' },
      },
    },
    enclaveSigningKey: enclaveKey.publicKey.toBase58(),
    attestationRecord: {
      address: recordAddr.toBase58(),
      signingKey: enclaveKey.publicKey.toBase58(),
      encryptionKey: toBase64(new Uint8Array(32)),
      hardwareType: 'dev' as const,
      measurement,
      recordedSlot: '100',
      expiresAtSlot: '500',
      layoutVersion: 1,
    },
    attestationProgramId: attestProg.toBase58(),
    recordLayoutVersion: 1,
    modelBase: null,
  })

  // Open receipt passes all 5 checks
  const openView = makeView('open', toBase64(payloadBytes))
  const openChecks = await verifyAll(openView, null, undefined, 0)
  assert.equal(openChecks.length, 5)
  assert.ok(openChecks.every((c) => c.passed), 'all 5 checks must pass for valid open receipt')

  // Tampered open answer fails the 4th check
  const tampered = makeView('open', toBase64(utf8('{"label":"star","probability":0.99}')))
  assert.equal((await checkAnswer(tampered)).passed, false)

  // Missing open answer fails the 4th check
  assert.equal((await checkAnswer(makeView('open', null))).passed, false)

  // Legacy/sealed receipt passes all 5 checks cleanly
  const sealedChecks = await verifyAll(makeView('sealed', null), null, undefined, 0)
  assert.equal(sealedChecks.length, 5)
  assert.ok(sealedChecks.every((c) => c.passed), 'sealed/legacy receipts must pass cleanly')

  // decodeOutput & decodeOpenAnswer handle compact { label, probability } and plain UTF-8
  const compact = decodeOutput({ label: 'clock', probability: 0.97 })
  assert.equal(compact.label, 'clock')
  assert.equal(compact.scores[0]?.probability, 0.97)
  const plain = decodeOpenAnswer(toBase64(utf8('raw-utf8-answer')))
  assert.equal(plain.text, 'raw-utf8-answer')
  assert.equal(plain.output, null)

  // follow() resolves open answer from settled receipt without outputEnvelope
  const patches: Partial<CallState>[] = []
  const mockClient = {
    answer: async () => ({
      status: 'answered' as const,
      call: {
        address: callAddr.toBase58(),
        caller: callerAddr.toBase58(),
        callerIsProgram: false,
        model: modelAddr.toBase58(),
        modelName: 'sketch-32',
        enclave: enclaveAddr.toBase58(),
        inputHash,
        answerMode: 'open' as const,
        price: { amount: '10000000', mint: null, decimals: 9, symbol: 'SOL' },
        openedSlot: '120',
        deadlineSlot: '570',
        status: 'settled' as const,
        receipt: openView.receipt.address,
        failure: null,
      },
      outputEnvelope: null,
      openAnswer: null,
      outputHash,
      signature: toBase64(sig),
      settleTransaction: '5'.repeat(88),
      receiptAddress: openView.receipt.address,
      failure: null,
    }),
    receipt: async () => openView,
    config: async () => null,
  } as unknown as Parameters<typeof follow>[0]

  const mockModel = { allowedMeasurements: [measurement] } as unknown as Parameters<typeof follow>[1]
  await follow(mockClient, mockModel, callAddr.toBase58(), inputHash, new Uint8Array(32), (p) => patches.push(p))
  const verifiedPatch = patches.find((p) => p.stage === 'verified')
  assert.ok(verifiedPatch, 'follow() must reach verified state on open calls without outputEnvelope')
  assert.equal(verifiedPatch.output?.label, 'clock')
  assert.equal(verifiedPatch.output?.scores[0]?.probability, 0.97)
})

test('Build 1 Step 2: decodeReceiptBytes and chain checkAnswer handle 401B, 406+N, and 407+N receipts; UI renders Program badge', async () => {
  const disc = sha256(utf8('account:Receipt')).subarray(0, 8)
  const callAddr = Keypair.generate().publicKey
  const callerAddr = Keypair.generate().publicKey
  const modelAddr = Keypair.generate().publicKey
  const enclaveAddr = Keypair.generate().publicKey
  const programId = Keypair.generate().publicKey.toBase58()
  const inputHashBytes = sha256(utf8('in'))
  const openBytes = utf8('{"label":"sun","probability":0.95}')
  const outputHashBytes = sha256(openBytes)
  const sealedHashBytes = sha256(utf8('ciphertext'))

  const buildRawReceipt = (
    era: 'legacy' | 'step1' | 'step2',
    mode: 'sealed' | 'open',
    openPayload: Uint8Array,
    callerIsProgram: boolean,
    outHash: Uint8Array,
  ) => {
    const extra = era === 'legacy' ? 0 : era === 'step1' ? 5 + openPayload.length : 6 + openPayload.length
    const buf = new Uint8Array(RECEIPT_LEGACY_SPACE + extra)
    const view = new DataView(buf.buffer)
    buf.set(disc, 0)
    buf.set(callAddr.toBytes(), 8)
    buf.set(modelAddr.toBytes(), 40)
    buf.set(enclaveAddr.toBytes(), 72)
    buf.set(inputHashBytes, 104)
    buf.set(outHash, 136)
    view.setBigUint64(232, 150n, true)
    buf[400] = 254
    if (era !== 'legacy') {
      buf[401] = mode === 'open' ? 1 : 0
      view.setUint32(402, openPayload.length, true)
      buf.set(openPayload, 406)
      if (era === 'step2') buf[406 + openPayload.length] = callerIsProgram ? 1 : 0
    }
    return buf
  }

  const rawLegacy = buildRawReceipt('legacy', 'sealed', new Uint8Array(0), false, sealedHashBytes)
  assert.equal(rawLegacy.length, 401)
  const decLegacy = decodeReceiptBytes(rawLegacy)
  assert.equal(decLegacy.era, 'legacy')
  assert.equal(decLegacy.answerMode, 'sealed')
  assert.equal(decLegacy.callerIsProgram, false)
  assert.equal(decLegacy.call, callAddr.toBase58())

  const rawStep1 = buildRawReceipt('step1', 'open', openBytes, false, outputHashBytes)
  assert.equal(rawStep1.length, 406 + openBytes.length)
  const decStep1 = decodeReceiptBytes(rawStep1)
  assert.equal(decStep1.era, 'step1')
  assert.equal(decStep1.answerMode, 'open')
  assert.equal(decStep1.callerIsProgram, false)
  assert.deepEqual(decStep1.openAnswer, openBytes)

  const rawStep2Prog = buildRawReceipt('step2', 'open', openBytes, true, outputHashBytes)
  assert.equal(rawStep2Prog.length, 407 + openBytes.length)
  const decStep2Prog = decodeReceiptBytes(rawStep2Prog)
  assert.equal(decStep2Prog.era, 'step2')
  assert.equal(decStep2Prog.answerMode, 'open')
  assert.equal(decStep2Prog.callerIsProgram, true)
  assert.deepEqual(decStep2Prog.openAnswer, openBytes)

  const rawStep2Wallet = buildRawReceipt('step2', 'open', openBytes, false, outputHashBytes)
  assert.equal(decodeReceiptBytes(rawStep2Wallet).callerIsProgram, false)

  // Invalid accounts throw cleanly
  const badDisc = rawLegacy.slice()
  badDisc[0] ^= 0xff
  assert.throws(() => decodeReceiptBytes(badDisc), /discriminator/)
  assert.throws(() => decodeReceiptBytes(rawLegacy.subarray(0, 400)), /length/)
  const badFlag = rawStep2Prog.slice()
  badFlag[badFlag.length - 1] = 2
  assert.throws(() => decodeReceiptBytes(badFlag), /callerIsProgram/)

  // Chain checkAnswer reads raw account bytes via RPC for all three eras
  const chainConfig = {
    mode: 'chain' as const,
    cluster: 'localnet' as const,
    rpcUrl: 'http://127.0.0.1:8899',
    programId,
    attestationProgramId: Keypair.generate().publicKey.toBase58(),
    protocolFeeBps: 500,
    enclaveEncryptionKey: null,
  }
  const makeViewFor = (mode: 'sealed' | 'open', payload: Uint8Array | null, callerIsProgram: boolean, outHash: Uint8Array) => ({
    receipt: {
      address: Keypair.generate().publicKey.toBase58(),
      call: callAddr.toBase58(),
      caller: callerAddr.toBase58(),
      callerIsProgram,
      model: modelAddr.toBase58(),
      modelName: 'sketch-32',
      enclave: enclaveAddr.toBase58(),
      inputHash: toHex(inputHashBytes),
      outputHash: toHex(outHash),
      signature: toBase64(new Uint8Array(64)),
      answerMode: mode,
      openAnswer: payload ? toBase64(payload) : null,
      slot: '150',
      transactionSignature: '5'.repeat(88),
      deliveredCount: null,
      returnedAmount: null,
      payments: {
        mint: null,
        total: '10000000',
        owner: { recipient: Keypair.generate().publicKey.toBase58(), amount: '7000000' },
        operator: { recipient: Keypair.generate().publicKey.toBase58(), amount: '2500000' },
        protocol: { recipient: Keypair.generate().publicKey.toBase58(), amount: '500000' },
      },
    },
    enclaveSigningKey: Keypair.generate().publicKey.toBase58(),
    attestationRecord: {
      address: Keypair.generate().publicKey.toBase58(),
      signingKey: Keypair.generate().publicKey.toBase58(),
      encryptionKey: toBase64(new Uint8Array(32)),
      hardwareType: 'dev' as const,
      measurement: 'a'.repeat(96),
      recordedSlot: '100',
      expiresAtSlot: '500',
      layoutVersion: 1,
    },
    attestationProgramId: chainConfig.attestationProgramId,
    recordLayoutVersion: 1,
    modelBase: null,
  })

  const origFetch = globalThis.fetch
  let currentRaw: Uint8Array = rawLegacy
  globalThis.fetch = (async () => ({
    json: async () => ({
      result: { value: { owner: programId, data: [toBase64(currentRaw), 'base64'] } },
    }),
  })) as unknown as typeof fetch

  try {
    currentRaw = rawLegacy
    assert.equal((await checkAnswer(makeViewFor('sealed', null, false, sealedHashBytes), chainConfig)).passed, true)

    currentRaw = rawStep1
    assert.equal((await checkAnswer(makeViewFor('open', openBytes, false, outputHashBytes), chainConfig)).passed, true)

    currentRaw = rawStep2Prog
    assert.equal((await checkAnswer(makeViewFor('open', openBytes, true, outputHashBytes), chainConfig)).passed, true)

    // Mismatched callerIsProgram on chain fails checkAnswer
    assert.equal((await checkAnswer(makeViewFor('open', openBytes, false, outputHashBytes), chainConfig)).passed, false)

    // Tampered on-chain open bytes fail checkAnswer
    const tamperedOnChain = buildRawReceipt('step2', 'open', utf8('{"label":"moon","probability":0.5}'), true, outputHashBytes)
    currentRaw = tamperedOnChain
    assert.equal((await checkAnswer(makeViewFor('open', openBytes, true, outputHashBytes), chainConfig)).passed, false)
  } finally {
    globalThis.fetch = origFetch
  }

  // UI renders Caller and Program badge in both ModelView and ReceiptView
  const modelViewSrc = fs.readFileSync(path.join(ROOT, 'components/model/ModelView.tsx'), 'utf8')
  assert.ok(modelViewSrc.includes('r.caller') && modelViewSrc.includes('r.callerIsProgram') && modelViewSrc.includes('Program'))
  const receiptViewSrc = fs.readFileSync(path.join(ROOT, 'components/receipt/ReceiptView.tsx'), 'utf8')
  assert.ok(receiptViewSrc.includes('receipt.caller') && receiptViewSrc.includes('receipt.callerIsProgram') && receiptViewSrc.includes('Program'))
})

test('Build 1 Step 3: next.config permanently redirects /docs/program/reading-a-receipt to /docs/program/calling-a-model', () => {
  const nextConfigSrc = fs.readFileSync(path.join(ROOT, 'next.config.ts'), 'utf8')
  assert.match(nextConfigSrc, /async redirects\(\)/)
  assert.match(nextConfigSrc, /source:\s*['"]\/docs\/program\/reading-a-receipt['"]/)
  assert.match(nextConfigSrc, /destination:\s*['"]\/docs\/program\/calling-a-model['"]/)
  assert.match(nextConfigSrc, /permanent:\s*true/)

  const sm = sitemapMod.default()
  assert.ok(sm.some((e) => e.url.endsWith('/docs/program/calling-a-model')), 'sitemap must include /docs/program/calling-a-model')
  assert.ok(!sm.some((e) => e.url.endsWith('/docs/program/reading-a-receipt')), 'sitemap must not include /docs/program/reading-a-receipt')
})

test('Build 1 Step 5: bounties helpers, nav/sitemap, Bands programCalls, and /bounties wiring', async () => {
  assert.equal(parseSolToLamports('0.02'), 20_000_000n)
  assert.equal(parseSolToLamports('1'), 1_000_000_000n)
  assert.equal(parseSolToLamports('.005'), 5_000_000n)
  assert.equal(parseSolToLamports('0.000000001'), 1n)
  assert.equal(parseSolToLamports('0'), null)
  assert.equal(parseSolToLamports('-0.1'), null)
  assert.equal(parseSolToLamports('abc'), null)
  assert.equal(parseSolToLamports('0.0000000001'), null)

  assert.ok(PLACES.some((p) => p.href === '/bounties' && p.label === 'Bounties'), 'PLACES must include /bounties')
  const sm = sitemapMod.default()
  assert.ok(sm.some((e) => e.url.endsWith('/bounties')), 'sitemap must include /bounties')

  let polls = 0
  const mockClient = {
    bounties: async () => {
      polls++
      return {
        items: polls >= 2 ? [{ address: 'Bounty1', status: 'claimed' }] : [{ address: 'Bounty1', status: 'open' }],
        page: { hasMore: false, nextCursor: null },
      }
    },
  } as unknown as Parameters<typeof refreshBounties>[0]
  const refreshed = await refreshBounties(mockClient, (items) => items.some((b) => b.status === 'claimed'), 3)
  assert.equal(polls, 2)
  assert.equal(refreshed[0]?.status, 'claimed')

  const bandsSrc = fs.readFileSync(path.join(ROOT, 'components/landing/Bands.tsx'), 'utf8')
  assert.ok(bandsSrc.includes('stats.programCalls') && bandsSrc.includes('Program calls') && bandsSrc.includes('href="/bounties"'))

  const pageSrc = fs.readFileSync(path.join(ROOT, 'app/bounties/page.tsx'), 'utf8')
  assert.ok(pageSrc.includes('client.bounties') && pageSrc.includes('BountiesView'))

  const viewSrc = fs.readFileSync(path.join(ROOT, 'components/bounties/BountiesView.tsx'), 'utf8')
  for (const sym of ['DrawPad', 'runBountyDraw', 'collectBounty', 'postBounty', 'cancelBounty', 'RECEIPT_CHECKS']) {
    assert.ok(viewSrc.includes(sym), `BountiesView must reference ${sym}`)
  }
})

test('Build 1 Step 6: fetchBountyAfterSettle detects single-tx atomic payout and keeps legacy open fallback', async () => {
  let calls = 0
  const atomicClient = {
    bounty: async () => {
      calls++
      return {
        bounty:
          calls >= 2
            ? { address: 'B1', status: 'claimed', winningCall: 'CallWin' }
            : { address: 'B1', status: 'open', winningCall: null },
        attempts: [],
      }
    },
  } as unknown as Parameters<typeof fetchBountyAfterSettle>[0]
  const claimed = await fetchBountyAfterSettle(atomicClient, 'B1', 'CallWin', 4, 10)
  assert.equal(calls, 2)
  assert.equal(claimed?.status, 'claimed')
  assert.equal(claimed?.winningCall, 'CallWin')

  const legacyClient = {
    bounty: async () => ({
      bounty: { address: 'B2', status: 'open', winningCall: null },
      attempts: [],
    }),
  } as unknown as Parameters<typeof fetchBountyAfterSettle>[0]
  const stillOpen = await fetchBountyAfterSettle(legacyClient, 'B2', 'CallLegacy', 2, 10)
  assert.equal(stillOpen?.status, 'open')

  const viewSrc = fs.readFileSync(path.join(ROOT, 'components/bounties/BountiesView.tsx'), 'utf8')
  assert.ok(viewSrc.includes('fetchBountyAfterSettle'), 'BountiesView must refresh /v1/bounties/:address after settle')
  assert.ok(viewSrc.includes('Settled and paid in one transaction'), 'BountiesView must render single-tx settled-and-paid state')
  assert.ok(viewSrc.includes('latest.winningCall === callAddress'), 'BountiesView must match winningCall against settled call')
})

test('Build 1 Step 7: /docs/sdk/from-an-agent in sitemap and /account supports ?wallet=<pubkey> inspection', () => {
  const sm = sitemapMod.default()
  assert.ok(sm.some((e) => e.url.endsWith('/docs/sdk/from-an-agent')), 'sitemap must include /docs/sdk/from-an-agent')
  const accountPage = fs.readFileSync(path.join(ROOT, 'app/account/page.tsx'), 'utf8')
  assert.ok(accountPage.includes('sp.wallet') && accountPage.includes('walletAddress'))
  const accountView = fs.readFileSync(path.join(ROOT, 'components/account/AccountView.tsx'), 'utf8')
  assert.ok(accountView.includes('walletAddress') && accountView.includes('canSign'))
})

test('Build 2 Step 1: seal metrics helpers compute fees, elapsed time, and done summary', () => {
  const payer = Keypair.generate()
  const blockhash = Keypair.generate().publicKey.toBase58()
  const txBase = new VersionedTransaction(
    new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: blockhash,
      instructions: [SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 })],
    }).compileToV0Message(),
  )
  assert.equal(txFeeLamports(txBase), 5_000n)

  const txPriority = new VersionedTransaction(
    new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: blockhash,
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 15_000 }),
        SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 }),
      ],
    }).compileToV0Message(),
  )
  // 5000 base + ceil(100_000 * 15_000 / 1_000_000) = 6500
  assert.equal(txFeeLamports(txPriority), 6_500n)

  let m = addSealMetrics(undefined, { startedAtMs: 1_000 })
  m = addSealMetrics(m, { transactionsSent: 2, feesLamports: 20_000n })
  m = addSealMetrics(m, { bytesWritten: 252_145, transactionsSent: 493, feesLamports: 2_465_000n })
  m = addSealMetrics(m, { bytesWritten: 252_145, transactionsSent: 2, feesLamports: 15_000n, finishedAtMs: 163_249 })

  const state = {
    step: 'done',
    fileName: 'weights.onnx',
    name: 'sketch-32',
    manifest: { name: 'sketch-32', inputKind: 'sketch', inputShape: [1, 1, 28, 28], labels: ['clock'] },
    price: { amount: '10000000', mint: null, decimals: 9, symbol: 'SOL' },
    operatorShareBps: 2500,
    allowedMeasurements: ['a'.repeat(96)],
    plaintextBytes: 252_081,
    sizeBytes: 252_145,
    sha256: 'b'.repeat(64),
    cipher: { id: 'xchacha20poly1305-64k-v1', chunkSizeBytes: 65536, noncePrefix: toBase64(new Uint8Array(16)) },
    metrics: m,
  } satisfies SealState

  const summary = sealSummary(state)
  assert.equal(summary.bytesWritten, 252_145)
  assert.equal(summary.transactionsSent, 497)
  assert.equal(summary.feesLamports, '2500000')
  assert.ok(summary.elapsedSeconds !== null && Math.abs(summary.elapsedSeconds - 162.249) < 0.001)

  const fallbackSummary = sealSummary({ ...state, metrics: undefined })
  assert.equal(fallbackSummary.bytesWritten, 252_145)
  assert.equal(fallbackSummary.transactionsSent, 288)
  assert.equal(fallbackSummary.elapsedSeconds, null)
  assert.equal(fallbackSummary.feesLamports, '1440000')

  const sealFlowSrc = fs.readFileSync(path.join(ROOT, 'components/seal/SealFlow.tsx'), 'utf8')
  for (const label of ['Bytes written', 'Transactions sent', 'Elapsed', 'Fees paid']) {
    assert.ok(sealFlowSrc.includes(label), `SealFlow done state must render ${label}`)
  }
})

test('Build 2 Step 2: WRITE_BYTES sources WRITE_CHUNK_BYTES (888) and honors quote.writeChunkBytes', () => {
  assert.equal(WRITE_CHUNK_BYTES, 888)
  assert.equal(WRITE_BYTES, WRITE_CHUNK_BYTES)
  assert.equal(chunkCount(252_145), 284)
  assert.equal(chunkCount(1_048_576), 1181)
  assert.equal(chunkCount(252_145, 512), 493)
  assert.ok(uploadFunding(1_048_576) < uploadFunding(1_048_576, 512))
  assert.equal(uploadFunding(1_048_576), BigInt(1181 + Math.ceil(1181 / 10) + sealRangeCount(1_048_576)) * 5000n)

  const sealFlowSrc = fs.readFileSync(path.join(ROOT, 'components/seal/SealFlow.tsx'), 'utf8')
  assert.ok(sealFlowSrc.includes('quote.writeChunkBytes') && sealFlowSrc.includes('writeChunkBytes: r.data.writeChunkBytes'))
})

test('Build 2 Step 3: multi-key chunk partitioning, parallel writeChunks, secret stripping, and SealFlow wiring', async () => {
  assert.equal(DEFAULT_UPLOAD_KEYS, 8)
  assert.equal(MAX_UPLOAD_KEYS, 8)
  assert.equal(WRITE_PARALLEL, 8)

  assert.deepEqual(partitionChunks([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 4), [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7],
    [8, 9],
  ])
  assert.deepEqual(partitionChunks([2, 5], 8), [[2], [5]])
  assert.deepEqual(partitionChunks([], 8), [])

  assert.ok(uploadFunding(1_048_576, 888, 8) > uploadFunding(1_048_576, 888, 1))

  const keys = newUploadKeys(4)
  const uploadKeys = keys.map((k) => k.address)
  const uploadSecrets = Object.fromEntries(keys.map((k) => [k.address, k.secret]))
  const usedWallets = new Set<string>()
  const ciphertext = new Uint8Array(888 * 8)
  const flags = new Uint8Array(8)
  const mockClient = {
    writeWeights: async (_model: string, body: { wallet: string; offset: number }) => {
      usedWallets.add(body.wallet)
      return {
        id: `tx-${body.offset}`,
        transactionBase64: toBase64(new Uint8Array(16)),
        blockhash: '11111111111111111111111111111111',
        lastValidBlockHeight: 100,
        cosigned: false,
        action: 'write_weights',
        requiredSigners: [body.wallet],
        fixture: true,
        addresses: {},
      }
    },
    submitTransaction: async (input: { buildId: string }) => ({ id: input.buildId, status: 'confirmed' }),
    transaction: async (id: string) => ({ id, status: 'confirmed' }),
  } as unknown as Parameters<typeof writeChunks>[0]['client']

  const result = await writeChunks({
    client: mockClient,
    model: 'Model111111111111111111111111111111111111111',
    ciphertext,
    flags,
    uploadKey: uploadKeys[0]!,
    uploadSecret: keys[0]!.secret,
    uploadKeys,
    uploadSecrets,
    chunkBytes: 888,
    onChunk: () => {},
    stop: { now: false },
  })
  assert.equal(result.transactionsSent, 8)
  assert.equal(result.feesLamports, 40_000n)
  assert.equal(usedWallets.size, 4, 'writeChunks must spread work across all 4 upload keys')
  assert.ok(flags.every((f) => f === 1), 'every chunk flag must be set to 1')

  // saveSeal never writes uploadSecret or uploadSecrets to localStorage
  const store = new Map<string, string>()
  const prevStorage = (globalThis as { localStorage?: unknown }).localStorage
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v) },
    removeItem: (k: string) => { store.delete(k) },
  }
  try {
    saveSeal({
      step: 'write',
      fileName: 'w.onnx',
      name: 'sketch-32',
      manifest: { name: 'sketch-32', inputKind: 'sketch', inputShape: [1, 1, 28, 28], labels: ['clock'] },
      price: { amount: '10000000', mint: null, decimals: 9, symbol: 'SOL' },
      operatorShareBps: 2500,
      allowedMeasurements: ['a'.repeat(96)],
      plaintextBytes: 1000,
      sizeBytes: 1016,
      sha256: 'b'.repeat(64),
      cipher: { id: 'xchacha20poly1305-64k-v1', chunkSizeBytes: 65536, noncePrefix: toBase64(new Uint8Array(16)) },
      uploadKey: uploadKeys[0],
      uploadSecret: keys[0]!.secret,
      uploadKeys,
      uploadSecrets,
    })
    const saved = JSON.parse(store.get('voynich.seal') ?? '{}') as Record<string, unknown>
    assert.equal(saved.uploadSecret, undefined)
    assert.equal(saved.uploadSecrets, undefined)
    assert.deepEqual(saved.uploadKeys, uploadKeys)
  } finally {
    if (prevStorage === undefined) delete (globalThis as { localStorage?: unknown }).localStorage
    else (globalThis as { localStorage?: unknown }).localStorage = prevStorage
  }

  const sealFlowSrc = fs.readFileSync(path.join(ROOT, 'components/seal/SealFlow.tsx'), 'utf8')
  for (const sym of ['DEFAULT_UPLOAD_KEYS', 'saveUploadSecrets', 'loadUploadSecrets', 'sweepExtraUploadKeys', 'signatures = accounts + 3']) {
    assert.ok(sealFlowSrc.includes(sym), `SealFlow must include ${sym}`)
  }
  const keysSrc = fs.readFileSync(path.join(ROOT, 'lib/keys.ts'), 'utf8')
  for (const sym of ['saveUploadSecrets', 'loadUploadSecrets', 'forgetUploadSecrets']) {
    assert.ok(keysSrc.includes(sym), `keys.ts must export ${sym}`)
  }
})

test('Build 2 Step 4: 64-account weights ceiling, Merkle reseal, attachWeights, sealRanges, CipherView & /models largest sealed', async () => {
  assert.equal(MAX_WEIGHTS, 64)
  assert.equal(INITIAL_CREATE_WEIGHTS, 8)
  assert.equal(ATTACH_WEIGHTS_BATCH, 16)
  assert.equal(SEAL_RANGE_CHUNKS, 8)
  assert.equal(CIPHER_CHUNK_BYTES, 65_552)
  assert.equal(weightsCount(64 * WEIGHTS_CAPACITY), 64)
  assert.equal(sealChunkCount(252_145), 4)
  assert.equal(sealRangeCount(252_145), 0)
  assert.equal(sealChunkCount(2_621_440), 40)
  assert.equal(sealRangeCount(2_621_440), 4)

  // reseal computes Merkle root for hashVersion=1 and flat SHA-256 for hashVersion=0
  const plain = new Uint8Array(70_000).map((_, i) => i & 0xff)
  const key = new Uint8Array(32).fill(7)
  const header = { id: 'xchacha20poly1305-64k-v1' as const, chunkSizeBytes: 65536 as const, noncePrefix: toBase64(new Uint8Array(16).fill(3)) }
  const r1 = reseal(plain, key, header, 1)
  const r0 = reseal(plain, key, header, 0)
  assert.equal(r1.sha256, toHex(ciphertextMerkleRoot(r1.ciphertext)))
  assert.equal(r0.sha256, toHex(sha256(r0.ciphertext)))
  assert.notEqual(r1.sha256, r0.sha256)

  // attachWeights batches 20 extra accounts into 16 + 4 transactions
  const attachBatches: number[] = []
  const rangeCalls: number[] = []
  const mockClient = {
    attachWeights: async (_model: string, body: { wallet: string; weights: string[] }) => {
      attachBatches.push(body.weights.length)
      return { id: `att-${attachBatches.length}`, transactionBase64: toBase64(new Uint8Array(16)), blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 100, cosigned: false, action: 'attach_weights', requiredSigners: [body.wallet], fixture: true, addresses: {} }
    },
    sealRange: async (_model: string, body: { wallet: string; chunkCount?: number }) => {
      rangeCalls.push(body.chunkCount ?? 8)
      return { id: `rng-${rangeCalls.length}`, transactionBase64: toBase64(new Uint8Array(16)), blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 100, cosigned: false, action: 'seal_range', requiredSigners: [body.wallet], fixture: true, addresses: {} }
    },
    submitTransaction: async (input: { buildId: string }) => ({ id: input.buildId, status: 'confirmed' }),
    transaction: async (id: string) => ({ id, status: 'confirmed' }),
  } as unknown as Parameters<typeof attachWeights>[0]['client']

  const extra = Array.from({ length: 20 }, () => Keypair.generate().publicKey.toBase58())
  const att = await attachWeights({ client: mockClient, model: 'Model111111111111111111111111111111111111111', extraWeights: extra, uploadKey: extra[0]! })
  assert.deepEqual(attachBatches, [16, 4])
  assert.equal(att.transactionsSent, 2)

  // sealRanges executes 4 batches of 8 chunks for 2.5 MiB (40 chunks), leaving 8 inline for seal_model
  const rng = await sealRanges({ client: mockClient, model: 'Model111111111111111111111111111111111111111', sizeBytes: 2_621_440, sealedChunks: 0, uploadKey: extra[0]! })
  assert.deepEqual(rangeCalls, [8, 8, 8, 8])
  assert.equal(rng.sealedChunks, 32)
  assert.equal(rng.transactionsSent, 4)

  // Small model (sketch-32, 4 chunks) needs 0 seal_range txs
  const smallRng = await sealRanges({ client: mockClient, model: 'Model111111111111111111111111111111111111111', sizeBytes: 252_145, sealedChunks: 0, uploadKey: extra[0]! })
  assert.equal(smallRng.transactionsSent, 0)

  const cipherSrc = fs.readFileSync(path.join(ROOT, 'components/model/CipherView.tsx'), 'utf8')
  assert.ok(cipherSrc.includes('64 KiB chunk Merkle root') && cipherSrc.includes('Flat SHA-256 (legacy)') && cipherSrc.includes('showAllAccounts'))
  const modelsPageSrc = fs.readFileSync(path.join(ROOT, 'app/models/page.tsx'), 'utf8')
  assert.ok(modelsPageSrc.includes('largestSealed') && modelsPageSrc.includes('Largest sealed:'))
})

test('Build 2 Step 5: voynich@0.2.17 openWeightsChunk and merkleRootFromLeaves round-trip cleanly', () => {
  const plain = new Uint8Array(70_000).map((_, i) => (i * 17) & 0xff)
  const sealed = sealWeights(plain)
  const c0 = openWeightsChunk(sealed.ciphertext.subarray(0, CIPHER_CHUNK_BYTES), 0, sealed.key, sealed.header)
  const c1 = openWeightsChunk(sealed.ciphertext.subarray(CIPHER_CHUNK_BYTES), 1, sealed.key, sealed.header)
  const recovered = new Uint8Array(c0.plaintext.length + c1.plaintext.length)
  recovered.set(c0.plaintext, 0)
  recovered.set(c1.plaintext, c0.plaintext.length)
  assert.deepEqual(recovered, plain)
  assert.equal(toHex(merkleRootFromLeaves([c0.leafHash, c1.leafHash])), toHex(sealed.merkleRoot))
})

test('Build 2 Step 6: deterministic wallet signMessage derivation, CLI parity, resume command, and SealFlow wiring', async () => {
  const owner = Keypair.generate()
  const other = Keypair.generate()
  const programId = '65H3C7T6C2DmbkR9ssBBmNtqpybWcYwotkkETL4E7RSS'
  const modelAddr = await modelPdaAddress(programId, 'sketch-32')
  assert.equal(modelAddr, '431poxuxU5h5BE4nxazgLfxVEdg1xjipQWknyVN8ZobW')

  const msg = sealDerivationMessage(programId, modelAddr)
  const msgText = new TextDecoder().decode(msg)
  assert.ok(msgText.includes('voynich/seal/v1') && msgText.includes(programId) && msgText.includes(modelAddr))

  const fromKeypair = await signSealDerivation(owner, programId, modelAddr, { uploadKeyCount: 8, weightsKeyCount: 2 })
  const fromWallet = await signSealDerivation(
    {
      publicKey: owner.publicKey,
      signMessage: async (m) => ed25519.sign(m, owner.secretKey.slice(0, 32)),
    },
    programId,
    modelAddr,
    { uploadKeyCount: 8, weightsKeyCount: 2 },
  )

  assert.equal(verifySealDerivationSignature(msg, fromWallet.signature, owner.publicKey), true)
  assert.equal(verifySealDerivationSignature(msg, fromWallet.signature, other.publicKey), false)
  const badSig = fromWallet.signature.slice()
  badSig[0] ^= 0xff
  assert.equal(verifySealDerivationSignature(msg, badSig, owner.publicKey), false)

  // Keypair and async wallet signMessage derive identical modelKey, noncePrefix, uploadKeys, weightsKeys, and ciphertext
  assert.deepEqual(fromWallet.modelKey, fromKeypair.modelKey)
  assert.deepEqual(fromWallet.noncePrefix, fromKeypair.noncePrefix)
  assert.deepEqual(
    fromWallet.uploadKeys.map((k) => k.publicKey.toBase58()),
    fromKeypair.uploadKeys.map((k) => k.publicKey.toBase58()),
  )
  assert.deepEqual(
    fromWallet.weightsKeys.map((k) => k.publicKey.toBase58()),
    fromKeypair.weightsKeys.map((k) => k.publicKey.toBase58()),
  )
  assert.deepEqual(deriveSealSecrets(fromWallet.signature, { uploadKeyCount: 8, weightsKeyCount: 2 }).modelKey, fromKeypair.modelKey)

  const plain = new Uint8Array(4096).map((_, i) => i & 0xff)
  const s1 = sealWeights(plain, fromWallet.modelKey, { cipher: 'xchacha20poly1305-64k-v1', noncePrefix: fromWallet.noncePrefix, plaintextBytes: plain.length, chunkBytes: 65536 })
  const s2 = sealWeights(plain, fromKeypair.modelKey, { cipher: 'xchacha20poly1305-64k-v1', noncePrefix: fromKeypair.noncePrefix, plaintextBytes: plain.length, chunkBytes: 65536 })
  assert.equal(toHex(s1.merkleRoot), toHex(s2.merkleRoot))

  await assert.rejects(() =>
    signSealDerivation({ publicKey: other.publicKey, signMessage: async () => fromWallet.signature }, programId, modelAddr),
  )

  assert.equal(resumeCliCommand('sketch-32.onnx', 'sketch-32'), 'voynich seal sketch-32.onnx --model sketch-32 --resume')
  assert.equal(resumeCliCommand(null, 'sketch-32'), 'voynich seal <weights.onnx> --model sketch-32 --resume')

  const storeSrc = fs.readFileSync(path.join(ROOT, 'src/engines/wallet/store.ts'), 'utf8')
  assert.ok(storeSrc.includes('canSignMessage') && storeSrc.includes('signMessage:'))
  const devWalletSrc = fs.readFileSync(path.join(ROOT, 'src/engines/wallet/dev-wallet.ts'), 'utf8')
  assert.ok(devWalletSrc.includes("'solana:signMessage'"))
  const sealFlowSrc = fs.readFileSync(path.join(ROOT, 'components/seal/SealFlow.tsx'), 'utf8')
  for (const sym of ['deriveWalletSealSecrets', 'resumeFromChain', 'deriveFromWallet', 'resumeCliCommand']) {
    assert.ok(sealFlowSrc.includes(sym), `SealFlow must include ${sym}`)
  }
})

test('Build 3 Step 1: ModelBaseSchema validation and ModelView base model / SHA-256 rendering', () => {
  assert.deepEqual([...MODEL_BASE_FORMATS], ['onnx', 'safetensors', 'gguf'])
  assert.equal(
    ModelBaseSchema.safeParse({
      sha256: 'a'.repeat(64),
      sizeBytes: 252_081,
      format: 'onnx',
      source: 'https://huggingface.co/voynich/base/resolve/main/model.onnx',
    }).success,
    true,
  )
  assert.equal(
    ModelBaseSchema.safeParse({
      sha256: 'b'.repeat(64),
      sizeBytes: 1_000_000,
      format: 'safetensors',
      source: 'hf://voynich/base/model.safetensors',
    }).success,
    true,
  )
  assert.equal(
    ModelBaseSchema.safeParse({
      sha256: 'a'.repeat(64),
      sizeBytes: 100,
      format: 'onnx',
      source: 'javascript:alert(1)',
    }).success,
    false,
  )
  assert.equal(
    ModelBaseSchema.safeParse({
      sha256: 'a'.repeat(64),
      sizeBytes: 0,
      format: 'onnx',
      source: 'https://example.com/m.onnx',
    }).success,
    false,
  )

  const modelViewSrc = fs.readFileSync(path.join(ROOT, 'components/model/ModelView.tsx'), 'utf8')
  assert.ok(modelViewSrc.includes('model.base ?') && modelViewSrc.includes('Base model') && modelViewSrc.includes('Base SHA-256'))
  assert.ok(modelViewSrc.includes("model.base.source.startsWith('https://')") && modelViewSrc.includes('label="base model hash"'))
})

test('Build 3 Step 2: voynich/adapter browser-compatible encode, decode, inspect, and applyOnnxAdapter', () => {
  const varint = (n: number): Uint8Array => {
    const out: number[] = []
    let v = n >>> 0
    while (v >= 0x80) {
      out.push((v & 0x7f) | 0x80)
      v >>>= 7
    }
    out.push(v)
    return Uint8Array.from(out)
  }
  const lenField = (fieldNumber: number, payload: Uint8Array): Uint8Array => {
    const tag = varint((fieldNumber << 3) | 2)
    const len = varint(payload.length)
    const out = new Uint8Array(tag.length + len.length + payload.length)
    out.set(tag, 0)
    out.set(len, tag.length)
    out.set(payload, tag.length + len.length)
    return out
  }
  const varintField = (fieldNumber: number, value: number): Uint8Array => {
    const tag = varint((fieldNumber << 3) | 0)
    const val = varint(value)
    const out = new Uint8Array(tag.length + val.length)
    out.set(tag, 0)
    out.set(val, tag.length)
    return out
  }
  const join = (...parts: Uint8Array[]): Uint8Array => {
    const total = parts.reduce((sum, p) => sum + p.length, 0)
    const out = new Uint8Array(total)
    let off = 0
    for (const p of parts) {
      out.set(p, off)
      off += p.length
    }
    return out
  }
  const f32Bytes = (values: number[]): Uint8Array => {
    const out = new Uint8Array(values.length * 4)
    const view = new DataView(out.buffer)
    values.forEach((v, i) => view.setFloat32(i * 4, v, true))
    return out
  }
  const tensorProto = (name: string, dims: number[], values: number[], useFloatData = false): Uint8Array =>
    join(
      ...dims.map((d) => varintField(1, d)),
      varintField(2, 1), // FLOAT
      lenField(8, utf8(name)),
      lenField(useFloatData ? 4 : 9, f32Bytes(values)),
    )

  const baseOnnx = join(
    varintField(1, 8),
    lenField(
      7,
      join(
        lenField(5, tensorProto('W', [2, 2], [1, 2, 3, 4], false)),
        lenField(5, tensorProto('b', [2], [0.5, -0.5], true)),
      ),
    ),
  )
  const baseSha256 = toHex(sha256(baseOnnx))

  const initializers = inspectOnnxInitializers(baseOnnx)
  assert.equal(initializers.length, 2)
  assert.deepEqual(initializers[0]?.dims, [2, 2])
  assert.deepEqual(Array.from(initializers[1]?.values ?? []), [0.5, -0.5])

  // Encode & decode LoRA (W + (2/1) * [[1],[2]] @ [[3,4]]) + delta (b + [0.25, 0.75])
  const encoded = encodeAdapter({
    baseSha256,
    tensors: [
      { name: 'W', op: 'lora', dims: [2, 2], rank: 1, alpha: 2, a: [1, 2], b: [3, 4] },
      { name: 'b', op: 'delta', dims: [2], values: [0.25, 0.75] },
    ],
  })
  assert.equal(new TextDecoder().decode(encoded.subarray(0, 4)), ADAPTER_MAGIC)
  const decoded = decodeAdapter(encoded)
  assert.equal(decoded.version, ADAPTER_VERSION)
  assert.equal(decoded.baseSha256, baseSha256)
  assert.equal(decoded.tensors.length, 2)

  const merged = applyOnnxAdapter(baseOnnx, encoded, baseSha256)
  const mergedInits = new Map(inspectOnnxInitializers(merged).map((t) => [t.name, Array.from(t.values ?? [])]))
  // W: [1,2,3,4] + 2 * [3,4,6,8] = [7,10,15,20]; b: [0.5,-0.5] + [0.25,0.75] = [0.75,0.25]
  assert.deepEqual(mergedInits.get('W'), [7, 10, 15, 20])
  assert.deepEqual(mergedInits.get('b'), [0.75, 0.25])

  // Replace op
  const replaceBytes = encodeAdapter({
    baseSha256,
    tensors: [{ name: 'b', op: 'replace', dims: [2], values: [9, -9] }],
  })
  const replacedInits = new Map(inspectOnnxInitializers(applyOnnxAdapter(baseOnnx, replaceBytes)).map((t) => [t.name, Array.from(t.values ?? [])]))
  assert.deepEqual(replacedInits.get('b'), [9, -9])
  assert.deepEqual(replacedInits.get('W'), [1, 2, 3, 4])

  // Reject wrong expected base hash and unknown tensor name
  assert.throws(() => applyOnnxAdapter(baseOnnx, encoded, 'f'.repeat(64)))
  const missingTensor = encodeAdapter({
    baseSha256,
    tensors: [{ name: 'missing', op: 'delta', dims: [2], values: [1, 1] }],
  })
  assert.throws(() => applyOnnxAdapter(baseOnnx, missingTensor, baseSha256))

  // Browser-compatibility guard: zero node:* imports in vendored voynich/adapter dist
  const adapterDist = fs.readFileSync(path.join(ROOT, 'node_modules/voynich/dist/adapter.js'), 'utf8')
  assert.equal(adapterDist.includes('node:'), false)
})

test('Build 3 Step 3: text inputKind manifest, Output text decoding, CallPanel prompt flow, and ReceiptView open text', () => {
  assert.deepEqual([...TOKENIZER_FORMATS], ['byte-level', 'bpe', 'word-piece'])

  // Manifest allows text inputKind with byte-level tokenizer and omitted inputShape/labels
  assert.equal(
    Manifest.safeParse({
      name: 'b3s3-text',
      inputKind: 'text',
      tokenizer: { format: 'byte-level', vocabSize: 256, maxInputTokens: 512, maxOutputTokens: 64, eosTokenId: 0 },
    }).success,
    true,
  )
  // bpe tokenizer requires source + sha256
  assert.equal(
    Manifest.safeParse({
      name: 'b3s3-bpe',
      inputKind: 'text',
      tokenizer: { format: 'bpe', vocabSize: 32000, maxInputTokens: 1024 },
    }).success,
    false,
  )

  // decodeOutput extracts text generation fields while preserving classification outputs
  const gen = decodeOutput({ text: 'voynich', tokens: 7, finishReason: 'eos' })
  assert.equal(gen.label, null)
  assert.deepEqual(gen.scores, [])
  assert.equal(gen.text, 'voynich')
  assert.equal(gen.tokens, 7)
  assert.equal(gen.finishReason, 'eos')

  const cls = decodeOutput({ label: 'sun', probability: 0.99 })
  assert.equal(cls.label, 'sun')
  assert.equal(cls.text, null)
  assert.equal(cls.tokens, null)
  assert.equal(cls.finishReason, null)

  // decodeOpenAnswer decodes on-chain open text generation payloads cleanly
  const openText = decodeOpenAnswer(toBase64(utf8(JSON.stringify({ text: 'voy', tokens: 3, finishReason: 'length' }))))
  assert.equal(openText.output?.text, 'voy')
  assert.equal(openText.output?.tokens, 3)
  assert.equal(openText.output?.finishReason, 'length')
  assert.equal(openText.output?.label, null)

  const callSrc = fs.readFileSync(path.join(ROOT, 'lib/call.ts'), 'utf8')
  assert.ok(callSrc.includes('input: string | number[]') && callSrc.includes('maxTokens?: number') && callSrc.includes('payload.maxTokens = o.maxTokens'))

  const callPanelSrc = fs.readFileSync(path.join(ROOT, 'components/model/CallPanel.tsx'), 'utf8')
  for (const sym of ["kind === 'text'", 'Write a prompt', 'Max tokens', 'st.output.text', 'st.output.finishReason']) {
    assert.ok(callPanelSrc.includes(sym), `CallPanel must include ${sym}`)
  }

  const receiptViewSrc = fs.readFileSync(path.join(ROOT, 'components/receipt/ReceiptView.tsx'), 'utf8')
  assert.ok(receiptViewSrc.includes('open.output?.text') && receiptViewSrc.includes('open.output.finishReason'))
})

test('Build 3 Step 4: sealed adapter inspection, local ONNX base check, base resume hydration, CLI base hint, and /seal wiring', () => {
  const varint = (n: number): Uint8Array => {
    const out: number[] = []
    let v = n >>> 0
    while (v >= 0x80) { out.push((v & 0x7f) | 0x80); v >>>= 7 }
    out.push(v)
    return Uint8Array.from(out)
  }
  const lenField = (fieldNumber: number, payload: Uint8Array): Uint8Array => {
    const tag = varint((fieldNumber << 3) | 2)
    const len = varint(payload.length)
    const out = new Uint8Array(tag.length + len.length + payload.length)
    out.set(tag, 0); out.set(len, tag.length); out.set(payload, tag.length + len.length)
    return out
  }
  const varintField = (fieldNumber: number, value: number): Uint8Array => {
    const tag = varint((fieldNumber << 3) | 0)
    const val = varint(value)
    const out = new Uint8Array(tag.length + val.length)
    out.set(tag, 0); out.set(val, tag.length)
    return out
  }
  const join = (...parts: Uint8Array[]): Uint8Array => {
    const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0))
    let off = 0
    for (const p of parts) { out.set(p, off); off += p.length }
    return out
  }
  const f32Bytes = (values: number[]): Uint8Array => {
    const out = new Uint8Array(values.length * 4)
    const view = new DataView(out.buffer)
    values.forEach((v, i) => view.setFloat32(i * 4, v, true))
    return out
  }
  const tensorProto = (name: string, dims: number[], values: number[]): Uint8Array =>
    join(...dims.map((d) => varintField(1, d)), varintField(2, 1), lenField(8, utf8(name)), lenField(9, f32Bytes(values)))

  const baseOnnx = join(
    varintField(1, 8),
    lenField(7, join(lenField(5, tensorProto('W', [2, 2], [1, 2, 3, 4])), lenField(5, tensorProto('b', [2], [0.5, -0.5])))),
  )
  const baseSha256 = toHex(sha256(baseOnnx))
  const adapterBytes = encodeAdapter({
    baseSha256,
    tensors: [
      { name: 'W', op: 'lora', dims: [2, 2], rank: 1, alpha: 2, a: [1, 2], b: [3, 4] },
      { name: 'b', op: 'delta', dims: [2], values: [0.1, -0.1] },
    ],
  })

  // inspectAdapterBytes + formatAdapterOps + inferBaseFormat
  const inspected = inspectAdapterBytes(adapterBytes)
  assert.equal(inspected.ok, true)
  if (inspected.ok) {
    assert.equal(inspected.info.baseSha256, baseSha256)
    assert.equal(inspected.info.tensorCount, 2)
    assert.equal(formatAdapterOps(inspected.info), '2 tensors (1 lora, 1 delta)')
  }
  assert.equal(inspectAdapterBytes(utf8('not-a-voya-adapter')).ok, false)
  assert.equal(inferBaseFormat('base.onnx'), 'onnx')
  assert.equal(inferBaseFormat('base.safetensors'), 'safetensors')
  assert.equal(inferBaseFormat('base.gguf'), 'gguf')
  assert.equal(inferBaseFormat('base.bin'), null)

  // checkLocalBaseFile + verifyOnnxAdapterCompatibility
  assert.doesNotThrow(() => verifyOnnxAdapterCompatibility(baseOnnx, adapterBytes, baseSha256))
  const okCheck = checkLocalBaseFile(baseOnnx, 'base.onnx', adapterBytes, 'onnx')
  assert.equal(okCheck.compatible, true)
  assert.equal(okCheck.sha256, baseSha256)
  assert.equal(okCheck.sizeBytes, baseOnnx.length)

  const wrongBase = new Uint8Array(baseOnnx)
  wrongBase[wrongBase.length - 1] ^= 0xff
  const badHashCheck = checkLocalBaseFile(wrongBase, 'wrong.onnx', adapterBytes, 'onnx')
  assert.equal(badHashCheck.compatible, false)
  assert.ok(badHashCheck.error)

  const badDimsAdapter = encodeAdapter({
    baseSha256,
    tensors: [{ name: 'b', op: 'delta', dims: [3], values: [1, 2, 3] }],
  })
  const badDimsCheck = checkLocalBaseFile(baseOnnx, 'base.onnx', badDimsAdapter, 'onnx')
  assert.equal(badDimsCheck.compatible, false)

  // stateFromModel hydrates base and resumeCliCommand includes --base flags for adapters
  const base = { source: 'https://example.com/base.onnx', format: 'onnx' as const, sizeBytes: baseOnnx.length, sha256: baseSha256 }
  const hydrated = stateFromModel(
    {
      address: 'As4J79sxNqi6jeiK7ckh8EoYf5KX2RhLJCUzEwo8P5h9',
      name: 'b3s4-adapter',
      owner: '5niikRYqdGcR4KJd9aXfQaYdoQHzdrF1sDyiwrTvbEoa',
      status: 'uploading',
      manifest: { name: 'b3s4-adapter', inputKind: 'text', tokenizer: { format: 'byte-level', vocabSize: 256, maxInputTokens: 512, maxOutputTokens: 64 } },
      sizeBytes: 1249,
      plaintextSizeBytes: 1233,
      ciphertextSha256: null,
      hashVersion: 1,
      sealedChunks: 0,
      base,
      cipher: { id: 'xchacha20poly1305-64k-v1', chunkSizeBytes: 65536, noncePrefix: toBase64(new Uint8Array(16)) },
      allowedMeasurements: ['a'.repeat(96)],
      price: { amount: '10000000', mint: null, decimals: 9, symbol: 'SOL' },
      priceUnit: 'call' as const,
      operatorShareBps: 2500,
      protocolShareBps: 500,
      sealedSlot: null,
      callsSettled: 0,
      enclavesHolding: 0,
      weights: [],
      upload: null,
    },
    'write',
  )
  assert.deepEqual(hydrated.base, base)
  const cliWithBase = resumeCliCommand('adapter.voya', 'b3s4-adapter', base)
  assert.ok(cliWithBase.includes('--base https://example.com/base.onnx'))
  assert.ok(cliWithBase.includes(`--base-sha256 ${baseSha256}`))
  assert.ok(cliWithBase.includes(`--base-size ${baseOnnx.length}`))
  assert.ok(cliWithBase.includes('--base-format onnx'))
  assert.ok(cliWithBase.endsWith('--resume'))
  assert.equal(resumeCliCommand(null, 'b3s4-adapter', base).startsWith('voynich seal <adapter.voya>'), true)

  const prepareSrc = fs.readFileSync(path.join(ROOT, 'components/seal/Prepare.tsx'), 'utf8')
  for (const sym of ['Full model', 'Sealed adapter', 'Base model', 'Tokenizer format', 'inspectAdapterBytes', 'checkLocalBaseFile']) {
    assert.ok(prepareSrc.includes(sym), `Prepare.tsx must include ${sym}`)
  }
  const sealFlowSrc = fs.readFileSync(path.join(ROOT, 'components/seal/SealFlow.tsx'), 'utf8')
  assert.ok(sealFlowSrc.includes('const baseOpt = next.base ? { base: next.base } : {}'))
  assert.ok(sealFlowSrc.includes('resumeCliCommand(st.fileName, st.name, st.base)'))
})

test('Build 3 Step 5: text-1m manifest, base, adapter, output decoding, and /models + /models/[id] wiring', () => {
  const text1mDir = path.resolve(ROOT, '../backend/models/text-1m')
  const manifestRaw = JSON.parse(fs.readFileSync(path.join(text1mDir, 'manifest.json'), 'utf8')) as unknown
  const baseRaw = JSON.parse(fs.readFileSync(path.join(text1mDir, 'base.json'), 'utf8')) as {
    sha256: string
    sizeBytes: number
    format: 'onnx'
  }
  const parsedManifest = Manifest.parse(manifestRaw)
  assert.equal(parsedManifest.name, 'text-1m')
  assert.equal(parsedManifest.inputKind, 'text')
  assert.equal(parsedManifest.tokenizer?.format, 'byte-level')
  assert.equal(parsedManifest.tokenizer?.vocabSize, 258)
  assert.equal(parsedManifest.tokenizer?.maxInputTokens, 128)
  assert.equal(parsedManifest.tokenizer?.maxOutputTokens, 64)
  assert.equal(parsedManifest.labels, undefined)
  assert.equal(parsedManifest.inputShape, undefined)

  const parsedBase = ModelBaseSchema.parse({
    ...baseRaw,
    source: 'ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
  })
  assert.equal(parsedBase.format, 'onnx')
  assert.equal(parsedBase.sizeBytes, 6_143_522)

  // Real text-1m.voya inspects cleanly in browser-compatible helper and matches base.json SHA-256
  const adapterBytes = new Uint8Array(fs.readFileSync(path.join(text1mDir, 'text-1m.voya')))
  const inspected = inspectAdapterBytes(adapterBytes)
  assert.equal(inspected.ok, true)
  if (inspected.ok) {
    assert.equal(inspected.info.baseSha256, parsedBase.sha256)
    assert.equal(inspected.info.tensorCount, 18)
    assert.equal(inspected.info.ops.lora, 17)
    assert.equal(inspected.info.ops.delta, 1)
  }

  // Decode sealed and open text-1m completions cleanly
  const sealedOut = decodeOutput({
    text: ' Voynich runs sealed models on Solana with verified receipts.',
    tokens: 61,
    finishReason: 'eos',
  })
  assert.equal(sealedOut.label, null)
  assert.equal(sealedOut.text, ' Voynich runs sealed models on Solana with verified receipts.')
  assert.equal(sealedOut.tokens, 61)
  assert.equal(sealedOut.finishReason, 'eos')

  const openOut = decodeOpenAnswer(
    toBase64(utf8(JSON.stringify({ text: ' Compact encrypted LoRA weights merged onto an open base.', tokens: 57, finishReason: 'eos' }))),
  )
  assert.equal(openOut.output?.text, ' Compact encrypted LoRA weights merged onto an open base.')
  assert.equal(openOut.output?.tokens, 57)
  assert.equal(openOut.output?.finishReason, 'eos')

  // /models, ModelView, and CallPanel render text + adapter badges, Input row, Base model, and prompt UI
  const modelsPageSrc = fs.readFileSync(path.join(ROOT, 'app/models/page.tsx'), 'utf8')
  assert.ok(modelsPageSrc.includes('m.manifest.inputKind') && modelsPageSrc.includes('m.base ?'))
  const modelViewSrc = fs.readFileSync(path.join(ROOT, 'components/model/ModelView.tsx'), 'utf8')
  assert.ok(modelViewSrc.includes('model.manifest.inputKind') && modelViewSrc.includes('Base model') && modelViewSrc.includes('Base SHA-256'))
  const callPanelSrc = fs.readFileSync(path.join(ROOT, 'components/model/CallPanel.tsx'), 'utf8')
  assert.ok(callPanelSrc.includes("kind === 'text'") && callPanelSrc.includes('tokenizer.maxInputTokens') && callPanelSrc.includes('st.output.text'))
})

test('Build 3 Step 6: 5th base receipt check, v2 signature verification, decodeModelBaseBytes parity, and ReceiptView base display', async () => {
  assert.deepEqual(
    RECEIPT_CHECKS.map((c) => c.id),
    ['signature', 'record', 'expiry', 'answer', 'base'],
  )

  const modelDisc = sha256(utf8('account:Model')).subarray(0, 8)
  const writeU32 = (n: number) => {
    const b = new Uint8Array(4)
    new DataView(b.buffer).setUint32(0, n, true)
    return b
  }
  const writeU64 = (n: bigint) => {
    const b = new Uint8Array(8)
    new DataView(b.buffer).setBigUint64(0, n, true)
    return b
  }
  const writeStr = (s: string) => {
    const bytes = utf8(s)
    const out = new Uint8Array(4 + bytes.length)
    out.set(writeU32(bytes.length), 0)
    out.set(bytes, 4)
    return out
  }
  const concat = (...parts: Uint8Array[]) => {
    const out = new Uint8Array(parts.reduce((acc, p) => acc + p.length, 0))
    let off = 0
    for (const p of parts) { out.set(p, off); off += p.length }
    return out
  }

  const buildModelBytes = (space: number, base: { sha256: string; sizeBytes: number; format: 'onnx'; source: string } | null) => {
    const legacyPrefix = concat(
      modelDisc,
      new Uint8Array(32), // owner
      writeStr('text-1m'), // name
      writeStr('{}'), // manifest
      writeU32(0), // weights
      writeU64(214_673n), // size_bytes
      writeStr('xchacha20poly1305-64k-v1'), // cipher
      new Uint8Array(16), // nonce_prefix
      new Uint8Array(32), // ciphertext_sha256
      writeU32(0), // allowed_measurements
      writeU64(10_000_000n), // price
      new Uint8Array(32), // price_mint
      new Uint8Array(2), // operator_share_bps
      new Uint8Array(32), // upload_key
      Uint8Array.of(2), // status
      writeU64(10n), // created_slot
      writeU64(20n), // sealed_slot
      writeU64(1n), // calls_settled
      Uint8Array.of(255), // bump
    )
    const buf = new Uint8Array(space)
    buf.set(legacyPrefix, 0)
    if (space > 6000) {
      const trailing = concat(
        writeU32(0), // upload_keys
        Uint8Array.of(1), // hash_version
        writeU32(4), // sealed_chunks
        writeU32(0), // merkle_frontier
        writeU32(0), // merkle_frontier_mask
        base
          ? concat(
              Uint8Array.of(1),
              fromHex(base.sha256),
              writeU64(BigInt(base.sizeBytes)),
              writeStr(base.format),
              writeStr(base.source),
            )
          : Uint8Array.of(0),
      )
      buf.set(trailing, legacyPrefix.length)
    }
    return buf
  }

  const base = {
    sha256: '1184a80cdd836f39c6e4af1e26c463042eeaaeecf0b7ee3750f4dbffcc93c84f',
    sizeBytes: 6_143_522,
    format: 'onnx' as const,
    source: 'https://legacy-gateway.mypinata.cloud/ipfs/bafybeihhuclcrqmgo7lno5kcvaj4fsllp5rc2bayqjj2zvlrldt6gkplce',
  }

  // Browser decodeModelBaseBytes matches SDK decodeModelBaseBytes across legacy 6,000B and 8,192B accounts
  const legacyModel = buildModelBytes(6000, null)
  const currentNoBase = buildModelBytes(8192, null)
  const currentWithBase = buildModelBytes(8192, base)
  assert.equal(decodeModelBaseBytes(legacyModel), null)
  assert.equal(sdkDecodeModelBaseBytes(legacyModel), null)
  assert.equal(decodeModelBaseBytes(currentNoBase), null)
  assert.equal(sdkDecodeModelBaseBytes(currentNoBase), null)
  assert.deepEqual(decodeModelBaseBytes(currentWithBase), base)
  assert.deepEqual(sdkDecodeModelBaseBytes(currentWithBase), base)

  // Signature + base check semantics: v2 adapter (5/5), standalone v1 (5/5), legacy v1 adapter (sig=true, base=false), wrong base (sig=false, base=false)
  const enclaveKey = Keypair.generate()
  const callAddr = Keypair.generate().publicKey
  const modelAddr = Keypair.generate().publicKey
  const enclaveAddr = Keypair.generate().publicKey
  const recordAddr = Keypair.generate().publicKey
  const programId = Keypair.generate().publicKey.toBase58()
  const attestProgramId = Keypair.generate().publicKey.toBase58()
  const inputHashBytes = sha256(utf8('prompt'))
  const answerBytes = utf8(JSON.stringify({ text: ' Voynich runs sealed models on Solana.', tokens: 38, finishReason: 'eos' }))
  const outputHashBytes = sha256(answerBytes)

  const v1Sig = signReceipt(enclaveKey.secretKey.subarray(0, 32), callAddr.toBytes(), inputHashBytes, outputHashBytes)
  const v2Sig = signReceipt(enclaveKey.secretKey.subarray(0, 32), callAddr.toBytes(), inputHashBytes, outputHashBytes, fromHex(base.sha256))
  const wrongBaseSig = signReceipt(enclaveKey.secretKey.subarray(0, 32), callAddr.toBytes(), inputHashBytes, outputHashBytes, fromHex('22'.repeat(32)))

  const makeAdapterView = (sig: Uint8Array, modelBase: typeof base | null) => ({
    receipt: {
      address: Keypair.generate().publicKey.toBase58(),
      call: callAddr.toBase58(),
      caller: Keypair.generate().publicKey.toBase58(),
      callerIsProgram: false,
      model: modelAddr.toBase58(),
      modelName: 'text-1m',
      enclave: enclaveAddr.toBase58(),
      inputHash: toHex(inputHashBytes),
      outputHash: toHex(outputHashBytes),
      signature: toBase64(sig),
      answerMode: 'open' as const,
      openAnswer: toBase64(answerBytes),
      slot: '250',
      transactionSignature: '5'.repeat(88),
      deliveredCount: null,
      returnedAmount: null,
      payments: {
        mint: null,
        total: '10000000',
        owner: { recipient: Keypair.generate().publicKey.toBase58(), amount: '7000000' },
        operator: { recipient: Keypair.generate().publicKey.toBase58(), amount: '2500000' },
        protocol: { recipient: Keypair.generate().publicKey.toBase58(), amount: '500000' },
      },
    },
    enclaveSigningKey: enclaveKey.publicKey.toBase58(),
    attestationRecord: {
      address: recordAddr.toBase58(),
      signingKey: enclaveKey.publicKey.toBase58(),
      encryptionKey: toBase64(new Uint8Array(32)),
      hardwareType: 'dev' as const,
      measurement: 'a'.repeat(96),
      recordedSlot: '100',
      expiresAtSlot: '500',
      layoutVersion: 1,
    },
    attestationProgramId: attestProgramId,
    recordLayoutVersion: 1,
    modelBase,
  })

  // 1. v2 adapter receipt passes all 5 checks
  const v2Checks = await verifyAll(makeAdapterView(v2Sig, base), null, undefined, 0)
  assert.equal(v2Checks.length, 5)
  assert.ok(v2Checks.every((c) => c.passed), 'v2 adapter receipt must pass 5/5 checks')

  // 2. Pre-Step-6 legacy v1 adapter receipt: signature passes, base fails cleanly
  const legacyAdapterView = makeAdapterView(v1Sig, base)
  assert.equal(checkSignature(legacyAdapterView).passed, true)
  assert.equal((await checkBase(legacyAdapterView, null)).passed, false)

  // 3. Wrong-base signature fails both signature and base
  const wrongBaseView = makeAdapterView(wrongBaseSig, base)
  assert.equal(checkSignature(wrongBaseView).passed, false)
  assert.equal((await checkBase(wrongBaseView, null)).passed, false)

  // 4. Chain-mode checkBase reads Model account via RPC and rejects API/chain base mismatch
  const chainConfig = {
    mode: 'chain' as const,
    cluster: 'localnet' as const,
    rpcUrl: 'http://127.0.0.1:8899',
    programId,
    attestationProgramId: attestProgramId,
    protocolFeeBps: 500,
    enclaveEncryptionKey: null,
  }
  const origFetch = globalThis.fetch
  let mockedModelBytes: Uint8Array = currentWithBase
  globalThis.fetch = (async () => ({
    json: async () => ({
      result: { value: { owner: programId, data: [toBase64(mockedModelBytes), 'base64'] } },
    }),
  })) as unknown as typeof fetch
  try {
    assert.equal((await checkBase(makeAdapterView(v2Sig, base), chainConfig)).passed, true)
    // API reports null base while chain Model has base -> fails
    assert.equal((await checkBase(makeAdapterView(v1Sig, null), chainConfig)).passed, false)
    // Chain Model is legacy 6,000B standalone -> passes standalone receipt
    mockedModelBytes = legacyModel
    assert.equal((await checkBase(makeAdapterView(v1Sig, null), chainConfig)).passed, true)
  } finally {
    globalThis.fetch = origFetch
  }

  // ReceiptView renders Base model and Base SHA-256 when view.modelBase is non-null
  const receiptViewSrc = fs.readFileSync(path.join(ROOT, 'components/receipt/ReceiptView.tsx'), 'utf8')
  assert.ok(receiptViewSrc.includes('view.modelBase ?') && receiptViewSrc.includes('Base model') && receiptViewSrc.includes('Base SHA-256'))
})

test('Build 4 Step 1: PriceUnit, parseCeiling validation, and per-token OwnerPanel / ModelView / Models / CallPanel wiring', () => {
  assert.equal(PriceUnit.safeParse('call').success, true)
  assert.equal(PriceUnit.safeParse('token').success, true)
  assert.equal(PriceUnit.safeParse('second').success, false)

  const tokenModel = { price: { amount: '2000', mint: null, decimals: 9, symbol: 'SOL' } }
  assert.deepEqual(parseCeiling('0.000128', tokenModel), { ok: true, amount: '128000' })
  assert.deepEqual(parseCeiling('0.000002', tokenModel), { ok: true, amount: '2000' })
  assert.equal(parseCeiling('0.000001', tokenModel).ok, false)
  assert.equal(parseCeiling('0', tokenModel).ok, false)
  assert.equal(parseCeiling('abc', tokenModel).ok, false)
  assert.equal(parseCeiling('0.0000000001', tokenModel).ok, false)

  const ownerPanelSrc = fs.readFileSync(path.join(ROOT, 'components/model/OwnerPanel.tsx'), 'utf8')
  for (const sym of ['Per call', 'Per token', 'Price a token', 'priceUnit']) {
    assert.ok(ownerPanelSrc.includes(sym), `OwnerPanel must include ${sym}`)
  }

  const modelViewSrc = fs.readFileSync(path.join(ROOT, 'components/model/ModelView.tsx'), 'utf8')
  assert.ok(modelViewSrc.includes("model.priceUnit === 'token'") && modelViewSrc.includes('Price a token') && modelViewSrc.includes('/ token'))

  const modelsPageSrc = fs.readFileSync(path.join(ROOT, 'app/models/page.tsx'), 'utf8')
  assert.ok(modelsPageSrc.includes("m.priceUnit === 'token'") && modelsPageSrc.includes('Price a token') && modelsPageSrc.includes('/ token'))

  const callPanelSrc = fs.readFileSync(path.join(ROOT, 'components/model/CallPanel.tsx'), 'utf8')
  for (const sym of ["model.priceUnit === 'token'", 'parseCeiling', 'Ceiling', 'Open metered call']) {
    assert.ok(callPanelSrc.includes(sym), `CallPanel must include ${sym}`)
  }

  const callSrc = fs.readFileSync(path.join(ROOT, 'lib/call.ts'), 'utf8')
  assert.ok(callSrc.includes('ceiling?: string') && callSrc.includes('...(o.ceiling !== undefined ? { ceiling: o.ceiling } : {})'))
})

test('Build 4 Step 2: signed stream pieces (voynich/piece/v1 & v2), contract StreamPiece/CallPieces/callStreamUrl, and browser crypto safety', () => {
  const enclaveKey = Keypair.generate()
  const callAddr = Keypair.generate().publicKey
  const replyKeys = generateEncryptionKeyPair()
  const inputHash = sha256(utf8('encrypted-prompt'))
  const baseSha256 = fromHex('1184a80cdd836f39c6e4af1e26c463042eeaaeecf0b7ee3750f4dbffcc93c84f')

  const h0 = streamInitialHash(callAddr.toBytes(), inputHash)
  assert.equal(h0.length, 32)

  const p0Plain = utf8(JSON.stringify({ index: 0, text: 'Voynich', tokens: 7, finishReason: null }))
  const p0Cipher = encryptCallOutput(p0Plain, replyKeys.publicKey)
  const h1 = streamNextHash(h0, 7, p0Cipher)
  assert.equal(h1.length, 32)
  assert.notEqual(toHex(h1), toHex(h0))

  // Standalone v1 piece (120 bytes)
  const msgV1 = pieceMessage(callAddr.toBytes(), inputHash, 7, h1)
  assert.equal(msgV1.length, 120)
  const sigV1 = signPiece(enclaveKey.secretKey.subarray(0, 32), callAddr.toBytes(), inputHash, 7, h1)
  assert.equal(verifyPiece(sigV1, enclaveKey.publicKey.toBytes(), callAddr.toBytes(), inputHash, 7, h1), true)
  assert.equal(verifyPiece(sigV1, enclaveKey.publicKey.toBytes(), callAddr.toBytes(), inputHash, 8, h1), false)

  // Adapter v2 piece (152 bytes, commits to baseSha256)
  const msgV2 = pieceMessage(callAddr.toBytes(), inputHash, 7, h1, baseSha256)
  assert.equal(msgV2.length, 152)
  const sigV2 = signPiece(enclaveKey.secretKey.subarray(0, 32), callAddr.toBytes(), inputHash, 7, h1, baseSha256)
  assert.equal(verifyPiece(sigV2, enclaveKey.publicKey.toBytes(), callAddr.toBytes(), inputHash, 7, h1, baseSha256), true)
  assert.equal(verifyPiece(sigV2, enclaveKey.publicKey.toBytes(), callAddr.toBytes(), inputHash, 7, h1, fromHex('22'.repeat(32))), false)
  assert.equal(verifyPiece(sigV2, enclaveKey.publicKey.toBytes(), callAddr.toBytes(), inputHash, 7, h1), false)

  // Decrypt piece payload round-trip
  const decrypted = JSON.parse(new TextDecoder().decode(decryptCallOutput(p0Cipher, replyKeys.secretKey))) as { index: number; text: string; tokens: number; finishReason: string | null }
  assert.deepEqual(decrypted, { index: 0, text: 'Voynich', tokens: 7, finishReason: null })

  // Contract StreamPiece, CallPieces, ProgramEvent, and client.callStreamUrl
  const wirePiece = {
    call: callAddr.toBase58(),
    index: 0,
    count: 7,
    deltaTokens: 7,
    envelope: toBase64(p0Cipher),
    pieceHash: toHex(sha256(p0Cipher)),
    runningHash: toHex(h1),
    signature: toBase64(sigV2),
    finishReason: 'eos' as const,
  }
  assert.equal(StreamPiece.safeParse(wirePiece).success, true)
  assert.equal(
    CallPieces.safeParse({
      call: callAddr.toBase58(),
      status: 'done',
      pieces: [wirePiece],
      failure: null,
    }).success,
    true,
  )
  assert.equal(
    ProgramEvent.safeParse({
      id: 'ev-1',
      timestamp: '2026-11-21T16:00:00Z',
      type: 'call.piece',
      data: wirePiece,
    }).success,
    true,
  )
  assert.equal(
    ProgramEvent.safeParse({
      id: 'ev-2',
      timestamp: '2026-11-21T16:00:01Z',
      type: 'call.stream.done',
      data: {
        call: callAddr.toBase58(),
        status: 'done',
        count: 7,
        pieceCount: 1,
        runningHash: toHex(h1),
        signature: toBase64(sigV2),
        finishReason: 'eos',
        receiptAddress: null,
        settleTransaction: null,
        failure: null,
      },
    }).success,
    true,
  )

  const c = createClient('https://api.voynich.dev')
  assert.equal(c.callStreamUrl(callAddr.toBase58()), `https://api.voynich.dev/v1/calls/${callAddr.toBase58()}/stream`)
  assert.equal(c.callStreamUrl(callAddr.toBase58(), 4), `https://api.voynich.dev/v1/calls/${callAddr.toBase58()}/stream?after=4`)

  const cryptoDist = fs.readFileSync(path.join(ROOT, 'node_modules/voynich/dist/crypto.js'), 'utf8')
  assert.equal(cryptoDist.includes('node:'), false)
})

test('Build 4 Step 3: 423B metered Receipt decoding, verifyPiece 5/5 checks, and chain deliveredCount/returnedAmount verification', async () => {
  assert.equal(RECEIPT_METERED_EXTENSION, 16)
  assert.equal(RECEIPT_METERED_SPACE, 423)

  const disc = sha256(utf8('account:Receipt')).subarray(0, 8)
  const enclaveKey = Keypair.generate()
  const callAddr = Keypair.generate().publicKey
  const callerAddr = Keypair.generate().publicKey
  const modelAddr = Keypair.generate().publicKey
  const enclaveAddr = Keypair.generate().publicKey
  const recordAddr = Keypair.generate().publicKey
  const programId = Keypair.generate().publicKey.toBase58()
  const attestProgramId = Keypair.generate().publicKey.toBase58()
  const inputHashBytes = sha256(utf8('metered-prompt'))
  const runningHashBytes = sha256(utf8('running-hash-61'))
  const base = {
    sha256: '1184a80cdd836f39c6e4af1e26c463042eeaaeecf0b7ee3750f4dbffcc93c84f',
    sizeBytes: 6_143_522,
    format: 'onnx' as const,
    source: 'https://legacy-gateway.mypinata.cloud/ipfs/bafybeihhuclcrqmgo7lno5kcvaj4fsllp5rc2bayqjj2zvlrldt6gkplce',
  }

  const delivered = 61n
  const returned = 78_000n
  const sigV2 = signPiece(enclaveKey.secretKey.subarray(0, 32), callAddr.toBytes(), inputHashBytes, delivered, runningHashBytes, fromHex(base.sha256))
  const sigV1 = signPiece(enclaveKey.secretKey.subarray(0, 32), callAddr.toBytes(), inputHashBytes, delivered, runningHashBytes)

  // Build canonical 423B metered Receipt bytes (407B prefix + u64le deliveredCount + u64le returnedAmount)
  const rawMetered = new Uint8Array(RECEIPT_METERED_SPACE)
  const dv = new DataView(rawMetered.buffer)
  rawMetered.set(disc, 0)
  rawMetered.set(callAddr.toBytes(), 8)
  rawMetered.set(modelAddr.toBytes(), 40)
  rawMetered.set(enclaveAddr.toBytes(), 72)
  rawMetered.set(inputHashBytes, 104)
  rawMetered.set(runningHashBytes, 136)
  rawMetered.set(sigV2, 168)
  dv.setBigUint64(232, 250n, true)
  rawMetered[400] = 254
  rawMetered[401] = 0 // sealed
  dv.setUint32(402, 0, true) // 0 openAnswer bytes
  rawMetered[406] = 0 // callerIsProgram = false
  dv.setBigUint64(407, delivered, true)
  dv.setBigUint64(415, returned, true)

  const dec = decodeReceiptBytes(rawMetered)
  assert.equal(dec.era, 'metered')
  assert.equal(dec.deliveredCount, 61n)
  assert.equal(dec.returnedAmount, 78_000n)
  assert.equal(dec.call, callAddr.toBase58())
  assert.equal(dec.outputHash, toHex(runningHashBytes))

  // Parity with SDK decodeReceiptAccount
  const sdkDec = sdkDecodeReceiptAccount(rawMetered)
  assert.equal(sdkDec.deliveredCount?.toString(), '61')
  assert.equal(sdkDec.returnedAmount?.toString(), '78000')

  const makeMeteredView = (sig: Uint8Array, modelBase: typeof base | null, deliveredCount: string | null = '61', returnedAmount: string | null = '78000') => ({
    receipt: {
      address: Keypair.generate().publicKey.toBase58(),
      call: callAddr.toBase58(),
      caller: callerAddr.toBase58(),
      callerIsProgram: false,
      model: modelAddr.toBase58(),
      modelName: 'text-1m',
      enclave: enclaveAddr.toBase58(),
      inputHash: toHex(inputHashBytes),
      outputHash: toHex(runningHashBytes),
      signature: toBase64(sig),
      answerMode: 'sealed' as const,
      openAnswer: null,
      slot: '250',
      transactionSignature: '5'.repeat(88),
      deliveredCount,
      returnedAmount,
      payments: {
        mint: null,
        total: '122000',
        owner: { recipient: Keypair.generate().publicKey.toBase58(), amount: '85400' },
        operator: { recipient: Keypair.generate().publicKey.toBase58(), amount: '30500' },
        protocol: { recipient: Keypair.generate().publicKey.toBase58(), amount: '6100' },
      },
    },
    enclaveSigningKey: enclaveKey.publicKey.toBase58(),
    attestationRecord: {
      address: recordAddr.toBase58(),
      signingKey: enclaveKey.publicKey.toBase58(),
      encryptionKey: toBase64(new Uint8Array(32)),
      hardwareType: 'dev' as const,
      measurement: 'a'.repeat(96),
      recordedSlot: '100',
      expiresAtSlot: '500',
      layoutVersion: 1,
    },
    attestationProgramId: attestProgramId,
    recordLayoutVersion: 1,
    modelBase,
  })

  // 1. Metered v2 adapter receipt passes 5/5 checks
  const v2Checks = await verifyAll(makeMeteredView(sigV2, base), null, undefined, 0)
  assert.equal(v2Checks.length, 5)
  assert.ok(v2Checks.every((c) => c.passed), 'metered v2 adapter receipt must pass 5/5 checks')

  // 2. Metered standalone v1 receipt passes 5/5 checks
  const v1Checks = await verifyAll(makeMeteredView(sigV1, null), null, undefined, 0)
  assert.equal(v1Checks.length, 5)
  assert.ok(v1Checks.every((c) => c.passed), 'metered standalone v1 receipt must pass 5/5 checks')

  // 3. Tampered deliveredCount fails signature and base checks
  const tamperedCountView = makeMeteredView(sigV2, base, '62', '76000')
  assert.equal(checkSignature(tamperedCountView).passed, false)
  assert.equal((await checkBase(tamperedCountView, null)).passed, false)

  // 4. Chain checkAnswer validates 423B deliveredCount and returnedAmount against on-chain account bytes
  const chainConfig = {
    mode: 'chain' as const,
    cluster: 'localnet' as const,
    rpcUrl: 'http://127.0.0.1:8899',
    programId,
    attestationProgramId: attestProgramId,
    protocolFeeBps: 500,
    enclaveEncryptionKey: null,
  }
  const origFetch = globalThis.fetch
  globalThis.fetch = (async () => ({
    json: async () => ({
      result: { value: { owner: programId, data: [toBase64(rawMetered), 'base64'] } },
    }),
  })) as unknown as typeof fetch
  try {
    assert.equal((await checkAnswer(makeMeteredView(sigV2, base, '61', '78000'), chainConfig)).passed, true)
    assert.equal((await checkAnswer(makeMeteredView(sigV2, base, '61', '0'), chainConfig)).passed, false)
    assert.equal((await checkAnswer(makeMeteredView(sigV2, base, null, null), chainConfig)).passed, false)
  } finally {
    globalThis.fetch = origFetch
  }
})

test('Build 4 Step 4: streaming stage, StopCall schemas, verifyBrowserStreamPiece, followStream SSE + 5/5 settlement, and CallPanel UI', async () => {
  assert.ok(CALL_STAGES.some((x) => x.id === 'streaming' && x.label === 'Streaming pieces'))
  assert.equal(StopCallRequest.safeParse({ stopToken: toBase64(new Uint8Array(16).fill(9)) }).success, true)
  assert.equal(StopCallAccepted.safeParse({ call: Keypair.generate().publicKey.toBase58(), status: 'stopping' }).success, true)
  assert.equal(StopCallAccepted.safeParse({ call: Keypair.generate().publicKey.toBase58(), status: 'already-finished' }).success, true)

  const enclaveKey = Keypair.generate()
  const callAddr = Keypair.generate().publicKey
  const callerAddr = Keypair.generate().publicKey
  const modelAddr = Keypair.generate().publicKey
  const enclaveAddr = Keypair.generate().publicKey
  const recordAddr = Keypair.generate().publicKey
  const receiptAddr = Keypair.generate().publicKey
  const reply = generateEncryptionKeyPair()
  const inputHashBytes = sha256(utf8('stream-prompt'))
  const inputHash = toHex(inputHashBytes)
  const measurement = 'a'.repeat(96)
  const base = {
    sha256: '1184a80cdd836f39c6e4af1e26c463042eeaaeecf0b7ee3750f4dbffcc93c84f',
    sizeBytes: 6_143_522,
    format: 'onnx' as const,
    source: 'https://legacy-gateway.mypinata.cloud/ipfs/bafybeihhuclcrqmgo7lno5kcvaj4fsllp5rc2bayqjj2zvlrldt6gkplce',
  }
  const baseBytes = fromHex(base.sha256)

  // Build 3 signed pieces: two content pieces + a 0-token terminal 'stopped' piece
  const h0 = streamInitialHash(callAddr.toBytes(), inputHashBytes)
  const makeWirePiece = (index: number, count: number, deltaTokens: number, text: string, finishReason: 'eos' | 'stopped' | null, prevHash: Uint8Array) => {
    const plain = utf8(JSON.stringify({ index, text, tokens: deltaTokens, finishReason }))
    const cipher = encryptCallOutput(plain, reply.publicKey)
    const nextHash = streamNextHash(prevHash, count, cipher)
    const sig = signPiece(enclaveKey.secretKey.subarray(0, 32), callAddr.toBytes(), inputHashBytes, count, nextHash, baseBytes)
    return {
      wire: {
        call: callAddr.toBase58(),
        index,
        count,
        deltaTokens,
        envelope: toBase64(cipher),
        pieceHash: toHex(sha256(cipher)),
        runningHash: toHex(nextHash),
        signature: toBase64(sig),
        finishReason,
      },
      nextHash,
    }
  }

  const p0 = makeWirePiece(0, 3, 3, 'Voy', null, h0)
  const p1 = makeWirePiece(1, 7, 4, 'nich', null, p0.nextHash)
  const p2 = makeWirePiece(2, 7, 0, '', 'stopped', p1.nextHash)

  // Direct verifyBrowserStreamPiece checks
  const v0 = verifyBrowserStreamPiece({
    piece: p0.wire,
    expectedCall: callAddr.toBase58(),
    expectedIndex: 0,
    previousCount: 0,
    previousRunningHash: h0,
    enclaveSigningKey: enclaveKey.publicKey.toBase58(),
    inputHash,
    replySecretKey: reply.secretKey,
    baseSha256: base.sha256,
  })
  assert.equal(v0.text, 'Voy')
  assert.equal(v0.count, 3)

  // Zero-token terminal stopped piece verifies cleanly
  const v1 = verifyBrowserStreamPiece({
    piece: p1.wire,
    expectedCall: callAddr.toBase58(),
    expectedIndex: 1,
    previousCount: 3,
    previousRunningHash: v0.nextRunningHash,
    enclaveSigningKey: enclaveKey.publicKey.toBase58(),
    inputHash,
    replySecretKey: reply.secretKey,
    baseSha256: base.sha256,
  })
  const v2 = verifyBrowserStreamPiece({
    piece: p2.wire,
    expectedCall: callAddr.toBase58(),
    expectedIndex: 2,
    previousCount: 7,
    previousRunningHash: v1.nextRunningHash,
    enclaveSigningKey: enclaveKey.publicKey.toBase58(),
    inputHash,
    replySecretKey: reply.secretKey,
    baseSha256: base.sha256,
  })
  assert.equal(v2.finishReason, 'stopped')
  assert.equal(v2.tokens, 0)
  assert.equal(v2.count, 7)

  // Reject tampered signature before decrypting
  assert.throws(() =>
    verifyBrowserStreamPiece({
      piece: { ...p0.wire, signature: toBase64(new Uint8Array(64)) },
      expectedCall: callAddr.toBase58(),
      expectedIndex: 0,
      previousCount: 0,
      previousRunningHash: h0,
      enclaveSigningKey: enclaveKey.publicKey.toBase58(),
      inputHash,
      replySecretKey: reply.secretKey,
      baseSha256: base.sha256,
    }),
  )

  // followStream consumes SSE frames, tracks spent/remaining + lastPiece, and verifies 5/5 settled receipt
  const sseBody = [p0.wire, p1.wire, p2.wire]
    .map((wire, i) => `event: call.piece\ndata: ${JSON.stringify({ id: `e-${i}`, timestamp: '2026-11-21T18:35:00Z', type: 'call.piece', data: wire })}\n\n`)
    .join('')
  const mockFetch = (async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(utf8(sseBody))
          controller.close()
        },
      }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    )) as unknown as typeof fetch

  const callObj = {
    address: callAddr.toBase58(),
    caller: callerAddr.toBase58(),
    callerIsProgram: false,
    model: modelAddr.toBase58(),
    modelName: 'text-1m',
    enclave: enclaveAddr.toBase58(),
    inputHash,
    answerMode: 'sealed' as const,
    priceUnit: 'token' as const,
    unitPrice: { amount: '2000', mint: null, decimals: 9, symbol: 'SOL' },
    ceiling: { amount: '128000', mint: null, decimals: 9, symbol: 'SOL' },
    price: { amount: '128000', mint: null, decimals: 9, symbol: 'SOL' },
    deadlineSlot: '500',
    status: 'settled' as const,
    receipt: receiptAddr.toBase58(),
    failure: null,
  }
  const modelObj = {
    address: modelAddr.toBase58(),
    name: 'text-1m',
    owner: Keypair.generate().publicKey.toBase58(),
    status: 'live' as const,
    manifest: { name: 'text-1m', inputKind: 'text' as const, tokenizer: { format: 'byte-level' as const, vocabSize: 258, maxInputTokens: 128, maxOutputTokens: 64 } },
    sizeBytes: 214_673,
    plaintextSizeBytes: 214_609,
    ciphertextSha256: 'c'.repeat(64),
    hashVersion: 1,
    sealedChunks: 4,
    base,
    cipher: { id: 'xchacha20poly1305-64k-v1' as const, chunkSizeBytes: 65536 as const, noncePrefix: toBase64(new Uint8Array(16)) },
    allowedMeasurements: [measurement],
    price: { amount: '2000', mint: null, decimals: 9, symbol: 'SOL' },
    priceUnit: 'token' as const,
    operatorShareBps: 2500,
    protocolShareBps: 500,
    sealedSlot: '100',
    callsSettled: 1,
    enclavesHolding: 1,
    weights: [],
    upload: null,
  }
  const receiptView = {
    receipt: {
      address: receiptAddr.toBase58(),
      call: callAddr.toBase58(),
      caller: callerAddr.toBase58(),
      callerIsProgram: false,
      model: modelAddr.toBase58(),
      modelName: 'text-1m',
      enclave: enclaveAddr.toBase58(),
      inputHash,
      outputHash: p2.wire.runningHash,
      signature: p2.wire.signature,
      answerMode: 'sealed' as const,
      openAnswer: null,
      slot: '250',
      transactionSignature: '5'.repeat(88),
      deliveredCount: '7',
      returnedAmount: '114000',
      payments: {
        mint: null,
        total: '14000',
        owner: { recipient: Keypair.generate().publicKey.toBase58(), amount: '9800' },
        operator: { recipient: Keypair.generate().publicKey.toBase58(), amount: '3500' },
        protocol: { recipient: Keypair.generate().publicKey.toBase58(), amount: '700' },
      },
    },
    enclaveSigningKey: enclaveKey.publicKey.toBase58(),
    attestationRecord: {
      address: recordAddr.toBase58(),
      signingKey: enclaveKey.publicKey.toBase58(),
      encryptionKey: toBase64(new Uint8Array(32)),
      hardwareType: 'dev' as const,
      measurement,
      recordedSlot: '100',
      expiresAtSlot: '500',
      layoutVersion: 1,
    },
    attestationProgramId: Keypair.generate().publicKey.toBase58(),
    recordLayoutVersion: 1,
    modelBase: base,
  }

  const mockClient = {
    callStreamUrl: (id: string) => `http://127.0.0.1:9702/v1/calls/${id}/stream`,
    callPieces: async () => ({ call: callAddr.toBase58(), status: 'done' as const, pieces: [p0.wire, p1.wire, p2.wire], failure: null }),
    answer: async () => ({ call: callObj, status: 'answered' as const, receiptAddress: receiptAddr.toBase58(), outputEnvelope: null, openAnswer: null, outputHash: p2.wire.runningHash, signature: p2.wire.signature, settleTransaction: '5'.repeat(88), failure: null }),
    receipt: async () => receiptView,
    config: async () => null,
  } as unknown as Parameters<typeof followStream>[0]['client']

  const patches: Partial<CallState>[] = []
  await followStream({
    client: mockClient,
    model: modelObj,
    enclaveSigningKey: enclaveKey.publicKey.toBase58(),
    call: callObj,
    inputHash,
    secret: reply.secretKey,
    update: (p) => patches.push(p),
    fetchImpl: mockFetch,
  })

  const streamPatches = patches.filter((p) => p.stream).map((p) => p.stream!)
  assert.ok(streamPatches.length >= 3)
  const lastStream = streamPatches[streamPatches.length - 1]!
  assert.equal(lastStream.text, 'Voynich')
  assert.equal(lastStream.count, 7)
  assert.equal(lastStream.spentAmount, '14000')
  assert.equal(lastStream.remainingAmount, '114000')
  assert.equal(lastStream.finishReason, 'stopped')
  assert.deepEqual(lastStream.lastPiece, { index: 2, count: 7, runningHash: p2.wire.runningHash, signature: p2.wire.signature })

  const verifiedPatch = patches.find((p) => p.stage === 'verified')
  assert.ok(verifiedPatch)
  assert.equal(verifiedPatch.output?.text, 'Voynich')
  assert.equal(verifiedPatch.output?.tokens, 7)
  assert.equal(verifiedPatch.output?.finishReason, 'stopped')
  assert.deepEqual(verifiedPatch.settlement, {
    deliveredCount: '7',
    paidAmount: '14000',
    returnedAmount: '114000',
    ceilingAmount: '128000',
  })

  const callPanelSrc = fs.readFileSync(path.join(ROOT, 'components/model/CallPanel.tsx'), 'utf8')
  for (const sym of ['PATH_METERED', 'Stop & settle', 'streamMeter', 'Metered settlement', 'Paid', 'Returned']) {
    assert.ok(callPanelSrc.includes(sym), `CallPanel must include ${sym}`)
  }
  assert.equal(callPanelSrc.includes('Streaming pieces and counted settlement follow in the next steps'), false)
  const callSrc = fs.readFileSync(path.join(ROOT, 'lib/call.ts'), 'utf8')
  assert.ok(callSrc.includes('model.allowedMeasurements.includes(enclave.measurement)'))
})

test('Review fixes: eligibleEnclaves measurement & expiry filter, CallPanel unavailable state, and 5 rising check audio cues', () => {
  const allowed = 'a'.repeat(96)
  const disallowed = 'b'.repeat(96)
  const makeItem = (overrides: { measurement?: string; status?: 'live' | 'expired'; reachable?: boolean; expiresAtSlot?: string; grantStatus?: 'live' | 'revoked' }) => ({
    enclave: {
      address: Keypair.generate().publicKey.toBase58(),
      signingKey: Keypair.generate().publicKey.toBase58(),
      encryptionKey: toBase64(new Uint8Array(32)),
      attestationRecord: Keypair.generate().publicKey.toBase58(),
      hardwareType: 'dev' as const,
      measurement: overrides.measurement ?? allowed,
      recordedSlot: '100',
      expiresAtSlot: overrides.expiresAtSlot ?? '500',
      operator: Keypair.generate().publicKey.toBase58(),
      endpoint: 'https://enclave.example.com',
      status: overrides.status ?? 'live',
      reachable: overrides.reachable ?? true,
      modelsHeld: 1,
      callsSettled: 1,
    },
    grant: {
      address: Keypair.generate().publicKey.toBase58(),
      model: Keypair.generate().publicKey.toBase58(),
      modelName: 'text-1m',
      enclave: Keypair.generate().publicKey.toBase58(),
      grantedBy: Keypair.generate().publicKey.toBase58(),
      status: overrides.grantStatus ?? 'live',
    },
  })

  const items = [
    makeItem({ measurement: disallowed }),
    makeItem({ measurement: allowed, status: 'expired' }),
    makeItem({ measurement: allowed, reachable: false }),
    makeItem({ measurement: allowed, grantStatus: 'revoked' }),
    makeItem({ measurement: allowed, expiresAtSlot: '400' }),
    makeItem({ measurement: allowed, expiresAtSlot: '600' }),
  ]

  // Only the live, reachable, allowed-measurement, unexpired enclave passes
  const picked = eligibleEnclaves({ allowedMeasurements: [allowed] }, items, '450')
  assert.equal(picked.length, 1)
  assert.equal(picked[0]!.enclave.expiresAtSlot, '600')

  // When only disallowed measurements are granted, zero enclaves are eligible
  assert.equal(eligibleEnclaves({ allowedMeasurements: [allowed] }, [makeItem({ measurement: disallowed })]).length, 0)

  const callPanelSrc = fs.readFileSync(path.join(ROOT, 'components/model/CallPanel.tsx'), 'utf8')
  assert.ok(callPanelSrc.includes('noEligibleEnclave') && callPanelSrc.includes('No enclave runs an allowed measurement'))
  const modelViewSrc = fs.readFileSync(path.join(ROOT, 'components/model/ModelView.tsx'), 'utf8')
  assert.ok(modelViewSrc.includes('enclaves={enclaves.ok ? enclaves.data.items : null}'))

  // 5 rising check audio cues wired in sound-manifest.json and present in web/public/sound/
  const soundManifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'lib/sound-manifest.json'), 'utf8')) as {
    cues: { check: { files: string[]; order: string } }
  }
  assert.deepEqual(soundManifest.cues.check.files, ['check-0.wav', 'check-1.wav', 'check-2.wav', 'check-3.wav', 'check-4.wav'])
  assert.equal(soundManifest.cues.check.order, 'sequence')
  for (const file of soundManifest.cues.check.files) {
    assert.equal(fs.existsSync(path.join(ROOT, 'public/sound', file)), true, `missing public/sound/${file}`)
  }
})

test('Build 4 Step 5: SettleCallRequest, localStorage piece persistence/TTL/cap, loadLastPieceFromApi, settleMeteredStream, and CallPanel/AccountView UI', async () => {
  const walletAddr = Keypair.generate().publicKey.toBase58()
  const enclaveKey = Keypair.generate()
  const callAddr = Keypair.generate().publicKey
  const modelAddr = Keypair.generate().publicKey
  const enclaveAddr = Keypair.generate().publicKey
  const recordAddr = Keypair.generate().publicKey
  const receiptAddr = Keypair.generate().publicKey
  const reply = generateEncryptionKeyPair()
  const inputHashBytes = sha256(utf8('cut-short-prompt'))
  const inputHash = toHex(inputHashBytes)
  const measurement = 'a'.repeat(96)
  const base = {
    sha256: '1184a80cdd836f39c6e4af1e26c463042eeaaeecf0b7ee3750f4dbffcc93c84f',
    sizeBytes: 6_143_522,
    format: 'onnx' as const,
    source: 'https://legacy-gateway.mypinata.cloud/ipfs/bafybeihhuclcrqmgo7lno5kcvaj4fsllp5rc2bayqjj2zvlrldt6gkplce',
  }
  const baseBytes = fromHex(base.sha256)

  const h0 = streamInitialHash(callAddr.toBytes(), inputHashBytes)
  const p0Plain = utf8(JSON.stringify({ index: 0, text: 'Voy', tokens: 3, finishReason: null }))
  const p0Cipher = encryptCallOutput(p0Plain, reply.publicKey)
  const h1 = streamNextHash(h0, 3, p0Cipher)
  const sig0 = signPiece(enclaveKey.secretKey.subarray(0, 32), callAddr.toBytes(), inputHashBytes, 3, h1, baseBytes)

  assert.equal(
    SettleCallRequest.safeParse({
      wallet: walletAddr,
      count: '3',
      runningHash: toHex(h1),
      signature: toBase64(sig0),
    }).success,
    true,
  )

  // Mock localStorage to verify save/load/TTL prune/50-entry cap/remove and zero secrets persisted
  const store = new Map<string, string>()
  const prevStorage = (globalThis as { localStorage?: unknown }).localStorage
  ;(globalThis as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v) },
    removeItem: (k: string) => { store.delete(k) },
    clear: () => { store.clear() },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size },
  } as Storage

  try {
    const now = 1_700_000_000_000
    // Save an expired entry and 55 fresh entries -> expired pruned, newest 50 retained
    saveStreamPiece({
      call: 'ExpiredCall111111111111111111111111111111111',
      model: modelAddr.toBase58(),
      modelName: 'text-1m',
      index: 0,
      count: 1,
      runningHash: toHex(h1),
      signature: toBase64(sig0),
      spentAmount: '2000',
      remainingAmount: '126000',
      ceilingAmount: '128000',
      deadlineSlot: '500',
      updatedAt: now - STREAM_PIECES_TTL_MS - 1000,
    }, now)
    for (let i = 0; i < 55; i++) {
      saveStreamPiece({
        call: `Call${String(i).padStart(40, '0')}`,
        model: modelAddr.toBase58(),
        modelName: 'text-1m',
        index: 0,
        count: i + 1,
        runningHash: toHex(h1),
        signature: toBase64(sig0),
        spentAmount: String((i + 1) * 2000),
        remainingAmount: '10000',
        ceilingAmount: '128000',
        deadlineSlot: '500',
        updatedAt: now + i,
      }, now + i)
    }
    const loaded = loadSavedStreamPieces(now + 60)
    assert.equal(Object.keys(loaded).length, STREAM_PIECES_MAX_ENTRIES)
    assert.equal(loaded['ExpiredCall111111111111111111111111111111111'], undefined)
    assert.equal(loaded[`Call${String(0).padStart(40, '0')}`], undefined)
    assert.equal(loaded[`Call${String(54).padStart(40, '0')}`]?.count, 55)
    const rawSaved = store.get(STREAM_PIECES_STORAGE_KEY) ?? ''
    assert.equal(rawSaved.includes('secret'), false)
    assert.equal(rawSaved.includes('plaintext'), false)

    // loadLastPieceFromApi verifies piece chain from /pieces without decrypting and persists it
    const wire0 = {
      call: callAddr.toBase58(),
      index: 0,
      count: 3,
      deltaTokens: 3,
      envelope: toBase64(p0Cipher),
      pieceHash: toHex(sha256(p0Cipher)),
      runningHash: toHex(h1),
      signature: toBase64(sig0),
      finishReason: null,
    }
    const callObj = {
      address: callAddr.toBase58(),
      caller: walletAddr,
      callerIsProgram: false,
      model: modelAddr.toBase58(),
      modelName: 'text-1m',
      enclave: enclaveAddr.toBase58(),
      inputHash,
      answerMode: 'sealed' as const,
      priceUnit: 'token' as const,
      unitPrice: { amount: '2000', mint: null, decimals: 9, symbol: 'SOL' },
      ceiling: { amount: '128000', mint: null, decimals: 9, symbol: 'SOL' },
      price: { amount: '128000', mint: null, decimals: 9, symbol: 'SOL' },
      openedSlot: '150',
      deadlineSlot: '500',
      status: 'open' as const,
      receipt: null,
      failure: null,
    }
    const modelObj = {
      address: modelAddr.toBase58(),
      name: 'text-1m',
      owner: Keypair.generate().publicKey.toBase58(),
      status: 'live' as const,
      manifest: { name: 'text-1m', inputKind: 'text' as const, tokenizer: { format: 'byte-level' as const, vocabSize: 258, maxInputTokens: 128, maxOutputTokens: 64 } },
      sizeBytes: 214_673,
      plaintextSizeBytes: 214_609,
      ciphertextSha256: 'c'.repeat(64),
      hashVersion: 1,
      sealedChunks: 4,
      base,
      cipher: { id: 'xchacha20poly1305-64k-v1' as const, chunkSizeBytes: 65536 as const, noncePrefix: toBase64(new Uint8Array(16)) },
      allowedMeasurements: [measurement],
      price: { amount: '2000', mint: null, decimals: 9, symbol: 'SOL' },
      priceUnit: 'token' as const,
      operatorShareBps: 2500,
      protocolShareBps: 500,
      sealedSlot: '100',
      callsSettled: 1,
      enclavesHolding: 1,
      weights: [],
      upload: null,
    }
    const receiptView = {
      receipt: {
        address: receiptAddr.toBase58(),
        call: callAddr.toBase58(),
        caller: walletAddr,
        callerIsProgram: false,
        model: modelAddr.toBase58(),
        modelName: 'text-1m',
        enclave: enclaveAddr.toBase58(),
        inputHash,
        outputHash: toHex(h1),
        signature: toBase64(sig0),
        answerMode: 'sealed' as const,
        openAnswer: null,
        slot: '250',
        transactionSignature: '5'.repeat(88),
        deliveredCount: '3',
        returnedAmount: '122000',
        payments: {
          mint: null,
          total: '6000',
          owner: { recipient: Keypair.generate().publicKey.toBase58(), amount: '4200' },
          operator: { recipient: Keypair.generate().publicKey.toBase58(), amount: '1500' },
          protocol: { recipient: Keypair.generate().publicKey.toBase58(), amount: '300' },
        },
      },
      enclaveSigningKey: enclaveKey.publicKey.toBase58(),
      attestationRecord: {
        address: recordAddr.toBase58(),
        signingKey: enclaveKey.publicKey.toBase58(),
        encryptionKey: toBase64(new Uint8Array(32)),
        hardwareType: 'dev' as const,
        measurement,
        recordedSlot: '100',
        expiresAtSlot: '500',
        layoutVersion: 1,
      },
      attestationProgramId: Keypair.generate().publicKey.toBase58(),
      recordLayoutVersion: 1,
      modelBase: base,
    }

    const mockClient = {
      callPieces: async () => ({ call: callAddr.toBase58(), status: 'streaming' as const, pieces: [wire0], failure: null }),
      enclave: async () => ({ enclave: { signingKey: enclaveKey.publicKey.toBase58() } }),
      model: async () => modelObj,
      settleCall: async () => ({
        id: 'settle-b1',
        action: 'settle_metered_call' as const,
        transactionBase64: toBase64(new Uint8Array(16)),
        blockhash: '11111111111111111111111111111111',
        lastValidBlockHeight: 100,
        cosigned: false,
        requiredSigners: [walletAddr],
        fixture: true,
        addresses: { model: modelAddr.toBase58(), call: callAddr.toBase58(), receipt: receiptAddr.toBase58() },
      }),
      submitTransaction: async (input: { buildId: string }) => ({ id: input.buildId, status: 'confirmed' }),
      transaction: async (id: string) => ({ id, status: 'confirmed' }),
      receipt: async () => receiptView,
      config: async () => null,
    } as unknown as Parameters<typeof loadLastPieceFromApi>[0]

    const recovered = await loadLastPieceFromApi(mockClient, callObj)
    assert.equal(recovered.count, 3)
    assert.equal(recovered.spentAmount, '6000')
    assert.equal(recovered.remainingAmount, '122000')
    assert.equal(getSavedStreamPiece(callAddr.toBase58())?.count, 3)

    // settleMeteredStream settles, verifies 5/5, removes saved piece, and populates settlement summary
    const patches: Partial<CallState>[] = []
    await settleMeteredStream({
      client: mockClient,
      model: modelObj,
      wallet: walletAddr,
      call: callObj,
      piece: { index: 0, count: 3, runningHash: toHex(h1), signature: toBase64(sig0) },
      text: 'Voy',
      finishReason: 'stopped',
      update: (p) => patches.push(p),
    })
    const verified = patches.find((p) => p.stage === 'verified')
    assert.ok(verified)
    assert.equal(verified.output?.text, 'Voy')
    assert.equal(verified.output?.tokens, 3)
    assert.deepEqual(verified.settlement, {
      deliveredCount: '3',
      paidAmount: '6000',
      returnedAmount: '122000',
      ceilingAmount: '128000',
    })
    assert.equal(getSavedStreamPiece(callAddr.toBase58()), null)
    removeSavedStreamPiece(callAddr.toBase58())
  } finally {
    if (prevStorage === undefined) delete (globalThis as { localStorage?: unknown }).localStorage
    else (globalThis as { localStorage?: unknown }).localStorage = prevStorage
  }

  const callPanelSrc = fs.readFileSync(path.join(ROOT, 'components/model/CallPanel.tsx'), 'utf8')
  for (const sym of ['settleMeteredStream', 'canSelfSettle', 'Settle at ', 'immediately with your wallet']) {
    assert.ok(callPanelSrc.includes(sym), `CallPanel must include ${sym}`)
  }
  const accountViewSrc = fs.readFileSync(path.join(ROOT, 'components/account/AccountView.tsx'), 'utf8')
  for (const sym of ['loadSavedStreamPieces', 'loadLastPieceFromApi', 'removeSavedStreamPiece', 'Load last piece', 'Settle (', 'returned to the caller']) {
    assert.ok(accountViewSrc.includes(sym), `AccountView must include ${sym}`)
  }
})

test('Build 4 Step 6: metered stream receipt UI (Delivered, Running hash, Ceiling, Returned to caller), updated RECEIPT_CHECKS, and 5/5 checks', async () => {
  const sigCheck = RECEIPT_CHECKS.find((c) => c.id === 'signature')
  assert.ok(sigCheck)
  assert.ok(sigCheck.says.includes('output hash') && sigCheck.says.includes('delivered token count') && sigCheck.says.includes('running hash'))

  const receiptViewSrc = fs.readFileSync(path.join(ROOT, 'components/receipt/ReceiptView.tsx'), 'utf8')
  for (const sym of [
    'receipt.deliveredCount !== null && receipt.deliveredCount !== undefined',
    'Metered stream from',
    'One answer from',
    '<dt>Delivered</dt>',
    '<dt>Returned to caller</dt>',
    "metered ? 'Running hash' : 'Output hash'",
    '<dt>Ceiling</dt>',
    'Same transaction',
  ]) {
    assert.ok(receiptViewSrc.includes(sym), `ReceiptView must include ${sym}`)
  }

  // Verify 5/5 checks pass on a metered 24-token stream receipt with remainder returned
  const enclaveKey = Keypair.generate()
  const callAddr = Keypair.generate().publicKey
  const modelAddr = Keypair.generate().publicKey
  const enclaveAddr = Keypair.generate().publicKey
  const recordAddr = Keypair.generate().publicKey
  const inputHashBytes = sha256(utf8('step6-prompt'))
  const runningHashBytes = sha256(utf8('step6-running-hash-24'))
  const base = {
    sha256: '1184a80cdd836f39c6e4af1e26c463042eeaaeecf0b7ee3750f4dbffcc93c84f',
    sizeBytes: 6_143_522,
    format: 'onnx' as const,
    source: 'https://legacy-gateway.mypinata.cloud/ipfs/bafybeihhuclcrqmgo7lno5kcvaj4fsllp5rc2bayqjj2zvlrldt6gkplce',
  }
  const sigV2 = signPiece(enclaveKey.secretKey.subarray(0, 32), callAddr.toBytes(), inputHashBytes, 24n, runningHashBytes, fromHex(base.sha256))
  const checks = await verifyAll({
    receipt: {
      address: Keypair.generate().publicKey.toBase58(),
      call: callAddr.toBase58(),
      caller: Keypair.generate().publicKey.toBase58(),
      callerIsProgram: false,
      model: modelAddr.toBase58(),
      modelName: 'text-1m',
      enclave: enclaveAddr.toBase58(),
      inputHash: toHex(inputHashBytes),
      outputHash: toHex(runningHashBytes),
      signature: toBase64(sigV2),
      answerMode: 'sealed',
      openAnswer: null,
      slot: '300',
      transactionSignature: '5'.repeat(88),
      deliveredCount: '24',
      returnedAmount: '152000',
      payments: {
        mint: null,
        total: '48000',
        owner: { recipient: Keypair.generate().publicKey.toBase58(), amount: '33600' },
        operator: { recipient: Keypair.generate().publicKey.toBase58(), amount: '12000' },
        protocol: { recipient: Keypair.generate().publicKey.toBase58(), amount: '2400' },
      },
    },
    enclaveSigningKey: enclaveKey.publicKey.toBase58(),
    attestationRecord: {
      address: recordAddr.toBase58(),
      signingKey: enclaveKey.publicKey.toBase58(),
      encryptionKey: toBase64(new Uint8Array(32)),
      hardwareType: 'dev',
      measurement: 'a'.repeat(96),
      recordedSlot: '100',
      expiresAtSlot: '500',
      layoutVersion: 1,
    },
    attestationProgramId: Keypair.generate().publicKey.toBase58(),
    recordLayoutVersion: 1,
    modelBase: base,
  }, null, undefined, 0)
  assert.equal(checks.length, 5)
  assert.ok(checks.every((c) => c.passed), 'metered 24-token stream receipt must pass 5/5 checks')
})

test('Build 5 Step 4: measurement provenance lookup helpers, formatting, and wiring across models, enclaves, receipts, and seal', async () => {
  const digest = 'a'.repeat(96)
  const record = {
    address: Keypair.generate().publicKey.toBase58(),
    digest,
    version: '0.2.30',
    commitSha: '1234567890abcdef1234567890abcdef12345678',
    recipeHash: 'b'.repeat(64),
    sourceRepo: 'https://github.com/voynich-dev/voynich',
    publisher: Keypair.generate().publicKey.toBase58(),
    createdSlot: '1000',
    status: 'active' as const,
  }
  const map = indexMeasurements([record])
  assert.equal(findMeasurement(map, digest.toUpperCase())?.version, '0.2.30')
  assert.equal(findMeasurement(map, 'f'.repeat(96)), null)
  assert.equal(findMeasurement(null, digest), null)

  assert.equal(isHttpUrl('https://github.com/voynich-dev/voynich'), true)
  assert.equal(isHttpUrl('http://127.0.0.1:8080/repo'), true)
  assert.equal(isHttpUrl('github.com/voynich-dev/voynich'), false)
  assert.equal(isHttpUrl('javascript:alert(1)'), false)

  assert.equal(formatMeasurementLabel(record), 'v0.2.30 · 1234567 · https://github.com/voynich-dev/voynich')

  // loadMeasurements handles both ok and failed API responses cleanly
  const okClient = {
    measurements: async () => ({ items: [record], nextCursor: null }),
  } as unknown as Parameters<typeof loadMeasurements>[0]
  const loaded = await loadMeasurements(okClient)
  assert.equal(findMeasurement(loaded, digest)?.commitSha, record.commitSha)

  const failClient = {
    measurements: async () => { throw new Error('offline') },
  } as unknown as Parameters<typeof loadMeasurements>[0]
  const empty = await loadMeasurements(failClient)
  assert.equal(Object.keys(empty).length, 0)

  // Verify wiring across all five surfaces
  const modelPageSrc = fs.readFileSync(path.join(ROOT, 'app/models/[id]/page.tsx'), 'utf8')
  assert.ok(modelPageSrc.includes('loadMeasurements(client)'))

  const modelViewSrc = fs.readFileSync(path.join(ROOT, 'components/model/ModelView.tsx'), 'utf8')
  assert.ok(modelViewSrc.includes('MeasurementSource') && modelViewSrc.includes('findMeasurement(measurements, m)'))

  const enclavesPageSrc = fs.readFileSync(path.join(ROOT, 'app/enclaves/page.tsx'), 'utf8')
  assert.ok(enclavesPageSrc.includes('loadMeasurements(client)') && enclavesPageSrc.includes('MeasurementSource'))

  const enclaveDetailSrc = fs.readFileSync(path.join(ROOT, 'app/enclaves/[key]/page.tsx'), 'utf8')
  assert.ok(enclaveDetailSrc.includes('loadMeasurements(client)') && enclaveDetailSrc.includes('MeasurementSource'))

  const receiptLoadSrc = fs.readFileSync(path.join(ROOT, 'components/receipt/load.ts'), 'utf8')
  assert.ok(receiptLoadSrc.includes('client.measurement(r.data.attestationRecord.measurement)'))

  const receiptViewSrc = fs.readFileSync(path.join(ROOT, 'components/receipt/ReceiptView.tsx'), 'utf8')
  assert.ok(receiptViewSrc.includes('<dt>Runtime source</dt>') && receiptViewSrc.includes('<MeasurementSource record={measurement} />'))

  const sealFlowSrc = fs.readFileSync(path.join(ROOT, 'components/seal/SealFlow.tsx'), 'utf8')
  assert.ok(sealFlowSrc.includes("c.measurements({ status: 'active', limit: 100 })") && sealFlowSrc.includes('publishedMeasurements={publishedMeasurements}'))

  const prepareSrc = fs.readFileSync(path.join(ROOT, 'components/seal/Prepare.tsx'), 'utf8')
  assert.ok(prepareSrc.includes('indexMeasurements(publishedMeasurements ?? [])') && prepareSrc.includes('formatMeasurementLabel(pub)'))
})

test('Build 7 Step 3: owner policy validation, allow-list refusal, error mapping, and ModelView/OwnerPanel/CallPanel wiring', async () => {
  const callerA = Keypair.generate().publicKey.toBase58()
  const callerB = Keypair.generate().publicKey.toBase58()
  const operatorA = Keypair.generate().publicKey.toBase58()
  const modelAddr = Keypair.generate().publicKey.toBase58()
  const policyAddr = Keypair.generate().publicKey.toBase58()

  const samplePolicy = {
    address: policyAddr,
    model: modelAddr,
    allowListEnabled: true,
    allowedCallers: [callerA],
    maxCallsPerCallerPerWindow: 5,
    windowSlots: '1500',
    allowedOperators: [operatorA],
    allowedRegions: ['us-east'],
    updatedSlot: '12345',
  }

  // loadModelPolicy skips network call when hasPolicy === false and returns null on 404
  let calls = 0
  const client = {
    modelPolicy: async () => {
      calls++
      return samplePolicy
    },
  } as unknown as Parameters<typeof loadModelPolicy>[0]
  assert.equal(await loadModelPolicy(client, { address: modelAddr, hasPolicy: false }), null)
  assert.equal(calls, 0)
  assert.deepEqual(await loadModelPolicy(client, { address: modelAddr, hasPolicy: true }), samplePolicy)
  assert.equal(calls, 1)

  const missingClient = {
    modelPolicy: async () => { throw new Error('404 POLICY_NOT_FOUND') },
  } as unknown as Parameters<typeof loadModelPolicy>[0]
  assert.equal(await loadModelPolicy(missingClient, { address: modelAddr, hasPolicy: true }), null)

  // Validation & equality
  const draft = policyToDraft(samplePolicy)
  const parsed = validatePolicyDraft(draft)
  assert.equal(parsed.ok, true)
  if (parsed.ok) {
    assert.equal(policyEquals(samplePolicy, parsed.body), true)
    assert.deepEqual(parsed.body.allowedRegions, ['us-east'])
  }
  assert.equal(formatRateCeiling(samplePolicy), '5 calls / 1,500 slots')
  assert.equal(formatRateCeiling({ maxCallsPerCallerPerWindow: 0, windowSlots: '0' }), null)

  const badRate = validatePolicyDraft({ ...EMPTY_POLICY_DRAFT, maxCallsText: '5', windowSlotsText: '0' })
  assert.equal(badRate.ok, false)
  if (!badRate.ok) assert.ok(badRate.errors.rate)

  const badAddr = parseAddressList('not-a-pubkey', 32, 'caller')
  assert.equal(badAddr.ok, false)

  const badRegion = parseRegionList('US_EAST_BAD!')
  assert.equal(badRegion.ok, false)

  const dedupedRegions = parseRegionList('US-EAST, us-east, eu-west')
  assert.equal(dedupedRegions.ok, true)
  if (dedupedRegions.ok) assert.deepEqual(dedupedRegions.values, ['us-east', 'eu-west'])

  // Allow-list refusal helper
  assert.equal(isCallerAllowedByPolicy(null, callerB), true)
  assert.equal(isCallerAllowedByPolicy({ ...samplePolicy, allowListEnabled: false }, callerB), true)
  assert.equal(isCallerAllowedByPolicy(samplePolicy, callerA), true)
  assert.equal(isCallerAllowedByPolicy(samplePolicy, callerB), false)

  // Error code mapping
  assert.ok(errorMessage({ body: { error: { code: 'POLICY_CALLER_DENIED' } } }).includes('allow list'))
  assert.ok(errorMessage({ body: { error: { code: 'RATE_LIMITED' } } }).includes('Rate ceiling'))

  // UI wiring assertions
  const modelPageSrc = fs.readFileSync(path.join(ROOT, 'app/models/[id]/page.tsx'), 'utf8')
  assert.ok(modelPageSrc.includes('loadModelPolicy(client, model.data)'))

  const modelViewSrc = fs.readFileSync(path.join(ROOT, 'components/model/ModelView.tsx'), 'utf8')
  for (const sym of ['loadModelPolicy', 'formatRateCeiling', '<dt className={s.wide}>Policy</dt>', 'policy={policy}']) {
    assert.ok(modelViewSrc.includes(sym), `ModelView must include ${sym}`)
  }

  const ownerPanelSrc = fs.readFileSync(path.join(ROOT, 'components/model/OwnerPanel.tsx'), 'utf8')
  for (const sym of ['client.setPolicy', 'client.clearPolicy', 'Save policy', 'Clear policy', 'Allowed callers (max 32)', 'Max calls per window', 'Window (slots)', 'Allowed operators (max 16)', 'Allowed regions (max 8)']) {
    assert.ok(ownerPanelSrc.includes(sym), `OwnerPanel must include ${sym}`)
  }

  const callPanelSrc = fs.readFileSync(path.join(ROOT, 'components/model/CallPanel.tsx'), 'utf8')
  for (const sym of ['isCallerAllowedByPolicy', 'Caller not on allow list', 'This wallet is not on the model allow list']) {
    assert.ok(callPanelSrc.includes(sym), `CallPanel must include ${sym}`)
  }
})

test('Build 9 Step 2: quote & latency helpers, selectEnclave/pickEnclave strategies, and UI wiring across ModelView, CallPanel, and /enclaves', () => {
  const m = 'a'.repeat(96)
  const model = { allowedMeasurements: [m], operatorShareBps: 2500 }

  assert.equal(effectiveShareBps({ quotedOperatorShareBps: null }, 2500), 2500)
  assert.equal(effectiveShareBps({ quotedOperatorShareBps: 1000 }, 2500), 1000)
  assert.equal(effectiveShareBps({ quotedOperatorShareBps: 3000 }, 2500), 2500)

  assert.equal(formatLatency(null), 'No data')
  assert.equal(formatLatency(420), '420 ms')
  assert.equal(formatLatency(1460), '1.5 s')

  const makeItem = (key: string, share: number | null, latency: number | null) => ({
    enclave: {
      address: `${key}-addr`,
      signingKey: key,
      encryptionKey: toBase64(new Uint8Array(32)),
      operator: Keypair.generate().publicKey.toBase58(),
      hardwareType: 'dev' as const,
      measurement: m,
      status: 'live' as const,
      reachable: true,
      expiresAtSlot: '999999',
      modelsHeld: 1,
      callsSettled: '5',
      attestation: {
        address: Keypair.generate().publicKey.toBase58(),
        signingKey: key,
        encryptionKey: toBase64(new Uint8Array(32)),
        hardwareType: 'dev' as const,
        measurement: m,
        recordedSlot: '100',
        expiresAtSlot: '999999',
        layoutVersion: 1,
      },
    },
    grant: {
      address: `${key}-grant`,
      model: Keypair.generate().publicKey.toBase58(),
      modelName: 'text-1m',
      enclave: `${key}-addr`,
      grantedBy: Keypair.generate().publicKey.toBase58(),
      grantedSlot: '100',
      status: 'live' as const,
      quotedOperatorShareBps: share,
      medianAnswerMs: latency,
    },
  })

  const items = [
    makeItem('EnclaveCheap', 1000, 640),
    makeItem('EnclaveBal', 1400, 380),
    makeItem('EnclaveFast', 2000, 260),
  ]

  assert.equal(selectEnclave(items, { strategy: 'cheapest', modelOperatorShareBps: 2500 })?.enclave.signingKey, 'EnclaveCheap')
  assert.equal(selectEnclave(items, { strategy: 'fastest', modelOperatorShareBps: 2500 })?.enclave.signingKey, 'EnclaveFast')
  assert.equal(pickEnclave(model, items, { strategy: 'cheapest' })?.enclave.signingKey, 'EnclaveCheap')
  assert.equal(pickEnclave(model, items, { strategy: 'fastest' })?.enclave.signingKey, 'EnclaveFast')
  assert.equal(pickEnclave(model, items, { strategy: 'balanced' })?.enclave.signingKey, 'EnclaveBal')
  assert.equal(pickEnclave(model, items, { strategy: 'cheapest', enclaveAddress: 'EnclaveFast-addr' })?.enclave.signingKey, 'EnclaveFast')

  const modelViewSrc = fs.readFileSync(path.join(ROOT, 'components/model/ModelView.tsx'), 'utf8')
  for (const sym of ['Quoted share', 'Median latency', 'effectiveShareBps', 'formatLatency']) {
    assert.ok(modelViewSrc.includes(sym), `ModelView must include ${sym}`)
  }

  const callPanelSrc = fs.readFileSync(path.join(ROOT, 'components/model/CallPanel.tsx'), 'utf8')
  for (const sym of ['Routing', 'Balanced', 'Cheapest', 'Fastest', 'pickEnclave', 'pinnedEnclave']) {
    assert.ok(callPanelSrc.includes(sym), `CallPanel must include ${sym}`)
  }

  const enclavesPageSrc = fs.readFileSync(path.join(ROOT, 'app/enclaves/page.tsx'), 'utf8')
  assert.ok(enclavesPageSrc.includes('Quoted share') && enclavesPageSrc.includes('Median latency'))

  const enclaveDetailSrc = fs.readFileSync(path.join(ROOT, 'app/enclaves/[key]/page.tsx'), 'utf8')
  assert.ok(enclaveDetailSrc.includes('Quoted share') && enclaveDetailSrc.includes('Median latency'))
})

test('Build 10 Step 2: model version helpers, receipt revision matching, upgrade CLI hint, and ModelView/OwnerPanel/ReceiptView wiring', async () => {
  assert.equal(effectiveModelVersion({ currentVersion: undefined }), 1)
  assert.equal(effectiveModelVersion({ currentVersion: 0 }), 1)
  assert.equal(effectiveModelVersion({ currentVersion: 2 }), 2)

  const modelAddr = Keypair.generate().publicKey.toBase58()
  const v1 = {
    model: modelAddr,
    version: 1,
    address: null,
    status: 'archived' as const,
    sizeBytes: 100_000,
    ciphertextSha256: '1'.repeat(64),
    base: null,
    manifest: null,
    publishedSlot: '1000',
  }
  const v2 = {
    model: modelAddr,
    version: 2,
    address: Keypair.generate().publicKey.toBase58(),
    status: 'live' as const,
    sizeBytes: 120_000,
    ciphertextSha256: '2'.repeat(64),
    base: null,
    manifest: null,
    publishedSlot: '2000',
  }
  const v3Uploading = {
    model: modelAddr,
    version: 3,
    address: Keypair.generate().publicKey.toBase58(),
    status: 'uploading' as const,
    sizeBytes: 130_000,
    ciphertextSha256: null,
    base: null,
    manifest: null,
    publishedSlot: null,
  }

  assert.equal(matchReceiptVersion('1500', [v2, v1, v3Uploading])?.version, 1)
  assert.equal(matchReceiptVersion('2000', [v2, v1, v3Uploading])?.version, 2)
  assert.equal(matchReceiptVersion('2500', [v2, v1, v3Uploading])?.ciphertextSha256, '2'.repeat(64))
  assert.equal(matchReceiptVersion('500', [v2, v1])?.version, 1)
  assert.equal(matchReceiptVersion('1500', []), null)

  assert.equal(upgradeCliCommand('sketch-32', false), 'voynich model upgrade sketch-32 <weights.onnx>')
  assert.ok(upgradeCliCommand('text-1m', true).includes('voynich model upgrade text-1m') && upgradeCliCommand('text-1m', true).includes('--base-file'))

  const okClient = {
    modelVersions: async () => ({ items: [v2, v1], currentVersion: 2 }),
  } as unknown as Parameters<typeof loadModelVersions>[0]
  assert.equal((await loadModelVersions(okClient, modelAddr))?.currentVersion, 2)

  const failClient = {
    modelVersions: async () => { throw new Error('offline') },
  } as unknown as Parameters<typeof loadModelVersions>[0]
  assert.equal(await loadModelVersions(failClient, modelAddr), null)

  const fb = fallbackModelVersions({
    address: modelAddr,
    status: 'live',
    sizeBytes: 100_000,
    ciphertextSha256: '1'.repeat(64),
    base: null,
    manifest: { name: 'sketch-32', inputKind: 'sketch', inputShape: [1, 1, 28, 28], labels: ['clock'] },
    sealedSlot: '1000',
    currentVersion: 1,
  })
  assert.equal(fb.length, 1)
  assert.equal(fb[0]?.version, 1)

  const modelPageSrc = fs.readFileSync(path.join(ROOT, 'app/models/[id]/page.tsx'), 'utf8')
  assert.ok(modelPageSrc.includes('loadModelVersions(client, name)'))

  const modelViewSrc = fs.readFileSync(path.join(ROOT, 'components/model/ModelView.tsx'), 'utf8')
  for (const sym of ['Version history', 'activeVersion', 'versionItems', 'Weights hash', 'Published slot']) {
    assert.ok(modelViewSrc.includes(sym), `ModelView must include ${sym}`)
  }

  const ownerPanelSrc = fs.readFileSync(path.join(ROOT, 'components/model/OwnerPanel.tsx'), 'utf8')
  assert.ok(ownerPanelSrc.includes('Version upgrade') && ownerPanelSrc.includes('upgradeCliCommand'))

  const receiptLoadSrc = fs.readFileSync(path.join(ROOT, 'components/receipt/load.ts'), 'utf8')
  assert.ok(receiptLoadSrc.includes('loadModelVersions') && receiptLoadSrc.includes('matchReceiptVersion'))

  const receiptViewSrc = fs.readFileSync(path.join(ROOT, 'components/receipt/ReceiptView.tsx'), 'utf8')
  assert.ok(receiptViewSrc.includes('<dt>Model version</dt>') && receiptViewSrc.includes('v{version.version}'))
})

test('Build 11 Step 2: browser session delegate storage, active session matching, delegate signing, and CallPanel/AccountView UI wiring', async () => {
  const store = new Map<string, string>()
  const prevSessionStorage = (globalThis as { sessionStorage?: unknown }).sessionStorage
  ;(globalThis as { sessionStorage?: unknown }).sessionStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v) },
    removeItem: (k: string) => { store.delete(k) },
  }
  try {
    const caller = Keypair.generate().publicKey.toBase58()
    const delegate = Keypair.generate()
    const modelAddr = Keypair.generate().publicKey.toBase58()
    const otherModel = Keypair.generate().publicKey.toBase58()
    const sessAddr = Keypair.generate().publicKey.toBase58()

    saveSessionDelegate(caller, sessAddr, delegate.secretKey)
    assert.ok(store.has(SESSION_DELEGATES_KEY))
    assert.equal(loadSessionDelegate(caller, sessAddr)?.publicKey.toBase58(), delegate.publicKey.toBase58())

    const openSess = {
      address: sessAddr,
      caller,
      delegate: delegate.publicKey.toBase58(),
      nonce: '1',
      mint: null,
      model: modelAddr,
      budget: { amount: '50000000', mint: null, decimals: 9, symbol: 'SOL' },
      spent: '10000000',
      remaining: '40000000',
      callsOpened: '1',
      openedSlot: '100',
      expiresAtSlot: '1900',
      status: 'open' as const,
    }
    const found = findActiveBrowserSession(caller, [openSess], modelAddr, null)
    assert.equal(found?.session.address, sessAddr)
    assert.equal(found?.delegate.publicKey.toBase58(), delegate.publicKey.toBase58())
    assert.equal(findActiveBrowserSession(caller, [openSess], otherModel, null), null)
    assert.equal(findActiveBrowserSession(caller, [{ ...openSess, status: 'closed' as const }], modelAddr, null), null)
    assert.equal(findActiveBrowserSession(caller, [{ ...openSess, remaining: '0' }], modelAddr, null), null)

    // submitDelegateBuild signs locally with delegate keypair and relays without wallet prompt
    const blockhash = Keypair.generate().publicKey.toBase58()
    const unsigned = new VersionedTransaction(
      new TransactionMessage({
        payerKey: delegate.publicKey,
        recentBlockhash: blockhash,
        instructions: [SystemProgram.transfer({ fromPubkey: delegate.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 })],
      }).compileToV0Message(),
    )
    let submittedSigValid = false
    const mockClient = {
      submitTransaction: async (input: { buildId: string; signedTransactionBase64: string }) => {
        const decoded = VersionedTransaction.deserialize(Buffer.from(input.signedTransactionBase64, 'base64'))
        submittedSigValid = decoded.signatures[0]!.some((b) => b !== 0)
        return { id: input.buildId, status: 'confirmed' as const }
      },
      transaction: async (id: string) => ({ id, status: 'confirmed' as const }),
      accountSessions: async () => { throw new Error('offline') },
    } as unknown as Parameters<typeof submitDelegateBuild>[0]

    const status = await submitDelegateBuild(
      mockClient,
      {
        id: 'sess-build-1',
        action: 'open_session_call',
        transactionBase64: Buffer.from(unsigned.serialize()).toString('base64'),
        blockhash,
        lastValidBlockHeight: 100,
        cosigned: false,
        requiredSigners: [delegate.publicKey.toBase58()],
        fixture: false,
        addresses: {},
      },
      delegate,
    )
    assert.equal(status.status, 'confirmed')
    assert.equal(submittedSigValid, true)
    assert.deepEqual(await loadAccountSessions(mockClient, caller), [])

    removeSessionDelegate(caller, sessAddr)
    assert.equal(loadSessionDelegate(caller, sessAddr), null)
  } finally {
    if (prevSessionStorage === undefined) delete (globalThis as { sessionStorage?: unknown }).sessionStorage
    else (globalThis as { sessionStorage?: unknown }).sessionStorage = prevSessionStorage
  }

  const callSrc = fs.readFileSync(path.join(ROOT, 'lib/call.ts'), 'utf8')
  assert.ok(callSrc.includes('export async function runSessionCall') && callSrc.includes('client.openSessionCall'))

  const callPanelSrc = fs.readFileSync(path.join(ROOT, 'components/model/CallPanel.tsx'), 'utf8')
  for (const sym of ['Single call', 'Open session', 'Close & reclaim', 'Call from session', 'runSessionCall', 'findActiveBrowserSession']) {
    assert.ok(callPanelSrc.includes(sym), `CallPanel must include ${sym}`)
  }

  const accountViewSrc = fs.readFileSync(path.join(ROOT, 'components/account/AccountView.tsx'), 'utf8')
  for (const sym of ['Active sessions', 'Close & reclaim', 'loadAccountSessions', 'closeBrowserSession']) {
    assert.ok(accountViewSrc.includes(sym), `AccountView must include ${sym}`)
  }
})

test('Build 12 Step 2: revenue split validation, formatting, CLI command, API helpers, and ModelView/OwnerPanel UI wiring', async () => {
  assert.equal(SPLIT_LIMITS.maxRecipients, 8)
  assert.equal(SPLIT_LIMITS.totalBps, 10000)

  assert.equal(pctToBps('50'), 5000)
  assert.equal(pctToBps('33.33'), 3333)
  assert.equal(pctToBps('0'), null)
  assert.equal(pctToBps('100.01'), null)
  assert.equal(pctToBps('abc'), null)
  assert.equal(formatSplitPct(5000), '50%')
  assert.equal(formatSplitPct(3333), '33.33%')

  const w1 = Keypair.generate().publicKey.toBase58()
  const w2 = Keypair.generate().publicKey.toBase58()
  const w3 = Keypair.generate().publicKey.toBase58()

  const ok = validateSplitDraft([
    { wallet: w1, sharePct: '50' },
    { wallet: w2, sharePct: '30' },
    { wallet: w3, sharePct: '20' },
  ])
  assert.equal(ok.ok, true)
  if (ok.ok) {
    assert.equal(ok.totalBps, 10000)
    assert.deepEqual(ok.recipients, [
      { wallet: w1, shareBps: 5000 },
      { wallet: w2, shareBps: 3000 },
      { wallet: w3, shareBps: 2000 },
    ])
  }

  // Rejects bad sum, duplicate recipient, bad address, and > 8 recipients
  const badSum = validateSplitDraft([
    { wallet: w1, sharePct: '50' },
    { wallet: w2, sharePct: '40' },
  ])
  assert.equal(badSum.ok, false)
  if (!badSum.ok) assert.ok(badSum.error.includes('90%'))

  const dup = validateSplitDraft([
    { wallet: w1, sharePct: '50' },
    { wallet: w1, sharePct: '50' },
  ])
  assert.equal(dup.ok, false)

  const badAddr = validateSplitDraft([{ wallet: 'not-a-pubkey', sharePct: '100' }])
  assert.equal(badAddr.ok, false)

  const tooMany = validateSplitDraft(
    Array.from({ length: 9 }, () => ({ wallet: Keypair.generate().publicKey.toBase58(), sharePct: '11' })),
  )
  assert.equal(tooMany.ok, false)

  const sampleSplit = {
    address: Keypair.generate().publicKey.toBase58(),
    model: Keypair.generate().publicKey.toBase58(),
    authority: w1,
    mint: null,
    active: true,
    totalReceived: '10000000',
    recipients: [
      { wallet: w1, shareBps: 5000, accrued: '5000000', claimed: '2000000', claimable: '3000000' },
      { wallet: w2, shareBps: 3000, accrued: '3000000', claimed: '0', claimable: '3000000' },
      { wallet: w3, shareBps: 2000, accrued: '2000000', claimed: '2000000', claimable: '0' },
    ],
    updatedSlot: '420000',
  }
  assert.equal(totalUnclaimedLamports(sampleSplit), 6000000n)
  assert.deepEqual(splitToDraft(sampleSplit), [
    { wallet: w1, sharePct: '50' },
    { wallet: w2, sharePct: '30' },
    { wallet: w3, sharePct: '20' },
  ])
  assert.equal(
    splitEquals(sampleSplit, [
      { wallet: w1, shareBps: 5000 },
      { wallet: w2, shareBps: 3000 },
      { wallet: w3, shareBps: 2000 },
    ]),
    true,
  )
  assert.equal(
    splitEquals(sampleSplit, [
      { wallet: w1, shareBps: 6000 },
      { wallet: w2, shareBps: 4000 },
    ]),
    false,
  )
  assert.equal(
    splitSetCliCommand('sketch-32', [
      { wallet: w1, shareBps: 5000 },
      { wallet: w2, shareBps: 5000 },
    ]),
    `voynich model split set sketch-32 --recipient ${w1}:5000 --recipient ${w2}:5000`,
  )
  assert.equal(splitSetCliCommand('sketch-32', []), 'voynich model split set sketch-32 --clear')

  // loadModelSplit skips RPC when hasSplit === false and fetches when true
  let fetched = 0
  const mockClient = {
    modelSplit: async () => {
      fetched++
      return sampleSplit
    },
    setSplit: async (_m: string, body: { wallet: string; recipients: unknown[] }) => ({
      id: `set-${body.recipients.length}`,
      action: 'set_split' as const,
      transactionBase64: 'AAAA',
      blockhash: 'BH',
      lastValidBlockHeight: 100,
      cosigned: false,
      requiredSigners: [body.wallet],
      fixture: true,
      addresses: { split: sampleSplit.address },
    }),
    claimSplit: async (_m: string, body: { wallet: string; recipient?: string }) => ({
      id: `claim-${body.recipient ?? body.wallet}`,
      action: 'claim_split' as const,
      transactionBase64: 'AAAA',
      blockhash: 'BH',
      lastValidBlockHeight: 100,
      cosigned: false,
      requiredSigners: [body.wallet],
      fixture: true,
      addresses: { split: sampleSplit.address },
    }),
    submitTransaction: async (input: { buildId: string }) => ({ id: input.buildId, status: 'confirmed' as const }),
    transaction: async (id: string) => ({ id, status: 'confirmed' as const }),
  } as unknown as Parameters<typeof loadModelSplit>[0]

  assert.equal(await loadModelSplit(mockClient, { address: sampleSplit.model, hasSplit: false }), null)
  assert.equal(fetched, 0)
  const loaded = await loadModelSplit(mockClient, { address: sampleSplit.model, hasSplit: true })
  assert.equal(loaded?.address, sampleSplit.address)
  assert.equal(fetched, 1)

  const setRes = await setModelSplit(mockClient, sampleSplit.model, w1, [{ wallet: w1, shareBps: 10000 }])
  assert.equal(setRes.status, 'confirmed')
  const claimRes = await claimModelSplit(mockClient, sampleSplit.model, w1, w2)
  assert.equal(claimRes.status, 'confirmed')

  assert.ok(errorMessage({ body: { error: { code: 'SPLIT_NOT_FOUND' } } }).includes('revenue split'))
  assert.ok(errorMessage({ body: { error: { code: 'INVALID_SPLIT' } } }).includes('100%'))

  const pageSrc = fs.readFileSync(path.join(ROOT, 'app/models/[id]/page.tsx'), 'utf8')
  assert.ok(pageSrc.includes('loadModelSplit') && pageSrc.includes('split'))

  const modelViewSrc = fs.readFileSync(path.join(ROOT, 'components/model/ModelView.tsx'), 'utf8')
  for (const sym of ['Revenue split', 'claimModelSplit', 'formatSplitPct', 'Unclaimed', 'Claim', 'loadModelSplit']) {
    assert.ok(modelViewSrc.includes(sym), `ModelView must include ${sym}`)
  }

  const ownerPanelSrc = fs.readFileSync(path.join(ROOT, 'components/model/OwnerPanel.tsx'), 'utf8')
  for (const sym of ['Revenue split', 'Save split', 'Clear split', 'Add recipient', 'splitSetCliCommand', 'client.setSplit']) {
    assert.ok(ownerPanelSrc.includes(sym), `OwnerPanel must include ${sym}`)
  }
})

test('Build 13 Step 2: operator bond helpers, uptime calculation, CLI command, error mapping, and /enclaves + /models/[id] UI wiring', async () => {
  assert.equal(DEFAULT_BOND_SLASH_BPS, 1000)

  assert.equal(formatBondSol(null), 'Unbonded')
  assert.equal(formatBondSol(undefined), 'Unbonded')
  assert.equal(formatBondSol('0'), 'Unbonded')
  assert.equal(formatBondSol('100000000'), '0.1 SOL')
  assert.equal(formatBondSol('1250000000'), '1.25 SOL')

  assert.equal(computeUptimePct('0', '0'), '100%')
  assert.equal(computeUptimePct('42', '0'), '100%')
  assert.equal(computeUptimePct('9', '1'), '90%')
  assert.equal(computeUptimePct('199', '1'), '99.5%')

  const enclaveKey = Keypair.generate().publicKey.toBase58()
  assert.equal(bondCliCommand('show', enclaveKey), `voynich enclave bond show ${enclaveKey}`)
  assert.equal(bondCliCommand('deposit', enclaveKey, '200000000'), `voynich enclave bond deposit 200000000 --enclave ${enclaveKey}`)
  assert.equal(bondCliCommand('withdraw', enclaveKey, '50000000'), `voynich enclave bond withdraw 50000000 --enclave ${enclaveKey}`)

  const sampleBond = {
    address: Keypair.generate().publicKey.toBase58(),
    enclave: enclaveKey,
    operator: Keypair.generate().publicKey.toBase58(),
    bondedLamports: '100000000',
    slashedTotal: '1000000',
    missedCalls: '1',
    slashBps: 1000,
    updatedSlot: '473800000',
  }
  const okClient = {
    enclaveBond: async () => sampleBond,
  } as unknown as Parameters<typeof loadEnclaveBond>[0]
  const missingClient = {
    enclaveBond: async () => { throw { status: 404, code: 'BOND_NOT_FOUND' } },
  } as unknown as Parameters<typeof loadEnclaveBond>[0]

  assert.deepEqual(await loadEnclaveBond(okClient, enclaveKey), sampleBond)
  assert.equal(await loadEnclaveBond(missingClient, enclaveKey), null)

  assert.ok(errorMessage({ body: { error: { code: 'BOND_NOT_FOUND' } } }).includes('bond'))
  assert.ok(errorMessage({ body: { error: { code: 'INVALID_BOND' } } }).includes('Bond amount'))

  const enclavesPageSrc = fs.readFileSync(path.join(ROOT, 'app/enclaves/page.tsx'), 'utf8')
  for (const sym of ['Bonded SOL', 'Uptime', 'formatBondSol', 'computeUptimePct', 'missed']) {
    assert.ok(enclavesPageSrc.includes(sym), `/enclaves must include ${sym}`)
  }

  const enclaveDetailSrc = fs.readFileSync(path.join(ROOT, 'app/enclaves/[key]/page.tsx'), 'utf8')
  for (const sym of ['Operator bond', 'Timeout slash', 'Slashed total', 'Missed calls', 'loadEnclaveBond', 'bondCliCommand']) {
    assert.ok(enclaveDetailSrc.includes(sym), `/enclaves/[key] must include ${sym}`)
  }

  const modelViewSrc = fs.readFileSync(path.join(ROOT, 'components/model/ModelView.tsx'), 'utf8')
  for (const sym of ['formatBondSol', 'computeUptimePct', 'Bond &amp; uptime']) {
    assert.ok(modelViewSrc.includes(sym), `ModelView must include ${sym}`)
  }
})

test('Build 14 Step 2: benchmark helpers, CLI hint, error mapping, /benchmarks leaderboard, and /models/[id] Benchmarks wiring', async () => {
  assert.equal(formatScorePct(10000), '100%')
  assert.equal(formatScorePct(9250), '92.5%')
  assert.equal(formatScorePct(8733), '87.33%')
  assert.equal(benchmarkRunCliCommand('sketch-32'), 'voynich benchmark run sketch-32 --suite eval-suite.json')
  assert.equal(benchmarkRunCliCommand('text-1m', 'suite.json'), 'voynich benchmark run text-1m --suite suite.json')

  const modelAddr = Keypair.generate().publicKey.toBase58()
  const r1 = Keypair.generate().publicKey.toBase58()
  const r2 = Keypair.generate().publicKey.toBase58()
  const sampleBench = {
    address: Keypair.generate().publicKey.toBase58(),
    model: modelAddr,
    modelName: 'sketch-32',
    publisher: Keypair.generate().publicKey.toBase58(),
    name: 'quickdraw-4',
    modelVersion: 1,
    datasetSha256: 'aa'.repeat(32),
    datasetUri: 'https://voynich.dev/eval/sketch-32.json',
    sampleCount: 4,
    passedCount: 4,
    scoreBps: 10000,
    receipts: [r1, r2],
    publishedSlot: '474000000',
  }
  const page = { items: [sampleBench], page: { nextCursor: null, hasMore: false }, asOf: '2026-11-26T00:00:00Z' }
  const okClient = {
    benchmarks: async () => page,
    modelBenchmarks: async () => page,
  } as unknown as Parameters<typeof loadBenchmarks>[0]
  const failClient = {
    benchmarks: async () => { throw new Error('offline') },
    modelBenchmarks: async () => { throw new Error('offline') },
  } as unknown as Parameters<typeof loadBenchmarks>[0]

  assert.deepEqual(await loadBenchmarks(okClient), page)
  assert.equal(await loadBenchmarks(failClient), null)
  assert.deepEqual(await loadModelBenchmarks(okClient, modelAddr), [sampleBench])
  assert.deepEqual(await loadModelBenchmarks(failClient, modelAddr), [])

  assert.ok(errorMessage({ body: { error: { code: 'BENCHMARK_NOT_FOUND' } } }).includes('benchmark'))
  assert.ok(errorMessage({ body: { error: { code: 'INVALID_BENCHMARK' } } }).includes('receipts'))

  assert.ok(PLACES.some((p) => p.href === '/benchmarks' && p.label === 'Benchmarks'))
  const sitemapEntries = sitemapMod.default()
  assert.ok(sitemapEntries.some((e) => e.url.endsWith('/benchmarks')))

  const footerSrc = fs.readFileSync(path.join(ROOT, 'components/nav/Footer.tsx'), 'utf8')
  assert.ok(footerSrc.includes("href: '/benchmarks'"))

  const benchPageSrc = fs.readFileSync(path.join(ROOT, 'app/benchmarks/page.tsx'), 'utf8')
  for (const sym of ['Benchmarks', 'formatScorePct', 'benchmarkRunCliCommand', '/receipts/', 'datasetSha256']) {
    assert.ok(benchPageSrc.includes(sym), `/benchmarks page must include ${sym}`)
  }

  const modelPageSrc = fs.readFileSync(path.join(ROOT, 'app/models/[id]/page.tsx'), 'utf8')
  assert.ok(modelPageSrc.includes('loadModelBenchmarks') && modelPageSrc.includes('benchmarks'))

  const modelViewSrc = fs.readFileSync(path.join(ROOT, 'components/model/ModelView.tsx'), 'utf8')
  for (const sym of ['Benchmarks', 'formatScorePct', 'benchmarkRunCliCommand', 'loadModelBenchmarks', '/receipts/']) {
    assert.ok(modelViewSrc.includes(sym), `ModelView must include ${sym}`)
  }
})

test('Build 15 Step 2: prepaid pass helpers, savings %, CLI hint, error mapping, openPassCall, and UI wiring', async () => {
  assert.equal(computePassSavingsPct('10000000', '8000000'), 20)
  assert.equal(computePassSavingsPct('10000000', '10000000'), 0)
  assert.equal(computePassSavingsPct('0', '8000000'), 0)

  assert.equal(
    passPlanCliCommand('sketch-32', { pricePerCall: '8000000', minCalls: 5, maxCalls: 100, ttlSlots: '216000', active: true }),
    'voynich pass plan set sketch-32 --price 8000000 --min-calls 5 --max-calls 100 --ttl-slots 216000',
  )
  assert.equal(
    passPlanCliCommand('sketch-32', { pricePerCall: '8000000', minCalls: 5, maxCalls: 100, ttlSlots: '216000', active: false }),
    'voynich pass plan set sketch-32 --price 8000000 --min-calls 5 --max-calls 100 --ttl-slots 216000 --inactive',
  )

  const modelAddr = Keypair.generate().publicKey.toBase58()
  const holder = Keypair.generate().publicKey.toBase58()
  const passAddr = Keypair.generate().publicKey.toBase58()
  const samplePlan = {
    address: Keypair.generate().publicKey.toBase58(),
    model: modelAddr,
    modelName: 'sketch-32',
    authority: holder,
    mint: null,
    pricePerCall: '8000000',
    minCalls: 5,
    maxCalls: 100,
    ttlSlots: '216000',
    active: true,
    updatedSlot: '474500000',
  }
  const samplePass = {
    address: passAddr,
    model: modelAddr,
    modelName: 'sketch-32',
    holder,
    nonce: '1',
    mint: null,
    pricePerCall: '8000000',
    callsTotal: 5,
    callsUsed: 2,
    callsRemaining: 3,
    escrowRemaining: '24000000',
    returnedAmount: '0',
    purchasedSlot: '474500010',
    expiresAtSlot: '474716010',
    closedSlot: null,
    status: 'open' as const,
  }

  assert.equal(findActiveModelPass([samplePass], modelAddr)?.address, passAddr)
  assert.equal(findActiveModelPass([{ ...samplePass, status: 'closed' as const }], modelAddr), null)
  assert.equal(findActiveModelPass([{ ...samplePass, callsRemaining: 0 }], modelAddr), null)

  const mockClient = {
    modelPassPlan: async () => samplePlan,
    accountPasses: async () => ({ items: [samplePass], page: { nextCursor: null, hasMore: false }, asOf: '2026-11-26T10:00:00Z' }),
    setPassPlan: async () => ({ id: 'plan-1', action: 'set_pass_plan' as const, transactionBase64: 'AAAA', blockhash: 'BH', lastValidBlockHeight: 100, cosigned: false, requiredSigners: [holder], fixture: true, addresses: {} }),
    buyPass: async () => ({ id: 'buy-1', action: 'buy_pass' as const, transactionBase64: 'AAAA', blockhash: 'BH', lastValidBlockHeight: 100, cosigned: false, requiredSigners: [holder], fixture: true, addresses: { pass: passAddr } }),
    closePass: async () => ({ id: 'close-1', action: 'close_pass' as const, transactionBase64: 'AAAA', blockhash: 'BH', lastValidBlockHeight: 100, cosigned: false, requiredSigners: [holder], fixture: true, addresses: { pass: passAddr } }),
    submitTransaction: async (input: { buildId: string }) => ({ id: input.buildId, status: 'confirmed' as const }),
    transaction: async (id: string) => ({ id, status: 'confirmed' as const }),
  } as unknown as Parameters<typeof loadModelPassPlan>[0]

  assert.equal((await loadModelPassPlan(mockClient, modelAddr))?.address, samplePlan.address)
  assert.equal((await loadAccountPasses(mockClient, holder)).length, 1)
  assert.equal((await setModelPassPlan(mockClient, modelAddr, { wallet: holder, pricePerCall: '8000000', minCalls: 5, maxCalls: 100, ttlSlots: '216000', active: true })).status, 'confirmed')
  assert.equal((await buyModelPass(mockClient, { wallet: holder, model: modelAddr, callsTotal: 5 })).status, 'confirmed')
  assert.equal((await closeModelPass(mockClient, { wallet: holder, pass: passAddr })).status, 'confirmed')

  assert.ok(errorMessage({ body: { error: { code: 'PASS_PLAN_NOT_FOUND' } } }).includes('pass plan'))
  assert.ok(errorMessage({ body: { error: { code: 'PASS_NOT_FOUND' } } }).includes('prepaid pass'))
  assert.ok(errorMessage({ body: { error: { code: 'INVALID_PASS' } } }).includes('pass plan'))

  const callSrc = fs.readFileSync(path.join(ROOT, 'lib/call.ts'), 'utf8')
  assert.ok(callSrc.includes('pass?: string | null') && callSrc.includes('client.openPassCall'))

  const modelPageSrc = fs.readFileSync(path.join(ROOT, 'app/models/[id]/page.tsx'), 'utf8')
  assert.ok(modelPageSrc.includes('loadModelPassPlan') && modelPageSrc.includes('passPlan'))

  const modelViewSrc = fs.readFileSync(path.join(ROOT, 'components/model/ModelView.tsx'), 'utf8')
  for (const sym of ['Call passes', 'Buy pass', 'computePassSavingsPct', 'buyModelPass', 'activePass']) {
    assert.ok(modelViewSrc.includes(sym), `ModelView must include ${sym}`)
  }

  const callPanelSrc = fs.readFileSync(path.join(ROOT, 'components/model/CallPanel.tsx'), 'utf8')
  for (const sym of ['Use pass', 'Call with pass', 'activePass', 'pass: activePass.address']) {
    assert.ok(callPanelSrc.includes(sym), `CallPanel must include ${sym}`)
  }

  const ownerPanelSrc = fs.readFileSync(path.join(ROOT, 'components/model/OwnerPanel.tsx'), 'utf8')
  for (const sym of ['Call pass plan', 'Save pass plan', 'passPlanCliCommand', 'client.setPassPlan']) {
    assert.ok(ownerPanelSrc.includes(sym), `OwnerPanel must include ${sym}`)
  }

  const accountViewSrc = fs.readFileSync(path.join(ROOT, 'components/account/AccountView.tsx'), 'utf8')
  for (const sym of ['id="passes"', 'loadAccountPasses', 'closeModelPass', 'Close & reclaim']) {
    assert.ok(accountViewSrc.includes(sym), `AccountView must include ${sym}`)
  }
})

test('Build 16 Step 2: referral share helpers, ?ref= parsing, CLI hint, error mapping, and UI wiring', async () => {
  assert.equal(MAX_REFERRAL_SHARE_BPS, 2500)
  assert.equal(formatReferralShare(500), '5%')
  assert.equal(formatReferralBalance('15000000'), '0.015 SOL')

  const modelAddr = Keypair.generate().publicKey.toBase58()
  const refWallet = Keypair.generate().publicKey.toBase58()
  const refAddr = Keypair.generate().publicKey.toBase58()

  assert.equal(parseReferralFromParams({ ref: refWallet }), refWallet)
  assert.equal(parseReferralFromParams({ ref: 'not-a-pubkey' }), null)
  assert.equal(parseReferralFromParams(new URLSearchParams(`ref=${refWallet}`)), refWallet)
  assert.equal(buildReferralLink('https://voynich.dev/', 'sketch-32', refWallet), `https://voynich.dev/models/sketch-32?ref=${refWallet}`)
  assert.equal(referralSetCliCommand('sketch-32', 500, true), 'voynich model referral set sketch-32 --share-bps 500')
  assert.equal(referralSetCliCommand('sketch-32', 500, false), 'voynich model referral set sketch-32 --share-bps 500 --inactive')

  const sampleCfg = {
    address: Keypair.generate().publicKey.toBase58(),
    model: modelAddr,
    modelName: 'sketch-32',
    shareBps: 500,
    active: true,
    updatedSlot: '475000000',
  }
  const sampleRef = {
    address: refAddr,
    model: modelAddr,
    modelName: 'sketch-32',
    referrer: refWallet,
    mint: null,
    totalEarned: '2000000',
    claimed: '500000',
    claimable: '1500000',
    callsReferred: '4',
    updatedSlot: '475000100',
  }
  const mockClient = {
    modelReferral: async () => sampleCfg,
    accountReferrals: async () => ({ items: [sampleRef], asOf: '2026-11-26T19:00:00Z' }),
    setReferralConfig: async () => ({ id: 'ref-cfg-1', action: 'set_referral_config' as const, transactionBase64: 'AAAA', blockhash: 'BH', lastValidBlockHeight: 100, cosigned: false, requiredSigners: [refWallet], fixture: true, addresses: {} }),
    claimReferral: async () => ({ id: 'ref-claim-1', action: 'claim_referral' as const, transactionBase64: 'AAAA', blockhash: 'BH', lastValidBlockHeight: 100, cosigned: false, requiredSigners: [refWallet], fixture: true, addresses: {} }),
    submitTransaction: async (input: { buildId: string }) => ({ id: input.buildId, status: 'confirmed' as const }),
    transaction: async (id: string) => ({ id, status: 'confirmed' as const }),
  } as unknown as Parameters<typeof loadModelReferralConfig>[0]

  assert.equal((await loadModelReferralConfig(mockClient, modelAddr))?.shareBps, 500)
  assert.equal((await loadAccountReferrals(mockClient, refWallet)).length, 1)
  assert.equal((await setModelReferralConfig(mockClient, modelAddr, { wallet: refWallet, shareBps: 500, active: true })).status, 'confirmed')
  assert.equal((await claimModelReferral(mockClient, modelAddr, { wallet: refWallet, referrer: refWallet })).status, 'confirmed')

  assert.ok(errorMessage({ body: { error: { code: 'REFERRAL_CONFIG_NOT_FOUND' } } }).includes('referral share'))
  assert.ok(errorMessage({ body: { error: { code: 'REFERRAL_NOT_FOUND' } } }).includes('referral'))
  assert.ok(errorMessage({ body: { error: { code: 'INVALID_REFERRAL' } } }).includes('25%'))

  const callSrc = fs.readFileSync(path.join(ROOT, 'lib/call.ts'), 'utf8')
  assert.ok(callSrc.includes('referrer?: string | null') && callSrc.includes('referrer: o.referrer'))

  const modelPageSrc = fs.readFileSync(path.join(ROOT, 'app/models/[id]/page.tsx'), 'utf8')
  assert.ok(modelPageSrc.includes('loadModelReferralConfig') && modelPageSrc.includes('parseReferralFromParams'))

  const modelViewSrc = fs.readFileSync(path.join(ROOT, 'components/model/ModelView.tsx'), 'utf8')
  for (const sym of ['Referral share', 'Copy referral link', 'buildReferralLink', 'effectiveReferrer']) {
    assert.ok(modelViewSrc.includes(sym), `ModelView must include ${sym}`)
  }

  const callPanelSrc = fs.readFileSync(path.join(ROOT, 'components/model/CallPanel.tsx'), 'utf8')
  assert.ok(callPanelSrc.includes('Referred by') && callPanelSrc.includes('referralShareBps'))

  const ownerPanelSrc = fs.readFileSync(path.join(ROOT, 'components/model/OwnerPanel.tsx'), 'utf8')
  for (const sym of ['Referral share', 'Save referral share', 'referralSetCliCommand', 'client.setReferralConfig']) {
    assert.ok(ownerPanelSrc.includes(sym), `OwnerPanel must include ${sym}`)
  }

  const accountViewSrc = fs.readFileSync(path.join(ROOT, 'components/account/AccountView.tsx'), 'utf8')
  for (const sym of ['id="referrals"', 'loadAccountReferrals', 'claimModelReferral', 'Claimable']) {
    assert.ok(accountViewSrc.includes(sym), `AccountView must include ${sym}`)
  }
})
