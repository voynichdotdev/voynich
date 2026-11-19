import { readNav } from '@/lib/docs'
import { Chrome } from '@/components/docs/Chrome'
import s from '@/components/docs/docs.module.css'

export const dynamic = 'force-dynamic'

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`container ${s.shell}`}>
      <Chrome groups={readNav()} />
      <div className={s.main}>{children}</div>
    </div>
  )
}
