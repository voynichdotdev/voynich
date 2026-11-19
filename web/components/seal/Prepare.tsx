'use client'

// Prepare: the weights or adapter file, its manifest, optional base model, and the model's terms. Nothing is sent from here.

import { useId, useRef, useState } from 'react'
import {
  Address, MODEL_BASE_FORMATS, Manifest, Measurement, ModelBaseSchema, Slug, TOKENIZER_FORMATS,
  type Enclave, type MeasurementRecord, type ModelBase, type ModelBaseFormat, type Money, type TokenizerFormat,
} from '@voynich/contract'
import { SKETCH32 } from '@/lib/facts'
import { group, hardware, short } from '@/lib/format'
import { findMeasurement, formatMeasurementLabel, indexMeasurements } from '@/lib/measurements'
import { play } from '@/lib/sound'
import {
  checkLocalBaseFile, formatAdapterOps, inferBaseFormat, inspectAdapterBytes, parseLabels, parseShape, toBaseUnits,
  type AdapterSummary, type BaseCheck, type SealKind,
} from '@/lib/seal'
import { StateTile } from '@/components/tile/Tile'
import { FilePick } from './parts'
import s from './seal.module.css'

export type { AdapterSummary, BaseCheck, SealKind }

export type Draft = {
  sealKind: SealKind
  file: File | null
  adapterInfo: AdapterSummary | null
  adapterError: string | null
  baseSource: string
  baseFormat: ModelBaseFormat
  baseSizeBytes: string
  baseSha256: string
  baseCheck: BaseCheck | null
  manifestMode: 'form' | 'file'
  manifestFile: { name: string; size: number; manifest: Manifest } | null
  manifestFileError: string | null
  inputKind: 'sketch' | 'tensor' | 'text'
  shape: string
  labels: string
  tokenizerFormat: TokenizerFormat
  tokenizerSource: string
  tokenizerSha256: string
  vocabSize: string
  maxInputTokens: string
  maxOutputTokens: string
  name: string
  price: string
  mintKind: 'sol' | 'spl'
  mint: string
  decimals: string
  symbol: string
  sharePct: number
  measurements: string[]
}

const SKETCH_SHAPE = `1, ${SKETCH32.input.channels}, ${SKETCH32.input.height}, ${SKETCH32.input.width}`
const HASH_RE = /^[0-9a-f]{64}$/
const ZERO_HASH_RE = /^0{64}$/

export const EMPTY_DRAFT: Draft = {
  sealKind: 'full', file: null, adapterInfo: null, adapterError: null,
  baseSource: '', baseFormat: 'onnx', baseSizeBytes: '', baseSha256: '', baseCheck: null,
  manifestMode: 'file', manifestFile: null, manifestFileError: null, inputKind: 'sketch', shape: SKETCH_SHAPE, labels: '',
  tokenizerFormat: 'byte-level', tokenizerSource: '', tokenizerSha256: '', vocabSize: '256', maxInputTokens: '512', maxOutputTokens: '64',
  name: '', price: '', mintKind: 'sol', mint: '', decimals: '', symbol: '', sharePct: 0, measurements: [],
}

export type Prepared = {
  file: File
  name: string
  manifest: Manifest
  price: Money
  operatorShareBps: number
  allowedMeasurements: string[]
  base: ModelBase | null
}

export type DraftErrors = Partial<Record<
  | 'file'
  | 'baseSource'
  | 'baseSizeBytes'
  | 'baseSha256'
  | 'baseCheck'
  | 'manifest'
  | 'shape'
  | 'labels'
  | 'tokenizerSource'
  | 'tokenizerSha256'
  | 'vocabSize'
  | 'maxInputTokens'
  | 'maxOutputTokens'
  | 'name'
  | 'price'
  | 'mint'
  | 'decimals'
  | 'symbol'
  | 'measurements',
  string
>>

export function draftPrice(d: Draft): Money | null {
  const decimals = d.mintKind === 'sol' ? 9 : /^\d+$/.test(d.decimals) && Number(d.decimals) <= 18 ? Number(d.decimals) : null
  if (decimals === null) return null
  const amount = toBaseUnits(d.price, decimals)
  if (amount === null) return null
  if (d.mintKind === 'sol') return { amount, mint: null, decimals, symbol: 'SOL' }
  return Address.safeParse(d.mint.trim()).success && d.symbol.trim() ? { amount, mint: d.mint.trim(), decimals, symbol: d.symbol.trim() } : null
}

