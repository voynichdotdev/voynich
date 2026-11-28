import { createInterface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'
import { MCP_PROTOCOL_VERSION, MCP_TOOLS, type AnswerMode } from '@voynich/contract'
import { createVoynich, type RoutingStrategy, type SessionAuth, type Voynich, type VoynichSigner } from './client.js'
import type { SketchInput } from './preprocess.js'

export type JsonRpcRequest = {
  jsonrpc?: string
  id?: string | number | null
  method: string
  params?: Record<string, unknown>
}

export type JsonRpcResponse = {
  jsonrpc: '2.0'
  id: string | number | null
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

export type McpServerOptions = {
  client?: Voynich
  apiUrl?: string
  rpcUrl?: string
  signer?: VoynichSigner
  headers?: Record<string, string>
  fetch?: typeof fetch
  pollMs?: number
  webUrl?: string
  session?: SessionAuth
  pass?: string
  referrer?: string
  strategy?: RoutingStrategy
  enclave?: string
  answerMode?: AnswerMode
  ceiling?: string
  input?: Readable
  output?: Writable
}

export type McpServer = {
  handleRequest(message: JsonRpcRequest): Promise<JsonRpcResponse | null>
  start(): Promise<void>
  stop(): void
}

const SERVER_VERSION = '0.2.58'

function toolOk(payload: unknown) {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    isError: false,
  }
}

function toolError(message: string) {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  }
}

