import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { Keypair, PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js'
import {
  BN, addresses, chainPrograms,
  decodeCallAccount, decodeConfigAccount, decodeReceiptAccount, normalizeLegacyVoynichEvent,
} from 'voynich/program'
import { fromBase64, sha256, toBase64, toHex, utf8 } from 'voynich/crypto'
import * as enclaveMod from '../enclave/src/runtime.js'
import * as setupMod from '../scripts/setup.js'
import * as crankMod from '../src/chain/crank.js'
import * as runtimeMod from '../src/runtime.js'
import { builders } from '../src/chain/builders.js'
import { quoteModelCost } from '../src/chain/cost-quote.js'
import { buildChainApp } from '../src/chain/app.js'
import type { ChainRuntime } from '../src/runtime.js'

test('Blocking #4: enclave listen config respects Railway PORT and host defaults', () => {
  const listenConfig = (enclaveMod as Record<string, unknown>).enclaveListenConfig as
    | ((env: Record<string, string | undefined>) => { port: number; host: string })
    | undefined
  assert.equal(typeof listenConfig, 'function', 'enclaveListenConfig must be exported from enclave/src/runtime.ts')
  assert.deepEqual(listenConfig!({ PORT: '8080', ENCLAVE_PORT: '9707' }), { port: 8080, host: '0.0.0.0' })
  assert.deepEqual(listenConfig!({ PORT: '8080', ENCLAVE_HOST: '127.0.0.1' }), { port: 8080, host: '127.0.0.1' })
  assert.deepEqual(listenConfig!({ ENCLAVE_PORT: '9708' }), { port: 9708, host: '127.0.0.1' })
})

test('Blocking #5: crank readKey accepts inline JSON keypair arrays and file paths', () => {
  const readKey = (crankMod as Record<string, unknown>).readKey as
    | ((value: string | undefined, name: string) => Keypair)
    | undefined
  assert.equal(typeof readKey, 'function', 'readKey must be exported from src/chain/crank.ts')
  const expected = Keypair.generate()
  const inline = JSON.stringify(Array.from(expected.secretKey))
  assert.equal(readKey!(inline, 'KEEPER_KEYPAIR').publicKey.toBase58(), expected.publicKey.toBase58())

  const dir = mkdtempSync(join(tmpdir(), 'voynich-crank-key-'))
  try {
    const file = join(dir, 'keeper.json')
    writeFileSync(file, inline)
    assert.equal(readKey!(file, 'KEEPER_KEYPAIR').publicKey.toBase58(), expected.publicKey.toBase58())
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  assert.throws(() => readKey!('[1,2,3]', 'KEEPER_KEYPAIR'))
})

test('Blocking #6: readiness probe checks voynich Config PDA and config.attestationProgram without attestConfig', async () => {
  const probeVoynichReady = (runtimeMod as Record<string, unknown>).probeVoynichReady as
    | ((deps: {
        connection: { getMultipleAccountsInfo: (...args: unknown[]) => Promise<unknown[]>; getAccountInfo: (...args: unknown[]) => Promise<unknown> }
        voynich: { coder: { accounts: { decode: (name: string, data: Buffer) => { attestationProgram: PublicKey } } } }
        programId: PublicKey
        configAddress: PublicKey
      }) => Promise<boolean>)
    | undefined
  assert.equal(typeof probeVoynichReady, 'function', 'probeVoynichReady must be exported from src/runtime.ts')

  const programId = Keypair.generate().publicKey
  const verifier = Keypair.generate().publicKey
  const configAddress = addresses(programId).config
  let singleReads = 0
  let batchReads = 0

  const ready = await probeVoynichReady!({
    programId,
    configAddress,
    voynich: { coder: { accounts: { decode: () => ({ attestationProgram: verifier }) } } },
    connection: {
      getMultipleAccountsInfo: async (keys: unknown[]) => {
        batchReads++
        assert.equal((keys as PublicKey[]).length, 2, 'must only read voynich program and config PDA')
        return [{ executable: true, owner: SystemProgram.programId }, { executable: false, owner: programId, data: Buffer.alloc(116) }]
      },
      getAccountInfo: async (key: unknown) => {
        singleReads++
        assert.equal((key as PublicKey).toBase58(), verifier.toBase58())
        return { executable: true }
      },
    },
  })
  assert.equal(ready, true, 'must be ready when voynich Config names an executable verifier with no attestConfig PDA')
  assert.equal(batchReads, 1)
  assert.equal(singleReads, 1)

  let uninitSingleReads = 0
  const uninitialized = await probeVoynichReady!({
    programId,
    configAddress,
    voynich: { coder: { accounts: { decode: () => ({ attestationProgram: verifier }) } } },
    connection: {
      getMultipleAccountsInfo: async () => [{ executable: true, owner: SystemProgram.programId }, null],
      getAccountInfo: async () => { uninitSingleReads++; return null },
    },
  })
  assert.equal(uninitialized, false)
  assert.equal(uninitSingleReads, 0, 'must spend only 1 RPC call while config PDA is absent')

  const nonExecVerifier = await probeVoynichReady!({
    programId,
    configAddress,
    voynich: { coder: { accounts: { decode: () => ({ attestationProgram: verifier }) } } },
    connection: {
      getMultipleAccountsInfo: async () => [{ executable: true, owner: SystemProgram.programId }, { executable: false, owner: programId, data: Buffer.alloc(116) }],
      getAccountInfo: async () => ({ executable: false }),
    },
  })
  assert.equal(nonExecVerifier, false)
})

test('Promoted Backlog: SPL refund prepends idempotent caller ATA creation when missing', async () => {
  const programId = Keypair.generate().publicKey
  const mint = Keypair.generate().publicKey
  const caller = Keypair.generate().publicKey
  const model = Keypair.generate().publicKey
  const call = Keypair.generate().publicKey
  const actor = Keypair.generate().publicKey

  const callData = Buffer.alloc(303)
  Buffer.from(sha256(utf8('account:Call')).subarray(0, 8)).copy(callData, 0)
  caller.toBuffer().copy(callData, 8)
  model.toBuffer().copy(callData, 40)
  mint.toBuffer().copy(callData, 152)

  let builtInstructions: TransactionInstruction[] = []
  let builtRequiredLamports = 0n
  const fakeRuntime = {
    programId,
    addresses: addresses(programId),
    env: {},
    db: {
      transaction: { create: async () => {} },
    },
    rpc: {
      connection: {
        getAccountInfo: async (key: PublicKey) => (key.equals(call) ? { data: callData, owner: programId } : null),
        getMinimumBalanceForRentExemption: async () => 2_039_280,
        getLatestBlockhashAndContext: async () => ({ context: { slot: 1 }, value: { blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 100 } }),
        simulateTransaction: async () => ({ value: { err: null, unitsConsumed: 10_000 } }),
        getFeeForMessage: async () => ({ value: 5000 }),
      },
    },
    programs: {
      voynich: {
        account: {
          call: { fetchNullable: async () => ({ caller, model, priceMint: mint }) },
        },
        methods: {
          refundCall: () => ({
            accountsStrict: () => ({
              instruction: async () => new TransactionInstruction({ programId, keys: [{ pubkey: actor, isSigner: true, isWritable: false }], data: Buffer.from([1]) }),
            }),
          }),
        },
      },
    },
  } as unknown as ChainRuntime

  const b = builders(fakeRuntime)
  // Intercept ledger.build to inspect exact instructions and requiredLamports without a real RPC simulator.
  ;(b.ledger as unknown as { build: (...args: unknown[]) => Promise<unknown> }).build = async (
    _action: unknown,
    _wallet: unknown,
    instructions: TransactionInstruction[],
    _addresses: unknown,
    requiredLamports = 0n,
  ) => {
    builtInstructions = instructions
    builtRequiredLamports = requiredLamports as bigint
    return { id: 'stub' }
  }

  await b.refund(call.toBase58(), { wallet: actor.toBase58() })
  assert.equal(builtInstructions.length, 2, 'SPL refund with missing caller ATA must prepend createAssociatedTokenAccountIdempotentInstruction')
  assert.equal(builtInstructions[0]!.programId.toBase58(), ASSOCIATED_TOKEN_PROGRAM_ID.toBase58())
  assert.equal(builtRequiredLamports, 2_039_280n)
})

test('Promoted Backlog: enclave acceptInput triggers coalesced loadGrants() once for unloaded model', async () => {
  const { EnclaveRuntime } = enclaveMod
  const programId = Keypair.generate().publicKey
  const enclaveKey = Keypair.generate().publicKey
  const modelKey = Keypair.generate().publicKey
  const call1 = Keypair.generate().publicKey
  const call2 = Keypair.generate().publicKey
  const envelopeBytes = Uint8Array.from([1, ...new Uint8Array(104)])
  const envelope = toBase64(envelopeBytes)
  const inputHash = [...sha256(envelopeBytes)]

  const callData = Buffer.alloc(303)
  Buffer.from(sha256(utf8('account:Call')).subarray(0, 8)).copy(callData, 0)
  modelKey.toBuffer().copy(callData, 40)
  enclaveKey.toBuffer().copy(callData, 72)
  Buffer.from(inputHash).copy(callData, 112)
  callData.writeBigUInt64LE(100n, 292)
  callData[300] = 0

  const makeRuntime = (loadsModel: boolean) => {
    let loadGrantsCalls = 0
    let startAnswerCalls = 0
    const rt = Object.create(EnclaveRuntime.prototype) as InstanceType<typeof EnclaveRuntime> & {
      grantsLoading?: Promise<unknown>
      loadGrants: () => Promise<unknown[]>
      startAnswer: () => void
    }
    Object.assign(rt, {
      programId,
      enclave: enclaveKey,
      loaded: new Map(),
      inFlight: new Map(),
      state: { version: 1, signingSeed: '', encryptionSecret: '', chain: null, grants: {}, answers: {}, inputHashes: {}, inputs: {}, pending: {} },
      rpc: {
        connection: {
          getSlot: async () => 10,
          getAccountInfo: async () => ({ data: callData, owner: programId }),
        },
      },
      programs: {
        voynich: {
          programId,
          account: {
            call: {
              fetchNullable: async () => ({ enclave: enclaveKey, model: modelKey, inputHash, status: { open: {} }, deadlineSlot: new BN(100) }),
            },
          },
        },
      },
      save: () => {},
      region: null,
      fetchModelPolicy: async () => null,
      startAnswer: () => { startAnswerCalls++ },
      loadGrants: async () => {
        loadGrantsCalls++
        await new Promise((r) => setTimeout(r, 20))
        if (loadsModel) rt.loaded.set(modelKey.toBase58(), {} as never)
        return []
      },
    })
    return { rt, counts: () => ({ loadGrantsCalls, startAnswerCalls }) }
  }

  // Case 1: grant exists on chain and loadGrants() loads the model -> coalesced once and answers.
  const granted = makeRuntime(true)
  await Promise.all([granted.rt.acceptInput(call1, envelope), granted.rt.acceptInput(call2, envelope)])
  assert.deepEqual(granted.counts(), { loadGrantsCalls: 1, startAnswerCalls: 2 })

  // Case 2: model still unloaded after loadGrants() -> rejects cleanly with GRANT_REQUIRED instead of failing background answer.
  const ungranted = makeRuntime(false)
  await assert.rejects(
    () => ungranted.rt.acceptInput(call1, envelope),
    (err: unknown) => (err as { body?: { error?: { code?: string } } })?.body?.error?.code === 'GRANT_REQUIRED',
  )
  assert.deepEqual(ungranted.counts(), { loadGrantsCalls: 1, startAnswerCalls: 0 })
})

test('Promoted Backlog: quoteModelCost does not double-count uploadKeyMinimumLamports in requiredUpfrontLamports', async () => {
  const fakeRuntime = {
    programId: Keypair.generate().publicKey,
    addresses: addresses(Keypair.generate().publicKey),
    env: {},
    programs: chainPrograms({} as never),
    rpc: {
      connection: {
        getLatestBlockhashAndContext: async () => ({ context: { slot: 50 }, value: { blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 200 } }),
        getMinimumBalanceForRentExemption: async (space: number) => (space === 0 ? 890_880 : space * 6960),
        getFeeForMessage: async () => ({ value: 5_000 }),
      },
    },
  } as unknown as ChainRuntime

  const quote = await quoteModelCost(fakeRuntime, { sizeBytes: 252_145 })
  assert.equal(
    BigInt(quote.requiredUpfrontLamports),
    BigInt(quote.estimatedCostLamports) + BigInt(quote.returnedUploadReserveLamports),
  )
})

test('Promoted Backlog: buildChainApp enforces writeLimit on public quote, build, and submit routes', async () => {
  const fakeRuntime = {
    programId: Keypair.generate().publicKey,
    attestationProgramId: Keypair.generate().publicKey,
    addresses: addresses(Keypair.generate().publicKey),
    env: { CORS_ORIGINS: [], CLUSTER: 'localnet', PUBLIC_API_URL: 'http://127.0.0.1:9702' },
    readiness: { status: () => 'ready' },
    readModel: { stats: async () => ({}), models: async () => ({ items: [] }) },
    hub: {},
    db: {},
    rpc: { connection: {} },
    programs: chainPrograms({} as never),
  } as unknown as ChainRuntime

  const app = buildChainApp(fakeRuntime)
  let limitedStatus: number | undefined
  let limitedCode: string | undefined
  for (let i = 0; i < 65; i++) {
    const res = await app.request('http://127.0.0.1:9702/v1/models/quote', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.10' },
      body: '{}',
    })
    if (res.status === 429) {
      limitedStatus = res.status
      limitedCode = ((await res.json()) as { error: { code: string } }).error.code
      assert.ok(res.headers.get('Retry-After'), '429 response must include Retry-After')
      break
    }
  }
  assert.equal(limitedStatus, 429, 'POST /v1/models/quote must be rate-limited')
  assert.equal(limitedCode, 'RATE_LIMITED')

  let buildLimited: number | undefined
  for (let i = 0; i < 65; i++) {
    const res = await app.request('http://127.0.0.1:9702/v1/calls/build', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.11' },
      body: '{}',
    })
    if (res.status === 429) {
      buildLimited = res.status
      break
    }
  }
  assert.equal(buildLimited, 429, 'POST /v1/calls/build must be rate-limited')

  let submitLimited: number | undefined
  for (let i = 0; i < 2100; i++) {
    const res = await app.request('http://127.0.0.1:9702/v1/transactions/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.12' },
      body: '{}',
    })
    if (res.status === 429) {
      submitLimited = res.status
      break
    }
  }
  assert.equal(submitLimited, 429, 'POST /v1/transactions/submit must be rate-limited while allowing 1k+ chunk uploads per seal')
})

test('Waiting-mode enclave serves 200 waiting health, returns retryable 502 UPSTREAM_UNAVAILABLE, and transitions on probeCanBoot', async () => {
  const enclaveKey = Keypair.generate().publicKey
  const callKey = Keypair.generate().publicKey
  const configKey = Keypair.generate().publicKey
  const attestConfigKey = Keypair.generate().publicKey
  const programKey = Keypair.generate().publicKey
  const operatorKey = Keypair.generate().publicKey

  let ready = false
  let accepted = 0
  const fakeRuntime = {
    enclave: enclaveKey,
    softwareMeasurement: 'ab'.repeat(48),
    loaded: new Map<string, never>(),
    async acceptInput() { accepted++ },
    async getAnswer() {
      return {
        status: 'waiting' as const,
        outputEnvelope: null,
        outputHash: null,
        signature: null,
        settleTransaction: null,
        receiptAddress: null,
        failure: null,
      }
    },
  }

  const app = enclaveMod.createEnclaveApp(fakeRuntime, () => ready)

  const waitHealth = await app.request('http://127.0.0.1:9707/health')
  assert.equal(waitHealth.status, 200)
  assert.deepEqual(await waitHealth.json(), {
    status: 'waiting',
    enclave: enclaveKey.toBase58(),
    measurement: 'ab'.repeat(48),
    region: null,
    models: [],
    openWeightsSeconds: {},
    grantToFirstAnswerSeconds: {},
    bases: {},
  })

  const inputWhileWaiting = await app.request(`http://127.0.0.1:9707/v1/calls/${callKey.toBase58()}/input`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ envelope: toBase64(Uint8Array.from([1, 2, 3])) }),
  })
  assert.equal(inputWhileWaiting.status, 502)
  const inputErr = await inputWhileWaiting.json() as { error: { code: string; retryable: boolean } }
  assert.equal(inputErr.error.code, 'UPSTREAM_UNAVAILABLE')
  assert.equal(inputErr.error.retryable, true)
  assert.equal(accepted, 0)

  const answerWhileWaiting = await app.request(`http://127.0.0.1:9707/v1/calls/${callKey.toBase58()}/answer`)
  assert.equal(answerWhileWaiting.status, 502)
  const answerErr = await answerWhileWaiting.json() as { error: { code: string; retryable: boolean } }
  assert.equal(answerErr.error.code, 'UPSTREAM_UNAVAILABLE')
  assert.equal(answerErr.error.retryable, true)

  ready = true
  const readyHealth = await app.request('http://127.0.0.1:9707/health')
  assert.equal(readyHealth.status, 200)
  assert.equal(((await readyHealth.json()) as { status: string }).status, 'ready')

  let requestedKeys: string[] = []
  let mockAccounts: Array<{ executable?: boolean; lamports?: number } | null> = [null, null, null, null]
  const probeHost = {
    programs: { voynich: { programId: programKey } },
    pda: { config: configKey, attestConfig: attestConfigKey },
    operator: { publicKey: operatorKey },
    rpc: {
      connection: {
        async getMultipleAccountsInfo(keys: PublicKey[], commitment: string) {
          assert.equal(commitment, 'confirmed')
          requestedKeys = keys.map(k => k.toBase58())
          return mockAccounts
        },
      },
    },
  }

  assert.equal(await enclaveMod.EnclaveRuntime.prototype.probeCanBoot.call(probeHost), false)
  assert.deepEqual(requestedKeys, [
    programKey.toBase58(),
    configKey.toBase58(),
    attestConfigKey.toBase58(),
    operatorKey.toBase58(),
  ])

  mockAccounts = [{ executable: true }, { executable: false }, { executable: false }, { lamports: 4_999_999 }]
  assert.equal(await enclaveMod.EnclaveRuntime.prototype.probeCanBoot.call(probeHost), false)

  mockAccounts = [{ executable: false }, { executable: false }, { executable: false }, { lamports: 5_000_000 }]
  assert.equal(await enclaveMod.EnclaveRuntime.prototype.probeCanBoot.call(probeHost), false)

  mockAccounts = [{ executable: true }, { executable: false }, { executable: false }, { lamports: 5_000_000 }]
  assert.equal(await enclaveMod.EnclaveRuntime.prototype.probeCanBoot.call(probeHost), true)
})

test('Mainnet setup resolves measurement from ENCLAVE_MEASUREMENT or ENCLAVE_ENDPOINT /health and refuses local fallback', async () => {
  const sampleMeasurement = '3d79512a8680a68b3e66941675dffe366e44efee5d4c2f10ea269e76d3faaa53334c6128168c24b9ac7095a5a690c595'
  const sampleEnclave = Keypair.generate().publicKey.toBase58()

  await assert.rejects(
    () => setupMod.resolveMainnetEnclaveInfo({}),
    /refusing to hash the local runtime bundle/,
  )

  await assert.rejects(
    () => setupMod.resolveMainnetEnclaveInfo({ ENCLAVE_MEASUREMENT: 'not-hex' }),
    /96 hexadecimal characters/,
  )

  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = (async (input: string | URL | Request) => {
      assert.equal(String(input), 'https://enclave.example/health')
      return new Response(
        JSON.stringify({ status: 'waiting', enclave: sampleEnclave, measurement: sampleMeasurement, models: [] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as typeof fetch

    const fromHealth = await setupMod.fetchHealthEnclave('https://enclave.example/')
    assert.deepEqual(fromHealth, { enclave: sampleEnclave, measurement: sampleMeasurement })

    const resolved = await setupMod.resolveMainnetEnclaveInfo({ ENCLAVE_ENDPOINT: 'https://enclave.example' })
    assert.deepEqual(resolved, {
      enclave: sampleEnclave,
      measurement: sampleMeasurement,
      endpoint: 'https://enclave.example',
    })

    await assert.rejects(
      () => setupMod.resolveMainnetEnclaveInfo({
        ENCLAVE_ENDPOINT: 'https://enclave.example',
        ENCLAVE_MEASUREMENT: 'ff'.repeat(48),
      }),
      /does not match live/,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Step 1 legacy compatibility: decodes 116B Config, 302B Call, 401B Receipt and legacy CPI events alongside upgraded layouts', () => {
  const admin = Keypair.generate().publicKey
  const attestProgram = Keypair.generate().publicKey
  const feeRecipient = Keypair.generate().publicKey
  const caller = Keypair.generate().publicKey
  const model = Keypair.generate().publicKey
  const enclave = Keypair.generate().publicKey
  const owner = Keypair.generate().publicKey
  const operator = Keypair.generate().publicKey
  const callKey = Keypair.generate().publicKey

  // Legacy 116B Config
  const legacyConfig = Buffer.alloc(116)
  Buffer.from(sha256(utf8('account:Config')).subarray(0, 8)).copy(legacyConfig, 0)
  admin.toBuffer().copy(legacyConfig, 8)
  attestProgram.toBuffer().copy(legacyConfig, 40)
  legacyConfig[72] = 1
  feeRecipient.toBuffer().copy(legacyConfig, 73)
  legacyConfig.writeUInt16LE(500, 105)
  legacyConfig.writeBigUInt64LE(450n, 107)
  legacyConfig[115] = 254
  const parsedLegacyConfig = decodeConfigAccount(legacyConfig)
  assert.equal(parsedLegacyConfig.legacy, true)
  assert.equal(parsedLegacyConfig.maxOpenAnswerBytes, 1024)
  assert.equal(parsedLegacyConfig.protocolShareBps, 500)
  assert.equal(parsedLegacyConfig.callDeadlineSlots.toString(), '450')

  // Upgraded 118B Config
  const upgradedConfig = Buffer.alloc(118)
  legacyConfig.copy(upgradedConfig, 0)
  upgradedConfig.writeUInt16LE(2048, 116)
  const parsedUpgradedConfig = decodeConfigAccount(upgradedConfig)
  assert.equal(parsedUpgradedConfig.legacy, false)
  assert.equal(parsedUpgradedConfig.maxOpenAnswerBytes, 2048)

  // Legacy 302B Call and upgraded 303B open Call
  const legacyCall = Buffer.alloc(302)
  Buffer.from(sha256(utf8('account:Call')).subarray(0, 8)).copy(legacyCall, 0)
  caller.toBuffer().copy(legacyCall, 8)
  model.toBuffer().copy(legacyCall, 40)
  enclave.toBuffer().copy(legacyCall, 72)
  legacyCall.writeBigUInt64LE(7n, 104)
  legacyCall.writeBigUInt64LE(10_000_000n, 144)
  owner.toBuffer().copy(legacyCall, 184)
  operator.toBuffer().copy(legacyCall, 216)
  feeRecipient.toBuffer().copy(legacyCall, 248)
  legacyCall.writeUInt16LE(2500, 280)
  legacyCall.writeUInt16LE(500, 282)
  legacyCall.writeBigUInt64LE(100n, 284)
  legacyCall.writeBigUInt64LE(550n, 292)
  legacyCall[300] = 0
  legacyCall[301] = 253
  const parsedLegacyCall = decodeCallAccount(legacyCall)
  assert.equal(parsedLegacyCall.legacy, true)
  assert.equal(parsedLegacyCall.answerMode, 'sealed')
  assert.deepEqual(parsedLegacyCall.status, { open: {} })

  const openCall = Buffer.alloc(303)
  legacyCall.copy(openCall, 0)
  openCall[302] = 1
  const parsedOpenCall = decodeCallAccount(openCall)
  assert.equal(parsedOpenCall.legacy, false)
  assert.equal(parsedOpenCall.answerMode, 'open')
  assert.equal(parsedOpenCall.callerIsProgram, false)

  const programCall = Buffer.alloc(304)
  openCall.copy(programCall, 0)
  programCall[303] = 1
  const parsedProgramCall = decodeCallAccount(programCall)
  assert.equal(parsedProgramCall.legacy, false)
  assert.equal(parsedProgramCall.answerMode, 'open')
  assert.equal(parsedProgramCall.callerIsProgram, true)
  assert(parsedProgramCall.callbackProgram.equals(PublicKey.default))
  assert.equal(parsedProgramCall.callbackAccounts.length, 0)

  const callbackTarget = Keypair.generate().publicKey
  const cbAcc1 = Keypair.generate().publicKey
  const cbAcc2 = Keypair.generate().publicKey
  const callbackCall = Buffer.alloc(340 + 33 * 2)
  programCall.copy(callbackCall, 0)
  callbackTarget.toBuffer().copy(callbackCall, 304)
  callbackCall.writeUInt32LE(2, 336)
  cbAcc1.toBuffer().copy(callbackCall, 340)
  callbackCall[372] = 1
  cbAcc2.toBuffer().copy(callbackCall, 373)
  callbackCall[405] = 0
  const parsedCallbackCall = decodeCallAccount(callbackCall)
  assert.equal(parsedCallbackCall.legacy, false)
  assert.equal(parsedCallbackCall.callerIsProgram, true)
  assert(parsedCallbackCall.callbackProgram.equals(callbackTarget))
  assert.equal(parsedCallbackCall.callbackAccounts.length, 2)
  assert(parsedCallbackCall.callbackAccounts[0]!.pubkey.equals(cbAcc1))
  assert.equal(parsedCallbackCall.callbackAccounts[0]!.isWritable, true)
  assert(parsedCallbackCall.callbackAccounts[1]!.pubkey.equals(cbAcc2))
  assert.equal(parsedCallbackCall.callbackAccounts[1]!.isWritable, false)

  // Legacy 401B Receipt, Step-1 406+N Receipt, and Step-2 407+N program Receipt
  const legacyReceipt = Buffer.alloc(401)
  Buffer.from(sha256(utf8('account:Receipt')).subarray(0, 8)).copy(legacyReceipt, 0)
  callKey.toBuffer().copy(legacyReceipt, 8)
  model.toBuffer().copy(legacyReceipt, 40)
  enclave.toBuffer().copy(legacyReceipt, 72)
  legacyReceipt.writeBigUInt64LE(120n, 232)
  legacyReceipt.writeBigUInt64LE(10_000_000n, 272)
  owner.toBuffer().copy(legacyReceipt, 280)
  operator.toBuffer().copy(legacyReceipt, 312)
  feeRecipient.toBuffer().copy(legacyReceipt, 344)
  legacyReceipt.writeBigUInt64LE(7_000_000n, 376)
  legacyReceipt.writeBigUInt64LE(2_500_000n, 384)
  legacyReceipt.writeBigUInt64LE(500_000n, 392)
  legacyReceipt[400] = 252
  const parsedLegacyReceipt = decodeReceiptAccount(legacyReceipt)
  assert.equal(parsedLegacyReceipt.legacy, true)
  assert.equal(parsedLegacyReceipt.answerMode, 'sealed')
  assert.equal(parsedLegacyReceipt.openAnswer.length, 0)
  assert.equal(parsedLegacyReceipt.callerIsProgram, false)

  const openBytes = utf8('{"label":"clock","probability":0.97}')
  const openReceipt = Buffer.alloc(406 + openBytes.length)
  legacyReceipt.copy(openReceipt, 0)
  openReceipt[401] = 1
  openReceipt.writeUInt32LE(openBytes.length, 402)
  Buffer.from(openBytes).copy(openReceipt, 406)
  const parsedOpenReceipt = decodeReceiptAccount(openReceipt)
  assert.equal(parsedOpenReceipt.legacy, false)
  assert.equal(parsedOpenReceipt.answerMode, 'open')
  assert.deepEqual(Buffer.from(parsedOpenReceipt.openAnswer), Buffer.from(openBytes))
  assert.equal(parsedOpenReceipt.callerIsProgram, false)

  const programReceipt = Buffer.alloc(407 + openBytes.length)
  openReceipt.copy(programReceipt, 0)
  programReceipt[406 + openBytes.length] = 1
  const parsedProgramReceipt = decodeReceiptAccount(programReceipt)
  assert.equal(parsedProgramReceipt.legacy, false)
  assert.equal(parsedProgramReceipt.answerMode, 'open')
  assert.deepEqual(Buffer.from(parsedProgramReceipt.openAnswer), Buffer.from(openBytes))
  assert.equal(parsedProgramReceipt.callerIsProgram, true)

  // Legacy and Step-1 CPI event normalization
  const { voynich } = chainPrograms({} as never)
  const legacyCfgEvent = Buffer.alloc(115)
  Buffer.from(sha256(utf8('event:ConfigChanged')).subarray(0, 8)).copy(legacyCfgEvent, 0)
  admin.toBuffer().copy(legacyCfgEvent, 8)
  attestProgram.toBuffer().copy(legacyCfgEvent, 40)
  legacyCfgEvent[72] = 1
  feeRecipient.toBuffer().copy(legacyCfgEvent, 73)
  legacyCfgEvent.writeUInt16LE(500, 105)
  legacyCfgEvent.writeBigUInt64LE(450n, 107)
  const decodedCfgEvent = voynich.coder.events.decode(toBase64(normalizeLegacyVoynichEvent(legacyCfgEvent)))
  assert.equal(decodedCfgEvent?.name, 'configChanged')
  assert.equal((decodedCfgEvent?.data as { config: { maxOpenAnswerBytes: number } }).config.maxOpenAnswerBytes, 1024)

  const legacyOpenEvent = Buffer.alloc(332)
  Buffer.from(sha256(utf8('event:CallOpened')).subarray(0, 8)).copy(legacyOpenEvent, 0)
  const decodedOpenEvent = voynich.coder.events.decode(toBase64(normalizeLegacyVoynichEvent(legacyOpenEvent)))
  assert.equal(decodedOpenEvent?.name, 'callOpened')
  assert.deepEqual((decodedOpenEvent?.data as { answerMode: unknown }).answerMode, { sealed: {} })
  assert.equal((decodedOpenEvent?.data as { callerIsProgram: boolean }).callerIsProgram, false)

  const step1OpenEvent = Buffer.alloc(333)
  legacyOpenEvent.copy(step1OpenEvent, 0)
  step1OpenEvent[332] = 1
  const decodedStep1OpenEvent = voynich.coder.events.decode(toBase64(normalizeLegacyVoynichEvent(step1OpenEvent)))
  assert.equal(decodedStep1OpenEvent?.name, 'callOpened')
  assert.deepEqual((decodedStep1OpenEvent?.data as { answerMode: unknown }).answerMode, { open: {} })
  assert.equal((decodedStep1OpenEvent?.data as { callerIsProgram: boolean }).callerIsProgram, false)
  assert((decodedStep1OpenEvent?.data as { callbackProgram: PublicKey }).callbackProgram.equals(PublicKey.default))
  assert.equal((decodedStep1OpenEvent?.data as { callbackAccounts: unknown[] }).callbackAccounts.length, 0)

  const step2OpenEvent = Buffer.alloc(334)
  step1OpenEvent.copy(step2OpenEvent, 0)
  step2OpenEvent[333] = 1
  const decodedStep2OpenEvent = voynich.coder.events.decode(toBase64(normalizeLegacyVoynichEvent(step2OpenEvent)))
  assert.equal(decodedStep2OpenEvent?.name, 'callOpened')
  assert.equal((decodedStep2OpenEvent?.data as { callerIsProgram: boolean }).callerIsProgram, true)
  assert((decodedStep2OpenEvent?.data as { callbackProgram: PublicKey }).callbackProgram.equals(PublicKey.default))
  assert.equal((decodedStep2OpenEvent?.data as { callbackAccounts: unknown[] }).callbackAccounts.length, 0)

  const legacySettledEvent = Buffer.alloc(432)
  Buffer.from(sha256(utf8('event:CallSettled')).subarray(0, 8)).copy(legacySettledEvent, 0)
  const decodedSettledEvent = voynich.coder.events.decode(toBase64(normalizeLegacyVoynichEvent(legacySettledEvent)))
  assert.equal(decodedSettledEvent?.name, 'callSettled')
  assert.deepEqual((decodedSettledEvent?.data as { answerMode: unknown }).answerMode, { sealed: {} })
  assert.equal((decodedSettledEvent?.data as { openAnswer: Buffer }).openAnswer.length, 0)
  assert.equal((decodedSettledEvent?.data as { callerIsProgram: boolean }).callerIsProgram, false)

  const step1SettledEvent = Buffer.alloc(437 + openBytes.length)
  legacySettledEvent.copy(step1SettledEvent, 0)
  step1SettledEvent[432] = 1
  step1SettledEvent.writeUInt32LE(openBytes.length, 433)
  Buffer.from(openBytes).copy(step1SettledEvent, 437)
  const decodedStep1SettledEvent = voynich.coder.events.decode(toBase64(normalizeLegacyVoynichEvent(step1SettledEvent)))
  assert.equal(decodedStep1SettledEvent?.name, 'callSettled')
  assert.deepEqual((decodedStep1SettledEvent?.data as { answerMode: unknown }).answerMode, { open: {} })
  assert.deepEqual(Buffer.from((decodedStep1SettledEvent?.data as { openAnswer: Buffer }).openAnswer), Buffer.from(openBytes))
  assert.equal((decodedStep1SettledEvent?.data as { callerIsProgram: boolean }).callerIsProgram, false)
})

test('Step 7 agent-caller example: emits verified JSON report, posts webhook, and aborts non-zero on verification failure', async () => {
  const { spawnSync } = await import('node:child_process')
  const { fileURLToPath } = await import('node:url')
  const mod = await import('../sdk/examples/agent-caller.mjs') as {
    parseAgentConfig: (env?: Record<string, string | undefined>) => {
      keypairPath: string
      apiUrl: string
      siteUrl: string
      model: string
      answerMode: 'open' | 'sealed'
      webhookUrl: string | null
    }
    runAgentCall: (opts: {
      client: {
        call: (model: string, drawing: unknown, opts: { answerMode: 'open' | 'sealed' }) => Promise<{ output: unknown; receipt: { address: string } }>
        verify: (id: string) => Promise<{
          verified: boolean
          signature: boolean
          record: boolean
          expiry: boolean
          answer: boolean
          reason?: string
          receipt: {
            address: string
            modelName: string | null
            answerMode: 'open' | 'sealed'
            slot: string
            transactionSignature: string
          }
        }>
      }
      agent: string
      model?: string
      answerMode?: 'open' | 'sealed'
      siteUrl?: string
      webhookUrl?: string | null
      fetchImpl?: typeof fetch
    }) => Promise<Record<string, unknown>>
  }

  const defaults = mod.parseAgentConfig({})
  assert.equal(defaults.apiUrl, 'https://api.voynich.dev')
  assert.equal(defaults.siteUrl, 'https://voynich.dev')
  assert.equal(defaults.model, 'sketch-32')
  assert.equal(defaults.answerMode, 'open')
  assert.equal(defaults.webhookUrl, null)
  assert.throws(() => mod.parseAgentConfig({ VOYNICH_ANSWER_MODE: 'plain' }), /VOYNICH_ANSWER_MODE/)

  const agent = Keypair.generate().publicKey.toBase58()
  const receiptAddress = Keypair.generate().publicKey.toBase58()
  const txSignature = '3fQ2F1MzDFtW4p4z6KWV1GwVfPrZFWwB3YthvfFF6EJQhHrEdgsbq5QZ4DHDRp4BZ8cvj9vnTowzSiDvp248zCLw'
  const posted: Array<{ url: string; method: string; body: string }> = []
  const mockFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    posted.push({ url: String(url), method: init?.method ?? 'GET', body: String(init?.body ?? '') })
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }) as typeof fetch

  let verifiedId = ''
  const report = await mod.runAgentCall({
    client: {
      async call(model, _drawing, opts) {
        assert.equal(model, 'sketch-32')
        assert.equal(opts.answerMode, 'open')
        return { output: { label: 'clock', probability: 0.97 }, receipt: { address: receiptAddress } }
      },
      async verify(id) {
        verifiedId = id
        return {
          verified: true,
          signature: true,
          record: true,
          expiry: true,
          answer: true,
          receipt: {
            address: receiptAddress,
            modelName: 'sketch-32',
            answerMode: 'open',
            slot: '419284102',
            transactionSignature: txSignature,
          },
        }
      },
    },
    agent,
    model: 'sketch-32',
    answerMode: 'open',
    siteUrl: 'https://voynich.dev/',
    webhookUrl: 'https://example.test/webhook',
    fetchImpl: mockFetch,
  })
  assert.equal(verifiedId, receiptAddress)
  assert.deepEqual(report, {
    agent,
    model: 'sketch-32',
    answerMode: 'open',
    output: { label: 'clock', probability: 0.97 },
    receiptAddress,
    receiptUrl: `https://voynich.dev/receipts/${receiptAddress}`,
    accountUrl: `https://voynich.dev/account?wallet=${agent}`,
    slot: '419284102',
    transactionSignature: txSignature,
    verified: true,
    checks: { signature: true, record: true, expiry: true, answer: true },
  })
  assert.equal(posted.length, 1)
  assert.equal(posted[0]!.url, 'https://example.test/webhook')
  assert.equal(posted[0]!.method, 'POST')
  assert.deepEqual(JSON.parse(posted[0]!.body), report)

  // Unverified receipt must reject and must never invoke the downstream webhook.
  await assert.rejects(
    mod.runAgentCall({
      client: {
        async call() { return { output: { label: 'clock', probability: 0.97 }, receipt: { address: receiptAddress } } },
        async verify() {
          return {
            verified: false,
            signature: true,
            record: false,
            expiry: true,
            answer: true,
            reason: 'Attestation record mismatch.',
            receipt: {
              address: receiptAddress,
              modelName: 'sketch-32',
              answerMode: 'open',
              slot: '419284102',
              transactionSignature: txSignature,
            },
          }
        },
      },
      agent,
      webhookUrl: 'https://example.test/webhook',
      fetchImpl: mockFetch,
    }),
    /Receipt verification failed: Attestation record mismatch\./,
  )
  assert.equal(posted.length, 1)

  // CLI execution aborts non-zero when VOYNICH_KEYPAIR is missing.
  const scriptPath = fileURLToPath(new URL('../sdk/examples/agent-caller.mjs', import.meta.url))
  const run = spawnSync(process.execPath, [scriptPath], {
    env: { ...process.env, VOYNICH_KEYPAIR: '' },
    encoding: 'utf8',
  })
  assert.equal(run.status, 1)
  assert.match(run.stderr, /VOYNICH_KEYPAIR is required/)
})

test('Build 2 Step 1: transactionFeeLamports, SealProgress/SealResult metrics, and enclave grantToFirstAnswerSeconds compatibility', async () => {
  const { ComputeBudgetProgram, SystemProgram, TransactionMessage, VersionedTransaction } = await import('@solana/web3.js')
  const { createVoynich, transactionFeeLamports } = await import('../sdk/src/index.js')
  const { grantToFirstAnswerSecondsMap, createEnclaveApp } = await import('../enclave/src/runtime.js')
  const { fixtureModel, fixtureEnclave } = await import('@voynich/contract/fixtures')
  const { buildApp } = await import('../src/app.js')

  // 1. Exact fee calculation: base signature fee + ceil(CU limit * CU price / 1e6)
  const payer = Keypair.generate()
  const cosigner = Keypair.generate()
  const blockhash = Keypair.generate().publicKey.toBase58()
  const baseTx = new VersionedTransaction(new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash,
    instructions: [SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: cosigner.publicKey, lamports: 1_000_000, space: 64, programId: SystemProgram.programId })],
  }).compileToV0Message())
  assert.equal(transactionFeeLamports(baseTx), 10_000n)

  const priorityTx = new VersionedTransaction(new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 45_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10_000 }),
      SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: cosigner.publicKey, lamports: 1000 }),
    ],
  }).compileToV0Message())
  // 1 signer (5000) + ceil(45000 * 10000 / 1_000_000) = 5000 + 450 = 5450
  assert.equal(transactionFeeLamports(priorityTx), 5_450n)

  // 2. SealProgress and SealResult metrics in fixture mode (create + 2 write chunks + seal + grant = 5 tx)
  const app = buildApp()
  const fetchFixture = (async (input: string | URL | Request, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const parsed = new URL(rawUrl)
    return app.fetch(new Request(`http://localhost${parsed.pathname}${parsed.search}`, init))
  }) as typeof fetch
  const sdk = createVoynich({ apiUrl: 'http://localhost', signer: payer, fetch: fetchFixture, pollMs: 5 })
  const events: Array<{ step: string; bytesWritten: number; totalBytes: number; transactionsWritten: number; transactionsSent: number; elapsedMs: number; feesLamports: string }> = []
  const weights = new Uint8Array(1000).fill(7)
  const manifest = { ...fixtureModel.manifest, name: 'measure-test' }
  const sealed = await sdk.seal({
    weights,
    manifest,
    price: { mint: null, amount: '100000', decimals: 9, symbol: 'SOL' },
    operatorShareBps: 2500,
    allowedMeasurements: [fixtureEnclave.measurement],
    uploadFundingLamports: '1000000',
    grantEnclave: fixtureEnclave.address,
    onProgress: progress => events.push({ ...progress }),
  })
  assert.equal(sealed.bytesWritten, sealed.totalBytes)
  assert.equal(sealed.bytesWritten, weights.length + 16) // 1 XChaCha20-Poly1305 tag (1016B -> 888 + 128)
  assert.equal(sealed.transactionsSent, 5) // create (1) + 2 writes (888 + 128) + seal (1) + grant (1)
  assert.equal(sealed.feesLamports, '0')
  assert.equal(typeof sealed.elapsedMs, 'number')
  assert(sealed.elapsedMs >= 0)
  const doneEvent = events.at(-1)!
  assert.equal(doneEvent.step, 'done')
  assert.equal(doneEvent.bytesWritten, sealed.bytesWritten)
  assert.equal(doneEvent.transactionsWritten, 2)
  assert.equal(doneEvent.transactionsSent, 5)
  assert.equal(doneEvent.feesLamports, '0')

  // 3. Enclave grantToFirstAnswerSeconds backward compatibility and /health shape
  assert.deepEqual(grantToFirstAnswerSecondsMap(undefined), {})
  assert.deepEqual(grantToFirstAnswerSecondsMap({
    modelPending: { grantLoadedAtMs: 1000 },
    modelSettled: { grantLoadedAtMs: 1000, firstAnswerAtMs: 3456, grantToFirstAnswerMs: 2456 },
  }), {
    modelPending: null,
    modelSettled: 2.456,
  })
  const enclavePubkey = Keypair.generate().publicKey
  const legacyRuntime = {
    enclave: enclavePubkey,
    softwareMeasurement: 'ab'.repeat(48),
    loaded: new Map<string, never>(),
    async acceptInput() {},
    async getAnswer() { throw new Error('unused') },
  }
  const healthLegacy = await createEnclaveApp(legacyRuntime, () => true).request('/health')
  assert.equal(healthLegacy.status, 200)
  assert.deepEqual(await healthLegacy.json(), {
    status: 'ready',
    enclave: enclavePubkey.toBase58(),
    measurement: 'ab'.repeat(48),
    region: null,
    models: [],
    openWeightsSeconds: {},
    grantToFirstAnswerSeconds: {},
    bases: {},
  })
  const timedRuntime = {
    ...legacyRuntime,
    state: { modelTimings: { modelA: { grantLoadedAtMs: 100, firstAnswerAtMs: 1850, grantToFirstAnswerMs: 1750 } } },
  }
  const healthTimed = await createEnclaveApp(timedRuntime, () => true).request('/health')
  assert.equal(healthTimed.status, 200)
  assert.deepEqual((await healthTimed.json() as { grantToFirstAnswerSeconds: unknown }).grantToFirstAnswerSeconds, { modelA: 1.75 })
})

