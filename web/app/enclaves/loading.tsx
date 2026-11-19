import { Loading } from '@/components/ui/kit'

export default function EnclavesLoading() {
  return (
    <div className="container page">
      <header className="page-head">
        <div>
          <h1 className="t-h1">Enclaves</h1>
          <p className="t-body">Reading from chain</p>
        </div>
      </header>
      <div className="panel">
        <div className="panel-body"><Loading rows={5} /></div>
      </div>
    </div>
  )
}
