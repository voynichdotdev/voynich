// The amounts inside Jupiter's route instructions, read and rewritten at their fixed offsets per
// instruction. Never search the data for an amount's bytes: a route plan can carry the same
// bytes, and the v1 layouts put the amounts after a variable-length plan.

import { JupiterError } from './http.js'

export type RouteName = 'route' | 'shared_accounts_route' | 'route_v2' | 'shared_accounts_route_v2'

export type RouteArgs = {
  name: RouteName
  inAmount: bigint
  quotedOutAmount: bigint
  slippageBps: number
  platformFeeBps: number
  /** route_v2 only; 0 in the v1 layouts */
  positiveSlippageBps: number
}

// Anchor discriminators (sha256("global:<name>")[..8]) and where each layout keeps its amounts.
// v1: (route_plan, in_amount u64, quoted_out u64, slippage u16, platform_fee u8) at the tail.
// v2: (in_amount u64, quoted_out u64, slippage u16, platform_fee u16, positive_slippage u16, route_plan)
// right after the discriminator, or after the shared variants' one-byte id.
const LAYOUTS: { name: RouteName; tag: number[]; at: (length: number) => number; v2: boolean }[] = [
  { name: 'route', tag: [229, 23, 203, 151, 122, 227, 173, 42], at: (n) => n - 19, v2: false },
  { name: 'shared_accounts_route', tag: [193, 32, 155, 51, 65, 214, 156, 129], at: (n) => n - 19, v2: false },
  { name: 'route_v2', tag: [187, 100, 250, 204, 49, 196, 175, 20], at: () => 8, v2: true },
  { name: 'shared_accounts_route_v2', tag: [209, 152, 83, 147, 124, 254, 216, 233], at: () => 9, v2: true },
]

function locate(data: Uint8Array) {
  const layout = LAYOUTS.find((l) => l.tag.every((b, i) => data[i] === b))
  if (!layout) throw new JupiterError('MISMATCH', 'Jupiter returned a route instruction this app does not read (exact-in routes only).')
  const at = layout.at(data.length)
  if (at < 8 || data.length < at + (layout.v2 ? 22 : 19)) throw new JupiterError('INVALID_RESPONSE', 'Jupiter returned truncated route data.', true)
  return { layout, at, view: new DataView(data.buffer, data.byteOffset, data.byteLength) }
}

export function readRouteArgs(data: Uint8Array): RouteArgs {
  const { layout, at, view } = locate(data)
  return {
    name: layout.name,
    inAmount: view.getBigUint64(at, true),
    quotedOutAmount: view.getBigUint64(at + 8, true),
    slippageBps: view.getUint16(at + 16, true),
    platformFeeBps: layout.v2 ? view.getUint16(at + 18, true) : view.getUint8(at + 18),
    positiveSlippageBps: layout.v2 ? view.getUint16(at + 20, true) : 0,
  }
}

/** A copy of `data` with new amounts: for stretching a captured route over a different size. */
export function writeRouteArgs(data: Uint8Array, args: { inAmount: bigint; quotedOutAmount: bigint; slippageBps: number }): Buffer {
  const out = Buffer.from(data)
  const { at, view } = locate(out)
  view.setBigUint64(at, args.inAmount, true)
  view.setBigUint64(at + 8, args.quotedOutAmount, true)
  view.setUint16(at + 16, args.slippageBps, true)
  return out
}