test('Build 2 Step 2: WRITE_CHUNK_BYTES (888B) fits non-LUT 1232B packet, +8B overflows, <=512B stays valid, and quoteModelCost uses WRITE_CHUNK_BYTES', async () => {
  const { ComputeBudgetProgram, TransactionMessage, VersionedTransaction } = await import('@solana/web3.js')
  const { WRITE_CHUNK_BYTES, WriteWeightsRequest } = await import('@voynich/contract')
  const { fixtureModelCostQuote } = await import('@voynich/contract/fixtures')
  const { chainPrograms, eventAccounts } = await import('voynich/program')
  const { PACKET_BYTES, WALLET_GUARD_BYTES, buildUnsignedV0 } = await import('../src/engines/tx/server/build.js')
  const { quoteModelCost } = await import('../src/chain/cost-quote.js')

  assert.equal(WRITE_CHUNK_BYTES, 888)
  const { voynich } = chainPrograms({} as never)
  const uploadKey = Keypair.generate()
  const modelKey = Keypair.generate().publicKey
  const weightsKey = Keypair.generate().publicKey
  const blockhash = Keypair.generate().publicKey.toBase58()
  const events = eventAccounts(voynich.programId)

  const measureWriteWire = async (payloadBytes: number) => {
    const ix = await voynich.methods.writeWeights(0, Buffer.alloc(payloadBytes, 1)).accountsStrict({
      uploadKey: uploadKey.publicKey,
      model: modelKey,
      weights: weightsKey,
      ...events,
    }).instruction()
    const tx = new VersionedTransaction(new TransactionMessage({
      payerKey: uploadKey.publicKey,
      recentBlockhash: blockhash,
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10_000 }),
        ix,
      ],
    }).compileToV0Message())
    tx.sign([uploadKey])
    return { ix, wireBytes: tx.serialize().length }
  }

  // Non-LUT write at WRITE_CHUNK_BYTES fits <= 1232B; +8B exceeds 1232B.
  const fit = await measureWriteWire(WRITE_CHUNK_BYTES)
  assert.equal(fit.wireBytes, 1229)
  assert(fit.wireBytes <= PACKET_BYTES)
  const overflow = await measureWriteWire(WRITE_CHUNK_BYTES + 8)
  assert.equal(overflow.wireBytes, 1237)
  assert(overflow.wireBytes > PACKET_BYTES)

  // buildUnsignedV0 allows 888B when walletSigned: false and rejects it when walletSigned: true (1104B guard ceiling).
  const mockConnection = {
    async getLatestBlockhashAndContext() {
      return { context: { slot: 100 }, value: { blockhash, lastValidBlockHeight: 200 } }
    },
    async simulateTransaction() {
      return { context: { slot: 100 }, value: { err: null, logs: [], unitsConsumed: 20_000 } }
    },
  } as unknown as Parameters<typeof buildUnsignedV0>[0]['connection']
  const builtNonWallet = await buildUnsignedV0({
    connection: mockConnection,
    payer: uploadKey.publicKey,
    instructions: [fit.ix],
    walletSigned: false,
  })
  assert(builtNonWallet.wireBytes <= PACKET_BYTES)
  await assert.rejects(
    buildUnsignedV0({
      connection: mockConnection,
      payer: uploadKey.publicKey,
      instructions: [fit.ix],
      walletSigned: true,
    }),
    new RegExp(`${PACKET_BYTES - WALLET_GUARD_BYTES}`),
  )

  // WriteWeightsRequest accepts legacy 512B and full 888B, rejects 889B.
  const wallet = uploadKey.publicKey.toBase58()
  assert.equal(WriteWeightsRequest.safeParse({ wallet, offset: 0, bytesBase64: toBase64(new Uint8Array(512)) }).success, true)
  assert.equal(WriteWeightsRequest.safeParse({ wallet, offset: 0, bytesBase64: toBase64(new Uint8Array(WRITE_CHUNK_BYTES)) }).success, true)
  assert.equal(WriteWeightsRequest.safeParse({ wallet, offset: 0, bytesBase64: toBase64(new Uint8Array(WRITE_CHUNK_BYTES + 1)) }).success, false)

  // Fixture and chain cost quotes reflect WRITE_CHUNK_BYTES = 888.
  const fixtureQuote = fixtureModelCostQuote(252_145)
  assert.equal(fixtureQuote.writeChunkBytes, WRITE_CHUNK_BYTES)
  assert.equal(fixtureQuote.writeCount, Math.ceil(252_145 / WRITE_CHUNK_BYTES))

  const quoteRuntime = {
    programId: voynich.programId,
    env: {},
    rpc: {
      connection: {
        async getLatestBlockhashAndContext() { return { context: { slot: 500 }, value: { blockhash, lastValidBlockHeight: 700 } } },
        async getMinimumBalanceForRentExemption(bytes: number) { return (bytes + 128) * 6960 },
        async getFeeForMessage(message: { header: { numRequiredSignatures: number } }) { return { context: { slot: 500 }, value: 5000 * message.header.numRequiredSignatures } },
      },
    },
  } as unknown as Parameters<typeof quoteModelCost>[0]
  const chainQuote = await quoteModelCost(quoteRuntime, { sizeBytes: 1_048_576 })
  assert.equal(chainQuote.writeChunkBytes, WRITE_CHUNK_BYTES)
  assert.equal(chainQuote.writeCount, Math.ceil(1_048_576 / WRITE_CHUNK_BYTES))
  assert.equal(chainQuote.writeCount, 1181)
  assert.equal(chainQuote.uploadKeyCount, 8)
})

test('Build 2 Step 3: legacy 6000B Model & ModelCreated decoding, multi-key createModelFootprint, quoteModelCost, and owner-file compatibility', async () => {
  const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { DEFAULT_UPLOAD_KEYS, MAX_UPLOAD_KEYS } = await import('@voynich/contract')
  const { fixtureModel, fixtureEnclave } = await import('@voynich/contract/fixtures')
  const { chainPrograms, normalizeLegacyVoynichEvent } = await import('voynich/program')
  const { createModelFootprint } = await import('../src/chain/create-model.js')
  const { quoteModelCost } = await import('../src/chain/cost-quote.js')
  const { loadOwnerFile, saveOwnerFile } = await import('../sdk/src/owner-file.js')

  assert.equal(MAX_UPLOAD_KEYS, 8)
  assert.equal(DEFAULT_UPLOAD_KEYS, 8)
  const { voynich } = chainPrograms({} as never)

  // 1. Legacy 6000B Model account (zeros after bump) decodes cleanly with uploadKeys = [].
  const owner = Keypair.generate().publicKey
  const weightsKey = Keypair.generate().publicKey
  const uploadKey = Keypair.generate().publicKey
  const modelKey = Keypair.generate().publicKey
  const nameBytes = utf8('sketch-32')
  const manifestBytes = utf8('{"name":"sketch-32"}')
  const cipherBytes = utf8('xchacha20poly1305-64k-v1')
  const meas = new Uint8Array(48).fill(0xab)

  const parts: Uint8Array[] = []
  const push = (b: Uint8Array) => parts.push(b)
  const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n, 0); return b }
  const u64 = (n: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(n, 0); return b }
  const u16 = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(n, 0); return b }
  push(sha256(utf8('account:Model')).subarray(0, 8))
  push(owner.toBytes())
  push(u32(nameBytes.length)); push(nameBytes)
  push(u32(manifestBytes.length)); push(manifestBytes)
  push(u32(1)); push(weightsKey.toBytes())
  push(u64(252_145n))
  push(u32(cipherBytes.length)); push(cipherBytes)
  push(new Uint8Array(16).fill(3))
  push(new Uint8Array(32).fill(9))
  push(u32(1)); push(meas)
  push(u64(100_000n))
  push(PublicKey.default.toBytes())
  push(u16(2500))
  push(uploadKey.toBytes())
  push(Uint8Array.of(2)) // ModelStatus::Live
  push(u64(100n)); push(u64(120n)); push(u64(5n))
  push(Uint8Array.of(254)) // bump
  const legacyModelBuf = Buffer.alloc(6000)
  Buffer.concat(parts).copy(legacyModelBuf, 0)
  const decodedModel = voynich.coder.accounts.decode('model', legacyModelBuf) as {
    name: string; uploadKey: PublicKey; uploadKeys: PublicKey[]; bump: number
  }
  assert.equal(decodedModel.name, 'sketch-32')
  assert(decodedModel.uploadKey.equals(uploadKey))
  assert.equal(decodedModel.uploadKeys.length, 0)
  assert.equal(decodedModel.bump, 254)

  // 2. Legacy pre-Step-3 ModelCreated event (no trailing upload_keys) normalizes and decodes with uploadKeys: [uploadKey].
  const evParts: Uint8Array[] = []
  const pushEv = (b: Uint8Array) => evParts.push(b)
  pushEv(sha256(utf8('event:ModelCreated')).subarray(0, 8))
  pushEv(modelKey.toBytes())
  pushEv(owner.toBytes())
  pushEv(u32(nameBytes.length)); pushEv(nameBytes)
  pushEv(u32(manifestBytes.length)); pushEv(manifestBytes)
  pushEv(u32(1)); pushEv(weightsKey.toBytes())
  pushEv(u64(252_145n))
  pushEv(u32(cipherBytes.length)); pushEv(cipherBytes)
  pushEv(new Uint8Array(16).fill(3))
  pushEv(u32(1)); pushEv(meas)
  pushEv(u64(100_000n))
  pushEv(PublicKey.default.toBytes())
  pushEv(u16(2500))
  pushEv(uploadKey.toBytes())
  pushEv(u64(100n))
  const legacyModelCreated = Buffer.concat(evParts)
  const normalizedEvent = normalizeLegacyVoynichEvent(legacyModelCreated)
  assert.equal(normalizedEvent.length, legacyModelCreated.length + 39)
  const decodedEv = voynich.coder.events.decode(toBase64(normalizedEvent))
  assert.equal(decodedEv?.name, 'modelCreated')
  const evData = decodedEv?.data as { uploadKeys: PublicKey[]; hashVersion: number; base: unknown }
  assert.equal(evData.uploadKeys.length, 1)
  assert(evData.uploadKeys[0]!.equals(uploadKey))
  assert.equal(evData.hashVersion, 0)
  assert.equal(evData.base, null)

  // 3. Multi-key createModelFootprint: 8 upload keys adds 7*33 = 231 bytes over 1 key and fits <= 1104B for sketch-32 with Voynich's LUT.
  const { AddressLookupTableAccount, ComputeBudgetProgram, SystemProgram } = await import('@solana/web3.js')
  const { eventAccounts } = await import('voynich/program')
  const allUploadKeys = Array.from({ length: 8 }, () => Keypair.generate().publicKey.toBase58())
  const baseReq = {
    wallet: owner.toBase58(),
    uploadKey: allUploadKeys[0]!,
    weights: [weightsKey.toBase58()],
    name: 'sketch-32',
    manifest: fixtureModel.manifest,
    sizeBytes: 252_145,
    plaintextSizeBytes: 252_081,
    cipher: fixtureModel.cipher,
    price: fixtureModel.price,
    operatorShareBps: 2500,
    allowedMeasurements: [fixtureEnclave.measurement],
    uploadFundingLamports: '9000000',
  }
  const configKey = addresses(voynich.programId).config
  const evAccs = eventAccounts(voynich.programId)
  const lut = new AddressLookupTableAccount({
    key: Keypair.generate().publicKey,
    state: {
      deactivationSlot: 18446744073709551615n,
      lastExtendedSlot: 100,
      lastExtendedSlotStartIndex: 0,
      authority: owner,
      addresses: [configKey, SystemProgram.programId, evAccs.eventAuthority, voynich.programId, ComputeBudgetProgram.programId],
    },
  })
  const fp1 = await createModelFootprint(voynich, configKey, modelKey, { ...baseReq, uploadKeys: [allUploadKeys[0]!] })
  const fp8 = await createModelFootprint(voynich, configKey, modelKey, { ...baseReq, uploadKeys: allUploadKeys })
  assert.equal(fp8.createTransactionBytes - fp1.createTransactionBytes, 7 * 33)
  const fp8Lut = await createModelFootprint(voynich, configKey, modelKey, { ...baseReq, uploadKeys: allUploadKeys }, [lut])
  assert(fp8Lut.createTransactionBytes < fp8.createTransactionBytes)
  const fp6Lut = await createModelFootprint(voynich, configKey, modelKey, { ...baseReq, uploadKeys: allUploadKeys.slice(0, 6) }, [lut])
  assert.equal(fp6Lut.canCreate, true)
  const fpCompact8 = await createModelFootprint(voynich, configKey, modelKey, {
    ...baseReq,
    name: 'compact-8',
    manifest: { name: 'compact-8', inputKind: 'tensor', inputShape: [1, 1, 28, 28], labels: ['a', 'b'] },
    uploadKeys: allUploadKeys,
  })
  assert.equal(fpCompact8.canCreate, true)

  // 4. quoteModelCost accounts for K=8 upload keys (rent minimums + extra sweep fees).
  const blockhash = Keypair.generate().publicKey.toBase58()
  const quoteRuntime = {
    programId: voynich.programId,
    env: {},
    rpc: {
      connection: {
        async getLatestBlockhashAndContext() { return { context: { slot: 500 }, value: { blockhash, lastValidBlockHeight: 700 } } },
        async getMinimumBalanceForRentExemption(bytes: number) { return bytes === 0 ? 890_880 : (bytes + 128) * 6960 },
        async getFeeForMessage(message: { header: { numRequiredSignatures: number } }) { return { context: { slot: 500 }, value: 5000 * message.header.numRequiredSignatures } },
      },
    },
  } as unknown as Parameters<typeof quoteModelCost>[0]
  const q1 = await quoteModelCost(quoteRuntime, { sizeBytes: 252_145, uploadKeyCount: 1 })
  const q8 = await quoteModelCost(quoteRuntime, { sizeBytes: 252_145, uploadKeyCount: 8 })
  assert.equal(q1.uploadKeyCount, 1)
  assert.equal(q8.uploadKeyCount, 8)
  // 7 extra sweep fees * 5000 lamports = 35,000 lamports difference in estimatedCostLamports
  assert.equal(BigInt(q8.estimatedCostLamports) - BigInt(q1.estimatedCostLamports), 35_000n)
  assert.equal(BigInt(q8.requiredUpfrontLamports), BigInt(q8.estimatedCostLamports) + BigInt(q8.returnedUploadReserveLamports))

  // 5. owner-file round-trips 8 uploadKeys cleanly.
  const dir = mkdtempSync(join(tmpdir(), 'voynich-step3-'))
  try {
    const filePath = join(dir, 'owner.enc.json')
    const pairs = Array.from({ length: 8 }, () => Keypair.generate())
    await saveOwnerFile(filePath, {
      model: modelKey.toBase58(),
      ciphertext: new Uint8Array([1, 2, 3, 4]),
      modelKey: new Uint8Array(32).fill(5),
      uploadKey: pairs[0]!,
      uploadKeys: pairs,
      plaintextSizeBytes: 4,
      noncePrefix: new Uint8Array(16).fill(6),
    }, 'test-password')
    const loaded = await loadOwnerFile(filePath, 'test-password')
    assert.equal(loaded.uploadKeys?.length, 8)
    assert(loaded.uploadKeys![7]!.publicKey.equals(pairs[7]!.publicKey))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('Build 2 Step 4: Merkle frontier parity, legacy Model/ModelCreated decoding, and 64-account range-sealing cost quote', async () => {
  const { MAX_WEIGHTS, MODEL_ACCOUNT_BYTES, SEAL_RANGE_CHUNKS } = await import('@voynich/contract')
  const { CIPHER_CHUNK_BYTES, chunkLeafHash, ciphertextHash, ciphertextMerkleRoot, merkleParentHash } = await import('voynich/crypto')
  const { chainPrograms, normalizeLegacyVoynichEvent } = await import('voynich/program')
  const { quoteModelCost } = await import('../src/chain/cost-quote.js')

  assert.equal(MAX_WEIGHTS, 64)
  assert.equal(MODEL_ACCOUNT_BYTES, 8192)
  assert.equal(SEAL_RANGE_CHUNKS, 8)

  // 1. Merkle root via incremental frontier matches explicit level-by-level tree reduction across chunk counts.
  for (const count of [1, 2, 3, 4, 5, 8, 9, 17, 33]) {
    const totalLen = (count - 1) * CIPHER_CHUNK_BYTES + 123
    const bytes = new Uint8Array(totalLen)
    for (let i = 0; i < count; i++) bytes[i * CIPHER_CHUNK_BYTES] = (i * 29 + 7) & 255
    const frontierRoot = ciphertextMerkleRoot(bytes)
    let level: Uint8Array[] = []
    for (let i = 0; i < count; i++) {
      const start = i * CIPHER_CHUNK_BYTES
      level.push(chunkLeafHash(i, bytes.subarray(start, Math.min(start + CIPHER_CHUNK_BYTES, totalLen))))
    }
    while (level.length > 1) {
      const next: Uint8Array[] = []
      for (let i = 0; i < level.length; i += 2) {
        if (i + 1 < level.length) next.push(merkleParentHash(level[i]!, level[i + 1]!))
        else next.push(level[i]!)
      }
      level = next
    }
    assert.deepEqual(Buffer.from(frontierRoot), Buffer.from(level[0]!), `Merkle mismatch at count=${count}`)
    assert.deepEqual(Buffer.from(ciphertextHash(bytes, 1)), Buffer.from(frontierRoot))
    assert.deepEqual(Buffer.from(ciphertextHash(bytes, 0)), Buffer.from(sha256(bytes)))
  }

  // 2. Step-3 ModelCreated event (has upload_keys, lacks hash_version) normalizes cleanly with hashVersion = 0.
  const { voynich } = chainPrograms({} as never)
  const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n, 0); return b }
  const u64 = (n: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(n, 0); return b }
  const u16 = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(n, 0); return b }
  const modelKey = Keypair.generate().publicKey
  const owner = Keypair.generate().publicKey
  const weightsKey = Keypair.generate().publicKey
  const k1 = Keypair.generate().publicKey
  const k2 = Keypair.generate().publicKey
  const nameBytes = utf8('step3-model')
  const manifestBytes = utf8('{"name":"step3-model"}')
  const cipherBytes = utf8('xchacha20poly1305-64k-v1')
  const step3Event = Buffer.concat([
    sha256(utf8('event:ModelCreated')).subarray(0, 8),
    modelKey.toBytes(), owner.toBytes(),
    u32(nameBytes.length), nameBytes,
    u32(manifestBytes.length), manifestBytes,
    u32(1), weightsKey.toBytes(),
    u64(252_145n),
    u32(cipherBytes.length), cipherBytes,
    new Uint8Array(16).fill(3),
    u32(1), new Uint8Array(48).fill(0xab),
    u64(100_000n), PublicKey.default.toBytes(), u16(2500),
    k1.toBytes(), u64(500n),
    u32(2), k1.toBytes(), k2.toBytes(),
  ])
  const normStep3 = normalizeLegacyVoynichEvent(step3Event)
  assert.equal(normStep3.length, step3Event.length + 3)
  const decodedStep3 = voynich.coder.events.decode(toBase64(normStep3))
  assert.equal(decodedStep3?.name, 'modelCreated')
  const step3Data = decodedStep3?.data as { uploadKeys: PublicKey[]; hashVersion: number; base: unknown }
  assert.equal(step3Data.uploadKeys.length, 2)
  assert.equal(step3Data.hashVersion, 0)
  assert.equal(step3Data.base, null)

  // 3. Legacy 6000B Model account decodes hashVersion = 0, sealedChunks = 0, merkleFrontier = [], merkleFrontierMask = 0.
  const legacyModelBuf = Buffer.alloc(6000)
  Buffer.concat([
    sha256(utf8('account:Model')).subarray(0, 8),
    owner.toBytes(),
    u32(nameBytes.length), nameBytes,
    u32(manifestBytes.length), manifestBytes,
    u32(1), weightsKey.toBytes(),
    u64(252_145n),
    u32(cipherBytes.length), cipherBytes,
    new Uint8Array(16).fill(3),
    new Uint8Array(32).fill(9),
    u32(1), new Uint8Array(48).fill(0xab),
    u64(100_000n), PublicKey.default.toBytes(), u16(2500),
    k1.toBytes(), Uint8Array.of(2),
    u64(100n), u64(120n), u64(5n), Uint8Array.of(253),
  ]).copy(legacyModelBuf, 0)
  const decodedLegacy = voynich.coder.accounts.decode('model', legacyModelBuf) as {
    hashVersion: number; sealedChunks: number; merkleFrontier: number[][]; merkleFrontierMask: number
  }
  assert.equal(decodedLegacy.hashVersion, 0)
  assert.equal(decodedLegacy.sealedChunks, 0)
  assert.equal(decodedLegacy.merkleFrontier.length, 0)
  assert.equal(decodedLegacy.merkleFrontierMask, 0)

  // 4. quoteModelCost handles 2.5 MiB (range sealing) and 100 MiB (11 weights accounts -> attach_weights + seal_range).
  const blockhash = Keypair.generate().publicKey.toBase58()
  const quoteRuntime = {
    programId: voynich.programId,
    env: {},
    rpc: {
      connection: {
        async getLatestBlockhashAndContext() { return { context: { slot: 500 }, value: { blockhash, lastValidBlockHeight: 700 } } },
        async getMinimumBalanceForRentExemption(bytes: number) { return bytes === 0 ? 890_880 : (bytes + 128) * 6960 },
        async getFeeForMessage(message: { header: { numRequiredSignatures: number } }) { return { context: { slot: 500 }, value: 5000 * message.header.numRequiredSignatures } },
      },
    },
  } as unknown as Parameters<typeof quoteModelCost>[0]

  const qSmall = await quoteModelCost(quoteRuntime, { sizeBytes: 252_145, uploadKeyCount: 6 })
  assert.equal(qSmall.modelAccountBytes, 8192)
  assert.equal(qSmall.attachWeightsCount, 0)
  assert.equal(qSmall.sealRangeCount, 0)

  const q25 = await quoteModelCost(quoteRuntime, { sizeBytes: 2_621_440, uploadKeyCount: 8 })
  assert.equal(q25.weights.length, 1)
  assert.equal(q25.attachWeightsCount, 0)
  assert.equal(q25.sealRangeCount, 4) // 40 chunks -> 4 * 8 via seal_range + 8 inline in seal_model
  assert.equal(BigInt(q25.requiredUpfrontLamports), BigInt(q25.estimatedCostLamports) + BigInt(q25.returnedUploadReserveLamports))

  const q100 = await quoteModelCost(quoteRuntime, { sizeBytes: 104_857_600, uploadKeyCount: 8 })
  assert.equal(q100.weights.length, 11)
  assert.equal(q100.attachWeightsCount, 1) // 8 in create_model + 3 in 1 attach_weights tx
  assert.equal(q100.sealRangeCount, 199) // ceil(104857600 / 65552) = 1600 chunks -> 199 * 8 + 8 inline
  assert.equal(BigInt(q100.requiredUpfrontLamports), BigInt(q100.estimatedCostLamports) + BigInt(q100.returnedUploadReserveLamports))
})

