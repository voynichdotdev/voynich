// Localnet only: hands the browser the tester keys the local stack funds, so a person can sign without an extension.
// Answers 404 on every other cluster.
import fs from 'node:fs'
import path from 'node:path'
import { CLUSTER } from '@/lib/env'

export const dynamic = 'force-dynamic'

// A fixed tester seed for local runs when the stack names none. It holds nothing anywhere else.
const LOCAL_SEED = Array.from({ length: 32 }, (_, i) => (i * 37 + 11) & 0xff)

function keyFile(name: string): number[] | null {
  try {
    const dir = process.env.DEV_KEYS_DIR ?? path.join(/*turbopackIgnore: true*/ process.cwd(), '..', 'dev', 'keys')
    const bytes = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) as number[]
    return Array.isArray(bytes) && (bytes.length === 64 || bytes.length === 32) ? bytes : null
  } catch { return null }
}

export function GET() {
  if (CLUSTER !== 'localnet') return new Response(null, { status: 404 })
  const wallets: { name: string; secretKey: number[] }[] = []
  const env = process.env.DEV_WALLET_SECRET_KEY
  if (env) {
    try { wallets.push({ name: 'Local wallet', secretKey: JSON.parse(env) as number[] }) } catch {}
  }
  if (!wallets.length) {
    const caller = keyFile('caller.json')
    wallets.push({ name: 'Local wallet', secretKey: caller ?? LOCAL_SEED })
  }
  const owner = keyFile('owner.json')
  if (owner) wallets.push({ name: 'Local owner', secretKey: owner })
  return Response.json({ wallets })
}
