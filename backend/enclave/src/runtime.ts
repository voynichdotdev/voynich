import http from 'node:http'

const port = Number(process.env.PORT || process.env.ENCLAVE_PORT || 9707)
const host = process.env.ENCLAVE_HOST || '127.0.0.1'

http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ status: 'waiting' }))
    return
  }
  res.writeHead(404, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ error: 'NOT_FOUND' }))
}).listen(port, host)
