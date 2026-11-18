import { sha256, toHex, utf8 } from './crypto.js'

export const ADAPTER_MAGIC = 'VOYA' as const
export const ADAPTER_VERSION = 1 as const
export const ADAPTER_FORMAT = 'onnx' as const
const MAGIC_BYTES = Uint8Array.from([0x56, 0x4f, 0x59, 0x41])
const HASH_RE = /^[0-9a-f]{64}$/
const ZERO_HASH_RE = /^0{64}$/

export type AdapterTensorOp = 'replace' | 'delta' | 'lora'

export type AdapterTensorHeader =
  | { name: string; op: 'replace' | 'delta'; dims: number[]; byteOffset: number; byteLength: number }
  | { name: string; op: 'lora'; dims: [number, number]; rank: number; alpha: number; aOffset: number; aLength: number; bOffset: number; bLength: number }

export type AdapterHeader = {
  version: typeof ADAPTER_VERSION
  baseSha256: string
  format: typeof ADAPTER_FORMAT
  tensors: AdapterTensorHeader[]
}

export type AdapterTensorInput =
  | { name: string; op: 'replace' | 'delta'; dims: readonly number[]; values: Float32Array | readonly number[] }
  | { name: string; op: 'lora'; dims: readonly [number, number]; rank: number; alpha: number; a: Float32Array | readonly number[]; b: Float32Array | readonly number[] }

export type AdapterSpec = {
  baseSha256: string
  format?: typeof ADAPTER_FORMAT
  tensors: readonly AdapterTensorInput[]
}

export type DecodedAdapterTensor =
  | { name: string; op: 'replace' | 'delta'; dims: number[]; values: Float32Array }
  | { name: string; op: 'lora'; dims: [number, number]; rank: number; alpha: number; a: Float32Array; b: Float32Array }

export type DecodedAdapter = {
  version: typeof ADAPTER_VERSION
  baseSha256: string
  format: typeof ADAPTER_FORMAT
  tensors: DecodedAdapterTensor[]
}

export type OnnxInitializerInfo = {
  name: string
  dims: number[]
  dataType: number
  values: Float32Array | null
}

function assertValidHash(value: string, label: string): void {
  if (typeof value !== 'string' || !HASH_RE.test(value) || ZERO_HASH_RE.test(value)) {
    throw new Error(`${label} must be a non-zero 64-character lowercase SHA-256 hex digest`)
  }
}

function assertDims(dims: readonly number[], label: string): number {
  if (!Array.isArray(dims) || dims.length === 0) throw new Error(`${label} must have at least one dimension`)
  let total = 1
  for (const dim of dims) {
    if (!Number.isSafeInteger(dim) || dim <= 0) throw new Error(`${label} dimensions must be positive integers`)
    total *= dim
    if (!Number.isSafeInteger(total)) throw new Error(`${label} dimensions overflow safe integer range`)
  }
  return total
}

