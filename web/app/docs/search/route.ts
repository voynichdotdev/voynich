import { searchEntries } from '@/lib/docs'

export const dynamic = 'force-dynamic'

export function GET() {
  return Response.json({ entries: searchEntries() })
}
