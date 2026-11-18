import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import anchor from '@coral-xyz/anchor'
import { PublicKey, Keypair, SystemProgram, SYSVAR_INSTRUCTIONS_PUBKEY, SYSVAR_SLOT_HASHES_PUBKEY, SYSVAR_RENT_PUBKEY, type Signer, type TransactionInstruction } from '@solana/web3.js'
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { WRITE_CHUNK_BYTES, decodeManifest, encodeManifest } from '@voynich/contract'
import { ciphertextHash, sealWeights, toBase64, fromBase64, toHex, utf8, wrapKey } from 'voynich/crypto'
import { addresses, BOUNTY_PROGRAM_ID, chainPrograms, decodeConfigAccount, decodeWeightsHeader, DEFAULT_MAX_OPEN_ANSWER_BYTES, eventAccounts } from 'voynich/program'
import { createRpc } from '../src/engines/rpc/client.js'
import { buildUnsignedV0 } from '../src/engines/tx/server/build.js'
import { sendSigned, TxSendError } from '../src/engines/tx/server/send.js'
import { createLookupTable, extendLookupTable, loadLookupTables, lookupTableRecentSlot, waitForLookupTables } from '../src/engines/tx/server/lookup-tables.js'
import { readSealed, sealingKey, writeSealed } from '../enclave/src/storage.js'

const { BN } = anchor
const bn = (value: bigint | number) => new BN(value.toString())
const pause = () => new Promise<void>(finish => setTimeout(finish, 250))
const LOADER = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111')
// Explicit development economics. Remote clusters require their configuration in the environment.
const LOCAL_PROTOCOL_SHARE_BPS = 500
const LOCAL_OPERATOR_SHARE_BPS = 2500
const LOCAL_CALL_DEADLINE_SLOTS = 300n
const LOCAL_MAX_REPORT_AGE_SLOTS = 64n
const LOCAL_RECORD_LIFETIME_SLOTS = 64n
const LOCAL_SKETCH_PRICE_LAMPORTS = 100_000n
const LOCAL_ACTOR_FUNDING_LAMPORTS = 2_000_000_000
const LOCAL_WALLET_FUNDING_LAMPORTS = 10_000_000_000
const LOCAL_UPLOAD_FUNDING_LAMPORTS = 50_000_000n

export const DEVNET_GENESIS_HASH = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG'
export const MAINNET_GENESIS_HASH = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

export type Cluster = 'localnet' | 'devnet' | 'mainnet-beta'
type Pending = { bytes: string; blockhash: string; lastValidBlockHeight: number; contextSlot: number }
type UploadState = { modelKey: string; noncePrefix: string; ciphertext: string; sha256: string; uploadKey: number[]; weightsKey: number[] }
type SetupState = { version: 1; chain: string; lookupTable: string | null; upload: UploadState | null; pending: Record<string, Pending> }
export type PublicSetup = {
  cluster: Cluster
  genesisHash: string
  programId: string
  attestationProgramId: string
  lookupTable: string
  model: string
  weights: string[]
  enclave: string | null
  attestationRecord: string | null
  measurement: string
  status: 'ready' | 'awaiting-enclave'
}

export function loadSetupEnvironment(cluster: Cluster = 'localnet') {
  if (cluster !== 'mainnet-beta') {
    try { process.loadEnvFile() } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  for (const [name, value] of Object.entries(process.env)) if (value?.trim() === '') delete process.env[name]
}
export function setupKeyPath(name: string, file: string, cluster: Cluster = 'localnet'): string {
  const fallback = `.local/keys/${file}.json`
  return resolve(process.env[name] ?? fallback)
}
export function setupKeypair(path: string): Keypair {
  const bytes = readFileSync(path, 'utf8')
  try { return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(bytes) as number[])) }
  catch { throw new Error('The setup keypair file must contain a valid 64-byte Solana keypair.') }
}
function configured(name: string, local: bigint | number, cluster: Cluster): bigint {
  const value = process.env[name]
  if (!value && cluster !== 'localnet') throw new Error(`${name} must be explicitly configured before ${cluster} setup.`)
  return BigInt(value ?? local)
}
export function setupConfiguration(cluster: Cluster) {
  const isMainnet = cluster === 'mainnet-beta'
  const actorFunding = isMainnet ? 0 : Number(configured('SETUP_ACTOR_FUNDING_LAMPORTS', LOCAL_ACTOR_FUNDING_LAMPORTS, cluster))
  const walletFunding = isMainnet ? 0 : Number(configured('SETUP_ACTOR_FUNDING_LAMPORTS', LOCAL_WALLET_FUNDING_LAMPORTS, cluster))
  return {
    protocolShareBps: Number(configured('PROTOCOL_SHARE_BPS', LOCAL_PROTOCOL_SHARE_BPS, cluster)),
    operatorShareBps: Number(configured('SKETCH_OPERATOR_SHARE_BPS', LOCAL_OPERATOR_SHARE_BPS, cluster)),
    callDeadlineSlots: configured('CALL_DEADLINE_SLOTS', LOCAL_CALL_DEADLINE_SLOTS, cluster),
    maxReportAgeSlots: configured('ATTEST_MAX_REPORT_AGE_SLOTS', LOCAL_MAX_REPORT_AGE_SLOTS, cluster),
    recordLifetimeSlots: configured('ATTEST_RECORD_LIFETIME_SLOTS', LOCAL_RECORD_LIFETIME_SLOTS, cluster),
    price: configured('SKETCH_PRICE_LAMPORTS', LOCAL_SKETCH_PRICE_LAMPORTS, cluster),
    actorFunding,
    walletFunding,
    operatorFunding: isMainnet ? BigInt(process.env.OPERATOR_FUNDING_LAMPORTS ?? '0') : 0n,
    keeperFunding: isMainnet ? BigInt(process.env.KEEPER_FUNDING_LAMPORTS ?? '0') : 0n,
    uploadFunding: configured('UPLOAD_FUNDING_LAMPORTS', LOCAL_UPLOAD_FUNDING_LAMPORTS, cluster),
    maxOpenAnswerBytes: Number(process.env.MAX_OPEN_ANSWER_BYTES ?? String(DEFAULT_MAX_OPEN_ANSWER_BYTES)),
    priorityFeeMicroLamports: BigInt(process.env.SETUP_PRIORITY_FEE_MICRO_LAMPORTS ?? (isMainnet ? '10000' : '0')),
  }
}

