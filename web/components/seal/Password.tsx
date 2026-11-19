'use client'

// The password that encrypts the keys kept in this browser: set once, entered once each time the site is opened,
// and asked again for a key file that was written under another one.

import { useId, useRef, useState } from 'react'
import { PASSWORD_MIN } from '@/lib/keys'
import s from './seal.module.css'

export type PasswordMode = 'set' | 'unlock' | 'file'

const COPY: Record<PasswordMode, { title: string; says: string; label: string; wrong: string }> = {
  set: {
    title: 'Set a password',
    says: 'The password encrypts the keys kept in this browser and the key file. It is asked once each time the site is opened.',
    label: 'Password',
    wrong: 'The password could not be set.',
  },
  unlock: {
    title: 'Enter your password',
    says: 'The keys kept in this browser are encrypted under your password. It is asked once each time the site is opened.',
    label: 'Password',
    wrong: 'That password does not open the keys in this browser.',
  },
  file: {
    title: 'Enter the key file password',
    says: 'The key file is encrypted under the password set where it was downloaded.',
    label: 'Key file password',
    wrong: 'That password does not open this key file.',
  },
}

// `run` gets the password and answers whether it was the right one. The submit button is the caller's:
// inside as children, or anywhere on the page with `form={id}`.
export function PasswordForm({ id, mode, run, onBusy, bare, children }: {
  id: string; mode: PasswordMode; run: (password: string) => Promise<boolean>; onBusy?: (busy: boolean) => void; bare?: boolean; children?: React.ReactNode
}) {
  const copy = COPY[mode]
  const uid = useId()
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [errors, setErrors] = useState<{ password?: string; repeat?: string }>({})
  const [busy, setBusy] = useState(false)
  const first = useRef<HTMLInputElement>(null)
  const second = useRef<HTMLInputElement>(null)

  const submit = async () => {
    if (busy) return
    const e: typeof errors = {}
    if (!password) e.password = 'Enter the password.'
    else if (mode === 'set' && password.length < PASSWORD_MIN) e.password = `Use at least ${PASSWORD_MIN} characters.`
    else if (mode === 'set' && repeat !== password) e.repeat = 'The two passwords differ.'
    setErrors(e)
    if (e.password || e.repeat) { (e.password ? first : second).current?.focus(); return }
    setBusy(true); onBusy?.(true)
    let ok = false
    try { ok = await run(password) } catch {}
    setBusy(false); onBusy?.(false)
    if (!ok) { setErrors({ password: copy.wrong }); first.current?.focus(); first.current?.select() }
  }

  return (
    <form id={id} className={s.pw} data-bare={bare || undefined} noValidate onSubmit={(e) => { e.preventDefault(); void submit() }}>
      <div className={s.pwHead}>
        {bare ? null : <h3 className="t-h3">{copy.title}</h3>}
        <p className="t-small" id={`${uid}-says`}>{copy.says}</p>
      </div>
      <div className={s.pwFields} data-one={mode === 'set' ? undefined : true}>
        <div className="field">
          <label htmlFor={`${uid}-p`}>{copy.label}</label>
          <input
            ref={first} id={`${uid}-p`} className="input" type="password" autoComplete={mode === 'set' ? 'new-password' : mode === 'unlock' ? 'current-password' : 'off'}
            value={password} onChange={(e) => { setPassword(e.target.value); setErrors({}) }} disabled={busy}
            aria-invalid={errors.password ? true : undefined} aria-describedby={errors.password ? `${uid}-pe` : `${uid}-says`}
          />
          {errors.password ? <span className="err" id={`${uid}-pe`} role="alert">{errors.password}</span> : null}
        </div>
        {mode === 'set' ? (
          <div className="field">
            <label htmlFor={`${uid}-r`}>Repeat password</label>
            <input
              ref={second} id={`${uid}-r`} className="input" type="password" autoComplete="new-password"
              value={repeat} onChange={(e) => { setRepeat(e.target.value); setErrors({}) }} disabled={busy}
              aria-invalid={errors.repeat ? true : undefined} aria-describedby={errors.repeat ? `${uid}-re` : undefined}
            />
            {errors.repeat ? <span className="err" id={`${uid}-re`} role="alert">{errors.repeat}</span> : null}
          </div>
        ) : null}
      </div>
      {children}
    </form>
  )
}