test('Build 2 Step 5: openWeightsChunk, merkleRootFromLeaves, cross-account openModelWeights (v0 & v1), tamper rejection, and openWeightsSeconds', async () => {
  const {
    CIPHER_CHUNK_BYTES, WEIGHTS_CHUNK_BYTES, ciphertextMerkleRoot, merkleRootFromLeaves,
    openWeightsChunk, openWeightsRange, sealWeights,
  } = await import('voynich/crypto')
  const { createEnclaveApp, openModelWeights, openWeightsSecondsMap } = enclaveMod

  // 1. openWeightsChunk + merkleRootFromLeaves parity vs ciphertextMerkleRoot & openWeightsRange across chunk counts.
  for (const count of [1, 2, 3, 4, 8, 9, 17, 33]) {
    const plaintextLen = (count - 1) * WEIGHTS_CHUNK_BYTES + 321
    const plaintext = new Uint8Array(plaintextLen)
    for (let i = 0; i < count; i++) plaintext[i * WEIGHTS_CHUNK_BYTES] = (i * 41 + 9) & 255
    const sealed = sealWeights(plaintext)
    const leaves: Uint8Array[] = []
    const recovered = new Uint8Array(plaintextLen)
    for (let i = 0; i < count; i++) {
      const cStart = i * CIPHER_CHUNK_BYTES
      const cEnd = Math.min(cStart + CIPHER_CHUNK_BYTES, sealed.ciphertext.length)
      const opened = openWeightsChunk(sealed.ciphertext.subarray(cStart, cEnd), i, sealed.key, sealed.header)
      recovered.set(opened.plaintext, i * WEIGHTS_CHUNK_BYTES)
      leaves.push(opened.leafHash)
    }
    assert.deepEqual(Buffer.from(recovered), Buffer.from(plaintext))
    assert.deepEqual(Buffer.from(recovered), Buffer.from(openWeightsRange(sealed.ciphertext, sealed.key, sealed.header, 0, plaintextLen)))
    assert.deepEqual(Buffer.from(merkleRootFromLeaves(leaves)), Buffer.from(ciphertextMerkleRoot(sealed.ciphertext)))
    assert.deepEqual(Buffer.from(merkleRootFromLeaves(leaves)), Buffer.from(sealed.merkleRoot))
  }

  // 2. Tampered chunk rejected by Poly1305 AEAD in openWeightsChunk.
  const smallPlaintext = new Uint8Array(WEIGHTS_CHUNK_BYTES + 123).fill(0x3c)
  const smallSealed = sealWeights(smallPlaintext)
  const tamperedChunk = smallSealed.ciphertext.subarray(0, CIPHER_CHUNK_BYTES).slice()
  tamperedChunk[100] ^= 0x01
  assert.throws(() => openWeightsChunk(tamperedChunk, 0, smallSealed.key, smallSealed.header))

  // 3. openModelWeights splices across 3 non-chunk-aligned Weights accounts for both hashVersion 1 and legacy hashVersion 0.
  const programId = Keypair.generate().publicKey
  const modelAddress = Keypair.generate().publicKey
  const multiPlaintext = new Uint8Array(11 * WEIGHTS_CHUNK_BYTES + 777)
  for (let i = 0; i < multiPlaintext.length; i += 257) multiPlaintext[i] = (i * 13) & 255
  const multiSealed = sealWeights(multiPlaintext)
  const totalCipher = multiSealed.ciphertext.length
  // Split ciphertext across 3 accounts at non-chunk-aligned boundaries so 64 KiB chunks straddle account boundaries.
  const splits = [100_000, 350_000, totalCipher - 450_000]
  const weightsKeys = splits.map(() => Keypair.generate().publicKey)
  const disc = sha256(utf8('account:Weights')).subarray(0, 8)
  const accountBuffers = new Map<string, Buffer>()
  let cursor = 0
  for (let i = 0; i < splits.length; i++) {
    const size = splits[i]!
    const buf = Buffer.alloc(56 + size)
    Buffer.from(disc).copy(buf, 0)
    modelAddress.toBuffer().copy(buf, 8)
    buf.writeUInt32LE(i, 40)
    buf.writeUInt32LE(size, 44)
    buf.writeUInt32LE(size, 48)
    buf.writeUInt32LE(cursor, 52)
    Buffer.from(multiSealed.ciphertext.subarray(cursor, cursor + size)).copy(buf, 56)
    accountBuffers.set(weightsKeys[i]!.toBase58(), buf)
    cursor += size
  }

  let headerBatchCalls = 0
  let sliceReads = 0
  const makeConnection = (mutateByteAt?: { accountIndex: number; offset: number }) => ({
    async getMultipleAccountsInfo(keys: PublicKey[], config?: { dataSlice?: { offset: number; length: number } }) {
      headerBatchCalls++
      assert.deepEqual(config?.dataSlice, { offset: 0, length: 56 }, 'must read 56-byte Weights headers in one batch')
      return keys.map(k => {
        const full = accountBuffers.get(k.toBase58())!
        return { owner: programId, data: full.subarray(0, 56) }
      })
    },
    async getAccountInfo(key: PublicKey, config?: { dataSlice?: { offset: number; length: number } }) {
      sliceReads++
      assert(config?.dataSlice, 'must read Weights via dataSlice')
      const full = Buffer.from(accountBuffers.get(key.toBase58())!)
      if (mutateByteAt && key.equals(weightsKeys[mutateByteAt.accountIndex]!)) {
        full[56 + mutateByteAt.offset] ^= 0xff
      }
      // Deliberately stagger completion so range 1 finishes before range 0 to test out-of-order v0 streaming sha256.
      await new Promise(r => setTimeout(r, config.dataSlice.offset < 100_000 ? 15 : 1))
      return { owner: programId, data: full.subarray(config.dataSlice.offset, config.dataSlice.offset + config.dataSlice.length) }
    },
  }) as unknown as Parameters<typeof openModelWeights>[0]['connection']

  const openedV1 = await openModelWeights({
    connection: makeConnection(),
    programId,
    modelAddress,
    weightsAddresses: weightsKeys,
    sizeBytes: totalCipher,
    hashVersion: 1,
    expectedHashHex: toHex(multiSealed.merkleRoot),
    key: multiSealed.key,
    noncePrefix: multiSealed.header.noncePrefix,
    rangeChunks: 4,
    concurrency: 3,
  })
  assert.deepEqual(Buffer.from(openedV1), Buffer.from(multiPlaintext))
  assert.equal(headerBatchCalls, 1)
  assert(sliceReads >= 3)

  const openedV0 = await openModelWeights({
    connection: makeConnection(),
    programId,
    modelAddress,
    weightsAddresses: weightsKeys,
    sizeBytes: totalCipher,
    hashVersion: 0,
    expectedHashHex: toHex(multiSealed.sha256),
    key: multiSealed.key,
    noncePrefix: multiSealed.header.noncePrefix,
    rangeChunks: 4,
    concurrency: 3,
  })
  assert.deepEqual(Buffer.from(openedV0), Buffer.from(multiPlaintext))

  // Wrong commitment hash must reject before returning plaintext.
  await assert.rejects(() => openModelWeights({
    connection: makeConnection(),
    programId,
    modelAddress,
    weightsAddresses: weightsKeys,
    sizeBytes: totalCipher,
    hashVersion: 1,
    expectedHashHex: '00'.repeat(32),
    key: multiSealed.key,
    noncePrefix: multiSealed.header.noncePrefix,
  }), /hash does not match/)

  // Tampered ciphertext byte in middle Weights account must reject via Poly1305.
  await assert.rejects(() => openModelWeights({
    connection: makeConnection({ accountIndex: 1, offset: 500 }),
    programId,
    modelAddress,
    weightsAddresses: weightsKeys,
    sizeBytes: totalCipher,
    hashVersion: 1,
    expectedHashHex: toHex(multiSealed.merkleRoot),
    key: multiSealed.key,
    noncePrefix: multiSealed.header.noncePrefix,
  }))

  // 4. openWeightsSeconds exposed alongside grantToFirstAnswerSeconds on /health and compatible with legacy timings.
  const m1 = Keypair.generate().publicKey.toBase58()
  const m2 = Keypair.generate().publicKey.toBase58()
  assert.deepEqual(openWeightsSecondsMap({ [m1]: { grantLoadedAtMs: 1000, openWeightsMs: 412 }, [m2]: { grantLoadedAtMs: 2000 } }), { [m1]: 0.412, [m2]: null })
  const healthApp = createEnclaveApp({
    enclave: Keypair.generate().publicKey,
    softwareMeasurement: 'ab'.repeat(48),
    loaded: new Map([[m1, {} as never]]),
    state: { modelTimings: { [m1]: { grantLoadedAtMs: 1000, openWeightsMs: 412, firstAnswerAtMs: 1900, grantToFirstAnswerMs: 900 } } },
    acceptInput: async () => {},
    getAnswer: async () => { throw new Error('unused') },
  }, () => true)
  const healthRes = await healthApp.request('http://127.0.0.1:9707/health')
  assert.equal(healthRes.status, 200)
  const healthBody = await healthRes.json() as { openWeightsSeconds: Record<string, number | null>; grantToFirstAnswerSeconds: Record<string, number | null> }
  assert.deepEqual(healthBody.openWeightsSeconds, { [m1]: 0.412 })
  assert.deepEqual(healthBody.grantToFirstAnswerSeconds, { [m1]: 0.9 })
})

test('Build 2 Step 6: deterministic wallet seal derivation, signature verification, tamper rejection, and chain-direct resume inspection', async () => {
  const { ed25519 } = await import('@noble/curves/ed25519.js')
  const {
    CIPHER_CHUNK_BYTES, WEIGHTS_CHUNK_BYTES, WEIGHTS_CIPHER,
    deriveSealSecrets, sealDerivationMessage, sealWeights, signSealDerivation,
    verifySealDerivationSignature,
  } = await import('voynich/crypto')
  const { findUnwrittenRangesFromChain } = await import('voynich')

  const owner = Keypair.generate()
  const other = Keypair.generate()
  const programId = Keypair.generate().publicKey
  const modelAddress = Keypair.generate().publicKey
  const otherModel = Keypair.generate().publicKey

  // 1. Canonical domain-separated derivation message.
  const msgA = sealDerivationMessage(programId, modelAddress)
  const msgAFromStrings = sealDerivationMessage(programId.toBase58(), modelAddress.toBase58())
  const msgB = sealDerivationMessage(programId, otherModel)
  assert.deepEqual(Buffer.from(msgA), Buffer.from(msgAFromStrings))
  assert.notDeepEqual(Buffer.from(msgA), Buffer.from(msgB))
  assert.equal(new TextDecoder().decode(msgA), `voynich/seal/v1\nprogram: ${programId.toBase58()}\nmodel: ${modelAddress.toBase58()}`)

  // 2. Keypair and async wallet signMessage derive identical secrets (modelKey, noncePrefix, 8 uploadKeys, weightsKeys).
  const fromKeypair = await signSealDerivation(owner, programId, modelAddress, { uploadKeyCount: 8, weightsKeyCount: 3 })
  const walletSigner = {
    publicKey: owner.publicKey,
    async signMessage(message: Uint8Array) {
      return ed25519.sign(message, owner.secretKey.subarray(0, 32))
    },
  }
  const fromWallet = await signSealDerivation(walletSigner, programId, modelAddress, { uploadKeyCount: 8, weightsKeyCount: 3 })
  assert.equal(verifySealDerivationSignature(msgA, fromKeypair.signature, owner.publicKey), true)
  assert.equal(verifySealDerivationSignature(msgA, fromKeypair.signature, other.publicKey), false)
  assert.equal(verifySealDerivationSignature(msgB, fromKeypair.signature, owner.publicKey), false)
  const badSig = fromKeypair.signature.slice()
  badSig[10] ^= 0x01
  assert.equal(verifySealDerivationSignature(msgA, badSig, owner.publicKey), false)
  assert.equal(verifySealDerivationSignature(msgA, new Uint8Array(63), owner.publicKey), false)

  assert.deepEqual(Buffer.from(fromKeypair.modelKey), Buffer.from(fromWallet.modelKey))
  assert.deepEqual(Buffer.from(fromKeypair.noncePrefix), Buffer.from(fromWallet.noncePrefix))
  assert.equal(fromKeypair.uploadKeys.length, 8)
  assert.equal(fromKeypair.weightsKeys.length, 3)
  for (let i = 0; i < 8; i++) assert(fromKeypair.uploadKeys[i]!.publicKey.equals(fromWallet.uploadKeys[i]!.publicKey))
  for (let i = 0; i < 3; i++) assert(fromKeypair.weightsKeys[i]!.publicKey.equals(fromWallet.weightsKeys[i]!.publicKey))
  // Direct deriveSealSecrets matches signSealDerivation output.
  const direct = deriveSealSecrets(fromKeypair.signature, { uploadKeyCount: 8, weightsKeyCount: 3 })
  assert.deepEqual(Buffer.from(direct.modelKey), Buffer.from(fromKeypair.modelKey))
  assert(direct.uploadKey.publicKey.equals(fromKeypair.uploadKey.publicKey))

  // 3. Wrong-signer or tampered signMessage callback is rejected before deriving secrets.
  await assert.rejects(
    () => signSealDerivation({
      publicKey: owner.publicKey,
      async signMessage(message: Uint8Array) { return ed25519.sign(message, other.secretKey.subarray(0, 32)) },
    }, programId, modelAddress),
    /verification/i,
  )

  // 4. Deterministic encryption across two independent contexts produces byte-for-byte identical ciphertext & Merkle root.
  const plaintext = new Uint8Array(3 * WEIGHTS_CHUNK_BYTES + 12_345)
  for (let i = 0; i < plaintext.length; i += 97) plaintext[i] = (i * 23 + 5) & 255
  const sealed1 = sealWeights(plaintext, fromKeypair.modelKey, {
    cipher: WEIGHTS_CIPHER, noncePrefix: fromKeypair.noncePrefix, plaintextBytes: plaintext.length, chunkBytes: WEIGHTS_CHUNK_BYTES,
  })
  const sealed2 = sealWeights(plaintext, fromWallet.modelKey, {
    cipher: WEIGHTS_CIPHER, noncePrefix: fromWallet.noncePrefix, plaintextBytes: plaintext.length, chunkBytes: WEIGHTS_CHUNK_BYTES,
  })
  assert.deepEqual(Buffer.from(sealed1.ciphertext), Buffer.from(sealed2.ciphertext))
  assert.deepEqual(Buffer.from(sealed1.merkleRoot), Buffer.from(sealed2.merkleRoot))

  // 5. findUnwrittenRangesFromChain detects valid chunks, partial writes, tampered byte, and unwritten tail across 2 Weights accounts.
  const totalCipher = sealed1.ciphertext.length
  const accSizes = [100_000, totalCipher - 100_000]
  const accKeys = [Keypair.generate().publicKey, Keypair.generate().publicKey]
  const disc = sha256(utf8('account:Weights')).subarray(0, 8)
  // Simulate partial upload:
  // - Account 0 (0..100,000): chunk 0 (0..65,552) fully written + first 10,000 bytes of chunk 1 written; bytes 75,552..100,000 still zero.
  // - Account 1 (100,000..end): chunk 2 first 20,000 bytes written with 1 tampered byte at local offset 40,000; rest zero.
  const simulatedPayloads = [new Uint8Array(accSizes[0]!), new Uint8Array(accSizes[1]!)]
  simulatedPayloads[0]!.set(sealed1.ciphertext.subarray(0, 75_552), 0)
  simulatedPayloads[1]!.set(sealed1.ciphertext.subarray(100_000, 145_000), 0)
  simulatedPayloads[1]![40_000] ^= 0xff // corrupt 1 byte inside chunk 2
  const simulatedWritten = [75_552, 45_000]

  const makeChainBuf = (idx: number) => {
    const buf = Buffer.alloc(56 + accSizes[idx]!)
    Buffer.from(disc).copy(buf, 0)
    modelAddress.toBuffer().copy(buf, 8)
    buf.writeUInt32LE(idx, 40)
    buf.writeUInt32LE(accSizes[idx]!, 44)
    buf.writeUInt32LE(simulatedWritten[idx]!, 48)
    buf.writeUInt32LE(idx === 0 ? 0 : accSizes[0]!, 52)
    Buffer.from(simulatedPayloads[idx]!).copy(buf, 56)
    return buf
  }
  const fakeConnection = {
    async getMultipleAccountsInfo(keys: PublicKey[]) {
      return keys.map(k => {
        const idx = accKeys.findIndex(item => item.equals(k))
        return { owner: programId, data: makeChainBuf(idx).subarray(0, 56) }
      })
    },
    async getAccountInfo(key: PublicKey, cfg?: { dataSlice?: { offset: number; length: number } }) {
      const idx = accKeys.findIndex(item => item.equals(key))
      const buf = makeChainBuf(idx)
      return { owner: programId, data: buf.subarray(cfg!.dataSlice!.offset, cfg!.dataSlice!.offset + cfg!.dataSlice!.length) }
    },
  } as unknown as Parameters<typeof findUnwrittenRangesFromChain>[0]['connection']

  const plan = await findUnwrittenRangesFromChain({
    connection: fakeConnection,
    programId,
    modelAddress,
    weightsAddresses: accKeys,
    ciphertext: sealed1.ciphertext,
    modelKey: fromWallet.modelKey,
    noncePrefix: fromWallet.noncePrefix,
    writeChunkBytes: 888,
  })
  assert.equal(plan.totalChunks, 4)
  assert.equal(plan.verifiedChunks, 1, 'chunk 0 must be verified valid and skipped')
  assert.equal(plan.bytesAlreadyValid, CIPHER_CHUNK_BYTES)
  assert(plan.unwritten.every(r => r.offset >= CIPHER_CHUNK_BYTES - 888), 'valid chunk 0 must not be re-uploaded')
  assert(plan.unwritten.length > 0 && plan.unwritten.length < Math.ceil(totalCipher / 888))

  // Apply ONLY the planned unwritten slices onto the simulated accounts and re-inspect.
  for (const slice of plan.unwritten) {
    if (slice.offset < accSizes[0]!) {
      simulatedPayloads[0]!.set(sealed1.ciphertext.subarray(slice.offset, slice.offset + slice.length), slice.offset)
      simulatedWritten[0] = Math.max(simulatedWritten[0]!, slice.offset + slice.length)
    } else {
      const local = slice.offset - accSizes[0]!
      simulatedPayloads[1]!.set(sealed1.ciphertext.subarray(slice.offset, slice.offset + slice.length), local)
      simulatedWritten[1] = Math.max(simulatedWritten[1]!, local + slice.length)
    }
  }
  assert.deepEqual(Buffer.concat(simulatedPayloads.map(p => Buffer.from(p))), Buffer.from(sealed1.ciphertext))
  assert.equal(simulatedWritten[0], accSizes[0])
  assert.equal(simulatedWritten[1], accSizes[1])
  const afterPlan = await findUnwrittenRangesFromChain({
    connection: fakeConnection,
    programId,
    modelAddress,
    weightsAddresses: accKeys,
    ciphertext: sealed1.ciphertext,
    modelKey: fromWallet.modelKey,
    noncePrefix: fromWallet.noncePrefix,
    writeChunkBytes: 888,
  })
  assert.equal(afterPlan.verifiedChunks, 4)
  assert.equal(afterPlan.unwritten.length, 0)
})

test('Build 3 Step 1: 4-era ModelCreated & 80B ModelSealed normalization, ModelBase validation, and createModelFootprint with base', async () => {
  const { MODEL_BASE_FORMATS, ModelBaseSchema, PROGRAM_LIMITS } = await import('@voynich/contract')
  const { fixtureModel, fixtureEnclave } = await import('@voynich/contract/fixtures')
  const { createModelFootprint } = await import('../src/chain/create-model.js')

  assert.deepEqual(MODEL_BASE_FORMATS, ['onnx', 'safetensors', 'gguf'])
  assert.equal(PROGRAM_LIMITS.baseFormatBytes, 32)
  assert.equal(PROGRAM_LIMITS.baseSourceBytes, 256)
  assert.equal(fixtureModel.base, null)

  // 1. ModelBase schema validation accepts valid bases and rejects zero hash, bad format, bad scheme, whitespace, control, oversize.
  const validBase = {
    sha256: 'ab'.repeat(32),
    sizeBytes: 1_048_576,
    format: 'safetensors' as const,
    source: 'hf://org/model/base.safetensors',
  }
  assert.deepEqual(ModelBaseSchema.parse(validBase), validBase)
  assert.equal(ModelBaseSchema.safeParse({ ...validBase, format: 'onnx', source: 'https://example.com/a.onnx' }).success, true)
  assert.equal(ModelBaseSchema.safeParse({ ...validBase, format: 'gguf', source: 'ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi' }).success, true)
  assert.equal(ModelBaseSchema.safeParse({ ...validBase, sha256: '00'.repeat(32) }).success, false)
  assert.equal(ModelBaseSchema.safeParse({ ...validBase, sizeBytes: 0 }).success, false)
  assert.equal(ModelBaseSchema.safeParse({ ...validBase, format: 'pt' }).success, false)
  assert.equal(ModelBaseSchema.safeParse({ ...validBase, source: 'file:///etc/passwd' }).success, false)
  assert.equal(ModelBaseSchema.safeParse({ ...validBase, source: 'https://example.com/has space.onnx' }).success, false)
  assert.equal(ModelBaseSchema.safeParse({ ...validBase, source: 'https://example.com/ctrl\n.onnx' }).success, false)
  assert.equal(ModelBaseSchema.safeParse({ ...validBase, source: `https://${'a'.repeat(256)}` }).success, false)

  // 2. Era 2 (Steps 4-6) ModelCreated (has upload_keys + hash_version, lacks base) pads +1B -> base: null.
  const { voynich } = chainPrograms({} as never)
  const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n, 0); return b }
  const u64 = (n: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(n, 0); return b }
  const u16 = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(n, 0); return b }
  const modelKey = Keypair.generate().publicKey
  const owner = Keypair.generate().publicKey
  const weightsKey = Keypair.generate().publicKey
  const uploadKey = Keypair.generate().publicKey
  const nameBytes = utf8('era2-model')
  const manifestBytes = utf8('{"name":"era2-model"}')
  const cipherBytes = utf8('xchacha20poly1305-64k-v1')
  const era2Event = Buffer.concat([
    sha256(utf8('event:ModelCreated')).subarray(0, 8),
    modelKey.toBytes(), owner.toBytes(),
    u32(nameBytes.length), nameBytes,
    u32(manifestBytes.length), manifestBytes,
    u32(1), weightsKey.toBytes(),
    u64(252_145n),
    u32(cipherBytes.length), cipherBytes,
    new Uint8Array(16).fill(3),
    u32(1), new Uint8Array(48).fill(0xab),
    u64(100_000n), PublicKey.default.toBytes(), u16(2500),
    uploadKey.toBytes(), u64(500n),
    u32(1), uploadKey.toBytes(),
    Uint8Array.of(1), // hash_version = 1
  ])
  const normEra2 = normalizeLegacyVoynichEvent(era2Event)
  assert.equal(normEra2.length, era2Event.length + 2)
  const decEra2 = voynich.coder.events.decode(toBase64(normEra2))
  assert.equal(decEra2?.name, 'modelCreated')
  assert.equal((decEra2?.data as { hashVersion: number; base: unknown }).hashVersion, 1)
  assert.equal((decEra2?.data as { base: unknown }).base, null)

  // 3. Legacy 80B ModelSealed pads +1B -> baseSha256: null, while 81B/113B ModelSealed stays unchanged.
  const legacySealed = Buffer.concat([
    sha256(utf8('event:ModelSealed')).subarray(0, 8),
    modelKey.toBytes(),
    new Uint8Array(32).fill(0xcd),
    u64(900n),
  ])
  assert.equal(legacySealed.length, 80)
  const normSealed = normalizeLegacyVoynichEvent(legacySealed)
  assert.equal(normSealed.length, 81)
  const decSealed = voynich.coder.events.decode(toBase64(normSealed))
  assert.equal(decSealed?.name, 'modelSealed')
  assert.equal((decSealed?.data as { baseSha256: unknown }).baseSha256, null)

  // 4. createModelFootprint accounts for base wire bytes and stays under 1104B with compact manifest.
  const configKey = addresses(voynich.programId).config
  const reqBase = {
    wallet: owner.toBase58(),
    uploadKey: uploadKey.toBase58(),
    uploadKeys: [uploadKey.toBase58()],
    weights: [weightsKey.toBase58()],
    name: 'adapter-v1',
    manifest: { name: 'adapter-v1', inputKind: 'tensor' as const, inputShape: [1, 4], labels: ['a', 'b'] },
    sizeBytes: 65_552,
    plaintextSizeBytes: 65_536,
    cipher: fixtureModel.cipher,
    price: fixtureModel.price,
    operatorShareBps: 2500,
    allowedMeasurements: [fixtureEnclave.measurement],
    uploadFundingLamports: '9000000',
  }
  const fpWithout = await createModelFootprint(voynich, configKey, modelKey, reqBase)
  const fpWith = await createModelFootprint(voynich, configKey, modelKey, { ...reqBase, base: validBase })
  // Option::Some(ModelBase) adds 32 + 8 + (4 + 11) + (4 + 31) = 90 bytes over Option::None (1 byte -> +90 bytes).
  assert.equal(fpWith.createTransactionBytes - fpWithout.createTransactionBytes, 90)
  assert.equal(fpWith.canCreate, true)
})

test('Build 3 Step 2: voynich/adapter (replace/delta/lora + ONNX parity), base-cache (miss/hit/corrupt/oversize/SSRF), and enclave /health bases', async () => {
  const { readFileSync } = await import('node:fs')
  const { applyOnnxAdapter, decodeAdapter, encodeAdapter, inspectOnnxInitializers } = await import('voynich/adapter')
  const { fetchVerifiedBase, resolveBaseUrl } = await import('../enclave/src/base-cache.js')
  const { basesMap, createEnclaveApp } = enclaveMod

  // 1. Inspect real sketch-32.onnx initializers (find a 2D weight matrix and a 1D bias vector).
  const baseOnnx = new Uint8Array(readFileSync('models/sketch-32/sketch-32.onnx'))
  const baseHash = toHex(sha256(baseOnnx))
  const inits = inspectOnnxInitializers(baseOnnx)
  assert(inits.length >= 2, 'sketch-32.onnx must expose float32 initializers')
  const mat2d = inits.find(item => item.dataType === 1 && item.dims.length === 2 && item.values && item.values.length > 0)!
  const vec1d = inits.find(item => item.dataType === 1 && item.dims.length === 1 && item.values && item.values.length === 32)!
  assert(mat2d && vec1d, 'sketch-32.onnx must have a 2D weight matrix and 32-element output bias')

  // 2. Zero-delta adapter round-trips encodeAdapter/decodeAdapter/applyOnnxAdapter with exact value parity.
  const zeroAdapter = encodeAdapter({
    baseSha256: baseHash,
    tensors: [{ name: vec1d.name, op: 'delta', dims: vec1d.dims, values: new Float32Array(vec1d.dims[0]!) }],
  })
  const decodedZero = decodeAdapter(zeroAdapter)
  assert.equal(decodedZero.version, 1)
  assert.equal(decodedZero.baseSha256, baseHash)
  assert.equal(decodedZero.tensors.length, 1)
  const mergedZero = applyOnnxAdapter(baseOnnx, zeroAdapter, baseHash)
  const afterZero = inspectOnnxInitializers(mergedZero).find(item => item.name === vec1d.name)!
  assert.deepEqual(Array.from(afterZero.values!), Array.from(vec1d.values!))

  // 3. replace, delta, and lora exact math verification + ONNX Runtime execution on merged model.
  const [outDim, inDim] = mat2d.dims as [number, number]
  const rank = 2
  const alpha = 4
  const a = new Float32Array(outDim * rank)
  const b = new Float32Array(rank * inDim)
  for (let i = 0; i < a.length; i++) a[i] = ((i % 5) - 2) * 0.1
  for (let i = 0; i < b.length; i++) b[i] = ((i % 7) - 3) * 0.05
  const biasDelta = new Float32Array(32)
  biasDelta[5] = 50.0 // strongly boost label index 5

  const loraDeltaAdapter = encodeAdapter({
    baseSha256: baseHash,
    tensors: [
      { name: mat2d.name, op: 'lora', dims: [outDim, inDim], rank, alpha, a, b },
      { name: vec1d.name, op: 'delta', dims: [32], values: biasDelta },
    ],
  })
  const mergedLora = applyOnnxAdapter(baseOnnx, loraDeltaAdapter, baseHash)
  const afterLora = inspectOnnxInitializers(mergedLora)
  const newMat = afterLora.find(item => item.name === mat2d.name)!.values!
  const scale = alpha / rank
  for (let r = 0; r < outDim; r++) {
    for (let c = 0; c < inDim; c++) {
      let dot = 0
      for (let k = 0; k < rank; k++) dot += a[r * rank + k]! * b[k * inDim + c]!
      const expected = mat2d.values![r * inDim + c]! + scale * dot
      assert(Math.abs(newMat[r * inDim + c]! - expected) < 1e-4, `LoRA mismatch at (${r},${c})`)
    }
  }
  const newBias = afterLora.find(item => item.name === vec1d.name)!.values!
  assert(Math.abs(newBias[5]! - (vec1d.values![5]! + 50.0)) < 1e-4)

  // Replace op test + ONNX Runtime session check on merged model.
  const replacedBias = new Float32Array(32).fill(-5.0)
  replacedBias[11] = 25.0
  const replaceAdapter = encodeAdapter({
    baseSha256: baseHash,
    tensors: [{ name: vec1d.name, op: 'replace', dims: [32], values: replacedBias }],
  })
  const mergedReplace = applyOnnxAdapter(baseOnnx, replaceAdapter, baseHash)
  const ort = await import('onnxruntime-node')
  const session = await ort.InferenceSession.create(mergedReplace, { executionProviders: ['cpu'] })
  try {
    const out = await session.run({ [session.inputNames[0]!]: new ort.Tensor('float32', new Float32Array(784), [1, 1, 28, 28]) })
    const logits = Array.from(out[session.outputNames[0]!]!.data as Float32Array)
    const topIndex = logits.indexOf(Math.max(...logits))
    assert.equal(topIndex, 11, 'replace adapter boosting bias[11] must select class index 11 in ONNX Runtime')
  } finally {
    await session.release()
  }

  // Rejections: bad magic, mismatched baseSha256, missing tensor name, mismatched dims.
  assert.throws(() => decodeAdapter(Uint8Array.from([0, 0, 0, 0, 1, 0, 0, 0, 0])), /magic/i)
  assert.throws(() => applyOnnxAdapter(baseOnnx, zeroAdapter, 'ff'.repeat(32)), /expected on-chain base hash/i)
  const wrongBaseAdapter = encodeAdapter({
    baseSha256: 'ff'.repeat(32),
    tensors: [{ name: vec1d.name, op: 'delta', dims: [32], values: new Float32Array(32) }],
  })
  assert.throws(() => applyOnnxAdapter(baseOnnx, wrongBaseAdapter), /baseSha256 does not match/i)
  const missingTensorAdapter = encodeAdapter({
    baseSha256: baseHash,
    tensors: [{ name: 'does_not_exist', op: 'delta', dims: [4], values: new Float32Array(4) }],
  })
  assert.throws(() => applyOnnxAdapter(baseOnnx, missingTensorAdapter), /not found/i)
  const badDimsAdapter = encodeAdapter({
    baseSha256: baseHash,
    tensors: [{ name: vec1d.name, op: 'delta', dims: [16], values: new Float32Array(16) }],
  })
  assert.throws(() => applyOnnxAdapter(baseOnnx, badDimsAdapter), /dims/i)

  // 4. resolveBaseUrl + SSRF blocking.
  assert.equal(resolveBaseUrl('hf://voynich/open-base@v1/model.onnx', { allowLocal: false }), 'https://huggingface.co/voynich/open-base/resolve/v1/model.onnx')
  assert.equal(resolveBaseUrl('hf://voynich/open-base/sub/model.onnx', { allowLocal: false }), 'https://huggingface.co/voynich/open-base/resolve/main/sub/model.onnx')
  assert.equal(resolveBaseUrl('ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi/base.onnx', { allowLocal: false }), 'https://ipfs.io/ipfs/bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi/base.onnx')
  assert.throws(() => resolveBaseUrl('http://127.0.0.1:8080/base.onnx', { allowLocal: false }), /private or loopback/i)
  assert.throws(() => resolveBaseUrl('http://169.254.169.254/latest/meta-data', { allowLocal: false }), /private or loopback/i)
  assert.equal(resolveBaseUrl('http://127.0.0.1:8080/base.onnx', { allowLocal: true }), 'http://127.0.0.1:8080/base.onnx')

  // 5. fetchVerifiedBase: cache miss -> hit -> corrupt cache recovery -> oversize -> hash mismatch.
  const cacheDir = mkdtempSync(join(tmpdir(), 'voynich-base-cache-'))
  try {
    const sampleBase = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80])
    const sampleHash = toHex(sha256(sampleBase))
    const baseRef = { sha256: sampleHash, sizeBytes: sampleBase.length, format: 'onnx', source: 'https://example.com/sample.onnx' }
    let fetchCount = 0
    const mockFetch = (payload: Uint8Array, extraBytes = 0): typeof fetch => (async () => {
      fetchCount++
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(payload.subarray(0, 4))
          controller.enqueue(payload.subarray(4))
          if (extraBytes > 0) controller.enqueue(new Uint8Array(extraBytes))
          controller.close()
        },
      })
      return new Response(body, { status: 200 })
    }) as typeof fetch

    const miss = await fetchVerifiedBase(baseRef, { cacheDir, allowLocal: false, fetch: mockFetch(sampleBase) })
    assert.equal(miss.fromCache, false)
    assert.equal(fetchCount, 1)
    assert.deepEqual(Buffer.from(miss.bytes), Buffer.from(sampleBase))

    const hit = await fetchVerifiedBase(baseRef, { cacheDir, allowLocal: false, fetch: mockFetch(sampleBase) })
    assert.equal(hit.fromCache, true)
    assert.equal(fetchCount, 1, 'valid cache hit must not refetch over network')

    // Corrupt cached file on disk -> fetchVerifiedBase must detect hash mismatch, delete, and recover cleanly.
    writeFileSync(miss.cachePath, Uint8Array.from([99, 99, 99, 99, 99, 99, 99, 99]))
    const recovered = await fetchVerifiedBase(baseRef, { cacheDir, allowLocal: false, fetch: mockFetch(sampleBase) })
    assert.equal(recovered.fromCache, false)
    assert.equal(fetchCount, 2)
    assert.deepEqual(Buffer.from(recovered.bytes), Buffer.from(sampleBase))

    // Oversize stream and wrong-hash stream must fail before caching.
    const badBase = { ...baseRef, sha256: '11'.repeat(32) }
    await assert.rejects(() => fetchVerifiedBase(badBase, { cacheDir, allowLocal: false, fetch: mockFetch(sampleBase, 4) }), /exceeded declared sizeBytes/i)
    await assert.rejects(() => fetchVerifiedBase(badBase, { cacheDir, allowLocal: false, fetch: mockFetch(sampleBase) }), /SHA-256 mismatch/i)
  } finally {
    rmSync(cacheDir, { recursive: true, force: true })
  }

  // 6. Enclave /health exposes bases alongside openWeightsSeconds and grantToFirstAnswerSeconds.
  const mBase = Keypair.generate().publicKey.toBase58()
  const baseMeta = { sha256: baseHash, sizeBytes: baseOnnx.length, format: 'onnx', source: 'https://example.com/sketch-32.onnx' }
  assert.deepEqual(basesMap({ [mBase]: { grantLoadedAtMs: 1000, openBaseMs: 245, base: baseMeta } }), {
    [mBase]: { ...baseMeta, openBaseSeconds: 0.245 },
  })
  const app = createEnclaveApp({
    enclave: Keypair.generate().publicKey,
    softwareMeasurement: 'ab'.repeat(48),
    loaded: new Map([[mBase, {} as never]]),
    state: { modelTimings: { [mBase]: { grantLoadedAtMs: 1000, openWeightsMs: 55, openBaseMs: 245, base: baseMeta, firstAnswerAtMs: 1800, grantToFirstAnswerMs: 800 } } },
    acceptInput: async () => {},
    getAnswer: async () => { throw new Error('unused') },
  }, () => true)
  const res = await app.request('http://127.0.0.1:9707/health')
  assert.equal(res.status, 200)
  const body = await res.json() as { bases: Record<string, unknown>; openWeightsSeconds: Record<string, number | null>; grantToFirstAnswerSeconds: Record<string, number | null> }
  assert.deepEqual(body.bases, { [mBase]: { ...baseMeta, openBaseSeconds: 0.245 } })
  assert.deepEqual(body.openWeightsSeconds, { [mBase]: 0.055 })
  assert.deepEqual(body.grantToFirstAnswerSeconds, { [mBase]: 0.8 })
})

