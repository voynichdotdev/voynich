// Starts one role of the backend: applies migrations, then runs the role, forwarding signals so the
// role's own graceful shutdown runs. `"start": "node scripts/start-service.mjs api"`, one script per
// Railway service; the port comes from the PORT variable, never from here.
//
// prisma generate runs at build; migrate deploy runs here, at start, because Railway's build phase
// can't reach the internal network the database lives on.

import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const roles = { api: 'dist/server.js', worker: 'dist/worker.js' }
const role = process.argv[2]
if (!Object.hasOwn(roles, role)) throw new Error(`Usage: start-service.mjs <${Object.keys(roles).join('|')}>`)

try {
  process.loadEnvFile(path.join(root, '.env'))
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
}

// Prisma's CLI through node itself, not the npm shim: no extra shell between the signal and the
// process. On Windows Prisma caches engines under %APPDATA%; keep that inside the service folder.
const env = process.platform === 'win32' ? { ...process.env, APPDATA: path.join(root, 'node_modules/.cache') } : process.env

let current = null
let stopping = false
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopping = true
    current?.kill(signal)
  })
}

function run(script, args) {
  return new Promise((resolve, reject) => {
    current = spawn(process.execPath, [path.join(root, script), ...args], { cwd: root, env, stdio: 'inherit', windowsHide: true })
    current.once('error', reject)
    current.once('exit', (code) => resolve(code ?? 1))
  })
}

const migrated = await run('node_modules/prisma/build/index.js', ['migrate', 'deploy'])
process.exitCode = migrated !== 0 || stopping ? migrated : await run(roles[role], [])
