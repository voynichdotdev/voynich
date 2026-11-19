'use client'

// The seal flow's own parts: the step rail, a transaction's stages, a file choice, what a device still needs, the ciphertext as tiles.

import { useId } from 'react'
import { SEAL_STEPS } from '@/lib/facts'
import { RAMP, BARE_BELOW, capFill, C } from '@/components/field/ramp'
import { StateTile, type TileState } from '@/components/tile/Tile'
import { Size } from '@/components/ui/kit'
import s from './seal.module.css'

// The steps in order: a tick behind, the bright cap here, empty caps ahead. A phone names the one it is on.
export function StepRail({ current, complete }: { current: number; complete: boolean }) {
  const total = SEAL_STEPS.length
  const here = SEAL_STEPS[Math.min(current, total - 1)]!
  return (
    <>
      <ol className={s.rail} aria-label="Steps">
        {SEAL_STEPS.map((st, i) => {
          const state = complete || i < current ? 'done' : i === current ? 'current' : 'todo'
          return (
            <li key={st.id} data-state={state} aria-current={state === 'current' ? 'step' : undefined}>
              <StateTile state={state === 'done' ? 'passed' : state === 'current' ? 'live' : 'waiting'} />
              <span>{st.label}</span>
            </li>
          )
        })}
      </ol>
      <p className={s.railNow}>
        <span className="mono">{complete ? total : current + 1} of {total}</span>
        <span aria-hidden="true">·</span>
        <strong>{complete ? 'Sealed and granted' : here.label}</strong>
      </p>
    </>
  )
}

export type TxStage = 'building' | 'signing' | 'confirming' | 'done' | null
const ORDER = ['building', 'signing', 'confirming'] as const

// One signed action as three rows that turn from waiting to pending to passed.
export function Stages({ stage, failed, labels }: { stage: TxStage; failed?: boolean; labels: [string, string, string] }) {
  const at = stage === 'done' ? 3 : stage ? ORDER.indexOf(stage) : -1
  return (
    <ol className={s.stages} aria-live="polite">
      {labels.map((label, i) => {
        const st: TileState = i < at ? 'passed' : i === at ? (failed ? 'failed' : 'pending') : 'waiting'
        return <li key={label} data-state={st}><StateTile state={st} /><span>{label}</span></li>
      })}
    </ol>
  )
}

export type Need = { id: 'key' | 'weights'; label: string; file: string; held: boolean }

// What this device has to be given before the step can go on, one row a file.
export function Needs({ items }: { items: Need[] }) {
  const next = items.find((n) => !n.held)?.id
  return (
    <ol className={s.needs}>
      {items.map((n) => (
        <li key={n.id} data-state={n.held ? 'held' : n.id === next ? 'next' : 'later'}>
          <StateTile state={n.held ? 'passed' : n.id === next ? 'live' : 'waiting'} />
          <span className={s.needLabel}>{n.label}</span>
          <span className={`mono ${s.needFile}`}>{n.file}</span>
          <span className="t-small dim">{n.held ? 'On this device' : 'Needed'}</span>
        </li>
      ))}
    </ol>
  )
}

export function FilePick({ label, file, accept, invalid, describedBy, empty, onPick }: {
  label: string; file: { name: string; size: number } | null; accept?: string; invalid?: boolean; describedBy?: string; empty: string; onPick: (f: File) => void
}) {
  const id = useId()
  return (
    <div className={s.pick} data-filled={file ? true : undefined} data-invalid={invalid || undefined}>
      <input
        id={id} type="file" className="sr-only" accept={accept} aria-invalid={invalid || undefined} aria-describedby={describedBy}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = '' }}
      />
      <label htmlFor={id}>
        <span className="sr-only">{label}: </span>
        <span className={s.pickFile}>
          <StateTile state={file ? 'sealed' : 'waiting'} />
          <span className={`mono ${s.pickName}`}>{file ? file.name : <span className="dim">{empty}</span>}</span>
        </span>
        <span className={s.pickFoot}>
          {file ? <Size n={file.size} /> : <span className="t-small dim">Read on this device</span>}
          <span className={s.pickAct}>{file ? 'Change' : 'Choose file'}</span>
        </span>
      </label>
    </div>
  )
}

export const CELLS = 96

// The model's ciphertext as a block of tiles: outlined before it exists, bare glyphs once it is on this device,
// capped where the chain holds it.
export function CipherTiles({ byteAt, onDevice, onChain }: { byteAt: ((cell: number) => number) | null; onDevice: number; onChain: (cell: number) => boolean }) {
  return (
    <div className={s.cipher} aria-hidden="true">
      {Array.from({ length: CELLS }, (_, i) => {
        if (!byteAt || i >= onDevice) return <span key={i} data-state="none" />
        const b = byteAt(i)
        const step = Math.min(RAMP.length - 1, BARE_BELOW + (b % (RAMP.length - BARE_BELOW)))
        if (!onChain(i)) return <span key={i} data-state="device">{RAMP[step]}</span>
        const top = step === RAMP.length - 1
        return <span key={i} data-state="chain" style={{ background: capFill(step), color: top ? C.ground : b % 19 === 0 ? C.pink : b % 9 === 0 ? C.yellow : C.glyph }}>{RAMP[step]}</span>
      })}
    </div>
  )
}
