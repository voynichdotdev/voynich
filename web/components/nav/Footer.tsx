import Link from 'next/link'
import { LINKS, PRODUCT, PROGRAM, SKETCH32, SOURCES } from '@/lib/facts'
import { CLUSTER } from '@/lib/env'
import { Wordmark } from './Mark'
import s from './Footer.module.css'

const COLS: { title: string; links: { href: string; label: string }[] }[] = [
  { title: 'Use', links: [
    { href: `/models/${SKETCH32.id}`, label: `Call ${SKETCH32.name}` },
    { href: '/models', label: 'Models' },
    { href: '/benchmarks', label: 'Benchmarks' },
    { href: '/bounties', label: 'Bounties' },
    { href: '/seal', label: 'Seal a model' },
    { href: '/receipts', label: 'Verify a receipt' },
    { href: '/account', label: 'Account' },
  ] },
  { title: 'Read', links: [
    { href: '/sealing', label: 'Sealing' },
    { href: '/operators', label: 'Operators' },
    { href: '/enclaves', label: 'Enclaves' },
    { href: LINKS.token, label: 'Fees and the token' },
  ] },
  { title: 'Build', links: [
    { href: LINKS.docsHome, label: 'Docs' },
    { href: LINKS.quickstart, label: 'Call a model in five minutes' },
    { href: '/docs/sdk/install', label: 'SDK' },
    { href: '/docs/cli/install', label: 'CLI' },
    { href: '/docs/program/accounts', label: 'Program' },
  ] },
]

export function Footer() {
  const external = [
    LINKS.x ? { href: LINKS.x, label: 'X' } : null,
    LINKS.github ? { href: LINKS.github, label: 'GitHub' } : null,
    { href: SOURCES.confidentialCompute, label: 'Solana Confidential Compute' },
  ].filter(Boolean) as { href: string; label: string }[]
  return (
    <footer className={s.foot}>
      <div className={`container ${s.grid}`}>
        <div className={s.id}>
          <Wordmark cap={16} />
          <p className="t-small">{PRODUCT.line}</p>
        </div>
        {COLS.map((c) => (
          <nav key={c.title} aria-label={c.title} className={s.col}>
            <h2 className="t-label">{c.title}</h2>
            <ul>{c.links.map((l) => <li key={l.href}><Link href={l.href}>{l.label}</Link></li>)}</ul>
          </nav>
        ))}
        <nav aria-label="Elsewhere" className={s.col}>
          <h2 className="t-label">Elsewhere</h2>
          <ul>{external.map((l) => <li key={l.href}><a href={l.href} rel="noreferrer">{l.label}</a></li>)}</ul>
        </nav>
      </div>
      <div className={`container ${s.base}`} hidden={CLUSTER === 'localnet' && !PROGRAM.programId}>
        {CLUSTER === 'localnet' ? null : <span className="mono dim">Solana {CLUSTER === 'devnet' ? 'devnet' : 'mainnet'}</span>}
        {PROGRAM.programId ? <span className="mono dim">program {PROGRAM.programId}</span> : null}
      </div>
    </footer>
  )
}