function toFloat32Bytes(values: Float32Array | readonly number[], expectedLength: number, label: string): Uint8Array {
  if (values.length !== expectedLength) {
    throw new Error(`${label} length ${values.length} does not match expected ${expectedLength}`)
  }
  const bytes = new Uint8Array(expectedLength * 4)
  const view = new DataView(bytes.buffer)
  for (let i = 0; i < expectedLength; i++) {
    const v = values[i]!
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${label} contains a non-finite float value`)
    view.setFloat32(i * 4, v, true)
  }
  return bytes
}

function readFloat32Array(bytes: Uint8Array, byteOffset: number, byteLength: number, expectedCount: number, label: string): Float32Array {
  if (
    !Number.isSafeInteger(byteOffset) || !Number.isSafeInteger(byteLength)
    || byteOffset < 0 || byteLength !== expectedCount * 4 || byteOffset + byteLength > bytes.length
  ) {
    throw new Error(`${label} payload range is invalid`)
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset + byteOffset, byteLength)
  const out = new Float32Array(expectedCount)
  for (let i = 0; i < expectedCount; i++) {
    const v = view.getFloat32(i * 4, true)
    if (!Number.isFinite(v)) throw new Error(`${label} contains a non-finite float value`)
    out[i] = v
  }
  return out
}

/** Encodes a voynich/adapter/v1 binary payload (VOYA magic + version 1 + JSON header + LE float32 payloads). */
export function encodeAdapter(spec: AdapterSpec): Uint8Array {
  assertValidHash(spec.baseSha256, 'baseSha256')
  const format = spec.format ?? ADAPTER_FORMAT
  if (format !== ADAPTER_FORMAT) throw new Error(`Unsupported adapter format: ${String(format)}`)
  if (!Array.isArray(spec.tensors) || spec.tensors.length === 0) throw new Error('Adapter must specify at least one tensor')

  const seen = new Set<string>()
  const headerTensors: AdapterTensorHeader[] = []
  const payloadChunks: Uint8Array[] = []
  let payloadOffset = 0

  for (const tensor of spec.tensors) {
    if (typeof tensor.name !== 'string' || tensor.name.length === 0) throw new Error('Adapter tensor name must be non-empty')
    if (seen.has(tensor.name)) throw new Error(`Duplicate adapter tensor: ${tensor.name}`)
    seen.add(tensor.name)

    if (tensor.op === 'replace' || tensor.op === 'delta') {
      const count = assertDims(tensor.dims, `Tensor ${tensor.name}`)
      const bytes = toFloat32Bytes(tensor.values, count, `Tensor ${tensor.name}`)
      headerTensors.push({
        name: tensor.name,
        op: tensor.op,
        dims: [...tensor.dims],
        byteOffset: payloadOffset,
        byteLength: bytes.length,
      })
      payloadChunks.push(bytes)
      payloadOffset += bytes.length
    } else if (tensor.op === 'lora') {
      if (!Array.isArray(tensor.dims) || tensor.dims.length !== 2) throw new Error(`LoRA tensor ${tensor.name} must be 2D [outDim, inDim]`)
      assertDims(tensor.dims, `LoRA tensor ${tensor.name}`)
      const [outDim, inDim] = tensor.dims
      if (!Number.isSafeInteger(tensor.rank) || tensor.rank <= 0) throw new Error(`LoRA tensor ${tensor.name} rank must be a positive integer`)
      if (typeof tensor.alpha !== 'number' || !Number.isFinite(tensor.alpha)) throw new Error(`LoRA tensor ${tensor.name} alpha must be finite`)
      const aBytes = toFloat32Bytes(tensor.a, outDim * tensor.rank, `LoRA tensor ${tensor.name} A`)
      const bBytes = toFloat32Bytes(tensor.b, tensor.rank * inDim, `LoRA tensor ${tensor.name} B`)
      const aOffset = payloadOffset
      payloadOffset += aBytes.length
      const bOffset = payloadOffset
      payloadOffset += bBytes.length
      headerTensors.push({
        name: tensor.name,
        op: 'lora',
        dims: [outDim, inDim],
        rank: tensor.rank,
        alpha: tensor.alpha,
        aOffset,
        aLength: aBytes.length,
        bOffset,
        bLength: bBytes.length,
      })
      payloadChunks.push(aBytes, bBytes)
    } else {
      throw new Error(`Unsupported adapter op: ${String((tensor as { op?: unknown }).op)}`)
    }
  }

  const header: AdapterHeader = {
    version: ADAPTER_VERSION,
    baseSha256: spec.baseSha256,
    format: ADAPTER_FORMAT,
    tensors: headerTensors,
  }
  const headerBytes = utf8(JSON.stringify(header))
  const out = new Uint8Array(9 + headerBytes.length + payloadOffset)
  out.set(MAGIC_BYTES, 0)
  out[4] = ADAPTER_VERSION
  new DataView(out.buffer).setUint32(5, headerBytes.length, true)
  out.set(headerBytes, 9)
  let cursor = 9 + headerBytes.length
  for (const chunk of payloadChunks) {
    out.set(chunk, cursor)
    cursor += chunk.length
  }
  return out
}

/** Decodes and validates a voynich/adapter/v1 binary payload. */
export function decodeAdapter(bytes: Uint8Array): DecodedAdapter {
  if (bytes.length < 9) throw new Error('Adapter payload is too short')
  for (let i = 0; i < 4; i++) {
    if (bytes[i] !== MAGIC_BYTES[i]) throw new Error('Invalid adapter magic header (expected VOYA)')
  }
  if (bytes[4] !== ADAPTER_VERSION) throw new Error(`Unsupported adapter version: ${bytes[4]}`)
  const headerLen = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(5, true)
  if (headerLen === 0 || 9 + headerLen > bytes.length) throw new Error('Invalid adapter header length')

  let header: AdapterHeader
  try {
    header = JSON.parse(new TextDecoder().decode(bytes.subarray(9, 9 + headerLen))) as AdapterHeader
  } catch {
    throw new Error('Adapter header is not valid JSON')
  }
  if (!header || typeof header !== 'object' || header.version !== ADAPTER_VERSION) throw new Error('Invalid adapter header version')
  assertValidHash(header.baseSha256, 'baseSha256')
  if (header.format !== ADAPTER_FORMAT) throw new Error(`Unsupported adapter format: ${String(header.format)}`)
  if (!Array.isArray(header.tensors) || header.tensors.length === 0) throw new Error('Adapter header must contain at least one tensor')

  const payload = bytes.subarray(9 + headerLen)
  const seen = new Set<string>()
  const tensors: DecodedAdapterTensor[] = []
  let maxEnd = 0

  for (const entry of header.tensors) {
    if (!entry || typeof entry !== 'object' || typeof entry.name !== 'string' || entry.name.length === 0) {
      throw new Error('Adapter tensor entry has an invalid name')
    }
    if (seen.has(entry.name)) throw new Error(`Duplicate adapter tensor: ${entry.name}`)
    seen.add(entry.name)

    if (entry.op === 'replace' || entry.op === 'delta') {
      const count = assertDims(entry.dims, `Tensor ${entry.name}`)
      const values = readFloat32Array(payload, entry.byteOffset, entry.byteLength, count, `Tensor ${entry.name}`)
      maxEnd = Math.max(maxEnd, entry.byteOffset + entry.byteLength)
      tensors.push({ name: entry.name, op: entry.op, dims: [...entry.dims], values })
    } else if (entry.op === 'lora') {
      if (!Array.isArray(entry.dims) || entry.dims.length !== 2) throw new Error(`LoRA tensor ${entry.name} must be 2D [outDim, inDim]`)
      assertDims(entry.dims, `LoRA tensor ${entry.name}`)
      const [outDim, inDim] = entry.dims
      if (!Number.isSafeInteger(entry.rank) || entry.rank <= 0) throw new Error(`LoRA tensor ${entry.name} rank must be positive`)
      if (typeof entry.alpha !== 'number' || !Number.isFinite(entry.alpha)) throw new Error(`LoRA tensor ${entry.name} alpha must be finite`)
      const a = readFloat32Array(payload, entry.aOffset, entry.aLength, outDim * entry.rank, `LoRA tensor ${entry.name} A`)
      const b = readFloat32Array(payload, entry.bOffset, entry.bLength, entry.rank * inDim, `LoRA tensor ${entry.name} B`)
      maxEnd = Math.max(maxEnd, entry.aOffset + entry.aLength, entry.bOffset + entry.bLength)
      tensors.push({ name: entry.name, op: 'lora', dims: [outDim, inDim], rank: entry.rank, alpha: entry.alpha, a, b })
    } else {
      throw new Error(`Unsupported adapter op: ${String((entry as { op?: unknown }).op)}`)
    }
  }
  if (maxEnd !== payload.length) throw new Error('Adapter payload contains unexpected trailing bytes')

  return { version: ADAPTER_VERSION, baseSha256: header.baseSha256, format: ADAPTER_FORMAT, tensors }
}

// --- Pure-TS ONNX Protobuf reader/rewriter (ModelProto -> GraphProto -> TensorProto) ---

type ProtoField = {
  fieldNumber: number
  wireType: number
  rawStart: number
  rawEnd: number
  valueStart: number
  valueEnd: number
  varintValue?: bigint
}

function readVarint(bytes: Uint8Array, start: number): { value: bigint; next: number } {
  let result = 0n
  let shift = 0n
  let pos = start
  while (pos < bytes.length) {
    const byte = bytes[pos++]!
    result |= BigInt(byte & 0x7f) << shift
    if ((byte & 0x80) === 0) return { value: result, next: pos }
    shift += 7n
    if (shift > 70n) throw new Error('Invalid protobuf varint')
  }
  throw new Error('Truncated protobuf varint')
}

function encodeVarint(value: number): Uint8Array {
  const out: number[] = []
  let v = value >>> 0
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80)
    v >>>= 7
  }
  out.push(v)
  return Uint8Array.from(out)
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function readProtoFields(bytes: Uint8Array): ProtoField[] {
  const fields: ProtoField[] = []
  let pos = 0
  while (pos < bytes.length) {
    const rawStart = pos
    const tag = readVarint(bytes, pos)
    pos = tag.next
    const wireType = Number(tag.value & 7n)
    const fieldNumber = Number(tag.value >> 3n)
    if (fieldNumber <= 0) throw new Error('Invalid protobuf field number')
    if (wireType === 0) {
      const valueStart = pos
      const val = readVarint(bytes, pos)
      pos = val.next
      fields.push({ fieldNumber, wireType, rawStart, rawEnd: pos, valueStart, valueEnd: pos, varintValue: val.value })
    } else if (wireType === 1) {
      if (pos + 8 > bytes.length) throw new Error('Truncated 64-bit protobuf field')
      const valueStart = pos
      pos += 8
      fields.push({ fieldNumber, wireType, rawStart, rawEnd: pos, valueStart, valueEnd: pos })
    } else if (wireType === 2) {
      const len = readVarint(bytes, pos)
      const byteLen = Number(len.value)
      pos = len.next
      if (!Number.isSafeInteger(byteLen) || byteLen < 0 || pos + byteLen > bytes.length) {
        throw new Error('Truncated length-delimited protobuf field')
      }
      const valueStart = pos
      pos += byteLen
      fields.push({ fieldNumber, wireType, rawStart, rawEnd: pos, valueStart, valueEnd: pos })
    } else if (wireType === 5) {
      if (pos + 4 > bytes.length) throw new Error('Truncated 32-bit protobuf field')
      const valueStart = pos
      pos += 4
      fields.push({ fieldNumber, wireType, rawStart, rawEnd: pos, valueStart, valueEnd: pos })
    } else {
      throw new Error(`Unsupported protobuf wire type: ${wireType}`)
    }
  }
  return fields
}

function parseTensorProto(bytes: Uint8Array): { fields: ProtoField[]; info: OnnxInitializerInfo } {
  const fields = readProtoFields(bytes)
  const dims: number[] = []
  let dataType = 0
  let name = ''
  let rawDataSlice: Uint8Array | null = null
  const floatDataParts: number[] = []

  for (const field of fields) {
    if (field.fieldNumber === 1) {
      if (field.wireType === 0) {
        dims.push(Number(field.varintValue!))
      } else if (field.wireType === 2) {
        let p = field.valueStart
        while (p < field.valueEnd) {
          const item = readVarint(bytes, p)
          dims.push(Number(item.value))
          p = item.next
        }
      }
    } else if (field.fieldNumber === 2 && field.wireType === 0) {
      dataType = Number(field.varintValue!)
    } else if (field.fieldNumber === 4) {
      if (field.wireType === 2) {
        const len = field.valueEnd - field.valueStart
        if (len % 4 !== 0) throw new Error('Invalid packed float_data length in ONNX TensorProto')
        const view = new DataView(bytes.buffer, bytes.byteOffset + field.valueStart, len)
        for (let off = 0; off < len; off += 4) floatDataParts.push(view.getFloat32(off, true))
      } else if (field.wireType === 5) {
        const view = new DataView(bytes.buffer, bytes.byteOffset + field.valueStart, 4)
        floatDataParts.push(view.getFloat32(0, true))
      }
    } else if (field.fieldNumber === 8 && field.wireType === 2) {
      name = new TextDecoder().decode(bytes.subarray(field.valueStart, field.valueEnd))
    } else if (field.fieldNumber === 9 && field.wireType === 2) {
      rawDataSlice = bytes.subarray(field.valueStart, field.valueEnd)
    }
  }

  let values: Float32Array | null = null
  if (dataType === 1) {
    if (rawDataSlice && rawDataSlice.length > 0) {
      if (rawDataSlice.length % 4 !== 0) throw new Error(`Invalid raw_data length on ONNX FLOAT tensor ${name}`)
      const count = rawDataSlice.length / 4
      const view = new DataView(rawDataSlice.buffer, rawDataSlice.byteOffset, rawDataSlice.byteLength)
      values = new Float32Array(count)
      for (let i = 0; i < count; i++) values[i] = view.getFloat32(i * 4, true)
    } else if (floatDataParts.length > 0) {
      values = Float32Array.from(floatDataParts)
    } else {
      values = new Float32Array(0)
    }
  }

  return { fields, info: { name, dims, dataType, values } }
}

function rewriteTensorProtoFloat32(bytes: Uint8Array, fields: ProtoField[], updated: Float32Array): Uint8Array {
  const parts: Uint8Array[] = []
  for (const field of fields) {
    // Strip old float_data (field 4) and raw_data (field 9), preserving every other field verbatim.
    if (field.fieldNumber === 4 || field.fieldNumber === 9) continue
    parts.push(bytes.subarray(field.rawStart, field.rawEnd))
  }
  const rawBytes = new Uint8Array(updated.length * 4)
  const view = new DataView(rawBytes.buffer)
  for (let i = 0; i < updated.length; i++) view.setFloat32(i * 4, updated[i]!, true)
  // Field 9 (raw_data), wire type 2 => (9 << 3) | 2 = 0x4a.
  parts.push(Uint8Array.of(0x4a), encodeVarint(rawBytes.length), rawBytes)
  return concatBytes(parts)
}

/** Lists every TensorProto initializer in an ONNX ModelProto graph (reading raw_data and float_data). */
export function inspectOnnxInitializers(onnxBytes: Uint8Array): OnnxInitializerInfo[] {
  const modelFields = readProtoFields(onnxBytes)
  const graphField = modelFields.find(field => field.fieldNumber === 7 && field.wireType === 2)
  if (!graphField) throw new Error('ONNX ModelProto has no graph field')
  const graphBytes = onnxBytes.subarray(graphField.valueStart, graphField.valueEnd)
  const graphFields = readProtoFields(graphBytes)
  const initializers: OnnxInitializerInfo[] = []
  for (const field of graphFields) {
    if (field.fieldNumber !== 5 || field.wireType !== 2) continue
    const tensorBytes = graphBytes.subarray(field.valueStart, field.valueEnd)
    initializers.push(parseTensorProto(tensorBytes).info)
  }
  return initializers
}

function applyTensorOp(base: Float32Array, op: DecodedAdapterTensor): Float32Array {
  if (op.op === 'lora') {
    const [outDim, inDim] = op.dims
    const { rank, alpha, a, b } = op
    const scale = alpha / rank
    const out = new Float32Array(base)
    for (let r = 0; r < outDim; r++) {
      const outRow = r * inDim
      const aRow = r * rank
      for (let k = 0; k < rank; k++) {
        const aVal = a[aRow + k]! * scale
        const bRow = k * inDim
        for (let c = 0; c < inDim; c++) {
          out[outRow + c] = out[outRow + c]! + aVal * b[bRow + c]!
        }
      }
    }
    return out
  }
  if (op.op === 'replace') return new Float32Array(op.values)
  const out = new Float32Array(base.length)
  for (let i = 0; i < base.length; i++) out[i] = base[i]! + op.values[i]!
  return out
}

/**
 * Verifies baseOnnxBytes against adapter.baseSha256 (and optional expectedBaseSha256),
 * applies replace/delta/lora operations strictly in memory to matching FLOAT initializers,
 * and returns a valid updated ONNX ModelProto byte buffer.
 */
export function applyOnnxAdapter(
  baseOnnxBytes: Uint8Array,
  adapterBytes: Uint8Array,
  expectedBaseSha256?: string,
): Uint8Array {
  const adapter = decodeAdapter(adapterBytes)
  const actualBaseSha256 = toHex(sha256(baseOnnxBytes))
  if (expectedBaseSha256 !== undefined && expectedBaseSha256.toLowerCase() !== actualBaseSha256) {
    throw new Error('Base ONNX model SHA-256 does not match the expected on-chain base hash')
  }
  if (adapter.baseSha256 !== actualBaseSha256) {
    throw new Error('Adapter baseSha256 does not match the base ONNX model')
  }

  const byName = new Map(adapter.tensors.map(tensor => [tensor.name, tensor]))
  const applied = new Set<string>()

  const modelFields = readProtoFields(baseOnnxBytes)
  const graphField = modelFields.find(field => field.fieldNumber === 7 && field.wireType === 2)
  if (!graphField) throw new Error('ONNX ModelProto has no graph field')

  const graphBytes = baseOnnxBytes.subarray(graphField.valueStart, graphField.valueEnd)
  const graphFields = readProtoFields(graphBytes)
  const newGraphParts: Uint8Array[] = []

  for (const field of graphFields) {
    if (field.fieldNumber !== 5 || field.wireType !== 2) {
      newGraphParts.push(graphBytes.subarray(field.rawStart, field.rawEnd))
      continue
    }
    const tensorBytes = graphBytes.subarray(field.valueStart, field.valueEnd)
    const parsed = parseTensorProto(tensorBytes)
    const target = byName.get(parsed.info.name)
    if (!target) {
      newGraphParts.push(graphBytes.subarray(field.rawStart, field.rawEnd))
      continue
    }
    if (parsed.info.dataType !== 1 || !parsed.info.values) {
      throw new Error(`ONNX initializer ${parsed.info.name} is not FLOAT (data_type=${parsed.info.dataType})`)
    }
    if (parsed.info.dims.length !== target.dims.length || parsed.info.dims.some((dim, i) => dim !== target.dims[i])) {
      throw new Error(`ONNX initializer ${parsed.info.name} dims [${parsed.info.dims.join(',')}] do not match adapter dims [${target.dims.join(',')}]`)
    }
    const expectedCount = assertDims(parsed.info.dims, `ONNX initializer ${parsed.info.name}`)
    if (parsed.info.values.length !== expectedCount) {
      throw new Error(`ONNX initializer ${parsed.info.name} value count ${parsed.info.values.length} does not match dims product ${expectedCount}`)
    }
    const updatedValues = applyTensorOp(parsed.info.values, target)
    const updatedTensor = rewriteTensorProtoFloat32(tensorBytes, parsed.fields, updatedValues)
    // Field 5 (initializer), wire type 2 => (5 << 3) | 2 = 0x2a.
    newGraphParts.push(Uint8Array.of(0x2a), encodeVarint(updatedTensor.length), updatedTensor)
    applied.add(parsed.info.name)
  }

  for (const name of byName.keys()) {
    if (!applied.has(name)) throw new Error(`Adapter tensor ${name} was not found in the base ONNX graph initializers`)
  }

  const newGraphBytes = concatBytes(newGraphParts)
  const newModelParts: Uint8Array[] = []
  let replacedGraph = false
  for (const field of modelFields) {
    if (!replacedGraph && field.fieldNumber === 7 && field.wireType === 2) {
      // Field 7 (graph), wire type 2 => (7 << 3) | 2 = 0x3a.
      newModelParts.push(Uint8Array.of(0x3a), encodeVarint(newGraphBytes.length), newGraphBytes)
      replacedGraph = true
    } else {
      newModelParts.push(baseOnnxBytes.subarray(field.rawStart, field.rawEnd))
    }
  }
  return concatBytes(newModelParts)
}

/**
 * Verifies a voynich/adapter/v1 adapter against a local ONNX base model file without allocating
 * merged output bytes: checks base SHA-256 and confirms every adapter tensor exists in the base
 * graph initializers as FLOAT with matching dimensions.
 */
export function verifyOnnxAdapterCompatibility(
  baseOnnxBytes: Uint8Array,
  adapterOrBytes: Uint8Array | DecodedAdapter,
  expectedBaseSha256?: string,
): { baseSha256: string; baseSizeBytes: number; matchedTensors: number } {
  const adapter = adapterOrBytes instanceof Uint8Array ? decodeAdapter(adapterOrBytes) : adapterOrBytes
  const actualBaseSha256 = toHex(sha256(baseOnnxBytes))
  if (expectedBaseSha256 !== undefined && expectedBaseSha256.toLowerCase() !== actualBaseSha256) {
    throw new Error('Base ONNX model SHA-256 does not match the expected base hash')
  }
  if (adapter.baseSha256 !== actualBaseSha256) {
    throw new Error('Adapter baseSha256 does not match the base ONNX model')
  }
  const initializers = inspectOnnxInitializers(baseOnnxBytes)
  const byName = new Map(initializers.map(item => [item.name, item]))
  for (const target of adapter.tensors) {
    const found = byName.get(target.name)
    if (!found) {
      throw new Error(`Adapter tensor ${target.name} was not found in the base ONNX graph initializers`)
    }
    if (found.dataType !== 1 || !found.values) {
      throw new Error(`ONNX initializer ${target.name} is not FLOAT (data_type=${found.dataType})`)
    }
    if (found.dims.length !== target.dims.length || found.dims.some((dim, i) => dim !== target.dims[i])) {
      throw new Error(`ONNX initializer ${target.name} dims [${found.dims.join(',')}] do not match adapter dims [${target.dims.join(',')}]`)
    }
  }
  return {
    baseSha256: actualBaseSha256,
    baseSizeBytes: baseOnnxBytes.length,
    matchedTensors: adapter.tensors.length,
  }
}
