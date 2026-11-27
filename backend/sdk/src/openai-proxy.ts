import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { AnswerMode, StreamFinishReason } from '@voynich/contract'
import { createVoynich, type CallOutput, type RoutingStrategy, type SessionAuth, type Voynich, type VoynichSigner } from './client.js'
import type { SketchInput } from './preprocess.js'

export type OpenAIChatMessage = {
  role: string
  content: string | Array<{ type?: string; text?: string }> | null
}

export type OpenAICompatServerOptions = {
  client?: Voynich
  apiUrl?: string
  rpcUrl?: string
  signer?: VoynichSigner
  headers?: Record<string, string>
  fetch?: typeof fetch
  pollMs?: number
  host?: string
  port?: number
  webUrl?: string
  session?: SessionAuth
  pass?: string
  referrer?: string
  strategy?: RoutingStrategy
  enclave?: string
  answerMode?: AnswerMode
  ceiling?: string
}

export type OpenAICompatServer = {
  readonly server: Server
  listen(): Promise<{ host: string; port: number; url: string }>
  close(): Promise<void>
}

function extractMessageText(content: OpenAIChatMessage['content']): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map(part => (typeof part?.text === 'string' ? part.text : ''))
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

export function formatMessagesAsPrompt(messages: ReadonlyArray<OpenAIChatMessage>): string {
  const normalized = messages
    .map(m => ({ role: String(m.role ?? 'user').trim().toLowerCase(), text: extractMessageText(m.content).trim() }))
    .filter(m => m.text.length > 0)
  if (normalized.length === 0) return ''
  if (normalized.length === 1 && normalized[0]!.role === 'user') {
    return normalized[0]!.text
  }
  const lines = normalized.map(m => {
    const label = m.role === 'system' ? 'System' : m.role === 'assistant' ? 'Assistant' : 'User'
    return `${label}: ${m.text}`
  })
  lines.push('Assistant:')
  return lines.join('\n\n')
}

function formatCallOutput(output: CallOutput): string {
  if ('text' in output && typeof output.text === 'string') return output.text
  if ('label' in output && typeof output.label === 'string') {
    return JSON.stringify(output)
  }
  return JSON.stringify(output)
}

function mapFinishReason(reason: StreamFinishReason | null | undefined): 'stop' | 'length' {
  if (reason === 'length' || reason === 'ceiling') return 'length'
  return 'stop'
}

function estimateTokens(text: string): number {
  const trimmed = text.trim()
  if (!trimmed) return 0
  return Math.max(1, Math.ceil(trimmed.length / 4))
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Voynich-Session, X-Voynich-Pass',
    'Access-Control-Expose-Headers': 'X-Voynich-Receipt, X-Voynich-Model, X-Voynich-Verify-Url',
  }
}

function writeJson(res: ServerResponse, status: number, payload: unknown, extraHeaders: Record<string, string> = {}) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...corsHeaders(),
    ...extraHeaders,
  })
  res.end(body)
}

function writeOpenAIError(res: ServerResponse, status: number, message: string, type = 'invalid_request_error', code: string | null = null) {
  writeJson(res, status, { error: { message, type, code } })
}

async function readBodyJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buf.length
    if (total > 4 * 1024 * 1024) throw new Error('Request body exceeds 4 MiB limit.')
    chunks.push(buf)
  }
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (!text) return {}
  return JSON.parse(text)
}

