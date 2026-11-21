import type { TokenizerRef } from '@voynich/contract'
import { fetchVerifiedBase, type BaseCacheOptions } from './base-cache.js'

export type LoadedTokenizer = {
  readonly ref: TokenizerRef
  encode(text: string): number[]
  decode(ids: readonly number[]): string
}

const utf8Encoder = new TextEncoder()
const utf8Decoder = new TextDecoder('utf-8', { fatal: false })

function buildGpt2ByteMaps(): { byteToChar: Map<number, string>; charToByte: Map<string, number> } {
  const bytes: number[] = []
  for (let b = 33; b <= 126; b++) bytes.push(b)
  for (let b = 161; b <= 172; b++) bytes.push(b)
  for (let b = 174; b <= 255; b++) bytes.push(b)
  const chars = [...bytes]
  let extra = 0
  for (let b = 0; b < 256; b++) {
    if (!bytes.includes(b)) {
      bytes.push(b)
      chars.push(256 + extra)
      extra += 1
    }
  }
  const byteToChar = new Map<number, string>()
  const charToByte = new Map<string, number>()
  for (let i = 0; i < bytes.length; i++) {
    const ch = String.fromCharCode(chars[i]!)
    byteToChar.set(bytes[i]!, ch)
    charToByte.set(ch, bytes[i]!)
  }
  return { byteToChar, charToByte }
}

const GPT2_BYTE_MAPS = buildGpt2ByteMaps()

function encodeGpt2ByteLevel(text: string): string {
  const raw = utf8Encoder.encode(text)
  let out = ''
  for (let i = 0; i < raw.length; i++) {
    out += GPT2_BYTE_MAPS.byteToChar.get(raw[i]!)!
  }
  return out
}

function decodeGpt2ByteLevel(encoded: string): string {
  const bytes: number[] = []
  for (const ch of encoded) {
    const mapped = GPT2_BYTE_MAPS.charToByte.get(ch)
    if (mapped !== undefined) {
      bytes.push(mapped)
    } else {
      for (const b of utf8Encoder.encode(ch)) bytes.push(b)
    }
  }
  return utf8Decoder.decode(Uint8Array.from(bytes))
}

function specialIdSet(ref: TokenizerRef, extra?: Iterable<number>): Set<number> {
  const set = new Set<number>()
  if (ref.bosTokenId !== undefined) set.add(ref.bosTokenId)
  if (ref.eosTokenId !== undefined) set.add(ref.eosTokenId)
  if (ref.padTokenId !== undefined) set.add(ref.padTokenId)
  if (extra) for (const id of extra) set.add(id)
  return set
}

function applyBosAndTruncate(ids: number[], ref: TokenizerRef): number[] {
  const result = ref.bosTokenId !== undefined ? [ref.bosTokenId, ...ids] : [...ids]
  if (result.length > ref.maxInputTokens) {
    return result.slice(0, ref.maxInputTokens)
  }
  return result
}

/** Zero-dependency UTF-8 byte-level tokenizer (tokens 0..255 plus optional BOS/EOS/PAD). */
export function createByteLevelTokenizer(ref: TokenizerRef): LoadedTokenizer {
  if (ref.format !== 'byte-level') {
    throw new Error(`Expected byte-level tokenizer format, got ${ref.format}.`)
  }
  const specials = specialIdSet(ref)
  return {
    ref,
    encode(text: string): number[] {
      const bytes = utf8Encoder.encode(text)
      const ids: number[] = []
      for (let i = 0; i < bytes.length; i++) {
        const value = bytes[i]!
        if (value >= ref.vocabSize) {
          throw new Error(`Byte value ${value} exceeds tokenizer vocabSize ${ref.vocabSize}.`)
        }
        ids.push(value)
      }
      return applyBosAndTruncate(ids, ref)
    },
    decode(ids: readonly number[]): string {
      const bytes: number[] = []
      for (const id of ids) {
        if (specials.has(id)) continue
        if (id >= 0 && id <= 255) bytes.push(id)
      }
      return utf8Decoder.decode(Uint8Array.from(bytes))
    },
  }
}

