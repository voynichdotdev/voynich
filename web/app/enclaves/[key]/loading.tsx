import { Loading } from '@/components/ui/kit'
import s from '@/components/enclave/enclave.module.css'

export default function EnclaveLoading() {
  return (
    <div className="container page">
      <div className="crumb"><span>Enclaves</span><span>/</span></div>
      <header className="page-head">
        <div className={s.skelHead} style={{ width: 'min(100%, 420px)' }}>
          <span className="skeleton" style={{ height: 32, width: '70%' }} />
          <span className="skeleton" style={{ width: '100%' }} />
        </div>
      </header>
      <div className={`grid ${s.regions}`}>
        <section className={s.record}><Loading rows={8} /></section>
        <div className={s.side}>
          <div className="panel"><div className="panel-body"><Loading rows={2} /></div></div>
          <div className="panel"><div className="panel-body"><Loading rows={3} /></div></div>
        </div>
      </div>
    </div>
  )
}
