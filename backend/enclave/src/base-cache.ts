import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

export type BaseModelRef = {
  sha256: string
  sizeBytes: number
  format: string
  source: string
}

export type VerifiedAssetRef = {
  sha256: string
  format: string
  source: string
  sizeBytes?: number
  maxSizeBytes?: number
}

export type BaseCacheOptions = {
  cacheDir?: string
  allowLocal?: boolean
  ipfsGateway?: string
  hfBaseUrl?: string
  timeoutMs?: number
  fetch?: typeof fetch
}

const HASH_RE = /^[0-9a-f]{64}$/
const ZERO_HASH_RE = /^0{64}$/

function isPrivateOrLoopbackHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return true
  }
  if (host === '::1' || host === '::' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) {
    return true
  }
  const v4Mapped = host.startsWith('::ffff:') ? host.slice(7) : host
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(v4Mapped)
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])]
    if (a === 0 || a === 10 || a === 127) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 100 && b >= 64 && b <= 127) return true
  }
  return false
}

/**
 * Resolves https://, http://, hf://<owner>/<repo>[@<rev>]/<path>, and ipfs://<cid>[/<path>]
 * base model sources into fetchable HTTP(S) URLs, blocking private/loopback hosts unless allowed.
 */
export function resolveBaseUrl(
  source: string,
  options: Pick<BaseCacheOptions, 'allowLocal' | 'ipfsGateway' | 'hfBaseUrl'> = {},
): string {
  if (!source || /[\s\x00-\x1f\x7f]/.test(source)) {
    throw new Error('Base model source URI is invalid.')
  }
  const allowLocal = options.allowLocal ?? (process.env.CLUSTER === 'localnet' || process.env.ENCLAVE_ALLOW_LOCAL_BASE === '1')
  let resolved: string
  if (source.startsWith('https://') || source.startsWith('http://')) {
    resolved = source
  } else if (source.startsWith('hf://')) {
    const rest = source.slice('hf://'.length)
    const parts = rest.split('/')
    if (parts.length < 3 || !parts[0] || !parts[1]) {
      throw new Error('hf:// base source must have the form hf://<owner>/<repo>[@<rev>]/<path>.')
    }
    const owner = parts[0]
    const repoAndRev = parts[1]
    const atIndex = repoAndRev.indexOf('@')
    const repo = atIndex >= 0 ? repoAndRev.slice(0, atIndex) : repoAndRev
    const rev = atIndex >= 0 ? repoAndRev.slice(atIndex + 1) : 'main'
    const filePath = parts.slice(2).join('/')
    if (!repo || !rev || !filePath) {
      throw new Error('hf:// base source must include non-empty repo, revision, and file path.')
    }
    const base = (options.hfBaseUrl ?? process.env.ENCLAVE_HF_BASE_URL ?? 'https://huggingface.co').replace(/\/+$/, '')
    resolved = `${base}/${owner}/${repo}/resolve/${encodeURIComponent(rev)}/${filePath}`
  } else if (source.startsWith('ipfs://')) {
    const rest = source.slice('ipfs://'.length).replace(/^\/+/, '')
    if (!rest) throw new Error('ipfs:// base source must include a CID.')
    const gateway = (options.ipfsGateway ?? process.env.ENCLAVE_IPFS_GATEWAY ?? 'https://ipfs.io').replace(/\/+$/, '')
    resolved = `${gateway}/ipfs/${rest}`
  } else {
    throw new Error('Unsupported base model source scheme.')
  }

  let parsed: URL
  try { parsed = new URL(resolved) } catch { throw new Error('Resolved base model URL is invalid.') }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Resolved base model URL must use http or https.')
  }
  if (!allowLocal && isPrivateOrLoopbackHost(parsed.hostname)) {
    throw new Error('Refusing to fetch base model from a private or loopback host outside localnet.')
  }
  return parsed.toString()
}

export function defaultBaseCacheDir(statePath = process.env.ENCLAVE_STATE_PATH ?? '.local/enclave.sealed.json'): string {
  return resolve(process.env.ENCLAVE_BASE_CACHE_DIR?.trim() || join(dirname(resolve(statePath)), 'base-cache'))
}

/**
 * Fetches a verified open asset (base model or tokenizer) with strict streaming byte cap
 * (exact sizeBytes when supplied, otherwise <= maxSizeBytes) and single-pass SHA-256 verification,
 * caching verified files content-addressed under cacheDir (re-verifying on cache read with auto-recovery).
 */