function parsePositiveInt(raw: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(raw.trim())) return null
  const n = Number(raw.trim())
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : null
}

export function validate(d: Draft): { errors: DraftErrors; value: Prepared | null } {
  const e: DraftErrors = {}
  const name = d.name.trim()
  if (!d.file) e.file = d.sealKind === 'adapter' ? 'Choose the adapter file (.voya).' : 'Choose the weights file.'
  else if (d.file.size === 0) e.file = 'This file is empty.'
  else if (d.sealKind === 'adapter') {
    if (d.adapterError) e.file = d.adapterError
    else if (!d.adapterInfo) e.file = 'Choose a valid voynich/adapter/v1 (.voya) file.'
  }
  if (!Slug.safeParse(name).success) e.name = 'Lowercase letters, digits and single hyphens, up to 32 characters.'

  let base: ModelBase | null = null
  if (d.sealKind === 'adapter') {
    const source = d.baseSource.trim()
    const sha = d.baseSha256.trim().toLowerCase()
    const size = parsePositiveInt(d.baseSizeBytes, 1, Number.MAX_SAFE_INTEGER)
    if (!ModelBaseSchema.shape.source.safeParse(source).success) {
      e.baseSource = 'Use an https://, http://, ipfs://, or hf:// URL (up to 160 characters).'
    }
    if (size === null) e.baseSizeBytes = 'Positive byte count, or pick the local base file below.'
    if (!HASH_RE.test(sha) || ZERO_HASH_RE.test(sha)) {
      e.baseSha256 = '64 lowercase hex characters (non-zero SHA-256).'
    } else if (d.adapterInfo && d.adapterInfo.baseSha256 !== sha) {
      e.baseSha256 = 'Does not match the adapter file baseSha256.'
    }
    if (d.baseCheck && d.baseCheck.compatible === false) {
      e.baseCheck = d.baseCheck.error ?? 'Local base file is incompatible with this adapter.'
    } else if (d.baseCheck && HASH_RE.test(sha) && d.baseCheck.sha256 !== sha) {
      e.baseCheck = 'Local base file SHA-256 does not match Base SHA-256.'
    }
    if (!e.baseSource && !e.baseSizeBytes && !e.baseSha256 && !e.baseCheck && size !== null) {
      const parsed = ModelBaseSchema.safeParse({ source, format: d.baseFormat, sizeBytes: size, sha256: sha })
      if (parsed.success) base = parsed.data
      else e.baseSource = parsed.error.issues[0]?.message ?? 'Base model does not fit the schema.'
    }
  }

  let manifest: Manifest | null = null
  if (d.manifestMode === 'file') {
    if (!d.manifestFile) e.manifest = d.manifestFileError ?? 'Choose the manifest file.'
    else manifest = { ...d.manifestFile.manifest, name }
  } else if (d.inputKind === 'text') {
    const vocabSize = parsePositiveInt(d.vocabSize, 1, 1_000_000)
    const maxInputTokens = parsePositiveInt(d.maxInputTokens, 1, 32_768)
    const maxOutputTokens = d.maxOutputTokens.trim() ? parsePositiveInt(d.maxOutputTokens, 1, 4_096) : undefined
    if (vocabSize === null) e.vocabSize = 'Whole number from 1 to 1,000,000.'
    if (maxInputTokens === null) e.maxInputTokens = 'Whole number from 1 to 32,768.'
    if (d.maxOutputTokens.trim() && maxOutputTokens === null) e.maxOutputTokens = 'Whole number from 1 to 4,096.'

    const tokSource = d.tokenizerSource.trim()
    const tokSha = d.tokenizerSha256.trim().toLowerCase()
    if (d.tokenizerFormat !== 'byte-level') {
      if (!ModelBaseSchema.shape.source.safeParse(tokSource).success) {
        e.tokenizerSource = 'Required for bpe and word-piece: https://, http://, ipfs://, or hf:// URL.'
      }
      if (!HASH_RE.test(tokSha) || ZERO_HASH_RE.test(tokSha)) {
        e.tokenizerSha256 = 'Required for bpe and word-piece: 64 lowercase hex characters.'
      }
    }
    if (!e.vocabSize && !e.maxInputTokens && !e.maxOutputTokens && !e.tokenizerSource && !e.tokenizerSha256 && vocabSize !== null && maxInputTokens !== null) {
      const labels = parseLabels(d.labels)
      manifest = {
        name,
        inputKind: 'text',
        tokenizer: {
          format: d.tokenizerFormat,
          vocabSize,
          maxInputTokens,
          ...(maxOutputTokens !== undefined && maxOutputTokens !== null ? { maxOutputTokens } : {}),
          ...(d.tokenizerFormat !== 'byte-level' ? { source: tokSource, sha256: tokSha } : {}),
        },
        ...(labels.length ? { labels } : {}),
      }
    }
  } else {
    const shape = parseShape(d.shape)
    const labels = parseLabels(d.labels)
    if (!shape.length || shape.some((n) => !Number.isInteger(n) || n <= 0)) e.shape = 'Whole numbers above zero, for example 1, 1, 28, 28.'
    if (!labels.length) e.labels = 'Give at least one label.'
    if (!e.shape && !e.labels) manifest = { name, inputKind: d.inputKind, inputShape: shape, labels }
  }
  if (manifest && !e.name && !Manifest.safeParse(manifest).success) e.manifest = 'This manifest does not fit the schema.'

  if (d.mintKind === 'spl') {
    if (!Address.safeParse(d.mint.trim()).success) e.mint = 'This is not a mint address.'
    if (!/^\d+$/.test(d.decimals) || Number(d.decimals) > 18) e.decimals = 'From 0 to 18.'
    if (!d.symbol.trim()) e.symbol = 'Give the symbol.'
  }
  const price = draftPrice(d)
  if (!price && !e.mint && !e.decimals && !e.symbol) e.price = `An amount with at most ${d.mintKind === 'sol' ? 9 : d.decimals} decimal places.`
  if (!d.measurements.length) e.measurements = 'Allow at least one measurement.'

  const ok = Object.keys(e).length === 0 && d.file && manifest && price && (d.sealKind === 'full' || !!base)
  return {
    errors: e,
    value: ok
      ? { file: d.file!, name, manifest: manifest!, price: price!, operatorShareBps: d.sharePct * 100, allowedMeasurements: d.measurements, base }
      : null,
  }
}

