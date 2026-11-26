import type { MetadataRoute } from 'next'
import fs from 'node:fs'
import path from 'node:path'
import { siteUrl } from '@/lib/env'

export const dynamic = 'force-dynamic'

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl()
  const places = ['', '/models', '/benchmarks', '/bounties', '/seal', '/enclaves', '/receipts', '/sealing', '/operators', '/docs']
  const docs: string[] = []
  try {
    const index = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'content/docs/index.json'), 'utf8')) as { groups: { pages: { slug: string }[] }[] }
    for (const g of index.groups) for (const p of g.pages) if (fs.existsSync(path.join(process.cwd(), 'content/docs', `${p.slug}.mdx`))) docs.push(`/docs/${p.slug}`)
  } catch {}
  return [...places, ...docs].map((p) => ({ url: `${base}${p}` }))
}