export function createOpenAICompatServer(options: OpenAICompatServerOptions): OpenAICompatServer {
  const apiUrl = options.apiUrl ?? 'https://api.voynich.dev'
  const host = options.host ?? '127.0.0.1'
  const requestedPort = options.port ?? 8787
  const webBase = (options.webUrl ?? 'https://voynich.dev').replace(/\/+$/, '')
  const client = options.client ?? createVoynich({
    apiUrl,
    ...(options.rpcUrl ? { rpcUrl: options.rpcUrl } : {}),
    ...(options.signer ? { signer: options.signer } : {}),
    ...(options.headers ? { headers: options.headers } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.pollMs !== undefined ? { pollMs: options.pollMs } : {}),
  })

  let boundPort = requestedPort

  const server = createServer(async (req, res) => {
    try {
      const method = (req.method ?? 'GET').toUpperCase()
      const url = new URL(req.url ?? '/', `http://${host}:${boundPort}`)
      const path = url.pathname

      if (method === 'OPTIONS') {
        res.writeHead(204, corsHeaders())
        res.end()
        return
      }

      if (method === 'GET' && path === '/health') {
        writeJson(res, 200, { status: 'ok', api: apiUrl, host, port: boundPort })
        return
      }

      if (method === 'GET' && path === '/v1/models') {
        const list = await client.api.openaiModels()
        writeJson(res, 200, list)
        return
      }

      if (method === 'POST' && path === '/v1/chat/completions') {
        let parsed: Record<string, unknown>
        try {
          const raw = await readBodyJson(req)
          if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            writeOpenAIError(res, 400, 'Request body must be a JSON object.', 'invalid_request_error', 'invalid_body')
            return
          }
          parsed = raw as Record<string, unknown>
        } catch (error) {
          writeOpenAIError(res, 400, error instanceof Error ? error.message : 'Invalid JSON body.', 'invalid_request_error', 'invalid_json')
          return
        }

        const modelId = typeof parsed.model === 'string' ? parsed.model.trim() : ''
        if (!modelId) {
          writeOpenAIError(res, 400, 'Missing required field "model".', 'invalid_request_error', 'missing_model')
          return
        }
        if (!Array.isArray(parsed.messages) || parsed.messages.length === 0) {
          writeOpenAIError(res, 400, 'Missing required non-empty array "messages".', 'invalid_request_error', 'missing_messages')
          return
        }
        const messages = parsed.messages as OpenAIChatMessage[]
        const prompt = formatMessagesAsPrompt(messages)
        if (!prompt) {
          writeOpenAIError(res, 400, 'Messages did not contain any text content.', 'invalid_request_error', 'empty_messages')
          return
        }

        const stream = Boolean(parsed.stream)
        const maxTokens = typeof parsed.max_tokens === 'number' && Number.isFinite(parsed.max_tokens) && parsed.max_tokens > 0
          ? Math.floor(parsed.max_tokens)
          : undefined
        const modelMeta = await client.model(modelId)

        let callInput: string | number[] | SketchInput = prompt
        if (modelMeta.manifest.inputKind !== 'text') {
          const lastUser = [...messages].reverse().find(m => String(m.role ?? '').toLowerCase() === 'user')
          const rawText = lastUser ? extractMessageText(lastUser.content).trim() : prompt
          try {
            const candidate = JSON.parse(rawText) as unknown
            if (Array.isArray(candidate) || (candidate && typeof candidate === 'object')) {
              callInput = candidate as number[] | SketchInput
            }
          } catch {
            callInput = prompt
          }
        }

        const ceiling = typeof parsed.ceiling === 'string'
          ? parsed.ceiling
          : options.ceiling ?? (modelMeta.priceUnit === 'token'
              ? String(BigInt(modelMeta.price.amount) * BigInt(maxTokens ?? 64))
              : undefined)
        const created = Math.floor(Date.now() / 1000)

        if (stream) {
          if (modelMeta.priceUnit === 'token' && modelMeta.manifest.inputKind === 'text') {
            const active = await client.stream(modelMeta.address, prompt, {
              ceiling: ceiling!,
              ...(maxTokens !== undefined ? { maxTokens } : {}),
              ...(options.enclave ? { enclave: options.enclave } : {}),
              ...(options.strategy ? { strategy: options.strategy } : {}),
              ...(options.session ? { session: options.session } : {}),
            })
            res.writeHead(200, {
              'Content-Type': 'text/event-stream; charset=utf-8',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive',
              'X-Accel-Buffering': 'no',
              'X-Voynich-Model': modelMeta.name,
              ...corsHeaders(),
            })
            const sendChunk = (chunk: unknown) => {
              res.write(`data: ${JSON.stringify(chunk)}\n\n`)
            }
            const chunkId = `voynich-${active.call.address}`
            let first = true
            for await (const piece of active) {
              sendChunk({
                id: chunkId,
                object: 'chat.completion.chunk',
                created,
                model: modelMeta.name,
                choices: [{
                  index: 0,
                  delta: first ? { role: 'assistant', content: piece.text } : { content: piece.text },
                  finish_reason: null,
                }],
              })
              first = false
            }
            const final = await active.final()
            const verifyUrl = `${webBase}/receipts/${final.receipt.address}`
            sendChunk({
              id: `voynich-${final.receipt.address}`,
              object: 'chat.completion.chunk',
              created,
              model: modelMeta.name,
              choices: [{
                index: 0,
                delta: {},
                finish_reason: mapFinishReason(final.finishReason),
              }],
              voynich: {
                receipt: final.receipt.address,
                call: final.call.address,
                verifyUrl,
                paid: final.spentAmount,
              },
            })
            res.write('data: [DONE]\n\n')
            res.end()
            return
          }

          const called = await client.call(modelMeta.address, callInput, {
            ...(options.answerMode ? { answerMode: options.answerMode } : {}),
            ...(options.enclave ? { enclave: options.enclave } : {}),
            ...(options.strategy ? { strategy: options.strategy } : {}),
            ...(maxTokens !== undefined ? { maxTokens } : {}),
            ...(options.session ? { session: options.session } : {}),
            ...(options.pass ? { pass: options.pass } : {}),
            ...(options.referrer ? { referrer: options.referrer } : {}),
          })
          res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
            'X-Voynich-Model': modelMeta.name,
            'X-Voynich-Receipt': called.receipt.address,
            'X-Voynich-Verify-Url': `${webBase}/receipts/${called.receipt.address}`,
            ...corsHeaders(),
          })
          const sendChunk = (chunk: unknown) => {
            res.write(`data: ${JSON.stringify(chunk)}\n\n`)
          }
          const content = formatCallOutput(called.output)
          const verifyUrl = `${webBase}/receipts/${called.receipt.address}`
          const chunkId = `voynich-${called.receipt.address}`
          sendChunk({
            id: chunkId,
            object: 'chat.completion.chunk',
            created,
            model: modelMeta.name,
            choices: [{
              index: 0,
              delta: { role: 'assistant', content },
              finish_reason: null,
            }],
          })
          sendChunk({
            id: chunkId,
            object: 'chat.completion.chunk',
            created,
            model: modelMeta.name,
            choices: [{
              index: 0,
              delta: {},
              finish_reason: 'stop',
            }],
            voynich: {
              receipt: called.receipt.address,
              call: called.receipt.call,
              verifyUrl,
              paid: called.receipt.payments.total,
            },
          })
          res.write('data: [DONE]\n\n')
          res.end()
          return
        }

        // Non-streaming chat.completion
        if (modelMeta.priceUnit === 'token' && modelMeta.manifest.inputKind === 'text') {
          const active = await client.stream(modelMeta.address, prompt, {
            ...(ceiling ? { ceiling } : {}),
            ...(maxTokens !== undefined ? { maxTokens } : {}),
            ...(options.enclave ? { enclave: options.enclave } : {}),
            ...(options.strategy ? { strategy: options.strategy } : {}),
            ...(options.session ? { session: options.session } : {}),
          })
          for await (const _ of active) { /* drain stream */ }
          const streamed = await active.final()
          const verifyUrl = `${webBase}/receipts/${streamed.receipt.address}`
          const promptTokens = estimateTokens(prompt)
          const completionTokens = streamed.count
          writeJson(res, 200, {
            id: `voynich-${streamed.receipt.address}`,
            object: 'chat.completion',
            created,
            model: modelMeta.name,
            choices: [{
              index: 0,
              message: { role: 'assistant', content: streamed.text },
              finish_reason: mapFinishReason(streamed.finishReason),
            }],
            usage: {
              prompt_tokens: promptTokens,
              completion_tokens: completionTokens,
              total_tokens: promptTokens + completionTokens,
            },
            voynich: {
              receipt: streamed.receipt.address,
              call: streamed.call.address,
              verifyUrl,
              paid: streamed.spentAmount,
            },
          }, {
            'X-Voynich-Receipt': streamed.receipt.address,
            'X-Voynich-Model': modelMeta.name,
            'X-Voynich-Verify-Url': verifyUrl,
          })
          return
        }

        const called = await client.call(modelMeta.address, callInput, {
          ...(options.answerMode ? { answerMode: options.answerMode } : {}),
          ...(options.enclave ? { enclave: options.enclave } : {}),
          ...(options.strategy ? { strategy: options.strategy } : {}),
          ...(maxTokens !== undefined ? { maxTokens } : {}),
          ...(options.session ? { session: options.session } : {}),
          ...(options.pass ? { pass: options.pass } : {}),
          ...(options.referrer ? { referrer: options.referrer } : {}),
        })
        const content = formatCallOutput(called.output)
        const verifyUrl = `${webBase}/receipts/${called.receipt.address}`
        const promptTokens = estimateTokens(prompt)
        const completionTokens = 'tokens' in called.output && typeof called.output.tokens === 'number'
          ? called.output.tokens
          : estimateTokens(content)
        writeJson(res, 200, {
          id: `voynich-${called.receipt.address}`,
          object: 'chat.completion',
          created,
          model: modelMeta.name,
          choices: [{
            index: 0,
            message: { role: 'assistant', content },
            finish_reason: 'stop',
          }],
          usage: {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: promptTokens + completionTokens,
          },
          voynich: {
            receipt: called.receipt.address,
            call: called.receipt.call,
            verifyUrl,
            paid: called.receipt.payments.total,
          },
        }, {
          'X-Voynich-Receipt': called.receipt.address,
          'X-Voynich-Model': modelMeta.name,
          'X-Voynich-Verify-Url': verifyUrl,
        })
        return
      }

      writeOpenAIError(res, 404, `Route ${method} ${path} not found.`, 'invalid_request_error', 'not_found')
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : 'internal_error'
      const status = code === 'MODEL_NOT_FOUND' ? 404 : code === 'INVALID_INPUT' || code === 'VALIDATION_ERROR' ? 400 : 500
      const message = error instanceof Error ? error.message : 'Internal proxy error.'
      if (!res.headersSent) {
        writeOpenAIError(res, status, message, status >= 500 ? 'server_error' : 'invalid_request_error', code)
      } else {
        res.end()
      }
    }
  })

  return {
    server,
    listen() {
      return new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(requestedPort, host, () => {
          server.off('error', reject)
          const addr = server.address() as AddressInfo
          boundPort = addr.port
          resolve({ host, port: boundPort, url: `http://${host}:${boundPort}` })
        })
      })
    },
    close() {
      return new Promise((resolve, reject) => {
        server.close(err => (err ? reject(err) : resolve()))
      })
    },
  }
}
