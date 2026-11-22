import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { assertNoHostPaths, BACKEND_DIR, buildEnclave, ENCLAVE_DIR } from './build.mjs'

async function main() {
  const scratch = mkdtempSync(join(tmpdir(), 'voynich-enclave-verify-'))
  const outA = join(scratch, 'build-a')
  const outB = join(scratch, 'build-b')
  const prevCwd = process.cwd()

  try {
    // Pass 1: clean build from enclave/ working directory
    process.chdir(ENCLAVE_DIR)
    const first = await buildEnclave({ outDir: outA })

    // Pass 2: clean build from backend/ working directory into dist/
    process.chdir(BACKEND_DIR)
    const distDir = resolve(ENCLAVE_DIR, 'dist')
    rmSync(distDir, { recursive: true, force: true })
    const second = await buildEnclave({ outDir: distDir })

    // Pass 3: confirm isolated directory matches dist/ too
    const third = await buildEnclave({ outDir: outB })

    if (!first.runtimeBuffer.equals(second.runtimeBuffer) || !second.runtimeBuffer.equals(third.runtimeBuffer)) {
      throw new Error('Enclave build is not reproducible: runtime.js bytes differ across clean builds')
    }

    const runtimeText = second.runtimeBuffer.toString('utf8')
    if (runtimeText.includes('\r\n')) {
      throw new Error('Enclave bundle contains CRLF line endings')
    }
    assertNoHostPaths(runtimeText)

    if (first.recipe.measurement !== second.recipe.measurement || second.recipe.measurement !== third.recipe.measurement) {
      throw new Error('Enclave measurement mismatch across clean builds')
    }
    if (first.recipe.recipeHash !== second.recipe.recipeHash || second.recipe.recipeHash !== third.recipe.recipeHash) {
      throw new Error('Enclave recipeHash mismatch across clean builds')
    }

    const recipeA = readFileSync(first.recipeOut, 'utf8')
    const recipeB = readFileSync(second.recipeOut, 'utf8')
    if (recipeA !== recipeB) {
      throw new Error('Enclave recipe.json differs across clean builds')
    }

    const cliMeasurement = execFileSync(process.execPath, [second.runtimeOut, '--measurement'], {
      cwd: BACKEND_DIR,
      encoding: 'utf8',
    }).trim()

    if (cliMeasurement !== second.recipe.measurement) {
      throw new Error(`CLI --measurement (${cliMeasurement}) does not match recipe.json (${second.recipe.measurement})`)
    }

    console.log(JSON.stringify({
      reproducible: true,
      measurement: second.recipe.measurement,
      recipeHash: second.recipe.recipeHash,
      bytes: second.recipe.runtimeBytes,
    }))
  } finally {
    process.chdir(prevCwd)
    rmSync(scratch, { recursive: true, force: true })
  }
}

await main()
