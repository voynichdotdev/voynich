import s from '@/components/model/model-view.module.css'

const lines = (n: number) => Array.from({ length: n }, (_, i) => <span key={i} className="skeleton" style={{ width: `${86 - ((i * 29) % 44)}%`, animationDelay: `${i * 0.09}s` }} />)

export default function Loading() {
  return (
    <div className={`container page ${s.page}`} role="status" aria-label="Reading from chain">
      <header className={s.head}>
        <div className={s.title} style={{ display: 'flex', flexDirection: 'column', gap: 14, width: 'min(420px, 100%)' }}>
          <span className="skeleton" style={{ width: 120 }} />
          <span className="skeleton" style={{ width: '70%', height: 36 }} />
          <span className="skeleton" style={{ width: '90%' }} />
        </div>
      </header>
      <div className={`grid ${s.regions}`} aria-hidden="true">
        <div className={`panel ${s.call}`} style={{ minHeight: 480 }}>
          <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 16, flex: 1 }}>{lines(9)}</div>
        </div>
        <div className={`panel ${s.facts}`}>
          <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>{lines(10)}</div>
        </div>
        <div className={`panel ${s.full}`}>
          <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{lines(8)}</div>
        </div>
      </div>
      <span className="sr-only">Reading from chain</span>
    </div>
  )
}
