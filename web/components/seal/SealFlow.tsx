'use client'

// Sealing a model, end to end: the work on the left, the model as it will be on chain on the right.

import Link from 'next/link'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { DEFAULT_UPLOAD_KEYS, fromBase64, toBase64, type Build, type Config, type Enclave, type MeasurementRecord, type Model, type Money } from '@voynich/contract'
import { sealWeights, toHex, wrapKey } from 'voynich/crypto'
import { api, indexed, read } from '@/lib/api'
import { SEAL_STEPS, SKETCH32 } from '@/lib/facts'
import { b64ToBytes, bps, group, hardware, short } from '@/lib/format'
import {
  keyFileBody, keyFileName, loadModelKey, loadUploadSecret, loadUploadSecrets, openKeyFile, parseKeyFile, saveModelKey, saveUploadSecrets, setVaultPassword, unlockVault, useVault,
  type SealedKeyFile,
} from '@/lib/keys'
import {
  INITIAL_CREATE_WEIGHTS, WRITE_BYTES, addSealMetrics, allocateWeights, attachWeights, buildFeeLamports, deriveWalletSealSecrets, modelPdaAddress, planWeights, chunkCount, chunkFlags, clearSeal, getCiphertext, loadSeal, newUploadKeys, progressOf, putCiphertext, reseal, resumeCliCommand, saveSeal,
  sealChunkCount, sealRanges, sealSummary, signWithUploadKey, stateFromModel, sweepExtraUploadKeys, uploadFunding, weightsCount, writeChunks, type SealState, type SealStepId,
} from '@/lib/seal'
import { play } from '@/lib/sound'
import { TxError, errorMessage as txMessage, send } from '@/lib/tx'
import { wallet } from '@/lib/wallet'
import { useWallet } from '@/src/engines/wallet/react'
import { Frame } from '@/components/drawn/Drawn'
import { WalletButton } from '@/components/nav/WalletButton'
import { State, StateTile, TileStrip } from '@/components/tile/Tile'
import { Amount, Hash, Loading, Size, Stat } from '@/components/ui/kit'
import { HalfHash } from '@/components/receipt/HalfHash'
import { Split, q, type SplitPart } from '@/components/receipt/shared'
import { EMPTY_DRAFT, PrepareForm, draftPrice, validate, type Draft, type DraftErrors, type Prepared } from './Prepare'
import { CELLS, CipherTiles, Needs, Stages, StepRail, type Need, type TxStage } from './parts'
import { PasswordForm } from './Password'
import s from './seal.module.css'

type Busy = 'encrypting' | 'reading' | 'writing' | 'building' | 'signing' | 'confirming' | null

// The API-backed steps as they can be opened by URL.
const SNAPSHOTS: Record<string, { step: SealStepId; busy?: Busy; failed?: boolean }> = {
  'seal-encrypting': { step: 'encrypt', busy: 'encrypting' },
  'seal-awaiting-signature': { step: 'create', busy: 'signing' },
  'seal-uploading': { step: 'write', busy: 'writing' },
  'seal-upload-failed': { step: 'write', failed: true },
  'seal-ready': { step: 'seal' },
  'seal-grant': { step: 'grant' },
  'seal-done': { step: 'done' },
}
const STEP_IDS = SEAL_STEPS.map((x) => x.id) as readonly string[]
// What went wrong, as a sentence. A request that never reached the API has no message of its own.
const errorMessage = (e: unknown) => {
  const m = e instanceof TypeError ? 'The API did not answer.' : txMessage(e)
  return /[.!?]$/.test(m) ? m : `${m}.`
}
const txStage = (b: Busy): TxStage => (b === 'building' || b === 'signing' || b === 'confirming' ? b : null)