export function createMcpServer(options: McpServerOptions = {}): McpServer {
  const apiUrl = options.apiUrl ?? 'https://api.voynich.dev'
  const webBase = (options.webUrl ?? 'https://voynich.dev').replace(/\/+$/, '')
  const hasSigner = Boolean(options.client || options.signer || options.session)
  const client = options.client ?? createVoynich({
    apiUrl,
    ...(options.rpcUrl ? { rpcUrl: options.rpcUrl } : {}),
    ...(options.signer ? { signer: options.signer } : {}),
    ...(options.headers ? { headers: options.headers } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.pollMs !== undefined ? { pollMs: options.pollMs } : {}),
  })

  async function callTool(name: string, args: Record<string, unknown>) {
    if (name === 'voynich_list_models') {
      const limit = typeof args.limit === 'number' && Number.isFinite(args.limit)
        ? Math.max(1, Math.min(100, Math.floor(args.limit)))
        : 50
      const page = await client.models({ limit, sort: 'calls' })
      return toolOk({
        models: page.items.map(m => ({
          slug: m.name,
          address: m.address,
          status: m.status,
          inputKind: m.manifest.inputKind,
          priceUnit: m.priceUnit,
          price: m.price,
          enclavesHolding: m.enclavesHolding,
          callsSettled: m.callsSettled,
          currentVersion: m.currentVersion ?? 1,
          url: `${webBase}/models/${m.name}`,
        })),
        count: page.items.length,
      })
    }

    if (name === 'voynich_call_model') {
      if (!hasSigner) {
        return toolError('No signer configured for voynich_call_model. Start voynich mcp with --keypair <file> or --session <pda> --delegate <file>.')
      }
      const modelId = typeof args.model === 'string' ? args.model.trim() : ''
      if (!modelId) return toolError('Missing required argument "model".')
      if (args.input === undefined || args.input === null) return toolError('Missing required argument "input".')

      const maxTokens = typeof args.maxTokens === 'number' && Number.isFinite(args.maxTokens) && args.maxTokens > 0
        ? Math.floor(args.maxTokens)
        : undefined
      const answerMode = (args.answerMode === 'open' || args.answerMode === 'sealed')
        ? args.answerMode
        : options.answerMode
      const strategy = (args.strategy === 'balanced' || args.strategy === 'cheapest' || args.strategy === 'fastest')
        ? args.strategy
        : options.strategy
      const enclave = typeof args.enclave === 'string' && args.enclave.trim() ? args.enclave.trim() : options.enclave
      const pass = typeof args.pass === 'string' && args.pass.trim() ? args.pass.trim() : options.pass
      const referrer = typeof args.referrer === 'string' && args.referrer.trim() ? args.referrer.trim() : options.referrer

      const modelMeta = await client.model(modelId)
      let callInput: string | number[] | SketchInput = args.input as string | number[] | SketchInput
      if (modelMeta.manifest.inputKind !== 'text' && typeof args.input === 'string') {
        try {
          callInput = JSON.parse(args.input) as number[] | SketchInput
        } catch {
          callInput = args.input
        }
      }

      if (modelMeta.priceUnit === 'token' && modelMeta.manifest.inputKind === 'text') {
        const prompt = typeof callInput === 'string' ? callInput : JSON.stringify(callInput)
        const ceiling = typeof args.ceiling === 'string' && args.ceiling.trim()
          ? args.ceiling.trim()
          : options.ceiling ?? String(BigInt(modelMeta.price.amount) * BigInt(maxTokens ?? 64))
        const active = await client.stream(modelMeta.address, prompt, {
          ceiling,
          ...(maxTokens !== undefined ? { maxTokens } : {}),
          ...(enclave ? { enclave } : {}),
          ...(strategy ? { strategy } : {}),
          ...(options.session ? { session: options.session } : {}),
        })
        for await (const _ of active) { /* drain verified stream pieces */ }
        const final = await active.final()
        return toolOk({
          model: modelMeta.name,
          output: { text: final.text, tokens: final.count, finishReason: final.finishReason },
          receipt: final.receipt.address,
          call: final.call.address,
          paid: final.spentAmount,
          returned: final.returnedAmount,
          verified: final.verified,
          checks: final.checks,
          verifyUrl: `${webBase}/receipts/${final.receipt.address}`,
        })
      }

      const res = await client.call(modelMeta.address, callInput, {
        ...(answerMode ? { answerMode } : {}),
        ...(enclave ? { enclave } : {}),
        ...(strategy ? { strategy } : {}),
        ...(maxTokens !== undefined ? { maxTokens } : {}),
        ...(typeof args.ceiling === 'string' ? { ceiling: args.ceiling } : options.ceiling ? { ceiling: options.ceiling } : {}),
        ...(options.session ? { session: options.session } : {}),
        ...(pass ? { pass } : {}),
        ...(referrer ? { referrer } : {}),
      })
      return toolOk({
        model: modelMeta.name,
        output: res.output,
        receipt: res.receipt.address,
        call: res.receipt.call,
        paid: res.receipt.payments.total,
        verified: res.verified,
        checks: res.checks,
        verifyUrl: `${webBase}/receipts/${res.receipt.address}`,
      })
    }

    if (name === 'voynich_verify_receipt') {
      const receiptId = typeof args.receipt === 'string' ? args.receipt.trim() : ''
      if (!receiptId) return toolError('Missing required argument "receipt".')
      const verification = await client.verify(receiptId)
      return toolOk({
        receipt: verification.receipt.address,
        model: verification.receipt.modelName,
        enclave: verification.receipt.enclave,
        verified: verification.verified,
        fixture: verification.fixture,
        checks: {
          signature: verification.signature,
          record: verification.record,
          expiry: verification.expiry,
          answer: verification.answer,
          base: verification.base,
        },
        reason: verification.reason ?? null,
        verifyUrl: `${webBase}/receipts/${verification.receipt.address}`,
      })
    }

    if (name === 'voynich_model_benchmarks') {
      const modelId = typeof args.model === 'string' ? args.model.trim() : ''
      if (!modelId) return toolError('Missing required argument "model".')
      const limit = typeof args.limit === 'number' && Number.isFinite(args.limit)
        ? Math.max(1, Math.min(100, Math.floor(args.limit)))
        : 20
      const page = await client.listModelBenchmarks(modelId, { limit })
      return toolOk({
        model: modelId,
        benchmarks: page.items,
        count: page.items.length,
      })
    }

    if (name === 'voynich_model_quorums') {
      const modelId = typeof args.model === 'string' ? args.model.trim() : ''
      if (!modelId) return toolError('Missing required argument "model".')
      const limit = typeof args.limit === 'number' && Number.isFinite(args.limit)
        ? Math.max(1, Math.min(100, Math.floor(args.limit)))
        : 20
      const page = await client.listModelQuorums(modelId, { limit })
      return toolOk({
        model: modelId,
        quorums: page.items.map(q => ({ ...q, url: `${webBase}/quorums/${q.address}` })),
        count: page.items.length,
      })
    }

    return toolError(`Unknown tool "${name}".`)
  }

  async function handleRequest(message: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    const hasId = message.id !== undefined
    const id = message.id ?? null

    if (message.method === 'notifications/initialized' || (!hasId && message.method.startsWith('notifications/'))) {
      return null
    }

    try {
      if (message.method === 'initialize') {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: 'voynich', version: SERVER_VERSION },
          },
        }
      }

      if (message.method === 'ping') {
        return { jsonrpc: '2.0', id, result: {} }
      }

      if (message.method === 'tools/list') {
        return { jsonrpc: '2.0', id, result: { tools: [...MCP_TOOLS] } }
      }

      if (message.method === 'tools/call') {
        const params = (message.params ?? {}) as Record<string, unknown>
        const toolName = typeof params.name === 'string' ? params.name : ''
        const toolArgs = (params.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments))
          ? params.arguments as Record<string, unknown>
          : {}
        if (!toolName) {
          return { jsonrpc: '2.0', id, error: { code: -32602, message: 'Missing tool name.' } }
        }
        try {
          const result = await callTool(toolName, toolArgs)
          return { jsonrpc: '2.0', id, result }
        } catch (error) {
          const msg = error instanceof Error ? error.message : 'Tool execution failed.'
          return { jsonrpc: '2.0', id, result: toolError(msg) }
        }
      }

      if (!hasId) return null
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${message.method}` },
      }
    } catch (error) {
      if (!hasId) return null
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32603, message: error instanceof Error ? error.message : 'Internal server error.' },
      }
    }
  }

  let rl: ReturnType<typeof createInterface> | null = null

  return {
    handleRequest,
    start() {
      const input = options.input ?? process.stdin
      const output = options.output ?? process.stdout
      rl = createInterface({ input, crlfDelay: Infinity })
      return new Promise<void>((resolveDone) => {
        let chain = Promise.resolve()
        rl!.on('line', (line) => {
          const trimmed = line.trim()
          if (!trimmed) return
          chain = chain.then(async () => {
            let parsed: JsonRpcRequest
            try {
              parsed = JSON.parse(trimmed) as JsonRpcRequest
            } catch {
              const errResp: JsonRpcResponse = {
                jsonrpc: '2.0',
                id: null,
                error: { code: -32700, message: 'Parse error: invalid JSON.' },
              }
              output.write(JSON.stringify(errResp) + '\n')
              return
            }
            const response = await handleRequest(parsed)
            if (response !== null) {
              output.write(JSON.stringify(response) + '\n')
            }
          })
        })
        rl!.on('close', () => {
          void chain.finally(() => resolveDone())
        })
      })
    },
    stop() {
      rl?.close()
      rl = null
    },
  }
}