export function PrepareForm({ draft, set, errors, enclaves, publishedMeasurements = null, maxSharePct }: {
  draft: Draft; set: (patch: Partial<Draft>) => void; errors: DraftErrors; enclaves: Enclave[] | null; publishedMeasurements?: MeasurementRecord[] | null; maxSharePct: number
}) {
  const id = useId()
  const [custom, setCustom] = useState('')
  const [customError, setCustomError] = useState(false)
  const [checkingBase, setCheckingBase] = useState(false)
  const adapterBytesRef = useRef<Uint8Array | null>(null)
  const baseBytesRef = useRef<{ bytes: Uint8Array; fileName: string } | null>(null)
  const err = (k: keyof DraftErrors) => (errors[k] ? <span className="err" id={`${id}-${k}`} role="alert">{errors[k]}</span> : null)
  const bad = (k: keyof DraftErrors) => ({ 'aria-invalid': errors[k] ? true : undefined, 'aria-describedby': errors[k] ? `${id}-${k}` : undefined })

  const switchKind = (nextKind: SealKind) => {
    if (nextKind === draft.sealKind) return
    play('toggle')
    adapterBytesRef.current = null
    if (nextKind === 'full') {
      baseBytesRef.current = null
      set({ sealKind: 'full', adapterInfo: null, adapterError: null, baseCheck: null })
    } else {
      set({ sealKind: 'adapter', file: null, adapterInfo: null, adapterError: null, baseCheck: null })
    }
  }

  const pickWeights = async (f: File) => {
    if (draft.sealKind === 'full') {
      adapterBytesRef.current = null
      set({ file: f, adapterInfo: null, adapterError: null })
      return
    }
    const bytes = new Uint8Array(await f.arrayBuffer())
    const parsed = inspectAdapterBytes(bytes)
    if (!parsed.ok) {
      adapterBytesRef.current = null
      set({ file: f, adapterInfo: null, adapterError: parsed.error })
      return
    }
    adapterBytesRef.current = bytes
    const nextCheck = baseBytesRef.current
      ? checkLocalBaseFile(baseBytesRef.current.bytes, baseBytesRef.current.fileName, bytes, draft.baseFormat)
      : draft.baseCheck
    set({
      file: f,
      adapterInfo: parsed.info,
      adapterError: null,
      baseFormat: parsed.info.format,
      baseSha256: parsed.info.baseSha256,
      baseCheck: nextCheck,
    })
  }

  const pickLocalBase = async (f: File) => {
    setCheckingBase(true)
    try {
      const bytes = new Uint8Array(await f.arrayBuffer())
      const format = inferBaseFormat(f.name) ?? draft.baseFormat
      baseBytesRef.current = { bytes, fileName: f.name }
      const check = checkLocalBaseFile(bytes, f.name, adapterBytesRef.current, format)
      set({
        baseFormat: format,
        baseSizeBytes: String(check.sizeBytes),
        baseSha256: check.sha256,
        baseCheck: check,
      })
    } finally {
      setCheckingBase(false)
    }
  }

  const switchBaseFormat = (format: ModelBaseFormat) => {
    play('toggle')
    const nextCheck = baseBytesRef.current
      ? checkLocalBaseFile(baseBytesRef.current.bytes, baseBytesRef.current.fileName, adapterBytesRef.current, format)
      : draft.baseCheck
    set({ baseFormat: format, baseCheck: nextCheck })
  }

  const readManifest = async (f: File) => {
    try {
      const parsed = Manifest.safeParse(JSON.parse(await f.text()))
      if (!parsed.success) { set({ manifestFile: null, manifestFileError: `${f.name} does not fit the manifest schema: ${parsed.error.issues[0]?.path.join('.') || 'manifest'} ${parsed.error.issues[0]?.message.toLowerCase() ?? ''}`.trim() }); return }
      set({ manifestFile: { name: f.name, size: f.size, manifest: parsed.data }, manifestFileError: null, ...(draft.name ? {} : { name: parsed.data.name }) })
    } catch {
      set({ manifestFile: null, manifestFileError: `${f.name} is not JSON.` })
    }
  }

  // The measurements registered enclaves run and published active builds, each once, then any the owner typed.
  const registered = new Map<string, { hw: string; n: number }>()
  for (const e of enclaves ?? []) {
    const key = e.measurement.toLowerCase()
    registered.set(key, { hw: hardware(e.hardwareType), n: (registered.get(key)?.n ?? 0) + 1 })
  }
  const published = indexMeasurements(publishedMeasurements ?? [])
  const seen = new Set<string>()
  const options: string[] = []
  for (const m of [...registered.keys(), ...Object.keys(published), ...draft.measurements.map((x) => x.toLowerCase())]) {
    if (!seen.has(m)) { seen.add(m); options.push(m) }
  }
  const toggle = (m: string) => { play('toggle'); set({ measurements: draft.measurements.includes(m) ? draft.measurements.filter((x) => x !== m) : [...draft.measurements, m] }) }
  const addCustom = () => {
    const v = custom.trim().toLowerCase()
    if (!Measurement.safeParse(v).success) { setCustomError(true); return }
    if (!draft.measurements.includes(v)) set({ measurements: [...draft.measurements, v] })
    setCustom('')
  }

  const mf = draft.manifestFile?.manifest
  const isAdapter = draft.sealKind === 'adapter'

  return (
    <div className={s.form}>
      {/* what a person brings */}
      <div className={s.bring}>
        <section className={s.bringCol} aria-labelledby={`${id}-h-weights`}>
          <div className={s.bringHead}>
            <h3 className="t-h3" id={`${id}-h-weights`}>{isAdapter ? 'Adapter file' : 'Weights file'}</h3>
            <div className="seg" role="group" aria-label="Seal type">
              <button type="button" aria-pressed={!isAdapter} onClick={() => switchKind('full')}>Full model</button>
              <button type="button" aria-pressed={isAdapter} onClick={() => switchKind('adapter')}>Sealed adapter</button>
            </div>
          </div>
          <div className="field">
            <FilePick
              label={isAdapter ? 'Adapter file' : 'Weights file'}
              empty={isAdapter ? 'A voynich/adapter/v1 file (.voya)' : 'An ONNX file'}
              accept={isAdapter ? '.voya,application/octet-stream' : undefined}
              file={draft.file ? { name: draft.file.name, size: draft.file.size } : null}
              invalid={!!errors.file || !!draft.adapterError}
              describedBy={errors.file ? `${id}-file` : undefined}
              onPick={(f) => void pickWeights(f)}
            />
            {isAdapter && draft.adapterInfo ? (
              <span className="help">
                <span className="mono">voynich/adapter/v1</span>, {formatAdapterOps(draft.adapterInfo)}, base <span className="mono">{short(draft.adapterInfo.baseSha256, 6)}</span>
              </span>
            ) : !errors.file && draft.adapterError ? (
              <span className="err" role="alert">{draft.adapterError}</span>
            ) : null}
            {err('file')}
          </div>
        </section>

        <section className={s.bringCol} aria-labelledby={`${id}-h-manifest`}>
          <div className={s.bringHead}>
            <h3 className="t-h3" id={`${id}-h-manifest`}>Manifest</h3>
            <div className="seg" role="group" aria-label="Manifest source">
              <button type="button" aria-pressed={draft.manifestMode === 'file'} onClick={() => { play('toggle'); set({ manifestMode: 'file' }) }}>JSON file</button>
              <button type="button" aria-pressed={draft.manifestMode === 'form'} onClick={() => { play('toggle'); set({ manifestMode: 'form' }) }}>Fill in</button>
            </div>
          </div>
          {draft.manifestMode === 'file' ? (
            <div className="field">
              <FilePick label="Manifest file" empty="A manifest in JSON" accept=".json,application/json" file={draft.manifestFile} invalid={!!errors.manifest} describedBy={errors.manifest ? `${id}-manifest` : undefined} onPick={(f) => void readManifest(f)} />
              {mf ? (
                mf.inputKind === 'text' ? (
                  <span className="help">
                    text input{mf.tokenizer ? <>, <span className="mono">{mf.tokenizer.format}</span> tokenizer, vocab <span className="mono">{group(mf.tokenizer.vocabSize)}</span></> : null}
                    {mf.labels?.length ? `, ${mf.labels.length} labels` : null}
                  </span>
                ) : (
                  <span className="help">{mf.inputKind} input, shape <span className="mono">{(mf.inputShape ?? []).join(' × ')}</span>, {(mf.labels ?? []).length} labels</span>
                )
              ) : !errors.manifest && draft.manifestFileError ? <span className="err" role="alert">{draft.manifestFileError}</span> : null}
              {err('manifest')}
            </div>
          ) : (
            <div className={s.manifest}>
              <div className={draft.inputKind === 'text' ? s.manifestHead : s.two}>
                <div className="field">
                  <span className="t-label" id={`${id}-kind`}>Input kind</span>
                  <div className="seg" role="group" aria-labelledby={`${id}-kind`}>
                    <button type="button" aria-pressed={draft.inputKind === 'sketch'} onClick={() => { play('toggle'); set({ inputKind: 'sketch', shape: draft.shape || SKETCH_SHAPE }) }}>sketch</button>
                    <button type="button" aria-pressed={draft.inputKind === 'tensor'} onClick={() => { play('toggle'); set({ inputKind: 'tensor' }) }}>tensor</button>
                    <button type="button" aria-pressed={draft.inputKind === 'text'} onClick={() => { play('toggle'); set({ inputKind: 'text' }) }}>text</button>
                  </div>
                </div>
                {draft.inputKind !== 'text' ? (
                  <div className="field">
                    <label htmlFor={`${id}-shape-in`}>Input shape</label>
                    <input id={`${id}-shape-in`} className="input mono" value={draft.shape} onChange={(e) => set({ shape: e.target.value })} spellCheck={false} autoComplete="off" {...bad('shape')} />
                    {err('shape')}
                  </div>
                ) : null}
              </div>

              {draft.inputKind === 'text' ? (
                <>
                  <div className="field">
                    <span className="t-label" id={`${id}-tok-fmt`}>Tokenizer format</span>
                    <div className="seg" role="group" aria-labelledby={`${id}-tok-fmt`}>
                      {TOKENIZER_FORMATS.map((fmt) => (
                        <button key={fmt} type="button" aria-pressed={draft.tokenizerFormat === fmt} onClick={() => { play('toggle'); set({ tokenizerFormat: fmt }) }}>{fmt}</button>
                      ))}
                    </div>
                  </div>
                  <div className={s.three}>
                    <div className="field">
                      <label htmlFor={`${id}-vocab-in`}>Vocab size</label>
                      <input id={`${id}-vocab-in`} className="input mono" inputMode="numeric" value={draft.vocabSize} onChange={(e) => set({ vocabSize: e.target.value })} autoComplete="off" {...bad('vocabSize')} />
                      {err('vocabSize')}
                    </div>
                    <div className="field">
                      <label htmlFor={`${id}-max-in`}>Max input tokens</label>
                      <input id={`${id}-max-in`} className="input mono" inputMode="numeric" value={draft.maxInputTokens} onChange={(e) => set({ maxInputTokens: e.target.value })} autoComplete="off" {...bad('maxInputTokens')} />
                      {err('maxInputTokens')}
                    </div>
                    <div className="field">
                      <label htmlFor={`${id}-max-out`}>Max output tokens</label>
                      <input id={`${id}-max-out`} className="input mono" inputMode="numeric" value={draft.maxOutputTokens} onChange={(e) => set({ maxOutputTokens: e.target.value })} autoComplete="off" placeholder="Optional" {...bad('maxOutputTokens')} />
                      {err('maxOutputTokens')}
                    </div>
                  </div>
                  {draft.tokenizerFormat !== 'byte-level' ? (
                    <div className={s.two}>
                      <div className="field">
                        <label htmlFor={`${id}-tok-src`}>Tokenizer source URL</label>
                        <input id={`${id}-tok-src`} className="input mono" value={draft.tokenizerSource} onChange={(e) => set({ tokenizerSource: e.target.value })} spellCheck={false} autoComplete="off" placeholder="hf://repo/tokenizer.json" {...bad('tokenizerSource')} />
                        {err('tokenizerSource')}
                      </div>
                      <div className="field">
                        <label htmlFor={`${id}-tok-sha`}>Tokenizer SHA-256</label>
                        <input id={`${id}-tok-sha`} className="input mono" value={draft.tokenizerSha256} onChange={(e) => set({ tokenizerSha256: e.target.value.toLowerCase() })} spellCheck={false} autoComplete="off" maxLength={64} {...bad('tokenizerSha256')} />
                        {err('tokenizerSha256')}
                      </div>
                    </div>
                  ) : null}
                  <div className="field">
                    <label htmlFor={`${id}-labels-in`}>Labels (optional, one a line)</label>
                    <textarea id={`${id}-labels-in`} className={`textarea mono ${s.labels}`} value={draft.labels} onChange={(e) => set({ labels: e.target.value })} spellCheck={false} {...bad('labels')} />
                    {err('labels') ?? (
                      <span className="help">
                        {parseLabels(draft.labels).length ? `${parseLabels(draft.labels).length} labels (text classification)` : 'Leave empty for text generation.'}
                      </span>
                    )}
                    {err('manifest')}
                  </div>
                </>
              ) : (
                <div className="field">
                  <label htmlFor={`${id}-labels-in`}>Labels, one a line</label>
                  <textarea id={`${id}-labels-in`} className={`textarea mono ${s.labels}`} value={draft.labels} onChange={(e) => set({ labels: e.target.value })} spellCheck={false} {...bad('labels')} />
                  {err('labels') ?? (parseLabels(draft.labels).length ? <span className="help">{parseLabels(draft.labels).length} labels</span> : null)}
                  {err('manifest')}
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      {/* open base model reference, when sealing an adapter */}
      {isAdapter ? (
        <section className={`panel ${s.settings}`} aria-labelledby={`${id}-h-base`}>
          <div className="panel-head"><h3 id={`${id}-h-base`}>Base model</h3></div>

          <div className={s.set}>
            <label htmlFor={`${id}-base-src`}>Source URL</label>
            <div className="field">
              <input
                id={`${id}-base-src`}
                className="input mono"
                value={draft.baseSource}
                onChange={(e) => set({ baseSource: e.target.value })}
                spellCheck={false}
                autoComplete="off"
                maxLength={160}
                placeholder="https://..., ipfs://..., or hf://..."
                {...bad('baseSource')}
              />
              {err('baseSource') ?? <span className="help">Where enclaves fetch the open base model. Verified by SHA-256 before merging.</span>}
            </div>
          </div>

          <div className={s.set}>
            <span className={s.setLabel} id={`${id}-base-fmt`}>Format</span>
            <div className="field">
              <div className="seg" role="group" aria-labelledby={`${id}-base-fmt`}>
                {MODEL_BASE_FORMATS.map((fmt) => (
                  <button key={fmt} type="button" aria-pressed={draft.baseFormat === fmt} onClick={() => switchBaseFormat(fmt)}>{fmt}</button>
                ))}
              </div>
            </div>
          </div>

          <div className={s.set}>
            <label htmlFor={`${id}-base-size`}>Size (bytes)</label>
            <div className="field">
              <input
                id={`${id}-base-size`}
                className="input mono"
                inputMode="numeric"
                value={draft.baseSizeBytes}
                onChange={(e) => set({ baseSizeBytes: e.target.value })}
                autoComplete="off"
                placeholder="Exact byte length of the base file"
                {...bad('baseSizeBytes')}
              />
              {err('baseSizeBytes')}
            </div>
          </div>

          <div className={s.set}>
            <label htmlFor={`${id}-base-sha`}>Base SHA-256</label>
            <div className="field">
              <input
                id={`${id}-base-sha`}
                className="input mono"
                value={draft.baseSha256}
                onChange={(e) => set({ baseSha256: e.target.value.toLowerCase() })}
                spellCheck={false}
                autoComplete="off"
                maxLength={64}
                placeholder="Auto-filled from adapter or local base file"
                {...bad('baseSha256')}
              />
              {err('baseSha256')}
            </div>
          </div>

          <div className={s.set}>
            <span className={s.setLabel} id={`${id}-base-check`}>Local check (optional)</span>
            <div className="field">
              <FilePick
                label="Local base file"
                empty="Pick local base file to hash and check adapter tensors"
                accept=".onnx,.safetensors,.gguf"
                file={draft.baseCheck ? { name: draft.baseCheck.fileName, size: draft.baseCheck.sizeBytes } : null}
                invalid={!!errors.baseCheck || draft.baseCheck?.compatible === false}
                describedBy={errors.baseCheck ? `${id}-baseCheck` : undefined}
                onPick={(f) => void pickLocalBase(f)}
              />
              {checkingBase ? (
                <span className="help"><StateTile state="pending" size={14} /> Hashing and inspecting ONNX initializers on this device.</span>
              ) : draft.baseCheck ? (
                draft.baseCheck.compatible === true ? (
                  <span className={`t-small ${s.baseOk}`}>
                    <StateTile state="passed" size={14} />
                    Verified locally: SHA-256 and all {draft.adapterInfo?.tensorCount ?? 0} adapter tensors match the base file.
                  </span>
                ) : draft.baseCheck.compatible === false ? (
                  <span className="err" role="alert">{draft.baseCheck.error}</span>
                ) : (
                  <span className="help">Hashed <span className="mono">{short(draft.baseCheck.sha256, 8)}</span> ({group(draft.baseCheck.sizeBytes)} B). Pick the adapter file to verify tensor names and dims.</span>
                )
              ) : (
                <span className="help">Read only on this device. Fills size and SHA-256 and verifies ONNX initializer dims before signing.</span>
              )}
              {err('baseCheck')}
            </div>
          </div>
        </section>
      ) : null}

      {/* the settings, one group */}
      <section className={`panel ${s.settings}`} aria-labelledby={`${id}-h-settings`}>
        <div className="panel-head"><h3 id={`${id}-h-settings`}>Settings</h3></div>

        <div className={s.set}>
          <label htmlFor={`${id}-name-in`}>Name</label>
          <div className="field">
            <input id={`${id}-name-in`} className="input mono" value={draft.name} onChange={(e) => set({ name: e.target.value.toLowerCase() })} spellCheck={false} autoComplete="off" autoCapitalize="off" maxLength={32} {...bad('name')} />
            {err('name') ?? <span className="help">The model is called at this name.</span>}
          </div>
        </div>

        <div className={s.set}>
          <label htmlFor={`${id}-price-in`}>Price per call</label>
          <div className="field">
            <div className={s.price}>
              <div className="input-row">
                <input id={`${id}-price-in`} className="input mono" inputMode="decimal" value={draft.price} onChange={(e) => set({ price: e.target.value })} autoComplete="off" {...bad('price')} />
                <span className="suffix">{draft.mintKind === 'sol' ? 'SOL' : draft.symbol.trim() || 'token'}</span>
              </div>
              <div className="seg" role="group" aria-label="Paid in">
                <button type="button" aria-pressed={draft.mintKind === 'sol'} onClick={() => { play('toggle'); set({ mintKind: 'sol' }) }}>SOL</button>
                <button type="button" aria-pressed={draft.mintKind === 'spl'} onClick={() => { play('toggle'); set({ mintKind: 'spl' }) }}>SPL token</button>
              </div>
            </div>
            {err('price')}
            {draft.mintKind === 'spl' ? (
              <div className={s.mint}>
                <div className="field">
                  <label htmlFor={`${id}-mint-in`}>Mint address</label>
                  <input id={`${id}-mint-in`} className="input mono" value={draft.mint} onChange={(e) => set({ mint: e.target.value })} spellCheck={false} autoComplete="off" {...bad('mint')} />
                  {err('mint')}
                </div>
                <div className="field">
                  <label htmlFor={`${id}-decimals-in`}>Decimals</label>
                  <input id={`${id}-decimals-in`} className="input mono" inputMode="numeric" value={draft.decimals} onChange={(e) => set({ decimals: e.target.value })} autoComplete="off" {...bad('decimals')} />
                  {err('decimals')}
                </div>
                <div className="field">
                  <label htmlFor={`${id}-symbol-in`}>Symbol</label>
                  <input id={`${id}-symbol-in`} className="input mono" value={draft.symbol} onChange={(e) => set({ symbol: e.target.value })} maxLength={12} spellCheck={false} autoComplete="off" {...bad('symbol')} />
                  {err('symbol')}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className={s.set}>
          <label htmlFor={`${id}-share-in`}>Operator share</label>
          <div className="field">
            <div className={s.share}>
              <input id={`${id}-share-in`} type="range" className={s.range} min={0} max={maxSharePct} step={1} value={draft.sharePct} onChange={(e) => set({ sharePct: Number(e.target.value) })} aria-valuetext={`${draft.sharePct} percent`} />
              <output htmlFor={`${id}-share-in`} className="t-fig t-fig-s">{draft.sharePct}<span className="unit">%</span></output>
            </div>
            <span className="help">The part of every call paid to the operator whose enclave answers it.</span>
          </div>
        </div>

        <div className={s.set}>
          <span className={s.setLabel} id={`${id}-h-allowed`}>Allowed measurements</span>
          <div className="field">
            {enclaves === null && publishedMeasurements === null ? <span className="skeleton" style={{ width: '60%' }} /> : options.length ? (
              <ul className={s.measures} aria-labelledby={`${id}-h-allowed`} aria-describedby={errors.measurements ? `${id}-measurements` : undefined}>
                {options.map((m) => {
                  const on = draft.measurements.includes(m)
                  const reg = registered.get(m)
                  const pub = findMeasurement(published, m)
                  return (
                    <li key={m}>
                      <button type="button" aria-pressed={on} onClick={() => toggle(m)} title={m}>
                        <StateTile state={on ? 'live' : 'waiting'} />
                        <span className="mono">{short(m, 10)}</span>
                        {pub ? <span className="t-small">{formatMeasurementLabel(pub)}</span> : null}
                        <span className="t-small dim">{reg ? `${reg.hw}, ${reg.n} ${reg.n === 1 ? 'enclave' : 'enclaves'}` : pub ? 'Published' : 'Added here'}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            ) : <span className="help">No enclave or published measurement is registered yet. Add the measurement of the software you allow.</span>}
            {err('measurements')}
            <div className={s.add}>
              <input id={`${id}-custom`} className="input mono" value={custom} spellCheck={false} autoComplete="off" aria-label="Another measurement, in hex" placeholder="Another measurement, in hex" aria-invalid={customError || undefined}
                onChange={(e) => { setCustom(e.target.value); setCustomError(false) }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom() } }} />
              <button type="button" className="btn" onClick={addCustom}>Add</button>
            </div>
            {customError ? <span className="err" role="alert">A measurement is 96 hex characters.</span> : <span className="help">Only enclaves running software with one of these measurements can be granted the key.</span>}
          </div>
        </div>
      </section>
    </div>
  )
}
