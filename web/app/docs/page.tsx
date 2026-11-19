import { redirect } from 'next/navigation'
import { homeSlug } from '@/lib/docs'

export const dynamic = 'force-dynamic'

export default function DocsHome() {
  redirect(`/docs/${homeSlug()}`)
}
