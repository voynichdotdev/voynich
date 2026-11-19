'use client'

import { useState } from 'react'
import type { Model } from '@voynich/contract'

export function CallPanel({ model }: { model: Model }) {
  const [status, setStatus] = useState<'ready' | 'answering'>('ready')
  return (
    <section>
      <h2>{model.name}</h2>
      <p>Status: {status}</p>
      <button type="button" onClick={() => setStatus('answering')}>
        Call model
      </button>
    </section>
  )
}
