import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { z } from 'zod'
import { PublicKey } from '@solana/web3.js'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { streamSSE } from 'hono/streaming'
import * as s from '@voynich/contract'
import { fromBase64, toBase64, sha256, toHex } from 'voynich/crypto'
import { createApi } from '../engines/server/app.js'
import { ApiFailure, redact, toFailure } from '../engines/server/errors.js'
import { readJson, readParam, readQuery } from '../engines/server/input.js'
import { writeLimit } from '../engines/server/limits.js'
import { requireReady } from '../engines/server/readiness.js'
import { streamEvents, streamEvent } from '../engines/server/sse.js'
import { rpcRelay, RELAY_HEADERS } from '../engines/rpc/relay.js'
import { TxError } from '../engines/tx/server/failure.js'
import type { ChainRuntime } from '../runtime.js'
import { builders } from './builders.js'
import { fail, transactionFailure } from './errors.js'
import { quoteModelCost } from './cost-quote.js'
import { mountRedemptionRoutes } from './redemption.js'

const runtimeAnswer = z.strictObject({ status: z.enum(['waiting', 'answered', 'failed']), outputEnvelope: s.Envelope.nullable(), openAnswer: s.Base64.nullable().optional().transform(value => value ?? null), outputHash: s.Hash.nullable(), signature: s.ReceiptSignature.nullable(), settleTransaction: s.Signature.nullable(), receiptAddress: s.Address.nullable(), failure: s.CallFailure.nullable() })
const accountSlice = z.object({ value: z.object({ owner: s.Address, data: z.tuple([s.Base64, z.literal('base64')]) }).nullable() })

async function* iterateUpstreamSse(body: ReadableStream<Uint8Array>): AsyncGenerator<{ event: string; data: string }> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      for (;;) {
        const sep = buffer.indexOf('\n\n')
        const crlfSep = buffer.indexOf('\r\n\r\n')
        let cut = -1
        let skip = 0
        if (sep >= 0 && (crlfSep < 0 || sep < crlfSep)) { cut = sep; skip = 2 }
        else if (crlfSep >= 0) { cut = crlfSep; skip = 4 }
        if (cut < 0) break
        const block = buffer.slice(0, cut)
        buffer = buffer.slice(cut + skip)
        let event = 'message'
        const dataLines: string[] = []
        for (const rawLine of block.split(/\r?\n/)) {
          if (!rawLine || rawLine.startsWith(':')) continue
          if (rawLine.startsWith('event:')) event = rawLine.slice(6).trim()
          else if (rawLine.startsWith('data:')) dataLines.push(rawLine.slice(5).trimStart())
        }
        if (dataLines.length > 0) yield { event, data: dataLines.join('\n') }
      }
    }
  } finally {
    try { await reader.cancel() } catch {}
  }
}

