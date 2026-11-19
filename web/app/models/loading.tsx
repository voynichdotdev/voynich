import s from '@/components/model/model-view.module.css'

export default function Loading() {
  return (
    <div className="container page" role="status" aria-label="Reading from chain">
      <header className="page-head">
        <div>
          <h1 className="t-h1">Models</h1>
          <p className="t-small">Reading from chain</p>
        </div>
      </header>
      <ul className={`panel ${s.registry}`} aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <li key={i} className={s.entry}>
            <div className={s.entryName}><span className="skeleton" style={{ width: 168, height: 24, animationDelay: `${i * 0.09}s` }} /></div>
            <div className={s.entryBytes}><span className="skeleton" style={{ width: '100%', height: 18, animationDelay: `${i * 0.09 + 0.07}s` }} /></div>
            <div className={s.entryStats}>
              {[52, 64, 28, 40].map((w, k) => <div key={k}><span className="skeleton" style={{ width: w, animationDelay: `${(i + k) * 0.07}s` }} /></div>)}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
