// The mark and the name, rendered from logo's paths (brand/logo/, copied into logo.json).
import logo from './logo.json'
import { PRODUCT } from '@/lib/facts'

const CAP = 697 // the wordmark's cap height in its own units

export function Mark({ size = 16, small = size < 28 }: { size?: number; small?: boolean }) {
  const m = small ? logo.markSmall : logo.mark
  const [, , w, h] = m.viewBox.split(' ').map(Number) as [number, number, number, number]
  return <svg viewBox={m.viewBox} width={small ? size : (size * w) / h} height={size} aria-hidden="true" style={{ flex: 'none' }} dangerouslySetInnerHTML={{ __html: m.body }} />
}

export function Wordmark({ cap = 13, mark = true }: { cap?: number; mark?: boolean }) {
  const [, , w, h] = logo.wordmark.viewBox.split(' ').map(Number) as [number, number, number, number]
  const k = cap / CAP
  const tall = cap * 1.3
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: cap * 0.6, lineHeight: 0 }}>
      {mark ? <Mark size={tall < 22 ? 16 : tall} small={tall < 22} /> : null}
      <svg viewBox={logo.wordmark.viewBox} width={w * k} height={h * k} role="img" aria-label={PRODUCT.name} fill="currentColor" style={{ marginBottom: -(h - CAP) * k }} dangerouslySetInnerHTML={{ __html: logo.wordmark.body }} />
    </span>
  )
}
