#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { stdin, stdout, stderr } from 'node:process'
import { homedir, tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Connection, Keypair, PublicKey } from '@solana/web3.js'
import { ApiClientError, createClient, decodeManifest, type AnswerMode, type MeasurementStatus, type PriceUnit } from '@voynich/contract'
import { fromBase64, fromHex, sha256, signSealDerivation, streamInitialHash, streamNextHash, toHex, verifyPiece } from './crypto.js'
import { createVoynich, type RoutingStrategy } from './client.js'
import type { SketchInput } from './preprocess.js'
import { PROGRAM_ID, decodeMeasurementAccount, measurementPda } from './program.js'
import { loadOwnerFile, saveOwnerFile } from './owner-file.js'
import { resolveCliSealBase } from './seal-base.js'
import voynich from './node.js'

const { positionals, values } = parseArgs({ allowPositionals: true, options: {
  'api-url': { type: 'string' }, api: { type: 'string' }, rpc: { type: 'string' }, json: { type: 'boolean' },
  keypair: { type: 'string' }, manifest: { type: 'string' }, model: { type: 'string' }, state: { type: 'string' },
  price: { type: 'string' }, 'price-unit': { type: 'string' }, ceiling: { type: 'string' }, mint: { type: 'string' }, decimals: { type: 'string' }, symbol: { type: 'string' },
  'operator-share-bps': { type: 'string' }, measurement: { type: 'string', multiple: true }, 'upload-funding': { type: 'string' },
  'upload-keys': { type: 'string' }, enclave: { type: 'string' }, strategy: { type: 'string' }, 'share-bps': { type: 'string' }, clear: { type: 'boolean' },
  open: { type: 'boolean' }, resume: { type: 'boolean' },
  base: { type: 'string' }, 'base-file': { type: 'string' }, 'base-sha256': { type: 'string' }, 'base-size': { type: 'string' }, 'base-format': { type: 'string' },
  text: { type: 'string' }, 'max-tokens': { type: 'string' }, stream: { type: 'boolean' },
  count: { type: 'string' }, 'running-hash': { type: 'string' }, signature: { type: 'string' }, 'from-pieces': { type: 'boolean' },
  status: { type: 'string' }, recipe: { type: 'string' }, digest: { type: 'string' }, 'recipe-hash': { type: 'string' },
  repo: { type: 'string' }, commit: { type: 'string' }, version: { type: 'string' }, source: { type: 'string' }, rebuild: { type: 'boolean' },
  'allow-list': { type: 'boolean' }, caller: { type: 'string', multiple: true }, 'max-calls': { type: 'string' }, 'window-slots': { type: 'string' },
  operator: { type: 'string', multiple: true }, region: { type: 'string', multiple: true },
  'owner-key': { type: 'string' },
  budget: { type: 'string' }, 'ttl-slots': { type: 'string' }, 'delegate-gas': { type: 'string' }, 'delegate-out': { type: 'string' },
  wallet: { type: 'string' }, session: { type: 'string' }, delegate: { type: 'string' },
  recipient: { type: 'string', multiple: true },
  evaluator: { type: 'string' }, 'min-score-bps': { type: 'string' },
  suite: { type: 'string' }, name: { type: 'string' }, 'dataset-uri': { type: 'string' }, 'answer-mode': { type: 'string' },
  'min-calls': { type: 'string' }, inactive: { type: 'boolean' }, calls: { type: 'string' }, pass: { type: 'string' },
  referrer: { type: 'string' },
  votes: { type: 'string' }, input: { type: 'string' }, 'distinct-enclaves': { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} })
if (values['api-url'] ?? values.api) process.env.VOYNICH_API_URL = values['api-url'] ?? values.api
if (values.rpc) process.env.SOLANA_RPC_URL = values.rpc
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
function parseStrategy(value: string | undefined): RoutingStrategy | undefined {
  if (value === undefined) return undefined
  const strategy = value.trim().toLowerCase()
  if (strategy === 'cheapest' || strategy === 'fastest' || strategy === 'balanced') return strategy
  throw new Error('--strategy must be cheapest, fastest, or balanced.')
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
  } else if (command === 'enclave' && (argument === 'quote' || (argument === 'bond' && (['deposit', 'withdraw'].includes(third ?? '') || (third === 'show' && !fourth && !values.enclave))))) {
    process.env.VOYNICH_KEYPAIR = values.keypair ?? process.env.VOYNICH_KEYPAIR ?? process.env.OPERATOR_KEYPAIR ?? await solanaCliKeypairPath()
  } else if (
    (['call', 'seal', 'grant', 'refund', 'settle'].includes(command ?? '') && !(command === 'call' && values.session))
    || (command === 'model' && ['price', 'retire', 'revoke', 'upgrade'].includes(argument ?? ''))
    || (command === 'model' && argument === 'policy' && ['set', 'clear'].includes(third ?? ''))
    || (command === 'model' && argument === 'split' && ['set', 'claim'].includes(third ?? ''))
    || (command === 'model' && argument === 'referral' && ['set', 'claim'].includes(third ?? ''))
    || (command === 'measurement' && ['publish', 'deprecate'].includes(argument ?? ''))
    || (command === 'benchmark' && argument === 'run')
    || (command === 'quorum' && argument === 'run')
    || (command === 'pass' && (['buy', 'close'].includes(argument ?? '') || (argument === 'plan' && third === 'set') || (argument === 'list' && !values.wallet)))
    || (command === 'session' && ['open', 'close'].includes(argument ?? ''))
    || (command === 'session' && argument === 'list' && !values.wallet)
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
  if (values.help || !command) { stderr.write('voynich models | enclaves | call <model> [<input.json> | --text "<prompt>"] [--max-tokens <n>] [--ceiling <base units>] [--stream] [--open] [--pass <pass-address>] [--referrer <wallet>] [--enclave <key>] [--strategy <cheapest|fastest|balanced>] | verify <receipt> | seal <weights.onnx|adapter.voya> [--manifest <manifest.json> | --model <name|address>] [--base <json-file|url>] [--base-file <local-base>] [--base-sha256 <hex64>] [--base-size <bytes>] [--base-format <onnx|safetensors|gguf>] [--state <owner.enc.json>] [--price <base units>] [--price-unit <call|token>] [--operator-share-bps <bps>] [--measurement <hex48>] [--upload-funding <lamports>] [--upload-keys <1..8>] [--enclave <key>] [--resume]\nvoynich grant <model> <enclave> [--state <owner.enc.json>] | settle <call> (--count <n> --running-hash <hex64> --signature <base64> | --from-pieces) | refund <call> | enclave register|run|status | enclave quote <model> (--share-bps <n> | --clear) [--enclave <key>] | account <wallet>\nvoynich measurement list [--status active|deprecated] | measurement show <digest> | measurement publish [--recipe <path>] [--digest <hex96>] [--recipe-hash <hex64>] --repo <source_repo> --commit <commit_sha> [--version <semver>] | measurement deprecate <digest> | measurement verify <digest> [--recipe <path>] [--source <dir>] [--rebuild]\nvoynich benchmark list [<model>] [--evaluator <pubkey>] [--min-score-bps <n>] [--name <slug>] | benchmark run <model> --suite <json-file> [--name <slug>] [--dataset-uri <uri>] [--answer-mode open|sealed] [--strategy balanced|cheapest|fastest]\nvoynich quorum list [--model <id>] | quorum show <address> | quorum run <model> --votes <2..5> --input <file> [--distinct-enclaves] [--answer-mode open|sealed]\nvoynich pass plan show <model> | pass plan set <model> --price <base units> --min-calls <n> --max-calls <n> --ttl-slots <n> [--inactive] | pass buy <model> --calls <n> | pass list [--wallet <pubkey>] | pass close <pass-address>\nvoynich model price <model> --price <base units> [--price-unit <call|token>] [--operator-share-bps <bps>] [--mint <SOL|mint address>] [--decimals <n>] [--symbol <symbol>]\nvoynich model versions <model> | model upgrade <model> <weights-file> [--owner-key <file>] [--manifest <file>] [--base <source> --base-file <file>]\nvoynich model policy show <model> | model policy set <model> [--allow-list] [--caller <pubkey> ...] [--max-calls <n>] [--window-slots <slots>] [--operator <pubkey> ...] [--region <region> ...] | model policy clear <model>\nvoynich model referral show <model> | model referral set <model> --share-bps <n> [--inactive] | model referral claim <model> [--referrer <wallet>]\nvoynich model retire <model> | model revoke <model> <enclave>\nGlobal: --api-url <url> --keypair <Solana JSON file>; VOYNICH_PASSWORD supplies a noninteractive owner-file password when --state is used. Results are JSON on stdout; prompts and progress go to stderr.\n'); return }
  await configureCliSigner()
  if (command === 'models') return voynich.models()
  if (command === 'enclaves') return voynich.enclaves()
  if (command === 'pass') {
    const action = required(argument, 'pass subcommand (plan, buy, list, or close)')
    if (action === 'plan') {
      const sub = required(third, 'pass plan subcommand (show or set)')
      const modelId = required(fourth, 'model')
      if (sub === 'show') {
        return (await voynich.getPassPlan(modelId)) ?? { passPlan: null }
      }
      if (sub === 'set') {
        const pricePerCall = required(values.price, '--price <base units>')
        const minCalls = Number(required(values['min-calls'], '--min-calls <n>'))
        const maxCalls = Number(required(values['max-calls'], '--max-calls <n>'))
        const ttlSlots = required(values['ttl-slots'], '--ttl-slots <n>')
        if (!Number.isInteger(minCalls) || minCalls < 0) throw new Error('--min-calls must be a non-negative integer.')
        if (!Number.isInteger(maxCalls) || maxCalls < 0) throw new Error('--max-calls must be a non-negative integer.')
        const signer = await loadCliKeypair()
        const client = createVoynich({
          apiUrl: process.env.VOYNICH_API_URL ?? 'http://127.0.0.1:9702',
          rpcUrl: process.env.SOLANA_RPC_URL || undefined,
          signer,
        })
        return client.setPassPlan(modelId, {
          pricePerCall,
          minCalls,
          maxCalls,
          ttlSlots,
          active: !values.inactive,
        })
      }
      throw new Error('Use pass plan show <model> or pass plan set <model> --price <lamports> --min-calls <n> --max-calls <n> --ttl-slots <n>.')
    }
    if (action === 'buy') {
      const modelId = required(third, 'model')
      const callsTotal = Number(required(values.calls, '--calls <n>'))
      if (!Number.isInteger(callsTotal) || callsTotal < 1) throw new Error('--calls must be a positive integer.')
      const signer = await loadCliKeypair()
      const client = createVoynich({
        apiUrl: process.env.VOYNICH_API_URL ?? 'http://127.0.0.1:9702',
        rpcUrl: process.env.SOLANA_RPC_URL || undefined,
        signer,
      })
      return client.buyPass(modelId, callsTotal)
    }
    if (action === 'list') {
      if (values.wallet) return voynich.listPasses(values.wallet)
      const signer = await loadCliKeypair()
      const client = createVoynich({
        apiUrl: process.env.VOYNICH_API_URL ?? 'http://127.0.0.1:9702',
        rpcUrl: process.env.SOLANA_RPC_URL || undefined,
        signer,
      })
      return client.listPasses(signer.publicKey.toBase58())
    }
    if (action === 'close') {
      const passAddress = required(third, 'pass address')
      const signer = await loadCliKeypair()
      const client = createVoynich({
        apiUrl: process.env.VOYNICH_API_URL ?? 'http://127.0.0.1:9702',
        rpcUrl: process.env.SOLANA_RPC_URL || undefined,
        signer,
      })
      return client.closePass(passAddress)
    }
    throw new Error('Use pass plan show|set, pass buy, pass list, or pass close.')
  }
  if (command === 'benchmark') {
    const action = required(argument, 'benchmark subcommand (list or run)')
    if (action === 'list') {
      const evaluator = values.evaluator?.trim() || undefined
      const name = values.name?.trim() || undefined
      let minScoreBps: number | undefined
      if (values['min-score-bps'] !== undefined) {
        minScoreBps = Number(values['min-score-bps'])
        if (!Number.isInteger(minScoreBps) || minScoreBps < 0 || minScoreBps > 10_000) {
          throw new Error('--min-score-bps must be an integer between 0 and 10000.')
        }
      }
      const query = { ...(name ? { name } : {}), limit: 100 }
      const page = third
        ? await voynich.listModelBenchmarks(third, query)
        : await voynich.listBenchmarks(query)
      const items = page.items.filter(item =>
        (evaluator === undefined || item.publisher === evaluator)
        && (minScoreBps === undefined || item.scoreBps >= minScoreBps),
      )
      return { ...page, items }
    }
    if (action === 'run') {
      const modelId = required(third, 'model')
      const suitePath = required(values.suite, '--suite <json-file>')
      const rawSuiteBytes = new Uint8Array(await readFile(suitePath))
      const datasetSha256 = toHex(sha256(rawSuiteBytes))
      const parsed = JSON.parse(new TextDecoder().decode(rawSuiteBytes)) as {
        name?: unknown
        datasetUri?: unknown
        cases?: unknown
      }
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.cases)) {
        throw new Error('Suite JSON must contain a cases array.')
      }
      if (parsed.cases.length < 1 || parsed.cases.length > 16) {
        throw new Error('Suite cases must contain between 1 and 16 test cases.')
      }
      const name = (values.name ?? (typeof parsed.name === 'string' ? parsed.name : undefined))?.trim()
      if (!name || Buffer.byteLength(name, 'utf8') > 32) {
        throw new Error('Benchmark name must be 1..32 UTF-8 bytes (set in suite JSON or via --name).')
      }
      const datasetUri = (values['dataset-uri'] ?? (typeof parsed.datasetUri === 'string' ? parsed.datasetUri : undefined))?.trim()
      if (!datasetUri || Buffer.byteLength(datasetUri, 'utf8') > 160) {
        throw new Error('Benchmark datasetUri must be 1..160 UTF-8 bytes (set in suite JSON or via --dataset-uri).')
      }
      let answerMode: AnswerMode = 'sealed'
      if (values['answer-mode'] !== undefined) {
        const norm = values['answer-mode'].trim().toLowerCase()
        if (norm !== 'open' && norm !== 'sealed') throw new Error('--answer-mode must be open or sealed.')
        answerMode = norm
      }
      const strategy = parseStrategy(values.strategy)
      type SuiteCase = { input: SketchInput | number[] | string; expectedLabel?: string; expectedContains?: string }
      const cases: SuiteCase[] = parsed.cases.map((entry, idx) => {
        if (!entry || typeof entry !== 'object') throw new Error(`Suite case #${idx + 1} must be an object.`)
        const item = entry as Record<string, unknown>
        if (item.input === undefined) throw new Error(`Suite case #${idx + 1} is missing input.`)
        const expectedLabel = typeof item.expectedLabel === 'string' ? item.expectedLabel : undefined
        const expectedContains = typeof item.expectedContains === 'string' ? item.expectedContains : undefined
        if (expectedLabel === undefined && expectedContains === undefined) {
          throw new Error(`Suite case #${idx + 1} must specify expectedLabel or expectedContains.`)
        }
        return { input: item.input as SketchInput | number[] | string, expectedLabel, expectedContains }
      })

      const signer = await loadCliKeypair()
      const client = createVoynich({
        apiUrl: process.env.VOYNICH_API_URL ?? 'http://127.0.0.1:9702',
        rpcUrl: process.env.SOLANA_RPC_URL || undefined,
        signer,
      })

      const receipts: string[] = []
      const caseResults: {
        index: number
        passed: boolean
        expectedLabel?: string
        expectedContains?: string
        actualLabel?: string
        actualText?: string
        receipt: string
        call: string
      }[] = []
      let passedCount = 0

      for (let i = 0; i < cases.length; i++) {
        const testCase = cases[i]!
        stderr.write(`benchmark: case ${i + 1}/${cases.length} calling ${modelId}...\n`)
        const res = await client.call(modelId, testCase.input, {
          answerMode,
          ...(strategy ? { strategy } : {}),
          ...(values.enclave ? { enclave: values.enclave } : {}),
        })
        const actualLabel = 'label' in res.output ? res.output.label : undefined
        const actualText = 'text' in res.output ? res.output.text : undefined
        const labelOk = testCase.expectedLabel === undefined ? true : actualLabel === testCase.expectedLabel
        const textOk = testCase.expectedContains === undefined ? true : (typeof actualText === 'string' && actualText.includes(testCase.expectedContains))
        const passed = labelOk && textOk
        if (passed) passedCount++
        receipts.push(res.receipt.address)
        caseResults.push({
          index: i,
          passed,
          ...(testCase.expectedLabel !== undefined ? { expectedLabel: testCase.expectedLabel } : {}),
          ...(testCase.expectedContains !== undefined ? { expectedContains: testCase.expectedContains } : {}),
          ...(actualLabel !== undefined ? { actualLabel } : {}),
          ...(actualText !== undefined ? { actualText } : {}),
          receipt: res.receipt.address,
          call: res.receipt.call,
        })
        stderr.write(`benchmark: case ${i + 1}/${cases.length} ${passed ? 'PASS' : 'FAIL'} (receipt ${res.receipt.address})\n`)
      }

      const sampleCount = cases.length
      const scoreBps = Math.floor((passedCount * 10_000) / sampleCount)
      stderr.write(`benchmark: publishing ${name} (${passedCount}/${sampleCount}, ${scoreBps} bps)...\n`)
      const benchmark = await client.publishBenchmark(modelId, {
        name,
        datasetSha256,
        datasetUri,
        sampleCount,
        passedCount,
        scoreBps,
        receipts,
      })
      return {
        benchmark,
        scoreBps,
        passedCount,
        sampleCount,
        datasetSha256,
        results: caseResults,
      }
    }
    throw new Error('Use benchmark list [<model>] or benchmark run <model> --suite <json-file>.')
  }
  if (command === 'quorum') {
    const action = required(argument, 'quorum subcommand (list, show, or run)')
    if (action === 'list') {
      const modelFilter = values.model ?? third
      if (modelFilter) return voynich.listModelQuorums(modelFilter)
      return voynich.listQuorums()
    }
    if (action === 'show') {
      return voynich.quorum(required(third, 'quorum PDA address'))
    }
    if (action === 'run') {
      const modelId = required(third, 'model')
      const votes = Number(required(values.votes, '--votes <2..5>'))
      if (!Number.isSafeInteger(votes) || votes < 2 || votes > 5) {
        throw new Error('--votes must be an integer between 2 and 5.')
      }
      const inputPath = required(values.input ?? fourth, '--input <file>')
      const rawInputText = await readFile(inputPath, 'utf8')
      let parsedInput: unknown
      try { parsedInput = JSON.parse(rawInputText) } catch { parsedInput = rawInputText.trim() }
      const rawMode = (values['answer-mode'] ?? (values.open ? 'open' : 'open')).trim().toLowerCase()
      if (rawMode !== 'open' && rawMode !== 'sealed') throw new Error('--answer-mode must be open or sealed.')
      const answerMode: AnswerMode = rawMode
      const requireDistinctEnclaves = Boolean(values['distinct-enclaves'])
      const strategy = parseStrategy(values.strategy)
      const maxTokens = values['max-tokens'] !== undefined ? Number(values['max-tokens']) : undefined
      const signer = await loadCliKeypair()
      const client = createVoynich({
        apiUrl: process.env.VOYNICH_API_URL ?? 'http://127.0.0.1:9702',
        rpcUrl: process.env.SOLANA_RPC_URL || undefined,
        signer,
      })
      stderr.write(`quorum: running ${votes} ${requireDistinctEnclaves ? 'distinct-enclave ' : ''}vote(s) on ${modelId} (${answerMode} mode)...\n`)
      const res = await client.runQuorum(modelId, parsedInput as string | number[] | SketchInput, {
        votes,
        requireDistinctEnclaves,
        answerMode,
        ...(values.enclave ? { enclave: values.enclave } : {}),
        ...(strategy ? { strategy } : {}),
        ...(maxTokens !== undefined ? { maxTokens } : {}),
        ...(values.ceiling !== undefined ? { ceiling: values.ceiling } : {}),
      })
      const quorumLink = `https://voynich.dev/quorums/${res.quorum.address}`
      const receiptLinks = res.quorum.receipts.map(addr => `https://voynich.dev/receipts/${addr}`)
      stderr.write(`quorum: ${res.quorum.status} (${res.quorum.voteCount}/${res.quorum.requiredVotes} votes, ${res.quorum.distinctEnclaves} enclave(s)) -> ${quorumLink}\n`)
      return {
        quorum: res.quorum,
        agreedOutputHash: res.quorum.agreedOutputHash,
        voteCount: res.quorum.voteCount,
        requiredVotes: res.quorum.requiredVotes,
        distinctEnclaves: res.quorum.distinctEnclaves,
        quorumLink,
        receiptLinks,
        output: res.output,
        transaction: res.transaction.signature ?? null,
      }
    }
    throw new Error('Use quorum list [--model <id>], quorum show <address>, or quorum run <model> --votes <2..5> --input <file> [--distinct-enclaves] [--answer-mode open|sealed].')
  }
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
      const client = createVoynich({
        apiUrl: process.env.VOYNICH_API_URL ?? 'http://127.0.0.1:9702',
        rpcUrl: process.env.SOLANA_RPC_URL || undefined,
        signer,
      })
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
          const connection = new Connection(process.env.SOLANA_RPC_URL || config.rpcUrl, 'confirmed')
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
  if (command === 'session') {
    if (argument === 'open') {
      const budget = required(values.budget, '--budget')
      const delegate = Keypair.generate()
      let delegateKeypair: string | undefined
      if (values['delegate-out']) {
        delegateKeypair = resolve(values['delegate-out'])
        await writeFile(delegateKeypair, JSON.stringify([...delegate.secretKey]), { mode: 0o600 })
      }
      const opened = await voynich.openSession({
        budget,
        delegate,
        ...(values.model ? { model: values.model } : {}),
        ...(values['ttl-slots'] ? { durationSlots: values['ttl-slots'] } : {}),
        ...(values['delegate-gas'] ? { delegateGasLamports: values['delegate-gas'] } : {}),
        ...(values.mint ? { mint: parseMint(values.mint, null) } : {}),
      })
      return {
        address: opened.address,
        delegate: opened.delegate.publicKey.toBase58(),
        ...(delegateKeypair ? { delegateKeypair } : {}),
        session: opened.session,
      }
    }
    if (argument === 'list') {
      const wallet = values.wallet ?? (await loadCliKeypair()).publicKey.toBase58()
      return voynich.listSessions(wallet)
    }
    if (argument === 'close') {
      const res = await voynich.closeSession(required(third, 'session address'))
      return {
        session: res.session,
        transaction: res.transaction.signature ?? null,
      }
    }
    throw new Error('Use session open --budget <units>, session list, or session close <session-address>.')
  }
  if (command === 'call') {
    const strategy = parseStrategy(values.strategy)
    const maxTokens = values['max-tokens'] !== undefined ? Number(values['max-tokens']) : undefined
    if (maxTokens !== undefined && (!Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > 4096)) {
      throw new Error('--max-tokens must be an integer between 1 and 4096.')
    }
    let sessionAuth: { address: string; delegate: Keypair } | undefined
    if (values.session) {
      const delegatePath = required(values.delegate, '--delegate <keypair-file> when using --session')
      const raw = JSON.parse(await readFile(delegatePath, 'utf8')) as unknown
      if (!Array.isArray(raw) || raw.length !== 64 || !raw.every(b => Number.isInteger(b) && b >= 0 && b <= 255)) {
        throw new Error('--delegate must name a readable 64-byte Solana JSON keypair file.')
      }
      sessionAuth = { address: values.session, delegate: Keypair.fromSecretKey(Uint8Array.from(raw)) }
    }
    if (values.stream) {
      const prompt = required(values.text, '--text for --stream')
      const active = await voynich.stream(required(argument, 'model'), prompt, {
        ...(values.ceiling ? { ceiling: values.ceiling } : {}),
        ...(values.enclave ? { enclave: values.enclave } : {}),
        ...(strategy ? { strategy } : {}),
        ...(maxTokens !== undefined ? { maxTokens } : {}),
        ...(sessionAuth ? { session: sessionAuth } : {}),
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
      ...(strategy ? { strategy } : {}),
      ...(maxTokens !== undefined ? { maxTokens } : {}),
      ...(values.ceiling !== undefined ? { ceiling: values.ceiling } : {}),
      ...(sessionAuth ? { session: sessionAuth } : {}),
      ...(values.pass ? { pass: values.pass } : {}),
      ...(values.referrer ? { referrer: values.referrer } : {}),
    })
  }
  if (command === 'enclave') {
    if (argument === 'quote') {
      const modelId = required(third, 'model')
      const clearQuote = Boolean(values.clear)
      const shareRaw = values['share-bps']
      if (clearQuote && shareRaw !== undefined) {
        throw new Error('Pass either --share-bps <n> or --clear, not both.')
      }
      if (!clearQuote && shareRaw === undefined) {
        throw new Error('Supply --share-bps <0..10000> or --clear.')
      }
      let operatorShareBps: number | null = null
      if (!clearQuote) {
        const parsed = Number(shareRaw)
        if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 10000) {
          throw new Error('--share-bps must be an integer between 0 and 10000.')
        }
        operatorShareBps = parsed
      }
      const signer = await loadCliKeypair()
      const client = createVoynich({
        apiUrl: process.env.VOYNICH_API_URL ?? 'http://127.0.0.1:9702',
        rpcUrl: process.env.SOLANA_RPC_URL || undefined,
        signer,
      })
      let enclaveKey = values.enclave
      if (!enclaveKey) {
        const page = await client.enclaves({ limit: 100 })
        const owned = page.items.filter(item => item.operator === signer.publicKey.toBase58())
        if (owned.length === 1) {
          enclaveKey = owned[0]!.address
        } else if (owned.length === 0) {
          throw new Error('No enclave found for this operator keypair. Pass --enclave <key>.')
        } else {
          throw new Error('Multiple enclaves found for this operator keypair. Pass --enclave <key>.')
        }
      }
      const tx = await client.setQuote(enclaveKey, modelId, operatorShareBps)
      return {
        enclave: enclaveKey,
        model: modelId,
        operatorShareBps,
        transaction: tx.signature ?? null,
        status: tx.status,
      }
    }
    if (argument === 'bond') {
      const action = required(third, 'bond subcommand (show, deposit, or withdraw)')
      const resolveOperatorEnclave = async (client: ReturnType<typeof createVoynich>, explicit?: string) => {
        if (explicit) return explicit
        const signer = await loadCliKeypair()
        const page = await client.enclaves({ limit: 100 })
        const owned = page.items.filter(item => item.operator === signer.publicKey.toBase58())
        if (owned.length === 1) return owned[0]!.address
        if (owned.length === 0) throw new Error('No enclave found for this operator keypair. Pass --enclave <key>.')
        throw new Error('Multiple enclaves found for this operator keypair. Pass --enclave <key>.')
      }
      if (action === 'show') {
        const explicit = fourth ?? values.enclave
        if (explicit) {
          const bond = await voynich.getBond(explicit)
          return bond ?? { enclave: explicit, bond: null }
        }
        const signer = await loadCliKeypair()
        const client = createVoynich({
          apiUrl: process.env.VOYNICH_API_URL ?? 'http://127.0.0.1:9702',
          rpcUrl: process.env.SOLANA_RPC_URL || undefined,
          signer,
        })
        const enclaveKey = await resolveOperatorEnclave(client)
        const bond = await client.getBond(enclaveKey)
        return bond ?? { enclave: enclaveKey, bond: null }
      }
      if (action === 'deposit' || action === 'withdraw') {
        const amountStr = required(fourth, 'lamports').trim()
        if (!/^\d+$/.test(amountStr) || BigInt(amountStr) <= 0n) {
          throw new Error('Bond amount must be a positive integer number of lamports.')
        }
        const signer = await loadCliKeypair()
        const client = createVoynich({
          apiUrl: process.env.VOYNICH_API_URL ?? 'http://127.0.0.1:9702',
          rpcUrl: process.env.SOLANA_RPC_URL || undefined,
          signer,
        })
        const enclaveKey = await resolveOperatorEnclave(client, values.enclave)
        return action === 'deposit'
          ? await client.depositBond(enclaveKey, amountStr)
          : await client.withdrawBond(enclaveKey, amountStr)
      }
      throw new Error('Use enclave bond show [<enclave>], enclave bond deposit <lamports>, or enclave bond withdraw <lamports>.')
    }
    return enclaveCommand(argument)
  }
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
        const client = createVoynich({
        apiUrl: process.env.VOYNICH_API_URL ?? 'http://127.0.0.1:9702',
        rpcUrl: process.env.SOLANA_RPC_URL || undefined,
        signer,
      })
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
    if (argument === 'split') {
      const action = required(third, 'split subcommand (show, set, or claim)')
      const modelId = required(fourth, 'model')
      if (action === 'show') {
        const split = await voynich.getSplit(modelId)
        return split ?? { model: modelId, split: null }
      }
      if (action === 'set') {
        const rawRecipients = values.recipient ?? []
        if (values.clear && rawRecipients.length > 0) {
          throw new Error('Pass either --clear or --recipient <wallet:bps>, not both.')
        }
        const recipients = values.clear
          ? []
          : rawRecipients.map(item => {
              const idx = item.lastIndexOf(':')
              if (idx <= 0 || idx === item.length - 1) {
                throw new Error(`Invalid --recipient "${item}". Expected <wallet:bps>.`)
              }
              const wallet = item.slice(0, idx).trim()
              const bpsStr = item.slice(idx + 1).trim()
              const shareBps = Number(bpsStr)
              if (!Number.isSafeInteger(shareBps) || shareBps < 1 || shareBps > 10000) {
                throw new Error(`Invalid share bps "${bpsStr}" for ${wallet}. Must be an integer between 1 and 10000.`)
              }
              return { wallet, shareBps }
            })
        if (!values.clear && recipients.length === 0) {
          throw new Error('Supply one or more --recipient <wallet:bps> entries summing to 10000, or pass --clear.')
        }
        if (recipients.length > 0) {
          const totalBps = recipients.reduce((sum, r) => sum + r.shareBps, 0)
          if (totalBps !== 10000) {
            throw new Error(`Split recipient shares must sum to 10000 bps (got ${totalBps}).`)
          }
        }
        const signer = await loadCliKeypair()
        const client = createVoynich({
          apiUrl: process.env.VOYNICH_API_URL ?? 'http://127.0.0.1:9702',
          rpcUrl: process.env.SOLANA_RPC_URL || undefined,
          signer,
        })
        const split = await client.setSplit(modelId, recipients)
        return split
      }
      if (action === 'claim') {
        const rawRecipients = values.recipient ?? []
        if (rawRecipients.length > 1) {
          throw new Error('Pass at most one --recipient <wallet> to model split claim.')
        }
        const signer = await loadCliKeypair()
        const client = createVoynich({
          apiUrl: process.env.VOYNICH_API_URL ?? 'http://127.0.0.1:9702',
          rpcUrl: process.env.SOLANA_RPC_URL || undefined,
          signer,
        })
        const target = rawRecipients[0]?.trim() || undefined
        const split = await client.claimSplit(modelId, target)
        return split
      }
      throw new Error('Use model split show <model>, model split set <model>, or model split claim <model>.')
    }
    if (argument === 'referral') {
      const action = required(third, 'referral subcommand (show, set, or claim)')
      const modelId = required(fourth, 'model')
      if (action === 'show') {
        const cfg = await voynich.getReferralConfig(modelId)
        return cfg ?? { model: modelId, referralConfig: null }
      }
      if (action === 'set') {
        const shareBps = values.inactive && values['share-bps'] === undefined
          ? 0
          : Number(required(values['share-bps'], '--share-bps <0..2500>'))
        if (!Number.isSafeInteger(shareBps) || shareBps < 0 || shareBps > 2500) {
          throw new Error('--share-bps must be an integer between 0 and 2500.')
        }
        const signer = await loadCliKeypair()
        const client = createVoynich({
          apiUrl: process.env.VOYNICH_API_URL ?? 'http://127.0.0.1:9702',
          rpcUrl: process.env.SOLANA_RPC_URL || undefined,
          signer,
        })
        return client.setReferralConfig(modelId, { shareBps, active: !values.inactive })
      }
      if (action === 'claim') {
        const signer = await loadCliKeypair()
        const client = createVoynich({
          apiUrl: process.env.VOYNICH_API_URL ?? 'http://127.0.0.1:9702',
          rpcUrl: process.env.SOLANA_RPC_URL || undefined,
          signer,
        })
        const target = values.referrer?.trim() || undefined
        return client.claimReferral(modelId, target)
      }
      throw new Error('Use model referral show <model>, model referral set <model> --share-bps <n> [--inactive], or model referral claim <model> [--referrer <wallet>].')
    }
    const modelId = required(third, 'model')
    if (argument === 'versions') return voynich.listVersions(modelId)
    if (argument === 'upgrade') {
      const weightsPath = required(fourth, 'weights file')
      const weights = new Uint8Array(await readFile(weightsPath))
      const existingModel = await voynich.model(modelId)
      const manifest = values.manifest ? decodeManifest(await readFile(values.manifest, 'utf8')) : undefined
      let modelKey: Uint8Array | undefined
      const ownerKeyPath = values['owner-key'] ?? values.state
      if (ownerKeyPath) {
        const raw = (await readFile(ownerKeyPath, 'utf8')).trim()
        if (/^[0-9a-fA-F]{64}$/.test(raw)) {
          modelKey = fromHex(raw)
        } else {
          const parsed = JSON.parse(raw) as unknown
          if (Array.isArray(parsed) && parsed.length === 32 && parsed.every(v => Number.isInteger(v) && v >= 0 && v <= 255)) {
            modelKey = Uint8Array.from(parsed)
          } else {
            const loaded = await loadOwnerFile(ownerKeyPath, await password())
            if (loaded.model !== existingModel.address) throw new Error('The owner key file belongs to another model')
            modelKey = loaded.modelKey
          }
        }
      }
      const hasBaseFlags = Boolean(values.base || values['base-file'] || values['base-sha256'] || values['base-size'] || values['base-format'])
      const base = hasBaseFlags
        ? await resolveCliSealBase({
            flags: {
              base: values.base,
              baseFile: values['base-file'],
              baseSha256: values['base-sha256'],
              baseSize: values['base-size'],
              baseFormat: values['base-format'],
            },
            weights,
            existingBase: existingModel.base ?? null,
          })
        : undefined
      const res = await voynich.publishVersion(modelId, {
        weights,
        ...(manifest ? { manifest } : {}),
        ...(base ? { base } : {}),
        ...(modelKey ? { modelKey } : {}),
      })
      return {
        model: res.model.address,
        name: res.model.name,
        version: res.version,
        ciphertextSha256: res.ciphertextSha256,
        noncePrefix: res.noncePrefix,
        transactionsSent: res.transactionsSent,
      }
    }
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
    throw new Error('Use model price, model policy, model versions, model upgrade, model retire, or model revoke.')
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
