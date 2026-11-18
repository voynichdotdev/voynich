import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
// Keep Prisma's Windows engine cache in this package, inside the writable workspace.
const env = process.platform === 'win32' ? { ...process.env, APPDATA: fileURLToPath(new URL('../node_modules/.cache/', import.meta.url)) } : process.env
execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'generate'], { cwd: root, env, stdio: 'inherit', windowsHide: true })
