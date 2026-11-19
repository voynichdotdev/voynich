'use client'

// What stands around a docs page: the rail of chapters, its sheet on a phone, and search.

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { NavGroup, SearchEntry } from '@/lib/docs'
import s from './docs.module.css'

const Glass = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
    <rect x="1.75" y="1.75" width="7.5" height="7.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <path d="M9 9l3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
  </svg>
)

// The ochre tick beside the page the reader is on.
const Here = () => (
  <svg className={s.here} viewBox="0 0 6 20" aria-hidden="true">
    <path d="M3.3 1.5 C 2.4 6, 3.9 11, 2.9 18.5" fill="none" stroke="var(--ochre)" strokeWidth="2" strokeLinecap="round" />
  </svg>
)

function Pages({ groups, slug }: { groups: NavGroup[]; slug: string }) {
  return (
    <nav aria-label="Docs" className={s.groups}>
      {groups.map((g) => (
        <section key={g.id} className={s.group}>
          <p className={s.groupTitle}>{g.title}</p>
          <ul>
            {g.pages.map((p) => (
              <li key={p.slug}>
                <Link href={`/docs/${p.slug}`} className={s.pageLink} aria-current={p.slug === slug ? 'page' : undefined}>
                  {p.slug === slug ? <Here /> : null}
                  {p.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </nav>
  )
}

export function Chrome({ groups }: { groups: NavGroup[] }) {
  const path = usePathname()
  const slug = path.replace(/^\/docs\/?/, '')
  const [sheet, setSheet] = useState(false)
  const [search, setSearch] = useState(false)
  const mac = useMac()

  const here = groups.flatMap((g) => g.pages.map((p) => ({ group: g.title, ...p }))).find((p) => p.slug === slug)

  useEffect(() => { setSheet(false); setSearch(false) }, [path])

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      if ((e.metaKey || e.ctrlKey) && k === 'k') { e.preventDefault(); setSearch(true); return }
      const t = e.target as HTMLElement | null
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
      if (k === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); setSearch(true) }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])

  useEffect(() => {
    if (!sheet) return
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setSheet(false) }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', key)
    return () => { document.body.style.overflow = ''; window.removeEventListener('keydown', key) }
  }, [sheet])

  return (
    <>
      <div className={s.bar}>
        <button type="button" className={s.barMenu} aria-expanded={sheet} aria-controls="docs-sheet" onClick={() => setSheet(!sheet)}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            {sheet ? <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" fill="none" stroke="currentColor" strokeWidth="1.5" /> : <path d="M2 4h12M2 8h8M2 12h12" fill="none" stroke="currentColor" strokeWidth="1.5" />}
          </svg>
          <span className={s.barWhere}>
            {here ? <><span className={s.barGroup}>{here.group}</span><span className={s.barPage}>{here.title}</span></> : <span className={s.barPage}>Docs</span>}
          </span>
        </button>
        <button type="button" className={s.barSearch} aria-label="Search the docs" onClick={() => setSearch(true)}><Glass /></button>
      </div>

      <aside className={s.rail}>
        <button type="button" className={s.searchField} onClick={() => setSearch(true)} aria-keyshortcuts="/ Control+K Meta+K">
          <Glass />
          <span>Search</span>
          <kbd>{mac ? '⌘K' : 'Ctrl K'}</kbd>
        </button>
        <Pages groups={groups} slug={slug} />
      </aside>

      {sheet ? (
        <div id="docs-sheet" className={s.sheet} role="dialog" aria-modal="true" aria-label="Docs pages">
          <Pages groups={groups} slug={slug} />
        </div>
      ) : null}

      {search ? <Search onClose={() => setSearch(false)} /> : null}
    </>
  )
}

function useMac() {
  const [mac, setMac] = useState(false)
  useEffect(() => setMac(/Mac|iPhone|iPad/.test(navigator.platform)), [])
  return mac
}

/* ---------- search ---------- */

type Hit = { entry: SearchEntry; excerpt: string }

let loaded: SearchEntry[] | null = null

function find(entries: SearchEntry[], q: string): Hit[] {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return []
  const scored: { score: number; hit: Hit }[] = []
  for (const e of entries) {
    const page = e.page.toLowerCase(), section = e.section.toLowerCase(), text = e.text.toLowerCase()
    let score = 0
    for (const t of terms) {
      const inSection = section.includes(t), inPage = page.includes(t), inText = text.includes(t)
      if (!inSection && !inText && !(inPage && !e.section)) { score = -1; break }
      score += (inSection ? 8 : 0) + (inPage && !e.section ? 10 : 0) + Math.min(4, text.split(t).length - 1)
      if (section === t || (!e.section && page === t)) score += 6
    }
    if (score < 0) continue
    const at = Math.max(0, text.indexOf(terms[0]!))
    const from = at < 40 ? 0 : text.lastIndexOf(' ', at - 30) + 1
    const excerpt = (from > 0 ? '… ' : '') + e.text.slice(from, from + 120).trim() + (e.text.length > from + 120 ? ' …' : '')
    scored.push({ score, hit: { entry: e, excerpt } })
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, 12).map((x) => x.hit)
}

// The words the reader typed, strong where they appear.
function Marked({ text, q }: { text: string; q: string }) {
  const terms = q.split(/\s+/).filter(Boolean).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  if (!terms.length) return <>{text}</>
  const parts = text.split(new RegExp(`(${terms.join('|')})`, 'ig'))
  return <>{parts.map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : p))}</>
}

function Search({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const [entries, setEntries] = useState<SearchEntry[] | null>(loaded)
  const [failed, setFailed] = useState(false)
  const [q, setQ] = useState('')
  const [at, setAt] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)

  useEffect(() => {
    const back = document.activeElement as HTMLElement | null
    input.current?.focus()
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = ''; back?.focus?.() }
  }, [])

  useEffect(() => {
    if (loaded) return
    let live = true
    fetch('/docs/search')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { entries: SearchEntry[] }) => { loaded = d.entries; if (live) setEntries(d.entries) })
      .catch(() => { if (live) setFailed(true) })
    return () => { live = false }
  }, [])

  const hits = useMemo(() => (entries ? find(entries, q) : []), [entries, q])
  useEffect(() => setAt(0), [q])
  useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }) }, [at])

  const href = (e: SearchEntry) => `/docs/${e.slug}${e.id ? `#${e.id}` : ''}`
  const go = (h: Hit | undefined) => { if (!h) return; onClose(); router.push(href(h.entry)) }

  const key = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setAt((n) => (hits.length ? (n + 1) % hits.length : 0)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAt((n) => (hits.length ? (n - 1 + hits.length) % hits.length : 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); go(hits[at]) }
    else if (e.key === 'Tab') e.preventDefault()
  }

  const query = q.trim()
  return (
    <div className={s.searchBack} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={s.search} role="dialog" aria-modal="true" aria-label="Search the docs" onKeyDown={key}>
        <div className={s.searchHead}>
          <Glass />
          <input
            ref={input} className={s.searchInput} type="text" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search pages, sections and text" aria-label="Search the docs" autoComplete="off" spellCheck={false}
            role="combobox" aria-expanded={hits.length > 0} aria-controls="docs-search-results" aria-activedescendant={hits.length ? `docs-hit-${at}` : undefined}
          />
          <button type="button" className={s.searchClose} onClick={onClose} aria-label="Close search"><kbd>Esc</kbd></button>
        </div>
        <div className={s.searchBody} aria-live="polite">
          {failed ? (
            <p className={s.searchNote}>The search index did not load. Close and open search to read it again.</p>
          ) : !entries ? (
            <p className={s.searchNote}><span className="stepping">Reading the docs</span></p>
          ) : !query ? (
            <p className={s.searchNote}>Type to search. <kbd>↑</kbd> <kbd>↓</kbd> to move, <kbd>Enter</kbd> to open.</p>
          ) : !hits.length ? (
            <p className={s.searchNote}>Nothing in the docs matches “{query}”.</p>
          ) : (
            <ul ref={list} id="docs-search-results" role="listbox" aria-label="Results" className={s.hits}>
              {hits.map((h, i) => (
                <li key={`${h.entry.slug}#${h.entry.id}`} id={`docs-hit-${i}`} role="option" aria-selected={i === at} className={s.hit} onMouseMove={() => setAt(i)} onClick={() => go(h)}>
                  <span className={s.hitTitle}>
                    <span className={s.hitSection}><Marked text={h.entry.section || h.entry.page} q={query} /></span>
                    {h.entry.section ? <span className={s.hitPage}>{h.entry.page}</span> : null}
                  </span>
                  {h.excerpt ? <span className={s.hitText}><Marked text={h.excerpt} q={query} /></span> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
