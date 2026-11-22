import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, version as esbuildVersion } from 'esbuild'

export const ENCLAVE_DIR = dirname(fileURLToPath(import.meta.url))
export const BACKEND_DIR = dirname(ENCLAVE_DIR)

export const RECIPE_INPUTS = [
  'enclave/Dockerfile',
  'enclave/build.mjs',
  'enclave/package.json',
  'package-lock.json',
]

const BANNER_JS = "import { createRequire as __createRequire } from 'node:module'; import { fileURLToPath as __fileURLToPath } from 'node:url'; import { dirname as __pathDirname } from 'node:path'; const require = __createRequire(import.meta.url); const __filename = __fileURLToPath(import.meta.url); const __dirname = __pathDirname(__filename);"

export function normalizeLf(text) {
  return text.replace(/\r\n/g, '\n')
}

export function sha256Lf(text) {
  return createHash('sha256').update(Buffer.from(normalizeLf(text), 'utf8')).digest('hex')
}

export function computeRecipeHash(backendDir = BACKEND_DIR, overrides = {}) {
  const lines = ['voynich/enclave-recipe/v1']
  for (const rel of RECIPE_INPUTS) {
    const content = Object.prototype.hasOwnProperty.call(overrides, rel)
      ? overrides[rel]
      : readFileSync(resolve(backendDir, rel), 'utf8')
    lines.push(`${rel}:${sha256Lf(content)}`)
  }
  return createHash('sha256').update(Buffer.from(`${lines.join('\n')}\n`, 'utf8')).digest('hex')
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function findHostPaths(source, extraForbidden = []) {
  const hits = []
  const winDrive = source.match(/(?<![A-Za-z0-9_])[A-Za-z]:(?:\\|\/(?!\/))[^\s"'`<>]+/g) || []
  const unixHome = source.match(/(?<![A-Za-z0-9_.:\/])\/(?:Users|home)\/[A-Za-z0-9._-]+/g) || []
  for (const m of winDrive) hits.push(m)
  for (const m of unixHome) hits.push(m)
  const candidates = [homedir(), ENCLAVE_DIR, BACKEND_DIR, ...extraForbidden].filter(Boolean)
  for (const raw of candidates) {
    const trimmed = raw.replace(/[\\/]+$/, '')
    if (trimmed.length < 4) continue
    const variants = new Set([trimmed, trimmed.replace(/\\/g, '/'), trimmed.replace(/\//g, '\\')])
    const singleSegmentUnix = /^\/[^/\\]+$/.test(trimmed.replace(/\\/g, '/'))
    for (const v of variants) {
      const escaped = escapeRegex(v)
      const pattern = singleSegmentUnix
        ? new RegExp(`(?<![A-Za-z0-9_.:/\\\\])${escaped}[/\\\\][^\\s"'\`<>]+`)
        : new RegExp(`(?<![A-Za-z0-9_.:/\\\\])${escaped}(?=$|[/\\\\"'\`\\s<>:,;)])`)
      if (pattern.test(source)) hits.push(v)
    }
  }
  return [...new Set(hits)]
}

export function assertNoHostPaths(source, extraForbidden = []) {
  const hits = findHostPaths(source, extraForbidden)
  if (hits.length > 0) {
    throw new Error(`Host-specific path(s) found in enclave bundle: ${hits.slice(0, 5).join(', ')}`)
  }
}

export async function buildEnclave(options = {}) {
  const enclaveDir = options.enclaveDir ?? ENCLAVE_DIR
  const backendDir = options.backendDir ?? dirname(enclaveDir)
  const outDir = options.outDir ?? resolve(enclaveDir, 'dist')
  const runtimeOut = resolve(outDir, 'runtime.js')
  const recipeOut = resolve(outDir, 'recipe.json')

  const result = await build({
    absWorkingDir: enclaveDir,
    entryPoints: ['src/runtime.ts'],
    outfile: 'dist/runtime.js',
    write: false,
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    charset: 'utf8',
    external: ['onnxruntime-node'],
    banner: { js: BANNER_JS },
    sourcemap: false,
    legalComments: 'none',
  })

  if (!result.outputFiles || result.outputFiles.length !== 1) {
    throw new Error(`Expected 1 esbuild output file, received ${result.outputFiles?.length ?? 0}`)
  }

  const normalized = normalizeLf(result.outputFiles[0].text)
  assertNoHostPaths(normalized)

  const runtimeBuffer = Buffer.from(normalized, 'utf8')
  const measurement = createHash('sha384').update(runtimeBuffer).digest('hex')
  const pkg = JSON.parse(readFileSync(resolve(enclaveDir, 'package.json'), 'utf8'))
  const lockfileSha256 = sha256Lf(readFileSync(resolve(backendDir, 'package-lock.json'), 'utf8'))
  const recipeHash = computeRecipeHash(backendDir)

  const recipe = {
    version: pkg.version,
    nodeVersion: process.version,
    esbuildVersion,
    lockfileSha256,
    runtimeBytes: runtimeBuffer.length,
    measurement,
    recipeHash,
  }

  mkdirSync(outDir, { recursive: true })
  writeFileSync(runtimeOut, runtimeBuffer)
  writeFileSync(recipeOut, Buffer.from(`${JSON.stringify(recipe, null, 2)}\n`, 'utf8'))

  return { runtimeOut, recipeOut, runtimeBuffer, recipe }
}

function isDirectEntry() {
  if (!process.argv[1]) return false
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])
  } catch {
    return fileURLToPath(import.meta.url) === resolve(process.argv[1])
  }
}

if (isDirectEntry()) {
  await buildEnclave()
}