test('Build 3 Step 3: text Manifest/TokenizerRef round-trip and byte-level/bpe/word-piece tokenizers + hash rejection', async () => {
  const { createHash } = await import('node:crypto')
  const { mkdtempSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { Manifest, TokenizerRef, decodeManifest, encodeManifest } = await import('@voynich/contract')
  const { fixtureManifest } = await import('@voynich/contract/fixtures')
  const { createByteLevelTokenizer, loadTokenizer, parseHuggingFaceTokenizer } = await import('../enclave/src/tokenizer.js')

  // 1. Text Manifest validation & encodeManifest/decodeManifest round-trip (plus sketch defaults preserved).
  const textManifest = Manifest.parse({
    name: 'tiny-text',
    inputKind: 'text',
    tokenizer: {
      format: 'byte-level',
      vocabSize: 258,
      maxInputTokens: 64,
      maxOutputTokens: 32,
      bosTokenId: 256,
      eosTokenId: 257,
    },
  })
  assert.equal(textManifest.inputKind, 'text')
  assert.equal(textManifest.inputShape, undefined)
  assert.equal(textManifest.labels, undefined)
  assert.deepEqual(decodeManifest(encodeManifest(textManifest)), textManifest)

  // Sketch defaults still compress and restore identically.
  const compactSketch = encodeManifest(fixtureManifest)
  const parsedSketch = JSON.parse(new TextDecoder().decode(compactSketch)) as Record<string, unknown>
  assert.equal(parsedSketch.inputShape, undefined)
  assert.deepEqual(decodeManifest(compactSketch), fixtureManifest)

  // Invalid manifests & tokenizer refs are rejected.
  assert.throws(() => Manifest.parse({ name: 'bad-text', inputKind: 'text' }), /tokenizer/i)
  assert.throws(() => Manifest.parse({ name: 'bad-tensor', inputKind: 'tensor', labels: ['a'] }), /inputShape/i)
  assert.throws(() => Manifest.parse({ name: 'bad-tensor-2', inputKind: 'tensor', inputShape: [1, 4] }), /labels/i)
  assert.throws(() => TokenizerRef.parse({ format: 'bpe', vocabSize: 100, maxInputTokens: 16 }), /source|sha256/i)
  assert.throws(() => TokenizerRef.parse({ format: 'word-piece', source: 'https://example.com/tok.json', vocabSize: 100, maxInputTokens: 16 }), /sha256/i)
  assert.throws(() => TokenizerRef.parse({ format: 'byte-level', vocabSize: 256, maxInputTokens: 16, eosTokenId: 256 }), /vocabSize/i)

  // 2. byte-level tokenizer encode/decode + BOS/EOS/PAD filtering + maxInputTokens truncation.
  const byteTok = createByteLevelTokenizer({
    format: 'byte-level',
    vocabSize: 259,
    maxInputTokens: 6,
    bosTokenId: 256,
    eosTokenId: 257,
    padTokenId: 258,
  })
  const encodedBytes = byteTok.encode('voynich')
  assert.deepEqual(encodedBytes, [256, 118, 111, 121, 110, 105])
  assert.equal(byteTok.decode([256, 118, 111, 121, 257, 258]), 'voy')

  // 3. Hugging Face BPE (ByteLevel) tokenizer + SHA-256 verified loadTokenizer + hash mismatch rejection.
  const bpeDoc = JSON.stringify({
    model: {
      type: 'BPE',
      vocab: { h: 0, i: 1, hi: 2, '\u0120': 3, a: 4, '\u0120a': 5, '<|endoftext|>': 6 },
      merges: ['h i', ['\u0120', 'a']],
    },
    added_tokens: [{ id: 6, content: '<|endoftext|>', special: true }],
    pre_tokenizer: { type: 'ByteLevel', add_prefix_space: false },
    decoder: { type: 'ByteLevel' },
  })
  const bpeBytes = new TextEncoder().encode(bpeDoc)
  const bpeHash = createHash('sha256').update(bpeBytes).digest('hex')
  const cacheDir = mkdtempSync(join(tmpdir(), 'voynich-tok-cache-'))
  try {
    const bpeRef = TokenizerRef.parse({
      format: 'bpe',
      source: 'https://example.com/bpe-tokenizer.json',
      sha256: bpeHash,
      vocabSize: 7,
      maxInputTokens: 16,
      eosTokenId: 6,
    })
    const loadedBpe = await loadTokenizer(bpeRef, {
      cacheDir,
      allowLocal: false,
      fetch: (async () => new Response(bpeBytes, { status: 200 })) as typeof fetch,
    })
    assert.deepEqual(loadedBpe.encode('hi a'), [2, 5])
    assert.equal(loadedBpe.decode([2, 5, 6]), 'hi a')

    await assert.rejects(
      () => loadTokenizer({ ...bpeRef, sha256: '22'.repeat(32) }, {
        cacheDir,
        allowLocal: false,
        fetch: (async () => new Response(bpeBytes, { status: 200 })) as typeof fetch,
      }),
      /SHA-256 mismatch/i,
    )
  } finally {
    rmSync(cacheDir, { recursive: true, force: true })
  }

  // 4. Hugging Face WordPiece tokenizer encode/decode.
  const wpDoc = JSON.stringify({
    normalizer: { type: 'BertNormalizer', lowercase: true },
    model: {
      type: 'WordPiece',
      unk_token: '[UNK]',
      continuing_subword_prefix: '##',
      vocab: { '[UNK]': 0, '[CLS]': 1, '[SEP]': 2, play: 3, '##ing': 4, sun: 5 },
    },
    added_tokens: [
      { id: 1, content: '[CLS]', special: true },
      { id: 2, content: '[SEP]', special: true },
    ],
    decoder: { type: 'WordPiece', prefix: '##' },
  })
  const wpTok = parseHuggingFaceTokenizer(wpDoc, {
    format: 'word-piece',
    source: 'https://example.com/wp.json',
    sha256: '33'.repeat(32),
    vocabSize: 6,
    maxInputTokens: 16,
    bosTokenId: 1,
    eosTokenId: 2,
  })
  assert.deepEqual(wpTok.encode('Playing sun zzz'), [1, 3, 4, 5, 0])
  assert.equal(wpTok.decode([1, 3, 4, 5, 2]), 'playing sun')

})

test('Build 3 Step 4: CLI --base/--base-file resolution, pre-flight adapter/ONNX mismatch rejections, client.seal() guard, and --resume base inheritance', async () => {
  const { createHash } = await import('node:crypto')
  const { mkdtempSync, readFileSync, rmSync, writeFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join, resolve } = await import('node:path')
  const { encodeAdapter, inspectOnnxInitializers, verifyOnnxAdapterCompatibility } = await import('voynich/adapter')
  const { createVoynich } = await import('voynich')
  const { resolveCliSealBase } = await import('../sdk/src/seal-base.js')

  const sketchPath = resolve('models/sketch-32/sketch-32.onnx')
  const sketchBytes = new Uint8Array(readFileSync(sketchPath))
  const sketchSha = createHash('sha256').update(sketchBytes).digest('hex')
  const initializers = inspectOnnxInitializers(sketchBytes)
  const bias = initializers.find(t => t.dataType === 1 && t.dims.length === 1 && t.dims[0] === 32)!
  assert.ok(bias)

  const validAdapter = encodeAdapter({
    baseSha256: sketchSha,
    tensors: [{ name: bias.name, op: 'delta', dims: [32], values: new Float32Array(32) }],
  })
  const wrongHashAdapter = encodeAdapter({
    baseSha256: '44'.repeat(32),
    tensors: [{ name: bias.name, op: 'delta', dims: [32], values: new Float32Array(32) }],
  })
  const missingTensorAdapter = encodeAdapter({
    baseSha256: sketchSha,
    tensors: [{ name: 'does_not_exist_weight', op: 'delta', dims: [32], values: new Float32Array(32) }],
  })
  const wrongDimsAdapter = encodeAdapter({
    baseSha256: sketchSha,
    tensors: [{ name: bias.name, op: 'delta', dims: [16], values: new Float32Array(16) }],
  })

  // 1. --base <url> + --base-file <sketch-32.onnx> auto-computes sha256, sizeBytes, format='onnx' and passes compatibility.
  const fromUrlAndFile = await resolveCliSealBase({
    flags: { base: 'https://example.com/sketch-32.onnx', baseFile: sketchPath },
    weights: validAdapter,
  })
  assert.deepEqual(fromUrlAndFile, {
    source: 'https://example.com/sketch-32.onnx',
    sha256: sketchSha,
    sizeBytes: sketchBytes.length,
    format: 'onnx',
  })

  // 2. --base <json-file> resolves full ModelBase JSON cleanly.
  const dir = mkdtempSync(join(tmpdir(), 'voynich-b3s4-'))
  try {
    const baseJsonPath = join(dir, 'base.json')
    writeFileSync(baseJsonPath, JSON.stringify({
      source: 'hf://voynich/sketch-32/sketch-32.onnx',
      sha256: sketchSha,
      sizeBytes: sketchBytes.length,
      format: 'onnx',
    }))
    const fromJson = await resolveCliSealBase({
      flags: { base: baseJsonPath },
      weights: validAdapter,
    })
    assert.deepEqual(fromJson, {
      source: 'hf://voynich/sketch-32/sketch-32.onnx',
      sha256: sketchSha,
      sizeBytes: sketchBytes.length,
      format: 'onnx',
    })

    // 3. Explicit --base <url> + --base-sha256 + --base-size + --base-format works without --base-file.
    const fromIndividual = await resolveCliSealBase({
      flags: {
        base: 'ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
        baseSha256: sketchSha,
        baseSize: String(sketchBytes.length),
        baseFormat: 'onnx',
      },
      weights: validAdapter,
    })
    assert.equal(fromIndividual?.sha256, sketchSha)
    assert.equal(fromIndividual?.sizeBytes, sketchBytes.length)
    assert.equal(fromIndividual?.format, 'onnx')

    // 4. Pre-flight mismatch rejections: wrong baseSha256, missing base tensor, wrong dims, non-VOYA weights, file hash mismatch.
    await assert.rejects(
      () => resolveCliSealBase({ flags: { base: 'https://example.com/s.onnx', baseFile: sketchPath }, weights: wrongHashAdapter }),
      /baseSha256.*does not match/i,
    )
    await assert.rejects(
      () => resolveCliSealBase({ flags: { base: 'https://example.com/s.onnx', baseFile: sketchPath }, weights: missingTensorAdapter }),
      /not found in the base ONNX graph/i,
    )
    await assert.rejects(
      () => resolveCliSealBase({ flags: { base: 'https://example.com/s.onnx', baseFile: sketchPath }, weights: wrongDimsAdapter }),
      /dims.*do not match/i,
    )
    await assert.rejects(
      () => resolveCliSealBase({ flags: { base: 'https://example.com/s.onnx', baseFile: sketchPath }, weights: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]) }),
      /VOYA|adapter|short/i,
    )
    await assert.rejects(
      () => resolveCliSealBase({ flags: { base: 'https://example.com/s.onnx', baseFile: sketchPath, baseSha256: '55'.repeat(32) }, weights: validAdapter }),
      /does not match local --base-file SHA-256/i,
    )
    const compat = verifyOnnxAdapterCompatibility(sketchBytes, validAdapter, sketchSha)
    assert.equal(compat.matchedTensors, 1)

    // 5. --resume base inheritance: inherits existingBase when no --base flags are supplied and rejects mismatched weights.
    const inherited = await resolveCliSealBase({
      flags: {},
      weights: validAdapter,
      existingBase: fromUrlAndFile,
    })
    assert.deepEqual(inherited, fromUrlAndFile)
    await assert.rejects(
      () => resolveCliSealBase({ flags: {}, weights: wrongHashAdapter, existingBase: fromUrlAndFile }),
      /does not match existing model base/i,
    )

    // 6. client.seal() rejects non-VOYA weights and mismatched baseSha256 BEFORE any quote/create API call.
    let apiCalls = 0
    const mockFetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/v1/config')) {
        return new Response(JSON.stringify({
          mode: 'fixture', cluster: 'localnet', rpcUrl: 'http://127.0.0.1:9704',
          programId: null, attestationProgramId: null, bountyProgramId: null,
          attestationRecordLayoutVersion: 1, feeRecipient: null, protocolShareBps: 500,
          callDeadlineSlots: '300', maxOpenAnswerBytes: 1024, tokenMint: null, fixture: true,
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      apiCalls += 1
      throw new Error(`Unexpected API call before pre-flight guard: ${url}`)
    }) as typeof fetch
    const sdk = createVoynich({ apiUrl: 'http://127.0.0.1:9702', signer: Keypair.generate(), fetch: mockFetch })
    const manifest = { name: 'guard-test', inputKind: 'tensor' as const, inputShape: [1, 4], labels: ['a', 'b'] }
    const sealCommon = {
      manifest,
      price: { amount: '1000', mint: null, decimals: 9, symbol: 'SOL' },
      operatorShareBps: 2500,
      allowedMeasurements: ['ab'.repeat(48)],
      uploadFundingLamports: '1000000',
      base: fromUrlAndFile!,
    }
    await assert.rejects(() => sdk.seal({ ...sealCommon, weights: new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2, 1, 0]) }), /VOYA|adapter|magic/i)
    await assert.rejects(() => sdk.seal({ ...sealCommon, weights: wrongHashAdapter }), /baseSha256.*does not match/i)
    assert.equal(apiCalls, 0, 'client.seal() must reject invalid/mismatched adapter before any quote/create API call')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('Build 3 Step 5: text-1m artifacts, verifyOnnxAdapterCompatibility, applyOnnxAdapter in onnxruntime-node, coherent generation, and <500ms/32tok CPU latency', async () => {
  const { createHash } = await import('node:crypto')
  const { readFileSync } = await import('node:fs')
  const { resolve } = await import('node:path')
  const ort = await import('onnxruntime-node')
  const { Manifest, decodeManifest, encodeManifest } = await import('@voynich/contract')
  const { applyOnnxAdapter, verifyOnnxAdapterCompatibility } = await import('voynich/adapter')

  const modelDir = resolve('models/text-1m')
  const baseBytes = new Uint8Array(readFileSync(resolve(modelDir, 'text-1m-base.onnx')))
  const adapterBytes = new Uint8Array(readFileSync(resolve(modelDir, 'text-1m.voya')))
  const manifestRaw = JSON.parse(readFileSync(resolve(modelDir, 'manifest.json'), 'utf8')) as unknown
  const baseJson = JSON.parse(readFileSync(resolve(modelDir, 'base.json'), 'utf8')) as { sha256: string; sizeBytes: number; format: string }
  const metrics = JSON.parse(readFileSync(resolve(modelDir, 'metrics.json'), 'utf8')) as {
    baseHeldOutLoss: number; adapterHeldOutLoss: number; onnxMaxLogitDiff: number; cpuMsPer32Tokens: number; compressionRatio: number
  }

  // 1. Manifest & base.json integrity.
  const manifest = Manifest.parse(manifestRaw)
  assert.equal(manifest.name, 'text-1m')
  assert.equal(manifest.inputKind, 'text')
  assert.deepEqual(decodeManifest(encodeManifest(manifest)), manifest)
  const actualSha = createHash('sha256').update(baseBytes).digest('hex')
  assert.equal(baseJson.sha256, actualSha)
  assert.equal(baseJson.sizeBytes, baseBytes.length)
  assert.equal(baseJson.format, 'onnx')
  assert(metrics.adapterHeldOutLoss < metrics.baseHeldOutLoss, 'Adapter must improve held-out loss over frozen base')
  assert(metrics.onnxMaxLogitDiff < 1e-4, `Expected onnxMaxLogitDiff < 1e-4, got ${metrics.onnxMaxLogitDiff}`)
  assert(metrics.compressionRatio > 20, `Expected >20x compression, got ${metrics.compressionRatio}`)

  // 2. verifyOnnxAdapterCompatibility & applyOnnxAdapter merge strictly in memory.
  const compat = verifyOnnxAdapterCompatibility(baseBytes, adapterBytes, actualSha)
  assert.equal(compat.baseSha256, actualSha)
  assert.equal(compat.baseSizeBytes, baseBytes.length)
  assert.equal(compat.matchedTensors, 18) // 16 attention projections + lm_head_w + lm_head_b

  const mergedOnnx = applyOnnxAdapter(baseBytes, adapterBytes, actualSha)
  const session = await ort.InferenceSession.create(mergedOnnx, { executionProviders: ['cpu'] })
  try {
    const prompt = 'Q: What is Voynich?\nA:'
    const bos = manifest.tokenizer!.bosTokenId!
    const eos = manifest.tokenizer!.eosTokenId!
    const runGreedy = async (maxTokens: number) => {
      const ids: number[] = [bos, ...new TextEncoder().encode(prompt)]
      const generated: number[] = []
      let finishReason: 'eos' | 'length' = 'length'
      for (let step = 0; step < maxTokens; step++) {
        const window = ids.slice(-128)
        const tensor = new ort.Tensor('int64', BigInt64Array.from(window, v => BigInt(v)), [1, window.length])
        const out = await session.run({ input_ids: tensor })
        const data = out.logits!.data as Float32Array
        const offset = (window.length - 1) * 258
        let bestId = 0
        let bestVal = -Infinity
        for (let v = 0; v < 258; v++) {
          if (data[offset + v]! > bestVal) { bestVal = data[offset + v]!; bestId = v }
        }
        if (bestId === eos) { finishReason = 'eos'; break }
        generated.push(bestId)
        ids.push(bestId)
      }
      return { text: new TextDecoder().decode(Uint8Array.from(generated)), tokens: generated.length, finishReason }
    }

    const sample = await runGreedy(64)
    assert.equal(sample.finishReason, 'eos')
    assert.equal(sample.text, ' Voynich runs sealed models on Solana with verified receipts.')

    const t0 = Date.now()
    const bench = await runGreedy(32)
    const elapsedMs = Date.now() - t0
    assert.equal(bench.tokens, 32)
    assert(elapsedMs < 500, `Expected < 500ms for 32 tokens on CPU onnxruntime-node, got ${elapsedMs}ms`)
  } finally {
    await session.release()
  }
})

test('Build 3 Step 6: receiptMessage v1/v2, decodeModelBaseBytes (6000B legacy & 8192B), and client.verify() 5/5 + legacy pre-v2 separation', async () => {
  const { PublicKey } = await import('@solana/web3.js')
  const { createVoynich } = await import('voynich')
  const {
    fromHex, receiptMessage, sha256, signReceipt, toBase64, toHex, utf8, verifyReceipt,
  } = await import('voynich/crypto')
  const {
    ATTESTATION_PROGRAM_ID, BN, PROGRAM_ID, addresses, chainPrograms, decodeModelBaseBytes,
  } = await import('voynich/program')

  // 1. v1 (114B) and v2 (146B) receiptMessage, signReceipt, verifyReceipt.
  const signing = Keypair.generate()
  const callKey = Keypair.generate().publicKey
  const inputHash = sha256(utf8('step6-input'))
  const outputHash = sha256(utf8('step6-output'))
  const baseSha = sha256(utf8('step6-base-onnx'))
  const wrongBaseSha = sha256(utf8('step6-wrong-base'))

  const msgV1 = receiptMessage(callKey.toBytes(), inputHash, outputHash)
  const msgV2 = receiptMessage(callKey.toBytes(), inputHash, outputHash, baseSha)
  assert.equal(msgV1.length, 114)
  assert.equal(new TextDecoder().decode(msgV1.subarray(0, 18)), 'voynich/receipt/v1')
  assert.equal(msgV2.length, 146)
  assert.equal(new TextDecoder().decode(msgV2.subarray(0, 18)), 'voynich/receipt/v2')
  assert.deepEqual(Buffer.from(msgV2.subarray(114, 146)), Buffer.from(baseSha))

  const sigV1 = signReceipt(signing.secretKey.subarray(0, 32), callKey.toBytes(), inputHash, outputHash)
  const sigV2 = signReceipt(signing.secretKey.subarray(0, 32), callKey.toBytes(), inputHash, outputHash, baseSha)
  assert.equal(verifyReceipt(sigV1, signing.publicKey.toBytes(), callKey.toBytes(), inputHash, outputHash), true)
  assert.equal(verifyReceipt(sigV1, signing.publicKey.toBytes(), callKey.toBytes(), inputHash, outputHash, baseSha), false)
  assert.equal(verifyReceipt(sigV2, signing.publicKey.toBytes(), callKey.toBytes(), inputHash, outputHash, baseSha), true)
  assert.equal(verifyReceipt(sigV2, signing.publicKey.toBytes(), callKey.toBytes(), inputHash, outputHash), false)
  assert.equal(verifyReceipt(sigV2, signing.publicKey.toBytes(), callKey.toBytes(), inputHash, outputHash, wrongBaseSha), false)
  assert.equal(verifyReceipt(sigV2, signing.publicKey.toBytes(), callKey.toBytes(), inputHash, outputHash, new Uint8Array(16)), false)

  // 2. decodeModelBaseBytes on 6,000B legacy Model, 8,192B Model without base, and 8,192B Model with base.
  const { voynich, attest } = chainPrograms({} as never)
  const owner = Keypair.generate().publicKey
  const operator = Keypair.generate().publicKey
  const feeRecipient = Keypair.generate().publicKey
  const caller = Keypair.generate().publicKey
  const measurement = Array.from({ length: 48 }, (_, i) => (i + 1) & 255)
  const baseObj = {
    sha256: toHex(baseSha),
    sizeBytes: 6_143_522,
    format: 'onnx' as const,
    source: 'https://example.com/text-1m-base.onnx',
  }

  const encodeModelAccount = async (name: string, base: typeof baseObj | null, totalSpace: number) => {
    const encoded = await voynich.coder.accounts.encode('model', {
      owner,
      name,
      manifest: Buffer.from(JSON.stringify({ name, inputKind: 'tensor', inputShape: [1, 4], labels: ['a'] })),
      weights: [Keypair.generate().publicKey],
      sizeBytes: new BN(1024),
      cipher: 'xchacha20poly1305-64k-v1',
      noncePrefix: Array(16).fill(1),
      ciphertextSha256: Array(32).fill(2),
      allowedMeasurements: [measurement],
      price: new BN(1_000_000),
      priceMint: PublicKey.default,
      operatorShareBps: 2500,
      uploadKey: PublicKey.default,
      status: { live: {} },
      createdSlot: new BN(10),
      sealedSlot: new BN(20),
      callsSettled: new BN(1),
      bump: 255,
      uploadKeys: [],
      hashVersion: 1,
      sealedChunks: 1,
      merkleFrontier: [],
      merkleFrontierMask: 0,
      base: base ? { sha256: Array.from(fromHex(base.sha256)), sizeBytes: new BN(base.sizeBytes), format: base.format, source: base.source } : null,
      priceUnit: { call: {} },
    })
    const padded = Buffer.alloc(totalSpace)
    encoded.copy(padded)
    return padded
  }

  const legacy6000 = await encodeModelAccount('sketch-32', null, 6000)
  const currentNoBase = await encodeModelAccount('sketch-32', null, 8192)
  const currentWithBase = await encodeModelAccount('text-1m', baseObj, 8192)
  assert.equal(decodeModelBaseBytes(legacy6000), null)
  assert.equal(decodeModelBaseBytes(currentNoBase), null)
  assert.deepEqual(decodeModelBaseBytes(currentWithBase), baseObj)

  // 3. client.verify() 5/5 checks: standalone v1, adapter v2, pre-v2 legacy adapter (signature: true, base: false), wrong base, tampered view.modelBase.
  const derived = addresses(PROGRAM_ID, ATTESTATION_PROGRAM_ID)
  const enclaveKey = derived.enclave(signing.publicKey)
  const recordKey = derived.record(signing.publicKey)
  const encPub = Uint8Array.from({ length: 32 }, (_, i) => i + 10)
  const configBuf = await voynich.coder.accounts.encode('config', {
    admin: owner,
    attestationProgram: ATTESTATION_PROGRAM_ID,
    recordLayoutVersion: 1,
    feeRecipient,
    protocolShareBps: 500,
    callDeadlineSlots: new BN(300),
    bump: 254,
    maxOpenAnswerBytes: 1024,
  })
  const enclaveBuf = await voynich.coder.accounts.encode('enclave', {
    signingKey: signing.publicKey,
    encryptionKey: Array.from(encPub),
    operator,
    attestationRecord: recordKey,
    measurement,
    expiresAtSlot: new BN(500),
    endpoint: 'https://enclave.example.com',
    callsSettled: new BN(1),
    bump: 253,
  })
  const recordBuf = await attest.coder.accounts.encode('attestationRecord', {
    layoutVersion: 1,
    signingKey: signing.publicKey,
    hardwareType: { dev: {} },
    measurement,
    recordedSlot: new BN(50),
    expiresAtSlot: new BN(500),
    reportSlot: new BN(50),
  })

  const runVerifyCase = async (params: {
    modelName: string
    modelBuf: Buffer
    signatureBytes: Uint8Array
    viewModelBase: typeof baseObj | null
  }) => {
    const modelKey = derived.model(params.modelName)
    const callAddr = derived.call(caller, 1n)
    const receiptKey = derived.receipt(callAddr)
    const sig = params.signatureBytes
    const receiptBuf = await voynich.coder.accounts.encode('receipt', {
      call: callAddr,
      model: modelKey,
      enclave: enclaveKey,
      inputHash: Array.from(inputHash),
      outputHash: Array.from(outputHash),
      signature: Array.from(sig),
      slot: new BN(100),
      priceMint: PublicKey.default,
      total: new BN(1_000_000),
      owner,
      operator,
      feeRecipient,
      ownerAmount: new BN(700_000),
      operatorAmount: new BN(250_000),
      protocolAmount: new BN(50_000),
      bump: 252,
      answerMode: { sealed: {} },
      openAnswer: Buffer.alloc(0),
      callerIsProgram: false,
    })

    const accountsByKey = new Map<string, { owner: PublicKey; data: Buffer }>([
      [derived.config.toBase58(), { owner: PROGRAM_ID, data: configBuf }],
      [receiptKey.toBase58(), { owner: PROGRAM_ID, data: receiptBuf }],
      [enclaveKey.toBase58(), { owner: PROGRAM_ID, data: enclaveBuf }],
      [recordKey.toBase58(), { owner: ATTESTATION_PROGRAM_ID, data: recordBuf }],
      [modelKey.toBase58(), { owner: PROGRAM_ID, data: params.modelBuf }],
    ])
    const mockConnection = {
      async getMultipleAccountsInfo(keys: PublicKey[]) {
        return keys.map(k => accountsByKey.get(k.toBase58()) ?? null)
      },
    }
    const mockFetch = (async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/v1/config')) {
        return new Response(JSON.stringify({
          mode: 'chain', cluster: 'mainnet-beta', rpcUrl: 'https://rpc.example.com',
          programId: PROGRAM_ID.toBase58(), attestationProgramId: ATTESTATION_PROGRAM_ID.toBase58(),
          bountyProgramId: null, attestationRecordLayoutVersion: 1, feeRecipient: feeRecipient.toBase58(),
          protocolShareBps: 500, callDeadlineSlots: '300', maxOpenAnswerBytes: 1024, tokenMint: null, fixture: false,
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      throw new Error(`Unexpected fetch ${String(input)}`)
    }) as typeof fetch

    const sdk = createVoynich({
      apiUrl: 'http://127.0.0.1:9702',
      connection: mockConnection as never,
      fetch: mockFetch,
    })
    return sdk.verify(receiptKey.toBase58(), {
      receipt: {
        receipt: {
          address: receiptKey.toBase58(),
          call: callAddr.toBase58(),
          caller: caller.toBase58(),
          callerIsProgram: false,
          model: modelKey.toBase58(),
          modelName: params.modelName,
          enclave: enclaveKey.toBase58(),
          inputHash: toHex(inputHash),
          outputHash: toHex(outputHash),
          signature: toBase64(sig),
          answerMode: 'sealed',
          openAnswer: null,
          deliveredCount: null,
          returnedAmount: null,
          slot: '100',
          transactionSignature: '1'.repeat(88),
          payments: {
            mint: null,
            total: '1000000',
            owner: { recipient: owner.toBase58(), amount: '700000' },
            operator: { recipient: operator.toBase58(), amount: '250000' },
            protocol: { recipient: feeRecipient.toBase58(), amount: '50000' },
          },
        },
        enclaveSigningKey: signing.publicKey.toBase58(),
        attestationRecord: {
          address: recordKey.toBase58(),
          signingKey: signing.publicKey.toBase58(),
          encryptionKey: toBase64(encPub),
          hardwareType: 'dev',
          measurement: toHex(Uint8Array.from(measurement)),
          recordedSlot: '50',
          expiresAtSlot: '500',
          layoutVersion: 1,
        },
        attestationProgramId: ATTESTATION_PROGRAM_ID.toBase58(),
        recordLayoutVersion: 1,
        modelBase: params.viewModelBase,
      },
    })
  }

  const callAddrSketch = derived.call(caller, 1n)
  const v1ForCall = signReceipt(signing.secretKey.subarray(0, 32), callAddrSketch.toBytes(), inputHash, outputHash)
  const v2ForCall = signReceipt(signing.secretKey.subarray(0, 32), callAddrSketch.toBytes(), inputHash, outputHash, baseSha)
  const v2WrongBase = signReceipt(signing.secretKey.subarray(0, 32), callAddrSketch.toBytes(), inputHash, outputHash, wrongBaseSha)

  // Standalone legacy 6000B model + v1 sig -> 5/5 pass.
  const standaloneRes = await runVerifyCase({ modelName: 'sketch-32', modelBuf: legacy6000, signatureBytes: v1ForCall, viewModelBase: null })
  assert.equal(standaloneRes.verified, true)
  assert.equal(standaloneRes.signature, true)
  assert.equal(standaloneRes.base, true)

  // Adapter 8192B model + v2 sig -> 5/5 pass.
  const adapterV2Res = await runVerifyCase({ modelName: 'text-1m', modelBuf: currentWithBase, signatureBytes: v2ForCall, viewModelBase: baseObj })
  assert.equal(adapterV2Res.verified, true)
  assert.equal(adapterV2Res.signature, true)
  assert.equal(adapterV2Res.base, true)

  // Pre-Step-6 legacy v1 sig on adapter model -> signature: true, base: false, verified: false.
  const legacyAdapterRes = await runVerifyCase({ modelName: 'text-1m', modelBuf: currentWithBase, signatureBytes: v1ForCall, viewModelBase: baseObj })
  assert.equal(legacyAdapterRes.verified, false)
  assert.equal(legacyAdapterRes.signature, true)
  assert.equal(legacyAdapterRes.base, false)

  // Wrong base hash signed -> signature: false, base: false, verified: false.
  const wrongBaseRes = await runVerifyCase({ modelName: 'text-1m', modelBuf: currentWithBase, signatureBytes: v2WrongBase, viewModelBase: baseObj })
  assert.equal(wrongBaseRes.verified, false)
  assert.equal(wrongBaseRes.signature, false)
  assert.equal(wrongBaseRes.base, false)

  // Tampered API view.modelBase vs chain -> base: false, verified: false.
  const tamperedViewRes = await runVerifyCase({
    modelName: 'text-1m',
    modelBuf: currentWithBase,
    signatureBytes: v2ForCall,
    viewModelBase: { ...baseObj, sha256: toHex(wrongBaseSha) },
  })
  assert.equal(tamperedViewRes.verified, false)
  assert.equal(tamperedViewRes.signature, true)
  assert.equal(tamperedViewRes.base, false)
})

test('Build 4 Step 1: PriceUnit contract, Call 302..349+33*K decoding, multi-era event normalization, and fixture metered call ceiling flow', async () => {
  const { PriceUnit } = await import('@voynich/contract')
  const { CALL_SPACE, CALL_STEP6_SPACE } = await import('voynich/program')
  const { buildApp } = await import('../src/app.js')
  const { FIXTURE } = await import('@voynich/contract/fixtures')

  assert.deepEqual(PriceUnit.options, ['call', 'token'])
  assert.equal(CALL_STEP6_SPACE, 340)
  assert.equal(CALL_SPACE, 349)

  // 1. decodeCallAccount across Build 1 Step 6 (340 + 33*K) and Build 4 Step 1 (349 + 33*K).
  const callDisc = sha256(utf8('account:Call')).subarray(0, 8)
  const makeCallBuf = (extraLen: number, callbackCount: number, priceVal: bigint) => {
    const buf = Buffer.alloc(340 + callbackCount * 33 + extraLen)
    Buffer.from(callDisc).copy(buf, 0)
    buf.writeBigUInt64LE(priceVal, 144)
    buf[300] = 0 // open
    buf[301] = 255 // bump
    buf[302] = 1 // open answer mode
    buf[303] = 0 // caller_is_program = false
    buf.writeUInt32LE(callbackCount, 336)
    return buf
  }
  const b1s6Buf = makeCallBuf(0, 1, 50_000n)
  const b1s6Decoded = decodeCallAccount(b1s6Buf)
  assert.equal(b1s6Decoded.priceUnit, 'call')
  assert.equal(b1s6Decoded.price.toString(), '50000')
  assert.equal(b1s6Decoded.ceiling.toString(), '50000')
  assert.equal(b1s6Decoded.callbackAccounts.length, 1)

  const b4s1Buf = makeCallBuf(9, 2, 1_500n)
  const tailOffset = 340 + 2 * 33
  b4s1Buf[tailOffset] = 1 // PriceUnit::Token
  b4s1Buf.writeBigUInt64LE(96_000n, tailOffset + 1)
  const b4s1Decoded = decodeCallAccount(b4s1Buf)
  assert.equal(b4s1Decoded.priceUnit, 'token')
  assert.equal(b4s1Decoded.price.toString(), '1500')
  assert.equal(b4s1Decoded.ceiling.toString(), '96000')
  assert.equal(b4s1Decoded.callbackAccounts.length, 2)

  // 2. normalizeLegacyVoynichEvent: ModelCreated Era 3 (with & without base), 82B ModelPriceChanged, and 370+33*K CallOpened.
  const { voynich } = chainPrograms({} as never)
  const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n, 0); return b }
  const u64 = (n: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(n, 0); return b }
  const u16 = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(n, 0); return b }
  const modelKey = Keypair.generate().publicKey
  const owner = Keypair.generate().publicKey
  const weightsKey = Keypair.generate().publicKey
  const uploadKey = Keypair.generate().publicKey
  const nameBytes = utf8('era3-adapter')
  const manifestBytes = utf8('{"name":"era3-adapter"}')
  const cipherBytes = utf8('xchacha20poly1305-64k-v1')
  const fmtBytes = utf8('onnx')
  const srcBytes = utf8('https://example.com/base.onnx')

  const era3Prefix = Buffer.concat([
    sha256(utf8('event:ModelCreated')).subarray(0, 8),
    modelKey.toBytes(), owner.toBytes(),
    u32(nameBytes.length), nameBytes,
    u32(manifestBytes.length), manifestBytes,
    u32(1), weightsKey.toBytes(),
    u64(214_737n),
    u32(cipherBytes.length), cipherBytes,
    new Uint8Array(16).fill(7),
    u32(1), new Uint8Array(48).fill(0xcd),
    u64(100_000n), PublicKey.default.toBytes(), u16(2500),
    uploadKey.toBytes(), u64(999n),
    u32(1), uploadKey.toBytes(),
    Uint8Array.of(1), // hash_version = 1
  ])
  const era3WithBase = Buffer.concat([
    era3Prefix,
    Uint8Array.of(1), // Some(ModelBase)
    new Uint8Array(32).fill(0x55),
    u64(6_143_522n),
    u32(fmtBytes.length), fmtBytes,
    u32(srcBytes.length), srcBytes,
  ])
  const normEra3Base = normalizeLegacyVoynichEvent(era3WithBase)
  assert.equal(normEra3Base.length, era3WithBase.length + 1)
  const decEra3Base = voynich.coder.events.decode(toBase64(normEra3Base))
  assert.equal(decEra3Base?.name, 'modelCreated')
  assert.deepEqual((decEra3Base?.data as { priceUnit: unknown }).priceUnit, { call: {} })
  assert((decEra3Base?.data as { base: { format: string } | null }).base?.format === 'onnx')

  const era3NoBase = Buffer.concat([era3Prefix, Uint8Array.of(0)])
  const normEra3None = normalizeLegacyVoynichEvent(era3NoBase)
  assert.equal(normEra3None.length, era3NoBase.length + 1)
  const decEra3None = voynich.coder.events.decode(toBase64(normEra3None))
  assert.equal(decEra3None?.name, 'modelCreated')
  assert.deepEqual((decEra3None?.data as { priceUnit: unknown }).priceUnit, { call: {} })
  assert.equal((decEra3None?.data as { base: unknown }).base, null)

  // 82B legacy ModelPriceChanged -> 83B with priceUnit: { call: {} }
  const legacyPriceEvent = Buffer.concat([
    sha256(utf8('event:ModelPriceChanged')).subarray(0, 8),
    modelKey.toBytes(), u64(250_000n), PublicKey.default.toBytes(), u16(2500),
  ])
  assert.equal(legacyPriceEvent.length, 82)
  const normPrice = normalizeLegacyVoynichEvent(legacyPriceEvent)
  assert.equal(normPrice.length, 83)
  const decPrice = voynich.coder.events.decode(toBase64(normPrice))
  assert.equal(decPrice?.name, 'modelPriceChanged')
  assert.deepEqual((decPrice?.data as { priceUnit: unknown }).priceUnit, { call: {} })

  // Build 1 Step 6 CallOpened (370 + 33*2) -> pads +9B with priceUnit = Call and ceiling = price.
  const b1s6CallOpened = Buffer.alloc(370 + 33 * 2)
  Buffer.from(sha256(utf8('event:CallOpened')).subarray(0, 8)).copy(b1s6CallOpened, 0)
  b1s6CallOpened.writeBigUInt64LE(123_456n, 176)
  b1s6CallOpened.writeUInt32LE(2, 366)
  const normCallOpened = normalizeLegacyVoynichEvent(b1s6CallOpened)
  assert.equal(normCallOpened.length, b1s6CallOpened.length + 9)
  const decCallOpened = voynich.coder.events.decode(toBase64(normCallOpened))
  assert.equal(decCallOpened?.name, 'callOpened')
  const callOpenedData = decCallOpened?.data as { priceUnit: unknown; ceiling: { toString(): string }; price: { toString(): string } }
  assert.deepEqual(callOpenedData.priceUnit, { call: {} })
  assert.equal(callOpenedData.price.toString(), '123456')
  assert.equal(callOpenedData.ceiling.toString(), '123456')

  // 3. Fixture API end-to-end: setPrice(token) -> reject missing/low ceiling -> openCall(ceiling) -> relayInput refuses metered call.
  const app = buildApp()
  const headers = { 'content-type': 'application/json', 'X-Fixture-Session': 'b4s1-test' }
  const setPriceRes = await app.request(`http://127.0.0.1/v1/models/${FIXTURE.model}/price/build`, {
    method: 'POST', headers,
    body: JSON.stringify({
      wallet: FIXTURE.owner,
      price: { amount: '2000', mint: null, decimals: 9, symbol: 'SOL' },
      priceUnit: 'token',
      operatorShareBps: 2500,
    }),
  })
  assert.equal(setPriceRes.status, 200)
  const setPriceBuild = await setPriceRes.json() as { id: string; transactionBase64: string }
  const submitPriceRes = await app.request('http://127.0.0.1/v1/transactions/submit', {
    method: 'POST', headers,
    body: JSON.stringify({ mode: 'relay', buildId: setPriceBuild.id, signedTransactionBase64: setPriceBuild.transactionBase64, idempotencyKey: setPriceBuild.id }),
  })
  assert.equal(submitPriceRes.status, 200)
  const updatedModel = await (await app.request(`http://127.0.0.1/v1/models/${FIXTURE.model}`, { headers })).json() as { priceUnit: string; price: { amount: string } }
  assert.equal(updatedModel.priceUnit, 'token')
  assert.equal(updatedModel.price.amount, '2000')

  const inputHash = 'aa'.repeat(32)
  // Missing ceiling rejected.
  const noCeilingRes = await app.request('http://127.0.0.1/v1/calls/build', {
    method: 'POST', headers,
    body: JSON.stringify({ wallet: FIXTURE.caller, model: FIXTURE.model, enclave: FIXTURE.enclave, inputHash }),
  })
  assert.equal(noCeilingRes.status, 400)
  // Ceiling below unit price rejected.
  const lowCeilingRes = await app.request('http://127.0.0.1/v1/calls/build', {
    method: 'POST', headers,
    body: JSON.stringify({ wallet: FIXTURE.caller, model: FIXTURE.model, enclave: FIXTURE.enclave, inputHash, ceiling: '1999' }),
  })
  assert.equal(lowCeilingRes.status, 400)
  // Valid ceiling accepted and indexed with price === ceiling, unitPrice === 2000, ceiling === 128000.
  const okOpenRes = await app.request('http://127.0.0.1/v1/calls/build', {
    method: 'POST', headers,
    body: JSON.stringify({ wallet: FIXTURE.caller, model: FIXTURE.model, enclave: FIXTURE.enclave, inputHash, ceiling: '128000' }),
  })
  assert.equal(okOpenRes.status, 200)
  const openBuild = await okOpenRes.json() as { id: string; transactionBase64: string; addresses: { call: string } }
  const submitOpenRes = await app.request('http://127.0.0.1/v1/transactions/submit', {
    method: 'POST', headers,
    body: JSON.stringify({ mode: 'relay', buildId: openBuild.id, signedTransactionBase64: openBuild.transactionBase64, idempotencyKey: openBuild.id }),
  })
  assert.equal(submitOpenRes.status, 200)
  const openedCall = await (await app.request(`http://127.0.0.1/v1/calls/${openBuild.addresses.call}`, { headers })).json() as {
    priceUnit: string; price: { amount: string }; unitPrice: { amount: string }; ceiling: { amount: string } | null
  }
  assert.equal(openedCall.priceUnit, 'token')
  assert.equal(openedCall.price.amount, '128000')
  assert.equal(openedCall.unitPrice.amount, '2000')
  assert.equal(openedCall.ceiling?.amount, '128000')
})

