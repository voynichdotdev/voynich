import type { MetadataRoute } from 'next'
import { siteUrl } from '@/lib/env'

export const dynamic = 'force-dynamic'

export default function robots(): MetadataRoute.Robots {
  const base = siteUrl()
  return { rules: [{ userAgent: '*', allow: '/', disallow: ['/brand/', '/dev-wallet'] }], sitemap: `${base}/sitemap.xml` }
}
