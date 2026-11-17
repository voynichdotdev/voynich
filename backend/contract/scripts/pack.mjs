import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const contract = fileURLToPath(new URL('..', import.meta.url))
const vendor = fileURLToPath(new URL('../../vendor-out', import.meta.url))
const packagePath = new URL('../package.json', import.meta.url)
const schemaPath = new URL('../src/schemas.ts', import.meta.url)
const pkg = JSON.parse(readFileSync(packagePath, 'utf8'))
mkdirSync(vendor, { recursive: true })
// Every generated tarball has a distinct version, including when an old output was removed.
const marker = new URL('../.last-packed-version', import.meta.url)
const versions = readdirSync(vendor).filter((name) => /^voynich-contract-\d+\.\d+\.\d+\.tgz$/.test(name)).map((name) => name.slice(17, -4))
if (existsSync(marker)) versions.push(readFileSync(marker, 'utf8').trim())
if (versions.includes(pkg.version)) {
  const [major, minor, patch] = pkg.version.split('.').map(Number)
  pkg.version = `${major}.${minor}.${patch + 1}`
  writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n')
  writeFileSync(schemaPath, readFileSync(schemaPath, 'utf8').replace(/export const CONTRACT_VERSION = '[^']*'/, `export const CONTRACT_VERSION = '${pkg.version}'`))
}
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
function run(args) {
  const result = spawnSync(npm, args, { cwd: contract, stdio: 'inherit', shell: process.platform === 'win32' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
run(['run', 'build'])
run(['pack', '--pack-destination', vendor])
writeFileSync(marker, pkg.version + '\n')
