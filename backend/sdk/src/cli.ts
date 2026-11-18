#!/usr/bin/env node
import { createClient } from '@voynich/contract'

async function main() {
  const [command] = process.argv.slice(2)
  const api = createClient(process.env.VOYNICH_API_URL ?? 'http://127.0.0.1:9702')
  if (command === 'models') {
    const models = await api.models()
    console.log(JSON.stringify(models, null, 2))
    return
  }
  console.error('Usage: voynich <models|call|verify|seal|grant|refund|enclave>')
  process.exitCode = 1
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