test('Build 4 Step 2: streamInitialHash/streamNextHash, voynich/piece/v1|v2 (120B/152B), verifyStreamPiece tamper/gap/base rejections, and SSE + ?after= catch-up', async () => {
  const {
    encryptCallOutput, generateEncryptionKeyPair, pieceMessage, signPiece,
    streamInitialHash, streamNextHash, verifyPiece,
  } = await import('voynich/crypto')
  const { createVoynich, verifyStreamPiece } = await import('voynich')
  const { buildApp } = await import('../src/app.js')
  const { FIXTURE } = await import('@voynich/contract/fixtures')
  const { EventHub, streamEvent } = await import('../src/engines/server/sse.js')
  const { createEnclaveApp } = enclaveMod

  const signing = Keypair.generate()
  const callKey = Keypair.generate().publicKey
  const callBytes = callKey.toBytes()
  const inputHash = sha256(utf8('stream-input-1'))
  const baseSha = sha256(utf8('adapter-base-sha-v2'))
  const wrongBaseSha = sha256(utf8('wrong-base-sha-v2'))
  const reply = generateEncryptionKeyPair()

  // 1. Wire layouts: 120B v1 and 152B v2.
  const h0 = streamInitialHash(callBytes, inputHash)
  assert.equal(h0.length, 32)
  assert.notDeepEqual(Buffer.from(h0), Buffer.from(streamInitialHash(Keypair.generate().publicKey.toBytes(), inputHash)))
  const sampleBytes = utf8('sample-envelope')
  const h1 = streamNextHash(h0, 1, sampleBytes)
  assert.equal(h1.length, 32)
  assert.notDeepEqual(Buffer.from(h1), Buffer.from(streamNextHash(h0, 2, sampleBytes)))

  const msgV1 = pieceMessage(callBytes, inputHash, 42, h1)
  assert.equal(msgV1.length, 120)
  assert.equal(new TextDecoder().decode(msgV1.subarray(0, 16)), 'voynich/piece/v1')
  assert.deepEqual(Buffer.from(msgV1.subarray(16, 48)), Buffer.from(callBytes))
  assert.deepEqual(Buffer.from(msgV1.subarray(48, 80)), Buffer.from(inputHash))
  assert.equal(Buffer.from(msgV1.subarray(80, 88)).readBigUInt64LE(0), 42n)
  assert.deepEqual(Buffer.from(msgV1.subarray(88, 120)), Buffer.from(h1))

  const msgV2 = pieceMessage(callBytes, inputHash, 42, h1, baseSha)
  assert.equal(msgV2.length, 152)
  assert.equal(new TextDecoder().decode(msgV2.subarray(0, 16)), 'voynich/piece/v2')
  assert.deepEqual(Buffer.from(msgV2.subarray(120, 152)), Buffer.from(baseSha))

  // 2. signPiece / verifyPiece across v1, v2, cross-version, and wrong base.
  const seed = signing.secretKey.subarray(0, 32)
  const pub = signing.publicKey.toBytes()
  const sigV1 = signPiece(seed, callBytes, inputHash, 42, h1)
  const sigV2 = signPiece(seed, callBytes, inputHash, 42, h1, baseSha)
  assert.equal(verifyPiece(sigV1, pub, callBytes, inputHash, 42, h1), true)
  assert.equal(verifyPiece(sigV1, pub, callBytes, inputHash, 42, h1, baseSha), false)
  assert.equal(verifyPiece(sigV2, pub, callBytes, inputHash, 42, h1, baseSha), true)
  assert.equal(verifyPiece(sigV2, pub, callBytes, inputHash, 42, h1), false)
  assert.equal(verifyPiece(sigV2, pub, callBytes, inputHash, 42, h1, wrongBaseSha), false)
  assert.equal(verifyPiece(sigV2, pub, callBytes, inputHash, 43, h1, baseSha), false)

  // 3. verifyStreamPiece full chain + tamper / gap / reorder / wrong-base rejections.
  const makeSignedPiece = (index: number, prevHash: Uint8Array, prevCount: number, text: string, deltaTokens: number, finishReason: 'eos' | 'length' | 'ceiling' | 'stopped' | null) => {
    const count = prevCount + deltaTokens
    const envBytes = encryptCallOutput(utf8(JSON.stringify({ index, text, tokens: deltaTokens, finishReason })), reply.publicKey)
    const nextHash = streamNextHash(prevHash, count, envBytes)
    const sig = signPiece(seed, callBytes, inputHash, count, nextHash, baseSha)
    return {
      piece: {
        call: callKey.toBase58(),
        index,
        count,
        deltaTokens,
        envelope: toBase64(envBytes),
        pieceHash: toHex(sha256(envBytes)),
        runningHash: toHex(nextHash),
        signature: toBase64(sig),
        finishReason,
      },
      nextHash,
      count,
    }
  }
  const p0 = makeSignedPiece(0, h0, 0, 'Hel', 3, null)
  const p1 = makeSignedPiece(1, p0.nextHash, p0.count, 'lo', 2, 'eos')

  const v0 = verifyStreamPiece({
    piece: p0.piece, expectedCall: callKey.toBase58(), expectedIndex: 0,
    previousCount: 0, previousRunningHash: h0, enclaveSigningKey: signing.publicKey.toBase58(),
    inputHash, replySecretKey: reply.secretKey, baseSha256: baseSha,
  })
  assert.equal(v0.verified.text, 'Hel')
  assert.equal(v0.nextCount, 3)

  const v1 = verifyStreamPiece({
    piece: p1.piece, expectedCall: callKey.toBase58(), expectedIndex: 1,
    previousCount: v0.nextCount, previousRunningHash: v0.nextRunningHash,
    enclaveSigningKey: signing.publicKey.toBase58(), inputHash, replySecretKey: reply.secretKey, baseSha256: baseSha,
  })
  assert.equal(v1.verified.text, 'lo')
  assert.equal(v1.verified.finishReason, 'eos')
  assert.equal(v1.nextCount, 5)

  // Reject gap/reorder (passing p1 as index 0).
  assert.throws(() => verifyStreamPiece({
    piece: p1.piece, expectedCall: callKey.toBase58(), expectedIndex: 0,
    previousCount: 0, previousRunningHash: h0, enclaveSigningKey: signing.publicKey.toBase58(),
    inputHash, replySecretKey: reply.secretKey, baseSha256: baseSha,
  }), /sequential index/)
  // Reject wrong base hash.
  assert.throws(() => verifyStreamPiece({
    piece: p0.piece, expectedCall: callKey.toBase58(), expectedIndex: 0,
    previousCount: 0, previousRunningHash: h0, enclaveSigningKey: signing.publicKey.toBase58(),
    inputHash, replySecretKey: reply.secretKey, baseSha256: wrongBaseSha,
  }), /Ed25519/)
  // Reject tampered pieceHash.
  assert.throws(() => verifyStreamPiece({
    piece: { ...p0.piece, pieceHash: '00'.repeat(32) }, expectedCall: callKey.toBase58(), expectedIndex: 0,
    previousCount: 0, previousRunningHash: h0, enclaveSigningKey: signing.publicKey.toBase58(),
    inputHash, replySecretKey: reply.secretKey, baseSha256: baseSha,
  }), /hash does not match/)
  // Reject non-monotonic count.
  assert.throws(() => verifyStreamPiece({
    piece: { ...p0.piece, count: 99 }, expectedCall: callKey.toBase58(), expectedIndex: 0,
    previousCount: 0, previousRunningHash: h0, enclaveSigningKey: signing.publicKey.toBase58(),
    inputHash, replySecretKey: reply.secretKey, baseSha256: baseSha,
  }), /monotonic/)

  // 4. Fixture API end-to-end SSE streaming + ceiling cap + ?after= catch-up via SDK streamPieces().
  const app = buildApp()
  const sessionHeaders = { 'X-Fixture-Session': 'b4s2-stream-test' }
  const appFetch = ((input: RequestInfo | URL, init?: RequestInit) => app.request(input, init)) as typeof fetch
  const sdk = createVoynich({ apiUrl: 'http://127.0.0.1', headers: sessionHeaders, fetch: appFetch })

  const setPriceRes = await app.request(`http://127.0.0.1/v1/models/${FIXTURE.model}/price/build`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...sessionHeaders },
    body: JSON.stringify({
      wallet: FIXTURE.owner,
      price: { amount: '2000', mint: null, decimals: 9, symbol: 'SOL' },
      priceUnit: 'token',
      operatorShareBps: 2500,
    }),
  })
  assert.equal(setPriceRes.status, 200)
  const spBuild = await setPriceRes.json() as { id: string; transactionBase64: string }
  await app.request('http://127.0.0.1/v1/transactions/submit', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...sessionHeaders },
    body: JSON.stringify({ mode: 'relay', buildId: spBuild.id, signedTransactionBase64: spBuild.transactionBase64, idempotencyKey: spBuild.id }),
  })

  const enclaveDetail = await sdk.enclave(FIXTURE.enclave)
  const fixtureReply = generateEncryptionKeyPair()
  const { encryptCallInput } = await import('voynich/crypto')
  const fixtureEnc = encryptCallInput(
    utf8(JSON.stringify({ input: Array.from({ length: 784 }, () => 0), outputPublicKey: toBase64(fixtureReply.publicKey) })),
    fromBase64(enclaveDetail.enclave.encryptionKey),
  )
  const fixtureInputHash = toHex(sha256(fixtureEnc))
  // Ceiling = 10_000 lamports at 2_000/token -> caps cleanly at 5 tokens with finishReason = 'ceiling'.
  const openRes = await app.request('http://127.0.0.1/v1/calls/build', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...sessionHeaders },
    body: JSON.stringify({ wallet: FIXTURE.caller, model: FIXTURE.model, enclave: FIXTURE.enclave, inputHash: fixtureInputHash, ceiling: '10000' }),
  })
  assert.equal(openRes.status, 200)
  const openBuild = await openRes.json() as { id: string; transactionBase64: string; addresses: { call: string } }
  await app.request('http://127.0.0.1/v1/transactions/submit', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...sessionHeaders },
    body: JSON.stringify({ mode: 'relay', buildId: openBuild.id, signedTransactionBase64: openBuild.transactionBase64, idempotencyKey: openBuild.id }),
  })
  const relayRes = await app.request(`http://127.0.0.1/v1/calls/${openBuild.addresses.call}/input`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...sessionHeaders },
    body: JSON.stringify({ envelope: toBase64(fixtureEnc) }),
  })
  assert.equal(relayRes.status, 200)

  const received: { text: string; count: number; finishReason: string | null }[] = []
  for await (const item of sdk.streamPieces(openBuild.addresses.call, {
    replySecretKey: fixtureReply.secretKey,
    enclaveSigningKey: enclaveDetail.enclave.signingKey,
    inputHash: fixtureInputHash,
    baseSha256: null,
  })) {
    received.push({ text: item.text, count: item.count, finishReason: item.finishReason })
  }
  assert.equal(received.length, 5)
  assert.equal(received.map(r => r.text).join(''), 'Fixtu')
  assert.equal(received[4]!.count, 5)
  assert.equal(received[4]!.finishReason, 'ceiling')

  // ?after=2 replays strictly indices 3 and 4 + call.stream.done.
  const afterRes = await app.request(`http://127.0.0.1/v1/calls/${openBuild.addresses.call}/stream?after=2`, { headers: sessionHeaders })
  assert.equal(afterRes.status, 200)
  const afterText = await afterRes.text()
  const pieceEvents = afterText.split('\n\n').filter(b => b.includes('event: call.piece'))
  assert.equal(pieceEvents.length, 2)
  assert(afterText.includes('event: call.stream.done'))

  // 5. Enclave app /v1/calls/:call/pieces and /v1/calls/:call/stream?after=0 catch-up.
  const hub = new EventHub()
  const encApp = createEnclaveApp({
    enclave: Keypair.generate().publicKey,
    softwareMeasurement: 'ab'.repeat(48),
    loaded: new Map(),
    pieceHub: hub,
    acceptInput: async () => {},
    getAnswer: async () => ({ status: 'waiting', outputEnvelope: null, openAnswer: null, outputHash: null, signature: null, settleTransaction: null, receiptAddress: null, failure: null }),
    getPieces: async () => ({ call: callKey.toBase58(), status: 'done', pieces: [p0.piece, p1.piece], failure: null }),
  }, () => true)
  const snapRes = await encApp.request(`http://127.0.0.1:9707/v1/calls/${callKey.toBase58()}/pieces`)
  assert.equal(snapRes.status, 200)
  const snapBody = await snapRes.json() as { status: string; pieces: unknown[] }
  assert.equal(snapBody.status, 'done')
  assert.equal(snapBody.pieces.length, 2)

  const encStreamRes = await encApp.request(`http://127.0.0.1:9707/v1/calls/${callKey.toBase58()}/stream?after=0`)
  assert.equal(encStreamRes.status, 200)
  const encStreamText = await encStreamRes.text()
  const encPieces = encStreamText.split('\n\n').filter(b => b.includes('event: call.piece'))
  assert.equal(encPieces.length, 1, 'after=0 must emit only piece index 1')
  assert(encStreamText.includes('event: call.stream.done'))
  void streamEvent
})

