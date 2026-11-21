import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { resolve } from 'node:path'

const port = Number(process.env.LOCAL_BASE_PORT ?? '9749')
const filePath = resolve(process.env.LOCAL_BASE_FILE ?? 'models/text-1m/text-1m-base.onnx')
const bytes = readFileSync(filePath)

const server = createServer((req, res) => {
  if (req.url === '/text-1m-base.onnx' || req.url === '/base.onnx') {
    res.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': String(bytes.length),
    })
    res.end(bytes)
    return
  }
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ status: 'ready', bytes: bytes.length }))
    return
  }
  res.writeHead(404)
  res.end('not found')
})

server.listen(port, '127.0.0.1', () => {
  console.log(JSON.stringify({ event: 'local_base.ready', url: `http://127.0.0.1:${port}/text-1m-base.onnx`, bytes: bytes.length }))
})