export async function fetchVerifiedBase(
  base: BaseModelRef | VerifiedAssetRef,
  options: BaseCacheOptions = {},
): Promise<{ bytes: Uint8Array; fromCache: boolean; elapsedMs: number; cachePath: string }> {
  const startedAt = Date.now()
  const expectedHash = base.sha256.toLowerCase()
  if (!HASH_RE.test(expectedHash) || ZERO_HASH_RE.test(expectedHash)) {
    throw new Error('Base model SHA-256 is invalid.')
  }
  const exactSize = base.sizeBytes
  const maxBytes = exactSize !== undefined
    ? exactSize
    : (('maxSizeBytes' in base && base.maxSizeBytes !== undefined) ? base.maxSizeBytes : 32 * 1024 * 1024)
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error('Base model sizeBytes must be a positive integer.')
  }
  const safeFormat = /^[a-z0-9_-]{1,32}$/.test(base.format) ? base.format : 'bin'
  const cacheDir = resolve(options.cacheDir ?? defaultBaseCacheDir())
  const cachePath = join(cacheDir, `${expectedHash}.${safeFormat}`)

  if (existsSync(cachePath)) {
    try {
      const cached = new Uint8Array(readFileSync(cachePath))
      const sizeOk = exactSize !== undefined ? cached.length === exactSize : cached.length > 0 && cached.length <= maxBytes
      if (sizeOk && createHash('sha256').update(cached).digest('hex') === expectedHash) {
        return { bytes: cached, fromCache: true, elapsedMs: Math.max(0, Date.now() - startedAt), cachePath }
      }
    } catch {}
    // Corrupted or truncated cache entry: delete and recover from source.
    try { unlinkSync(cachePath) } catch {}
  }

  const url = resolveBaseUrl(base.source, options)
  const fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis)
  const response = await fetchFn(url, { signal: AbortSignal.timeout(options.timeoutMs ?? 120_000) })
  if (!response.ok) {
    throw new Error(`Base model download failed with HTTP ${response.status}.`)
  }
  const contentLength = response.headers?.get?.('content-length')
  if (contentLength !== null && contentLength !== undefined && contentLength.trim() !== '') {
    const declared = Number(contentLength)
    if (Number.isFinite(declared)) {
      if (exactSize !== undefined && declared !== exactSize) {
        throw new Error(`Base model Content-Length ${declared} does not match expected ${exactSize}.`)
      }
      if (declared > maxBytes) {
        throw new Error(`Base model Content-Length ${declared} exceeds maximum ${maxBytes}.`)
      }
    }
  }

  const hasher = createHash('sha256')
  const fixedBuffer = exactSize !== undefined ? new Uint8Array(exactSize) : null
  const chunks: Uint8Array[] = []
  let received = 0

  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (!value || value.length === 0) continue
        if (received + value.length > maxBytes) {
          await reader.cancel().catch(() => {})
          throw new Error(`Base model stream exceeded declared sizeBytes (${maxBytes}).`)
        }
        if (fixedBuffer) fixedBuffer.set(value, received)
        else chunks.push(value.slice())
        hasher.update(value)
        received += value.length
      }
    } finally {
      reader.releaseLock()
    }
  } else {
    const buf = new Uint8Array(await response.arrayBuffer())
    if (buf.length > maxBytes) {
      throw new Error(`Base model body exceeded declared sizeBytes (${maxBytes}).`)
    }
    if (fixedBuffer) fixedBuffer.set(buf, 0)
    else chunks.push(buf)
    hasher.update(buf)
    received = buf.length
  }

  if (exactSize !== undefined && received !== exactSize) {
    throw new Error(`Base model length ${received} does not match expected ${exactSize}.`)
  }
  if (received === 0) {
    throw new Error('Base model download returned an empty body.')
  }
  const actualHash = hasher.digest('hex')
  if (actualHash !== expectedHash) {
    throw new Error(`Base model SHA-256 mismatch: expected ${expectedHash}, got ${actualHash}.`)
  }

  let output: Uint8Array
  if (fixedBuffer) {
    output = fixedBuffer
  } else if (chunks.length === 1) {
    output = chunks[0]!
  } else {
    output = new Uint8Array(received)
    let offset = 0
    for (const chunk of chunks) {
      output.set(chunk, offset)
      offset += chunk.length
    }
  }

  mkdirSync(cacheDir, { recursive: true })
  const tmpPath = `${cachePath}.${randomUUID()}.tmp`
  try {
    writeFileSync(tmpPath, output)
    renameSync(tmpPath, cachePath)
  } catch (error) {
    try { unlinkSync(tmpPath) } catch {}
    throw error
  }

  return { bytes: output, fromCache: false, elapsedMs: Math.max(0, Date.now() - startedAt), cachePath }
}