test('Build 4 Step 3: 423B metered Receipt decoding, CallSettled Era 0-3 normalization, client.verify() metered 5/5, and fixture metered settlement', async () => {
  const { createVoynich } = await import('voynich')
  const { generateEncryptionKeyPair, signPiece, toBase64, toHex, utf8 } = await import('voynich/crypto')
  const { ATTESTATION_PROGRAM_ID, PROGRAM_ID, RECEIPT_METERED_SPACE, addresses: pdaAddrs, chainPrograms } = await import('voynich/program')
  const { FIXTURE } = await import('@voynich/contract/fixtures')
  const { buildApp } = await import('../src/app.js')
  const { Connection } = await import('@solana/web3.js')

  const { voynich, attest } = chainPrograms(new Connection('http://127.0.0.1:8899'))
  const derived = pdaAddrs(PROGRAM_ID, ATTESTATION_PROGRAM_ID)

  // 1. decodeReceiptAccount across 401B legacy, 406+N Step 1, 407+N Step 2, 423B metered, and malformed 415B.
  const discReceipt = sha256(utf8('account:Receipt')).subarray(0, 8)
  const callKey = Keypair.generate().publicKey
  const modelKey = derived.model('text-1m')
  const signing = Keypair.generate()
  const enclaveKey = derived.enclave(signing.publicKey)
  const recordKey = derived.record(signing.publicKey)
  const ownerKey = Keypair.generate().publicKey
  const operatorKey = Keypair.generate().publicKey
  const feeKey = Keypair.generate().publicKey
  const inputHash = sha256(utf8('b4s3-input'))
  const runningHash = sha256(utf8('b4s3-running'))
  const baseSha = sha256(utf8('b4s3-base-onnx'))
  const sigV2 = signPiece(signing.secretKey.slice(0, 32), callKey.toBytes(), inputHash, 61n, runningHash, baseSha)
  const sigV1 = signPiece(signing.secretKey.slice(0, 32), callKey.toBytes(), inputHash, 61n, runningHash, null)

  const buildReceiptBuf = (mode: 'legacy' | 'step1' | 'step2' | 'metered', sig: Uint8Array, delivered = 61n, returned = 78_000n) => {
    const base = new Uint8Array(401)
    const v = new DataView(base.buffer)
    base.set(discReceipt, 0)
    base.set(callKey.toBytes(), 8)
    base.set(modelKey.toBytes(), 40)
    base.set(enclaveKey.toBytes(), 72)
    base.set(inputHash, 104)
    base.set(runningHash, 136)
    base.set(sig, 168)
    v.setBigUint64(232, 100n, true)
    base.set(PublicKey.default.toBytes(), 240)
    v.setBigUint64(272, 122_000n, true)
    base.set(ownerKey.toBytes(), 280)
    base.set(operatorKey.toBytes(), 312)
    base.set(feeKey.toBytes(), 344)
    v.setBigUint64(376, 85_400n, true)
    v.setBigUint64(384, 30_500n, true)
    v.setBigUint64(392, 6_100n, true)
    base[400] = 250
    if (mode === 'legacy') return base
    const extraLen = mode === 'step1' ? 5 : mode === 'step2' ? 6 : 22
    const out = new Uint8Array(401 + extraLen)
    const ov = new DataView(out.buffer)
    out.set(base, 0)
    out[401] = 0 // Sealed
    ov.setUint32(402, 0, true) // open_answer = []
    if (mode === 'step2' || mode === 'metered') out[406] = 0
    if (mode === 'metered') {
      ov.setBigUint64(407, delivered, true)
      ov.setBigUint64(415, returned, true)
    }
    return out
  }

  const decLegacy = decodeReceiptAccount(buildReceiptBuf('legacy', sigV1))
  assert.equal(decLegacy.deliveredCount, null)
  assert.equal(decLegacy.returnedAmount, null)
  const decStep1 = decodeReceiptAccount(buildReceiptBuf('step1', sigV1))
  assert.equal(decStep1.deliveredCount, null)
  const decStep2 = decodeReceiptAccount(buildReceiptBuf('step2', sigV1))
  assert.equal(decStep2.deliveredCount, null)
  const meteredBuf = buildReceiptBuf('metered', sigV2, 61n, 78_000n)
  assert.equal(meteredBuf.length, RECEIPT_METERED_SPACE)
  assert.equal(RECEIPT_METERED_SPACE, 423)
  const decMetered = decodeReceiptAccount(meteredBuf)
  assert.equal(decMetered.deliveredCount?.toString(), '61')
  assert.equal(decMetered.returnedAmount?.toString(), '78000')
  assert.throws(() => decodeReceiptAccount(meteredBuf.subarray(0, 415)), /Invalid Receipt/)

  // 2. normalizeLegacyVoynichEvent pads CallSettled Eras 0 (432B), 1 (437+N), and 2 (438+N) -> 440+N and preserves Era 3 (456B).
  const discSettled = sha256(utf8('event:CallSettled')).subarray(0, 8)
  const era0 = new Uint8Array(432)
  era0.set(discSettled, 0)
  const norm0 = normalizeLegacyVoynichEvent(era0)
  assert.equal(norm0.length, 440)
  const decoded0 = voynich.coder.events.decode(Buffer.from(norm0).toString('base64'))
  assert.equal(decoded0?.name, 'callSettled')
  assert.equal((decoded0?.data as Record<string, unknown>).deliveredCount, null)
  assert.equal((decoded0?.data as Record<string, unknown>).returnedAmount, null)

  const era1 = new Uint8Array(437 + 4)
  era1.set(discSettled, 0)
  new DataView(era1.buffer).setUint32(433, 4, true)
  const norm1 = normalizeLegacyVoynichEvent(era1)
  assert.equal(norm1.length, 440 + 4)
  const decoded1 = voynich.coder.events.decode(Buffer.from(norm1).toString('base64'))
  assert.equal(decoded1?.name, 'callSettled')
  assert.equal((decoded1?.data as Record<string, unknown>).deliveredCount, null)

  const era2 = new Uint8Array(438 + 4)
  era2.set(discSettled, 0)
  new DataView(era2.buffer).setUint32(433, 4, true)
  era2[437 + 4] = 1
  const norm2 = normalizeLegacyVoynichEvent(era2)
  assert.equal(norm2.length, 440 + 4)
  const decoded2 = voynich.coder.events.decode(Buffer.from(norm2).toString('base64'))
  assert.equal(decoded2?.name, 'callSettled')
  assert.equal((decoded2?.data as Record<string, unknown>).callerIsProgram, true)
  assert.equal((decoded2?.data as Record<string, unknown>).deliveredCount, null)

  const era3 = new Uint8Array(456)
  era3.set(discSettled, 0)
  const v3 = new DataView(era3.buffer)
  era3[438] = 1
  v3.setBigUint64(439, 61n, true)
  era3[447] = 1
  v3.setBigUint64(448, 78_000n, true)
  assert.equal(normalizeLegacyVoynichEvent(era3).length, 456)
  const decoded3 = voynich.coder.events.decode(Buffer.from(era3).toString('base64'))
  assert.equal(decoded3?.name, 'callSettled')
  assert.equal(String((decoded3?.data as Record<string, unknown>).deliveredCount), '61')
  assert.equal(String((decoded3?.data as Record<string, unknown>).returnedAmount), '78000')

  // 3. client.verify() verifies 423B metered receipt (v2 adapter 5/5, tampered deliveredCount rejected, v1 on adapter -> base=false).
  const encPub = generateEncryptionKeyPair().publicKey
  const measurement = Array.from({ length: 48 }, (_, i) => i + 1)
  const configBuf = await voynich.coder.accounts.encode('config', {
    admin: ownerKey, attestationProgram: ATTESTATION_PROGRAM_ID, recordLayoutVersion: 1,
    feeRecipient: feeKey, protocolShareBps: 500, callDeadlineSlots: new BN(100), bump: 255, maxOpenAnswerBytes: 1024,
  })
  const enclaveBuf = await voynich.coder.accounts.encode('enclave', {
    signingKey: signing.publicKey, encryptionKey: Array.from(encPub), operator: operatorKey,
    endpoint: 'http://127.0.0.1:9707', attestationRecord: recordKey, hardwareType: 0,
    measurement, recordedSlot: new BN(50), expiresAtSlot: new BN(500), callsSettled: new BN(1), bump: 254,
  })
  const baseObj = { sha256: toHex(baseSha), sizeBytes: 6_143_522, format: 'onnx' as const, source: 'https://example.test/text-1m-base.onnx' }
  const modelBuf = await voynich.coder.accounts.encode('model', {
    owner: ownerKey, name: 'text-1m', manifest: Buffer.from('{}'), weights: [Keypair.generate().publicKey],
    sizeBytes: new BN(214_737), cipher: 'xchacha20poly1305-64k-v1', noncePrefix: Array.from(new Uint8Array(16).fill(1)),
    ciphertextSha256: Array.from(new Uint8Array(32).fill(2)), allowedMeasurements: [measurement],
    price: new BN(2_000), priceMint: PublicKey.default, operatorShareBps: 2500, uploadKey: PublicKey.default,
    status: { live: {} }, createdSlot: new BN(10), sealedSlot: new BN(20), callsSettled: new BN(1), bump: 253,
    uploadKeys: [], hashVersion: 1, sealedChunks: 4, merkleFrontier: [], merkleFrontierMask: 0,
    base: { sha256: Array.from(baseSha), sizeBytes: new BN(baseObj.sizeBytes), format: baseObj.format, source: baseObj.source },
    priceUnit: { token: {} },
  })
  const attRecBuf = await attest.coder.accounts.encode('attestationRecord', {
    layoutVersion: 1,
    signingKey: signing.publicKey,
    hardwareType: { dev: {} },
    measurement,
    recordedSlot: new BN(50),
    expiresAtSlot: new BN(500),
    reportSlot: new BN(50),
  })

  const receiptKey = derived.receipt(callKey)
  const runVerifyMetered = async (receiptBytes: Uint8Array, viewDelivered: string | null, viewReturned: string | null, sigForView: Uint8Array) => {
    const accounts = new Map<string, { data: Buffer; owner: PublicKey }>([
      [derived.config.toBase58(), { data: Buffer.from(configBuf), owner: PROGRAM_ID }],
      [receiptKey.toBase58(), { data: Buffer.from(receiptBytes), owner: PROGRAM_ID }],
      [enclaveKey.toBase58(), { data: Buffer.from(enclaveBuf), owner: PROGRAM_ID }],
      [recordKey.toBase58(), { data: Buffer.from(attRecBuf), owner: ATTESTATION_PROGRAM_ID }],
      [modelKey.toBase58(), { data: Buffer.from(modelBuf), owner: PROGRAM_ID }],
    ])
    const mockConnection = {
      async getMultipleAccountsInfo(keys: PublicKey[]) {
        return keys.map(k => accounts.get(k.toBase58()) ?? null)
      },
    }
    const mockFetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url.endsWith('/v1/config')) {
        return new Response(JSON.stringify({
          mode: 'chain', cluster: 'localnet', rpcUrl: 'http://rpc.test',
          programId: PROGRAM_ID.toBase58(), attestationProgramId: ATTESTATION_PROGRAM_ID.toBase58(),
          bountyProgramId: null, attestationRecordLayoutVersion: 1, feeRecipient: feeKey.toBase58(),
          protocolShareBps: 500, callDeadlineSlots: '100', maxOpenAnswerBytes: 1024, tokenMint: null, fixture: false,
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      throw new Error(`Unexpected fetch ${url}`)
    }) as typeof fetch
    const sdk = createVoynich({ apiUrl: 'http://api.test', connection: mockConnection as never, fetch: mockFetch })
    return sdk.verify(receiptKey.toBase58(), {
      receipt: {
        receipt: {
          address: receiptKey.toBase58(), call: callKey.toBase58(), caller: Keypair.generate().publicKey.toBase58(),
          callerIsProgram: false, model: modelKey.toBase58(), modelName: 'text-1m', enclave: enclaveKey.toBase58(),
          inputHash: toHex(inputHash), outputHash: toHex(runningHash), signature: toBase64(sigForView),
          answerMode: 'sealed', openAnswer: null, deliveredCount: viewDelivered, returnedAmount: viewReturned,
          slot: '100', transactionSignature: '1'.repeat(88),
          payments: {
            mint: null, total: '122000',
            owner: { recipient: ownerKey.toBase58(), amount: '85400' },
            operator: { recipient: operatorKey.toBase58(), amount: '30500' },
            protocol: { recipient: feeKey.toBase58(), amount: '6100' },
          },
        },
        enclaveSigningKey: signing.publicKey.toBase58(),
        attestationRecord: {
          address: recordKey.toBase58(), signingKey: signing.publicKey.toBase58(), encryptionKey: toBase64(encPub),
          hardwareType: 'dev', measurement: toHex(Uint8Array.from(measurement)), recordedSlot: '50', expiresAtSlot: '500', layoutVersion: 1,
        },
        attestationProgramId: ATTESTATION_PROGRAM_ID.toBase58(),
        recordLayoutVersion: 1,
        modelBase: baseObj,
      },
    })
  }

  const okMetered = await runVerifyMetered(meteredBuf, '61', '78000', sigV2)
  assert.equal(okMetered.verified, true, 'metered 423B v2 receipt must pass 5/5')
  assert.equal(okMetered.signature, true)
  assert.equal(okMetered.record, true)
  assert.equal(okMetered.expiry, true)
  assert.equal(okMetered.answer, true)
  assert.equal(okMetered.base, true)

  const badCount = await runVerifyMetered(meteredBuf, '60', '78000', sigV2)
  assert.equal(badCount.verified, false)
  assert.equal(badCount.record, false)

  const v1OnAdapter = await runVerifyMetered(buildReceiptBuf('metered', sigV1, 61n, 78_000n), '61', '78000', sigV1)
  assert.equal(v1OnAdapter.verified, false)
  assert.equal(v1OnAdapter.signature, true)
  assert.equal(v1OnAdapter.base, false)

  // 4. Fixture metered stream auto-settles Receipt with deliveredCount & returnedAmount + call.stream.done receiptAddress.
  const app = buildApp()
  const headers = { 'X-Fixture-Session': 'b4s3-fixture-settle' }
  const sp = await (await app.request(`http://127.0.0.1/v1/models/${FIXTURE.model}/price/build`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ wallet: FIXTURE.owner, price: { amount: '2000', mint: null, decimals: 9, symbol: 'SOL' }, priceUnit: 'token', operatorShareBps: 2500 }),
  })).json() as { id: string; transactionBase64: string }
  await app.request('http://127.0.0.1/v1/transactions/submit', {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ mode: 'relay', buildId: sp.id, signedTransactionBase64: sp.transactionBase64, idempotencyKey: sp.id }),
  })
  const encDetail = await (await app.request(`http://127.0.0.1/v1/enclaves/${FIXTURE.enclave}`, { headers })).json() as { enclave: { encryptionKey: string } }
  const { encryptCallInput } = await import('voynich/crypto')
  const reply = generateEncryptionKeyPair()
  const env = encryptCallInput(utf8(JSON.stringify({ input: Array.from({ length: 784 }, () => 0), outputPublicKey: toBase64(reply.publicKey) })), fromBase64(encDetail.enclave.encryptionKey))
  // Ceiling = 100000 (50 tokens max); fixture sample is 23 chars -> 23 tokens * 2000 = 46000 total, 54000 returned.
  const ob = await (await app.request('http://127.0.0.1/v1/calls/build', {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ wallet: FIXTURE.caller, model: FIXTURE.model, enclave: FIXTURE.enclave, inputHash: toHex(sha256(env)), ceiling: '100000' }),
  })).json() as { id: string; transactionBase64: string; addresses: { call: string } }
  await app.request('http://127.0.0.1/v1/transactions/submit', {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ mode: 'relay', buildId: ob.id, signedTransactionBase64: ob.transactionBase64, idempotencyKey: ob.id }),
  })
  const rel = await app.request(`http://127.0.0.1/v1/calls/${ob.addresses.call}/input`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ envelope: toBase64(env) }),
  })
  assert.equal(rel.status, 200)
  const callAfter = await (await app.request(`http://127.0.0.1/v1/calls/${ob.addresses.call}`, { headers })).json() as { status: string; receipt: string | null }
  assert.equal(callAfter.status, 'settled')
  assert.ok(callAfter.receipt)
  const rv = await (await app.request(`http://127.0.0.1/v1/receipts/${callAfter.receipt}`, { headers })).json() as { receipt: { deliveredCount: string; returnedAmount: string; payments: { total: string } } }
  assert.equal(rv.receipt.deliveredCount, '23')
  assert.equal(rv.receipt.returnedAmount, '54000')
  assert.equal(rv.receipt.payments.total, '46000')
})

test('Build 4 Step 4: stopToken 403/already-finished/stopping, verifyStreamPiece deltaTokens=0 rule, and voynich.stream() full + mid-stream stop + final() 5/5', async () => {
  const { createVoynich, verifyStreamPiece } = await import('voynich')
  const {
    decryptCallInput, encryptCallInput, encryptCallOutput, fromHex, generateEncryptionKeyPair,
    signPiece, streamInitialHash, streamNextHash, toBase64, toHex, utf8,
  } = await import('voynich/crypto')
  const { FIXTURE } = await import('@voynich/contract/fixtures')
  const { buildApp } = await import('../src/app.js')
  const { createEnclaveApp } = await import('../enclave/src/runtime.js')
  const { EventHub } = await import('../src/engines/server/sse.js')
  const { ApiFailure } = await import('../src/engines/server/errors.js')

  // 1. verifyStreamPiece: allows deltaTokens === 0 on finishReason === 'stopped', rejects on non-terminal piece.
  const signing = Keypair.generate()
  const reply = generateEncryptionKeyPair()
  const callKey = Keypair.generate().publicKey
  const inputHash = sha256(utf8('b4s4-input'))
  const initHash = streamInitialHash(callKey.toBytes(), inputHash)

  const makePiece = (prevHash: Uint8Array, index: number, count: number, deltaTokens: number, text: string, finishReason: 'eos' | 'length' | 'ceiling' | 'stopped' | null) => {
    const envBytes = encryptCallOutput(utf8(JSON.stringify({ index, text, tokens: deltaTokens, finishReason })), reply.publicKey)
    const nextHash = streamNextHash(prevHash, count, envBytes)
    const sig = signPiece(signing.secretKey.slice(0, 32), callKey.toBytes(), inputHash, count, nextHash, null)
    return {
      piece: {
        call: callKey.toBase58(), index, count, deltaTokens,
        envelope: toBase64(envBytes), pieceHash: toHex(sha256(envBytes)),
        runningHash: toHex(nextHash), signature: toBase64(sig), finishReason,
      },
      nextHash,
    }
  }

  const zeroNonTerminal = makePiece(initHash, 0, 0, 0, '', null)
  assert.throws(() => verifyStreamPiece({
    piece: zeroNonTerminal.piece, expectedCall: callKey.toBase58(), expectedIndex: 0,
    previousCount: 0, previousRunningHash: initHash, enclaveSigningKey: signing.publicKey.toBase58(),
    inputHash, replySecretKey: reply.secretKey, baseSha256: null,
  }), /deltaTokens === 0/)

  const zeroStopped = makePiece(initHash, 0, 0, 0, '', 'stopped')
  const okZeroStopped = verifyStreamPiece({
    piece: zeroStopped.piece, expectedCall: callKey.toBase58(), expectedIndex: 0,
    previousCount: 0, previousRunningHash: initHash, enclaveSigningKey: signing.publicKey.toBase58(),
    inputHash, replySecretKey: reply.secretKey, baseSha256: null,
  })
  assert.equal(okZeroStopped.verified.count, 0)
  assert.equal(okZeroStopped.verified.finishReason, 'stopped')

  // 2. Fixture POST /v1/calls/:id/stop: wrong/missing token -> 403 UNAUTHORIZED, valid after done -> already-finished, valid while active -> stopping + count=0 settlement.
  const app = buildApp()
  const openFixtureTokenCall = async (session: string, extraHeaders: Record<string, string> = {}, includeStopToken = true) => {
    const headers = { 'X-Fixture-Session': session, ...extraHeaders }
    const sp = await (await app.request(`http://127.0.0.1/v1/models/${FIXTURE.model}/price/build`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ wallet: FIXTURE.owner, price: { amount: '2000', mint: null, decimals: 9, symbol: 'SOL' }, priceUnit: 'token', operatorShareBps: 2500 }),
    })).json() as { id: string; transactionBase64: string }
    await app.request('http://127.0.0.1/v1/transactions/submit', {
      method: 'POST', headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ mode: 'relay', buildId: sp.id, signedTransactionBase64: sp.transactionBase64, idempotencyKey: sp.id }),
    })
    const encDetail = await (await app.request(`http://127.0.0.1/v1/enclaves/${FIXTURE.enclave}`, { headers })).json() as { enclave: { encryptionKey: string } }
    const kp = generateEncryptionKeyPair()
    const stopToken = toBase64(Uint8Array.from({ length: 16 }, (_, i) => i + 10))
    const payloadObj = {
      input: Array.from({ length: 784 }, () => 0),
      outputPublicKey: toBase64(kp.publicKey),
      ...(includeStopToken ? { stopToken } : {}),
    }
    const env = encryptCallInput(utf8(JSON.stringify(payloadObj)), fromBase64(encDetail.enclave.encryptionKey))
    const ob = await (await app.request('http://127.0.0.1/v1/calls/build', {
      method: 'POST', headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ wallet: FIXTURE.caller, model: FIXTURE.model, enclave: FIXTURE.enclave, inputHash: toHex(sha256(env)), ceiling: '100000' }),
    })).json() as { id: string; transactionBase64: string; addresses: { call: string } }
    await app.request('http://127.0.0.1/v1/transactions/submit', {
      method: 'POST', headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ mode: 'relay', buildId: ob.id, signedTransactionBase64: ob.transactionBase64, idempotencyKey: ob.id }),
    })
    const rel = await app.request(`http://127.0.0.1/v1/calls/${ob.addresses.call}/input`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ envelope: toBase64(env) }),
    })
    assert.equal(rel.status, 200)
    return { call: ob.addresses.call, stopToken, headers }
  }

  const finishedCall = await openFixtureTokenCall('b4s4-finished')
  const badToken = toBase64(Uint8Array.from({ length: 16 }, () => 0xff))
  const wrongRes = await app.request(`http://127.0.0.1/v1/calls/${finishedCall.call}/stop`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...finishedCall.headers },
    body: JSON.stringify({ stopToken: badToken }),
  })
  assert.equal(wrongRes.status, 403)
  const wrongJson = await wrongRes.json() as { error: { code: string } }
  assert.equal(wrongJson.error.code, 'UNAUTHORIZED')

  const alreadyRes = await app.request(`http://127.0.0.1/v1/calls/${finishedCall.call}/stop`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...finishedCall.headers },
    body: JSON.stringify({ stopToken: finishedCall.stopToken }),
  })
  assert.equal(alreadyRes.status, 200)
  assert.deepEqual(await alreadyRes.json(), { call: finishedCall.call, status: 'already-finished' })

  const noTokenCall = await openFixtureTokenCall('b4s4-no-token', {}, false)
  const missingRes = await app.request(`http://127.0.0.1/v1/calls/${noTokenCall.call}/stop`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...noTokenCall.headers },
    body: JSON.stringify({ stopToken: badToken }),
  })
  assert.equal(missingRes.status, 403)

  // Active call ('call-answering'): valid stopToken stops and settles at count=0 with 100% ceiling returned.
  const activeCall = await openFixtureTokenCall('b4s4-active-stop', { 'X-Fixture': 'call-answering' })
  const stopActiveRes = await app.request(`http://127.0.0.1/v1/calls/${activeCall.call}/stop`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...activeCall.headers },
    body: JSON.stringify({ stopToken: activeCall.stopToken }),
  })
  assert.equal(stopActiveRes.status, 200)
  assert.deepEqual(await stopActiveRes.json(), { call: activeCall.call, status: 'stopping' })
  const settledZeroCall = await (await app.request(`http://127.0.0.1/v1/calls/${activeCall.call}`, { headers: activeCall.headers })).json() as { status: string; receipt: string }
  assert.equal(settledZeroCall.status, 'settled')
  const zeroReceiptView = await (await app.request(`http://127.0.0.1/v1/receipts/${settledZeroCall.receipt}`, { headers: activeCall.headers })).json() as { receipt: { deliveredCount: string; returnedAmount: string; payments: { total: string } } }
  assert.equal(zeroReceiptView.receipt.deliveredCount, '0')
  assert.equal(zeroReceiptView.receipt.returnedAmount, '100000')
  assert.equal(zeroReceiptView.receipt.payments.total, '0')

  // 3. Enclave HTTP POST /v1/calls/:call/stop enforces 403 UNAUTHORIZED vs 200 stopping/already-finished.
  const encApp = createEnclaveApp({
    enclave: Keypair.generate().publicKey,
    softwareMeasurement: 'ab'.repeat(48),
    loaded: new Map(),
    pieceHub: new EventHub(),
    acceptInput: async () => {},
    getAnswer: async () => ({ status: 'waiting', outputEnvelope: null, openAnswer: null, outputHash: null, signature: null, settleTransaction: null, receiptAddress: null, failure: null }),
    requestStop: (addr, token) => {
      if (token !== finishedCall.stopToken) {
        throw new ApiFailure(403, { error: { code: 'UNAUTHORIZED', message: 'Mismatch', retryable: false, stage: 'auth' } })
      }
      return { call: addr.toBase58(), status: 'stopping' }
    },
  }, () => true)
  const encBadStop = await encApp.request(`http://127.0.0.1:9707/v1/calls/${callKey.toBase58()}/stop`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stopToken: badToken }),
  })
  assert.equal(encBadStop.status, 403)
  const encOkStop = await encApp.request(`http://127.0.0.1:9707/v1/calls/${callKey.toBase58()}/stop`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stopToken: finishedCall.stopToken }),
  })
  assert.equal(encOkStop.status, 200)
  assert.deepEqual(await encOkStop.json(), { call: callKey.toBase58(), status: 'stopping' })

  // 4. First-class voynich.stream(): default ceiling, live spent/remaining, mid-stream stop(), and final() verification.
  const encKeys = generateEncryptionKeyPair()
  const mockSigner = Keypair.generate()
  const mockModelAddr = Keypair.generate().publicKey.toBase58()
  const mockEnclaveAddr = Keypair.generate().publicKey.toBase58()
  const mockReceiptAddr = Keypair.generate().publicKey.toBase58()
  const unitPrice = 2_000n
  const mockModel = {
    address: mockModelAddr, name: 'mock-text', owner: FIXTURE.owner, createdSlot: '10', sealedSlot: '20',
    sizeBytes: 65552, plaintextSizeBytes: 65536, ciphertextSha256: 'cd'.repeat(32), hashVersion: 1, sealedChunks: 1, base: null,
    cipher: { id: 'xchacha20poly1305-64k-v1', chunkSizeBytes: 65536, noncePrefix: toBase64(new Uint8Array(16).fill(1)) },
    allowedMeasurements: ['ab'.repeat(48)], price: { amount: unitPrice.toString(), mint: null, decimals: 9, symbol: 'SOL' },
    priceUnit: 'token', operatorShareBps: 2500, protocolShareBps: 500, status: 'live',
    manifest: { name: 'mock-text', inputKind: 'text', tokenizer: { format: 'byte-level', vocabSize: 258, maxInputTokens: 64, maxOutputTokens: 16 } },
    weights: [], upload: null, enclavesHolding: 1, callsSettled: '0',
  }
  const mockEnclave = {
    address: mockEnclaveAddr, signingKey: signing.publicKey.toBase58(), encryptionKey: toBase64(encKeys.publicKey),
    hardwareType: 'dev', measurement: 'ab'.repeat(48), expiresAtSlot: '999999', operator: FIXTURE.operator,
    endpoint: 'http://127.0.0.1:9707', relayPath: '/v1/calls/{call}/input', status: 'live', reachable: true,
    lastSeen: new Date().toISOString(), modelsHeld: 1, callsSettled: '0',
    attestation: { address: Keypair.generate().publicKey.toBase58(), signingKey: signing.publicKey.toBase58(), encryptionKey: toBase64(encKeys.publicKey), hardwareType: 'dev', measurement: 'ab'.repeat(48), recordedSlot: '1', expiresAtSlot: '999999', layoutVersion: 1 },
  }

  const runMockStream = async (stopAfterCount: number | null) => {
    const callAddr = Keypair.generate().publicKey
    let openedCeiling = '0'
    let openedInputHash = ''
    let savedStopToken = ''
    let savedReplyPub: Uint8Array | null = null
    let stopHit = false
    const emitted: { call: string; index: number; count: number; deltaTokens: number; envelope: string; pieceHash: string; runningHash: string; signature: string; finishReason: 'eos' | 'length' | 'ceiling' | 'stopped' | null }[] = []
    let settledReceipt: Record<string, unknown> | null = null
    const sseControllers: ReadableStreamDefaultController<Uint8Array>[] = []

    const pushFrame = (event: string, data: unknown) => {
      const frame = utf8(`event: ${event}\nid: ${event}-${emitted.length}\ndata: ${JSON.stringify({ id: `${event}-${emitted.length}`, timestamp: new Date().toISOString(), type: event, data })}\n\n`)
      for (const ctrl of sseControllers) { try { ctrl.enqueue(frame) } catch {} }
    }

    const startMockGeneration = async () => {
      const words = ['Hi', ' ', 'Voynich', '!']
      let runningHash = streamInitialHash(callAddr.toBytes(), fromHex(openedInputHash))
      let count = 0
      let index = 0
      for (let i = 0; i < words.length; i++) {
        await new Promise(r => setTimeout(r, 10))
        if (stopHit) {
          const envBytes = encryptCallOutput(utf8(JSON.stringify({ index, text: '', tokens: 0, finishReason: 'stopped' })), savedReplyPub!)
          runningHash = streamNextHash(runningHash, count, envBytes)
          const sig = signPiece(signing.secretKey.slice(0, 32), callAddr.toBytes(), fromHex(openedInputHash), count, runningHash, null)
          const piece = { call: callAddr.toBase58(), index, count, deltaTokens: 0, envelope: toBase64(envBytes), pieceHash: toHex(sha256(envBytes)), runningHash: toHex(runningHash), signature: toBase64(sig), finishReason: 'stopped' as const }
          emitted.push(piece)
          pushFrame('call.piece', piece)
          break
        }
        const finishReason = i === words.length - 1 ? ('eos' as const) : null
        count += 1
        const envBytes = encryptCallOutput(utf8(JSON.stringify({ index, text: words[i]!, tokens: 1, finishReason })), savedReplyPub!)
        runningHash = streamNextHash(runningHash, count, envBytes)
        const sig = signPiece(signing.secretKey.slice(0, 32), callAddr.toBytes(), fromHex(openedInputHash), count, runningHash, null)
        const piece = { call: callAddr.toBase58(), index, count, deltaTokens: 1, envelope: toBase64(envBytes), pieceHash: toHex(sha256(envBytes)), runningHash: toHex(runningHash), signature: toBase64(sig), finishReason }
        emitted.push(piece)
        pushFrame('call.piece', piece)
        index++
      }
      const last = emitted[emitted.length - 1]!
      const total = BigInt(last.count) * unitPrice
      const returned = BigInt(openedCeiling) - total
      settledReceipt = {
        address: mockReceiptAddr, call: callAddr.toBase58(), caller: mockSigner.publicKey.toBase58(), callerIsProgram: false,
        model: mockModelAddr, modelName: 'mock-text', enclave: mockEnclaveAddr, inputHash: openedInputHash,
        outputHash: last.runningHash, signature: last.signature, answerMode: 'sealed', openAnswer: null,
        deliveredCount: String(last.count), returnedAmount: returned.toString(), slot: '123', transactionSignature: '2'.repeat(88),
        payments: { mint: null, total: total.toString(), owner: { recipient: FIXTURE.owner, amount: (total - total * 2500n / 10000n - total * 500n / 10000n).toString() }, operator: { recipient: FIXTURE.operator, amount: (total * 2500n / 10000n).toString() }, protocol: { recipient: FIXTURE.feeRecipient, amount: (total * 500n / 10000n).toString() } },
      }
      pushFrame('call.stream.done', {
        call: callAddr.toBase58(), status: 'done', count: last.count, pieceCount: emitted.length,
        runningHash: last.runningHash, signature: last.signature, finishReason: last.finishReason,
        receiptAddress: mockReceiptAddr, settleTransaction: '2'.repeat(88), failure: null,
      })
      for (const ctrl of sseControllers) { try { ctrl.close() } catch {} }
    }

    const mockFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      const jsonResp = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
      if (url.endsWith('/v1/config')) {
        return jsonResp({ mode: 'fixture', cluster: 'localnet', rpcUrl: 'http://127.0.0.1:9704', programId: null, attestationProgramId: null, bountyProgramId: null, attestationRecordLayoutVersion: 1, feeRecipient: FIXTURE.feeRecipient, protocolShareBps: 500, callDeadlineSlots: '100', maxOpenAnswerBytes: 1024, tokenMint: null, fixture: true })
      }
      if (url.endsWith(`/v1/models/${mockModelAddr}`) || url.endsWith('/v1/models/mock-text')) return jsonResp(mockModel)
      if (url.endsWith(`/v1/models/${mockModelAddr}/enclaves`)) {
        return jsonResp({ items: [{ enclave: mockEnclave, grant: { address: Keypair.generate().publicKey.toBase58(), model: mockModelAddr, modelName: 'mock-text', enclave: mockEnclaveAddr, wrappedKey: toBase64(new Uint8Array(105).fill(1)), grantedBy: FIXTURE.owner, grantedSlot: '25', status: 'live' } }], asOf: new Date().toISOString() })
      }
      if (url.endsWith('/v1/calls/build')) {
        const body = JSON.parse(String(init?.body)) as { ceiling: string; inputHash: string }
        openedCeiling = body.ceiling
        openedInputHash = body.inputHash
        return jsonResp({ id: 'b-1', transactionBase64: toBase64(new Uint8Array(16).fill(7)), blockhash: '1'.repeat(32), lastValidBlockHeight: 100, cosigned: false, action: 'open_call', requiredSigners: [mockSigner.publicKey.toBase58()], fixture: true, addresses: { model: mockModelAddr, call: callAddr.toBase58() } })
      }
      if (url.endsWith('/v1/transactions/submit')) return jsonResp({ id: 'b-1', status: 'confirmed', signature: '3'.repeat(88) })
      if (url.endsWith(`/v1/calls/${callAddr.toBase58()}`)) {
        return jsonResp({
          address: callAddr.toBase58(), caller: mockSigner.publicKey.toBase58(), callerIsProgram: false,
          model: mockModelAddr, modelName: 'mock-text', enclave: mockEnclaveAddr, inputHash: openedInputHash,
          answerMode: 'sealed', price: { amount: openedCeiling, mint: null, decimals: 9, symbol: 'SOL' },
          priceUnit: 'token', unitPrice: mockModel.price, ceiling: { amount: openedCeiling, mint: null, decimals: 9, symbol: 'SOL' },
          openedSlot: '100', deadlineSlot: '200', status: settledReceipt ? 'settled' : 'open', receipt: settledReceipt ? mockReceiptAddr : null, failure: null,
        })
      }
      if (url.endsWith(`/v1/calls/${callAddr.toBase58()}/input`)) {
        const body = JSON.parse(String(init?.body)) as { envelope: string }
        const dec = JSON.parse(new TextDecoder().decode(decryptCallInput(fromBase64(body.envelope), encKeys.secretKey))) as { outputPublicKey: string; stopToken: string }
        savedReplyPub = fromBase64(dec.outputPublicKey)
        savedStopToken = dec.stopToken
        assert.equal(fromBase64(savedStopToken).length, 16)
        void startMockGeneration()
        return jsonResp({ call: callAddr.toBase58(), status: 'accepted' })
      }
      if (url.includes(`/v1/calls/${callAddr.toBase58()}/stream`)) {
        const rs = new ReadableStream<Uint8Array>({
          start(controller) {
            sseControllers.push(controller)
            for (const p of emitted) {
              controller.enqueue(utf8(`event: call.piece\ndata: ${JSON.stringify({ id: `p-${p.index}`, timestamp: new Date().toISOString(), type: 'call.piece', data: p })}\n\n`))
            }
          },
        })
        return new Response(rs, { status: 200, headers: { 'content-type': 'text/event-stream' } })
      }
      if (url.endsWith(`/v1/calls/${callAddr.toBase58()}/stop`)) {
        const body = JSON.parse(String(init?.body)) as { stopToken: string }
        if (body.stopToken !== savedStopToken) return jsonResp({ error: { code: 'UNAUTHORIZED', message: 'bad token', retryable: false, stage: 'auth' } }, 403)
        stopHit = true
        return jsonResp({ call: callAddr.toBase58(), status: settledReceipt ? 'already-finished' : 'stopping' })
      }
      if (url.endsWith(`/v1/calls/${callAddr.toBase58()}/pieces`)) {
        return jsonResp({ call: callAddr.toBase58(), status: settledReceipt ? 'done' : 'streaming', pieces: emitted, failure: null })
      }
      if (url.endsWith(`/v1/calls/${callAddr.toBase58()}/answer`)) {
        return jsonResp({
          status: settledReceipt ? 'answered' : 'waiting',
          call: { address: callAddr.toBase58(), caller: mockSigner.publicKey.toBase58(), callerIsProgram: false, model: mockModelAddr, modelName: 'mock-text', enclave: mockEnclaveAddr, inputHash: openedInputHash, answerMode: 'sealed', price: { amount: openedCeiling, mint: null, decimals: 9, symbol: 'SOL' }, priceUnit: 'token', unitPrice: mockModel.price, ceiling: { amount: openedCeiling, mint: null, decimals: 9, symbol: 'SOL' }, openedSlot: '100', deadlineSlot: '200', status: settledReceipt ? 'settled' : 'open', receipt: settledReceipt ? mockReceiptAddr : null, failure: null },
          outputEnvelope: null, openAnswer: null, outputHash: null, signature: null,
          settleTransaction: settledReceipt ? '2'.repeat(88) : null, receiptAddress: settledReceipt ? mockReceiptAddr : null, failure: null,
        })
      }
      if (url.endsWith(`/v1/receipts/${mockReceiptAddr}`)) {
        return jsonResp({ receipt: settledReceipt, enclaveSigningKey: signing.publicKey.toBase58(), attestationRecord: mockEnclave.attestation, attestationProgramId: Keypair.generate().publicKey.toBase58(), recordLayoutVersion: 1, modelBase: null })
      }
      throw new Error(`Unexpected mock URL: ${url}`)
    }) as typeof fetch

    const sdk = createVoynich({ apiUrl: 'http://mock.test', signer: mockSigner, fetch: mockFetch, pollMs: 10 })
    const s = await sdk.stream('mock-text', 'Hello')
    // Default ceiling: maxOutputTokens (16) * unitPrice (2000) = 32000.
    assert.equal(s.ceiling, '32000')
    const seen: { text: string; count: number; spentAmount?: string; remainingAmount?: string; finishReason: string | null }[] = []
    for await (const p of s) {
      seen.push({ text: p.text, count: p.count, spentAmount: p.spentAmount, remainingAmount: p.remainingAmount, finishReason: p.finishReason })
      if (stopAfterCount !== null && p.count === stopAfterCount) {
        await s.stop()
      }
    }
    const finalRes = await s.final()
    return { seen, finalRes, lastPiece: s.lastPiece() }
  }

  const full = await runMockStream(null)
  assert.equal(full.finalRes.text, 'Hi Voynich!')
  assert.equal(full.finalRes.count, 4)
  assert.equal(full.finalRes.finishReason, 'eos')
  assert.equal(full.finalRes.spentAmount, '8000')
  assert.equal(full.finalRes.returnedAmount, '24000')
  assert.equal(full.seen[0]!.spentAmount, '2000')
  assert.equal(full.seen[0]!.remainingAmount, '30000')
  assert.equal(full.lastPiece?.count, 4)
  assert.equal(full.finalRes.checks.signature, true)

  const cut = await runMockStream(2)
  assert.equal(cut.finalRes.text, 'Hi ')
  assert.equal(cut.finalRes.count, 2)
  assert.equal(cut.finalRes.finishReason, 'stopped')
  assert.equal(cut.finalRes.spentAmount, '4000')
  assert.equal(cut.finalRes.returnedAmount, '28000')
  assert.equal(cut.lastPiece?.finishReason, 'stopped')
  assert.equal(cut.finalRes.checks.signature, true)
})

