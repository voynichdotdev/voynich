// The docs kit: the parts a page is written with. Server components; the few that hold state are in their own files.

import Link from 'next/link'
import { readRows } from '@/lib/docs'
import { TOKEN } from '@/lib/facts'
import { Copy } from './Copy'
import { unwrap } from './unwrap'
import s from './kit.module.css'

/* ---------- steps ---------- */

export function Steps({ children }: { children?: React.ReactNode }) {
  return <ol className={s.steps}>{unwrap(children)}</ol>
}

export function Step({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <li className={s.step}>
      <div className={s.stepTitle}>{title}</div>
      <div className={s.stepBody}>{children}</div>
    </li>
  )
}

/* ---------- fields ---------- */

export function Fields({ children }: { children?: React.ReactNode }) {
  return (
    <div className={s.fields} role="table">
      <div className={s.fieldsHead} role="row">
        <span role="columnheader">Field</span>
        <span role="columnheader">Meaning</span>
      </div>
      {unwrap(children)}
    </div>
  )
}

export function DocField({ name, type, required, children }: { name: string; type?: string; required?: boolean | string; children?: React.ReactNode }) {
  return (
    <div className={s.field} role="row">
      <div className={s.fieldName} role="cell">
        <code>{name}</code>
        {type || required ? (
          <span className={s.fieldType}>
            {type ? <span className="mono">{type}</span> : null}
            {required !== undefined && required !== false && required !== 'false' ? <span className={s.fieldReq}>required</span> : null}
          </span>
        ) : null}
      </div>
      <div className={s.fieldSays} role="cell">{children}</div>
    </div>
  )
}

/* ---------- rows: a list the code defines ---------- */

const heading = (key: string) => {
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

// Inline `code`, [label](url) links, and bare https:// URLs inside a cell value.
const INLINE = /`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]+)\)|(https?:\/\/[^\s)]+)/g
const cell = (value: unknown) => {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') return <span className="mono">{typeof value === 'object' ? JSON.stringify(value) : String(value)}</span>
  const parts: React.ReactNode[] = []
  let last = 0
  for (const m of value.matchAll(INLINE)) {
    const at = m.index ?? 0
    if (at > last) parts.push(value.slice(last, at))
    if (m[1] !== undefined) parts.push(<code key={at}>{m[1]}</code>)
    else if (m[2] !== undefined && m[3] !== undefined) parts.push(<A key={at} href={m[3]}>{m[2]}</A>)
    else if (m[4] !== undefined) parts.push(<A key={at} href={m[4]}>{m[4]}</A>)
    last = at + m[0].length
  }
  if (last < value.length) parts.push(value.slice(last))
  return parts.length ? parts : value
}

export function Rows({ data, columns }: { data: string; columns?: string }) {
  const baseRows = readRows(data)
  const rows: Record<string, unknown>[] = [...baseRows]
  if (data === 'token') {
    if (TOKEN.mint && !rows.some((r) => r.fact === 'Mint')) {
      rows.push({ fact: 'Mint', value: `\`${TOKEN.mint}\``, copy: TOKEN.mint })
    }
    if (TOKEN.lockUrl && !rows.some((r) => String(r.value ?? '').includes(TOKEN.lockUrl) || r.href === TOKEN.lockUrl)) {
      rows.push({ fact: 'Lock', value: 'Streamflow lock contract', href: TOKEN.lockUrl })
    }
  }
  const keys = columns
    ? columns.split(',').map((c) => c.trim()).filter(Boolean)
    : Object.keys(rows[0] ?? {}).filter((k) => k !== 'copy' && k !== 'href')
  // A column of short values takes its content's width; the last column takes the rest.
  const fit = keys.map((k, j) => (j < keys.length - 1 && rows.every((r) => String(r[k] ?? '').length <= 36)) || undefined)
  return (
    <div className={s.tableWrap} tabIndex={0}>
      <table>
        <thead>
          <tr>{keys.map((k, j) => <th key={k} scope="col" data-fit={fit[j]}>{heading(k)}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {keys.map((k, j) => {
                const v = row[k]
                if (j === 0 && typeof v === 'string') return <td key={k} data-fit={fit[j]}><code>{v}</code></td>
                const copyText =
                  j === keys.length - 1
                    ? typeof row.copy === 'string'
                      ? row.copy
                      : data === 'token' && row.fact === 'Mint' && typeof v === 'string'
                        ? v.replace(/^`|`$/g, '')
                        : null
                    : null
                const href = j === keys.length - 1 && typeof row.href === 'string' ? row.href : null
                return (
                  <td key={k} data-fit={fit[j]}>
                    {copyText ? (
                      <span className={s.cellCopy}>
                        {cell(v)}
                        <Copy text={copyText} label={typeof row.fact === 'string' ? row.fact.toLowerCase() : 'value'} />
                      </span>
                    ) : href && typeof v === 'string' ? (
                      <A href={href}>{v}</A>
                    ) : (
                      cell(v)
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ---------- callout ---------- */

export function Callout({ kind = 'note', children }: { kind?: 'note' | 'important'; children?: React.ReactNode }) {
  return (
    <aside className={s.callout} data-kind={kind} role="note">
      {kind === 'important' ? (
        <svg className={s.calloutLine} viewBox="0 0 6 100" preserveAspectRatio="none" aria-hidden="true">
          <path d="M3.2 0.5 C 2.2 22, 4.2 44, 3 66 S 2.6 90, 3.4 99.5" fill="none" stroke="var(--ochre)" strokeWidth="2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>
      ) : null}
      {children}
    </aside>
  )
}

/* ---------- cards ---------- */

export function Cards({ children }: { children?: React.ReactNode }) {
  return <div className={s.cards}>{unwrap(children)}</div>
}

export function Card({ href, title, children }: { href: string; title: string; children?: React.ReactNode }) {
  return (
    <Link href={href} className={s.card}>
      <span className={s.cardTitle}>{title}<span className={s.cardArrow} aria-hidden="true">→</span></span>
      {children ? <span className={s.cardSays}>{children}</span> : null}
    </Link>
  )
}

/* ---------- Markdown, set for reading ---------- */

export function A({ href = '', children }: { href?: string; children?: React.ReactNode }) {
  if (href.startsWith('/')) return <Link href={href} className="link">{children}</Link>
  if (href.startsWith('#')) return <a href={href} className="link">{children}</a>
  return <a href={href} className="link" target="_blank" rel="noreferrer">{children} ↗</a>
}

export function Table({ children }: { children?: React.ReactNode }) {
  return <div className={s.tableWrap} tabIndex={0}><table>{children}</table></div>
}

function heading2or3(Tag: 'h2' | 'h3') {
  return function Heading({ id, children }: { id?: string; children?: React.ReactNode }) {
    return (
      <Tag id={id} className={s.heading}>
        {children}
        {id ? <a href={`#${id}`} className={s.anchor} aria-label="Link to this section">#</a> : null}
      </Tag>
    )
  }
}
export const H2 = heading2or3('h2')
export const H3 = heading2or3('h3')
