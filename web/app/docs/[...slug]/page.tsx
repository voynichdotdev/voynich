import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { readNav, readPage } from '@/lib/docs'
import { renderPage } from '@/components/docs/render'
import { Strip } from '@/components/docs/Strip'
import { Toc } from '@/components/docs/Toc'
import s from '@/components/docs/docs.module.css'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ slug: string[] }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const slug = (await params).slug.join('/')
  const page = readPage(slug)
  if (!page) return {}
  return {
    title: page.title,
    description: page.description || undefined,
    robots: slug.startsWith('_') ? { index: false, follow: false } : undefined,
  }
}

export default async function DocsPage({ params }: Props) {
  const slug = (await params).slug.join('/')
  const page = readPage(slug)
  if (!page) notFound()

  const groups = readNav()
  const flat = groups.flatMap((g) => g.pages)
  const at = flat.findIndex((p) => p.slug === slug)
  const prev = at > 0 ? flat[at - 1] : undefined
  const next = at >= 0 ? flat[at + 1] : undefined
  const opens = groups.findIndex((g) => g.pages[0]?.slug === slug)
  const { content, headings } = await renderPage(page)

  return (
    <div className={s.page}>
      <article className={s.article}>
        {opens >= 0 ? <Strip title={groups[opens]!.title} form={opens} /> : null}
        <h1 className={`t-h1 ${s.title}`}>{page.title}</h1>
        <div className={s.prose}>{content}</div>
        {prev || next ? (
          <nav className={s.foot} aria-label="Previous and next page">
            {prev ? (
              <Link href={`/docs/${prev.slug}`} className={s.footLink}>
                <span className="t-label">Previous</span>
                <span className={s.footTitle}>{prev.title}</span>
              </Link>
            ) : <span />}
            {next ? (
              <Link href={`/docs/${next.slug}`} className={s.footLink} data-next="">
                <span className="t-label">Next</span>
                <span className={s.footTitle}>{next.title}</span>
              </Link>
            ) : null}
          </nav>
        ) : null}
      </article>
      <Toc headings={headings} />
    </div>
  )
}