async function withLagRetry<T>(work: () => Promise<T>, attempts = 6): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try { return await work() }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (attempt >= attempts || !message.includes('Minimum context slot')) throw error
      await new Promise<void>(finish => setTimeout(finish, 1000 * attempt))
    }
  }
}

const MEASUREMENT_HEX = /^[0-9a-f]{96}$/

export async function fetchHealthEnclave(endpoint: string): Promise<{ enclave: string | null; measurement: string | null }> {
  try {
    const response = await fetch(`${endpoint.replace(/\/$/, '')}/health`, { signal: AbortSignal.timeout(5000) })
    if (!response.ok) return { enclave: null, measurement: null }
    const body = await response.json() as { enclave?: unknown; measurement?: unknown }
    const enclave = typeof body.enclave === 'string' && body.enclave.length > 0 ? body.enclave : null
    const rawMeasurement = typeof body.measurement === 'string' ? body.measurement.trim().toLowerCase() : ''
    const measurement = MEASUREMENT_HEX.test(rawMeasurement) ? rawMeasurement : null
    return { enclave, measurement }
  } catch {
    return { enclave: null, measurement: null }
  }
}

export async function resolveMainnetEnclaveInfo(env: Record<string, string | undefined> = process.env): Promise<{
  enclave: string | null
  measurement: string
  endpoint: string | null
}> {
  const configured = env.ENCLAVE_MEASUREMENT?.trim().toLowerCase() || null
  if (configured && !MEASUREMENT_HEX.test(configured)) {
    throw new Error('ENCLAVE_MEASUREMENT must be 96 hexadecimal characters (SHA-384).')
  }
  const endpoint = env.ENCLAVE_ENDPOINT?.trim() || null
  const health = endpoint ? await fetchHealthEnclave(endpoint) : { enclave: null, measurement: null }
  if (configured && health.measurement && configured !== health.measurement) {
    throw new Error(`ENCLAVE_MEASUREMENT (${configured}) does not match live ${endpoint}/health measurement (${health.measurement}).`)
  }
  const measurement = configured ?? health.measurement
  if (!measurement) {
    throw new Error('Mainnet setup requires ENCLAVE_MEASUREMENT or a reachable ENCLAVE_ENDPOINT (/health) reporting the live Linux enclave measurement; refusing to hash the local runtime bundle.')
  }
  return { enclave: health.enclave, measurement, endpoint }
}

