import type { Metadata } from 'next'
import Link from 'next/link'
import { Field } from '@/components/field/Field'
import { LINKS } from '@/lib/facts'

export const metadata: Metadata = { title: 'Nothing is sealed at this address' }

const CSS = `
.nf { position: relative; min-height: calc(100svh - var(--nav-h)); overflow: clip; background: var(--ground); display: flex; }
.nf-in { position: relative; z-index: 1; display: flex; flex-direction: column; justify-content: center; align-items: flex-start; gap: clamp(20px, 3vh, 32px); padding-block: var(--s8); pointer-events: none; }
.nf-in a { pointer-events: auto; }
.nf-line { font-size: clamp(40px, 5.6vw, 84px); font-weight: 400; line-height: 0.98; letter-spacing: -0.04em; max-width: 9em; text-wrap: balance; }
.nf-acts { display: flex; gap: 12px; flex-wrap: wrap; }
@media (max-width: 719px) {
  .nf-in { justify-content: flex-start; padding-top: calc((100svh - var(--nav-h)) * 0.32 + 31vw + 32px); padding-bottom: var(--s7); }
  .nf-line { font-size: clamp(38px, 11vw, 52px); }
}
`

export default function NotFound() {
  return (
    <section className="nf" aria-labelledby="nf-line">
      <style>{CSS}</style>
      <Field form={9} hold place={{ x: 0.72, y: 0.5, size: 0.7 }} placePhone={{ x: 0.5, y: 0.32, size: 0.62 }} />
      <div className="container nf-in">
        <h1 id="nf-line" className="nf-line" data-field-clear>Nothing is sealed at this address.</h1>
        <p className="t-lead" data-field-clear style={{ maxWidth: '30em' }}>
          The page you asked for is not one of this site&rsquo;s places. These are.
        </p>
        <nav className="nf-acts" aria-label="Places" data-field-clear>
          <Link href="/models" className="btn" data-kind="primary">Models</Link>
          <Link href="/seal" className="btn">Seal</Link>
          <Link href={LINKS.docsHome} className="btn">Docs</Link>
        </nav>
      </div>
    </section>
  )
}