type HfTokenizerJson = {
  model?: {
    type?: string
    vocab?: Record<string, number>
    merges?: (string | [string, string])[]
    unk_token?: string | null
    continuing_subword_prefix?: string | null
    end_of_word_suffix?: string | null
    max_input_chars_per_word?: number
  }
  added_tokens?: { id: number; content: string; special?: boolean }[]
  normalizer?: { type?: string; lowercase?: boolean; normalizers?: { type?: string; lowercase?: boolean }[] } | null
  pre_tokenizer?: {
    type?: string
    add_prefix_space?: boolean
    replacement?: string
    pretokenizers?: { type?: string; add_prefix_space?: boolean; replacement?: string }[]
  } | null
  decoder?: {
    type?: string
    replacement?: string
    prefix?: string
    suffix?: string
    decoders?: { type?: string; replacement?: string; prefix?: string; suffix?: string }[]
  } | null
}

function hasComponentType(
  root: { type?: string; pretokenizers?: { type?: string }[]; decoders?: { type?: string }[] } | null | undefined,
  target: string,
): boolean {
  if (!root) return false
  if (root.type === target) return true
  if (Array.isArray(root.pretokenizers) && root.pretokenizers.some(item => item.type === target)) return true
  if (Array.isArray(root.decoders) && root.decoders.some(item => item.type === target)) return true
  return false
}

function findComponent<T extends { type?: string }>(
  root: (T & { pretokenizers?: T[]; decoders?: T[] }) | null | undefined,
  target: string,
): T | undefined {
  if (!root) return undefined
  if (root.type === target) return root
  if (Array.isArray(root.pretokenizers)) return root.pretokenizers.find(item => item.type === target)
  if (Array.isArray(root.decoders)) return root.decoders.find(item => item.type === target)
  return undefined
}

function shouldLowercase(normalizer: HfTokenizerJson['normalizer']): boolean {
  if (!normalizer) return false
  if (normalizer.lowercase === true || normalizer.type === 'Lowercase') return true
  if (Array.isArray(normalizer.normalizers)) {
    return normalizer.normalizers.some(item => item.lowercase === true || item.type === 'Lowercase')
  }
  return false
}

function splitWhitespaceAndPunctuation(text: string): string[] {
  const out: string[] = []
  const re = /[\p{P}\p{S}]|[^\s\p{P}\p{S}]+/gu
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    out.push(match[0])
  }
  return out
}

function splitByteLevelChunks(text: string): string[] {
  const out: string[] = []
  const re = /'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    out.push(match[0])
  }
  return out
}

function applyBpeMerges(symbols: string[], mergeRanks: Map<string, number>): string[] {
  if (symbols.length <= 1 || mergeRanks.size === 0) return symbols
  const word = [...symbols]
  while (word.length > 1) {
    let bestRank = Infinity
    let bestIndex = -1
    for (let i = 0; i < word.length - 1; i++) {
      const rank = mergeRanks.get(`${word[i]!}\0${word[i + 1]!}`)
      if (rank !== undefined && rank < bestRank) {
        bestRank = rank
        bestIndex = i
      }
    }
    if (bestIndex < 0) break
    word.splice(bestIndex, 2, `${word[bestIndex]!}${word[bestIndex + 1]!}`)
  }
  return word
}

