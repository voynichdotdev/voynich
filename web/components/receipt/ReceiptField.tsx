'use client'

import { useRouter } from 'next/navigation'
import { useId, useState } from 'react'
import { q } from './shared'
import s from './receipt.module.css'

const ID = /^[1-9A-HJ-NP-Za-km-z]{32,88}$/

// One field: a receipt id, a call address or a settlement signature goes to that receipt.
export function ReceiptField({ fixture, label = 'Receipt id, call address or transaction signature' }: { fixture: string | null; label?: string }) {
  const router = useRouter()
  const id = useId()
  const [value, setValue] = useState('')
  const [error, setError] = useState(false)
  const [pending, setPending] = useState(false)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const v = value.trim()
    if (!ID.test(v)) { setError(true); return }
    setPending(true)
    router.push(`/receipts/${v}${q(fixture)}`)
  }

  return (
    <form className={s.field} onSubmit={submit} noValidate>
      <div className="field">
        <label htmlFor={id}>{label}</label>
        <div className={s.fieldRow}>
          <input
            id={id} className="input mono" value={value} spellCheck={false} autoComplete="off" autoCapitalize="off"
            aria-invalid={error || undefined} aria-describedby={error ? `${id}-err` : undefined}
            onChange={(e) => { setValue(e.target.value); setError(false); setPending(false) }}
          />
          <button type="submit" className="btn" data-kind="primary" data-pending={pending || undefined}>Verify</button>
        </div>
        {error ? <span className="err" id={`${id}-err`} role="alert">This is not a receipt id, a call address or a transaction signature.</span> : null}
      </div>
    </form>
  )
}
