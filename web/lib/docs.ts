// The docs set on disk: the index, the pages that exist, their headings and their text.
// Server only. Everything is read from content/docs at request time, so a page appears when its file lands.

import fs from 'node:fs'
import path from 'node:path'

export const DOCS_DIR = path.join(process.cwd(), 'content', 'docs')
export const SAMPLE = '_sample'

export type IndexPage = { slug: string; title: string; job?: string }
export type IndexGroup = { id: string; title: string; pages: IndexPage[] }
export type DocsIndex = { base: string; home: string; groups: IndexGroup[] }
export type NavPage = { slug: string; title: string }
export type NavGroup = { id: string; title: string; pages: NavPage[] }
export type Heading = { depth: 2 | 3; id: string; text: string }
export type Page = { slug: string; title: string; description: string; body: string }
export type SearchEntry = { slug: string; page: string; section: string; id: string; text: string }

const SLUG = /^[a-z0-9_-]+(\/[a-z0-9_-]+)*$/

export function fileOf(slug: string) {
  return path.join(DOCS_DIR, ...slug.split('/')) + '.mdx'
}

export function exists(slug: string) {
  return SLUG.test(slug) && fs.existsSync(fileOf(slug))
}

export function readIndex(): DocsIndex {
  return JSON.parse(fs.readFileSync(path.join(DOCS_DIR, 'index.json'), 'utf8')) as DocsIndex
}

/** The rail: the index's groups in its order, holding only the pages whose file exists. */
export function readNav(): NavGroup[] {
  return readIndex()
    .groups.map((g) => ({ id: g.id, title: g.title, pages: g.pages.filter((p) => exists(p.slug)).map((p) => ({ slug: p.slug, title: p.title })) }))
    .filter((g) => g.pages.length > 0)
}

/** Where /docs lands. */
export function homeSlug(): string {
  const index = readIndex()
  if (exists(index.home)) return index.home
  return readNav()[0]?.pages[0]?.slug ?? SAMPLE
}

export function readPage(slug: string): Page | null {
  if (!exists(slug)) return null
  const raw = fs.readFileSync(fileOf(slug), 'utf8').replace(/^﻿/, '')
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw)
  const meta: Record<string, string> = {}
  if (m) {
    for (const line of m[1]!.split(/\r?\n/)) {
      const kv = /^([A-Za-z]+):\s*(.*)$/.exec(line)
      if (kv) meta[kv[1]!] = kv[2]!.trim().replace(/^(['"])(.*)\1$/, '$2')
    }
  }
  const listed = readIndex().groups.flatMap((g) => g.pages).find((p) => p.slug === slug)
  return { slug, title: meta.title ?? listed?.title ?? slug, description: meta.description ?? listed?.job ?? '', body: m ? raw.slice(m[0].length) : raw }
}

/** A heading's anchor: its words in lowercase joined by hyphens. Repeats on one page take -2, -3. */
export function anchor(text: string, seen: Map<string, number>) {
  const base = text.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-') || 'section'
  const n = (seen.get(base) ?? 0) + 1
  seen.set(base, n)
  return n === 1 ? base : `${base}-${n}`
}

// Markdown and kit markup down to the words a reader sees.
function plain(s: string) {
  return s
    .replace(/<\/?[A-Za-z][^>]*>/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*~]/g, '')
    .replace(/^\s*(?:[-+>]|\d+\.)\s+/, '')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** A page as sections for search: the top of the page, then one per h2 or h3. */
export function sections(page: Page): SearchEntry[] {
  const out: SearchEntry[] = [{ slug: page.slug, page: page.title, section: '', id: '', text: '' }]
  const seen = new Map<string, number>()
  let fence = false
  for (const line of page.body.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; continue }
    const h = fence ? null : /^(#{2,3})\s+(.+?)\s*#*$/.exec(line)
    if (h) {
      const text = plain(h[2]!)
      out.push({ slug: page.slug, page: page.title, section: text, id: anchor(text, seen), text: '' })
      continue
    }
    if (!fence && /^\s*\|?\s*:?-{3,}/.test(line)) continue
    const words = fence ? line.trim() : plain(line)
    if (words) out[out.length - 1]!.text += (out[out.length - 1]!.text ? ' ' : '') + words
  }
  return out
}

let cache: { key: string; entries: SearchEntry[] } | null = null

/** Every existing page of the index as search entries, rebuilt only when a file changes. */
export function searchEntries(): SearchEntry[] {
  const slugs = readNav().flatMap((g) => g.pages.map((p) => p.slug))
  const key = slugs.map((s) => `${s}:${fs.statSync(fileOf(s)).mtimeMs}`).join('|')
  if (cache?.key === key) return cache.entries
  const entries = slugs.flatMap((s) => { const p = readPage(s); return p ? sections(p) : [] })
  cache = { key, entries }
  return entries
}

/** A list the code defines, read by <Rows>: content/docs/data/<name>.json, an array of objects. */
export function readRows(name: string): Record<string, unknown>[] {
  if (!/^[a-z0-9_-]+$/.test(name)) throw new Error(`<Rows data="${name}">: a data name is lowercase letters, digits, hyphens and underscores.`)
  const file = [path.join(DOCS_DIR, 'data', `${name}.json`), path.join(process.cwd(), 'components', 'docs', 'data', `${name}.json`)].find((f) => fs.existsSync(f))
  if (!file) throw new Error(`<Rows data="${name}">: content/docs/data/${name}.json does not exist.`)
  const rows: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (!Array.isArray(rows)) throw new Error(`<Rows data="${name}">: content/docs/data/${name}.json must hold an array of objects.`)
  return rows as Record<string, unknown>[]
}
