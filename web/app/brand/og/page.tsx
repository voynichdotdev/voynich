import type { Metadata } from 'next'
import { PRODUCT } from '@/lib/facts'
import { Field } from '@/components/field/Field'
import { Wordmark } from '@/components/nav/Mark'

// The 1200 x 630 frame the Open Graph image is shot from (saved as app/opengraph-image.png).
export const metadata: Metadata = { title: 'Open Graph frame', robots: { index: false, follow: false } }

export default function OgFrame() {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'var(--ground)' }}>
      <div style={{ position: 'relative', width: 1200, height: 630, overflow: 'hidden', background: 'var(--ground)' }}>
        <Field form={0} hold pitch={13} place={{ x: 0.74, y: 0.5, size: 0.82 }} />
        <div style={{ position: 'absolute', left: 72, top: 64 }} data-field-clear><Wordmark cap={26} /></div>
        <h1 data-field-clear style={{ position: 'absolute', left: 72, bottom: 132, fontSize: 84, fontWeight: 400, lineHeight: 0.96, letterSpacing: '-0.04em', maxWidth: 620 }}>
          Hide your model<br />in plain sight.
        </h1>
        <p data-field-clear className="mono" style={{ position: 'absolute', left: 72, bottom: 72, fontSize: 20, color: 'var(--text-2)' }}>
          Sealed models on {PRODUCT.chain}
        </p>
      </div>
    </div>
  )
}