/** Parses a Hugging Face tokenizer.json document for bpe or word-piece formats. */
export function parseHuggingFaceTokenizer(jsonBytes: Uint8Array | string, ref: TokenizerRef): LoadedTokenizer {
  const rawText = typeof jsonBytes === 'string' ? jsonBytes : utf8Decoder.decode(jsonBytes)
  const parsed = JSON.parse(rawText) as HfTokenizerJson
  if (!parsed || typeof parsed !== 'object' || !parsed.model || !parsed.model.vocab || typeof parsed.model.vocab !== 'object') {
    throw new Error('Invalid Hugging Face tokenizer.json: missing model.vocab.')
  }

  const vocab = new Map<string, number>()
  const idToToken = new Map<number, string>()
  const addedSpecials = new Set<number>()
  for (const [token, id] of Object.entries(parsed.model.vocab)) {
    if (typeof id === 'number' && Number.isSafeInteger(id) && id >= 0) {
      vocab.set(token, id)
      idToToken.set(id, token)
    }
  }
  for (const added of parsed.added_tokens ?? []) {
    if (typeof added.id === 'number' && typeof added.content === 'string') {
      vocab.set(added.content, added.id)
      idToToken.set(added.id, added.content)
      if (added.special) addedSpecials.add(added.id)
    }
  }
  const specials = specialIdSet(ref, addedSpecials)
  const lowercase = shouldLowercase(parsed.normalizer)
  const unkToken = parsed.model.unk_token ?? '[UNK]'
  const unkId = vocab.get(unkToken) ?? vocab.get('<unk>') ?? vocab.get('[UNK]')

  if (ref.format === 'bpe') {
    const mergeRanks = new Map<string, number>()
    const merges = parsed.model.merges ?? []
    for (let i = 0; i < merges.length; i++) {
      const entry = merges[i]!
      if (Array.isArray(entry) && entry.length === 2) {
        mergeRanks.set(`${entry[0]}\0${entry[1]}`, i)
      } else if (typeof entry === 'string') {
        const space = entry.indexOf(' ')
        if (space > 0) mergeRanks.set(`${entry.slice(0, space)}\0${entry.slice(space + 1)}`, i)
      }
    }
    const isByteLevel = hasComponentType(parsed.pre_tokenizer, 'ByteLevel') || hasComponentType(parsed.decoder, 'ByteLevel')
    const metaspacePre = findComponent(parsed.pre_tokenizer, 'Metaspace')
    const metaspaceDec = findComponent(parsed.decoder, 'Metaspace')
    const metaspaceChar = metaspacePre?.replacement ?? metaspaceDec?.replacement ?? '\u2581'
    const isMetaspace = Boolean(metaspacePre || metaspaceDec)
    const endOfWordSuffix = parsed.model.end_of_word_suffix ?? findComponent(parsed.decoder, 'BPEDecoder')?.suffix ?? ''

    return {
      ref,
      encode(text: string): number[] {
        const normalized = lowercase ? text.toLowerCase() : text
        const ids: number[] = []
        if (isByteLevel) {
          const preComp = findComponent(parsed.pre_tokenizer, 'ByteLevel')
          const prepared = preComp?.add_prefix_space && normalized.length > 0 && !normalized.startsWith(' ')
            ? ` ${normalized}`
            : normalized
          for (const chunk of splitByteLevelChunks(prepared)) {
            const byteStr = encodeGpt2ByteLevel(chunk)
            const merged = applyBpeMerges([...byteStr], mergeRanks)
            for (const piece of merged) {
              const id = vocab.get(piece) ?? unkId
              if (id === undefined) throw new Error(`Unknown BPE token piece: ${piece}`)
              ids.push(id)
            }
          }
        } else if (isMetaspace) {
          const prepared = (normalized.length > 0 ? metaspaceChar : '') + normalized.replace(/ /g, metaspaceChar)
          const merged = applyBpeMerges([...prepared], mergeRanks)
          for (const piece of merged) {
            const id = vocab.get(piece) ?? unkId
            if (id === undefined) throw new Error(`Unknown BPE token piece: ${piece}`)
            ids.push(id)
          }
        } else {
          const words = normalized.trim().length === 0 ? [] : normalized.trim().split(/\s+/)
          for (const word of words) {
            const chars = [...word]
            if (endOfWordSuffix && chars.length > 0) {
              chars[chars.length - 1] = `${chars[chars.length - 1]!}${endOfWordSuffix}`
            }
            const merged = applyBpeMerges(chars, mergeRanks)
            for (const piece of merged) {
              const id = vocab.get(piece) ?? unkId
              if (id === undefined) throw new Error(`Unknown BPE token piece: ${piece}`)
              ids.push(id)
            }
          }
        }
        return applyBosAndTruncate(ids, ref)
      },
      decode(ids: readonly number[]): string {
        const pieces: string[] = []
        for (const id of ids) {
          if (specials.has(id)) continue
          const token = idToToken.get(id)
          if (token !== undefined) pieces.push(token)
        }
        if (isByteLevel) {
          return decodeGpt2ByteLevel(pieces.join(''))
        }
        if (isMetaspace) {
          const joined = pieces.join('').split(metaspaceChar).join(' ')
          return joined.startsWith(' ') ? joined.slice(1) : joined
        }
        if (endOfWordSuffix) {
          return pieces.join('').split(endOfWordSuffix).join(' ').trim()
        }
        return pieces.join(' ')
      },
    }
  }

  if (ref.format === 'word-piece') {
    const prefix = parsed.model.continuing_subword_prefix ?? findComponent(parsed.decoder, 'WordPiece')?.prefix ?? '##'
    const maxChars = parsed.model.max_input_chars_per_word ?? 100
    return {
      ref,
      encode(text: string): number[] {
        const normalized = lowercase ? text.toLowerCase() : text
        const words = splitWhitespaceAndPunctuation(normalized)
        const ids: number[] = []
        for (const word of words) {
          const chars = [...word]
          if (chars.length > maxChars) {
            if (unkId === undefined) throw new Error('Word exceeds max_input_chars_per_word and tokenizer has no unk_token.')
            ids.push(unkId)
            continue
          }
          const subIds: number[] = []
          let start = 0
          let bad = false
          while (start < chars.length) {
            let end = chars.length
            let found: number | undefined
            while (start < end) {
              const slice = chars.slice(start, end).join('')
              const candidate = start > 0 ? `${prefix}${slice}` : slice
              const id = vocab.get(candidate)
              if (id !== undefined) {
                found = id
                break
              }
              end -= 1
            }
            if (found === undefined) {
              bad = true
              break
            }
            subIds.push(found)
            start = end
          }
          if (bad) {
            if (unkId === undefined) throw new Error(`WordPiece tokenizer cannot encode token: ${word}`)
            ids.push(unkId)
          } else {
            ids.push(...subIds)
          }
        }
        return applyBosAndTruncate(ids, ref)
      },
      decode(ids: readonly number[]): string {
        let out = ''
        for (const id of ids) {
          if (specials.has(id)) continue
          const token = idToToken.get(id)
          if (token === undefined) continue
          if (prefix && token.startsWith(prefix)) {
            out += token.slice(prefix.length)
          } else {
            out += out.length === 0 ? token : ` ${token}`
          }
        }
        return out
      },
    }
  }

  throw new Error(`Unsupported tokenizer format: ${ref.format}.`)
}

/** Loads a manifest tokenizer (built-in byte-level, or SHA-256-verified Hugging Face tokenizer.json via base-cache). */
export async function loadTokenizer(ref: TokenizerRef, options: BaseCacheOptions = {}): Promise<LoadedTokenizer> {
  if (ref.format === 'byte-level') {
    return createByteLevelTokenizer(ref)
  }
  if (!ref.source || !ref.sha256) {
    throw new Error(`Tokenizer format ${ref.format} requires both source and sha256.`)
  }
  const fetched = await fetchVerifiedBase(
    { sha256: ref.sha256, format: 'tokenizer-json', source: ref.source, maxSizeBytes: 32 * 1024 * 1024 },
    options,
  )
  return parseHuggingFaceTokenizer(fetched.bytes, ref)
}
