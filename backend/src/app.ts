import { readFileSync } from 'node:fs'
import { Connection, PublicKey } from '@solana/web3.js'
import { streamSSE } from 'hono/streaming'
import * as s from '@voynich/contract'
import { ERROR_FIXTURES, FIXTURE, SCENARIOS, fixtureAddress, fixtureConfig, fixtureModelCostQuote } from '@voynich/contract/fixtures'
import { CIPHER_CHUNK_BYTES, ciphertextHash, fromBase64, sha256, toHex, unwrapKey, utf8 } from 'voynich/crypto'
import { env } from './config.js'
import { createApi } from './engines/server/app.js'
import { FixtureSessions, fixtureScenario } from './engines/server/fixture.js'
import { readJson, readParam, readQuery } from './engines/server/input.js'
import { streamEvent, streamEvents } from './engines/server/sse.js'
import { FixtureState, addRange, fail } from './fixture-runtime.js'
import { addresses, chainPrograms } from 'voynich/program'
import { createModelFootprint } from './chain/create-model.js'

export function buildApp() {
  const app = createApi<{ scenario: typeof SCENARIOS[number] | null; fixture: FixtureState }>({
    origins: env.CORS_ORIGINS, allowHeaders: ['X-Fixture', 'X-Fixture-Session', 'Last-Event-ID'], contractVersion: s.CONTRACT_VERSION,
  })
  const sessions = new FixtureSessions(scenario => new FixtureState(scenario))
  app.use('*', fixtureScenario({ scenarios: SCENARIOS, errors: ERROR_FIXTURES, status: s.errors.status }))
  app.use('*', async (c, next) => {
    const scenario = c.get('scenario')
    if (scenario === 'failed') fail('UPSTREAM_UNAVAILABLE', 'The read failed. Try again.', { retryable: true })
    if (scenario === 'loading') await new Promise(resolve => setTimeout(resolve, 1500))
    const state = sessions.get(c, scenario)
    c.set('fixture', state)
    if (c.req.method === 'POST' && c.req.path !== '/v1/models/quote') state.ready()
    await next()
  })
  const queryKeys = ['fixture', 'session']
  app.get('/health', c => c.json({ status: c.get('scenario') === 'waiting' ? 'waiting' : 'fixture', contractVersion: s.CONTRACT_VERSION }))
  app.get('/openapi.json', c => c.body(readFileSync(new URL('../contract/openapi.json', import.meta.url), 'utf8'), 200, { 'Content-Type': 'application/json' }))
  app.get('/v1/config', c => c.json(c.get('scenario') === 'waiting'
    ? { ...fixtureConfig, programId: null, attestationProgramId: null, attestationRecordLayoutVersion: null, feeRecipient: null, protocolShareBps: null, callDeadlineSlots: null, maxOpenAnswerBytes: null }
    : { ...fixtureConfig, cluster: env.CLUSTER, rpcUrl: env.SOLANA_RPC_URL }))
  app.get('/v1/stats', c => c.json(c.get('fixture').stats()))
  app.get('/v1/home', c => {
    const state = c.get('fixture')
    const model = state.models.find(m => m.name === 'sketch-32') ?? null
    return c.json({ stats: state.stats(), model, ciphertext: model ? state.range(model, 0, 256) : null, recentReceipts: state.receipts.slice(0, 8) })
  })
  app.get('/v1/models', c => {
    const q = readQuery(c, s.ModelQuery, queryKeys)
    const rows = [...c.get('fixture').models].sort((a, b) => {
      const left = BigInt(q.sort === 'price' ? a.price.amount : q.sort === 'newest' ? a.createdSlot : a.callsSettled)
      const right = BigInt(q.sort === 'price' ? b.price.amount : q.sort === 'newest' ? b.createdSlot : b.callsSettled)
      const order = left < right ? -1 : left > right ? 1 : a.address.localeCompare(b.address)
      return q.sort === 'price' ? order : -order
    })
    return c.json(s.paginate(rows, q))
  })
  app.post('/v1/models/quote', async c => {
    const body = await readJson(c, s.ModelCostRequest)
    const uploadKeyCount = body.uploadKeyCount ?? body.create?.uploadKeys?.length ?? s.DEFAULT_UPLOAD_KEYS
    const quote = fixtureModelCostQuote(body.sizeBytes, uploadKeyCount)
    if (body.create) {
      const programId = new PublicKey(fixtureConfig.programId!), { voynich } = chainPrograms(new Connection(fixtureConfig.rpcUrl, 'confirmed'), { programId })
      const pdas = addresses(programId)
      Object.assign(quote, await createModelFootprint(voynich, pdas.config, pdas.model(body.create.name), { ...body.create, sizeBytes: body.sizeBytes, uploadFundingLamports: quote.uploadFundingLamports }))
    }
    return c.json(quote)
  })
  app.get('/v1/models/:id', c => c.json(c.get('fixture').model(readParam(c, 'id', s.ModelId))))
  app.get('/v1/models/:id/weights', c => {
    const state = c.get('fixture'); const model = state.model(readParam(c, 'id', s.ModelId))
    const q = readQuery(c, s.WeightsRangeQuery, queryKeys)
    return c.json(state.range(model, q.offset, q.length))
  })
  app.get('/v1/models/:id/enclaves', c => {
    const state = c.get('fixture'); const model = state.model(readParam(c, 'id', s.ModelId))
    return c.json({ items: state.grants.filter(g => g.model === model.address).map(grant => ({ grant, enclave: state.enclave(grant.enclave) })), asOf: new Date().toISOString() })
  })
  app.get('/v1/models/:id/receipts', c => {
    const state = c.get('fixture'); const model = state.model(readParam(c, 'id', s.ModelId))
    return c.json(s.paginate(state.receipts.filter(r => r.model === model.address), readQuery(c, s.PageQuery, queryKeys)))
  })
  app.get('/v1/models/:id/policy', c => {
    const state = c.get('fixture'); const model = state.model(readParam(c, 'id', s.ModelId))
    const policy = state.policies.get(model.address)
    if (!policy) fail('POLICY_NOT_FOUND', 'No policy is configured for this model.')
    return c.json(policy)
  })
  app.get('/v1/models/:id/split', c => {
    const state = c.get('fixture'); const model = state.model(readParam(c, 'id', s.ModelId))
    const split = state.splits.get(model.address)
    if (!split) fail('SPLIT_NOT_FOUND', 'No revenue split is configured for this model.')
    return c.json(split)
  })
  app.get('/v1/benchmarks', c => {
    const state = c.get('fixture'); const q = readQuery(c, s.BenchmarkQuery, queryKeys)
    let items = [...state.benchmarks]
    if (q.model) items = items.filter(b => b.model === q.model || b.modelName === q.model)
    if (q.name) items = items.filter(b => b.name === q.name)
    items.sort((a, b) => b.scoreBps - a.scoreBps || Number(BigInt(b.publishedSlot) - BigInt(a.publishedSlot)))
    return c.json(s.paginate(items, q))
  })
  app.get('/v1/models/:id/benchmarks', c => {
    const state = c.get('fixture'); const model = state.model(readParam(c, 'id', s.ModelId))
    const items = state.benchmarks.filter(b => b.model === model.address)
    return c.json(s.paginate(items, readQuery(c, s.PageQuery, queryKeys)))
  })
  app.get('/v1/models/:id/versions', c => {
    const state = c.get('fixture'); const model = state.model(readParam(c, 'id', s.ModelId))
    const existing = state.versions.get(model.address)
    const items = existing && existing.length > 0
      ? [...existing].sort((a, b) => b.version - a.version)
      : [{
          model: model.address,
          version: 1,
          address: null,
          status: model.status === 'uploading' ? 'uploading' as const : 'live' as const,
          sizeBytes: model.sizeBytes,
          ciphertextSha256: model.ciphertextSha256,
          base: model.base,
          manifest: model.manifest,
          publishedSlot: model.sealedSlot,
        }]
    return c.json({ items, currentVersion: model.currentVersion ?? 1 })
  })
  app.get('/v1/enclaves', c => c.json(s.paginate(c.get('fixture').enclaves, readQuery(c, s.PageQuery, queryKeys))))
  app.get('/v1/enclaves/:key', c => {
    const state = c.get('fixture'); const enclave = state.enclave(readParam(c, 'key', s.Address))
    return c.json({ enclave, grants: state.grants.filter(g => g.enclave === enclave.address), receipts: state.receipts.filter(r => r.enclave === enclave.address), earnings: state.earnings('operator', enclave.operator) })
  })
  app.get('/v1/enclaves/:key/bond', c => {
    const state = c.get('fixture'); const enclave = state.enclave(readParam(c, 'key', s.Address))
    const bond = state.bonds.get(enclave.address)
    if (!bond) fail('BOND_NOT_FOUND', 'No operator bond is configured for this enclave.')
    return c.json(bond)
  })
  app.get('/v1/measurements', c => {
    const state = c.get('fixture'); const q = readQuery(c, s.MeasurementQuery, queryKeys)
    const items = q.status ? state.measurements.filter(m => m.status === q.status) : state.measurements
    return c.json(s.paginate(items, q))
  })
  app.get('/v1/measurements/:digest', c => {
    const state = c.get('fixture'); const digest = readParam(c, 'digest', s.HardwareMeasurement)
    const item = state.measurements.find(m => m.digest === digest)
    if (!item) fail('MEASUREMENT_NOT_FOUND', 'This measurement was not found.')
    return c.json(item)
  })
  app.get('/v1/receipts/:id', c => {
    const state = c.get('fixture'); const id = readParam(c, 'id', s.Signature.or(s.Address))
    const receipt = state.receipts.find(r => r.address === id || r.call === id || r.transactionSignature === id)
    if (!receipt) fail('RECEIPT_NOT_FOUND', 'This receipt was not found.')
    const enclave = state.enclave(receipt.enclave)
    const modelBase = state.models.find(m => m.address === receipt.model)?.base ?? null
    return c.json({ receipt, enclaveSigningKey: enclave.signingKey, attestationRecord: enclave.attestation, attestationProgramId: FIXTURE.attestProgram, recordLayoutVersion: 1, modelBase })
  })
  app.get('/v1/accounts/:wallet', c => {
    const state = c.get('fixture'); const wallet = readParam(c, 'wallet', s.Address)
    return c.json({ wallet, models: state.models.filter(m => m.owner === wallet), ownerEarnings: state.earnings('owner', wallet), enclaves: state.enclaves.filter(e => e.operator === wallet), operatorEarnings: state.earnings('operator', wallet), calls: state.calls.filter(call => call.caller === wallet) })
  })
  app.get('/v1/models/:id/pass-plan', c => {
    const state = c.get('fixture'); const model = state.model(readParam(c, 'id', s.ModelId))
    const plan = state.passPlans.get(model.address)
    if (!plan) fail('PASS_PLAN_NOT_FOUND', 'No prepaid pass plan is configured for this model.')
    return c.json(plan)
  })
  app.get('/v1/accounts/:wallet/passes', c => {
    const state = c.get('fixture'); const wallet = readParam(c, 'wallet', s.Address)
    const items = [...state.passes.values()].filter(p => p.holder === wallet)
    return c.json({ items, asOf: new Date().toISOString() })
  })
  app.get('/v1/passes/:address', c => {
    const state = c.get('fixture'); const address = readParam(c, 'address', s.Address)
    const item = state.passes.get(address)
    if (!item) fail('PASS_NOT_FOUND', 'This prepaid pass was not found.')
    return c.json(item)
  })
  app.get('/v1/models/:id/referral', c => {
    const state = c.get('fixture'); const model = state.model(readParam(c, 'id', s.ModelId))
    const cfg = state.referralConfigs.get(model.address)
    if (!cfg) fail('REFERRAL_CONFIG_NOT_FOUND', 'No referral configuration is set for this model.')
    return c.json(cfg)
  })
  app.get('/v1/accounts/:wallet/referrals', c => {
    const state = c.get('fixture'); const wallet = readParam(c, 'wallet', s.Address)
    const items = [...state.referrals.values()].filter(r => r.referrer === wallet)
    return c.json({ items, asOf: new Date().toISOString() })
  })
  app.get('/v1/calls/:id', c => c.json(c.get('fixture').call(readParam(c, 'id', s.Address))))
  app.get('/v1/bounties', c => {
    const state = c.get('fixture'); const q = readQuery(c, s.BountyQuery, queryKeys)
    let items = state.bounties
    if (q.status) items = items.filter(b => b.status === q.status)
    if (q.model) items = items.filter(b => b.model === q.model || b.modelName === q.model)
    return c.json(s.paginate(items, q))
  })
  app.get('/v1/bounties/:address', c => {
    const state = c.get('fixture'); const bounty = state.bounty(readParam(c, 'address', s.Address))
    return c.json({ bounty, attempts: state.bountyAttempts.filter(a => a.bounty === bounty.address) })
  })
  app.get('/v1/calls/:id/answer', c => c.json(c.get('fixture').answer(readParam(c, 'id', s.Address))))
  app.get('/v1/calls/:id/pieces', c => c.json(c.get('fixture').callPieces(readParam(c, 'id', s.Address))))
  app.get('/v1/calls/:id/stream', c => {
    const state = c.get('fixture'); const id = readParam(c, 'id', s.Address); state.call(id)
    const afterRaw = c.req.query('after')
    const after = afterRaw !== undefined && /^-?\d+$/.test(afterRaw) ? Math.max(-1, Number(afterRaw)) : -1
    c.header('Cache-Control', 'no-cache')
    c.header('X-Accel-Buffering', 'no')
    return streamSSE(c, async (stream) => {
      const queue: { type: string; id: string; timestamp: string; data: unknown }[] = []
      let wake: (() => void) | null = null
      let closed = false
      const off = state.hub.subscribe((event) => {
        const data = event.data as { call?: string }
        if (data?.call !== id) return
        if (event.type !== 'call.piece' && event.type !== 'call.stream.done') return
        queue.push(event)
        wake?.()
      })
      stream.onAbort(() => { closed = true; off(); wake?.() })
      const send = (event: { type: string; id: string; timestamp: string; data: unknown }) =>
        stream.writeSSE({ event: event.type, id: event.id, data: JSON.stringify(event) })
      try {
        const snap = state.callPieces(id)
        let lastSent = after
        for (const piece of snap.pieces) {
          if (closed) return
          if (piece.index <= lastSent) continue
          await send(streamEvent('call.piece', piece))
          lastSent = piece.index
        }
        if (snap.status === 'done' || snap.status === 'failed') {
          const last = snap.pieces[snap.pieces.length - 1]
          const ans = state.answer(id)
          await send(streamEvent('call.stream.done', {
            call: id, status: snap.status, count: last?.count ?? 0, pieceCount: snap.pieces.length,
            runningHash: last?.runningHash ?? null, signature: last?.signature ?? null,
            finishReason: last?.finishReason ?? null,
            receiptAddress: ans.receiptAddress, settleTransaction: ans.settleTransaction,
            failure: snap.failure,
          }))
          return
        }
        while (!closed) {
          if (queue.length > 0) {
            const next = queue.shift()!
            if (next.type === 'call.piece') {
              const piece = next.data as s.StreamPiece
              if (piece.index <= lastSent) continue
              await send(next)
              lastSent = piece.index
            } else if (next.type === 'call.stream.done') {
              await send(next)
              return
            }
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
      }
    })
  })
  app.post('/v1/calls/:id/input', async c => {
    const state = c.get('fixture'); const id = readParam(c, 'id', s.Address); const body = await readJson(c, s.RelayInputRequest)
    state.relay(id, body.envelope)
    return c.json({ call: id, status: 'accepted' })
  })
  app.post('/v1/calls/:id/stop', async c => {
    const state = c.get('fixture'); const id = readParam(c, 'id', s.Address); const body = await readJson(c, s.StopCallRequest)
    return c.json(state.stop(id, body.stopToken))
  })
  app.get('/v1/events', c => {
    const state = c.get('fixture')
    return streamEvents(c, { hub: state.hub, ready: () => ({ status: state.scenario === 'waiting' ? 'waiting' : 'fixture' }) })
  })
  app.get('/v1/calls/:id/events', c => {
    const state = c.get('fixture'); const id = readParam(c, 'id', s.Address); state.call(id)
    return streamEvents(c, { hub: state.hub, filter: event => {
      const data = event.data as { address?: string; call?: string }
      return event.type === 'call.updated' && data.address === id
        || (event.type === 'receipt.created' || event.type === 'call.piece' || event.type === 'call.stream.done') && data.call === id
    }, ready: () => state.answer(id) })
  })
  app.post('/v1/transactions/submit', async c => c.json(c.get('fixture').submit(await readJson(c, s.TxSubmission))))
  app.get('/v1/transactions/:id', c => c.json(c.get('fixture').transaction(c.req.param('id'))))

  app.post('/v1/models/build', async c => {
    const state = c.get('fixture'); const body = await readJson(c, s.CreateModelRequest)
    if (state.models.some(m => m.name === body.name)) fail('PROGRAM_REFUSED', 'A model with this name already exists.', { stage: 'simulation' })
    if (body.name !== body.manifest.name) fail('VALIDATION_ERROR', 'The manifest name must match the model name.', { stage: 'validation' })
    if (body.operatorShareBps + fixtureConfig.protocolShareBps! > 10000) fail('VALIDATION_ERROR', 'The operator and protocol shares exceed the price.', { stage: 'validation' })
    if (body.sizeBytes !== body.plaintextSizeBytes + Math.ceil(body.plaintextSizeBytes / 65536) * 16) fail('VALIDATION_ERROR', 'The ciphertext size is invalid for this cipher.', { stage: 'validation' })
    // A fixture uses one Weights account; later builders split at Solana account limits.
    if (body.sizeBytes > 10 * 1024 * 1024) fail('VALIDATION_ERROR', 'A model is at most 10 MiB in one Weights account.', { stage: 'validation' })
    const address = fixtureAddress(`model:${body.wallet}:${body.name}`); const weights = fixtureAddress(`weights:${address}`)
    const uploadKeys = body.uploadKeys?.length ? body.uploadKeys : [body.uploadKey]
    const model: s.Model = { address, name: body.name, owner: body.wallet, createdSlot: String(state.slot), sealedSlot: null, sizeBytes: body.sizeBytes, plaintextSizeBytes: body.plaintextSizeBytes, ciphertextSha256: null, hashVersion: 1, sealedChunks: 0, base: body.base ?? null, cipher: body.cipher, allowedMeasurements: body.allowedMeasurements, price: body.price, priceUnit: body.priceUnit ?? 'call', operatorShareBps: body.operatorShareBps, protocolShareBps: fixtureConfig.protocolShareBps, status: 'uploading', manifest: body.manifest, weights: [{ address: weights, model: address, index: 0, offset: 0, sizeBytes: body.sizeBytes, writtenRanges: [] }], upload: { uploadKey: body.uploadKey, uploadKeys, bytesWritten: 0, transactionsWritten: 0, writtenRanges: [], closed: false }, enclavesHolding: 0, callsSettled: '0' }
    return c.json(state.build('create_model', [body.wallet, body.uploadKey], { model: address, weights: [weights], uploadKey: body.uploadKey }, () => { state.models.push(model); state.bytes.set(address, new Uint8Array(body.sizeBytes)); state.emit('model.updated', model) }))
  })
  app.post('/v1/models/:id/weights/attach/build', async c => {
    const state = c.get('fixture'); const model = state.model(readParam(c, 'id', s.ModelId)); const body = await readJson(c, s.AttachWeightsRequest)
    if (model.status !== 'uploading') fail('MODEL_NOT_UPLOADING', 'This model is not accepting upload changes.', { stage: 'build' })
    const allowedUploadKeys = model.upload?.uploadKeys.length ? model.upload.uploadKeys : [model.upload!.uploadKey]
    if (!allowedUploadKeys.includes(body.wallet)) fail('PROGRAM_REFUSED', 'An authorized upload key must sign weights attachment.', { stage: 'simulation' })
    return c.json(state.build('attach_weights', [body.wallet], { model: model.address, weights: body.weights, uploadKey: body.wallet }, () => { state.emit('model.updated', model) }))
  })
  app.post('/v1/models/:id/write/build', async c => {
    const state = c.get('fixture'); const model = state.model(readParam(c, 'id', s.ModelId)); const body = await readJson(c, s.WriteWeightsRequest)
    if (model.status !== 'uploading') fail('MODEL_NOT_UPLOADING', 'This model is not accepting upload writes.', { stage: 'build' })
    const allowedUploadKeys = model.upload?.uploadKeys.length ? model.upload.uploadKeys : [model.upload!.uploadKey]
    if (!allowedUploadKeys.includes(body.wallet)) fail('PROGRAM_REFUSED', 'An authorized upload key must sign chunk writes.', { stage: 'simulation' })
    const bytes = fromBase64(body.bytesBase64)
    if (body.offset + bytes.length > model.sizeBytes) fail('VALIDATION_ERROR', 'Write ciphertext bytes within the allocated model size.', { stage: 'validation' })
    return c.json(state.build('write_weights', [body.wallet], { model: model.address, weights: model.weights.map(w => w.address) }, () => { state.bytes.get(model.address)!.set(bytes, body.offset); addRange(model, body.offset, bytes.length); state.emit('model.updated', model) }))
  })
  app.post('/v1/models/:id/seal-range/build', async c => {
    const state = c.get('fixture'); const model = state.model(readParam(c, 'id', s.ModelId)); const body = await readJson(c, s.SealRangeRequest)
    if (model.status !== 'uploading') fail('MODEL_NOT_UPLOADING', 'This model is not in upload state.', { stage: 'build' })
    const allowedUploadKeys = model.upload?.uploadKeys.length ? model.upload.uploadKeys : [model.upload!.uploadKey]
    if (!allowedUploadKeys.includes(body.wallet)) fail('PROGRAM_REFUSED', 'An authorized upload key must sign range sealing.', { stage: 'simulation' })
    if (model.upload!.bytesWritten !== model.sizeBytes) fail('UPLOAD_INCOMPLETE', 'Upload the remaining byte ranges before sealing.', { stage: 'build' })
    const totalChunks = Math.ceil(model.sizeBytes / CIPHER_CHUNK_BYTES)
    const count = Math.min(body.chunkCount ?? s.SEAL_RANGE_CHUNKS, Math.max(0, totalChunks - model.sealedChunks))
    if (count === 0) fail('VALIDATION_ERROR', 'All ciphertext chunks have already been sealed.', { stage: 'validation' })
    return c.json(state.build('seal_range', [body.wallet], { model: model.address, weights: model.weights.map(w => w.address), uploadKey: body.wallet }, () => { model.sealedChunks += count; state.emit('model.updated', model) }))
  })
  app.post('/v1/models/:id/seal/build', async c => {
    const state = c.get('fixture'); const model = state.model(readParam(c, 'id', s.ModelId)); const body = await readJson(c, s.SealModelRequest); state.owner(model, body.wallet)
    if (model.status !== 'uploading') fail('MODEL_NOT_UPLOADING', 'This model is not in upload state.', { stage: 'build' })
    if (model.upload!.bytesWritten !== model.sizeBytes) fail('UPLOAD_INCOMPLETE', 'Upload the remaining byte ranges before sealing.', { stage: 'build' })
    if (toHex(ciphertextHash(state.bytes.get(model.address)!, model.hashVersion)) !== body.ciphertextSha256) fail('CIPHERTEXT_HASH_MISMATCH', 'The uploaded ciphertext does not match the sealing hash.', { stage: 'build' })
    const totalChunks = Math.ceil(model.sizeBytes / CIPHER_CHUNK_BYTES)
    return c.json(state.build('seal_model', [body.wallet], { model: model.address, uploadKey: model.upload!.uploadKey }, () => { model.status = 'sealed'; model.sealedSlot = String(state.slot); model.ciphertextSha256 = body.ciphertextSha256; model.sealedChunks = totalChunks; model.upload!.closed = true; state.emit('model.updated', model) }))
  })
  app.post('/v1/models/:id/price/build', async c => {
    const state = c.get('fixture'); const model = state.model(readParam(c, 'id', s.ModelId)); const body = await readJson(c, s.SetPriceRequest); state.owner(model, body.wallet)
    if (body.operatorShareBps + model.protocolShareBps! > 10000) fail('VALIDATION_ERROR', 'The operator and protocol shares exceed the price.', { stage: 'validation' })
    return c.json(state.build('set_price', [body.wallet], { model: model.address }, () => { model.price = body.price; model.priceUnit = body.priceUnit ?? model.priceUnit; model.operatorShareBps = body.operatorShareBps; state.emit('model.updated', model) }))
  })
  app.post('/v1/models/:id/versions/build', async c => {
    const state = c.get('fixture'); const model = state.model(readParam(c, 'id', s.ModelId)); const body = await readJson(c, s.BeginVersionRequest); state.owner(model, body.wallet)
    if (model.status !== 'sealed' && model.status !== 'live') fail('MODEL_NOT_LIVE', 'Seal the model before publishing a new version.', { stage: 'build' })
    const currentVersion = model.currentVersion ?? 1
    const version = body.version ?? (currentVersion + 1)
    if (version !== currentVersion + 1) fail('INVALID_VERSION', `Expected next version ${currentVersion + 1}.`, { stage: 'build' })
    if (body.noncePrefix === model.cipher.noncePrefix) fail('INVALID_VERSION', 'A new version must use a fresh nonce prefix.', { stage: 'build' })
    const mvAddress = fixtureAddress(`version:${model.address}:${version}`)
    return c.json(state.build('begin_version', [body.wallet], { model: model.address, modelVersion: mvAddress, weights: body.weights }, () => {
      state.stagedVersions.set(`${model.address}:${version}`, {
        version, address: mvAddress, weights: body.weights, sizeBytes: body.sizeBytes,
        noncePrefix: body.noncePrefix, manifest: body.manifest, base: body.base ?? null,
        bytes: new Uint8Array(body.sizeBytes), sealedChunks: 0,
      })
      const list = state.versions.get(model.address) ?? [{
        model: model.address, version: 1, address: null, status: 'live' as const,
        sizeBytes: model.sizeBytes, ciphertextSha256: model.ciphertextSha256, base: model.base,
        manifest: model.manifest, publishedSlot: model.sealedSlot,
      }]
      list.push({
        model: model.address, version, address: mvAddress, status: 'uploading',
        sizeBytes: body.sizeBytes, ciphertextSha256: null, base: body.base ?? null,
        manifest: body.manifest, publishedSlot: null,
      })
      state.versions.set(model.address, list)
    }))
  })
  app.post('/v1/models/:id/versions/write/build', async c => {
    const state = c.get('fixture'); const model = state.model(readParam(c, 'id', s.ModelId)); const body = await readJson(c, s.WriteVersionWeightsRequest); state.owner(model, body.wallet)
    const staged = state.stagedVersions.get(`${model.address}:${body.version}`)
    if (!staged) fail('INVALID_VERSION', 'This staged model version was not found.', { stage: 'build' })
    const chunk = fromBase64(body.bytesBase64)
    if (body.offset + chunk.length > staged.sizeBytes) fail('VALIDATION_ERROR', 'Write exceeds version ciphertext size.', { stage: 'validation' })
    return c.json(state.build('write_version_weights', [body.wallet], { model: model.address, modelVersion: staged.address, weights: [body.weights] }, () => {
      staged.bytes.set(chunk, body.offset)
    }))
  })
  app.post('/v1/models/:id/versions/seal-range/build', async c => {
    const state = c.get('fixture'); const model = state.model(readParam(c, 'id', s.ModelId)); const body = await readJson(c, s.SealVersionRangeRequest); state.owner(model, body.wallet)
    const staged = state.stagedVersions.get(`${model.address}:${body.version}`)
    if (!staged) fail('INVALID_VERSION', 'This staged model version was not found.', { stage: 'build' })
    const totalChunks = Math.ceil(staged.sizeBytes / CIPHER_CHUNK_BYTES)
    const count = Math.min(body.chunkCount ?? s.SEAL_RANGE_CHUNKS, Math.max(0, totalChunks - staged.sealedChunks))
    if (count === 0) fail('INVALID_VERSION', 'All version chunks are already sealed.', { stage: 'build' })
    return c.json(state.build('seal_version_range', [body.wallet], { model: model.address, modelVersion: staged.address }, () => {
      staged.sealedChunks += count
    }))
  })
  app.post('/v1/models/:id/versions/publish/build', async c => {
    const state = c.get('fixture'); const model = state.model(readParam(c, 'id', s.ModelId)); const body = await readJson(c, s.PublishVersionRequest); state.owner(model, body.wallet)
    const staged = state.stagedVersions.get(`${model.address}:${body.version}`)
    if (!staged) fail('INVALID_VERSION', 'This staged model version was not found.', { stage: 'build' })
    if (toHex(ciphertextHash(staged.bytes, 1)) !== body.ciphertextSha256) {
      fail('CIPHERTEXT_HASH_MISMATCH', 'The uploaded version ciphertext does not match the sealing hash.', { stage: 'build' })
    }
    return c.json(state.build('publish_version', [body.wallet], { model: model.address, modelVersion: staged.address }, () => {
      const slotStr = String(state.slot)
      const list = state.versions.get(model.address) ?? []
      for (const item of list) {
        if (item.status === 'live') item.status = 'archived'
        if (item.version === staged.version) {
          item.status = 'live'
          item.ciphertextSha256 = body.ciphertextSha256
          item.publishedSlot = slotStr
        }
      }
      state.versions.set(model.address, list)
      const chunks = Math.ceil(staged.sizeBytes / CIPHER_CHUNK_BYTES)
      model.currentVersion = staged.version
      model.sizeBytes = staged.sizeBytes
      model.plaintextSizeBytes = Math.max(0, staged.sizeBytes - chunks * 16)
      model.ciphertextSha256 = body.ciphertextSha256
      model.cipher = { ...model.cipher, noncePrefix: staged.noncePrefix }
      model.manifest = staged.manifest
      model.base = staged.base
      model.sealedChunks = chunks
      model.sealedSlot = slotStr
      state.bytes.set(model.address, staged.bytes.slice())
      state.stagedVersions.delete(`${model.address}:${staged.version}`)
      const liveItem = list.find(i => i.version === staged.version)
      state.emit('model.updated', model)
      if (liveItem) state.emit('version.published', liveItem)
    }))
  })
  app.post('/v1/enclaves/:key/quote/build', async c => {
    const state = c.get('fixture'); const enclave = state.enclave(readParam(c, 'key', s.Address)); const body = await readJson(c, s.SetQuoteRequest)
    const model = state.model(body.model)
    const operator = body.payer ?? enclave.operator
    if (operator !== enclave.operator) fail('UNAUTHORIZED', 'Only the enclave operator may set a quote for this grant.', { stage: 'build' })
    const grant = state.grants.find(g => g.model === model.address && g.enclave === enclave.address)
    if (!grant || grant.status === 'revoked') fail('GRANT_REQUIRED', 'This enclave does not hold an active grant for this model.', { stage: 'build' })
    if (body.operatorShareBps !== null && body.operatorShareBps > model.operatorShareBps) {
      fail('INVALID_QUOTE', 'The quoted operator share exceeds the model maximum operator share.', { stage: 'build' })
    }
    return c.json(state.build('set_quote', [operator], { model: model.address, grant: grant.address }, () => {
      grant.quotedOperatorShareBps = body.operatorShareBps
      state.emit('model.updated', model)
      state.emit('enclave.updated', enclave)
    }))
  })
  app.post('/v1/models/:id/grant/build', async c => {
    const state = c.get('fixture'); const model = state.model(readParam(c, 'id', s.ModelId)); const body = await readJson(c, s.GrantRequest); state.owner(model, body.wallet)
    if (model.status !== 'sealed' && model.status !== 'live') fail('MODEL_NOT_LIVE', 'Seal this model before granting an enclave.', { stage: 'build' })
    const enclave = state.liveEnclave(body.enclave)
    if (!model.allowedMeasurements.includes(enclave.measurement)) fail('MEASUREMENT_NOT_ALLOWED', 'The model does not allow this enclave measurement.', { stage: 'build' })
    const policy = state.policies.get(model.address)
    if (policy && policy.allowedOperators.length > 0 && !policy.allowedOperators.includes(enclave.operator)) {
      fail('POLICY_OPERATOR_DENIED', 'The enclave operator is not allowed by this model policy.', { stage: 'build' })
    }
    try { unwrapKey(fromBase64(body.wrappedKey), sha256(utf8('voynich/fixture/enclave/encryption/v1'))) }
    catch { fail('INVALID_ENVELOPE', 'The enclave could not open the wrapped model key.', { stage: 'build' }) }
    return c.json(state.build('grant_by_owner', [body.wallet], { model: model.address }, () => {
      state.grants = state.grants.filter(g => g.model !== model.address || g.enclave !== enclave.address)
      state.grants.push({ address: fixtureAddress(`grant:${model.address}:${enclave.address}`), model: model.address, modelName: model.name, enclave: enclave.address, wrappedKey: body.wrappedKey, grantedBy: body.wallet, grantedSlot: String(state.slot), status: 'live' })
      model.status = 'live'; model.enclavesHolding = state.grants.filter(g => g.model === model.address && g.status === 'live').length
      enclave.modelsHeld = state.grants.filter(g => g.enclave === enclave.address && g.status === 'live').length
      state.emit('model.updated', model); state.emit('enclave.updated', enclave)
    }))
  })
  app.post('/v1/models/:id/retire/build', async c => {
    const state = c.get('fixture'); const model = state.model(readParam(c, 'id', s.ModelId)); const body = await readJson(c, s.WalletRequest); state.owner(model, body.wallet)
    return c.json(state.build('retire_model', [body.wallet], { model: model.address }, () => { model.status = 'retired'; state.emit('model.updated', model) }))
  })
  app.post('/v1/models/:id/policy/build', async c => {
    const state = c.get('fixture'); const model = state.model(readParam(c, 'id', s.ModelId)); const body = await readJson(c, s.SetPolicyRequest); state.owner(model, body.wallet)
    const address = fixtureAddress(`policy:${model.address}`)
    const row: s.ModelPolicy = { address, model: model.address, allowListEnabled: body.allowListEnabled, allowedCallers: body.allowedCallers, maxCallsPerCallerPerWindow: body.maxCallsPerCallerPerWindow, windowSlots: body.windowSlots, allowedOperators: body.allowedOperators, allowedRegions: body.allowedRegions, updatedSlot: String(state.slot) }
    return c.json(state.build('set_policy', [body.wallet], { model: model.address, policy: address }, () => { state.policies.set(model.address, row); state.emit('policy.updated', row); state.emit('model.updated', model) }))
  })
  app.post('/v1/models/:id/policy/clear/build', async c => {
    const state = c.get('fixture'); const model = state.model(readParam(c, 'id', s.ModelId)); const body = await readJson(c, s.WalletRequest); state.owner(model, body.wallet)
    const existing = state.policies.get(model.address)
    if (!existing) fail('POLICY_NOT_FOUND', 'No policy is configured for this model.')
    return c.json(state.build('clear_policy', [body.wallet], { model: model.address, policy: existing.address }, () => { state.policies.delete(model.address); state.emit('policy.cleared', { model: model.address, policy: existing.address }); state.emit('model.updated', model) }))
  })
  app.post('/v1/models/:id/revoke/build', async c => {
    const state = c.get('fixture'), model = state.model(readParam(c, 'id', s.ModelId)), body = await readJson(c, s.RevokeGrantRequest)
    state.owner(model, body.wallet)
    const enclave = state.enclave(body.enclave), grant = state.grants.find(value => value.model === model.address && value.enclave === enclave.address)
    if (!grant) fail('GRANT_REQUIRED', 'This enclave does not hold a grant for this model.', { stage: 'build' })
    return c.json(state.build('revoke_grant', [body.wallet], { model: model.address }, () => {
      grant.status = 'revoked'
      model.enclavesHolding = state.grants.filter(value => value.model === model.address && value.status === 'live').length
      enclave.modelsHeld = state.grants.filter(value => value.enclave === enclave.address && value.status === 'live').length
      state.emit('model.updated', model); state.emit('enclave.updated', enclave)
    }))
  })
  app.post('/v1/calls/build', async c => {
    const state = c.get('fixture'); const body = await readJson(c, s.OpenCallRequest); const model = state.model(body.model); const enclave = state.liveEnclave(body.enclave); state.requireGrant(model, enclave)
    const policy = state.policies.get(model.address)
    if (policy && policy.allowListEnabled && !policy.allowedCallers.includes(body.wallet)) {
      fail('POLICY_CALLER_DENIED', 'This wallet is not on the model allow list.', { stage: 'build' })
    }
    const unitPrice = BigInt(model.price.amount)
    let escrowed: s.Money
    if (model.priceUnit === 'token') {
      if (body.ceiling === undefined) fail('VALIDATION_ERROR', 'Supply a ceiling for per-token models.', { stage: 'validation', fieldErrors: { ceiling: ['Required for per-token models.'] } })
      const ceiling = BigInt(body.ceiling)
      if (ceiling < unitPrice || (unitPrice > 0n && ceiling === 0n)) fail('VALIDATION_ERROR', 'Ceiling must be at least the per-token price.', { stage: 'validation', fieldErrors: { ceiling: ['Must be at least the per-token price.'] } })
      escrowed = { ...structuredClone(model.price), amount: body.ceiling }
    } else {
      if (body.ceiling !== undefined) fail('VALIDATION_ERROR', 'Ceiling is only used for per-token models.', { stage: 'validation', fieldErrors: { ceiling: ['Not used for per-call models.'] } })
      escrowed = structuredClone(model.price)
    }
    const call = fixtureAddress(`call:${crypto.randomUUID()}`)
    let buildAddresses: s.Build['addresses'] = { model: model.address, call }
    let refCommit: (() => void) | null = null
    if (body.referrer) {
      const cfg = state.referralConfigs.get(model.address)
      if (!cfg || !cfg.active || cfg.shareBps <= 0) {
        fail('INVALID_REFERRAL', 'This model does not have an active referral configuration.', { stage: 'build' })
      }
      const callRefAddr = fixtureAddress(`call-referral:${call}`)
      const refAddr = fixtureAddress(`referral:${model.address}:${body.referrer}`)
      buildAddresses = { ...buildAddresses, callReferral: callRefAddr, referral: refAddr }
      refCommit = () => {
        state.callReferrals.set(call, { referrer: body.referrer!, shareBps: cfg.shareBps, settled: false })
        const refKey = `${model.address}:${body.referrer!}`
        if (!state.referrals.has(refKey)) {
          const refRow: s.Referral = {
            address: refAddr, model: model.address, modelName: model.name, referrer: body.referrer!,
            mint: model.price.mint, totalEarned: '0', claimed: '0', claimable: '0', callsReferred: '0', updatedSlot: String(state.slot),
          }
          state.referrals.set(refKey, refRow)
          state.emit('referral.updated', refRow)
        }
      }
    }
    const row: s.Call = { address: call, caller: body.wallet, callerIsProgram: false, model: model.address, modelName: model.name, enclave: enclave.address, inputHash: body.inputHash, answerMode: body.answerMode, price: escrowed, priceUnit: model.priceUnit, unitPrice: structuredClone(model.price), ceiling: model.priceUnit === 'token' ? structuredClone(escrowed) : null, openedSlot: String(state.slot), deadlineSlot: String(state.slot + BigInt(fixtureConfig.callDeadlineSlots!)), status: 'open', receipt: null, failure: null }
    return c.json(state.build('open_call', [body.wallet], buildAddresses, () => { state.calls.unshift(row); refCommit?.(); state.emit('call.updated', row) }))
  })
  app.get('/v1/accounts/:wallet/sessions', c => {
    const state = c.get('fixture')
    const wallet = readParam(c, 'wallet', s.Address)
    const items = [...state.sessions.values()].filter(item => item.caller === wallet).sort((a, b) => Number(BigInt(b.openedSlot) - BigInt(a.openedSlot)))
    return c.json({ items, asOf: new Date().toISOString() })
  })
  app.get('/v1/sessions/:address', c => {
    const state = c.get('fixture')
    const address = readParam(c, 'address', s.Address)
    const session = state.sessions.get(address)
    if (!session) fail('SESSION_NOT_FOUND', 'This session was not found.')
    return c.json(session)
  })
  app.post('/v1/sessions/build', async c => {
    const state = c.get('fixture')
    const body = await readJson(c, s.OpenSessionRequest)
    const budgetBig = BigInt(body.budget)
    if (budgetBig <= 0n) fail('INVALID_SESSION', 'Session budget must be positive.', { stage: 'validation' })
    const nonce = body.nonce ?? String(BigInt(Math.floor(Math.random() * 1e12)))
    const expiresAtSlot = body.expiresAtSlot ?? String(state.slot + BigInt(body.durationSlots ?? '18000'))
    if (BigInt(expiresAtSlot) <= state.slot) fail('INVALID_SESSION', 'expiresAtSlot must be in the future.', { stage: 'validation' })
    const model = body.model ? state.model(body.model).address : null
    const mint = body.mint ?? null
    const address = fixtureAddress(`session:${body.wallet}:${body.delegate}:${nonce}`)
    const row: s.Session = {
      address,
      caller: body.wallet,
      delegate: body.delegate,
      nonce,
      mint,
      model,
      budget: { amount: body.budget, mint, decimals: mint ? 6 : 9, symbol: mint ? 'TOKEN' : 'SOL' },
      spent: '0',
      remaining: body.budget,
      callsOpened: '0',
      openedSlot: String(state.slot),
      expiresAtSlot,
      closedSlot: null,
      returnedAmount: null,
      status: 'open',
    }
    return c.json(state.build('open_session', [body.wallet], { session: address, ...(model ? { model } : {}) }, () => {
      state.sessions.set(address, row)
      state.emit('session.updated', row)
    }))
  })
  app.post('/v1/sessions/:address/close/build', async c => {
    const state = c.get('fixture')
    const address = readParam(c, 'address', s.Address)
    const body = await readJson(c, s.WalletRequest)
    const session = state.sessions.get(address)
    if (!session) fail('SESSION_NOT_FOUND', 'This session was not found.')
    if (session.status !== 'open') fail('INVALID_SESSION', 'This session is already closed.', { stage: 'build' })
    if (body.wallet !== session.caller && state.slot <= BigInt(session.expiresAtSlot)) {
      fail('UNAUTHORIZED', 'Only the caller can close an active session before expiry.', { stage: 'build' })
    }
    return c.json(state.build('close_session', [body.wallet], { session: address }, () => {
      session.returnedAmount = session.remaining
      session.remaining = '0'
      session.closedSlot = String(state.slot)
      session.status = 'closed'
      state.emit('session.updated', session)
    }))
  })
  app.post('/v1/sessions/:address/call/build', async c => {
    const state = c.get('fixture')
    const address = readParam(c, 'address', s.Address)
    const body = await readJson(c, s.OpenSessionCallRequest)
    const session = state.sessions.get(address)
    if (!session) fail('SESSION_NOT_FOUND', 'This session was not found.')
    if (session.status !== 'open') fail('INVALID_SESSION', 'This session is closed.', { stage: 'build' })
    if (body.delegate !== session.delegate) fail('UNAUTHORIZED', 'Only the session delegate can open calls on this session.', { stage: 'build' })
    if (state.slot > BigInt(session.expiresAtSlot)) fail('INVALID_SESSION', 'This session has expired.', { stage: 'build' })
    const model = state.model(body.model)
    const enclave = state.liveEnclave(body.enclave)
    state.requireGrant(model, enclave)
    if (session.model && session.model !== model.address) fail('INVALID_SESSION', 'This session is scoped to a different model.', { stage: 'build' })
    if (session.mint !== model.price.mint) fail('INVALID_SESSION', 'This session mint does not match the model price mint.', { stage: 'build' })
    const policy = state.policies.get(model.address)
    if (policy && policy.allowListEnabled && !policy.allowedCallers.includes(session.caller)) {
      fail('POLICY_CALLER_DENIED', 'The session caller is not on the model allow list.', { stage: 'build' })
    }
    const unitPrice = BigInt(model.price.amount)
    let escrowed: s.Money
    if (model.priceUnit === 'token') {
      if (body.ceiling === undefined) fail('VALIDATION_ERROR', 'Supply a ceiling for per-token models.', { stage: 'validation', fieldErrors: { ceiling: ['Required for per-token models.'] } })
      const ceiling = BigInt(body.ceiling)
      if (ceiling < unitPrice || (unitPrice > 0n && ceiling === 0n)) fail('VALIDATION_ERROR', 'Ceiling must be at least the per-token price.', { stage: 'validation', fieldErrors: { ceiling: ['Must be at least the per-token price.'] } })
      escrowed = { ...structuredClone(model.price), amount: body.ceiling }
    } else {
      if (body.ceiling !== undefined) fail('VALIDATION_ERROR', 'Ceiling is only used for per-token models.', { stage: 'validation', fieldErrors: { ceiling: ['Not used for per-call models.'] } })
      escrowed = structuredClone(model.price)
    }
    const escrowAmount = BigInt(escrowed.amount)
    const remaining = BigInt(session.remaining)
    if (remaining < escrowAmount) fail('INVALID_SESSION', 'Session budget remaining is less than the call escrow.', { stage: 'build' })
    const call = fixtureAddress(`call:${crypto.randomUUID()}`)
    const row: s.Call = { address: call, caller: session.caller, callerIsProgram: false, model: model.address, modelName: model.name, enclave: enclave.address, inputHash: body.inputHash, answerMode: body.answerMode, price: escrowed, priceUnit: model.priceUnit, unitPrice: structuredClone(model.price), ceiling: model.priceUnit === 'token' ? structuredClone(escrowed) : null, openedSlot: String(state.slot), deadlineSlot: String(state.slot + BigInt(fixtureConfig.callDeadlineSlots!)), status: 'open', receipt: null, failure: null }
    return c.json(state.build('open_session_call', [body.delegate], { session: address, model: model.address, call }, () => {
      session.spent = String(BigInt(session.spent) + escrowAmount)
      session.remaining = String(remaining - escrowAmount)
      session.callsOpened = String(BigInt(session.callsOpened) + 1n)
      state.calls.unshift(row)
      state.emit('call.updated', row)
      state.emit('session.updated', session)
    }))
  })
  app.post('/v1/models/:id/split/build', async c => {
    const state = c.get('fixture'); const model = state.model(readParam(c, 'id', s.ModelId)); const body = await readJson(c, s.SetSplitRequest)
    state.owner(model, body.wallet)
    const splitAddress = fixtureAddress(`split:${model.address}`)
    const existing = state.splits.get(model.address)
    if (body.recipients.length > 0 && existing) {
      if (existing.recipients.some(r => BigInt(r.accrued) > BigInt(r.claimed))) {
        fail('INVALID_SPLIT', 'All existing split recipients must claim accrued funds before replacing recipients.', { stage: 'build' })
      }
    }
    return c.json(state.build('set_split', [body.wallet], { model: model.address, split: splitAddress }, () => {
      if (body.recipients.length === 0) {
        const retained = (existing?.recipients ?? [])
          .filter(r => BigInt(r.accrued) > BigInt(r.claimed))
          .map(r => ({ ...r, shareBps: 0 }))
        const next: s.ModelSplit = {
          address: splitAddress,
          model: model.address,
          authority: body.wallet,
          mint: existing?.mint ?? model.price.mint,
          active: false,
          totalReceived: existing?.totalReceived ?? '0',
          recipients: retained,
          updatedSlot: String(state.slot),
        }
        state.splits.set(model.address, next)
        model.hasSplit = false
        state.emit('model.updated', model)
        state.emit('split.updated', next)
      } else {
        const next: s.ModelSplit = {
          address: splitAddress,
          model: model.address,
          authority: body.wallet,
          mint: model.price.mint,
          active: true,
          totalReceived: existing?.totalReceived ?? '0',
          recipients: body.recipients.map(r => ({ wallet: r.wallet, shareBps: r.shareBps, accrued: '0', claimed: '0', claimable: '0' })),
          updatedSlot: String(state.slot),
        }
        state.splits.set(model.address, next)
        model.hasSplit = true
        state.emit('model.updated', model)
        state.emit('split.updated', next)
      }
    }))
  })
  app.post('/v1/models/:id/split/claim/build', async c => {
    const state = c.get('fixture'); const model = state.model(readParam(c, 'id', s.ModelId)); const body = await readJson(c, s.ClaimSplitRequest)
    const split = state.splits.get(model.address)
    if (!split) fail('SPLIT_NOT_FOUND', 'No revenue split is configured for this model.')
    const target = body.recipient ?? body.wallet
    const entry = split.recipients.find(r => r.wallet === target)
    if (!entry || BigInt(entry.accrued) <= BigInt(entry.claimed)) {
      fail('INVALID_SPLIT', 'No unclaimed split balance is available for this recipient.', { stage: 'build' })
    }
    return c.json(state.build('claim_split', [body.wallet], { model: model.address, split: split.address }, () => {
      split.recipients = split.recipients.map(r => r.wallet === target ? { ...r, claimed: r.accrued, claimable: '0' } : r)
      split.updatedSlot = String(state.slot)
      state.emit('split.updated', split)
    }))
  })
  app.post('/v1/calls/:id/settle/build', async c => {
    const state = c.get('fixture'); const call = state.call(readParam(c, 'id', s.Address)); const body = await readJson(c, s.SettleCallRequest)
    return c.json(state.settleMetered(call, body))
  })
  app.post('/v1/models/:id/benchmarks/build', async c => {
    const state = c.get('fixture'); const model = state.model(readParam(c, 'id', s.ModelId)); const body = await readJson(c, s.PublishBenchmarkRequest)
    if (state.benchmarks.some(b => b.model === model.address && b.name === body.name)) {
      fail('INVALID_BENCHMARK', `Benchmark "${body.name}" already exists for this model.`, { stage: 'build' })
    }
    const scoreBps = body.scoreBps ?? Math.floor((body.passedCount * 10000) / body.sampleCount)
    const address = fixtureAddress(`benchmark:${model.address}:${body.name}`)
    const record: s.BenchmarkRecord = {
      address,
      model: model.address,
      modelName: model.name,
      publisher: body.wallet,
      name: body.name,
      modelVersion: model.currentVersion ?? 1,
      datasetSha256: body.datasetSha256,
      datasetUri: body.datasetUri,
      sampleCount: body.sampleCount,
      passedCount: body.passedCount,
      scoreBps,
      receipts: body.receipts,
      publishedSlot: String(state.slot),
    }
    return c.json(state.build('publish_benchmark', [body.wallet], { model: model.address, benchmark: address }, () => {
      state.benchmarks.unshift(record)
      state.emit('benchmark.published', record)
    }))
  })
  app.post('/v1/enclaves/:key/bond/deposit/build', async c => {
    const state = c.get('fixture'); const enclave = state.enclave(readParam(c, 'key', s.Address)); const body = await readJson(c, s.DepositBondRequest)
    if (enclave.operator !== body.wallet) fail('UNAUTHORIZED', 'Only the enclave operator can deposit into its bond.', { stage: 'build' })
    const bondAddress = fixtureAddress(`bond:${enclave.address}`)
    const amount = BigInt(body.amountLamports)
    return c.json(state.build('deposit_bond', [body.wallet], { bond: bondAddress }, () => {
      const existing = state.bonds.get(enclave.address)
      const next: s.OperatorBond = {
        address: bondAddress,
        enclave: enclave.address,
        operator: body.wallet,
        bondedLamports: String(BigInt(existing?.bondedLamports ?? '0') + amount),
        slashedTotal: existing?.slashedTotal ?? '0',
        missedCalls: existing?.missedCalls ?? '0',
        slashBps: existing?.slashBps ?? s.DEFAULT_BOND_SLASH_BPS,
        updatedSlot: String(state.slot),
      }
      state.bonds.set(enclave.address, next)
      enclave.bondedLamports = next.bondedLamports
      enclave.missedCalls = next.missedCalls
      enclave.slashedTotal = next.slashedTotal
      state.emit('bond.updated', next)
      state.emit('enclave.updated', enclave)
    }))
  })
  app.post('/v1/enclaves/:key/bond/withdraw/build', async c => {
    const state = c.get('fixture'); const enclave = state.enclave(readParam(c, 'key', s.Address)); const body = await readJson(c, s.WithdrawBondRequest)
    if (enclave.operator !== body.wallet) fail('UNAUTHORIZED', 'Only the enclave operator can withdraw from its bond.', { stage: 'build' })
    const existing = state.bonds.get(enclave.address)
    if (!existing) fail('BOND_NOT_FOUND', 'No operator bond is configured for this enclave.')
    const amount = BigInt(body.amountLamports)
    const available = BigInt(existing.bondedLamports)
    if (amount <= 0n || amount > available) fail('INVALID_BOND', 'Withdraw amount exceeds the available bonded lamports.', { stage: 'build' })
    return c.json(state.build('withdraw_bond', [body.wallet], { bond: existing.address }, () => {
      const next: s.OperatorBond = {
        ...existing,
        bondedLamports: String(available - amount),
        updatedSlot: String(state.slot),
      }
      state.bonds.set(enclave.address, next)
      enclave.bondedLamports = next.bondedLamports
      state.emit('bond.updated', next)
      state.emit('enclave.updated', enclave)
    }))
  })
  app.post('/v1/calls/:id/refund/build', async c => {
    const state = c.get('fixture'); const call = state.call(readParam(c, 'id', s.Address)); const body = await readJson(c, s.WalletRequest)
    if (call.status !== 'refundable' && !(call.status === 'open' && BigInt(call.deadlineSlot) < state.slot)) fail('CALL_NOT_REFUNDABLE', 'This call is not past its deadline or has already settled.', { stage: 'build' })
    return c.json(state.build('refund_call', [body.wallet], { call: call.address, model: call.model }, () => { call.status = 'refunded'; if (call.failure) call.failure.refundState = 'refunded'; state.answers.delete(call.address); state.emit('call.updated', call) }))
  })
  app.post('/v1/bounties/build', async c => {
    const state = c.get('fixture'); const body = await readJson(c, s.PostBountyRequest); const model = state.model(body.model)
    const address = fixtureAddress(`bounty:${crypto.randomUUID()}`)
    const row: s.Bounty = { address, creator: body.wallet, nonce: body.nonce ?? String(state.slot), model: model.address, modelName: model.name, targetLabel: body.targetLabel, reward: body.reward, status: 'open', winner: null, winningCall: null, winningReceipt: null, createdSlot: String(state.slot), claimedSlot: null, attempts: '0' }
    return c.json(state.build('post_bounty', [body.wallet], { model: model.address, bounty: address }, () => { state.bounties.unshift(row); state.emit('bounty.updated', row) }))
  })
  app.post('/v1/bounties/:address/draw/build', async c => {
    const state = c.get('fixture'); const bounty = state.bounty(readParam(c, 'address', s.Address)); const body = await readJson(c, s.DrawBountyRequest)
    if (bounty.status !== 'open') fail('BOUNTY_NOT_OPEN', 'This bounty is no longer open.', { stage: 'build' })
    const model = state.model(bounty.model); const enclave = state.liveEnclave(body.enclave); state.requireGrant(model, enclave)
    const call = fixtureAddress(`bounty-call:${crypto.randomUUID()}`), attempt = fixtureAddress(`bounty-attempt:${call}`)
    const callerPda = fixtureAddress(`bounty-caller:${bounty.address}`)
    const callRow: s.Call = { address: call, caller: callerPda, callerIsProgram: true, model: model.address, modelName: model.name, enclave: enclave.address, inputHash: body.inputHash, answerMode: 'open', price: structuredClone(model.price), priceUnit: 'call', unitPrice: structuredClone(model.price), ceiling: null, openedSlot: String(state.slot), deadlineSlot: String(state.slot + BigInt(fixtureConfig.callDeadlineSlots!)), status: 'open', receipt: null, failure: null }
    const attemptRow: s.BountyAttempt = { address: attempt, bounty: bounty.address, drawer: body.wallet, call, createdSlot: String(state.slot), refunded: false }
    return c.json(state.build('draw_bounty', [body.wallet], { model: model.address, bounty: bounty.address, attempt, call }, () => { state.calls.unshift(callRow); state.bountyAttempts.unshift(attemptRow); bounty.attempts = String(BigInt(bounty.attempts) + 1n); state.emit('call.updated', callRow); state.emit('bounty.updated', bounty) }))
  })
  app.post('/v1/bounties/:address/collect/build', async c => {
    const state = c.get('fixture'); const bounty = state.bounty(readParam(c, 'address', s.Address)); const body = await readJson(c, s.CollectBountyRequest)
    if (bounty.status !== 'open') fail('BOUNTY_NOT_OPEN', 'This bounty is no longer open.', { stage: 'build' })
    const attempt = state.bountyAttempts.find(a => a.bounty === bounty.address && a.call === body.call)
    if (!attempt) fail('CALL_NOT_FOUND', 'No bounty attempt was found for this call.')
    const receipt = state.receipts.find(r => r.call === body.call)
    if (!receipt) fail('RECEIPT_NOT_FOUND', 'This receipt was not found.')
    return c.json(state.build('collect_bounty', [body.wallet], { model: bounty.model, bounty: bounty.address, attempt: attempt.address, call: body.call }, () => { bounty.status = 'claimed'; bounty.winner = attempt.drawer; bounty.winningCall = body.call; bounty.winningReceipt = receipt.address; bounty.claimedSlot = String(state.slot); state.emit('bounty.updated', bounty) }))
  })
  app.post('/v1/bounties/:address/cancel/build', async c => {
    const state = c.get('fixture'); const bounty = state.bounty(readParam(c, 'address', s.Address)); const body = await readJson(c, s.WalletRequest)
    if (bounty.status !== 'open') fail('BOUNTY_NOT_OPEN', 'This bounty is no longer open.', { stage: 'build' })
    if (bounty.creator !== body.wallet) fail('PROGRAM_REFUSED', 'Only the bounty creator can cancel this bounty.', { stage: 'simulation' })
    return c.json(state.build('cancel_bounty', [body.wallet], { model: bounty.model, bounty: bounty.address }, () => { bounty.status = 'cancelled'; state.emit('bounty.updated', bounty) }))
  })
  app.post('/v1/measurements/build', async c => {
    const state = c.get('fixture'); const body = await readJson(c, s.PublishMeasurementRequest)
    if (state.measurements.some(m => m.digest === body.digest)) fail('MEASUREMENT_ALREADY_EXISTS', 'A measurement record for this digest already exists.', { stage: 'build' })
    const address = fixtureAddress(`measurement:${body.digest}`)
    const row: s.MeasurementRecord = { address, digest: body.digest, publisher: body.wallet, sourceRepo: body.sourceRepo, commitSha: body.commitSha, recipeHash: body.recipeHash, version: body.version, createdSlot: String(state.slot), status: 'active' }
    return c.json(state.build('publish_measurement', [body.wallet], { measurement: address }, () => { state.measurements.unshift(row); state.emit('measurement.updated', row) }))
  })
  app.post('/v1/measurements/:digest/deprecate/build', async c => {
    const state = c.get('fixture'); const digest = readParam(c, 'digest', s.HardwareMeasurement); const body = await readJson(c, s.WalletRequest)
    const row = state.measurements.find(m => m.digest === digest)
    if (!row) fail('MEASUREMENT_NOT_FOUND', 'This measurement was not found.')
    if (row.status === 'deprecated') fail('MEASUREMENT_DEPRECATED', 'This measurement is already deprecated.', { stage: 'build' })
    if (row.publisher !== body.wallet && body.wallet !== FIXTURE.owner) fail('UNAUTHORIZED', 'Only the measurement publisher or protocol admin can deprecate this measurement.', { stage: 'build' })
    return c.json(state.build('deprecate_measurement', [body.wallet], { measurement: row.address }, () => { row.status = 'deprecated'; state.emit('measurement.updated', row) }))
  })
  app.post('/v1/models/:id/pass-plan/build', async c => {
    const state = c.get('fixture'); const model = state.model(readParam(c, 'id', s.ModelId)); const body = await readJson(c, s.SetPassPlanRequest)
    state.owner(model, body.wallet)
    if (model.priceUnit !== 'call') fail('INVALID_PASS', 'Prepaid pass plans require a per-call model.', { stage: 'build' })
    if (body.active && BigInt(body.pricePerCall) > BigInt(model.price.amount)) {
      fail('INVALID_PASS', 'Pass pricePerCall cannot exceed the model price.', { stage: 'build' })
    }
    const address = fixtureAddress(`pass-plan:${model.address}`)
    const next: s.PassPlan = {
      address,
      model: model.address,
      modelName: model.name,
      authority: body.wallet,
      mint: model.price.mint,
      pricePerCall: body.pricePerCall,
      minCalls: body.minCalls,
      maxCalls: body.maxCalls,
      ttlSlots: body.ttlSlots,
      active: body.active,
      updatedSlot: String(state.slot),
    }
    return c.json(state.build('set_pass_plan', [body.wallet], { model: model.address, passPlan: address }, () => {
      state.passPlans.set(model.address, next)
      state.emit('pass_plan.updated', next)
    }))
  })
  app.post('/v1/passes/buy/build', async c => {
    const state = c.get('fixture'); const body = await readJson(c, s.BuyPassRequest); const model = state.model(body.model)
    if (model.status !== 'live') fail('MODEL_NOT_LIVE', 'This model is not accepting new calls.', { stage: 'build' })
    const plan = state.passPlans.get(model.address)
    if (!plan || !plan.active) fail('INVALID_PASS', 'No active prepaid pass plan is configured for this model.', { stage: 'build' })
    if (body.callsTotal < plan.minCalls || body.callsTotal > plan.maxCalls) {
      fail('INVALID_PASS', `callsTotal must be between ${plan.minCalls} and ${plan.maxCalls}.`, { stage: 'build' })
    }
    const nonce = body.nonce ?? String(Date.now())
    const address = fixtureAddress(`pass:${model.address}:${body.wallet}:${nonce}`)
    const escrow = BigInt(body.callsTotal) * BigInt(plan.pricePerCall)
    const purchasedSlot = state.slot
    const expiresAtSlot = purchasedSlot + BigInt(plan.ttlSlots)
    const next: s.Pass = {
      address,
      model: model.address,
      modelName: model.name,
      holder: body.wallet,
      nonce,
      mint: plan.mint,
      pricePerCall: plan.pricePerCall,
      callsTotal: body.callsTotal,
      callsUsed: 0,
      callsRemaining: body.callsTotal,
      escrowRemaining: String(escrow),
      returnedAmount: '0',
      purchasedSlot: String(purchasedSlot),
      expiresAtSlot: String(expiresAtSlot),
      closedSlot: null,
      status: 'open',
      updatedSlot: String(state.slot),
    }
    return c.json(state.build('buy_pass', [body.wallet], { model: model.address, passPlan: plan.address, pass: address }, () => {
      state.passes.set(address, next)
      state.emit('pass.updated', next)
    }))
  })
  app.post('/v1/passes/call/build', async c => {
    const state = c.get('fixture'); const body = await readJson(c, s.OpenPassCallRequest)
    const pass = state.passes.get(body.pass)
    if (!pass) fail('PASS_NOT_FOUND', 'This prepaid pass was not found.')
    if (pass.holder !== body.wallet) fail('UNAUTHORIZED', 'Only the pass holder can spend calls from this pass.', { stage: 'build' })
    if (pass.status !== 'open' || pass.callsUsed >= pass.callsTotal || state.slot > BigInt(pass.expiresAtSlot)) {
      fail('INVALID_PASS', 'This pass is closed, expired, or has no remaining calls.', { stage: 'build' })
    }
    const model = state.model(pass.model); const enclave = state.liveEnclave(body.enclave); state.requireGrant(model, enclave)
    const callAddress = fixtureAddress(`pass-call:${crypto.randomUUID()}`)
    const price = { ...structuredClone(model.price), amount: pass.pricePerCall }
    const callRow: s.Call = {
      address: callAddress, caller: pass.holder, callerIsProgram: false, model: model.address, modelName: model.name,
      enclave: enclave.address, inputHash: body.inputHash, answerMode: body.answerMode ?? 'sealed', price,
      priceUnit: 'call', unitPrice: structuredClone(price), ceiling: null,
      openedSlot: String(state.slot), deadlineSlot: String(state.slot + BigInt(fixtureConfig.callDeadlineSlots!)),
      status: 'open', receipt: null, failure: null,
    }
    return c.json(state.build('open_pass_call', [body.wallet], { model: model.address, pass: pass.address, call: callAddress }, () => {
      pass.callsUsed += 1
      pass.callsRemaining = Math.max(0, pass.callsTotal - pass.callsUsed)
      pass.escrowRemaining = String(BigInt(pass.escrowRemaining) - BigInt(pass.pricePerCall))
      pass.updatedSlot = String(state.slot)
      state.calls.unshift(callRow)
      state.emit('call.updated', callRow)
      state.emit('pass.updated', pass)
    }))
  })
  app.post('/v1/passes/close/build', async c => {
    const state = c.get('fixture'); const body = await readJson(c, s.ClosePassRequest)
    const pass = state.passes.get(body.pass)
    if (!pass) fail('PASS_NOT_FOUND', 'This prepaid pass was not found.')
    if (pass.status !== 'open') fail('INVALID_PASS', 'This pass is already closed.', { stage: 'build' })
    const expiredOrExhausted = state.slot > BigInt(pass.expiresAtSlot) || pass.callsUsed >= pass.callsTotal
    if (pass.holder !== body.wallet && !expiredOrExhausted) {
      fail('UNAUTHORIZED', 'Only the pass holder can close an active pass before expiry.', { stage: 'build' })
    }
    return c.json(state.build('close_pass', [body.wallet], { model: pass.model, pass: pass.address }, () => {
      pass.returnedAmount = pass.escrowRemaining
      pass.escrowRemaining = '0'
      pass.closedSlot = String(state.slot)
      pass.status = 'closed'
      pass.updatedSlot = String(state.slot)
      state.emit('pass.updated', pass)
    }))
  })
  app.post('/v1/models/:id/referral/build', async c => {
    const state = c.get('fixture'); const model = state.model(readParam(c, 'id', s.ModelId)); const body = await readJson(c, s.SetReferralConfigRequest)
    state.owner(model, body.wallet)
    const address = fixtureAddress(`referral-config:${model.address}`)
    const next: s.ReferralConfig = {
      address, model: model.address, modelName: model.name,
      shareBps: body.shareBps, active: body.active, updatedSlot: String(state.slot),
    }
    return c.json(state.build('set_referral_config', [body.wallet], { model: model.address, referralConfig: address }, () => {
      state.referralConfigs.set(model.address, next)
      state.emit('referral_config.updated', next)
    }))
  })
  app.post('/v1/models/:id/referral/claim/build', async c => {
    const state = c.get('fixture'); const model = state.model(readParam(c, 'id', s.ModelId)); const body = await readJson(c, s.ClaimReferralRequest)
    const referrer = body.referrer ?? body.wallet
    const refKey = `${model.address}:${referrer}`
    const row = state.referrals.get(refKey)
    if (!row) fail('REFERRAL_NOT_FOUND', 'No referral account was found for this model and referrer.')
    if (BigInt(row.claimable) <= 0n) fail('INVALID_REFERRAL', 'No unclaimed referral balance is available for this referrer.', { stage: 'build' })
    return c.json(state.build('claim_referral', [body.wallet], { model: model.address, referral: row.address }, () => {
      row.claimed = row.totalEarned
      row.claimable = '0'
      row.updatedSlot = String(state.slot)
      state.emit('referral.updated', row)
    }))
  })
  return app
}
