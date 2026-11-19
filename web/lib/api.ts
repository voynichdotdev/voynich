// The API client, from the backend's contract package. One for server components, one for the browser.
// `fixture` names a sample scenario on a fixture-mode API (the `?fixture=` query on any page); a chain-mode API ignores it.

import { createClient, type VoynichClient } from '@voynich/contract'
import { API_URL, API_URL_SERVER } from './env'

const clients = new Map<string, VoynichClient>()

export function api(fixture?: string | null): VoynichClient {
  const server = typeof window === 'undefined'
  const key = `${server ? 's' : 'b'}:${fixture ?? ''}`
  let c = clients.get(key)
  if (!c) {
    const headers: Record<string, string> = {}
    if (fixture) headers['X-Fixture'] = fixture
    if (!server) headers['X-Fixture-Session'] = session()
    c = createClient(server ? API_URL_SERVER : API_URL, server ? { headers, fetch: serverFetch } : { headers })
    clients.set(key, c)
  }
  return c
}

// On the server the tab's session comes from its cookie, so a page rendered right after a write in
// the browser reads the same state the browser wrote.
const serverFetch: typeof fetch = async (input, init) => {
  const headers = new Headers(init?.headers)
  try {
    const { cookies } = await import('next/headers')
    const id = (await cookies()).get('voynich.session')?.value
    if (id && /^[\w-]{1,64}$/.test(id)) headers.set('X-Fixture-Session', id)
  } catch {}
  return fetch(input, { ...init, headers, cache: 'no-store' })
}

// One id per tab, so a fixture-mode API keeps this tab's writes together.
function session(): string {
  try {
    let id = sessionStorage.getItem('voynich.session')
    if (!id) { id = crypto.randomUUID(); sessionStorage.setItem('voynich.session', id) }
    document.cookie = `voynich.session=${id}; path=/; samesite=lax`
    return id
  } catch { return 'tab' }
}

export function fixtureFrom(searchParams: Record<string, string | string[] | undefined> | URLSearchParams | null | undefined): string | null {
  if (!searchParams) return null
  const v = searchParams instanceof URLSearchParams ? searchParams.get('fixture') : searchParams.fixture
  return typeof v === 'string' && /^[a-z0-9-]+$/i.test(v) ? v : null
}

// A read that never throws: pages render their failed state from the reason.
export type Read<T> = { ok: true; data: T } | { ok: false; code: string; message: string; status?: number }
export async function read<T>(p: Promise<T>): Promise<Read<T>> {
  try {
    return { ok: true, data: await p }
  } catch (e) {
    const x = e as { code?: string; message?: string; status?: number; body?: { error?: { code?: string; message?: string } } }
    return { ok: false, code: x.body?.error?.code ?? x.code ?? 'UNREACHABLE', message: x.body?.error?.message ?? x.message ?? 'The API did not answer.', status: x.status }
  }
}

// A read made right after a confirmation: the API's index follows the chain by a moment, so the read is
// repeated while it answers `missing` (or until `ready` holds), for at most `timeoutMs`.
export async function indexed<T>(get: () => Promise<T>, missing: string, ready: (value: T) => boolean = () => true, timeoutMs = 30_000): Promise<T> {
  const started = Date.now()
  for (;;) {
    try {
      const value = await get()
      if (ready(value) || Date.now() - started > timeoutMs) return value
    } catch (e) {
      const code = (e as { code?: string; body?: { error?: { code?: string } } }).body?.error?.code ?? (e as { code?: string }).code
      if (code !== missing || Date.now() - started > timeoutMs) throw e
    }
    await new Promise((r) => setTimeout(r, 500))
  }
}
