// The drawn hand: a dry-edged ochre line for what a person or an enclave does.
// One SVG filter, defined once in the layout, roughens strokes that ask for it.

export function DryEdge() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
      <filter id="dry" x="-5%" y="-5%" width="110%" height="110%">
        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="408" result="n" />
        <feDisplacementMap in="SourceGraphic" in2="n" scale="1.7" xChannelSelector="R" yChannelSelector="G" />
      </filter>
      <filter id="dry-l" x="-5%" y="-5%" width="110%" height="110%">
        <feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="2" seed="32" result="n" />
        <feDisplacementMap in="SourceGraphic" in2="n" scale="3" xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </svg>
  )
}

// A hand-drawn tick: passed, verified.
export function Tick({ size = 16, color = 'var(--ochre)' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" style={{ flex: 'none' }}>
      <path d="M2.6 8.6 6.3 12.2 13.6 3.6" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" filter="url(#dry)" />
    </svg>
  )
}

// A hand-drawn underline that runs the width of its box.
export function Underline({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true" style={{ width: '100%', height: 6, display: 'block', overflow: 'visible' }}>
      <path d="M0.5 3.4 C 22 2.2, 44 4.3, 66 3 S 92 2.6, 99.5 3.6" fill="none" stroke="var(--ochre)" strokeWidth="2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

// A hand-drawn frame around its children: the subject, the thing opened.
export function Frame({ children, className, color = 'var(--ochre)', style }: { children?: React.ReactNode; className?: string; color?: string; style?: React.CSSProperties }) {
  return (
    <div className={className} style={{ position: 'relative', ...style }}>
      {children}
      <svg aria-hidden="true" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' }} preserveAspectRatio="none" viewBox="0 0 100 100">
        <path d="M0.3 0.5 C 30 0.2, 70 0.8, 99.7 0.4 C 99.9 30, 99.5 70, 99.8 99.5 C 70 99.8, 30 99.4, 0.3 99.7 C 0.1 70, 0.5 30, 0.3 0.5 Z" fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  )
}
