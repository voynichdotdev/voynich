'use client'

// The site's sound. Off until the visitor turns it on in the nav; the choice is remembered.
// Audio cues live under public/sound/ and are mapped by id in sound-manifest.json.

import { useSyncExternalStore } from 'react'
import manifest from './sound-manifest.json'

export type Cue =
  | 'tick' | 'press' | 'toggle' | 'copy' | 'stroke' | 'clear' | 'encrypt' | 'sign' | 'escrow' | 'answering'
  | 'verified' | 'check' | 'failed' | 'refund' | 'chunk' | 'sealed' | 'grant' | 'arrive' | 'loop'

type Entry = { files: string[]; gain: number; minGapMs?: number; loop?: boolean; order?: string; periodMs?: number }
const CUES = manifest.cues as Partial<Record<Cue, Entry>>

const KEY = 'voynich.sound'
let on = false
let ctx: AudioContext | null = null
let master: GainNode | null = null
let bed: GainNode | null = null
let bedTimer: ReturnType<typeof setInterval> | null = null
const buffers = new Map<string, AudioBuffer | Promise<AudioBuffer | null>>()
const lastAt = new Map<Cue, number>()
const lastFile = new Map<Cue, number>()
const loops = new Map<Cue, { src: AudioBufferSourceNode; gain: GainNode }>()
const listeners = new Set<() => void>()

function load(file: string): Promise<AudioBuffer | null> {
  const hit = buffers.get(file)
  if (hit) return Promise.resolve(hit)
  const p = fetch(`/sound/${file}`)
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
    .then((b) => ctx!.decodeAudioData(b))
    .then((buf) => { buffers.set(file, buf); return buf })
    .catch(() => null)
  buffers.set(file, p)
  return p
}

function ensure() {
  if (!ctx) {
    ctx = new AudioContext()
    master = ctx.createGain()
    master.gain.value = manifest.master
    master.connect(ctx.destination)
    bed = ctx.createGain()
    bed.gain.value = 1
    bed.connect(master)
  }
  if (ctx.state === 'suspended') void ctx.resume()
}

// `variant` picks a file where the cue has a meaning per file: toggle 0 coming on, 1 going out.
export function play(cue: Cue, variant?: number) {
  if (!on) return
  const e = CUES[cue]
  if (!e || !e.files.length) return
  const now = performance.now()
  if (e.minGapMs && now - (lastAt.get(cue) ?? -1e9) < e.minGapMs) return
  if (e.loop && loops.has(cue)) return
  ensure()

  let i: number
  if (variant !== undefined) i = variant % e.files.length
  else if (e.order === 'sequence') i = now - (lastAt.get(cue) ?? -1e9) > 1500 ? 0 : ((lastFile.get(cue) ?? -1) + 1) % e.files.length
  else if (e.order === 'pick') i = 0
  else {
    // rotate, never the same file twice in a row
    i = Math.floor(Math.random() * e.files.length)
    if (e.files.length > 1 && i === lastFile.get(cue)) i = (i + 1) % e.files.length
  }
  lastAt.set(cue, now)
  lastFile.set(cue, i)

  if (cue === 'verified') { stop('answering'); duck() }
  void load(e.files[i]!).then((buf) => {
    if (!buf || !ctx || !master || !on) return
    if (e.loop && loops.has(cue)) return
    const src = ctx.createBufferSource()
    const gain = ctx.createGain()
    src.buffer = buf
    src.loop = !!e.loop
    gain.gain.value = e.gain
    src.connect(gain).connect(master)
    src.start()
    if (e.loop) loops.set(cue, { src, gain })
  })
}

export function stop(cue: Cue) {
  const l = loops.get(cue)
  if (!l || !ctx) return
  loops.delete(cue)
  l.gain.gain.setValueAtTime(l.gain.gain.value, ctx.currentTime)
  l.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.03)
  l.src.stop(ctx.currentTime + 0.05)
}

// While the full voice rings the bed drops 6 dB and comes back over a second.
function duck() {
  if (!ctx || !bed) return
  const t = ctx.currentTime
  bed.gain.cancelScheduledValues(t)
  bed.gain.setValueAtTime(bed.gain.value, t)
  bed.gain.linearRampToValueAtTime(0.5, t + 0.1)
  bed.gain.setValueAtTime(0.5, t + 5)
  bed.gain.linearRampToValueAtTime(1, t + 6)
}

// The bed holds one pass and its tail: a new pass starts every period and the passes overlap.
function startBed() {
  const e = CUES.loop
  if (!e || !e.files.length || bedTimer) return
  const pass = () => {
    void load(e.files[0]!).then((buf) => {
      if (!buf || !ctx || !bed || !on) return
      const src = ctx.createBufferSource()
      const g = ctx.createGain()
      src.buffer = buf
      g.gain.value = e.gain
      src.connect(g).connect(bed)
      src.start()
    })
  }
  pass()
  bedTimer = setInterval(pass, e.periodMs ?? 48000)
}
function stopBed() {
  if (bedTimer) clearInterval(bedTimer)
  bedTimer = null
  if (!ctx || !bed || !master) return
  const old = bed
  old.gain.cancelScheduledValues(ctx.currentTime)
  old.gain.setValueAtTime(old.gain.value, ctx.currentTime)
  old.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.3)
  setTimeout(() => old.disconnect(), 400)
  bed = ctx.createGain()
  bed.gain.value = 1
  bed.connect(master)
}

export function setSound(next: boolean) {
  if (next === on) return
  if (next) {
    on = true
    ensure()
    play('toggle', 0)
    startBed()
  } else {
    play('toggle', 1)
    for (const c of [...loops.keys()]) stop(c)
    stopBed()
    on = false
  }
  try { localStorage.setItem(KEY, next ? '1' : '0') } catch {}
  listeners.forEach((l) => l())
}

// The remembered choice comes back on the first press after load: a browser plays nothing before one.
if (typeof window !== 'undefined') {
  let remembered = false
  try { remembered = localStorage.getItem(KEY) === '1' } catch {}
  if (remembered) {
    const wake = () => { window.removeEventListener('pointerdown', wake); window.removeEventListener('keydown', wake); setSound(true) }
    window.addEventListener('pointerdown', wake)
    window.addEventListener('keydown', wake)
  }
  // Every button press sounds, wherever the button is.
  window.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement | null)?.closest?.('.btn')
    if (el && !(el as HTMLButtonElement).disabled) play('press')
  }, true)
}

export function useSound() {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l) },
    () => on,
    () => false,
  )
}