test('Review Blocking #1: prefix-tolerant Model decode on pre-Build-4 0x2e slack and allowedMeasurements eligibility in builders & ReadModel', async () => {
  const { ReadModel } = await import('../src/chain/read-model.js')
  const buildersMod = await import('../src/chain/builders.js')
  const decodeModelAccountForBuilder = (buildersMod as Record<string, unknown>).decodeModelAccountForBuilder as
    | ((voynich: ReturnType<typeof chainPrograms>['voynich'], data: Uint8Array) => { priceUnit: { call?: Record<string, never>; token?: Record<string, never> }; allowedMeasurements: number[][] })
    | undefined
  assert.equal(typeof decodeModelAccountForBuilder, 'function', 'decodeModelAccountForBuilder must be exported from builders.ts')

  const programId = Keypair.generate().publicKey
  const attestId = Keypair.generate().publicKey
  const { voynich } = chainPrograms({} as never, { programId, attestationProgramId: attestId })

  const allowedHex = 'aa'.repeat(48)
  const unallowedHex = 'bb'.repeat(48)
  const owner = Keypair.generate().publicKey
  const weight = Keypair.generate().publicKey
  const uploadKey = Keypair.generate().publicKey
  const encoded = await voynich.coder.accounts.encode('model', {
    owner,
    name: 'text-1m',
    manifest: Buffer.from(JSON.stringify({ name: 'text-1m', inputKind: 'text', tokenizer: { format: 'byte-level', vocabSize: 258, maxInputTokens: 128 } })),
    weights: [weight],
    sizeBytes: new BN(214737),
    cipher: 'xchacha20poly1305-64k-v1',
    noncePrefix: Array.from(Buffer.alloc(16, 1)),
    ciphertextSha256: Array.from(Buffer.alloc(32, 2)),
    allowedMeasurements: [Array.from(Buffer.from(allowedHex, 'hex'))],
    price: new BN(5_000_000),
    priceMint: PublicKey.default,
    operatorShareBps: 2500,
    uploadKey,
    status: { live: {} },
    createdSlot: new BN(10),
    sealedSlot: new BN(20),
    callsSettled: new BN(2),
    bump: 255,
    uploadKeys: [],
    hashVersion: 1,
    sealedChunks: 4,
    merkleFrontier: [],
    merkleFrontierMask: 0,
    base: {
      sha256: Array.from(Buffer.alloc(32, 3)),
      sizeBytes: new BN(6143522),
      format: 'onnx',
      source: 'https://example.com/text-1m-base.onnx',
    },
    priceUnit: { call: {} },
  })
  // Simulate pre-Build-4 8,192-byte account with stale Vec slack byte 0x2e right where priceUnit sits.
  const padded = Buffer.alloc(8192)
  encoded.copy(padded, 0)
  padded[encoded.length - 1] = 0x2e

  // Raw Anchor decode throws on 0x2e; prefix-tolerant builder helper must succeed as priceUnit=call.
  assert.throws(() => voynich.coder.accounts.decode('model', padded))
  const decoded = decodeModelAccountForBuilder!(voynich, padded)
  assert.ok('call' in decoded.priceUnit, 'pre-Build-4 slack byte must decode as priceUnit=call')

  // Builders.open must return MEASUREMENT_NOT_ALLOWED (422) rather than 500 on unallowed enclave measurement.
  const modelKey = addresses(programId, attestId).model('text-1m')
  const enclaveKey = Keypair.generate().publicKey
  const callerKey = Keypair.generate().publicKey
  const fakeRuntime = {
    programId,
    addresses: addresses(programId, attestId),
    env: {},
    db: {},
    rpc: {
      connection: {
        getAccountInfo: async (key: PublicKey) => (key.equals(modelKey) ? { data: padded, owner: programId } : null),
        getSlot: async () => 100,
      },
    },
    programs: {
      voynich: {
        programId,
        coder: voynich.coder,
        account: {
          model: { fetchNullable: async () => { throw new Error('Invalid enum variant: 46') } },
          enclave: {
            fetchNullable: async () => ({
              attestationRecord: Keypair.generate().publicKey,
              measurement: Array.from(Buffer.from(unallowedHex, 'hex')),
              expiresAtSlot: new BN(500),
            }),
          },
        },
      },
    },
  } as unknown as ChainRuntime

  const b = builders(fakeRuntime)
  await assert.rejects(
    () => b.open({
      wallet: callerKey.toBase58(),
      model: modelKey.toBase58(),
      enclave: enclaveKey.toBase58(),
      inputHash: 'cc'.repeat(32),
      answerMode: 'sealed',
    }),
    (err: unknown) => {
      const failure = err as { status?: number; body?: { error?: { code?: string } } }
      return failure.status === 422 && failure.body?.error?.code === 'MEASUREMENT_NOT_ALLOWED'
    },
    'builders.open must reject unallowed enclave measurement with 422 MEASUREMENT_NOT_ALLOWED',
  )

  // ReadModel.modelRow and modelEnclaves must filter out unallowed measurements.
  const grantCountWhere: unknown[] = []
  const modelDbRow = {
    address: modelKey.toBase58(),
    name: 'text-1m',
    owner: owner.toBase58(),
    createdSlot: 10n,
    sealedSlot: 20n,
    ciphertextSize: 214737n,
    plaintextSize: 214673n,
    ciphertextSha256: '02'.repeat(32),
    hashVersion: 1,
    sealedChunks: 4,
    baseSha256: '03'.repeat(32),
    baseSizeBytes: 6143522n,
    baseFormat: 'onnx',
    baseSource: 'https://example.com/text-1m-base.onnx',
    noncePrefix: Buffer.alloc(16, 1),
    allowedMeasurements: [allowedHex],
    price: { toFixed: () => '5000000' },
    priceMint: null,
    priceUnit: 'call',
    operatorShareBps: 2500,
    status: 'live',
    manifest: Buffer.from(JSON.stringify({ name: 'text-1m', inputKind: 'text', tokenizer: { format: 'byte-level', vocabSize: 258, maxInputTokens: 128 } })),
    weights: [],
    callsSettled: 2n,
    uploadKey: null,
    uploadKeys: [],
    indexingIssue: null,
  }
  const makeGrantRow = (measurement: string, expiresAtSlot: bigint, addr: string) => ({
    address: addr,
    modelAddress: modelKey.toBase58(),
    enclaveAddress: enclaveKey.toBase58(),
    wrappedKey: Buffer.alloc(32, 4),
    grantedBy: owner.toBase58(),
    grantedSlot: 21n,
    revokedSlot: null,
    model: modelDbRow,
    enclave: {
      address: enclaveKey.toBase58(),
      signingKey: enclaveKey.toBase58(),
      encryptionKey: Buffer.alloc(32, 5),
      operator: owner.toBase58(),
      endpoint: 'https://enclave.example.com',
      reachable: true,
      lastSeen: new Date(),
      callsSettled: 2n,
      attestationRecord: {
        address: Keypair.generate().publicKey.toBase58(),
        signingKey: enclaveKey.toBase58(),
        hardwareType: 'dev',
        measurement,
        recordedSlot: 15n,
        expiresAtSlot,
        layoutVersion: 1,
      },
    },
  })
  const fakeDb = {
    sharedProtocolState: { findUnique: async () => ({ id: 'protocol', currentSlot: 100n, config: { protocolShareBps: 500 } }) },
    model: { findFirst: async () => modelDbRow },
    grant: {
      count: async (args: { where: unknown }) => {
        grantCountWhere.push(args.where)
        const w = args.where as { enclave?: { attestationRecord?: { measurement?: { in?: string[] } } } }
        return w.enclave?.attestationRecord?.measurement?.in ? 0 : 1
      },
      findMany: async () => [
        makeGrantRow(unallowedHex, 500n, Keypair.generate().publicKey.toBase58()),
        makeGrantRow(allowedHex, 50n, Keypair.generate().publicKey.toBase58()), // expired
      ],
    },
  }
  const rm = new ReadModel(fakeDb as never, {} as never, programId, attestId)
  const mView = await rm.model(modelKey.toBase58())
  assert.equal(mView.enclavesHolding, 0, 'enclavesHolding must require measurement in model.allowedMeasurements')
  const me = await rm.modelEnclaves(modelKey.toBase58())
  assert.equal(me.items.length, 0, 'modelEnclaves must exclude unallowed or expired enclaves')
})

test('Review Blocking #2: crank SPL refund ATA derivation allows off-curve PDA callers', () => {
  const refundCallerTokenAccount = (crankMod as Record<string, unknown>).refundCallerTokenAccount as
    | ((priceMint: PublicKey, caller: PublicKey) => PublicKey)
    | undefined
  assert.equal(typeof refundCallerTokenAccount, 'function', 'refundCallerTokenAccount must be exported from crank.ts')
  const mint = Keypair.generate().publicKey
  const programId = Keypair.generate().publicKey
  const [pdaCaller] = PublicKey.findProgramAddressSync([Buffer.from('caller'), Keypair.generate().publicKey.toBuffer()], programId)
  assert.equal(PublicKey.isOnCurve(pdaCaller.toBytes()), false, 'test caller must be off-curve PDA')
  const ata = refundCallerTokenAccount!(mint, pdaCaller)
  assert.ok(ata instanceof PublicKey)
})

test('Build 4 Step 5: POST /v1/calls/:id/settle/build (pre-flight sig, 403 unauthorized, ed25519IxIndex), fixture client.settle(), and enclave CallNotOpen race', async () => {
  const { buildApp } = await import('../src/app.js')
  const { createVoynich } = await import('../sdk/src/client.js')
  const { fromHex, signPiece, streamInitialHash, streamNextHash } = await import('voynich/crypto')
  const { Ed25519Program } = await import('@solana/web3.js')

  // 1. Chain builder pre-flight checks: unauthorized third party -> 403, tampered sig -> 422, valid caller -> ed25519IxIndex=2.
  const programId = Keypair.generate().publicKey
  const attestId = Keypair.generate().publicKey
  const { voynich } = chainPrograms({} as never, { programId, attestationProgramId: attestId })
  const caller = Keypair.generate().publicKey
  const operator = Keypair.generate().publicKey
  const stranger = Keypair.generate().publicKey
  const owner = Keypair.generate().publicKey
  const feeRecipient = Keypair.generate().publicKey
  const modelKey = addresses(programId, attestId).model('text-1m')
  const enclaveSigning = Keypair.generate()
  const enclaveKey = addresses(programId, attestId).enclave(enclaveSigning.publicKey)
  const callKey = addresses(programId, attestId).call(caller, 1n)
  const measHex = 'ab'.repeat(48)
  const inputHash = sha256(utf8('step5-input'))
  const callBuf = Buffer.alloc(349)
  Buffer.from(sha256(utf8('account:Call')).subarray(0, 8)).copy(callBuf, 0)
  caller.toBuffer().copy(callBuf, 8)
  modelKey.toBuffer().copy(callBuf, 40)
  enclaveKey.toBuffer().copy(callBuf, 72)
  callBuf.writeBigUInt64LE(1n, 104)
  Buffer.from(inputHash).copy(callBuf, 112)
  callBuf.writeBigUInt64LE(2_000n, 144) // unit price
  PublicKey.default.toBuffer().copy(callBuf, 152) // SOL
  owner.toBuffer().copy(callBuf, 184)
  operator.toBuffer().copy(callBuf, 216)
  feeRecipient.toBuffer().copy(callBuf, 248)
  callBuf.writeUInt16LE(2500, 280)
  callBuf.writeUInt16LE(500, 282)
  callBuf.writeBigUInt64LE(10n, 284)
  callBuf.writeBigUInt64LE(500n, 292)
  callBuf[300] = 0 // open
  callBuf[301] = 255
  callBuf[302] = 0 // sealed
  callBuf[303] = 0 // callerIsProgram=false
  PublicKey.default.toBuffer().copy(callBuf, 304)
  callBuf.writeUInt32LE(0, 336) // callbackAccounts len=0
  callBuf[340] = 1 // priceUnit=token
  callBuf.writeBigUInt64LE(200_000n, 341) // ceiling

  const runningHash = streamNextHash(streamInitialHash(callKey.toBytes(), inputHash), 5, utf8('piece-5'))
  const validSig = signPiece(enclaveSigning.secretKey.slice(0, 32), callKey.toBytes(), inputHash, 5, runningHash, null)
  const badSig = new Uint8Array(validSig)
  badSig[0] ^= 0xff

  let builtSettleIxData: Buffer | null = null
  const fakeRuntime = {
    programId,
    addresses: addresses(programId, attestId),
    env: {},
    db: { transaction: { create: async () => {} } },
    rpc: {
      connection: {
        getAccountInfo: async (key: PublicKey) => (key.equals(callKey) ? { data: callBuf, owner: programId } : null),
        getSlot: async () => 100,
        getMinimumBalanceForRentExemption: async () => 3_000_000,
        getLatestBlockhashAndContext: async () => ({ context: { slot: 100 }, value: { blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 200 } }),
        simulateTransaction: async () => ({ value: { err: null, unitsConsumed: 35_000 } }),
        getFeeForMessage: async () => ({ value: 5_000 }),
      },
    },
    programs: {
      voynich: {
        programId,
        coder: voynich.coder,
        account: {
          model: {
            fetchNullable: async () => ({
              allowedMeasurements: [Array.from(Buffer.from(measHex, 'hex'))],
              base: null,
            }),
          },
          enclave: {
            fetchNullable: async () => ({
              signingKey: enclaveSigning.publicKey,
              attestationRecord: Keypair.generate().publicKey,
              measurement: Array.from(Buffer.from(measHex, 'hex')),
              expiresAtSlot: new BN(999),
            }),
          },
        },
        methods: {
          settleMeteredCall: (...args: unknown[]) => ({
            accountsStrict: () => ({
              remainingAccounts: () => ({
                instruction: async () => {
                  const ix = await voynich.methods.settleMeteredCall(...(args as Parameters<typeof voynich.methods.settleMeteredCall>)).accountsStrict({
                    payer: caller, config: addresses(programId, attestId).config, model: modelKey, enclave: enclaveKey,
                    attestationRecord: Keypair.generate().publicKey, call: callKey, receipt: addresses(programId, attestId).receipt(callKey),
                    caller, owner, operator, feeRecipient, instructions: new PublicKey('Sysvar1nstructions1111111111111111111111111'),
                    escrowTokens: null, ownerTokens: null, operatorTokens: null, protocolTokens: null, callerTokens: null,
                    tokenProgram: null, systemProgram: SystemProgram.programId,
                    eventAuthority: addresses(programId, attestId).config, program: programId,
                  }).instruction()
                  builtSettleIxData = Buffer.from(ix.data)
                  return ix
                },
              }),
            }),
          }),
        },
      },
    },
  } as unknown as ChainRuntime

  const b = builders(fakeRuntime)
  await assert.rejects(
    () => b.settleMetered(callKey.toBase58(), { wallet: stranger.toBase58(), count: '5', runningHash: toHex(runningHash), signature: toBase64(validSig) }),
    (err: unknown) => (err as { status?: number; body?: { error?: { code?: string } } }).status === 403 && (err as { body?: { error?: { code?: string } } }).body?.error?.code === 'UNAUTHORIZED',
    'third party must get 403 UNAUTHORIZED',
  )
  await assert.rejects(
    () => b.settleMetered(callKey.toBase58(), { wallet: caller.toBase58(), count: '5', runningHash: toHex(runningHash), signature: toBase64(badSig) }),
    (err: unknown) => (err as { status?: number; body?: { error?: { code?: string } } }).status === 422 && (err as { body?: { error?: { code?: string } } }).body?.error?.code === 'INVALID_ENVELOPE',
    'bad signature must get 422 INVALID_ENVELOPE',
  )
  const built = await b.settleMetered(callKey.toBase58(), { wallet: caller.toBase58(), count: '5', runningHash: toHex(runningHash), signature: toBase64(validSig) })
  assert.equal(built.action, 'settle_metered_call')
  assert.equal(built.addresses.receipt, addresses(programId, attestId).receipt(callKey).toBase58())
  assert.ok(builtSettleIxData !== null)
  // Last 2 bytes of settleMeteredCall data are u16 LE ed25519_instruction_index = 2 (2 ComputeBudget ixs + 0 SPL ATA prep).
  assert.equal(builtSettleIxData!.readUInt16LE(builtSettleIxData!.length - 2), 2)
  assert.ok(Ed25519Program.programId)

  // 2. Fixture app POST /v1/calls/:id/settle/build + SDK client.settle() on a cut-short metered call.
  const fixtureApp = buildApp()
  const sessionHeader = 'step5-fixture-session'
  const fixtureFetch: typeof fetch = async (input, init) => {
    const req = input instanceof Request ? input : new Request(typeof input === 'string' ? input : input.toString(), init)
    const headers = new Headers(req.headers)
    headers.set('X-Fixture-Session', sessionHeader)
    headers.set('X-Fixture', 'call-answering')
    const url = new URL(req.url)
    const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer()
    return fixtureApp.request(url.pathname + url.search, { method: req.method, headers, body })
  }
  const fixtureCaller = Keypair.generate()
  const fixtureOwner = Keypair.generate()
  const ownerClient = createVoynich({ apiUrl: 'http://fixture.local', signer: fixtureOwner, fetch: fixtureFetch })
  const callerClient = createVoynich({ apiUrl: 'http://fixture.local', signer: fixtureCaller, fetch: fixtureFetch })
  const sketchModel = await ownerClient.model('sketch-32')
  // Switch sketch-32 to per-token in fixture session so we can open a metered call in call-answering state (unsettled).
  const priceBuild = await ownerClient.api.setPrice(sketchModel.address, {
    wallet: sketchModel.owner,
    price: { amount: '2000', mint: null, decimals: 9, symbol: 'SOL' },
    operatorShareBps: 2500,
    priceUnit: 'token',
  })
  await ownerClient.api.submitTransaction({ mode: 'relay', buildId: priceBuild.id, signedTransactionBase64: priceBuild.transactionBase64, idempotencyKey: 'step5-price' })
  const enclaves = await callerClient.api.modelEnclaves(sketchModel.address)
  const targetEnclave = enclaves.items[0]!.enclave
  const fxInputHash = toHex(sha256(utf8('fx-step5-input')))
  const openBuild = await callerClient.api.openCall({
    wallet: fixtureCaller.publicKey.toBase58(),
    model: sketchModel.address,
    enclave: targetEnclave.address,
    inputHash: fxInputHash,
    answerMode: 'sealed',
    ceiling: '20000',
  })
  await callerClient.api.submitTransaction({ mode: 'relay', buildId: openBuild.id, signedTransactionBase64: openBuild.transactionBase64, idempotencyKey: 'step5-open' })
  const fxCallAddr = openBuild.addresses.call!
  // Construct a real fixture enclave signed piece at count = 4 (8000 spent, 12000 returned).
  const fxSigningSeed = sha256(utf8('voynich/fixture/enclave/signing/v1'))
  const fxCallBytes = new PublicKey(fxCallAddr).toBytes()
  const fxRunning = streamNextHash(streamInitialHash(fxCallBytes, fromHex(fxInputHash)), 4, utf8('fx-piece-4'))
  const fxSig = signPiece(fxSigningSeed, fxCallBytes, fromHex(fxInputHash), 4, fxRunning, null)
  const settled = await callerClient.settle(fxCallAddr, { count: 4, runningHash: toHex(fxRunning), signature: toBase64(fxSig) })
  assert.equal(settled.receipt.deliveredCount, '4')
  assert.equal(settled.receipt.payments.total, '8000')
  assert.equal(settled.receipt.returnedAmount, '12000')
  assert.equal(settled.verification.signature, true)
})

test('Build 4 Step 7: LaserStream config resolution, wake-up dispatch, coalesced catch-up, slow fallback, and clean shutdown', async () => {
  const { resolveLaserStreamConfig, createIndexerJob, DEFAULT_RECONCILE_MS } = await import('../src/chain/indexer.js')

  // 1. Config resolution: absent endpoint -> null (localnet poll mode); api-key fallback from SOLANA_RPC_URL; explicit key overrides.
  assert.equal(resolveLaserStreamConfig({ SOLANA_RPC_URL: 'http://127.0.0.1:9704' }), null)
  assert.equal(resolveLaserStreamConfig({ LASERSTREAM_ENDPOINT: 'https://laserstream-mainnet-ewr.helius-rpc.com', SOLANA_RPC_URL: 'https://api.mainnet-beta.solana.com' }), null)
  assert.deepEqual(
    resolveLaserStreamConfig({
      LASERSTREAM_ENDPOINT: 'https://laserstream-mainnet-ewr.helius-rpc.com',
      SOLANA_RPC_URL: 'https://mainnet.helius-rpc.com/?api-key=secret-from-url',
    }),
    { endpoint: 'https://laserstream-mainnet-ewr.helius-rpc.com', apiKey: 'secret-from-url', reconcileMs: DEFAULT_RECONCILE_MS },
  )
  assert.deepEqual(
    resolveLaserStreamConfig({
      LASERSTREAM_ENDPOINT: 'https://laserstream-mainnet-ewr.helius-rpc.com',
      LASERSTREAM_API_KEY: 'explicit-key',
      SOLANA_RPC_URL: 'https://mainnet.helius-rpc.com/?api-key=secret-from-url',
      INDEXER_RECONCILE_MS: 45_000,
    }),
    { endpoint: 'https://laserstream-mainnet-ewr.helius-rpc.com', apiKey: 'explicit-key', reconcileMs: 45_000 },
  )

  // 2. Wake-driven driver: initial catch-up, setAddresses, coalesced burst wakes, slow fallback, clean stop.
  let triggerWake: (() => void) | null = null
  let subscribedAddresses: string[] = []
  let streamClosed = false
  let indexerStopped = false
  let catchUpCount = 0
  let releaseSecondCycle: (() => void) | null = null
  let secondCycleStarted!: () => void
  const secondCycleReady = new Promise<void>(r => { secondCycleStarted = r })

  const job = createIndexerJob({
    addresses: ['prog1', 'prog2', 'cfg1'],
    isReady: () => true,
    reconcileMs: 60_000,
    pollMs: 50,
    stream: async (wake) => {
      triggerWake = wake
      return {
        async setAddresses(addrs: string[]) { subscribedAddresses = [...addrs] },
        async close() { streamClosed = true },
      }
    },
    catchUp: async () => {
      catchUpCount++
      if (catchUpCount === 2) {
        secondCycleStarted()
        await new Promise<void>(r => { releaseSecondCycle = r })
      }
    },
    stopIndexer: async () => { indexerStopped = true },
  })

  await job.start()
  // Wait for initial catchUp (cycle #1) and setAddresses.
  for (let i = 0; i < 40 && catchUpCount < 1; i++) await new Promise(r => setTimeout(r, 10))
  assert.equal(catchUpCount, 1)
  assert.deepEqual(subscribedAddresses, ['prog1', 'prog2', 'cfg1'])
  assert.ok(triggerWake !== null, 'stream wake callback must be wired')

  // Idle check: slow fallback (60s) must NOT fire another cycle within 80ms.
  await new Promise(r => setTimeout(r, 80))
  assert.equal(catchUpCount, 1, 'must stay idle on slow fallback without polling')

  // Trigger wake -> starts cycle #2; fire 5 burst wakes while cycle #2 is in flight -> must coalesce into exactly cycle #3.
  triggerWake!()
  await secondCycleReady
  assert.equal(catchUpCount, 2)
  triggerWake!()
  triggerWake!()
  triggerWake!()
  triggerWake!()
  triggerWake!()
  releaseSecondCycle!()
  for (let i = 0; i < 40 && catchUpCount < 3; i++) await new Promise(r => setTimeout(r, 10))
  await new Promise(r => setTimeout(r, 60))
  assert.equal(catchUpCount, 3, 'burst wakes during in-flight cycle must coalesce into exactly 1 follow-up cycle')

  // Clean shutdown: closes stream, stops indexer, ignores subsequent wakes.
  await job.stop()
  assert.equal(streamClosed, true)
  assert.equal(indexerStopped, true)
  triggerWake!()
  await new Promise(r => setTimeout(r, 40))
  assert.equal(catchUpCount, 3, 'stopped job must ignore late wakes')
})

test('Build 5 Step 1: reproducible enclave build produces byte-identical runtime.js, deterministic recipe.json, pinned Dockerfile, and zero host paths', async () => {
  const { mkdtempSync, readFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join, resolve } = await import('node:path')
  const buildMod = await import('../enclave/build.mjs' as string) as {
    BACKEND_DIR: string
    ENCLAVE_DIR: string
    RECIPE_INPUTS: string[]
    assertNoHostPaths: (source: string, extra?: string[]) => void
    buildEnclave: (opts?: { outDir?: string }) => Promise<{
      runtimeOut: string
      recipeOut: string
      runtimeBuffer: Buffer
      recipe: {
        version: string
        nodeVersion: string
        esbuildVersion: string
        lockfileSha256: string
        runtimeBytes: number
        measurement: string
        recipeHash: string
      }
    }>
    computeRecipeHash: (backendDir?: string, overrides?: Record<string, string>) => string
  }

  // 1. Dockerfile pins node:22-bookworm-slim by sha256 digest and sets SOURCE_DATE_EPOCH + npm ci --include=dev.
  const dockerfile = readFileSync(resolve(buildMod.ENCLAVE_DIR, 'Dockerfile'), 'utf8')
  assert.match(dockerfile, /^FROM node:22-bookworm-slim@sha256:[0-9a-f]{64}/m)
  assert.match(dockerfile, /SOURCE_DATE_EPOCH/)
  assert.match(dockerfile, /npm ci --include=dev/)

  // 2. computeRecipeHash is invariant to CRLF vs LF line endings across all recipe inputs.
  const lfHash = buildMod.computeRecipeHash(buildMod.BACKEND_DIR)
  assert.match(lfHash, /^[0-9a-f]{64}$/)
  const crlfOverrides: Record<string, string> = {}
  for (const rel of buildMod.RECIPE_INPUTS) {
    crlfOverrides[rel] = readFileSync(resolve(buildMod.BACKEND_DIR, rel), 'utf8').replace(/\r?\n/g, '\r\n')
  }
  assert.equal(buildMod.computeRecipeHash(buildMod.BACKEND_DIR, crlfOverrides), lfHash)

  // 3. assertNoHostPaths rejects Windows drive paths, Unix home paths, and container /app/enclave paths while allowing URLs and /application MIME types.
  assert.doesNotThrow(() => buildMod.assertNoHostPaths('const url = "https://github.com/org/repo"; const ct = "text/application/json";\n', ['/app', '/root', '/app/enclave']))
  assert.throws(() => buildMod.assertNoHostPaths('const p = "D:/workspace/app/secret";\n'), /Host-specific path/)
  assert.throws(() => buildMod.assertNoHostPaths('const p = "/home/alice/voynich";\n'), /Host-specific path/)
  assert.throws(() => buildMod.assertNoHostPaths('const p = "/Users/alice/voynich";\n'), /Host-specific path/)
  assert.throws(() => buildMod.assertNoHostPaths('const p = "/app/enclave/src/runtime.ts";\n', ['/app', '/root', '/app/enclave']), /Host-specific path/)
  assert.throws(() => buildMod.assertNoHostPaths('const p = "/root/.npm/cache";\n', ['/app', '/root', '/app/enclave']), /Host-specific path/)

  // 4. Two clean enclave builds into separate directories produce byte-identical runtime.js and recipe.json.
  const scratch = mkdtempSync(join(tmpdir(), 'voynich-b5s1-test-'))
  try {
    const first = await buildMod.buildEnclave({ outDir: join(scratch, 'a') })
    const second = await buildMod.buildEnclave({ outDir: join(scratch, 'b') })
    assert.equal(Buffer.compare(first.runtimeBuffer, second.runtimeBuffer), 0)
    assert.equal(first.runtimeBuffer.toString('utf8').includes('\r\n'), false)
    assert.doesNotThrow(() => buildMod.assertNoHostPaths(first.runtimeBuffer.toString('utf8'), ['/app', '/root', '/app/enclave']))
    assert.equal(first.recipe.measurement, second.recipe.measurement)
    assert.match(first.recipe.measurement, /^[0-9a-f]{96}$/)
    assert.equal(first.recipe.recipeHash, lfHash)
    assert.equal(first.recipe.runtimeBytes, first.runtimeBuffer.length)
    assert.match(first.recipe.lockfileSha256, /^[0-9a-f]{64}$/)
    assert.equal(readFileSync(first.recipeOut, 'utf8'), readFileSync(second.recipeOut, 'utf8'))
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
})

test('Build 5 Step 2: measurementPda, decodeMeasurementAccount, fixture measurement routes, and SDK publishMeasurement/deprecateMeasurement', async () => {
  const { Keypair } = await import('@solana/web3.js')
  const { createVoynich } = await import('voynich')
  const { MEASUREMENT_SPACE, decodeMeasurementAccount, measurementPda } = await import('voynich/program')
  const { sha256, utf8 } = await import('voynich/crypto')
  const { buildApp } = await import('../src/app.js')

  // 1. measurementPda splits 48-byte digest cleanly into [b"measurement", digest[0..32], digest[32..48]].
  const digest = 'ab'.repeat(48)
  const recipeHash = 'cd'.repeat(32)
  const pdaFromHex = measurementPda(digest)
  const pdaFromBytes = measurementPda(Uint8Array.from(Buffer.from(digest, 'hex')))
  assert.equal(pdaFromHex.toBase58(), pdaFromBytes.toBase58())
  assert.throws(() => measurementPda('abcd'), /48 bytes/)

  // 2. decodeMeasurementAccount decodes a 366-byte Anchor Measurement account layout.
  const publisher = Keypair.generate()
  const raw = Buffer.alloc(MEASUREMENT_SPACE)
  const disc = sha256(utf8('account:Measurement')).subarray(0, 8)
  let off = 0
  raw.set(disc, off); off += 8
  raw.set(Buffer.from(digest, 'hex'), off); off += 48
  raw.set(publisher.publicKey.toBytes(), off); off += 32
  const writeStr = (s: string) => {
    const b = Buffer.from(s, 'utf8')
    raw.writeUInt32LE(b.length, off); off += 4
    raw.set(b, off); off += b.length
  }
  writeStr('https://github.com/voynich-dev/voynich')
  writeStr('abcdef1234567890abcdef1234567890abcdef12')
  raw.set(Buffer.from(recipeHash, 'hex'), off); off += 32
  writeStr('0.1.3')
  raw.writeBigUInt64LE(472500000n, off); off += 8
  raw[off++] = 0 // active
  raw[off++] = 253 // bump
  const decoded = decodeMeasurementAccount(raw)
  assert.equal(decoded.digest, digest)
  assert.equal(decoded.publisher.toBase58(), publisher.publicKey.toBase58())
  assert.equal(decoded.sourceRepo, 'https://github.com/voynich-dev/voynich')
  assert.equal(decoded.commitSha, 'abcdef1234567890abcdef1234567890abcdef12')
  assert.equal(decoded.recipeHash, recipeHash)
  assert.equal(decoded.version, '0.1.3')
  assert.equal(decoded.createdSlot.toString(), '472500000')
  assert.equal(decoded.status, 'active')
  assert.equal(decoded.bump, 253)

  // 3. Fixture API + SDK publishMeasurement, measurements, measurement, deprecateMeasurement, and error guards.
  const app = buildApp()
  const sessionId = 'b5s2-measurement-test'
  const localFetch: typeof fetch = async (input, init) => {
    const req = input instanceof Request ? input : new Request(String(input), init)
    const headers = new Headers(req.headers)
    headers.set('X-Fixture-Session', sessionId)
    return app.fetch(new Request(req, { headers }))
  }
  const pubClient = createVoynich({ apiUrl: 'http://127.0.0.1:9702', signer: publisher, fetch: localFetch })
  const outsiderClient = createVoynich({ apiUrl: 'http://127.0.0.1:9702', signer: Keypair.generate(), fetch: localFetch })

  const emptyList = await pubClient.measurements()
  assert.equal(emptyList.items.length, 0)

  const published = await pubClient.publishMeasurement({
    digest,
    sourceRepo: 'https://github.com/voynich-dev/voynich',
    commitSha: 'abcdef1234567890abcdef1234567890abcdef12',
    recipeHash,
    version: '0.1.3',
  })
  assert.equal(published.digest, digest)
  assert.equal(published.publisher, publisher.publicKey.toBase58())
  assert.equal(published.status, 'active')

  const fetched = await pubClient.measurement(digest)
  assert.equal(fetched.address, published.address)
  assert.equal((await pubClient.measurements({ status: 'active' })).items.length, 1)

  // Duplicate publish -> 409 MEASUREMENT_ALREADY_EXISTS
  await assert.rejects(
    () => pubClient.publishMeasurement({
      digest,
      sourceRepo: 'https://github.com/voynich-dev/voynich',
      commitSha: 'abcdef1234567890abcdef1234567890abcdef12',
      recipeHash,
      version: '0.1.3',
    }),
    /already exists|MEASUREMENT_ALREADY_EXISTS/i,
  )

  // Outsider deprecate -> 403 UNAUTHORIZED
  await assert.rejects(() => outsiderClient.deprecateMeasurement(digest), /publisher or protocol admin|UNAUTHORIZED/i)

  // Publisher deprecate -> status: deprecated; second deprecate -> 409 MEASUREMENT_DEPRECATED
  const deprecated = await pubClient.deprecateMeasurement(digest)
  assert.equal(deprecated.status, 'deprecated')
  assert.equal((await pubClient.measurements({ status: 'deprecated' })).items.length, 1)
  assert.equal((await pubClient.measurements({ status: 'active' })).items.length, 0)
  await assert.rejects(() => pubClient.deprecateMeasurement(digest), /already deprecated|MEASUREMENT_DEPRECATED/i)
})

test('Build 5 Step 3: voynich measurement CLI list, show, publish, verify (--recipe & --rebuild), mismatch/deprecated rejection, and deprecate', async () => {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const execFileAsync = promisify(execFile)
  const { mkdtempSync, readFileSync, rmSync, writeFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join, resolve } = await import('node:path')
  const { serve } = await import('@hono/node-server')
  const { Keypair } = await import('@solana/web3.js')
  const { buildApp } = await import('../src/app.js')

  const app = buildApp()
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 })
  await new Promise<void>(r => server.once('listening', () => r()))
  const addr = server.address() as { port: number }
  const apiUrl = `http://127.0.0.1:${addr.port}`
  const scratch = mkdtempSync(join(tmpdir(), 'voynich-b5s3-cli-'))
  const keypairPath = join(scratch, 'publisher.json')
  const publisher = Keypair.generate()
  writeFileSync(keypairPath, JSON.stringify([...publisher.secretKey]))
  const cliPath = resolve('sdk/dist/cli.js')
  const recipePath = resolve('enclave/dist/recipe.json')
  const recipe = JSON.parse(readFileSync(recipePath, 'utf8')) as {
    measurement: string
    recipeHash: string
    version: string
  }

  const runCli = async (args: string[], expectFail = false) => {
    try {
      const { stdout } = await execFileAsync(process.execPath, [cliPath, '--api-url', apiUrl, '--keypair', keypairPath, ...args], {
        cwd: resolve('.'),
        encoding: 'utf8',
      })
      if (expectFail) throw new Error(`Expected CLI failure for ${args.join(' ')}, got stdout: ${stdout}`)
      return { status: 0, json: JSON.parse(stdout) as Record<string, unknown> }
    } catch (err) {
      if (!expectFail) throw err
      const e = err as { code?: number; stdout?: string; stderr?: string }
      return {
        status: typeof e.code === 'number' ? e.code : 1,
        json: e.stdout?.trim() ? (JSON.parse(e.stdout) as Record<string, unknown>) : null,
        stderr: e.stderr ?? '',
      }
    }
  }

  try {
    // 1. Empty list
    const empty = await runCli(['measurement', 'list'])
    assert.deepEqual(empty.json.items, [])

    // 2. Publish from real enclave/dist/recipe.json
    const pub = await runCli([
      'measurement', 'publish',
      '--recipe', recipePath,
      '--repo', 'https://github.com/voynich-dev/voynich',
      '--commit', 'abcdef1234567890abcdef1234567890abcdef12',
    ])
    assert.equal(pub.json.digest, recipe.measurement)
    assert.equal(pub.json.status, 'active')
    assert.ok(typeof pub.json.measurement === 'string' && (pub.json.measurement as string).length >= 32)
    assert.ok(typeof pub.json.transaction === 'string' && (pub.json.transaction as string).length > 0)

    // 3. List & show
    const listed = await runCli(['measurement', 'list', '--status', 'active'])
    assert.equal((listed.json.items as unknown[]).length, 1)
    const shown = await runCli(['measurement', 'show', recipe.measurement])
    assert.equal(shown.json.digest, recipe.measurement)
    assert.equal(shown.json.recipeHash, recipe.recipeHash)
    assert.equal(shown.json.version, recipe.version)

    // 4. Verify against --recipe AND --rebuild --source
    const verifiedRecipe = await runCli(['measurement', 'verify', recipe.measurement, '--recipe', recipePath])
    assert.equal(verifiedRecipe.json.verified, true)
    assert.equal(verifiedRecipe.json.digestMatch, true)
    assert.equal(verifiedRecipe.json.recipeMatch, true)
    assert.equal(verifiedRecipe.json.onChainMatch, true)
    assert.equal(verifiedRecipe.json.status, 'active')

    const verifiedRebuild = await runCli(['measurement', 'verify', recipe.measurement, '--rebuild', '--source', resolve('.')])
    assert.equal(verifiedRebuild.json.verified, true)
    assert.equal(verifiedRebuild.json.digestMatch, true)
    assert.equal(verifiedRebuild.json.recipeMatch, true)

    // 5. Mismatched recipe.json fails with exitCode 1 and verified: false
    const badRecipePath = join(scratch, 'bad-recipe.json')
    writeFileSync(badRecipePath, JSON.stringify({ ...recipe, recipeHash: '00'.repeat(32) }))
    const mismatched = await runCli(['measurement', 'verify', recipe.measurement, '--recipe', badRecipePath], true)
    assert.equal(mismatched.status, 1)
    assert.equal(mismatched.json?.verified, false)
    assert.equal(mismatched.json?.digestMatch, true)
    assert.equal(mismatched.json?.recipeMatch, false)

    // 6. Deprecate and confirm verify fails with exitCode 1 and status: 'deprecated'
    const dep = await runCli(['measurement', 'deprecate', recipe.measurement])
    assert.equal(dep.json.status, 'deprecated')
    const afterDep = await runCli(['measurement', 'verify', recipe.measurement, '--recipe', recipePath], true)
    assert.equal(afterDep.status, 1)
    assert.equal(afterDep.json?.verified, false)
    assert.equal(afterDep.json?.status, 'deprecated')
  } finally {
    server.close()
    rmSync(scratch, { recursive: true, force: true })
  }
})

