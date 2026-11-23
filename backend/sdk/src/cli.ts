#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { stdin, stdout, stderr } from 'node:process'
import { homedir, tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Connection, Keypair, PublicKey } from '@solana/web3.js'
import { ApiClientError, createClient, decodeManifest, type MeasurementStatus, type PriceUnit } from '@voynich/contract'
import { fromBase64, fromHex, sha256, signSealDerivation, streamInitialHash, streamNextHash, toHex, verifyPiece } from './crypto.js'
import { createVoynich } from './client.js'
import { PROGRAM_ID, decodeMeasurementAccount, measurementPda } from './program.js'
import { loadOwnerFile, saveOwnerFile } from './owner-file.js'
import { resolveCliSealBase } from './seal-base.js'
import voynich from './node.js'

const { positionals, values } = parseArgs({ allowPositionals: true, options: {
  'api-url': { type: 'string' }, keypair: { type: 'string' }, manifest: { type: 'string' }, model: { type: 'string' }, state: { type: 'string' },
  price: { type: 'string' }, 'price-unit': { type: 'string' }, ceiling: { type: 'string' }, mint: { type: 'string' }, decimals: { type: 'string' }, symbol: { type: 'string' },
  'operator-share-bps': { type: 'string' }, measurement: { type: 'string', multiple: true }, 'upload-funding': { type: 'string' },
  'upload-keys': { type: 'string' }, enclave: { type: 'string' }, open: { type: 'boolean' }, resume: { type: 'boolean' },
  base: { type: 'string' }, 'base-file': { type: 'string' }, 'base-sha256': { type: 'string' }, 'base-size': { type: 'string' }, 'base-format': { type: 'string' },
  text: { type: 'string' }, 'max-tokens': { type: 'string' }, stream: { type: 'boolean' },
  count: { type: 'string' }, 'running-hash': { type: 'string' }, signature: { type: 'string' }, 'from-pieces': { type: 'boolean' },
  status: { type: 'string' }, recipe: { type: 'string' }, digest: { type: 'string' }, 'recipe-hash': { type: 'string' },
  repo: { type: 'string' }, commit: { type: 'string' }, version: { type: 'string' }, source: { type: 'string' }, rebuild: { type: 'boolean' },
  'allow-list': { type: 'boolean' }, caller: { type: 'string', multiple: true }, 'max-calls': { type: 'string' }, 'window-slots': { type: 'string' },
  operator: { type: 'string', multiple: true }, region: { type: 'string', multiple: true },
  help: { type: 'boolean', short: 'h' },
} })
if (values['api-url']) process.env.VOYNICH_API_URL = values['api-url']
const [command, argument, third, fourth] = positionals
const required = (value: string | undefined, name: string) => { if (!value) throw new Error(`Supply ${name}.`); return value }
function parseMint(value: string | undefined, current: string | null = null): string | null {
  if (value === undefined) return current
  const mint = value.trim()
  return mint.toUpperCase() === 'SOL' ? null : mint
}
function parsePriceUnit(value: string | undefined): PriceUnit | undefined {
  if (value === undefined) return undefined
  const unit = value.trim().toLowerCase()
  if (unit === 'call' || unit === 'token') return unit
  throw new Error('--price-unit must be call or token.')
}
async function solanaCliKeypairPath(): Promise<string> {
  const fallback = join(homedir(), '.config', 'solana', 'id.json')
  const configPath = join(homedir(), '.config', 'solana', 'cli', 'config.yml')
  let config: string
  try { config = await readFile(configPath, 'utf8') }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback; throw error }
  const match = /^\s*keypair_path\s*:\s*(.*?)\s*$/m.exec(config)
  if (!match?.[1]) return fallback
  let value = match[1].trim()
  if (value.startsWith('"')) {
    const scalar = /^"(?:[^"\\]|\\.)*"/.exec(value)?.[0]
    if (!scalar) throw new Error('Solana CLI config has an invalid quoted keypair_path')
    value = JSON.parse(scalar) as string
  }
  else if (value.startsWith("'")) {
    const scalar = /^'(?:[^']|'')*'/.exec(value)?.[0]
    if (!scalar) throw new Error('Solana CLI config has an invalid quoted keypair_path')
    value = scalar.slice(1, -1).replace(/''/g, "'")
  } else value = value.replace(/(?:^|\s+)#.*$/, '').trim()
  if (!value) return fallback
  if (value === '~') return homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) return join(homedir(), value.slice(2))
  return isAbsolute(value) ? value : resolve(dirname(configPath), value)
}
async function configureCliSigner(): Promise<void> {
  if (command === 'enclave' && ['run', 'register'].includes(argument ?? '')) {
    process.env.OPERATOR_KEYPAIR = values.keypair ?? process.env.OPERATOR_KEYPAIR ?? await solanaCliKeypairPath()
  } else if (
    ['call', 'seal', 'grant', 'refund', 'settle'].includes(command ?? '')
    || (command === 'model' && ['price', 'retire', 'revoke'].includes(argument ?? ''))
    || (command === 'model' && argument === 'policy' && ['set', 'clear'].includes(third ?? ''))
    || (command === 'measurement' && ['publish', 'deprecate'].includes(argument ?? ''))
  ) {
    process.env.VOYNICH_KEYPAIR = values.keypair ?? process.env.VOYNICH_KEYPAIR ?? await solanaCliKeypairPath()
  }
}
async function password(): Promise<string> {
  if (process.env.VOYNICH_PASSWORD) return process.env.VOYNICH_PASSWORD
  if (!stdin.isTTY) throw new Error('Set VOYNICH_PASSWORD when no interactive terminal is available')
  stderr.write('Owner key file password: ')
  stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8')
  return new Promise((resolve, reject) => {
    let text = ''
    const cleanup = () => { stdin.setRawMode(false); stdin.pause(); stdin.off('data', read); stderr.write('\n') }
    const read = (chunk: string | Buffer) => { for (const char of String(chunk)) { if (char === '\u0003') { cleanup(); reject(new Error('Cancelled')); return } if (char === '\r' || char === '\n') { cleanup(); if (!text) reject(new Error('The password cannot be empty')); else resolve(text); return } if (char === '\u007f' || char === '\b') text = text.slice(0, -1); else text += char } }
    stdin.on('data', read)
  })
}
async function enclaveCommand(action: string | undefined) {
  // A separate Node runtime package; absent from the browser dependency graph.
  const moduleName = 'voynich-enclave'
  const originalLog = console.log
  console.log = (...args) => console.error(...args)
  try {
    const runtime = await import(moduleName) as { runFromEnv(): Promise<void>; registerFromEnv(): Promise<void>; statusFromEnv(): Promise<unknown> }
    if (action === 'run') return await runtime.runFromEnv()
    if (action === 'register') { await runtime.registerFromEnv(); return await runtime.statusFromEnv() }
    if (action === 'status') return await runtime.statusFromEnv()
    throw new Error('Use enclave register, enclave run, or enclave status.')
  } finally { console.log = originalLog }
}
async function loadRecipeJson(explicitPath?: string, baseDir?: string): Promise<{ measurement?: string; recipeHash?: string; version?: string } | null> {
  const root = baseDir ? resolve(baseDir) : process.cwd()
  const candidates = explicitPath
    ? [resolve(explicitPath)]
    : [
        resolve(root, 'enclave/dist/recipe.json'),
        resolve(root, 'backend/enclave/dist/recipe.json'),
        resolve(root, 'dist/recipe.json'),
      ]
  for (const file of candidates) {
    if (!existsSync(file)) continue
    const parsed = JSON.parse(await readFile(file, 'utf8')) as { measurement?: string; recipeHash?: string; version?: string }
    return parsed
  }
  if (explicitPath) throw new Error(`Recipe file not found: ${resolve(explicitPath)}`)
  return null
}
function findEnclaveBuildScript(sourceDir?: string): string {
  const root = sourceDir ? resolve(sourceDir) : process.cwd()
  for (const candidate of [
    resolve(root, 'enclave/build.mjs'),
    resolve(root, 'backend/enclave/build.mjs'),
    resolve(root, 'build.mjs'),
  ]) {
    if (existsSync(candidate)) return candidate
  }
  throw new Error(`Could not find enclave/build.mjs under ${root}. Supply --source <dir>.`)
}
async function loadCliKeypair(): Promise<Keypair> {
  const file = required(process.env.VOYNICH_KEYPAIR, '--keypair or VOYNICH_KEYPAIR')
  const decoded = JSON.parse(await readFile(file, 'utf8')) as unknown
  if (!Array.isArray(decoded) || decoded.length !== 64 || !decoded.every(v => Number.isInteger(v) && v >= 0 && v <= 255)) {
    throw new Error('Keypair file must contain a 64-byte Solana JSON secret array.')
  }
  return Keypair.fromSecretKey(Uint8Array.from(decoded))
}
async function main(): Promise<unknown> {
  if (values.help || !command) { stderr.write('voynich models | enclaves | call <model> [<input.json> | --text "<prompt>"] [--max-tokens <n>] [--ceiling <base units>] [--stream] [--open] [--enclave <key>] | verify <receipt> | seal <weights.onnx|adapter.voya> [--manifest <manifest.json> | --model <name|address>] [--base <json-file|url>] [--base-file <local-base>] [--base-sha256 <hex64>] [--base-size <bytes>] [--base-format <onnx|safetensors|gguf>] [--state <owner.enc.json>] [--price <base units>] [--price-unit <call|token>] [--operator-share-bps <bps>] [--measurement <hex48>] [--upload-funding <lamports>] [--upload-keys <1..8>] [--enclave <key>] [--resume]\nvoynich grant <model> <enclave> [--state <owner.enc.json>] | settle <call> (--count <n> --running-hash <hex64> --signature <base64> | --from-pieces) | refund <call> | enclave register|run|status | account <wallet>\nvoynich measurement list [--status active|deprecated] | measurement show <digest> | measurement publish [--recipe <path>] [--digest <hex96>] [--recipe-hash <hex64>] --repo <source_repo> --commit <commit_sha> [--version <semver>] | measurement deprecate <digest> | measurement verify <digest> [--recipe <path>] [--source <dir>] [--rebuild]\nvoynich model price <model> --price <base units> [--price-unit <call|token>] [--operator-share-bps <bps>] [--mint <SOL|mint address>] [--decimals <n>] [--symbol <symbol>]\nvoynich model policy show <model> | model policy set <model> [--allow-list] [--caller <pubkey> ...] [--max-calls <n>] [--window-slots <slots>] [--operator <pubkey> ...] [--region <region> ...] | model policy clear <model>\nvoynich model retire <model> | model revoke <model> <enclave>\nGlobal: --api-url <url> --keypair <Solana JSON file>; VOYNICH_PASSWORD supplies a noninteractive owner-file password when --state is used. Results are JSON on stdout; prompts and progress go to stderr.\n'); return }
  await configureCliSigner()
  if (command === 'models') return voynich.models()
  if (command === 'enclaves') return voynich.enclaves()
  if (command === 'measurement') {
    const action = required(argument, 'measurement subcommand (list, show, publish, deprecate, or verify)')
    if (action === 'list') {
      let status: MeasurementStatus | undefined
      if (values.status !== undefined) {
        const norm = values.status.trim().toLowerCase()
        if (norm !== 'active' && norm !== 'deprecated') throw new Error('--status must be active or deprecated.')
        status = norm
      }
      return voynich.measurements(status ? { status } : {})
    }
    if (action === 'show') return voynich.measurement(required(third, '96-hex measurement digest'))
    if (action === 'deprecate') return voynich.deprecateMeasurement(required(third, '96-hex measurement digest'))
    if (action === 'publish') {
      const recipe = await loadRecipeJson(values.recipe)
      const digest = required(values.digest ?? recipe?.measurement, '--digest (or --recipe pointing to recipe.json)').toLowerCase()
      const recipeHash = required(values['recipe-hash'] ?? recipe?.recipeHash, '--recipe-hash (or --recipe pointing to recipe.json)').toLowerCase()
      const version = required(values.version ?? recipe?.version, '--version (or --recipe pointing to recipe.json)')
      const sourceRepo = required(values.repo, '--repo')
      const commitSha = required(values.commit, '--commit')
      const signer = await loadCliKeypair()
      const client = createVoynich({ apiUrl: process.env.VOYNICH_API_URL ?? 'http://127.0.0.1:9702', signer })
      const build = await client.api.publishMeasurement({
        wallet: signer.publicKey.toBase58(),
        digest,
        sourceRepo,
        commitSha,
        recipeHash,
        version,
      })
      const tx = await client.send(build)
      const record = await client.api.measurement(digest).catch(() => null)
      return {
        measurement: record?.address ?? build.addresses.measurement ?? null,
        digest,
        transaction: tx.signature ?? null,
        status: record?.status ?? 'active',
      }
    }
    if (action === 'verify') {
      const digest = required(third, '96-hex measurement digest').toLowerCase()
      const record = await voynich.measurement(digest)
      const config = await voynich.config()
      let onChainMatch = true
      if (!config.fixture && config.programId) {
        onChainMatch = false
        try {
          const connection = new Connection(config.rpcUrl, 'confirmed')
          const pda = measurementPda(digest, config.programId)
          const info = await connection.getAccountInfo(pda, 'confirmed')
          if (info) {
            const onChain = decodeMeasurementAccount(info.data)
            onChainMatch = (
              onChain.digest === record.digest
              && onChain.publisher.toBase58() === record.publisher
              && onChain.sourceRepo === record.sourceRepo
              && onChain.commitSha === record.commitSha
              && onChain.recipeHash === record.recipeHash
              && onChain.version === record.version
              && onChain.createdSlot.toString() === record.createdSlot
              && onChain.status === record.status
            )
          }
        } catch {
          onChainMatch = false
        }
      }
      let localMeasurement: string | null = null
      let localRecipeHash: string | null = null
      if (values.rebuild) {
        const buildScript = findEnclaveBuildScript(values.source)
        const buildMod = await import(pathToFileURL(buildScript).href) as {
          buildEnclave: (opts?: { outDir?: string }) => Promise<{ recipe: { measurement: string; recipeHash: string } }>
        }
        const scratch = await mkdtemp(join(tmpdir(), 'voynich-measurement-verify-'))
        try {
          const built = await buildMod.buildEnclave({ outDir: scratch })
          localMeasurement = built.recipe.measurement.toLowerCase()
          localRecipeHash = built.recipe.recipeHash.toLowerCase()
        } finally {
          await rm(scratch, { recursive: true, force: true })
        }
      } else {
        const recipe = await loadRecipeJson(values.recipe, values.source)
        if (!recipe?.measurement || !recipe?.recipeHash) {
          throw new Error('Could not find recipe.json with measurement and recipeHash. Supply --recipe <path> or --rebuild.')
        }
        localMeasurement = recipe.measurement.toLowerCase()
        localRecipeHash = recipe.recipeHash.toLowerCase()
      }
      const digestMatch = localMeasurement === record.digest && record.digest === digest
      const recipeMatch = localRecipeHash === record.recipeHash
      const verified = record.status === 'active' && onChainMatch && digestMatch && recipeMatch
      if (!verified) process.exitCode = 1
      return {
        verified,
        digest: record.digest,
        recipeHash: record.recipeHash,
        status: record.status,
        onChainMatch,
        digestMatch,
        recipeMatch,
        sourceRepo: record.sourceRepo,
        commitSha: record.commitSha,
        version: record.version,
      }
    }
    throw new Error('Use measurement list, measurement show <digest>, measurement publish, measurement deprecate <digest>, or measurement verify <digest>.')
  }
  if (command === 'account') return voynich.account(required(argument, 'wallet address for account'))
  if (command === 'verify') {
    const result = await voynich.verify(required(argument, 'receipt address, call address or transaction signature'))
    if (!result.verified) process.exitCode = 1
    return result
  }
  if (command === 'refund') return voynich.refund(required(argument, 'call address'))
  if (command === 'settle') {
    const callAddress = required(argument, 'call address')
    let count: string
    let runningHash: string
    let signature: string
    if (values['from-pieces']) {
      const api = createClient(process.env.VOYNICH_API_URL ?? 'http://127.0.0.1:9702')
      const [call, piecesRes] = await Promise.all([api.call(callAddress), api.callPieces(callAddress)])
      if (!piecesRes.pieces.length) throw new Error('No signed pieces are buffered for this call.')
      const [model, enclaveDetail] = await Promise.all([api.model(call.model), api.enclave(call.enclave)])
      const callBytes = new PublicKey(call.address).toBytes()
      const inputHashBytes = fromHex(call.inputHash)
      const signingKeyBytes = new PublicKey(enclaveDetail.enclave.signingKey).toBytes()
      const baseBytes = model.base ? fromHex(model.base.sha256) : null
      let currentHash = streamInitialHash(callBytes, inputHashBytes)
      let prevCount = 0
      let lastValid: { count: number; runningHash: string; signature: string } | null = null
      for (let i = 0; i < piecesRes.pieces.length; i++) {
        const piece = piecesRes.pieces[i]!
        if (piece.call !== call.address || piece.index !== i) break
        if (piece.deltaTokens < 0 || piece.count !== prevCount + piece.deltaTokens) break
        if (piece.deltaTokens === 0 && piece.finishReason === null) break
        const envBytes = fromBase64(piece.envelope)
        if (toHex(sha256(envBytes)) !== piece.pieceHash) break
        const nextHash = streamNextHash(currentHash, piece.count, envBytes)
        if (toHex(nextHash) !== piece.runningHash) break
        const sigBytes = fromBase64(piece.signature)
        if (!verifyPiece(sigBytes, signingKeyBytes, callBytes, inputHashBytes, piece.count, nextHash, baseBytes)) break
        currentHash = nextHash
        prevCount = piece.count
        lastValid = { count: piece.count, runningHash: piece.runningHash, signature: piece.signature }
      }
      if (!lastValid) throw new Error('No valid signed piece passed verification against the enclave key.')
      count = String(lastValid.count)
      runningHash = lastValid.runningHash
      signature = lastValid.signature
    } else {
      count = required(values.count, '--count (or pass --from-pieces)')
      runningHash = required(values['running-hash'], '--running-hash (or pass --from-pieces)')
      signature = required(values.signature, '--signature (or pass --from-pieces)')
    }
    const { receipt, verification } = await voynich.settle(callAddress, { count, runningHash, signature })
    return {
      call: callAddress,
      receipt: receipt.address,
      transactionSignature: receipt.transactionSignature,
      deliveredCount: receipt.deliveredCount,
      spentAmount: receipt.payments.total,
      returnedAmount: receipt.returnedAmount,
      verified: verification.verified,
      checks: {
        signature: verification.signature,
        record: verification.record,
        expiry: verification.expiry,
        answer: verification.answer,
        base: verification.base,
      },
    }
  }
  if (command === 'call') {
    const maxTokens = values['max-tokens'] !== undefined ? Number(values['max-tokens']) : undefined
    if (maxTokens !== undefined && (!Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > 4096)) {
      throw new Error('--max-tokens must be an integer between 1 and 4096.')
    }
    if (values.stream) {
      const prompt = required(values.text, '--text for --stream')
      const active = await voynich.stream(required(argument, 'model'), prompt, {
        ...(values.ceiling ? { ceiling: values.ceiling } : {}),
        ...(values.enclave ? { enclave: values.enclave } : {}),
        ...(maxTokens !== undefined ? { maxTokens } : {}),
      })
      let stopSent = false
      const onSigint = () => {
        if (stopSent) return
        stopSent = true
        stderr.write('\n[stopping stream and settling...]\n')
        void active.stop().catch(() => {})
      }
      process.on('SIGINT', onSigint)
      let printed = false
      try {
        for await (const verified of active) {
          if (verified.text) {
            stderr.write(verified.text)
            printed = true
          }
        }
      } finally {
        process.off('SIGINT', onSigint)
      }
      if (printed) stderr.write('\n')
      const result = await active.final()
      return {
        call: result.call.address,
        receipt: result.receipt.address,
        transactionSignature: result.receipt.transactionSignature,
        model: active.model.address,
        enclave: active.enclave.address,
        text: result.text,
        count: result.count,
        finishReason: result.finishReason,
        spentAmount: result.spentAmount,
        returnedAmount: result.returnedAmount,
        verified: result.verified,
        checks: result.checks,
      }
    }
    const callInput = values.text !== undefined
      ? values.text
      : JSON.parse(await readFile(required(third, 'input JSON file or --text'), 'utf8'))
    return voynich.call(required(argument, 'model'), callInput, {
      ...(values.open ? { answerMode: 'open' as const } : {}),
      ...(values.enclave ? { enclave: values.enclave } : {}),
      ...(maxTokens !== undefined ? { maxTokens } : {}),
      ...(values.ceiling !== undefined ? { ceiling: values.ceiling } : {}),
    })
  }
  if (command === 'enclave') return enclaveCommand(argument)
  if (command === 'model') {
    if (argument === 'policy') {
      const action = required(third, 'policy subcommand (show, set, or clear)')
      const modelId = required(fourth, 'model')
      if (action === 'show') {
        const policy = await voynich.policy(modelId)
        return policy ?? { model: modelId, policy: null }
      }
      if (action === 'set') {
        const maxCalls = values['max-calls'] !== undefined ? Number(values['max-calls']) : 0
        if (!Number.isSafeInteger(maxCalls) || maxCalls < 0 || maxCalls > 0xffffffff) {
          throw new Error('--max-calls must be an integer between 0 and 4294967295.')
        }
        const windowSlots = values['window-slots'] !== undefined ? values['window-slots'].trim() : '0'
        if (!/^\d+$/.test(windowSlots)) {
          throw new Error('--window-slots must be a non-negative integer.')
        }
        const signer = await loadCliKeypair()
        const client = createVoynich({ apiUrl: process.env.VOYNICH_API_URL ?? 'http://127.0.0.1:9702', signer })
        const build = await client.api.setPolicy(modelId, {
          wallet: signer.publicKey.toBase58(),
          allowListEnabled: Boolean(values['allow-list']),
          allowedCallers: values.caller ?? [],
          maxCallsPerCallerPerWindow: maxCalls,
          windowSlots,
          allowedOperators: values.operator ?? [],
          allowedRegions: (values.region ?? []).map(r => r.trim().toLowerCase()),
        })
        const tx = await client.send(build)
        let policy = await client.policy(modelId)
        for (let attempt = 0; !policy && attempt < 20; attempt++) {
          await new Promise(r => setTimeout(r, 250))
          policy = await client.policy(modelId)
        }
        return {
          model: policy?.model ?? modelId,
          policy,
          transaction: tx.signature ?? null,
        }
      }
      if (action === 'clear') {
        const tx = await voynich.clearPolicy(modelId)
        return {
          model: modelId,
          cleared: true,
          transaction: tx.signature ?? null,
        }
      }
      throw new Error('Use model policy show <model>, model policy set <model>, or model policy clear <model>.')
    }
    const modelId = required(third, 'model')
    if (argument === 'retire') return voynich.retire(modelId)
    if (argument === 'revoke') return voynich.revoke(modelId, required(fourth, 'enclave'))
    if (argument === 'price') {
      const model = await voynich.model(modelId)
      const mint = parseMint(values.mint, model.price.mint)
      const sameMint = mint === model.price.mint
      const priceUnit = parsePriceUnit(values['price-unit'])
      return voynich.setPrice(modelId, {
        amount: required(values.price, '--price'), mint,
        decimals: values.decimals !== undefined ? Number(values.decimals) : mint === null ? 9 : sameMint ? model.price.decimals : Number(required(undefined, '--decimals for a new SPL mint')),
        symbol: values.symbol ?? (sameMint ? model.price.symbol : mint ?? 'SOL'),
      }, values['operator-share-bps'] === undefined ? model.operatorShareBps : Number(values['operator-share-bps']), priceUnit !== undefined ? { priceUnit } : {})
    }
    throw new Error('Use model price, model policy, model retire, or model revoke.')
  }
  if (command === 'grant') {
    const model = await voynich.model(required(argument, 'model'))
    let modelKey: Uint8Array
    if (values.state) {
      const state = await loadOwnerFile(values.state, await password())
      if (model.address !== state.model) throw new Error('The owner key file belongs to another model')
      modelKey = state.modelKey
    } else {
      const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(required(process.env.VOYNICH_KEYPAIR, '--keypair'), 'utf8')) as number[]))
      const config = await voynich.config()
      const derived = await signSealDerivation(kp, config.programId ? new PublicKey(config.programId) : PROGRAM_ID, model.address)
      modelKey = derived.modelKey
    }
    return voynich.grant(model.address, required(third, 'enclave'), modelKey)
  }
  if (command === 'seal') {
    const statePath = values.state
    const secret = statePath ? await password() : undefined
    const state = values.resume && statePath ? await loadOwnerFile(statePath, secret!) : undefined
    const existingModel = values.resume && !state
      ? await voynich.model(values.model ?? decodeManifest(await readFile(required(values.manifest, '--manifest or --model'), 'utf8')).name)
      : undefined
    const manifest = values.manifest
      ? decodeManifest(await readFile(values.manifest, 'utf8'))
      : existingModel
        ? existingModel.manifest
        : (() => { throw new Error('Supply --manifest (or --model with --resume).') })()
    const mint = parseMint(values.mint, existingModel?.price.mint ?? null)
    const price = existingModel && values.price === undefined
      ? existingModel.price
      : {
          amount: required(values.price, '--price'),
          mint,
          decimals: Number(values.decimals ?? (mint === null ? 9 : required(undefined, '--decimals for an SPL mint'))),
          symbol: values.symbol ?? mint ?? 'SOL',
        }
    const operatorShareBps = values['operator-share-bps'] !== undefined
      ? Number(values['operator-share-bps'])
      : existingModel?.operatorShareBps ?? Number(required(undefined, '--operator-share-bps'))
    const allowedMeasurements = values.measurement?.length
      ? values.measurement
      : existingModel?.allowedMeasurements ?? []
    const uploadFundingLamports = values['upload-funding'] ?? (existingModel ? '0' : required(undefined, '--upload-funding'))
    const weights = state ? undefined : new Uint8Array(await readFile(required(argument, 'weights file')))
    const base = await resolveCliSealBase({
      flags: {
        base: values.base,
        baseFile: values['base-file'],
        baseSha256: values['base-sha256'],
        baseSize: values['base-size'],
        baseFormat: values['base-format'],
      },
      weights,
      existingBase: existingModel?.base ?? null,
    })
    const priceUnit = parsePriceUnit(values['price-unit'])
    const result = await voynich.seal({ weights, manifest,
      name: existingModel?.name ?? manifest.name,
      price,
      ...(priceUnit !== undefined ? { priceUnit } : {}),
      operatorShareBps, allowedMeasurements, uploadFundingLamports,
      ...(base ? { base } : {}),
      ...(values['upload-keys'] !== undefined ? { uploadKeyCount: Number(values['upload-keys']) } : {}),
      grantEnclave: values.enclave, resume: state,
      ...(statePath && secret ? { onPrepared: prepared => saveOwnerFile(statePath, prepared, secret) } : {}),
      onProgress: progress => process.stderr.write(`${progress.step}: ${progress.bytesWritten}/${progress.totalBytes} bytes, ${progress.transactionsSent} tx (${progress.transactionsWritten} writes), ${(progress.elapsedMs / 1000).toFixed(1)}s, ${progress.feesLamports} lamports fees\n`),
    })
    const mib = result.bytesWritten / (1024 * 1024)
    const elapsedSeconds = Number((result.elapsedMs / 1000).toFixed(3))
    const txPerMiB = mib > 0 ? Number((result.transactionsSent / mib).toFixed(2)) : 0
    const secondsPerMiB = mib > 0 ? Number((elapsedSeconds / mib).toFixed(2)) : 0
    process.stderr.write(`sealed: ${result.bytesWritten} bytes, ${result.transactionsSent} tx (${txPerMiB} tx/MiB), ${elapsedSeconds}s (${secondsPerMiB} s/MiB), ${result.feesLamports} lamports fees\n`)
    // The saved owner state already holds all secrets. Output public model facts and seal measurements only.
    return {
      ...result.model,
      bytesWritten: result.bytesWritten,
      transactionsSent: result.transactionsSent,
      elapsedSeconds,
      feesLamports: result.feesLamports,
      txPerMiB,
      secondsPerMiB,
    }
  }
  throw new Error(`Unknown command: ${command}. Use --help.`)
}
try { const result = await main(); if (result !== undefined) stdout.write(JSON.stringify(result, null, 2) + '\n') }
catch (error) {
  const code = error instanceof ApiClientError ? error.code : error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : undefined
  stderr.write((code ? `${code}: ` : '') + (error instanceof Error ? error.message : 'The command failed.') + '\n')
  process.exitCode = 1
}
