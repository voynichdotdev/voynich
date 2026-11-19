// The header of a chapter's first page: a short band of the tile field with the chapter's name on clear ground.

import { Field } from '@/components/field/Field'
import { FORMS } from '@/components/field/forms'
import s from './docs.module.css'

export function Strip({ title, form }: { title: string; form: number }) {
  return (
    <div className={s.strip}>
      <Field hold form={form % FORMS.length} pitch={8} place={{ x: 0.8, y: 0.5, size: 0.84 }} placePhone={{ x: 0.7, y: 0.42, size: 0.74 }} />
      <p className={s.stripTitle} data-field-clear="">{title}</p>
    </div>
  )
}