test('Build 7 Step 1: policyPda, decodePolicyAccount, fixture policy routes (allow-list & operator enforcement), and SDK policy/setPolicy/clearPolicy', async () => {
  const { Keypair } = await import('@solana/web3.js')
  const { FIXTURE } = await import('@voynich/contract/fixtures')
  const { createVoynich } = await import('voynich')
  const { POLICY_SPACE, decodePolicyAccount, policyPda } = await import('voynich/program')
  const { sha256, utf8 } = await import('voynich/crypto')
  const { buildApp } = await import('../src/app.js')

  // 1. policyPda & decodePolicyAccount on a 1770-byte Anchor Policy layout.
  const modelKey = Keypair.generate().publicKey
  const callerKey = Keypair.generate().publicKey
  const operatorKey = Keypair.generate().publicKey
  const pdaKey = policyPda(modelKey)
  assert.equal(pdaKey.toBase58(), policyPda(modelKey.toBase58()).toBase58())

  const raw = Buffer.alloc(POLICY_SPACE)
  let off = 0
  raw.set(sha256(utf8('account:Policy')).subarray(0, 8), off); off += 8
  raw.set(modelKey.toBytes(), off); off += 32
  raw[off++] = 1 // allow_list_enabled
  raw.writeUInt32LE(1, off); off += 4
  raw.set(callerKey.toBytes(), off); off += 32
  raw.writeUInt32LE(25, off); off += 4
  raw.writeBigUInt64LE(600n, off); off += 8
  raw.writeUInt32LE(1, off); off += 4
  raw.set(operatorKey.toBytes(), off); off += 32
  raw.writeUInt32LE(2, off); off += 4
  for (const r of ['us-east', 'eu-west']) {
    const b = Buffer.from(r, 'utf8')
    raw.writeUInt32LE(b.length, off); off += 4
    raw.set(b, off); off += b.length
  }
  raw.writeBigUInt64LE(472700000n, off); off += 8
  raw[off++] = 252
  const decoded = decodePolicyAccount(raw)
  assert.equal(decoded.model.toBase58(), modelKey.toBase58())
  assert.equal(decoded.allowListEnabled, true)
  assert.deepEqual(decoded.allowedCallers.map(k => k.toBase58()), [callerKey.toBase58()])
  assert.equal(decoded.maxCallsPerCallerPerWindow, 25)
  assert.equal(decoded.windowSlots.toString(), '600')
  assert.deepEqual(decoded.allowedOperators.map(k => k.toBase58()), [operatorKey.toBase58()])
  assert.deepEqual(decoded.allowedRegions, ['us-east', 'eu-west'])
  assert.equal(decoded.updatedSlot.toString(), '472700000')
  assert.equal(decoded.bump, 252)

  // 2. Fixture API + SDK policy(), setPolicy(), allow-list & operator enforcement, clearPolicy().
  const app = buildApp()
  const sessionId = 'b7s1-policy-test'
  const localFetch: typeof fetch = async (input, init) => {
    const req = input instanceof Request ? input : new Request(String(input), init)
    const headers = new Headers(req.headers)
    headers.set('X-Fixture-Session', sessionId)
    return app.fetch(new Request(req, { headers }))
  }
  const allowedCaller = Keypair.generate()
  const deniedCaller = Keypair.generate()
  const ownerWallet = {
    publicKey: { toBase58: () => FIXTURE.owner } as import('@solana/web3.js').PublicKey,
    async signTransaction(tx: import('@solana/web3.js').VersionedTransaction) { return tx },
  }
  const ownerClient = createVoynich({ apiUrl: 'http://127.0.0.1:9702', signer: ownerWallet, fetch: localFetch })
  const allowedClient = createVoynich({ apiUrl: 'http://127.0.0.1:9702', signer: allowedCaller, fetch: localFetch })
  const deniedClient = createVoynich({ apiUrl: 'http://127.0.0.1:9702', signer: deniedCaller, fetch: localFetch })

  assert.equal(await ownerClient.policy('sketch-32'), null)

  // Non-owner cannot set policy
  await assert.rejects(
    () => deniedClient.setPolicy('sketch-32', { allowListEnabled: true, allowedCallers: [allowedCaller.publicKey.toBase58()] }),
    /owner|PROGRAM_REFUSED|UNAUTHORIZED/i,
  )

  // Owner sets policy allowing only allowedCaller and restricting operators to a different key
  const saved = await ownerClient.setPolicy('sketch-32', {
    allowListEnabled: true,
    allowedCallers: [allowedCaller.publicKey.toBase58()],
    maxCallsPerCallerPerWindow: 20,
    windowSlots: '300',
    allowedOperators: [operatorKey.toBase58()],
    allowedRegions: ['us-east'],
  })
  assert.equal(saved.allowListEnabled, true)
  assert.deepEqual(saved.allowedCallers, [allowedCaller.publicKey.toBase58()])
  assert.equal(saved.maxCallsPerCallerPerWindow, 20)
  assert.equal(saved.windowSlots, '300')
  assert.deepEqual(saved.allowedRegions, ['us-east'])
  assert.deepEqual(await ownerClient.policy('sketch-32'), saved)

  // Denied caller rejected with POLICY_CALLER_DENIED; allowed caller succeeds on /v1/calls/build
  const enclaves = await ownerClient.enclaves()
  const enclaveAddr = enclaves.items[0]!.address
  await assert.rejects(
    () => deniedClient.api.openCall({ wallet: deniedCaller.publicKey.toBase58(), model: 'sketch-32', enclave: enclaveAddr, inputHash: '11'.repeat(32) }),
    /allow list|POLICY_CALLER_DENIED/i,
  )
  const allowedBuild = await allowedClient.api.openCall({ wallet: allowedCaller.publicKey.toBase58(), model: 'sketch-32', enclave: enclaveAddr, inputHash: '11'.repeat(32) })
  assert.equal(allowedBuild.action, 'open_call')

  // Grant to fixture enclave whose operator != operatorKey rejected with POLICY_OPERATOR_DENIED
  const dummyWrapped = Buffer.concat([Buffer.from([1]), Buffer.alloc(104, 9)]).toString('base64')
  await assert.rejects(
    () => ownerClient.api.grantByOwner('sketch-32', { wallet: FIXTURE.owner, enclave: enclaveAddr, wrappedKey: dummyWrapped }),
    /operator is not allowed|POLICY_OPERATOR_DENIED/i,
  )

  // Clear policy -> policy() returns null again and deniedCaller can open calls
  await ownerClient.clearPolicy('sketch-32')
  assert.equal(await ownerClient.policy('sketch-32'), null)
  const openAfterClear = await deniedClient.api.openCall({ wallet: deniedCaller.publicKey.toBase58(), model: 'sketch-32', enclave: enclaveAddr, inputHash: '22'.repeat(32) })
  assert.equal(openAfterClear.action, 'open_call')
})

test('Build 7 Step 2: enclave ENCLAVE_REGION parsing, region allow/deny, sliding-window rate limiter, /health region, and acceptInput 403/429 enforcement', async () => {
  const { Keypair } = await import('@solana/web3.js')
  const { ApiFailure } = await import('../src/engines/server/errors.js')
  const { EnclaveRateLimiter, isRegionAllowed, parseEnclaveRegion } = await import('../enclave/src/policy.js')
  const { createEnclaveApp } = await import('../enclave/src/runtime.js')

  // 1. parseEnclaveRegion validation
  assert.equal(parseEnclaveRegion(undefined), null)
  assert.equal(parseEnclaveRegion('   '), null)
  assert.equal(parseEnclaveRegion('us-east'), 'us-east')
  assert.equal(parseEnclaveRegion(' eu-west-1 '), 'eu-west-1')
  assert.throws(() => parseEnclaveRegion('US_EAST'), /ENCLAVE_REGION/)
  assert.throws(() => parseEnclaveRegion('region-way-too-long-123'), /ENCLAVE_REGION/)

  // 2. isRegionAllowed
  assert.equal(isRegionAllowed(null, null), true)
  assert.equal(isRegionAllowed({ allowedRegions: [] }, null), true)
  assert.equal(isRegionAllowed({ allowedRegions: ['us-east', 'eu-west'] }, 'us-east'), true)
  assert.equal(isRegionAllowed({ allowedRegions: ['us-east', 'eu-west'] }, 'ap-northeast'), false)
  assert.equal(isRegionAllowed({ allowedRegions: ['us-east'] }, null), false)

  // 3. EnclaveRateLimiter sliding window + expiry reset + per-(model, caller) isolation
  const limiter = new EnclaveRateLimiter()
  assert.deepEqual(limiter.checkAndRecord('m1', 'c1', 100n, 0, 0n), { allowed: true, count: 0 })
  assert.deepEqual(limiter.checkAndRecord('m1', 'c1', 100n, 2, 10n), { allowed: true, count: 1 })
  assert.deepEqual(limiter.checkAndRecord('m1', 'c1', 105n, 2, 10n), { allowed: true, count: 2 })
  const denied = limiter.checkAndRecord('m1', 'c1', 109n, 2, 10n)
  assert.equal(denied.allowed, false)
  if (!denied.allowed) {
    assert.equal(denied.limit, 2)
    assert.equal(denied.windowSlots, 10n)
  }
  // Separate caller on same model is unaffected
  assert.deepEqual(limiter.checkAndRecord('m1', 'c2', 109n, 2, 10n), { allowed: true, count: 1 })
  // Once currentSlot reaches 110 (slot 100 + window 10), slot 100 expires and caller c1 can call again
  assert.deepEqual(limiter.checkAndRecord('m1', 'c1', 110n, 2, 10n), { allowed: true, count: 2 })

  // 4. createEnclaveApp /health exposes region and POST /v1/calls/:call/input surfaces 403 & 429 RATE_LIMITED
  const enclaveKey = Keypair.generate().publicKey
  const callKey = Keypair.generate().publicKey
  const validEnvelope = Buffer.concat([Buffer.from([1]), Buffer.alloc(72, 2)]).toString('base64')
  let activePolicy: { allowedRegions: string[]; maxCallsPerCallerPerWindow: number; windowSlots: bigint } | null = null
  const appLimiter = new EnclaveRateLimiter()
  let fakeSlot = 500n
  const enclaveRegion = 'us-east'
  const app = createEnclaveApp({
    enclave: enclaveKey,
    softwareMeasurement: 'ab'.repeat(48),
    region: enclaveRegion,
    loaded: new Map(),
    async acceptInput() {
      if (!isRegionAllowed(activePolicy, enclaveRegion)) {
        throw new ApiFailure(403, { error: { code: 'PROGRAM_REFUSED', message: 'Region not allowed.', retryable: false, stage: 'upload' } })
      }
      if (activePolicy && activePolicy.maxCallsPerCallerPerWindow > 0 && activePolicy.windowSlots > 0n) {
        const res = appLimiter.checkAndRecord('m1', 'c1', fakeSlot, activePolicy.maxCallsPerCallerPerWindow, activePolicy.windowSlots)
        if (!res.allowed) {
          throw new ApiFailure(429, { error: { code: 'RATE_LIMITED', message: 'Rate ceiling exceeded.', retryable: true, stage: 'upload' } })
        }
      }
    },
    async getAnswer() { throw new Error('unused') },
  }, () => true)

  const health = await (await app.request('/health')).json() as { region: string | null }
  assert.equal(health.region, 'us-east')

  const postInput = () => app.request(`/v1/calls/${callKey.toBase58()}/input`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ envelope: validEnvelope }),
  })

  // No policy -> pass-through 200
  assert.equal((await postInput()).status, 200)

  // Disallowed region -> 403
  activePolicy = { allowedRegions: ['eu-west'], maxCallsPerCallerPerWindow: 0, windowSlots: 0n }
  assert.equal((await postInput()).status, 403)

  // Allowed region + rate ceiling 1 per 20 slots -> 1st 200, 2nd 429 RATE_LIMITED, after window 200
  activePolicy = { allowedRegions: ['us-east'], maxCallsPerCallerPerWindow: 1, windowSlots: 20n }
  assert.equal((await postInput()).status, 200)
  const limitedRes = await postInput()
  assert.equal(limitedRes.status, 429)
  const limitedBody = await limitedRes.json() as { error: { code: string } }
  assert.equal(limitedBody.error.code, 'RATE_LIMITED')
  fakeSlot = 520n
  assert.equal((await postInput()).status, 200)
})

test('Build 7 Step 3: voynich model policy CLI show, set, show, clear, and flag validation', async () => {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const execFileAsync = promisify(execFile)
  const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join, resolve } = await import('node:path')
  const { serve } = await import('@hono/node-server')
  const { fixtureModel, fixtureEnclave } = await import('@voynich/contract/fixtures')
  const { buildApp } = await import('../src/app.js')
  const { createVoynich } = await import('../sdk/src/index.js')

  const app = buildApp()
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 })
  await new Promise<void>(r => server.once('listening', () => r()))
  const addr = server.address() as { port: number }
  const apiUrl = `http://127.0.0.1:${addr.port}`

  const scratch = mkdtempSync(join(tmpdir(), 'voynich-b7s3-cli-'))
  const owner = Keypair.generate()
  const ownerKeyPath = join(scratch, 'owner.json')
  writeFileSync(ownerKeyPath, JSON.stringify([...owner.secretKey]))
  const caller1 = Keypair.generate().publicKey.toBase58()
  const caller2 = Keypair.generate().publicKey.toBase58()
  const operator1 = Keypair.generate().publicKey.toBase58()
  const cliPath = resolve('sdk/dist/cli.js')

  const runCli = async (args: string[], expectFail = false) => {
    try {
      const { stdout } = await execFileAsync(process.execPath, [cliPath, '--api-url', apiUrl, '--keypair', ownerKeyPath, ...args], {
        cwd: resolve('.'),
        encoding: 'utf8',
      })
      if (expectFail) throw new Error(`Expected CLI failure for ${args.join(' ')}, got stdout: ${stdout}`)
      return { status: 0, json: JSON.parse(stdout) as Record<string, unknown> }
    } catch (err) {
      if (!expectFail) throw err
      const e = err as { code?: number; stdout?: string; stderr?: string }
      return {
        status: typeof e.code === 'number' ? e.code : 1,
        json: e.stdout?.trim() ? (JSON.parse(e.stdout) as Record<string, unknown>) : null,
        stderr: e.stderr ?? '',
      }
    }
  }

  try {
    const sdk = createVoynich({ apiUrl, signer: owner, pollMs: 5 })
    const sealed = await sdk.seal({
      weights: new Uint8Array(64).fill(5),
      manifest: { ...fixtureModel.manifest, name: 'policy-cli-test' },
      price: { mint: null, amount: '100000', decimals: 9, symbol: 'SOL' },
      operatorShareBps: 2500,
      allowedMeasurements: [fixtureEnclave.measurement],
      uploadFundingLamports: '1000000',
    })
    const modelAddress = sealed.model.address

    // 1. Initial show returns { model, policy: null }
    const initial = await runCli(['model', 'policy', 'show', modelAddress])
    assert.deepEqual(initial.json, { model: modelAddress, policy: null })

    // 2. Set policy via CLI flags
    const setRes = await runCli([
      'model', 'policy', 'set', modelAddress,
      '--allow-list',
      '--caller', caller1,
      '--caller', caller2,
      '--max-calls', '15',
      '--window-slots', '400',
      '--operator', operator1,
      '--region', 'us-east',
      '--region', 'EU-WEST',
    ])
    assert.equal(setRes.json.model, modelAddress)
    assert.ok(typeof setRes.json.transaction === 'string' && (setRes.json.transaction as string).length > 0)
    const setPolicy = setRes.json.policy as Record<string, unknown>
    assert.equal(setPolicy.allowListEnabled, true)
    assert.deepEqual(setPolicy.allowedCallers, [caller1, caller2])
    assert.equal(setPolicy.maxCallsPerCallerPerWindow, 15)
    assert.equal(setPolicy.windowSlots, '400')
    assert.deepEqual(setPolicy.allowedOperators, [operator1])
    assert.deepEqual(setPolicy.allowedRegions, ['us-east', 'eu-west'])

    // 3. Show returns active policy JSON
    const shown = await runCli(['model', 'policy', 'show', modelAddress])
    assert.equal(shown.json.model, modelAddress)
    assert.equal(shown.json.allowListEnabled, true)
    assert.deepEqual(shown.json.allowedCallers, [caller1, caller2])
    assert.equal(shown.json.maxCallsPerCallerPerWindow, 15)
    assert.equal(shown.json.windowSlots, '400')
    assert.deepEqual(shown.json.allowedRegions, ['us-east', 'eu-west'])

    // 4. Clear policy returns { model, cleared: true, transaction }
    const cleared = await runCli(['model', 'policy', 'clear', modelAddress])
    assert.equal(cleared.json.model, modelAddress)
    assert.equal(cleared.json.cleared, true)
    assert.ok(typeof cleared.json.transaction === 'string' && (cleared.json.transaction as string).length > 0)

    // 5. Show after clear returns { model, policy: null }
    const afterClear = await runCli(['model', 'policy', 'show', modelAddress])
    assert.deepEqual(afterClear.json, { model: modelAddress, policy: null })

    // 6. Invalid --max-calls rejected with non-zero exit
    const bad = await runCli(['model', 'policy', 'set', modelAddress, '--max-calls', '-1'], true)
    assert.notEqual(bad.status, 0)
  } finally {
    ;(server as { closeAllConnections?: () => void }).closeAllConnections?.()
    await new Promise<void>(r => server.close(() => r()))
    rmSync(scratch, { recursive: true, force: true })
  }
})

test('Build 9 Step 1: decodeGrantAccount (223B legacy + 226B quoted), buildSetQuoteTx, fixture POST /v1/enclaves/:key/quote/build, and SDK setQuote', async () => {
  const { Connection } = await import('@solana/web3.js')
  const { FIXTURE } = await import('@voynich/contract/fixtures')
  const { sha256, utf8 } = await import('../sdk/src/crypto.js')
  const { GRANT_BASE_SPACE, GRANT_SPACE, buildSetQuoteTx, decodeGrantAccount, grantPda } = await import('../sdk/src/program.js')
  const { createVoynich } = await import('../sdk/src/index.js')
  const { buildApp } = await import('../src/app.js')

  // 1. decodeGrantAccount on legacy 223B, 226B None, and 226B Some(1200)
  const modelKey = Keypair.generate().publicKey
  const enclaveKey = Keypair.generate().publicKey
  const grantedBy = Keypair.generate().publicKey
  const disc = sha256(utf8('account:Grant')).subarray(0, 8)
  const makeBaseGrant = () => {
    const buf = new Uint8Array(GRANT_BASE_SPACE)
    const view = new DataView(buf.buffer)
    let o = 0
    buf.set(disc, o); o += 8
    buf.set(modelKey.toBytes(), o); o += 32
    buf.set(enclaveKey.toBytes(), o); o += 32
    view.setUint32(o, 105, true); o += 4
    buf[o] = 1; o += 105
    buf.set(grantedBy.toBytes(), o); o += 32
    view.setBigUint64(o, 472900000n, true); o += 8
    buf[o++] = 0 // revoked = false
    buf[o++] = 251 // bump
    assert.equal(o, GRANT_BASE_SPACE)
    return buf
  }
  const legacyDecoded = decodeGrantAccount(makeBaseGrant())
  assert.equal(legacyDecoded.legacy, true)
  assert.equal(legacyDecoded.quotedOperatorShareBps, null)
  assert.equal(legacyDecoded.revoked, false)
  assert.equal(legacyDecoded.bump, 251)

  const quotedBuf = new Uint8Array(GRANT_SPACE)
  quotedBuf.set(makeBaseGrant(), 0)
  quotedBuf[GRANT_BASE_SPACE] = 1
  new DataView(quotedBuf.buffer).setUint16(GRANT_BASE_SPACE + 1, 1200, true)
  const quotedDecoded = decodeGrantAccount(quotedBuf)
  assert.equal(quotedDecoded.legacy, false)
  assert.equal(quotedDecoded.quotedOperatorShareBps, 1200)

  // 2. buildSetQuoteTx builds a valid v0 VersionedTransaction targeting grantPda
  const operator = Keypair.generate().publicKey
  const tx = await buildSetQuoteTx({
    connection: new Connection('http://127.0.0.1:9704', 'confirmed'),
    operator,
    model: modelKey,
    enclave: enclaveKey,
    operatorShareBps: 1200,
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
  })
  const staticKeys = tx.message.staticAccountKeys.map(k => k.toBase58())
  assert.ok(staticKeys.includes(grantPda(modelKey, enclaveKey).toBase58()))
  assert.ok(staticKeys.includes(operator.toBase58()))

  // 3. Fixture API POST /v1/enclaves/:key/quote/build + SDK setQuote
  const app = buildApp()
  const sessionId = 'b9s1-quote-test'
  const localFetch: typeof fetch = async (input, init) => {
    const req = input instanceof Request ? input : new Request(String(input), init)
    const headers = new Headers(req.headers)
    headers.set('X-Fixture-Session', sessionId)
    return app.fetch(new Request(req, { headers }))
  }
  const operatorWallet = {
    publicKey: { toBase58: () => FIXTURE.operator } as import('@solana/web3.js').PublicKey,
    async signTransaction(t: import('@solana/web3.js').VersionedTransaction) { return t },
  }
  const stranger = Keypair.generate()
  const opClient = createVoynich({ apiUrl: 'http://127.0.0.1:9702', signer: operatorWallet, fetch: localFetch })
  const strangerClient = createVoynich({ apiUrl: 'http://127.0.0.1:9702', signer: stranger, fetch: localFetch })

  // Non-operator rejected
  await assert.rejects(() => strangerClient.setQuote(FIXTURE.enclave, 'sketch-32', 1200), /operator|UNAUTHORIZED/i)

  // Above model.operatorShareBps (2500) rejected with INVALID_QUOTE
  await assert.rejects(() => opClient.setQuote(FIXTURE.enclave, 'sketch-32', 2501), /maximum operator share|INVALID_QUOTE/i)

  // Valid quote updates both /v1/models/:id/enclaves and /v1/enclaves/:key
  const txSet = await opClient.setQuote(FIXTURE.enclave, 'sketch-32', 1200)
  assert.equal(txSet.status, 'confirmed')
  const modelEnclaves = await opClient.api.modelEnclaves('sketch-32')
  assert.equal(modelEnclaves.items[0]!.grant.quotedOperatorShareBps, 1200)
  assert.equal(modelEnclaves.items[0]!.grant.medianAnswerMs, 400)
  const enclaveDetail = await opClient.enclave(FIXTURE.enclave)
  assert.equal(enclaveDetail.grants[0]!.quotedOperatorShareBps, 1200)

  // Clearing quote resets to null
  await opClient.setQuote(FIXTURE.enclave, 'sketch-32', null)
  const clearedEnclaves = await opClient.api.modelEnclaves('sketch-32')
  assert.equal(clearedEnclaves.items[0]!.grant.quotedOperatorShareBps, null)
})

test('Build 9 Step 2: selectEnclave routing strategies and CLI enclave quote / call --strategy', async () => {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const execFileAsync = promisify(execFile)
  const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join, resolve } = await import('node:path')
  const { serve } = await import('@hono/node-server')
  const { Hono } = await import('hono')
  const { fixtureEnclave, fixtureGrant, fixtureBuild } = await import('@voynich/contract/fixtures')
  const { selectEnclave } = await import('../sdk/src/index.js')

  const makeEntry = (
    signingKey: string,
    quotedOperatorShareBps: number | null,
    medianAnswerMs: number | null,
  ) => ({
    enclave: { ...fixtureEnclave, address: Keypair.generate().publicKey.toBase58(), signingKey },
    grant: { ...fixtureGrant, address: Keypair.generate().publicKey.toBase58(), quotedOperatorShareBps, medianAnswerMs },
  })

  // 1. selectEnclave strategies & tie-breaking
  assert.equal(selectEnclave([]), null)
  const cheapSlow = makeEntry('11111111111111111111111111111111', 800, 2400)
  const midBalanced = makeEntry('22222222222222222222222222222222', 1200, 600)
  const priceyFast = makeEntry('33333333333333333333333333333333', 2500, 400)
  const unquotedNull = makeEntry('44444444444444444444444444444444', null, null)

  const pool = [priceyFast, unquotedNull, cheapSlow, midBalanced]
  assert.equal(selectEnclave(pool, { strategy: 'cheapest', modelOperatorShareBps: 2500 })?.enclave.signingKey, cheapSlow.enclave.signingKey)
  assert.equal(selectEnclave(pool, { strategy: 'fastest', modelOperatorShareBps: 2500 })?.enclave.signingKey, priceyFast.enclave.signingKey)
  assert.equal(selectEnclave(pool, { strategy: 'balanced', modelOperatorShareBps: 2500 })?.enclave.signingKey, midBalanced.enclave.signingKey)

  // Tie-break on cheapest: equal share prefers known latency over null, then lower signingKey
  const tieNull = makeEntry('11111111111111111111111111111111', 1000, null)
  const tieKnownB = makeEntry('33333333333333333333333333333333', 1000, 500)
  const tieKnownA = makeEntry('22222222222222222222222222222222', 1000, 500)
  assert.equal(selectEnclave([tieNull, tieKnownB, tieKnownA], { strategy: 'cheapest', modelOperatorShareBps: 2500 })?.enclave.signingKey, tieKnownA.enclave.signingKey)

  // Balanced fallback when all latencies are null picks lowest share, then lowest signingKey
  const nullHigh = makeEntry('11111111111111111111111111111111', 2000, null)
  const nullLow = makeEntry('22222222222222222222222222222222', 900, null)
  assert.equal(selectEnclave([nullHigh, nullLow], { strategy: 'balanced', modelOperatorShareBps: 2500 })?.enclave.signingKey, nullLow.enclave.signingKey)

  // 2. CLI voynich enclave quote & --strategy validation against an in-process mock API
  const operator = Keypair.generate()
  const recorded: Array<{ key: string; model: string; operatorShareBps: number | null }> = []
  const mockApi = new Hono()
  mockApi.post('/v1/enclaves/:key/quote/build', async c => {
    const body = await c.req.json() as { model: string; operatorShareBps: number | null; payer?: string }
    recorded.push({ key: c.req.param('key'), model: body.model, operatorShareBps: body.operatorShareBps })
    return c.json(fixtureBuild('set_quote', body.payer ?? operator.publicKey.toBase58()))
  })
  mockApi.post('/v1/transactions/submit', c => c.json({ id: 'fixture-set_quote', status: 'confirmed', signature: '3fQ2F1MzDFtW4p4z6KWV1GwVfPrZFWwB3YthvfFF6EJQhHrEdgsbq5QZ4DHDRp4BZ8cvj9vnTowzSiDvp248zCLw' }))
  const server = serve({ fetch: mockApi.fetch, hostname: '127.0.0.1', port: 0 })
  await new Promise<void>(r => server.once('listening', () => r()))
  const apiUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`

  const scratch = mkdtempSync(join(tmpdir(), 'voynich-b9s2-cli-'))
  const keyPath = join(scratch, 'operator.json')
  writeFileSync(keyPath, JSON.stringify([...operator.secretKey]))
  const cliPath = resolve('sdk/dist/cli.js')

  const runCli = async (args: string[], expectFail = false) => {
    try {
      const { stdout } = await execFileAsync(process.execPath, [cliPath, '--api', apiUrl, '--keypair', keyPath, ...args], {
        cwd: resolve('.'),
        encoding: 'utf8',
      })
      if (expectFail) throw new Error(`Expected CLI failure for ${args.join(' ')}, got stdout: ${stdout}`)
      return { status: 0, json: JSON.parse(stdout) as Record<string, unknown> }
    } catch (err) {
      if (!expectFail) throw err
      const e = err as { code?: number; stderr?: string }
      return { status: typeof e.code === 'number' ? e.code : 1, stderr: e.stderr ?? '' }
    }
  }

  try {
    const setRes = await runCli(['enclave', 'quote', 'sketch-32', '--share-bps', '1200', '--enclave', fixtureEnclave.address, '--json'])
    assert.equal(setRes.json?.enclave, fixtureEnclave.address)
    assert.equal(setRes.json?.model, 'sketch-32')
    assert.equal(setRes.json?.operatorShareBps, 1200)
    assert.equal(setRes.json?.status, 'confirmed')

    const clearRes = await runCli(['enclave', 'quote', 'sketch-32', '--clear', '--enclave', fixtureEnclave.address])
    assert.equal(clearRes.json?.operatorShareBps, null)
    assert.deepEqual(recorded, [
      { key: fixtureEnclave.address, model: 'sketch-32', operatorShareBps: 1200 },
      { key: fixtureEnclave.address, model: 'sketch-32', operatorShareBps: null },
    ])

    // Flag validations
    assert.notEqual((await runCli(['enclave', 'quote', 'sketch-32', '--share-bps', '10001', '--enclave', fixtureEnclave.address], true)).status, 0)
    assert.notEqual((await runCli(['enclave', 'quote', 'sketch-32', '--share-bps', '500', '--clear', '--enclave', fixtureEnclave.address], true)).status, 0)
    assert.notEqual((await runCli(['call', 'sketch-32', '--strategy', 'random'], true)).status, 0)
  } finally {
    ;(server as { closeAllConnections?: () => void }).closeAllConnections?.()
    await new Promise<void>(r => server.close(() => r()))
    rmSync(scratch, { recursive: true, force: true })
  }
})
