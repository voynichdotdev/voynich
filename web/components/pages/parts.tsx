// Shared by /sealing and /operators: the opening in the field and a live reading that carries its own states.
import { Field } from '@/components/field/Field'
import { Failed } from '@/components/ui/kit'
import type { Read } from '@/lib/api'
import s from './pages.module.css'

// The field's outline sits whole on one side and the words on the other; below the desktop width the
// outline has a band of its own above the words, so nothing crosses it at any size.
export function Opening({ title, children, form, bytes, side = 'right' }: { title: string; children: React.ReactNode; form: number; bytes?: Uint8Array; side?: 'left' | 'right' }) {
  return (
    <section className={s.open} data-side={side} aria-labelledby="page-title">
      <div className={s.openField}>
        <span className={s.openClear} data-field-clear="" />
        <Field bytes={bytes} form={form} hold place={{ x: side === 'right' ? 0.79 : 0.2, y: 0.5, size: 0.62 }} placePhone={{ x: 0.5, y: 0.5, size: 0.72 }} />
      </div>
      <div className={`container ${s.openIn}`}>
        <h1 id="page-title" className={s.title}>{title}</h1>
        <p className={`t-lead ${s.openLead}`}>{children}</p>
      </div>
    </section>
  )
}

// A read that failed because the thing is not on chain: shown as not there yet, not as a failure.
export const missing = (r: Read<unknown>) => !r.ok && (r.status === 404 || r.code.endsWith('_NOT_FOUND'))

// What the chain holds at this step. A failed read shows its reason in place; a thing not on chain yet says so.
export function Live<T>({ of, title, none, children }: { of: Read<T | null | undefined>; title: string; none: string; children: (data: T) => React.ReactNode }) {
  if (!of.ok && !missing(of)) return <Failed title={`${title} did not load`} message={of.message} />
  const data = of.ok ? of.data : null
  if (data == null) return <p className={s.none}>{none}</p>
  return <>{children(data)}</>
}