/** Lead-run setup. It uses the real programs directly, before the API/indexer exist. */
export async function setup(cluster: Cluster): Promise<PublicSetup> {
  loadSetupEnvironment(cluster)
  process.env.CLUSTER = cluster
  const url = process.env.SOLANA_RPC_URL
  if (!url) throw new Error('SOLANA_RPC_URL is required.')
  const host = new URL(url).hostname
  if (cluster === 'localnet' && !LOCAL_HOSTS.has(host)) throw new Error('localnet:setup requires the supplied loopback validator.')
  if (cluster !== 'localnet' && LOCAL_HOSTS.has(host)) throw new Error(`${cluster}:setup requires a remote ${cluster} RPC endpoint.`)
  const config = setupConfiguration(cluster)
  if (config.protocolShareBps < 0 || config.operatorShareBps < 0 || config.protocolShareBps + config.operatorShareBps > 10000 || config.callDeadlineSlots <= 0n || config.recordLifetimeSlots <= 0n || config.maxReportAgeSlots <= 0n || config.price < 0n || config.uploadFunding <= 0n || config.operatorFunding < 0n || config.keeperFunding < 0n || config.priorityFeeMicroLamports < 0n || (cluster !== 'mainnet-beta' && (!Number.isSafeInteger(config.actorFunding) || config.actorFunding <= 0))) throw new Error('Invalid setup economics or slot configuration.')
  const deployerPath = setupKeyPath('DEPLOYER_KEYPAIR', 'deployer', cluster)
  const deployer = setupKeypair(deployerPath)
  const rootPath = setupKeyPath('DEV_ATTESTATION_ROOT_KEYPAIR', 'attest-root', cluster)
  const root = setupKeypair(rootPath)
  const operatorPath = setupKeyPath('OPERATOR_KEYPAIR', 'operator', cluster)
  const operator = setupKeypair(operatorPath)
  const owner = cluster === 'mainnet-beta' && !process.env.OWNER_KEYPAIR ? deployer : setupKeypair(setupKeyPath('OWNER_KEYPAIR', 'owner', cluster))
  const caller = cluster === 'mainnet-beta' ? null : setupKeypair(setupKeyPath('CALLER_KEYPAIR', 'caller', cluster))
  if (cluster === 'devnet' && !process.env.FEE_RECIPIENT) throw new Error('FEE_RECIPIENT must be explicitly configured before devnet setup.')
  const feeRecipient = process.env.FEE_RECIPIENT
    ? new PublicKey(process.env.FEE_RECIPIENT)
    : setupKeypair(setupKeyPath('FEE_RECIPIENT_KEYPAIR', cluster === 'mainnet-beta' ? 'launch-wallet' : 'fee-recipient', cluster)).publicKey
  const sealingSecret = process.env.DEV_SEALING_KEY ?? (cluster === 'mainnet-beta' && existsSync(resolve('keys/mainnet/sealing-key.hex')) ? readFileSync(resolve('keys/mainnet/sealing-key.hex'), 'utf8').trim() : undefined)
  const sealKey = sealingKey(sealingSecret, operator.secretKey)
  const rpc = createRpc({
    url,
    service: 'voynich-setup',
    rps: process.env.SETUP_RPC_RPS ? Number(process.env.SETUP_RPC_RPS) : (cluster === 'localnet' ? undefined : 5),
    scanIntervalMs: process.env.SETUP_SCAN_INTERVAL_MS ? Number(process.env.SETUP_SCAN_INTERVAL_MS) : (cluster === 'localnet' ? undefined : 1000),
  })
  const programs = chainPrograms(rpc.connection, { programId: process.env.PROGRAM_ID, attestationProgramId: process.env.ATTESTATION_PROGRAM_ID })
  const pda = addresses(programs.voynich.programId, programs.attest.programId)
  const genesisHash = await rpc.connection.getGenesisHash()
  if (cluster === 'devnet' && genesisHash !== DEVNET_GENESIS_HASH) throw new Error('The configured RPC is not Solana devnet.')
  if (cluster === 'mainnet-beta' && genesisHash !== MAINNET_GENESIS_HASH) throw new Error('The configured RPC is not Solana mainnet-beta.')
  const chain = `${genesisHash}:${programs.voynich.programId}:${programs.attest.programId}`
  const vaultPath = resolve(process.env.SETUP_STATE_PATH ?? `.local/setup-${cluster}.sealed.json`)
  const state = readSealed<SetupState>(vaultPath, sealKey) ?? { version: 1, chain, lookupTable: null, upload: null, pending: {} }
  if (state.version !== 1 || state.chain !== chain) throw new Error('This sealed setup state belongs to another chain. Choose a separate SETUP_STATE_PATH.')
  const save = () => writeSealed(vaultPath, sealKey, state)
  save()
  const send = async (action: string, payer: Keypair, instructions: TransactionInstruction[], extra: Signer[] = [], useTable = true): Promise<string> => {
    for (let attempt = 1; ; attempt++) {
      let pending = state.pending[action]
      if (!pending) {
        if (!instructions.length) throw new Error(`Missing instructions for pending action ${action}.`)
        const signers = [...new Map([payer, ...extra].map(signer => [signer.publicKey.toBase58(), signer])).values()]
        const lookupTables = state.lookupTable && useTable ? await withLagRetry(() => loadLookupTables(rpc.connection, [new PublicKey(state.lookupTable!)])) : []
        const build = await withLagRetry(() => buildUnsignedV0({
          connection: rpc.connection,
          payer: payer.publicKey,
          instructions,
          cosigners: signers.filter(signer => !signer.publicKey.equals(payer.publicKey)).map(signer => signer.publicKey),
          walletSigned: false,
          lookupTables,
          microLamports: config.priorityFeeMicroLamports,
        }))
        build.transaction.sign(signers)
        pending = { bytes: toBase64(build.transaction.serialize()), blockhash: build.blockhash, lastValidBlockHeight: build.lastValidBlockHeight, contextSlot: build.contextSlot }
        state.pending[action] = pending; save()
      }
      try {
        const result = await sendSigned(rpc.connection, { ...pending, bytes: fromBase64(pending.bytes) })
        delete state.pending[action]; save(); return result.signature
      } catch (error) {
        if (error instanceof TxSendError && (error.outcome === 'failed' || error.outcome === 'expired')) {
          delete state.pending[action]; save()
          if (error.outcome === 'expired' && instructions.length > 0 && attempt < 3) continue
        }
        throw error
      }
    }
  }
  for (const action of Object.keys(state.pending)) await send(action, deployer, [])
  if (cluster === 'mainnet-beta') {
    if (config.operatorFunding > 0n && !operator.publicKey.equals(deployer.publicKey)) {
      const balance = BigInt(await rpc.connection.getBalance(operator.publicKey, 'confirmed'))
      if (balance < config.operatorFunding) await send(`fund:${operator.publicKey}`, deployer, [SystemProgram.transfer({ fromPubkey: deployer.publicKey, toPubkey: operator.publicKey, lamports: Number(config.operatorFunding - balance) })])
    }
    if (config.keeperFunding > 0n) {
      const keeper = setupKeypair(setupKeyPath('KEEPER_KEYPAIR', 'keeper', cluster))
      if (!keeper.publicKey.equals(deployer.publicKey)) {
        const balance = BigInt(await rpc.connection.getBalance(keeper.publicKey, 'confirmed'))
        if (balance < config.keeperFunding) await send(`fund:${keeper.publicKey}`, deployer, [SystemProgram.transfer({ fromPubkey: deployer.publicKey, toPubkey: keeper.publicKey, lamports: Number(config.keeperFunding - balance) })])
      }
    }
  } else {
    const funding = [...new Map([owner.publicKey, caller!.publicKey, operator.publicKey].map(wallet => [wallet.toBase58(), wallet])).values()]
    for (const recipient of funding) {
      const balance = await rpc.connection.getBalance(recipient, 'confirmed')
      const required = recipient.equals(owner.publicKey) || recipient.equals(caller!.publicKey) ? config.walletFunding : config.actorFunding
      if (balance < required && !recipient.equals(deployer.publicKey)) await send(`fund:${recipient}`, deployer, [SystemProgram.transfer({ fromPubkey: deployer.publicKey, toPubkey: recipient, lamports: required - balance })])
    }
  }
  const feeMinimum = await rpc.connection.getMinimumBalanceForRentExemption(0)
  const feeBalance = await rpc.connection.getBalance(feeRecipient, 'confirmed')
  if (feeBalance < feeMinimum && !feeRecipient.equals(deployer.publicKey)) await send('fund-fee-recipient', deployer, [SystemProgram.transfer({ fromPubkey: deployer.publicKey, toPubkey: feeRecipient, lamports: feeMinimum - feeBalance })])
  const attestConfig = await programs.attest.account.attestConfig.fetchNullable(pda.attestConfig)
  if (!attestConfig) await send('initialize-attest', deployer, [await programs.attest.methods.initialize(root.publicKey, bn(config.maxReportAgeSlots), bn(config.recordLifetimeSlots)).accountsStrict({ admin: deployer.publicKey, config: pda.attestConfig, selfProgram: programs.attest.programId, programData: PublicKey.findProgramAddressSync([programs.attest.programId.toBuffer()], LOADER)[0], systemProgram: SystemProgram.programId, ...eventAccounts(programs.attest.programId) }).instruction()])
  else if (!attestConfig.devRoot.equals(root.publicKey) || attestConfig.maxReportAgeSlots.toString() !== config.maxReportAgeSlots.toString() || attestConfig.recordLifetimeSlots.toString() !== config.recordLifetimeSlots.toString()) throw new Error('The existing attestation config differs from setup. Use matching configuration or a fresh supplied local ledger.')
  const protocolConfigInfo = await rpc.connection.getAccountInfo(pda.config, 'confirmed')
  const protocolConfig = protocolConfigInfo && protocolConfigInfo.owner.equals(programs.voynich.programId) ? decodeConfigAccount(protocolConfigInfo.data) : null
  if (!protocolConfig) await send('initialize-voynich', deployer, [await programs.voynich.methods.initialize({ attestationProgram: programs.attest.programId, recordLayoutVersion: 1, feeRecipient, protocolShareBps: config.protocolShareBps, callDeadlineSlots: bn(config.callDeadlineSlots), maxOpenAnswerBytes: config.maxOpenAnswerBytes }).accountsStrict({ admin: deployer.publicKey, config: pda.config, programAccount: programs.voynich.programId, programData: PublicKey.findProgramAddressSync([programs.voynich.programId.toBuffer()], LOADER)[0], systemProgram: SystemProgram.programId, ...eventAccounts(programs.voynich.programId) }).instruction()])
  else if (protocolConfig.legacy) {
    await send('migrate-config', deployer, [await programs.voynich.methods.migrateConfig(config.maxOpenAnswerBytes).accountsStrict({ admin: deployer.publicKey, config: pda.config, systemProgram: SystemProgram.programId, ...eventAccounts(programs.voynich.programId) }).instruction()])
  } else if (!protocolConfig.attestationProgram.equals(programs.attest.programId) || protocolConfig.recordLayoutVersion !== 1 || !protocolConfig.feeRecipient.equals(feeRecipient) || protocolConfig.protocolShareBps !== config.protocolShareBps || protocolConfig.callDeadlineSlots.toString() !== config.callDeadlineSlots.toString() || protocolConfig.maxOpenAnswerBytes !== config.maxOpenAnswerBytes) {
    await send('configure-voynich', deployer, [await programs.voynich.methods.setConfig({
      attestationProgram: programs.attest.programId, recordLayoutVersion: 1, feeRecipient,
      protocolShareBps: config.protocolShareBps, callDeadlineSlots: bn(config.callDeadlineSlots),
      maxOpenAnswerBytes: config.maxOpenAnswerBytes,
    }).accountsStrict({ admin: deployer.publicKey, config: pda.config, ...eventAccounts(programs.voynich.programId) }).instruction()])
  }

  const bundlePath = resolve('enclave/dist/runtime.js')
  const mainnetEnclave = cluster === 'mainnet-beta' ? await resolveMainnetEnclaveInfo(process.env) : null
  const measurement = mainnetEnclave
    ? mainnetEnclave.measurement
    : createHash('sha384').update(readFileSync(bundlePath)).digest('hex')
  const manifest = decodeManifest(readFileSync('models/sketch-32/manifest.json', 'utf8'))
  const modelAddress = pda.model(manifest.name)
  let model = await programs.voynich.account.model.fetchNullable(modelAddress)
  if (!state.upload) {
    if (model) throw new Error('The model already exists but its owner sealing key is absent from this setup vault.')
    const sealed = sealWeights(readFileSync('models/sketch-32/sketch-32.onnx'))
    state.upload = { modelKey: toBase64(sealed.key), noncePrefix: toBase64(sealed.header.noncePrefix), ciphertext: toBase64(sealed.ciphertext), sha256: toHex(sealed.merkleRoot), uploadKey: [...Keypair.generate().secretKey], weightsKey: [...Keypair.generate().secretKey] }; save()
  }
  const upload = Keypair.fromSecretKey(Uint8Array.from(state.upload.uploadKey))
  const weights = Keypair.fromSecretKey(Uint8Array.from(state.upload.weightsKey))
  const ciphertext = fromBase64(state.upload.ciphertext)
  let runtime: { enclave: PublicKey; record: PublicKey; boot(): Promise<void> } | null = null
  if (cluster !== 'mainnet-beta') {
    process.env.OPERATOR_KEYPAIR = operatorPath
    process.env.DEV_ATTESTATION_ROOT_KEYPAIR = rootPath
    process.env.ENCLAVE_STATE_PATH ??= resolve('.local/enclave.sealed.json')
    process.env.ENCLAVE_ENDPOINT ??= `http://127.0.0.1:${process.env.ENCLAVE_PORT ?? '9707'}`
    const runtimeModule = await import(pathToFileURL(bundlePath).href) as { EnclaveRuntime: new () => { enclave: PublicKey; record: PublicKey; boot(): Promise<void> } }
    runtime = new runtimeModule.EnclaveRuntime()
  }
  let table = state.lookupTable ? (await rpc.connection.getAddressLookupTable(new PublicKey(state.lookupTable), { commitment: 'confirmed' })).value : null
  if (!table) {
    while (await rpc.connection.getSlot('finalized') < 32) await pause()
    const created = createLookupTable(deployer.publicKey, deployer.publicKey, await lookupTableRecentSlot(rpc.connection))
    state.lookupTable = created.address.toBase58(); save()
    await send('create-lookup-table', deployer, [created.instruction], [], false)
  }
  table = (await withLagRetry(() => loadLookupTables(rpc.connection, [new PublicKey(state.lookupTable!)])))[0]!
  const shared = [
    programs.voynich.programId, programs.attest.programId, pda.config, pda.attestConfig,
    eventAccounts(programs.voynich.programId).eventAuthority, eventAccounts(programs.attest.programId).eventAuthority,
    SystemProgram.programId, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, SYSVAR_INSTRUCTIONS_PUBKEY, SYSVAR_SLOT_HASHES_PUBKEY, SYSVAR_RENT_PUBKEY,
    modelAddress, weights.publicKey, owner.publicKey, operator.publicKey, feeRecipient,
    ...(runtime ? [runtime.enclave, runtime.record, pda.grant(modelAddress, runtime.enclave)] : []),
    ...(caller ? [caller.publicKey] : []),
  ]
  for (const [index, instruction] of extendLookupTable(table!, deployer.publicKey, deployer.publicKey, shared).entries()) await send(`extend-lookup-table:${index}`, deployer, [instruction], [], false)
  table = (await withLagRetry(() => loadLookupTables(rpc.connection, [new PublicKey(state.lookupTable!)])))[0]!
  await waitForLookupTables(rpc.connection, [table!])
  process.env.LOOKUP_TABLE = state.lookupTable!
  mkdirSync('.local', { recursive: true })
  const servicesEnv = [
    'MODE=chain', `CLUSTER=${cluster}`,
    `PROGRAM_ID=${programs.voynich.programId.toBase58()}`,
    `ATTESTATION_PROGRAM_ID=${programs.attest.programId.toBase58()}`,
    'ATTESTATION_RECORD_LAYOUT_VERSION=1',
    `FEE_RECIPIENT=${feeRecipient.toBase58()}`,
    `PROTOCOL_SHARE_BPS=${config.protocolShareBps}`,
    `CALL_DEADLINE_SLOTS=${config.callDeadlineSlots}`,
    `LOOKUP_TABLE=${state.lookupTable!}`,
    ...(cluster === 'localnet' ? [`BOUNTY_PROGRAM_ID=${process.env.BOUNTY_PROGRAM_ID ?? BOUNTY_PROGRAM_ID.toBase58()}`] : []),
    '',
  ].join('\n')
  writeFileSync('.local/services.env', servicesEnv)

  if (!await rpc.connection.getAccountInfo(weights.publicKey, 'confirmed')) await send('allocate-weights', owner, [SystemProgram.createAccount({ fromPubkey: owner.publicKey, newAccountPubkey: weights.publicKey, lamports: await rpc.connection.getMinimumBalanceForRentExemption(56 + ciphertext.length), space: 56 + ciphertext.length, programId: programs.voynich.programId })], [weights])
  if (!model) {
    await send('create-model', owner, [await programs.voynich.methods.createModel({ name: manifest.name, manifest: Buffer.from(encodeManifest(manifest)), sizeBytes: bn(ciphertext.length), cipher: 'xchacha20poly1305-64k-v1', noncePrefix: [...fromBase64(state.upload.noncePrefix)], allowedMeasurements: [[...Buffer.from(measurement, 'hex')]], price: bn(config.price), priceMint: PublicKey.default, operatorShareBps: config.operatorShareBps, uploadFundingLamports: bn(config.uploadFunding), extraUploadKeyCount: 0, base: null, priceUnit: { call: {} } }).accountsStrict({ owner: owner.publicKey, uploadKey: upload.publicKey, config: pda.config, model: modelAddress, systemProgram: SystemProgram.programId, ...eventAccounts(programs.voynich.programId) }).remainingAccounts([{ pubkey: weights.publicKey, isSigner: false, isWritable: true }]).instruction()], [upload])
    model = await withLagRetry(() => programs.voynich.account.model.fetch(modelAddress))
  }
  if (!model.owner.equals(owner.publicKey) || !model.weights[0]?.equals(weights.publicKey)) throw new Error('The model does not match this setup owner and sealed upload state.')
  if (!model.allowedMeasurements.some(value => toHex(Uint8Array.from(value)) === measurement)) throw new Error('The sealed model does not allow this runtime bundle measurement. A new software measurement requires a new model under this round\'s policy.')
  if ('uploading' in model.status) {
    const info = await withLagRetry(() => rpc.connection.getAccountInfo(weights.publicKey, 'confirmed'))
    if (!info) throw new Error('The resumable weights account is missing.')
    const header = decodeWeightsHeader(info.data)
    for (let offset = header.writtenBytes as number; offset < ciphertext.length; offset += WRITE_CHUNK_BYTES) {
      const bytes = ciphertext.subarray(offset, offset + WRITE_CHUNK_BYTES)
      await send(`write:${offset}`, upload, [await programs.voynich.methods.writeWeights(offset, Buffer.from(bytes)).accountsStrict({ uploadKey: upload.publicKey, model: modelAddress, weights: weights.publicKey, ...eventAccounts(programs.voynich.programId) }).instruction()])
      console.log(JSON.stringify({ event: 'upload.progress', writtenBytes: Math.min(offset + bytes.length, ciphertext.length), totalBytes: ciphertext.length, transactionsWritten: Math.ceil((offset + bytes.length) / WRITE_CHUNK_BYTES) }))
    }
    const expectedHash = toHex(ciphertextHash(ciphertext, (model as { hashVersion?: number }).hashVersion ?? 0))
    const seal = await programs.voynich.methods.sealModel([...Buffer.from(expectedHash, 'hex')]).accountsStrict({ owner: owner.publicKey, model: modelAddress, ...eventAccounts(programs.voynich.programId) }).remainingAccounts([{ pubkey: weights.publicKey, isSigner: false, isWritable: false }]).instruction()
    const balance = await rpc.connection.getBalance(upload.publicKey, 'confirmed')
    await send('seal-model', owner, [seal, ...(balance > 0 ? [SystemProgram.transfer({ fromPubkey: upload.publicKey, toPubkey: owner.publicKey, lamports: balance })] : [])], balance > 0 ? [upload] : [])
  } else if (toHex(Uint8Array.from(model.ciphertextSha256)) !== toHex(ciphertextHash(ciphertext, (model as { hashVersion?: number }).hashVersion ?? 0))) throw new Error('The on-chain ciphertext hash differs from this sealed setup vault.')

  let enclaveAddress: PublicKey
  let attestationRecordAddress: PublicKey
  let enclave: { encryptionKey: number[]; operator: PublicKey; measurement: number[]; attestationRecord: PublicKey }
  if (runtime) {
    // Registration has no HTTP server or poll loop; a lead starts the runtime after setup returns.
    await runtime.boot()
    enclaveAddress = runtime.enclave
    attestationRecordAddress = runtime.record
    enclave = await withLagRetry(() => programs.voynich.account.enclave.fetch(enclaveAddress))
  } else {
    let targetAddress: PublicKey | null = process.env.ENCLAVE_ADDRESS ? new PublicKey(process.env.ENCLAVE_ADDRESS) : null
    if (!targetAddress && process.env.ENCLAVE_ENDPOINT) {
      const fromHealth = await fetchHealthEnclave(process.env.ENCLAVE_ENDPOINT)
      const healthEnclave = fromHealth.enclave ?? mainnetEnclave?.enclave ?? null
      if (healthEnclave) targetAddress = new PublicKey(healthEnclave)
    } else if (!targetAddress && mainnetEnclave?.enclave) {
      targetAddress = new PublicKey(mainnetEnclave.enclave)
    }
    if (!targetAddress) {
      const registered = (await programs.voynich.account.enclave.all())
        .filter(entry => entry.account.operator.equals(operator.publicKey) && toHex(Uint8Array.from(entry.account.measurement)) === measurement)
        .sort((left, right) => Number(BigInt(right.account.expiresAtSlot.toString()) - BigInt(left.account.expiresAtSlot.toString())))
      targetAddress = registered[0]?.publicKey ?? null
    }
    const fetched = targetAddress ? await programs.voynich.account.enclave.fetchNullable(targetAddress) : null
    if (!targetAddress || !fetched) {
      const pendingResult: PublicSetup = {
        cluster, genesisHash,
        programId: programs.voynich.programId.toBase58(),
        attestationProgramId: programs.attest.programId.toBase58(),
        lookupTable: state.lookupTable!,
        model: modelAddress.toBase58(),
        weights: [weights.publicKey.toBase58()],
        enclave: null,
        attestationRecord: null,
        measurement,
        status: 'awaiting-enclave',
      }
      writeFileSync(`.local/${cluster}.json`, JSON.stringify(pendingResult, null, 2) + '\n')
      console.log(JSON.stringify({ event: 'setup.awaiting_enclave', ...pendingResult }))
      return pendingResult
    }
    if (!fetched.operator.equals(operator.publicKey)) throw new Error('The target enclave belongs to another operator keypair.')
    if (toHex(Uint8Array.from(fetched.measurement)) !== measurement) throw new Error('The target enclave software measurement does not match this runtime bundle.')
    enclaveAddress = targetAddress
    attestationRecordAddress = fetched.attestationRecord
    enclave = fetched
    const enclaveExtend = extendLookupTable(table!, deployer.publicKey, deployer.publicKey, [enclaveAddress, attestationRecordAddress, pda.grant(modelAddress, enclaveAddress)])
    if (enclaveExtend.length) {
      for (const [index, instruction] of enclaveExtend.entries()) await send(`extend-lookup-table-enclave:${index}`, deployer, [instruction], [], false)
      table = (await withLagRetry(() => loadLookupTables(rpc.connection, [new PublicKey(state.lookupTable!)])))[0]!
      await waitForLookupTables(rpc.connection, [table!])
    }
  }

  const grantAddress = pda.grant(modelAddress, enclaveAddress)
  const grant = await programs.voynich.account.grant.fetchNullable(grantAddress)
  if (!grant || grant.revoked) await send('grant-model', owner, [await programs.voynich.methods.grantByOwner(Buffer.from(wrapKey(fromBase64(state.upload.modelKey), Uint8Array.from(enclave.encryptionKey)))).accountsStrict({ owner: owner.publicKey, payer: owner.publicKey, config: pda.config, model: modelAddress, targetEnclave: enclaveAddress, targetAttestationRecord: attestationRecordAddress, grant: grantAddress, systemProgram: SystemProgram.programId, ...eventAccounts(programs.voynich.programId) }).instruction()])

  if (cluster === 'localnet' && process.env.SEED_TEXT_1M === '1') {
    const baseSource = process.env.TEXT_1M_BASE_URL?.trim()
    if (!baseSource) throw new Error('SEED_TEXT_1M=1 requires TEXT_1M_BASE_URL pointing to text-1m-base.onnx.')
    const textManifest = decodeManifest(readFileSync('models/text-1m/manifest.json', 'utf8'))
    const textBase = JSON.parse(readFileSync('models/text-1m/base.json', 'utf8')) as { sha256: string; sizeBytes: number; format: string }
    const textModelAddress = pda.model(textManifest.name)
    let textModel = await programs.voynich.account.model.fetchNullable(textModelAddress)
    if (!textModel) {
      const adapterBytes = readFileSync('models/text-1m/text-1m.voya')
      const sealedAdapter = sealWeights(adapterBytes)
      const textUpload = Keypair.generate()
      const textWeights = Keypair.generate()
      const textCipher = sealedAdapter.ciphertext
      await send('allocate-text-weights', owner, [SystemProgram.createAccount({ fromPubkey: owner.publicKey, newAccountPubkey: textWeights.publicKey, lamports: await rpc.connection.getMinimumBalanceForRentExemption(56 + textCipher.length), space: 56 + textCipher.length, programId: programs.voynich.programId })], [textWeights])
      await send('create-text-model', owner, [await programs.voynich.methods.createModel({
        name: textManifest.name,
        manifest: Buffer.from(encodeManifest(textManifest)),
        sizeBytes: bn(textCipher.length),
        cipher: 'xchacha20poly1305-64k-v1',
        noncePrefix: [...sealedAdapter.header.noncePrefix],
        allowedMeasurements: [[...Buffer.from(measurement, 'hex')]],
        price: bn(config.price),
        priceMint: PublicKey.default,
        operatorShareBps: config.operatorShareBps,
        uploadFundingLamports: bn(config.uploadFunding),
        extraUploadKeyCount: 0,
        base: { sha256: [...Buffer.from(textBase.sha256, 'hex')], sizeBytes: bn(textBase.sizeBytes), format: textBase.format, source: baseSource },
        priceUnit: { call: {} },
      }).accountsStrict({ owner: owner.publicKey, uploadKey: textUpload.publicKey, config: pda.config, model: textModelAddress, systemProgram: SystemProgram.programId, ...eventAccounts(programs.voynich.programId) }).remainingAccounts([{ pubkey: textWeights.publicKey, isSigner: false, isWritable: true }]).instruction()], [textUpload])
      textModel = await withLagRetry(() => programs.voynich.account.model.fetch(textModelAddress))
      for (let offset = 0; offset < textCipher.length; offset += WRITE_CHUNK_BYTES) {
        const bytes = textCipher.subarray(offset, offset + WRITE_CHUNK_BYTES)
        await send(`text-write:${offset}`, textUpload, [await programs.voynich.methods.writeWeights(offset, Buffer.from(bytes)).accountsStrict({ uploadKey: textUpload.publicKey, model: textModelAddress, weights: textWeights.publicKey, ...eventAccounts(programs.voynich.programId) }).instruction()])
      }
      const expectedTextHash = toHex(ciphertextHash(textCipher, (textModel as { hashVersion?: number }).hashVersion ?? 0))
      const textSealIx = await programs.voynich.methods.sealModel([...Buffer.from(expectedTextHash, 'hex')]).accountsStrict({ owner: owner.publicKey, model: textModelAddress, ...eventAccounts(programs.voynich.programId) }).remainingAccounts([{ pubkey: textWeights.publicKey, isSigner: false, isWritable: false }]).instruction()
      const textBal = await rpc.connection.getBalance(textUpload.publicKey, 'confirmed')
      await send('seal-text-model', owner, [textSealIx, ...(textBal > 0 ? [SystemProgram.transfer({ fromPubkey: textUpload.publicKey, toPubkey: owner.publicKey, lamports: textBal })] : [])], textBal > 0 ? [textUpload] : [])
      const textGrantAddress = pda.grant(textModelAddress, enclaveAddress)
      await send('grant-text-model', owner, [await programs.voynich.methods.grantByOwner(Buffer.from(wrapKey(sealedAdapter.key, Uint8Array.from(enclave.encryptionKey)))).accountsStrict({ owner: owner.publicKey, payer: owner.publicKey, config: pda.config, model: textModelAddress, targetEnclave: enclaveAddress, targetAttestationRecord: attestationRecordAddress, grant: textGrantAddress, systemProgram: SystemProgram.programId, ...eventAccounts(programs.voynich.programId) }).instruction()])
      console.log(JSON.stringify({ event: 'setup.text_1m_seeded', model: textModelAddress.toBase58(), baseSource, adapterBytes: adapterBytes.length }))
    }
  }

  const result: PublicSetup = { cluster, genesisHash, programId: programs.voynich.programId.toBase58(), attestationProgramId: programs.attest.programId.toBase58(), lookupTable: state.lookupTable!, model: modelAddress.toBase58(), weights: [weights.publicKey.toBase58()], enclave: enclaveAddress.toBase58(), attestationRecord: attestationRecordAddress.toBase58(), measurement, status: 'ready' }
  writeFileSync(`.local/${cluster}.json`, JSON.stringify(result, null, 2) + '\n')
  writeFileSync('.local/services.env', servicesEnv)
  console.log(JSON.stringify({ event: 'setup.complete', ...result }))
  return result
}