export function SealFlow({ fixture, resumeModel = null }: { fixture: string | null; resumeModel?: string | null }) {
  const w = useWallet(wallet)
  const address = w.status === 'connected' ? w.address : null
  const client = api(fixture)

  const [ready, setReady] = useState(false)
  const [step, setStep] = useState<SealStepId>('prepare')
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [errors, setErrors] = useState<DraftErrors>({})
  const [st, setSt] = useState<SealState | null>(null)
  const [kept, setKept] = useState(true) // false for a state opened by URL: it is shown, not saved
  const [paused, setPaused] = useState(false)
  const [busy, setBusy] = useState<Busy>(null)
  const [allocating, setAllocating] = useState(false) // Create is signing for a weights account, before the model itself
  const [rangeProgress, setRangeProgress] = useState<{ done: number; total: number } | null>(null)
  const [quoted, setQuoted] = useState<{ rent: string; funding: string; writeChunkBytes: number; uploadKeyCount: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [config, setConfig] = useState<Config | null>(null)
  const [enclaves, setEnclaves] = useState<Enclave[] | null>(null)
  const [publishedMeasurements, setPublishedMeasurements] = useState<MeasurementRecord[] | null>(null)
  const [choice, setChoice] = useState<string | null>(null)
  const [revealed, setRevealed] = useState(0)
  const [keyFileTaken, setKeyFileTaken] = useState(false)
  const [wantWeights, setWantWeights] = useState(false)
  const [chain, setChain] = useState<Model['status'] | null>(null) // the model's status as the API last gave it
  const [open, setOpen] = useState(false) // the summary, on a phone
  const [resumeInput, setResumeInput] = useState(resumeModel ?? '')
  const [cliCopied, setCliCopied] = useState(false)
  const sideId = useId()
  const pwId = useId()
  const resumeId = useId()
  const vault = useVault()
  const [pwBusy, setPwBusy] = useState(false)
  const [keyFile, setKeyFile] = useState<{ name: string; sealed: SealedKeyFile } | null>(null) // a chosen key file that waits for its password
  const [, setTick] = useState(0)

  const prepared = useRef<Prepared | null>(null)
  const cipher = useRef<Uint8Array | null>(null)
  const sample = useRef<Uint8Array | null>(null)
  const key = useRef<Uint8Array | null>(null)
  const derivedWeightsPlan = useRef<{ addresses: string[]; secrets: Uint8Array[] } | null>(null)
  const flags = useRef<Uint8Array>(new Uint8Array(0))
  const stop = useRef({ now: false })
  const lastChunkSound = useRef(0)
  const redraw = useRef<ReturnType<typeof setTimeout> | null>(null)
  const work = useRef<HTMLDivElement>(null)
  const pick = useRef<HTMLInputElement>(null)

  const bump = useCallback(() => {
    if (redraw.current) return
    redraw.current = setTimeout(() => { redraw.current = null; setTick((n) => n + 1) }, 80)
  }, [])
  const persist = useCallback((next: SealState, keep = kept) => { setSt(next); if (keep) saveSeal(next) }, [kept])
  const go = (next: SealStepId) => { setStep(next); setError(null); work.current?.focus({ preventScroll: true }) }

  // ---------- arrival: a state named in the URL, a seal left unfinished, or a fresh start ----------
  useEffect(() => {
    let live = true
    const c = api(fixture)
    void read(c.config()).then((r) => { if (live && r.ok) setConfig(r.data) })
    void read(c.enclaves({ limit: 100 })).then((r) => { if (live) setEnclaves(r.ok ? r.data.items : []) })
    void read(c.measurements({ status: 'active', limit: 100 })).then((r) => { if (live) setPublishedMeasurements(r.ok ? r.data.items : []) })
    const snap = fixture ? SNAPSHOTS[fixture] : undefined
    if (snap) {
      void read(c.model(SKETCH32.id)).then(async (m) => {
        if (!live) return
        if (!m.ok) { setError(m.message); setReady(true); return }
        const next = stateFromModel(m.data, snap.step)
        if (snap.step === 'encrypt' || snap.step === 'create') { next.model = undefined; next.uploadKey = undefined }
        if (snap.step === 'encrypt') next.sha256 = null
        flags.current = chunkFlags(next.sizeBytes, snap.step === 'create' ? [] : m.data.upload?.writtenRanges ?? [])
        const bytes = await read(c.weights(m.data.address, { offset: 0, length: CELLS }))
        if (!live) return
        if (bytes.ok) sample.current = b64ToBytes(bytes.data.bytesBase64)
        setKept(false); setSt(next); setStep(snap.step); setChain(next.model ? m.data.status : null); setBusy(snap.busy ?? null); setRevealed(snap.busy === 'encrypting' ? 0 : CELLS)
        if (snap.failed) setError('A write did not confirm.')
        setReady(true)
      })
    } else {
      const saved = loadSeal()
      if (saved && STEP_IDS.includes(saved.step)) {
        key.current = loadModelKey(saved.model ?? saved.name) ?? loadModelKey(saved.name)
        flags.current = new Uint8Array(chunkCount(saved.sizeBytes, saved.writeChunkBytes ?? WRITE_BYTES))
        setSt(saved); setStep(saved.step); setPaused(true)
        void getCiphertext(saved.sha256).then((b) => { if (live && b) { cipher.current = b; setRevealed(CELLS) } })
      }
      setReady(true)
    }
    return () => { live = false; stop.current.now = true }
  }, [fixture])

  // What the chain takes as rent for this model, quoted once the ciphertext's size is known.
  const quotedSize = step === 'create' ? st?.sizeBytes ?? 0 : 0
  useEffect(() => {
    if (!quotedSize) return
    let live = true
    void read(api(fixture).quoteModel({ sizeBytes: quotedSize, uploadKeyCount: DEFAULT_UPLOAD_KEYS })).then((r) => {
      if (live && r.ok && !r.data.fixture) {
        setQuoted({
          rent: (BigInt(r.data.modelRentLamports) + BigInt(r.data.weightsRentLamports)).toString(),
          funding: r.data.uploadFundingLamports,
          writeChunkBytes: r.data.writeChunkBytes,
          uploadKeyCount: r.data.uploadKeyCount,
        })
      }
    })
    return () => { live = false }
  }, [fixture, quotedSize])

  const reset = () => {
    stop.current.now = true
    clearSeal()
    cipher.current = null; sample.current = null; key.current = null; derivedWeightsPlan.current = null; prepared.current = null; flags.current = new Uint8Array(0)
    setSt(null); setDraft(EMPTY_DRAFT); setErrors({}); setStep('prepare'); setPaused(false); setBusy(null); setError(null); setRevealed(0); setChoice(null); setKeyFileTaken(false); setWantWeights(false); setKept(true); setChain(null); setKeyFile(null); setRangeProgress(null)
  }

  // ---------- Prepare ----------
  const maxSharePct = Math.floor((10000 - (config?.protocolShareBps ?? 0)) / 100)
  const toEncrypt = () => {
    const v = validate(draft)
    setErrors(v.errors)
    if (!v.value) {
      requestAnimationFrame(() => (work.current?.querySelector('[aria-invalid="true"]') as HTMLElement | null)?.focus())
      return
    }
    prepared.current = v.value
    go('encrypt')
  }

  // ---------- Encrypt ----------
  const reveal = () => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setRevealed(CELLS); return }
    let n = 0
    const t = setInterval(() => { n += CELLS / 8; setRevealed(Math.min(CELLS, Math.round(n))); if (n >= CELLS) clearInterval(t) }, 80)
  }
  const encrypt = async () => {
    const p = prepared.current
    if (!p || busy) return
    setBusy('encrypting'); setError(null)
    await new Promise((r) => setTimeout(r, 60))
    try {
      const plaintext = new Uint8Array(await p.file.arrayBuffer())
      const cfg = config ?? (await read(client.config()).then((r) => (r.ok ? r.data : null)))
      let out
      let derivedUploadKeys: string[] | undefined
      let derivedUploadSecrets: Record<string, string> | undefined
      let derived = false
      if (address && w.canSignMessage && cfg?.programId && !cfg.fixture) {
        setBusy('signing')
        const modelAddr = await modelPdaAddress(cfg.programId, p.name)
        const expectedCipherBytes = plaintext.length + Math.ceil(plaintext.length / 65536) * 16
        const secrets = await deriveWalletSealSecrets({
          programId: cfg.programId,
          modelAddress: modelAddr,
          weightsKeyCount: weightsCount(expectedCipherBytes),
        })
        setBusy('encrypting')
        derivedWeightsPlan.current = secrets.weightsPlan
        derivedUploadKeys = secrets.uploadKeys.map((k) => k.address)
        derivedUploadSecrets = Object.fromEntries(secrets.uploadKeys.map((k) => [k.address, k.secret]))
        if (vault.unlocked) saveUploadSecrets(derivedUploadSecrets)
        out = sealWeights(plaintext, secrets.modelKey, {
          cipher: 'xchacha20poly1305-64k-v1',
          noncePrefix: secrets.noncePrefix,
          plaintextBytes: plaintext.length,
          chunkBytes: 65536,
        })
        derived = true
      } else {
        derivedWeightsPlan.current = null
        out = sealWeights(plaintext)
      }
      const next: SealState = {
        step: 'encrypt', fileName: p.file.name, name: p.name, manifest: p.manifest, price: p.price, operatorShareBps: p.operatorShareBps,
        allowedMeasurements: p.allowedMeasurements, plaintextBytes: out.header.plaintextBytes, sizeBytes: out.ciphertext.length, sha256: toHex(out.merkleRoot),
        hashVersion: 1, sealedChunks: 0, base: p.base, derived,
        uploadKey: derivedUploadKeys?.[0],
        uploadSecret: derivedUploadKeys?.[0] ? derivedUploadSecrets?.[derivedUploadKeys[0]] : undefined,
        uploadKeys: derivedUploadKeys,
        uploadSecrets: derivedUploadSecrets,
        owner: derived && address ? address : undefined,
        cipher: { id: out.header.cipher, chunkSizeBytes: out.header.chunkBytes, noncePrefix: toBase64(out.header.noncePrefix) },
      }
      cipher.current = out.ciphertext
      key.current = out.key
      flags.current = new Uint8Array(chunkCount(next.sizeBytes))
      if (vault.unlocked) saveModelKey(next.name, out.key)
      await putCiphertext(next.sha256!, out.ciphertext)
      persist(next)
      play('encrypt')
      reveal()
    } catch (e) { setError(errorMessage(e)); play('failed') }
    setBusy(null)
  }
  const takeKeyFile = () => {
    if (!st || !key.current) return
    const url = URL.createObjectURL(new Blob([keyFileBody(st.model ?? st.name, st.name, key.current)], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url; a.download = keyFileName(st.name); a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    setKeyFileTaken(true)
  }

  // ---------- Write ----------
  const write = async (from: SealState) => {
    if (!cipher.current || !from.model || !from.uploadKey) return
    setError(null); setBusy('writing')
    const mine = (stop.current = { now: false })
    const writeSize = from.writeChunkBytes ?? WRITE_BYTES
    if (flags.current.length !== chunkCount(from.sizeBytes, writeSize)) {
      flags.current = new Uint8Array(chunkCount(from.sizeBytes, writeSize))
    }
    let batchTx = 0
    let batchFees = 0n
    try {
      await writeChunks({
        client, model: from.model, ciphertext: cipher.current, flags: flags.current, uploadKey: from.uploadKey, uploadSecret: from.uploadSecret, uploadKeys: from.uploadKeys, uploadSecrets: from.uploadSecrets, chunkBytes: writeSize, stop: mine,
        onChunk: (delta) => {
          batchTx += delta.transactionsSent
          batchFees += delta.feesLamports
          const now = performance.now()
          if (now - lastChunkSound.current >= 170) { lastChunkSound.current = now; play('chunk') }
          bump()
        },
      })
      if (mine.now) return
      const metrics = addSealMetrics(from.metrics, { bytesWritten: from.sizeBytes, transactionsSent: batchTx, feesLamports: batchFees })
      persist({ ...from, step: 'seal', metrics }); setStep('seal')
    } catch (e) {
      if (mine.now) return
      if (batchTx > 0) {
        const doneBytes = progressOf(from.sizeBytes, flags.current, writeSize).bytes
        persist({ ...from, metrics: addSealMetrics(from.metrics, { bytesWritten: doneBytes, transactionsSent: batchTx, feesLamports: batchFees }) })
      }
      setError(errorMessage(e)); play('failed')
    }
    setBusy(null)
  }
  // The chain says what is written; the flow picks up at the first range it does not hold.
  const syncFromChain = async (from: SealState): Promise<SealState | null> => {
    const m = await read(client.model(from.model!))
    if (!m.ok) { setError(m.code === 'MODEL_NOT_FOUND' ? `${from.name} is not on chain here. Start over to seal it again.` : m.message); return null }
    const writeSize = from.writeChunkBytes ?? WRITE_BYTES
    flags.current = chunkFlags(from.sizeBytes, m.data.upload?.writtenRanges ?? [], writeSize)
    const whole = progressOf(from.sizeBytes, flags.current, writeSize).firstUnwritten === null
    const at: SealStepId = m.data.status === 'live' ? 'done' : m.data.status === 'sealed' ? 'grant' : whole ? 'seal' : 'write'
    const nextKeys = from.uploadKeys?.length ? from.uploadKeys : m.data.upload?.uploadKeys?.length ? m.data.upload.uploadKeys : m.data.upload?.uploadKey ? [m.data.upload.uploadKey] : undefined
    const next = { ...from, step: at, uploadKey: from.uploadKey ?? m.data.upload?.uploadKey, uploadKeys: nextKeys, owner: from.owner ?? m.data.owner, base: from.base ?? m.data.base ?? null }
    persist(next); setStep(at); setChain(m.data.status)
    return next
  }
  const resume = async () => {
    if (!st || busy) return
    setError(null)
    key.current ??= loadModelKey(st.model ?? st.name) ?? loadModelKey(st.name)
    cipher.current ??= await getCiphertext(st.sha256)
    // The upload key secrets come back from the vault this browser holds, now that the password is in.
    const knownKeys = st.uploadKeys?.length ? st.uploadKeys : st.uploadKey ? [st.uploadKey] : []
    const restoredSecrets = knownKeys.length ? { ...loadUploadSecrets(knownKeys), ...st.uploadSecrets } : undefined
    const primarySecret = st.uploadSecret ?? (st.uploadKey ? restoredSecrets?.[st.uploadKey] ?? loadUploadSecret(st.uploadKey) ?? undefined : undefined)
    let next: SealState | null = primarySecret !== st.uploadSecret || (restoredSecrets && Object.keys(restoredSecrets).length > 0 && !st.uploadSecrets)
      ? { ...st, uploadSecret: primarySecret, uploadSecrets: restoredSecrets }
      : st
    if (next !== st) setSt(next)
    if (st.model) {
      setBusy('reading')
      next = await syncFromChain(next)
      if (next && !cipher.current && !sample.current) {
        const bytes = await read(client.weights(st.model, { offset: 0, length: CELLS }))
        if (bytes.ok) sample.current = b64ToBytes(bytes.data.bytesBase64)
      }
      setBusy(null)
      if (!next) return
    }
    setRevealed(CELLS); setPaused(false); setWantWeights(true)
    if (next.step === 'write' && cipher.current) void write(next)
  }
  const retry = async () => {
    if (!st || busy) return
    setError(null)
    if (!cipher.current) { setWantWeights(true); return }
    setBusy('reading')
    const next = await syncFromChain(st)
    setBusy(null)
    if (next?.step === 'write') void write(next)
  }
  const restoreWeights = async (file: File) => {
    if (!st || !key.current) return
    setBusy('encrypting'); setError(null)
    await new Promise((r) => setTimeout(r, 60))
    try {
      const out = reseal(new Uint8Array(await file.arrayBuffer()), key.current, st.cipher, st.hashVersion ?? 1)
      if (out.ciphertext.length !== st.sizeBytes || (st.sha256 && out.sha256 !== st.sha256)) {
        setError(`${file.name} does not give this model's ciphertext. Choose ${st.fileName ?? 'the weights file it was sealed from'}.`)
        setBusy(null)
        return
      }
      cipher.current = out.ciphertext
      const next = { ...st, sha256: out.sha256 }
      persist(next)
      if (kept) await putCiphertext(out.sha256, out.ciphertext)
      setBusy(null)
      if (step === 'write') { const synced = await syncFromChain(next); if (synced?.step === 'write') void write(synced) }
    } catch (e) { setError(errorMessage(e)); setBusy(null) }
  }
  const restoreKey = async (file: File) => {
    if (!st) return
    const parsed = parseKeyFile(await file.text())
    if (!parsed || (parsed.model !== st.model && parsed.model !== st.name)) { setError(`${file.name} is not the key file of ${st.name}.`); return }
    if ('key' in parsed) holdKey(parsed.key)
    else { setKeyFile({ name: file.name, sealed: parsed.sealed }); setError(null) }
  }
  const holdKey = (k: Uint8Array) => {
    key.current = k
    if (st && kept && vault.unlocked) saveModelKey(st.model ?? st.name, k)
    setKeyFile(null); setError(null); bump()
  }
  const openChosenKeyFile = async (password: string) => {
    const k = keyFile ? await openKeyFile(keyFile.sealed, password) : null
    if (k) holdKey(k)
    return !!k
  }
  // Setting the password the first time, or entering it after a reload: the same call either way.
  const enter = (then: () => void) => async (password: string) => {
    const ok = await (vault.exists ? unlockVault(password) : setVaultPassword(password))
    if (ok) then()
    return ok
  }

  const deriveFromWallet = async (target?: SealState) => {
    const base = target ?? st
    if (!base?.model || !address || !w.canSignMessage || busy) return
    setError(null); setBusy('signing')
    try {
      const cfg = config ?? (await client.config())
      if (!cfg.programId || cfg.fixture) throw new Error('Wallet key derivation is only available on a live cluster.')
      const secrets = await deriveWalletSealSecrets({
        programId: cfg.programId,
        modelAddress: base.model,
        weightsKeyCount: weightsCount(base.sizeBytes),
      })
      const expectedPrefix = toBase64(secrets.noncePrefix)
      const matchedUpload = base.uploadKey ? secrets.uploadKeys.some((k) => k.address === base.uploadKey) : false
      if (base.cipher.noncePrefix !== expectedPrefix && !matchedUpload) {
        throw new Error('This model was sealed with random browser keys. Choose its key file to continue.')
      }
      key.current = secrets.modelKey
      derivedWeightsPlan.current = secrets.weightsPlan
      const uploadKeys = base.uploadKeys?.length ? base.uploadKeys : secrets.uploadKeys.map((k) => k.address)
      const uploadSecrets = Object.fromEntries(secrets.uploadKeys.map((k) => [k.address, k.secret]))
      if (vault.unlocked) {
        saveModelKey(base.model, secrets.modelKey)
        saveUploadSecrets(uploadSecrets)
      }
      const primaryKey = base.uploadKey ?? uploadKeys[0]
      const next: SealState = {
        ...base,
        derived: true,
        uploadKey: primaryKey,
        uploadSecret: primaryKey ? uploadSecrets[primaryKey] : undefined,
        uploadKeys,
        uploadSecrets,
      }
      persist(next)
      setKeyFile(null)
      bump()
    } catch (e) { setError(errorMessage(e)); play('failed') }
    setBusy(null)
  }

  const resumeFromChain = async (rawId: string) => {
    const id = rawId.trim()
    if (!id || busy) return
    setError(null); setBusy('reading')
    try {
      const m = await read(client.model(id))
      if (!m.ok) {
        setError(m.code === 'MODEL_NOT_FOUND' ? `No model named "${id}" was found on chain.` : m.message)
        setBusy(null)
        return
      }
      const writeSize = WRITE_BYTES
      flags.current = chunkFlags(m.data.sizeBytes, m.data.upload?.writtenRanges ?? [], writeSize)
      const whole = progressOf(m.data.sizeBytes, flags.current, writeSize).firstUnwritten === null
      const at: SealStepId = m.data.status === 'live' ? 'done' : m.data.status === 'sealed' ? 'grant' : whole ? 'seal' : 'write'
      let next = stateFromModel(m.data, at)
      const bytes = await read(client.weights(m.data.address, { offset: 0, length: CELLS }))
      if (bytes.ok) sample.current = b64ToBytes(bytes.data.bytesBase64)
      setRevealed(CELLS); setPaused(false); setWantWeights(true); setChain(m.data.status)
      persist(next); setStep(at)
      setBusy(null)
      if (at !== 'done' && address && address === m.data.owner && w.canSignMessage) {
        await deriveFromWallet(next)
      }
    } catch (e) { setError(errorMessage(e)); setBusy(null) }
  }

  const copyCli = (cmd: string) => {
    void navigator.clipboard?.writeText(cmd)
    play('copy')
    setCliCopied(true)
    setTimeout(() => setCliCopied(false), 1200)
  }

  const uploadCosigner = (build: Build, uploadKey: string | undefined, uploadSecret: string | undefined, missingMessage: string) => {
    if (build.fixture || !uploadKey || !build.requiredSigners.includes(uploadKey)) return undefined
    const secret = uploadSecret ?? loadUploadSecret(uploadKey)
    if (!secret) throw new Error(missingMessage)
    return (signedTxBase64: string) => signWithUploadKey(signedTxBase64, secret)
  }

  // ---------- Create, Seal, Grant: one signature each ----------
  const create = async () => {
    if (!st || !address || busy) return
    setError(null); setBusy('building')
    try {
      let next: SealState = { ...st, metrics: addSealMetrics(st.metrics, { startedAtMs: Date.now() }) }
      let pool: { address: string; secret: string }[]
      if (next.uploadKeys?.length && next.uploadSecrets && next.uploadKeys.every((k) => !!next.uploadSecrets![k])) {
        pool = next.uploadKeys.map((addr) => ({ address: addr, secret: next.uploadSecrets![addr]! }))
      } else if (next.uploadKey && next.uploadSecret) {
        pool = [{ address: next.uploadKey, secret: next.uploadSecret }]
      } else {
        pool = newUploadKeys(DEFAULT_UPLOAD_KEYS)
      }
      const cfg = config ?? (await client.config())
      // Quote the create transaction for these exact accounts first: rent is spent only when it will build.
      // Step upload keys down automatically if a large manifest exceeds the wallet transaction size ceiling.
      const plan = cfg.programId ? await planWeights(next.sizeBytes, next.weights, derivedWeightsPlan.current) : null
      const initialWeights = plan ? plan.addresses.slice(0, INITIAL_CREATE_WEIGHTS) : undefined
      let chosenPool = pool
      const baseOpt = next.base ? { base: next.base } : {}
      let quote = await client.quoteModel({
        sizeBytes: next.sizeBytes,
        uploadKeyCount: chosenPool.length,
        ...(initialWeights ? { create: {
          wallet: address, uploadKey: chosenPool[0]!.address, uploadKeys: chosenPool.map((k) => k.address), weights: initialWeights, name: next.name, manifest: next.manifest, plaintextSizeBytes: next.plaintextBytes,
          cipher: next.cipher, price: next.price, operatorShareBps: next.operatorShareBps, allowedMeasurements: next.allowedMeasurements, ...baseOpt,
        } } : {}),
      })
      while (initialWeights && quote.canCreate !== true && chosenPool.length > 1) {
        chosenPool = chosenPool.slice(0, chosenPool.length - 1)
        quote = await client.quoteModel({
          sizeBytes: next.sizeBytes,
          uploadKeyCount: chosenPool.length,
          create: {
            wallet: address, uploadKey: chosenPool[0]!.address, uploadKeys: chosenPool.map((k) => k.address), weights: initialWeights, name: next.name, manifest: next.manifest, plaintextSizeBytes: next.plaintextBytes,
            cipher: next.cipher, price: next.price, operatorShareBps: next.operatorShareBps, allowedMeasurements: next.allowedMeasurements, ...baseOpt,
          },
        })
      }
      if (plan && quote.canCreate !== true) {
        throw new TxError(`This model's facts make a create transaction of ${quote.createTransactionBytes ?? 'more than'} bytes; the limit is ${quote.createTransactionMaxBytes}.`, 'build', false, 'Shorten the manifest labels or allow fewer measurements, then create again. Nothing was spent.')
      }
      const uploadKeys = chosenPool.map((k) => k.address)
      const uploadSecrets = Object.fromEntries(chosenPool.map((k) => [k.address, k.secret]))
      if (vault.unlocked) saveUploadSecrets(uploadSecrets)
      next = {
        ...next,
        step: 'create',
        uploadKey: chosenPool[0]!.address,
        uploadSecret: chosenPool[0]!.secret,
        uploadKeys,
        uploadSecrets,
        owner: address,
        uploadFunding: quote.uploadFundingLamports,
        writeChunkBytes: quote.writeChunkBytes,
      }
      persist(next)
      flags.current = new Uint8Array(chunkCount(next.sizeBytes, quote.writeChunkBytes))
      if (!quote.fixture && cfg.programId) {
        setAllocating(true)
        let held = next
        const allocated = await allocateWeights({
          rpcUrl: cfg.rpcUrl, programId: cfg.programId, owner: address, sizeBytes: next.sizeBytes, known: next.weights, plan: plan ?? undefined, onStage: setBusy,
          onAllocated: (done, feeLamports) => {
            held = { ...held, weights: done, metrics: addSealMetrics(held.metrics, { transactionsSent: 1, feesLamports: feeLamports }) }
            persist(held)
          },
        })
        next = { ...held, weights: allocated.addresses }
        persist(next)
        setAllocating(false); setBusy('building')
      }
      const createWeights = next.weights?.slice(0, INITIAL_CREATE_WEIGHTS)
      const extraWeights = next.weights?.slice(INITIAL_CREATE_WEIGHTS) ?? []
      const build = await client.createModel({
        wallet: address, uploadKey: next.uploadKey!, uploadKeys: next.uploadKeys, weights: createWeights, name: next.name, manifest: next.manifest, sizeBytes: next.sizeBytes, plaintextSizeBytes: next.plaintextBytes,
        cipher: next.cipher, price: next.price, operatorShareBps: next.operatorShareBps, allowedMeasurements: next.allowedMeasurements,
        uploadFundingLamports: quote.uploadFundingLamports, ...baseOpt,
      })
      const createFee = await buildFeeLamports(build)
      // The wallet signs first; the upload key co-signs what the wallet returned afterward.
      const cosign = uploadCosigner(build, next.uploadKey, next.uploadSecret, 'The upload key is not on this device. Create the model from this browser again.')
      await send(client, build, setBusy, cosign)
      const model = build.addresses.model!
      if (key.current && vault.unlocked) saveModelKey(model, key.current)
      next = { ...next, model, owner: address, step: 'write', metrics: addSealMetrics(next.metrics, { transactionsSent: 1, feesLamports: createFee }) }
      persist(next); setStep('write'); setChain('uploading'); setBusy('reading')
      // The writes are built from the weights accounts the API has read: wait for it to hold them.
      await indexed(() => client.model(model), 'MODEL_NOT_FOUND', (m) => m.weights.length > 0)
      if (extraWeights.length > 0) {
        setBusy('building')
        const attached = await attachWeights({
          client,
          model,
          extraWeights,
          uploadKey: next.uploadKey!,
          uploadSecret: next.uploadSecret,
        })
        next = { ...next, metrics: addSealMetrics(next.metrics, attached) }
        persist(next)
        setBusy('reading')
        await indexed(() => client.model(model), 'MODEL_NOT_FOUND', (m) => m.weights.length >= (next.weights?.length ?? 0))
      }
      setBusy(null)
      void write(next)
    } catch (e) { setAllocating(false); setBusy(null); setError(errorMessage(e)); play('failed') }
  }
  const seal = async () => {
    if (!st?.model || !st.sha256 || !address || busy) return
    setError(null); setBusy('building'); setRangeProgress(null)
    try {
      let currentMetrics = st.metrics
      const hashVersion = st.hashVersion ?? 1
      if (hashVersion === 1 && st.uploadKey) {
        const latestModel = await read(client.model(st.model))
        const alreadySealed = latestModel.ok ? latestModel.data.sealedChunks : st.sealedChunks ?? 0
        const primarySecret = st.uploadSecret ?? loadUploadSecret(st.uploadKey) ?? undefined
        const ranged = await sealRanges({
          client,
          model: st.model,
          sizeBytes: st.sizeBytes,
          sealedChunks: alreadySealed,
          uploadKey: st.uploadKey,
          uploadSecret: primarySecret,
          onRange: (done, total) => setRangeProgress({ done, total }),
        })
        if (ranged.transactionsSent > 0) {
          currentMetrics = addSealMetrics(currentMetrics, { transactionsSent: ranged.transactionsSent, feesLamports: ranged.feesLamports })
          persist({ ...st, sealedChunks: ranged.sealedChunks, metrics: currentMetrics })
        }
        setRangeProgress(null)
      }
      const extraAddresses = (st.uploadKeys ?? []).slice(1)
      if (extraAddresses.length > 0) {
        const cfg = config ?? (await client.config())
        const extraSecrets = { ...loadUploadSecrets(extraAddresses), ...st.uploadSecrets }
        const extraKeys = extraAddresses.flatMap((addr) => (extraSecrets[addr] ? [{ address: addr, secret: extraSecrets[addr]! }] : []))
        if (extraKeys.length > 0) {
          const swept = await sweepExtraUploadKeys({ rpcUrl: cfg.rpcUrl, owner: address, extraKeys, fixture: cfg.fixture })
          if (swept.transactionsSent > 0) {
            currentMetrics = addSealMetrics(currentMetrics, { transactionsSent: swept.transactionsSent, feesLamports: swept.feesLamports })
          }
        }
      }
      const build = await client.sealModel(st.model, { wallet: address, ciphertextSha256: st.sha256 })
      const sealFee = await buildFeeLamports(build)
      // Sealing closes the primary upload key and returns what it still holds to the owner, so it co-signs after the wallet.
      const cosign = uploadCosigner(build, st.uploadKey, st.uploadSecret, 'The upload key is not on this device. Seal from the browser that wrote the ciphertext.')
      await send(client, build, setBusy, cosign)
      play('sealed')
      const metrics = addSealMetrics(currentMetrics, { bytesWritten: st.sizeBytes, transactionsSent: 1, feesLamports: sealFee })
      persist({ ...st, step: 'grant', sealedChunks: sealChunkCount(st.sizeBytes), metrics }); setStep('grant'); setChain('sealed')
    } catch (e) { setRangeProgress(null); setError(errorMessage(e)); play('failed') }
    setBusy(null)
  }
  const eligible = (enclaves ?? []).filter((e) => st?.allowedMeasurements.includes(e.measurement))
  const chosen = eligible.find((e) => e.address === choice && e.status === 'live') ?? eligible.find((e) => e.status === 'live') ?? null
  const grant = async () => {
    if (!st?.model || !key.current || !chosen || !address || busy) return
    setError(null); setBusy('building')
    try {
      const wrappedKey = toBase64(wrapKey(key.current, fromBase64(chosen.encryptionKey)))
      const grantBuild = await client.grantByOwner(st.model, { wallet: address, enclave: chosen.address, wrappedKey })
      const grantFee = await buildFeeLamports(grantBuild)
      await send(client, grantBuild, setBusy)
      // The model's page reads the API: it is shown once the API has seen the grant.
      const model = st.model
      await indexed(() => client.model(model), 'MODEL_NOT_FOUND', (m) => m.status === 'live').catch(() => null)
      play('grant')
      const metrics = addSealMetrics(st.metrics, { bytesWritten: st.sizeBytes, transactionsSent: 1, feesLamports: grantFee, finishedAtMs: Date.now() })
      setSt({ ...st, step: 'done', metrics }); setStep('done'); setChain('live')
      if (kept) clearSeal()
    } catch (e) { setError(errorMessage(e)); play('failed') }
    setBusy(null)
  }

  // ---------- what the right region shows ----------
  const price: Money | null = st?.price ?? draftPrice(draft)
  const shareBps = st?.operatorShareBps ?? draft.sharePct * 100
  const protocolBps = config?.protocolShareBps ?? null
  const name = st?.name ?? draft.name.trim()
  const measurements = st?.allowedMeasurements ?? draft.measurements
  const plaintextBytes = st?.plaintextBytes ?? draft.file?.size ?? null
  const size = st?.sizeBytes ?? 0
  const chunkBytes = st?.writeChunkBytes ?? quoted?.writeChunkBytes ?? WRITE_BYTES
  const uploadKeyCount = st?.uploadKeys?.length ?? quoted?.uploadKeyCount ?? DEFAULT_UPLOAD_KEYS
  const progress = progressOf(size, flags.current, chunkBytes)
  const writes = chunkCount(size, chunkBytes)
  // The wallet signs once for each weights account, then to create, to seal and to grant.
  const accounts = weightsCount(size)
  const signatures = accounts + 3
  // The API's read can trail a confirmation by a moment: the summary never shows a state the steps have already passed.
  const reached: Model['status'] = step === 'done' ? 'live' : step === 'grant' ? 'sealed' : 'uploading'
  const rank = { uploading: 0, sealed: 1, live: 2, retired: 3 } as const
  const status: Model['status'] | null = !st?.model ? null : chain && rank[chain] >= rank[reached] ? chain : reached
  const written = status === 'uploading' && size > 0 && progress.firstUnwritten === null
  const stepIndex = step === 'done' ? SEAL_STEPS.length : STEP_IDS.indexOf(step)
  const says = SEAL_STEPS[Math.min(stepIndex, SEAL_STEPS.length - 1)]!
  const wrongWallet = !!address && !!st?.owner && st.owner !== address && (step === 'seal' || step === 'grant')
  const needWeights = !!st && !paused && ((step === 'write' && wantWeights && !cipher.current) || (step === 'seal' && !st.sha256))
  const needKey = !!st && !paused && !key.current && (step === 'grant' || needWeights)
  const bytes = cipher.current ?? sample.current
  const cellOffset = (i: number) => Math.floor((i * size) / CELLS)
  const shares: Pick<SplitPart, 'id' | 'label' | 'share'>[] = [
    { id: 'owner', label: 'Owner', share: (10000 - shareBps - (protocolBps ?? 0)) / 10000 },
    { id: 'operator', label: 'Operator', share: shareBps / 10000 },
    ...(protocolBps !== null ? [{ id: 'protocol' as const, label: 'Protocol', share: protocolBps / 10000 }] : []),
  ]
  const split: SplitPart[] = shares.map((p) => ({ ...p, value: bps(Math.round(p.share * 10000)), note: price ? <Amount value={{ ...price, amount: ((BigInt(price.amount) * BigInt(Math.round(p.share * 10000))) / 10000n).toString() }} /> : undefined }))

  if (!ready) return <div className="container page"><Head /><Loading rows={6} /></div>

  // What this device has to be given before the step can go on: the key file, then the weights file.
  const needs: Need[] = !st || !(needKey || needWeights) ? [] : [
    { id: 'key', label: 'Key file', file: keyFile?.name ?? keyFileName(st.name), held: !!key.current },
    ...(step === 'grant' ? [] : [{ id: 'weights' as const, label: 'Weights file', file: st.fileName ?? 'The file it was sealed from', held: false }]),
  ]
  const need = needs.find((n) => !n.held) ?? null
  const canDeriveNow = !!st?.model && !!address && address === st.owner && w.canSignMessage && !config?.fixture
  const needBody = need ? (
    <div className={s.need}>
      <h3 className="t-h3">{need.id === 'key' ? 'This device does not hold the model key' : 'This device does not hold the ciphertext'}</h3>
      <p className="t-small">
        {need.id === 'key'
          ? (canDeriveNow
            ? 'Sign once with the owner wallet to re-derive the model and upload keys directly, or import the key file for an earlier browser-only seal.'
            : 'The model key is kept where the weights were encrypted. Connect the owner wallet to re-derive it, or choose its key file.')
          : 'Choose the same weights file. It is encrypted again with the model key and checked against this model before anything is sent.'}
      </p>
      <Needs items={needs} />
      {need.id === 'key' && keyFile ? <PasswordForm key={keyFile.name} id={pwId} mode="file" run={openChosenKeyFile} onBusy={setPwBusy} /> : null}
    </div>
  ) : null

  const cliCmd = st?.name ? resumeCliCommand(st.fileName, st.name, st.base) : null
  const cliResumeBox = cliCmd && (step === 'create' || step === 'write' || step === 'seal' || step === 'grant') ? (
    <div className={s.resumeCli}>
      <div className={s.resumeCliHead}>
        <span className="t-label">Resume from any terminal</span>
        <button type="button" className="btn" data-size="s" onClick={() => copyCli(cliCmd)}>{cliCopied ? 'Copied' : 'Copy command'}</button>
      </div>
      <code className={`mono ${s.resumeCliCode}`}>{cliCmd}</code>
      <p className="t-small dim">
        {st?.base
          ? 'No state file needed when sealed with a wallet signature. Once created on chain, voynich seal --resume also inherits the base model automatically.'
          : 'No state file needed when sealed with a wallet signature. Run with your owner keypair and weights file to finish on any machine.'}
      </p>
    </div>
  ) : null

  // ---------- the left region: the current step's work ----------
  let workBody: React.ReactNode
  let action: React.ReactNode
  let cost: React.ReactNode = <p className="t-small">Nothing leaves this device in this step.</p>
  const connect = (why: string) => <><p className="t-small">{why}</p><WalletButton kind="primary" /></>
  const owner = wrongWallet ? <p className="t-small">Connect the owner wallet <span className="mono">{short(st!.owner!, 4)}</span> to sign this.</p> : null
  const pendingLabel = busy === 'signing' ? 'Awaiting signature' : busy === 'confirming' ? 'Confirming' : 'Building'
  const signing = txStage(busy) !== null
  // What is being waited for, said once beside the step's lead.
  const waits = busy === 'signing' ? "Waiting for your wallet's signature."
    : busy === 'confirming' ? 'Signed. Waiting for the chain to confirm.'
    : rangeProgress ? `Sealing ranges on chain (${group(rangeProgress.done)} of ${group(rangeProgress.total)} chunks). No wallet prompt.`
    : busy === 'building' ? 'Building the transaction.'
    : busy === 'writing' ? (uploadKeyCount > 1 ? `Writing ${group(chunkBytes)} bytes a transaction across ${uploadKeyCount} upload keys. No wallet prompt.` : `The upload key is writing ${group(chunkBytes)} bytes a transaction. No wallet prompt.`)
    : busy === 'encrypting' ? 'Encrypting the weights on this device.'
    : busy === 'reading' ? 'Reading from chain.'
    : null

  // The password's submit buttons carry a key: reusing the element of the button they replace would let the press that brought them submit the form.
  const locked = kept && !vault.unlocked
  const pwLabel = vault.exists ? (pwBusy ? 'Unlocking' : 'Unlock') : pwBusy ? 'Setting password' : null
  if (paused && st) {
    workBody = (
      <>
        <div className={s.resume}>
          <h2 className="t-h2">Continue sealing <span className="mono">{st.name}</span></h2>
          <p className="t-body">This seal stopped at {says.label}. {st.model ? 'What is written is read from chain and the rest goes on from there.' : 'The encrypted weights are kept on this device.'}</p>
        </div>
        {locked ? <PasswordForm id={pwId} mode={vault.exists ? 'unlock' : 'set'} run={enter(() => void resume())} onBusy={setPwBusy} /> : null}
      </>
    )
    action = <>
      {locked
        ? <button key="password" type="submit" form={pwId} className="btn" data-kind="primary" data-pending={pwBusy || undefined} disabled={pwBusy}>{pwBusy ? <StateTile state="pending" size={14} /> : null}{pwLabel ?? 'Set password'}</button>
        : <button type="button" className="btn" data-kind="primary" onClick={() => void resume()} data-pending={busy === 'reading' || undefined} disabled={!!busy}>{busy === 'reading' ? <><StateTile state="pending" size={14} />Reading from chain</> : 'Continue'}</button>}
      <button type="button" className="btn" onClick={reset} disabled={!!busy}>Start over</button>
    </>
    cost = <p className="t-small">Nothing is sent until you continue.</p>
  } else if (step === 'prepare') {
    workBody = (
      <>
        <div className={s.resumeBar}>
          <label htmlFor={resumeId} className="t-label">Resume an interrupted model from chain</label>
          <div className={s.resumeRow}>
            <input
              id={resumeId}
              className="input mono"
              value={resumeInput}
              onChange={(e) => setResumeInput(e.target.value)}
              placeholder="Model name or address"
              spellCheck={false}
              autoComplete="off"
            />
            <button
              type="button"
              className="btn"
              data-size="s"
              disabled={!resumeInput.trim() || !!busy}
              data-pending={busy === 'reading' || undefined}
              onClick={() => void resumeFromChain(resumeInput)}
            >
              {busy === 'reading' ? <><StateTile state="pending" size={14} />Reading</> : 'Resume from chain'}
            </button>
          </div>
          <p className="t-small dim">No state file required. Connect the owner wallet to re-derive keys and continue where chain writes stopped.</p>
        </div>
        <PrepareForm draft={draft} set={(patch) => { setDraft((d) => ({ ...d, ...patch })); setErrors({}) }} errors={errors} enclaves={enclaves} publishedMeasurements={publishedMeasurements} maxSharePct={maxSharePct} />
      </>
    )
    action = <button type="button" className="btn" data-kind="primary" onClick={toEncrypt}>Continue</button>
  } else if (step === 'encrypt') {
    const doneEncrypt = !!st?.sha256 && busy !== 'encrypting'
    workBody = doneEncrypt && st ? (
      <>
        <div className={s.figs}>
          <Stat label="Weights"><Size n={st.plaintextBytes} size="m" /></Stat>
          <Stat label="Ciphertext"><Size n={st.sizeBytes} size="m" /></Stat>
        </div>
        <div className={s.block}>
          <div className="t-label">{st.hashVersion === 0 ? 'SHA-256 of the ciphertext' : 'Ciphertext Merkle root (64 KiB chunks)'}</div>
          <HalfHash value={st.sha256!} label="ciphertext hash" />
        </div>
        <div className={s.keyfile}>
          <div>
            <h3 className="t-h3">{st.derived ? 'Derived from your wallet signature' : 'Keep the key file'}</h3>
            <p className="t-small">
              {st.derived
                ? 'This seal can be resumed from any browser or terminal with only your owner wallet and weights file. You can also download a backup key file.'
                : <>The model key is saved in this browser, encrypted under your password. The file <span className="mono">{keyFileName(st.name)}</span> lets you grant from another device and opens with the same password.</>}
            </p>
          </div>
          <button type="button" className="btn" onClick={takeKeyFile} disabled={!key.current || !vault.unlocked}>{keyFileTaken ? 'Download again' : 'Download key file'}</button>
        </div>
      </>
    ) : (
      <>
        <div className={s.block}>
          <p className="t-body">
            {address && w.canSignMessage && !config?.fixture
              ? <>Sign once with your wallet to deterministically derive the 256-bit model key and upload keys, then encrypt {prepared.current ? <span className="mono">{prepared.current.file.name}</span> : 'the weights file'} with XChaCha20-Poly1305. You can resume from any device with zero state file.</>
              : <>A 256-bit model key is drawn on this device and {prepared.current ? <span className="mono">{prepared.current.file.name}</span> : 'the weights file'} is encrypted with XChaCha20-Poly1305. Connect a wallet first to derive resumable keys from a wallet signature.</>}
          </p>
        </div>
        {locked && prepared.current ? <PasswordForm id={pwId} mode={vault.exists ? 'unlock' : 'set'} run={enter(() => void encrypt())} onBusy={setPwBusy} /> : null}
      </>
    )
    action = doneEncrypt
      ? <button type="button" className="btn" data-kind="primary" onClick={() => { if (st) persist({ ...st, step: 'create' }); go('create') }}>Continue</button>
      : <>
        {locked && prepared.current
          ? <button key="password" type="submit" form={pwId} className="btn" data-kind="primary" data-pending={pwBusy || undefined} disabled={pwBusy}>{pwBusy ? <StateTile state="pending" size={14} /> : null}{pwLabel ?? 'Encrypt'}</button>
          : <button type="button" className="btn" data-kind="primary" onClick={() => void encrypt()} data-pending={busy === 'encrypting' || undefined} disabled={busy === 'encrypting' || !prepared.current}>{busy === 'encrypting' ? <><StateTile state="pending" size={14} />Encrypting</> : 'Encrypt'}</button>}
        {kept ? <button type="button" className="btn" onClick={() => go('prepare')} disabled={!!busy}>Back</button> : null}
      </>
  } else if (step === 'create') {
    workBody = (
      <>
        <Stages stage={txStage(busy)} failed={false} labels={[allocating ? (accounts > 1 ? 'Allocate the weights accounts' : 'Allocate the weights account') : 'Build create_model', 'Sign in the wallet', 'Confirm on chain']} />
        {st?.uploadKey ? (
          <div className={s.block}>
            <div className="t-label">Upload key</div>
            <HalfHash value={st.uploadKey} label="upload key" />
            <p className="t-small">Drawn on this device. It signs the writes so the wallet is not asked again until Seal.</p>
          </div>
        ) : <p className="t-body">{accounts > 1 ? `${accounts} signatures allocate the weights accounts` : 'One signature allocates the weights account'}. One more creates the model and funds a one-time upload key drawn on this device.</p>}
      </>
    )
    cost = <p className="t-small">{quoted ? <>Rent for the model and its weights, <Amount value={{ amount: quoted.rent, decimals: 9, symbol: 'SOL' }} />. </> : null}Funds {uploadKeyCount > 1 ? `${uploadKeyCount} upload keys` : 'the upload key'} with <Amount value={{ amount: st?.uploadFunding ?? quoted?.funding ?? uploadFunding(size, chunkBytes, uploadKeyCount).toString(), decimals: 9, symbol: 'SOL' }} /> for <span className="mono">{group(writes)}</span> writes. Wallet signatures 1 to {accounts + 1} of {signatures}.</p>
    action = !address && !signing ? connect('Connect a wallet to create the model.')
      : <button type="button" className="btn" data-kind="primary" onClick={() => void create()} data-pending={signing || undefined} disabled={signing}>{signing ? <><StateTile state="pending" size={14} />{pendingLabel}</> : 'Create model'}</button>
  } else if (step === 'write') {
    workBody = (
      <>
        <div className={s.figs}>
          <Stat label="Bytes written" note={<>of <Size n={size} /></>}><Size n={progress.bytes} size="l" /></Stat>
          <Stat label="Transactions" note={<>of <span className="mono">{group(writes)}</span></>}><span className="t-fig t-fig-l">{group(progress.transactions)}</span></Stat>
        </div>
        <div role="progressbar" aria-label="Ciphertext written" aria-valuemin={0} aria-valuemax={size} aria-valuenow={progress.bytes}>
          <TileStrip cells={48} height={20} parts={[{ share: size ? progress.bytes / size : 0, step: 11 }]} />
        </div>
        {needBody ?? (error && progress.firstUnwritten !== null ? (
          <div className={s.stopped} role="alert">
            <StateTile state="failed" />
            <div>
              <h3 className="t-h3">The upload stopped</h3>
              <p className="t-small">{error} <span className="mono">{group(progress.bytes)}</span> of <span className="mono">{group(size)}</span> bytes are on chain. Retry goes on from byte <span className="mono">{group(progress.firstUnwritten)}</span>.</p>
            </div>
          </div>
        ) : null)}
      </>
    )
    cost = <p className="t-small"><span className="mono">{group(writes)}</span> transactions, signed by the upload key. The wallet is not asked.</p>
    action = busy === 'writing' ? <button type="button" className="btn" data-kind="primary" data-pending="true" disabled><StateTile state="pending" size={14} />Writing</button>
      : <button type="button" className="btn" data-kind="primary" onClick={() => void retry()} data-pending={busy === 'reading' || undefined} disabled={!!busy}>{busy === 'reading' ? <><StateTile state="pending" size={14} />Reading from chain</> : 'Retry'}</button>
  } else if (step === 'seal') {
    workBody = needBody ?? (
      <>
        <Stages stage={txStage(busy)} labels={['Build seal_model', 'Sign in the wallet', 'Confirm on chain']} />
        {st?.sha256 ? (
          <div className={s.block}>
            <div className="t-label">{st.hashVersion === 0 ? 'The hash this fixes' : 'The 64 KiB chunk Merkle root this fixes'}</div>
            <HalfHash value={st.sha256} label="ciphertext hash" />
            <p className="t-small">All <span className="mono">{group(size)}</span> bytes are on chain. After this signature they cannot change.</p>
          </div>
        ) : null}
      </>
    )
    cost = <p className="t-small">Wallet signature {signatures - 1} of {signatures}. The upload key is closed and its remainder returns to the owner.</p>
    action = !address ? connect('Connect the owner wallet to seal.') : owner
      ?? <button type="button" className="btn" data-kind="primary" onClick={() => void seal()} data-pending={signing || undefined} disabled={signing}>{signing ? <><StateTile state="pending" size={14} />{pendingLabel}</> : 'Seal'}</button>
  } else if (step === 'grant') {
    workBody = needBody ?? (
      <>
        {enclaves === null ? <Loading rows={2} /> : eligible.length === 0 ? (
          <div className={s.block}>
            <p className="t-body">No registered enclave runs a measurement this model allows. The model is sealed; grant from its page when one registers.</p>
            <Link className="link" href={`/enclaves${q(fixture)}`} data-arrow>Enclaves</Link>
          </div>
        ) : (
          <ul className={s.enclaves} role="radiogroup" aria-label="Enclave to grant">
            {eligible.map((e) => (
              <li key={e.address}>
                <button type="button" role="radio" aria-checked={chosen?.address === e.address} disabled={e.status !== 'live' || signing} onClick={() => { play('toggle'); setChoice(e.address) }}>
                  <StateTile state={chosen?.address === e.address ? 'live' : 'waiting'} />
                  <span className="mono">{short(e.address, 6)}</span>
                  <span className="t-small dim">{hardware(e.hardwareType)}</span>
                  <span className="t-small dim">measurement <span className="mono">{short(e.measurement, 6)}</span></span>
                  <span className={s.enclaveState}>{e.status === 'live' ? <span className="t-small dim">expires at slot <span className="mono">{group(e.expiresAtSlot)}</span></span> : <State state="expired" />}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <Stages stage={txStage(busy)} labels={['Wrap the model key and build grant_by_owner', 'Sign in the wallet', 'Confirm on chain']} />
      </>
    )
    cost = <p className="t-small">Wallet signature {signatures} of {signatures}. Only the key wrapped to the enclave is sent.</p>
    action = !address ? connect('Connect the owner wallet to grant.') : owner
      ?? <button type="button" className="btn" data-kind="primary" onClick={() => void grant()} data-pending={signing || undefined} disabled={signing || !chosen}>{signing ? <><StateTile state="pending" size={14} />{pendingLabel}</> : 'Grant'}</button>
    if (address && !owner && !chosen && enclaves && eligible.length > 0) action = <><p className="t-small">Every enclave with an allowed measurement has expired.</p>{action}</>
  } else {
    const summary = st ? sealSummary(st) : null
    workBody = st && summary ? (
      <Frame className={s.done}>
        <State state="live" />
        <h2 className="t-h2"><span className="mono">{st.name}</span> is sealed and granted</h2>
        <p className="t-body">Its ciphertext is on chain and an enclave holds its key. It answers calls from now.</p>
        {st.model ? <HalfHash value={st.model} label="model address" /> : null}
        <div className={s.doneMetrics}>
          <Stat label="Bytes written"><Size n={summary.bytesWritten} size="m" /></Stat>
          <Stat label="Transactions sent"><span className="t-fig t-fig-m">{group(summary.transactionsSent)}</span></Stat>
          <Stat label="Elapsed">
            {summary.elapsedSeconds !== null ? (
              <span className="t-fig t-fig-m">{summary.elapsedSeconds.toFixed(1)}<span className="unit">s</span></span>
            ) : (
              <span className="t-small dim">Not timed</span>
            )}
          </Stat>
          <Stat label="Fees paid"><Amount value={{ amount: summary.feesLamports, decimals: 9, symbol: 'SOL' }} size="m" /></Stat>
        </div>
      </Frame>
    ) : null
    cost = null
    action = st ? <>
      <Link href={`/models/${st.name}${q(fixture)}`} className="btn" data-kind="primary">Open {st.name}</Link>
      {kept ? <button type="button" className="btn" onClick={reset}>Seal another model</button> : null}
    </> : null
  }

  // A missing file is the step's one act: the button that picks it takes the action's place.
  if (need && !paused) {
    cost = <p className="t-small">{need.id === 'key' && canDeriveNow ? 'One wallet message signature re-derives the model and upload keys. Nothing is sent on chain.' : 'The file is read on this device. Nothing is sent by choosing it.'}</p>
    action = need.id === 'key' && keyFile ? <>
      <button key="password" type="submit" form={pwId} className="btn" data-kind="primary" data-pending={pwBusy || undefined} disabled={pwBusy}>{pwBusy ? <><StateTile state="pending" size={14} />Opening</> : 'Open key file'}</button>
      <button type="button" className="btn" onClick={() => pick.current?.click()} disabled={pwBusy}>Choose another file</button>
    </> : need.id === 'key' && canDeriveNow ? <>
      <button type="button" className="btn" data-kind="primary" onClick={() => void deriveFromWallet()} data-pending={busy === 'signing' || undefined} disabled={!!busy}>
        {busy === 'signing' ? <><StateTile state="pending" size={14} />Awaiting signature</> : 'Derive keys with wallet'}
      </button>
      <button type="button" className="btn" onClick={() => pick.current?.click()} disabled={!!busy}>Choose key file</button>
    </> : (
      <button type="button" className="btn" data-kind="primary" onClick={() => pick.current?.click()} data-pending={busy === 'encrypting' || undefined} disabled={!!busy}>
        {busy === 'encrypting' ? <><StateTile state="pending" size={14} />Encrypting</> : need.id === 'key' ? 'Choose key file' : 'Choose weights file'}
      </button>
    )
  }

  const showError = error && !(step === 'write' && progress.firstUnwritten !== null && !paused && !need)
  const chip = !status ? <span className="t-small dim">Not on chain yet</span>
    : written ? <span className="chip"><span className={s.still} aria-hidden="true" />written</span>
    : <State state={status} />

  return (
    <div className="container page">
      <Head />
      <div className={`grid ${s.layout}`}>
        <section className={s.work} aria-labelledby="step-title">
          <StepRail current={stepIndex} complete={step === 'done'} />
          <div className={s.step} ref={work} tabIndex={-1}>
            {step !== 'done' && !paused ? (
              <header className={s.stepHead}>
                <h2 id="step-title" className="t-h2">{says.label}</h2>
                <p className="t-small">{says.says}</p>
                <p className={s.live} role="status">{waits ? <><StateTile state="pending" />{waits}</> : null}</p>
              </header>
            ) : <h2 id="step-title" className="sr-only">{paused ? 'Continue' : 'Done'}</h2>}
            {workBody}
            {cliResumeBox}
          </div>
          <input
            ref={pick} type="file" className="sr-only" tabIndex={-1} aria-hidden="true" accept={need?.id === 'key' ? '.json,application/json' : undefined}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f && need) void (need.id === 'key' ? restoreKey(f) : restoreWeights(f)) }}
          />
        </section>

        <aside className={s.side} aria-label="The model on chain">
          <div className={`panel ${s.card}`} data-open={open || undefined}>
            <div className={`panel-head ${s.cardHead}`}>
              <h2 className={s.sideName}>{name ? <span className="mono">{name}</span> : <span className="dim">The model</span>}</h2>
              {chip}
            </div>
            <button type="button" className={s.cardLine} aria-expanded={open} aria-controls={sideId} onClick={() => { play('toggle'); setOpen(!open) }}>
              <span className={s.sideName}>{name ? <span className="mono">{name}</span> : <span className="dim">The model</span>}</span>
              {chip}
              {price ? <Amount value={price} /> : null}
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8 9.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
            </button>
            <div id={sideId} className={`panel-body ${s.sideBody}`}>
              <CipherTiles byteAt={bytes ? (i) => (bytes === cipher.current ? bytes[cellOffset(i)] ?? 0 : bytes[i % bytes.length] ?? 0) : null} onDevice={revealed} onChain={(i) => flags.current[Math.floor(cellOffset(i) / chunkBytes)] === 1} />
              <dl className="kv">
                {st?.model ? <><dt>Address</dt><dd><Hash value={st.model} label="model address" /></dd></> : null}
                {st?.base || draft.sealKind === 'adapter' ? (
                  <>
                    <dt>Type</dt><dd className="mono">sealed adapter</dd>
                    <dt>Base</dt>
                    <dd className="mono">
                      {st?.base ? (
                        <>{st.base.format} (<Size n={st.base.sizeBytes} />)</>
                      ) : (
                        <>{draft.baseFormat}{Number(draft.baseSizeBytes) > 0 ? <> (<Size n={Number(draft.baseSizeBytes)} />)</> : null}</>
                      )}
                    </dd>
                  </>
                ) : null}
                <dt>{st?.base || draft.sealKind === 'adapter' ? 'Adapter' : 'Weights'}</dt><dd>{plaintextBytes !== null ? <Size n={plaintextBytes} /> : <span className="dim">No file yet</span>}</dd>
                {st && (st.sha256 || st.model) ? <><dt>Ciphertext</dt><dd><Size n={st.sizeBytes} /></dd></> : null}
                {st?.sha256 ? <><dt>SHA-256</dt><dd><Hash value={st.sha256} chars={8} label="ciphertext hash" /></dd></> : null}
                <dt>Measurements</dt><dd>{measurements.length ? <span className="mono">{measurements.length} allowed</span> : <span className="dim">None allowed yet</span>}</dd>
                <dt>Price per call</dt><dd>{price ? <Amount value={price} /> : <span className="dim">Not set</span>}</dd>
              </dl>
              <Split parts={split} />
            </div>
            {cost || showError || action ? (
              <div className={s.foot}>
                {cost ? <div className={s.cost}>{cost}</div> : null}
                {showError ? <p className={`t-small bad ${s.error}`} role="alert">{error}</p> : null}
                {action ? <div className={s.acts} aria-live="polite">{action}</div> : null}
              </div>
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  )
}

function Head() {
  return (
    <div className="page-head">
      <div>
        <h1 className="t-h1">Seal a model</h1>
        <p className="t-small">The weights are encrypted on this device and written to chain as ciphertext. Your wallet signs to create, seal and grant, then it answers calls.</p>
      </div>
    </div>
  )
}
