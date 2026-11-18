// Dynamic Bonding Curve trades: pool snapshots, exact quotes from the SDK's own swap math, and
// swap instructions. Reads the chain; never signs, sends or scans program accounts.

import { type Commitment, type Connection, type PublicKey, type TransactionInstruction } from '@solana/web3.js'
import { DynamicBondingCurveClient, SwapMode, getTokenProgram, type PoolConfig, type SwapQuote2Result, type VirtualPool } from '@meteora-ag/dynamic-bonding-curve-sdk'
import { ownedBy, withTokenAccounts, withoutComputeBudget, type MintRef } from './instructions.js'
import { U64_MAX, big, bn, checkSlippage } from './math.js'
import { curveComplete, quoteMath, tooSmall } from './quote-error.js'

export type Side = 'buy' | 'sell'
export type DbcSnapshot = { pool: VirtualPool; config: PoolConfig }

export type DbcQuote = {
  pool: PublicKey
  side: Side
  /** what leaves the trader: for a buy that fills the curve, less than asked */
  amountIn: bigint
  amountOut: bigint
  minimumOut: bigint
  fee: bigint
  feeMint: PublicKey
  inputMint: PublicKey
  outputMint: PublicKey
  nextSqrtPrice: bigint
  /** buys: the input, fees included, that takes the curve to its migration price */
  amountToFill?: bigint
  /** buys: this trade reaches the migration price */
  fillsCurve?: boolean
  raw: SwapQuote2Result
}

export type Dbc = ReturnType<typeof createDbc>

export function createDbc(connection: Connection, commitment: Commitment = 'confirmed') {
  const client = new DynamicBondingCurveClient(connection, commitment)
  // A config never changes once created: read each one once.
  const configs = new Map<string, Promise<PoolConfig>>()

  const config = (address: PublicKey) => {
    const key = address.toBase58()
    let pending = configs.get(key)
    if (!pending) {
      pending = client.state.getPoolConfig(address).then((c) => {
        if (!c) throw new Error(`DBC config ${key} does not exist.`)
        return c
      })
      pending.catch(() => configs.delete(key))
      configs.set(key, pending)
    }
    return pending
  }

  async function snapshot(pool: PublicKey): Promise<DbcSnapshot> {
    const state = await client.state.getPool(pool)
    if (!state) throw new Error(`DBC pool ${pool.toBase58()} does not exist.`)
    return { pool: state, config: await config(state.poolState.config) }
  }

  /** The point fee schedules read: the slot, or unix seconds, per the config's activation type. */
  async function currentPoint(snap: DbcSnapshot): Promise<bigint> {
    return snap.config.activationType === 0 ? BigInt(await connection.getSlot(commitment)) : BigInt(Math.floor(Date.now() / 1000))
  }

  /** Buys spend at most `amountIn` (a partial fill stops at the migration price); sells are exact in. */
  async function quote(args: { pool: PublicKey; side: Side; amountIn: bigint; slippageBps: number; snapshot?: DbcSnapshot; currentPoint?: bigint }): Promise<DbcQuote> {
    checkSlippage(args.slippageBps)
    const snap = args.snapshot ?? (await snapshot(args.pool))
    const { pool, config: cfg } = snap
    if (pool.poolState.isMigrated || pool.poolState.quoteReserve.gte(cfg.migrationQuoteThreshold)) throw curveComplete()
    const point = bn(args.currentPoint ?? (await currentPoint(snap)))
    const buy = args.side === 'buy'
    const calculate = (amountIn: bigint) =>
      quoteMath(() =>
        client.pool.swapQuote2({
          virtualPool: pool,
          config: cfg,
          swapBaseForQuote: !buy,
          swapMode: buy ? SwapMode.PartialFill : SwapMode.ExactIn,
          amountIn: bn(amountIn),
          slippageBps: args.slippageBps,
          hasReferral: false,
          eligibleForFirstSwapWithMinFee: false,
          currentPoint: point,
        }),
      )
    const raw = calculate(args.amountIn)
    const amountOut = big(raw.outputAmount)
    const minimumOut = raw.minimumAmountOut ? big(raw.minimumAmountOut) : 0n
    if (amountOut <= 0n || minimumOut <= 0n) throw tooSmall()
    // The same partial-fill math asked for the largest u64 answers with the whole input that
    // fills the curve, DBC's own fee rounding included, without guessing a cap.
    const terminal = buy ? calculate(U64_MAX) : null
    const [inputMint, outputMint] = buy ? [cfg.quoteMint, pool.poolState.baseMint] : [pool.poolState.baseMint, cfg.quoteMint]
    return {
      pool: args.pool,
      side: args.side,
      amountIn: big(raw.includedTransferFeeAmountIn),
      amountOut,
      minimumOut,
      fee: big(raw.tradingFee.add(raw.protocolFee).add(raw.referralFee)),
      feeMint: cfg.collectFeeMode === 0 ? cfg.quoteMint : outputMint,
      inputMint,
      outputMint,
      nextSqrtPrice: big(raw.nextSqrtPrice),
      ...(terminal ? { amountToFill: big(terminal.includedTransferFeeAmountIn), fillsCurve: raw.nextSqrtPrice.gte(cfg.migrationSqrtPrice) } : {}),
      raw,
    }
  }

  /**
   * The swap for `owner`, opening both token accounts first. The SDK's own cleanup closes the
   * WSOL account in the same transaction, which also returns input a partial fill left unused.
   */
  async function swap(args: { owner: PublicKey; payer?: PublicKey; pool: PublicKey; side: Side; amountIn: bigint; minimumOut: bigint; snapshot?: DbcSnapshot }): Promise<TransactionInstruction[]> {
    const snap = args.snapshot ?? (await snapshot(args.pool))
    const payer = args.payer ?? args.owner
    const tx = await client.pool.swap2({
      owner: args.owner,
      payer,
      pool: args.pool,
      swapBaseForQuote: args.side === 'sell',
      swapMode: args.side === 'buy' ? SwapMode.PartialFill : SwapMode.ExactIn,
      amountIn: bn(args.amountIn),
      minimumAmountOut: bn(args.minimumOut),
      referralTokenAccount: null,
    })
    return withTokenAccounts(withoutComputeBudget(tx.instructions), payer, ownedBy(args.owner, dbcMints(snap)))
  }

  return { client, connection, snapshot, config, currentPoint, quote, swap }
}

/** The pool's quote and base mints with their token programs. */
export const dbcMints = ({ pool, config }: DbcSnapshot): MintRef[] => [
  { mint: config.quoteMint, program: getTokenProgram(config.quoteTokenFlag) },
  { mint: pool.poolState.baseMint, program: getTokenProgram(config.tokenType) },
]
