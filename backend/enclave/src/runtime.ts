import http from 'node:http'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export function computeSelfMeasurement(): string {
  const selfPath = fileURLToPath(import.meta.url)
  return createHash('sha384').update(readFileSync(selfPath)).digest('hex')
}

export function startEnclaveServer(port = Number(process.env.PORT || process.env.ENCLAVE_PORT || 9707)) {
  const measurement = computeSelfMeasurement()
  return http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ status: 'ready', measurement, models: [] }))
      return
    }
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'NOT_FOUND' }))
  }).listen(port, process.env.ENCLAVE_HOST || '127.0.0.1')
}

if (process.argv.includes('--measurement')) {
  console.log(computeSelfMeasurement())
} else if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startEnclaveServer()
}