export function buildChainApp(runtime: ChainRuntime) {
  const app = createApi({ origins: runtime.env.CORS_ORIGINS, allowHeaders: [...RELAY_HEADERS, 'Last-Event-ID', 'X-Fixture', 'X-Fixture-Session'], contractVersion: s.CONTRACT_VERSION })
  const read = runtime.readModel
  const build = builders(runtime)
  app.onError((error, c) => {
    const failure = toFailure(error instanceof TxError ? transactionFailure(error) : error, c.get('requestId') ?? randomUUID())
    if (failure.status >= 500) console.error(JSON.stringify({ event: 'api_error', name: error.name, message: redact(error.message), requestId: c.get('requestId') }))
    if (failure.body.error.retryAfterSeconds) c.header('Retry-After', String(failure.body.error.retryAfterSeconds))
    return c.json(failure.body, failure.status as ContentfulStatusCode)
  })
  app.get('/health', c => c.json({ status: runtime.readiness.status(), contractVersion: s.CONTRACT_VERSION }))
  app.get('/openapi.json', c => c.body(readFileSync(new URL('../../contract/openapi.json', import.meta.url), 'utf8'), 200, { 'Content-Type': 'application/json' }))
  app.route('/rpc', rpcRelay({ rpc: runtime.rpc, ready: () => runtime.readiness.status() === 'ready' }))
  app.get('/v1/config', async c => {
    const config = await read.config()
    return c.json({ mode: 'chain', cluster: runtime.env.CLUSTER, rpcUrl: `${runtime.env.PUBLIC_API_URL.replace(/\/$/, '')}/rpc`, programId: runtime.programId.toBase58(), attestationProgramId: runtime.attestationProgramId.toBase58(), bountyProgramId: runtime.bountyProgramId?.toBase58() ?? null, attestationRecordLayoutVersion: config?.attestationRecordLayoutVersion ?? null, feeRecipient: config?.feeRecipient ?? null, protocolShareBps: config?.protocolShareBps ?? null, callDeadlineSlots: config?.callDeadlineSlots ?? null, maxOpenAnswerBytes: config ? (config.maxOpenAnswerBytes ?? 1024) : null, tokenMint: runtime.env.TOKEN_MINT ?? null, fixture: false })
  })
  async function weights(id: string, offset: number, length: number): Promise<s.WeightsRange> {
    const model = await read.model(id)
    if (offset > model.sizeBytes) fail('VALIDATION_ERROR', 'The byte offset exceeds the ciphertext length.', { stage: 'validation' })
    const end = Math.min(offset + length, model.sizeBytes)
    const accounts = model.weights.filter(w => w.offset < end && w.offset + w.sizeBytes > offset)
    const parts = await Promise.all(accounts.map(async w => {
      const start = Math.max(offset, w.offset), count = Math.min(end, w.offset + w.sizeBytes) - start
      const raw = await runtime.rpc.call('getAccountInfo', [w.address, { commitment: 'confirmed', encoding: 'base64', dataSlice: { offset: 56 + start - w.offset, length: count } }])
      const parsed = accountSlice.safeParse(raw)
      if (!parsed.success || !parsed.data.value || parsed.data.value.owner !== runtime.programId.toBase58()) fail('UPSTREAM_UNAVAILABLE', 'The ciphertext account could not be read.', { retryable: true })
      const bytes = fromBase64(parsed.data.value.data[0])
      if (bytes.length !== count) fail('UPSTREAM_UNAVAILABLE', 'The ciphertext range was incomplete.', { retryable: true })
      return bytes
    }))
    return { model: model.address, offset, length: end - offset, totalBytes: model.sizeBytes, bytesBase64: toBase64(Buffer.concat(parts)), accounts }
  }
  app.get('/v1/stats', async c => c.json(await read.stats()))
  app.get('/v1/home', async c => {
    const models = await read.models({ limit: 100, sort: 'calls' })
    const model = models.items.find(m => m.name === 'sketch-32') ?? null
    const recent = model ? await read.modelReceipts(model.address, { limit: 8 }) : null
    return c.json({ stats: await read.stats(), model, ciphertext: model ? await weights(model.address, 0, 256) : null, recentReceipts: recent?.items ?? [] })
  })
  app.get('/v1/models', async c => c.json(await read.models(readQuery(c, s.ModelQuery))))
  const standardWriteLimit = writeLimit(60)
  const uploadWriteLimit = writeLimit(2000)
  for (const path of [
    '/v1/models/quote', '/v1/models/build', '/v1/models/:id/seal/build',
    '/v1/models/:id/price/build', '/v1/models/:id/grant/build',
    '/v1/models/:id/revoke/build', '/v1/models/:id/retire/build',
    '/v1/models/:id/policy/build', '/v1/models/:id/policy/clear/build',
    '/v1/models/:id/split/build', '/v1/models/:id/split/claim/build',
    '/v1/models/:id/benchmarks/build',
    '/v1/models/:id/pass-plan/build',
    '/v1/models/:id/referral/build', '/v1/models/:id/referral/claim/build',
    '/v1/models/:id/quorums/build', '/v1/quorums/:address/finalize/build',
    '/v1/passes/buy/build', '/v1/passes/call/build', '/v1/passes/close/build',
    '/v1/models/:id/versions/build', '/v1/models/:id/versions/publish/build',
    '/v1/enclaves/:key/quote/build',
    '/v1/enclaves/:key/bond/deposit/build', '/v1/enclaves/:key/bond/withdraw/build',
    '/v1/calls/build', '/v1/calls/:id/refund/build',
    '/v1/bounties/build', '/v1/bounties/:address/draw/build',
    '/v1/bounties/:address/collect/build', '/v1/bounties/:address/cancel/build',
    '/v1/measurements/build', '/v1/measurements/:digest/deprecate/build',
  ]) app.use(path, standardWriteLimit)
  for (const path of ['/v1/models/:id/weights/attach/build', '/v1/models/:id/write/build', '/v1/models/:id/seal-range/build', '/v1/models/:id/versions/write/build', '/v1/models/:id/versions/seal-range/build', '/v1/transactions/submit']) app.use(path, uploadWriteLimit)
  app.post('/v1/models/quote', async c => c.json(await quoteModelCost(runtime, await readJson(c, s.ModelCostRequest))))
  app.get('/v1/models/:id', async c => c.json(await read.model(readParam(c, 'id', s.ModelId))))
  app.get('/v1/models/:id/weights', async c => { const q = readQuery(c, s.WeightsRangeQuery); return c.json(await weights(readParam(c, 'id', s.ModelId), q.offset, q.length)) })
  app.get('/v1/models/:id/enclaves', async c => c.json(await read.modelEnclaves(readParam(c, 'id', s.ModelId))))
  app.get('/v1/models/:id/receipts', async c => c.json(await read.modelReceipts(readParam(c, 'id', s.ModelId), readQuery(c, s.PageQuery))))
  app.get('/v1/models/:id/policy', async c => c.json(await read.modelPolicy(readParam(c, 'id', s.ModelId))))
  app.get('/v1/models/:id/split', async c => c.json(await read.modelSplit(readParam(c, 'id', s.ModelId))))
  app.get('/v1/benchmarks', async c => c.json(await read.benchmarks(readQuery(c, s.BenchmarkQuery))))
  app.get('/v1/models/:id/benchmarks', async c => c.json(await read.modelBenchmarks(readParam(c, 'id', s.ModelId), readQuery(c, s.PageQuery))))
  app.get('/v1/models/:id/pass-plan', async c => c.json(await read.modelPassPlan(readParam(c, 'id', s.ModelId))))
  app.get('/v1/models/:id/referral', async c => c.json(await read.modelReferral(readParam(c, 'id', s.ModelId))))
  app.get('/v1/accounts/:wallet/referrals', async c => c.json(await read.accountReferrals(readParam(c, 'wallet', s.Address))))
  app.get('/v1/quorums', async c => c.json(await read.quorums(readQuery(c, s.QuorumQuery))))
  app.get('/v1/models/:id/quorums', async c => c.json(await read.modelQuorums(readParam(c, 'id', s.ModelId), readQuery(c, s.PageQuery))))
  app.get('/v1/quorums/:address', async c => c.json(await read.quorum(readParam(c, 'address', s.Address))))
  app.get('/v1/batches', async c => c.json(await read.batches(readQuery(c, s.BatchQuery))))
  app.get('/v1/models/:id/batches', async c => c.json(await read.modelBatches(readParam(c, 'id', s.ModelId), readQuery(c, s.PageQuery))))
  app.get('/v1/batches/:address', async c => c.json(await read.batch(readParam(c, 'address', s.Address))))
  app.get('/v1/openai/models', async c => c.json(await read.openaiModels()))
  app.get('/v1/accounts/:wallet/passes', async c => c.json(await read.accountPasses(readParam(c, 'wallet', s.Address))))
  app.get('/v1/passes/:address', async c => c.json(await read.pass(readParam(c, 'address', s.Address))))
  app.get('/v1/models/:id/versions', async c => c.json(await read.modelVersions(readParam(c, 'id', s.ModelId))))
  app.get('/v1/enclaves', async c => c.json(await read.enclaves(readQuery(c, s.PageQuery))))
  app.get('/v1/enclaves/:key', async c => c.json(await read.enclave(readParam(c, 'key', s.Address))))
  app.get('/v1/enclaves/:key/bond', async c => c.json(await read.enclaveBond(readParam(c, 'key', s.Address))))
  app.get('/v1/measurements', async c => c.json(await read.measurements(readQuery(c, s.MeasurementQuery))))
  app.get('/v1/measurements/:digest', async c => c.json(await read.measurement(readParam(c, 'digest', s.HardwareMeasurement))))
  app.get('/v1/receipts/:id', async c => c.json(await read.receipt(readParam(c, 'id', s.ReceiptId))))
  app.get('/v1/accounts/:wallet', async c => c.json(await read.account(readParam(c, 'wallet', s.Address))))
  app.get('/v1/accounts/:wallet/sessions', async c => c.json(await read.accountSessions(readParam(c, 'wallet', s.Address))))
  app.get('/v1/sessions/:address', async c => c.json(await read.session(readParam(c, 'address', s.Address))))
  app.get('/v1/calls/:id', async c => c.json(await read.call(readParam(c, 'id', s.Address))))
  app.get('/v1/bounties', async c => c.json(await read.bounties(readQuery(c, s.BountyQuery))))
  app.get('/v1/bounties/:address', async c => c.json(await read.bounty(readParam(c, 'address', s.Address))))
  app.get('/v1/transactions/:id', async c => c.json(await build.ledger.follow(c.req.param('id'))))
  app.get('/v1/events', c => streamEvents(c, { hub: runtime.hub, ready: () => ({ status: runtime.readiness.status() }) }))
  app.get('/v1/calls/:id/events', async c => {
    const id = readParam(c, 'id', s.Address)
    const answer = await callAnswer(id)
    if (answer.call.priceUnit !== 'token') {
      return streamEvents(c, { hub: runtime.hub, ready: () => answer, filter: event => {
        const data = event.data as { address?: string; call?: string }
        return event.type === 'call.updated' && data.address === id || event.type === 'receipt.created' && data.call === id
      } })
    }
    const detail = await read.enclave(answer.call.enclave)
    c.header('Cache-Control', 'no-cache')
    c.header('X-Accel-Buffering', 'no')
    return streamSSE(c, async (stream) => {
      const upstreamAbort = new AbortController()
      const queue: { type: string; id: string; timestamp: string; data: unknown }[] = []
      let wake: (() => void) | null = null
      let closed = false
      const enqueue = (event: { type: string; id: string; timestamp: string; data: unknown }) => {
        if (closed) return
        queue.push(event)
        wake?.()
      }
      const off = runtime.hub.subscribe((event) => {
        const data = event.data as { address?: string; call?: string }
        if (event.type === 'call.updated' && data.address === id || event.type === 'receipt.created' && data.call === id) {
          enqueue(event)
        }
      })
      stream.onAbort(() => {
        closed = true
        off()
        upstreamAbort.abort()
        wake?.()
      })
      const send = (event: { type: string; id: string; timestamp: string; data: unknown }) =>
        stream.writeSSE({ event: event.type, id: event.id, data: JSON.stringify(event) })
      if (c.req.header('Last-Event-ID')) await send(streamEvent('resync', { reason: 'reconnected' }))
      await send(streamEvent('ready', answer))
      const pipeUpstream = (async () => {
        try {
          const upstreamUrl = `${detail.enclave.endpoint.replace(/\/+$/, '')}/v1/calls/${encodeURIComponent(id)}/stream`
          const upstream = await fetch(upstreamUrl, { headers: { Accept: 'text/event-stream' }, signal: upstreamAbort.signal })
          if (!upstream.ok || !upstream.body) return
          for await (const frame of iterateUpstreamSse(upstream.body)) {
            if (closed) break
            const validated = validateUpstreamStreamFrame(id, frame.data)
            if (validated) enqueue(validated)
          }
        } catch {}
      })()
      try {
        while (!closed) {
          if (queue.length > 0) {
            await send(queue.shift()!)
            continue
          }
          const idle = await new Promise<boolean>((resolveIdle) => {
            const timer = setTimeout(() => resolveIdle(true), 15_000)
            wake = () => { clearTimeout(timer); resolveIdle(false) }
          })
          wake = null
          if (idle && !closed) await stream.write(': keepalive\n\n')
        }
      } finally {
        closed = true
        off()
        upstreamAbort.abort()
        await pipeUpstream.catch(() => {})
      }
    })
  })
  function validateUpstreamStreamFrame(callAddress: string, rawJson: string): { type: 'call.piece' | 'call.stream.done'; id: string; timestamp: string; data: s.StreamPiece | s.CallStreamDone } | null {
    let parsedJson: unknown
    try { parsedJson = JSON.parse(rawJson) } catch { return null }
    const envelope = s.ProgramEvent.safeParse(parsedJson)
    if (!envelope.success) return null
    if (envelope.data.type === 'call.piece' && envelope.data.data.call === callAddress) return envelope.data
    if (envelope.data.type === 'call.stream.done' && envelope.data.data.call === callAddress) return envelope.data
    return null
  }
  async function forward(call: s.Call, method: 'GET' | 'POST', suffix: 'input' | 'answer' | 'pieces' | 'stop' = method === 'POST' ? 'input' : 'answer', body?: s.RelayInputRequest | s.StopCallRequest) {
    const detail = await read.enclave(call.enclave)
    const path = `/v1/calls/${encodeURIComponent(call.address)}/${suffix}`
    let response: Response
    try { response = await fetch(detail.enclave.endpoint.replace(/\/+$/, '') + path, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60_000) }) }
    catch { fail('UPSTREAM_UNAVAILABLE', 'The enclave did not answer. Check the call deadline before retrying.', { retryable: true }) }
    let value: unknown
    try { value = await response.json() } catch { fail('UPSTREAM_UNAVAILABLE', 'The enclave returned an unreadable answer.', { retryable: true }) }
    if (!response.ok) {
      const failure = s.ApiError.safeParse(value)
      if (failure.success) throw new ApiFailure(response.status, failure.data)
      fail('UPSTREAM_UNAVAILABLE', 'The enclave could not process this call.', { retryable: true })
    }
    return value
  }
  async function callAnswer(id: string): Promise<s.CallAnswer> {
    const call = await read.call(id)
    if (call.status === 'refundable' || call.status === 'refunded') return { status: 'failed', call, outputEnvelope: null, openAnswer: null, outputHash: null, signature: null, settleTransaction: null, receiptAddress: null, failure: call.failure }
    const parsed = runtimeAnswer.safeParse(await forward(call, 'GET', 'answer'))
    if (!parsed.success) fail('UPSTREAM_UNAVAILABLE', 'The enclave answer does not match the protocol.', { retryable: true })
    return { ...parsed.data, call }
  }
  async function callPieces(id: string): Promise<s.CallPieces> {
    const call = await read.call(id)
    if (call.status === 'refundable' || call.status === 'refunded') {
      try {
        const parsed = s.CallPieces.safeParse(await forward(call, 'GET', 'pieces'))
        if (parsed.success && parsed.data.call === call.address && parsed.data.pieces.every(p => p.call === call.address)) {
          return parsed.data
        }
      } catch {}
      return { call: call.address, status: 'failed', pieces: [], failure: call.failure }
    }
    const parsed = s.CallPieces.safeParse(await forward(call, 'GET', 'pieces'))
    if (!parsed.success || parsed.data.call !== call.address || parsed.data.pieces.some(p => p.call !== call.address)) {
      fail('UPSTREAM_UNAVAILABLE', 'The enclave pieces payload does not match the protocol.', { retryable: true })
    }
    return parsed.data
  }
  app.get('/v1/calls/:id/answer', async c => c.json(await callAnswer(readParam(c, 'id', s.Address))))
  app.get('/v1/calls/:id/pieces', async c => c.json(await callPieces(readParam(c, 'id', s.Address))))
  app.get('/v1/calls/:id/stream', async c => {
    const id = readParam(c, 'id', s.Address)
    const afterRaw = c.req.query('after')
    const after = afterRaw !== undefined && /^-?\d+$/.test(afterRaw) ? Math.max(-1, Number(afterRaw)) : undefined
    const call = await read.call(id)
    const detail = await read.enclave(call.enclave)
    const upstreamUrl = `${detail.enclave.endpoint.replace(/\/+$/, '')}/v1/calls/${encodeURIComponent(call.address)}/stream${after !== undefined ? `?after=${after}` : ''}`
    const upstreamAbort = new AbortController()
    let upstream: Response
    try {
      upstream = await fetch(upstreamUrl, { headers: { Accept: 'text/event-stream' }, signal: upstreamAbort.signal })
    } catch {
      fail('UPSTREAM_UNAVAILABLE', 'The enclave stream is unreachable. Check the call deadline before retrying.', { retryable: true })
    }
    if (!upstream.ok || !upstream.body) {
      upstreamAbort.abort()
      fail('UPSTREAM_UNAVAILABLE', 'The enclave stream could not be opened.', { retryable: true })
    }
    c.header('Cache-Control', 'no-cache')
    c.header('X-Accel-Buffering', 'no')
    return streamSSE(c, async (stream) => {
      let closed = false
      stream.onAbort(() => {
        closed = true
        upstreamAbort.abort()
      })
      const keepalive = setInterval(() => {
        if (!closed) void stream.write(': keepalive\n\n').catch(() => {})
      }, 15_000)
      try {
        for await (const frame of iterateUpstreamSse(upstream.body!)) {
          if (closed) break
          const validated = validateUpstreamStreamFrame(call.address, frame.data)
          if (!validated) continue
          await stream.writeSSE({ event: validated.type, id: validated.id, data: JSON.stringify(validated) })
          if (validated.type === 'call.stream.done') break
        }
      } catch {
        // Upstream aborted or closed cleanly.
      } finally {
        clearInterval(keepalive)
        closed = true
        upstreamAbort.abort()
      }
    })
  })
  app.use('/v1/*', async (c, next) => { if (c.req.method === 'POST') return requireReady(runtime.readiness)(c, next); await next() })
  app.post('/v1/calls/:id/input', async c => {
    const call = await read.call(readParam(c, 'id', s.Address)), body = await readJson(c, s.RelayInputRequest)
    if (toHex(sha256(fromBase64(body.envelope))) !== call.inputHash) fail('INPUT_HASH_MISMATCH', 'The encrypted input does not match the escrowed hash.', { stage: 'upload' })
    const accepted = s.RelayAccepted.safeParse(await forward(call, 'POST', 'input', body))
    if (!accepted.success || accepted.data.call !== call.address) fail('UPSTREAM_UNAVAILABLE', 'The enclave did not accept this call.', { retryable: true })
    return c.json(accepted.data)
  })
  app.post('/v1/calls/:id/stop', async c => {
    const call = await read.call(readParam(c, 'id', s.Address)), body = await readJson(c, s.StopCallRequest)
    const accepted = s.StopCallAccepted.safeParse(await forward(call, 'POST', 'stop', body))
    if (!accepted.success || accepted.data.call !== call.address) fail('UPSTREAM_UNAVAILABLE', 'The enclave stop response does not match the protocol.', { retryable: true })
    return c.json(accepted.data)
  })
  app.post('/v1/models/build', async c => c.json(await build.create(await readJson(c, s.CreateModelRequest))))
  app.post('/v1/models/:id/weights/attach/build', async c => c.json(await build.attachWeights(readParam(c, 'id', s.ModelId), await readJson(c, s.AttachWeightsRequest))))
  app.post('/v1/models/:id/write/build', async c => c.json(await build.write(readParam(c, 'id', s.ModelId), await readJson(c, s.WriteWeightsRequest))))
  app.post('/v1/models/:id/seal-range/build', async c => c.json(await build.sealRange(readParam(c, 'id', s.ModelId), await readJson(c, s.SealRangeRequest))))
  app.post('/v1/models/:id/seal/build', async c => c.json(await build.seal(readParam(c, 'id', s.ModelId), await readJson(c, s.SealModelRequest))))
  app.post('/v1/models/:id/price/build', async c => c.json(await build.price(readParam(c, 'id', s.ModelId), await readJson(c, s.SetPriceRequest))))
  app.post('/v1/models/:id/grant/build', async c => c.json(await build.grant(readParam(c, 'id', s.ModelId), await readJson(c, s.GrantRequest))))
  app.post('/v1/models/:id/revoke/build', async c => c.json(await build.revoke(readParam(c, 'id', s.ModelId), await readJson(c, s.RevokeGrantRequest))))
  app.post('/v1/models/:id/retire/build', async c => c.json(await build.retire(readParam(c, 'id', s.ModelId), await readJson(c, s.WalletRequest))))
  app.post('/v1/models/:id/policy/build', async c => c.json(await build.setPolicy(readParam(c, 'id', s.ModelId), await readJson(c, s.SetPolicyRequest))))
  app.post('/v1/models/:id/policy/clear/build', async c => c.json(await build.clearPolicy(readParam(c, 'id', s.ModelId), await readJson(c, s.WalletRequest))))
  app.post('/v1/models/:id/split/build', async c => c.json(await build.setSplit(readParam(c, 'id', s.ModelId), await readJson(c, s.SetSplitRequest))))
  app.post('/v1/models/:id/split/claim/build', async c => c.json(await build.claimSplit(readParam(c, 'id', s.ModelId), await readJson(c, s.ClaimSplitRequest))))
  app.post('/v1/models/:id/benchmarks/build', async c => c.json(await build.publishBenchmark(readParam(c, 'id', s.ModelId), await readJson(c, s.PublishBenchmarkRequest))))
  app.post('/v1/models/:id/pass-plan/build', async c => c.json(await build.setPassPlan(readParam(c, 'id', s.ModelId), await readJson(c, s.SetPassPlanRequest))))
  app.post('/v1/models/:id/referral/build', async c => c.json(await build.setReferralConfig(readParam(c, 'id', s.ModelId), await readJson(c, s.SetReferralConfigRequest))))
  app.post('/v1/models/:id/referral/claim/build', async c => c.json(await build.claimReferral(readParam(c, 'id', s.ModelId), await readJson(c, s.ClaimReferralRequest))))
  app.post('/v1/models/:id/quorums/build', async c => c.json(await build.openQuorum(readParam(c, 'id', s.ModelId), await readJson(c, s.OpenQuorumRequest))))
  app.post('/v1/quorums/:address/finalize/build', async c => c.json(await build.finalizeQuorum(readParam(c, 'address', s.Address), await readJson(c, s.FinalizeQuorumRequest))))
  app.post('/v1/models/:id/batches/build', async c => c.json(await build.openBatch(readParam(c, 'id', s.ModelId), await readJson(c, s.OpenBatchRequest))))
  app.post('/v1/batches/:address/append/build', async c => c.json(await build.appendBatchReceipts(readParam(c, 'address', s.Address), await readJson(c, s.AppendBatchReceiptsRequest))))
  app.post('/v1/passes/buy/build', async c => c.json(await build.buyPass(await readJson(c, s.BuyPassRequest))))
  app.post('/v1/passes/call/build', async c => c.json(await build.openPassCall(await readJson(c, s.OpenPassCallRequest))))
  app.post('/v1/passes/close/build', async c => c.json(await build.closePass(await readJson(c, s.ClosePassRequest))))
  app.post('/v1/models/:id/versions/build', async c => c.json(await build.beginVersion(readParam(c, 'id', s.ModelId), await readJson(c, s.BeginVersionRequest))))
  app.post('/v1/models/:id/versions/write/build', async c => c.json(await build.writeVersionWeights(readParam(c, 'id', s.ModelId), await readJson(c, s.WriteVersionWeightsRequest))))
  app.post('/v1/models/:id/versions/seal-range/build', async c => c.json(await build.sealVersionRange(readParam(c, 'id', s.ModelId), await readJson(c, s.SealVersionRangeRequest))))
  app.post('/v1/models/:id/versions/publish/build', async c => c.json(await build.publishVersion(readParam(c, 'id', s.ModelId), await readJson(c, s.PublishVersionRequest))))
  app.post('/v1/enclaves/:key/quote/build', async c => c.json(await build.setQuote(readParam(c, 'key', s.Address), await readJson(c, s.SetQuoteRequest))))
  app.post('/v1/enclaves/:key/bond/deposit/build', async c => c.json(await build.depositBond(readParam(c, 'key', s.Address), await readJson(c, s.DepositBondRequest))))
  app.post('/v1/enclaves/:key/bond/withdraw/build', async c => c.json(await build.withdrawBond(readParam(c, 'key', s.Address), await readJson(c, s.WithdrawBondRequest))))
  app.post('/v1/calls/build', async c => c.json(await build.open(await readJson(c, s.OpenCallRequest))))
  app.post('/v1/calls/:id/settle/build', async c => c.json(await build.settleMetered(readParam(c, 'id', s.Address), await readJson(c, s.SettleCallRequest))))
  app.post('/v1/calls/:id/refund/build', async c => c.json(await build.refund(readParam(c, 'id', s.Address), await readJson(c, s.WalletRequest))))
  app.post('/v1/bounties/build', async c => c.json(await build.postBounty(await readJson(c, s.PostBountyRequest))))
  app.post('/v1/bounties/:address/draw/build', async c => c.json(await build.drawBounty(readParam(c, 'address', s.Address), await readJson(c, s.DrawBountyRequest))))
  app.post('/v1/bounties/:address/collect/build', async c => c.json(await build.collectBounty(readParam(c, 'address', s.Address), await readJson(c, s.CollectBountyRequest))))
  app.post('/v1/bounties/:address/cancel/build', async c => c.json(await build.cancelBounty(readParam(c, 'address', s.Address), await readJson(c, s.WalletRequest))))
  app.post('/v1/measurements/build', async c => c.json(await build.publishMeasurement(await readJson(c, s.PublishMeasurementRequest))))
  app.post('/v1/measurements/:digest/deprecate/build', async c => c.json(await build.deprecateMeasurement(readParam(c, 'digest', s.HardwareMeasurement), await readJson(c, s.WalletRequest))))
  app.post('/v1/sessions/build', async c => c.json(await build.openSession(await readJson(c, s.OpenSessionRequest))))
  app.post('/v1/sessions/:address/close/build', async c => c.json(await build.closeSession(readParam(c, 'address', s.Address), await readJson(c, s.WalletRequest))))
  app.post('/v1/sessions/:address/call/build', async c => c.json(await build.openSessionCall(readParam(c, 'address', s.Address), await readJson(c, s.OpenSessionCallRequest))))
  app.post('/v1/transactions/submit', async c => {
    const status = await build.ledger.submit(await readJson(c, s.TxSubmission))
    runtime.hub.publish(streamEvent('transaction.updated', status))
    return c.json(status)
  })
  mountRedemptionRoutes(app, runtime)
  return app
}
