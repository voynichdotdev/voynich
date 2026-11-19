import type { Metadata } from 'next'
import Link from 'next/link'
import { api, fixtureFrom, read } from '@/lib/api'
import { loadMeasurements } from '@/lib/measurements'
import { Empty, Failed } from '@/components/ui/kit'
import { ModelView } from '@/components/model/ModelView'
import s from '@/components/model/model-view.module.css'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const name = decodeURIComponent(id)
  return { title: name, description: `${name}, a sealed model: its ciphertext on chain, the enclaves holding it, its receipts, and a call.` }
}

export default async function ModelPage({ params, searchParams }: Props) {
  const [{ id }, sp] = await Promise.all([params, searchParams])
  const name = decodeURIComponent(id)
  const fixture = fixtureFrom(sp)
  const client = api(fixture)
  const [model, enclaves, receipts, measurements] = await Promise.all([
    read(client.model(name)),
    read(client.modelEnclaves(name)),
    read(client.modelReceipts(name, { limit: 8 })),
    loadMeasurements(client),
  ])
  const q = fixture ? `?fixture=${fixture}` : ''

  if (!model.ok) {
    const missing = model.code === 'MODEL_NOT_FOUND' || model.status === 404
    return (
      <div className="container page">
        <nav className="crumb" aria-label="Breadcrumb"><Link href={`/models${q}`}>Models</Link><span aria-hidden="true">/</span><span className="mono">{name}</span></nav>
        {missing ? (
          <Empty title="Nothing is sealed at this address" action={<Link href={`/models${q}`} className="btn">All models</Link>}>
            No sealed model is named <span className="mono">{name}</span>.
          </Empty>
        ) : (
          <div className={s.fail}><Failed title="This model did not load" message={model.message} /></div>
        )}
      </div>
    )
  }

  return <ModelView fixture={fixture} asOwner={sp.as === 'owner'} initial={{ model: model.data, enclaves, receipts, measurements }} />
}
