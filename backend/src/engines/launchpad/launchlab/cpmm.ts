// The Raydium CPMM pool a LaunchLab coin graduates into: its AmmConfig, PoolState and creator
// fee share decoded by offset, swaps in both directions, and both creator-fee collects. Hand
// encoded: the public CPMM IDL predates the permissionless collect and the share rate field.

import { SystemProgram, TransactionInstruction, PublicKey, type AccountInfo, type AccountMeta } from '@solana/web3.js'
import { ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { CPMM_AUTHORITY, CPMM_PROGRAM_ID, ata, creatorFeeShareAddress } from './addresses.js'
import { creatorFeeOnInput, type CpmmRates } from '../curve/cpmm.js'

const DISCRIMINATOR = {
  ammConfig: [218, 244, 33, 104, 203, 203, 43, 111],
  poolState: [247, 237, 227, 245, 215, 195, 222, 70],
  creatorFeeShare: [30, 235, 98, 252, 26, 197, 66, 86],
  swapBaseInput: [143, 190, 90, 218, 196, 30, 51, 222],
  swapBaseOutput: [55, 217, 98, 86, 163, 74, 180, 173],
  collectCreatorFee: [20, 22, 86, 123, 198, 28, 219, 132],
  collectCreatorFeePermissionless: [202, 202, 34, 83, 226, 122, 145, 229],
}

type Info = Pick<AccountInfo<Buffer>, 'owner' | 'data'>
const checked = (info: Info | null | undefined, tag: number[], size: number, what: string) => {
  if (!info || !info.owner.equals(CPMM_PROGRAM_ID) || info.data.length < size || !info.data.subarray(0, 8).equals(Buffer.from(tag))) throw new Error(`not a CPMM ${what}`)
  return info.data
}
const key = (d: Buffer, o: number) => new PublicKey(d.subarray(o, o + 32))
const u64 = (d: Buffer, o: number) => d.readBigUInt64LE(o)

export type AmmConfig = { tradeFeeRate: bigint; protocolFeeRate: bigint; fundFeeRate: bigint; createPoolFee: bigint; creatorFeeRate: bigint; creatorFeeShareRate: bigint; disableCreatePool: boolean; index: number }

/** creator_fee_share_rate sits in the first word of what the public IDL still calls padding. Only Raydium can change it. */
export function decodeAmmConfig(info: Info | null | undefined): AmmConfig {
  const d = checked(info, DISCRIMINATOR.ammConfig, 124, 'AmmConfig')
  return { disableCreatePool: d[9] !== 0, index: d.readUInt16LE(10), tradeFeeRate: u64(d, 12), protocolFeeRate: u64(d, 20), fundFeeRate: u64(d, 28), createPoolFee: u64(d, 36), creatorFeeRate: u64(d, 108), creatorFeeShareRate: u64(d, 116) }
}

export type CpmmPool = {
  address: PublicKey; ammConfig: PublicKey; poolCreator: PublicKey; vault0: PublicKey; vault1: PublicKey; lpMint: PublicKey
  mint0: PublicKey; mint1: PublicKey; tokenProgram0: PublicKey; tokenProgram1: PublicKey; observation: PublicKey
  /** Bit flags: 1 deposit off, 2 withdraw off, 4 swap off. */
  status: number
  decimals0: number; decimals1: number; lpSupply: bigint; openTime: bigint
  protocolFees0: bigint; protocolFees1: bigint; fundFees0: bigint; fundFees1: bigint; creatorFees0: bigint; creatorFees1: bigint
  /** 0 both tokens, 1 token 0 only, 2 token 1 only. */
  creatorFeeOn: number
  creatorFeeEnabled: boolean
}

export function decodeCpmmPool(address: PublicKey, info: Info | null | undefined): CpmmPool {
  const d = checked(info, DISCRIMINATOR.poolState, 413, 'PoolState')
  return {
    address, ammConfig: key(d, 8), poolCreator: key(d, 40), vault0: key(d, 72), vault1: key(d, 104), lpMint: key(d, 136),
    mint0: key(d, 168), mint1: key(d, 200), tokenProgram0: key(d, 232), tokenProgram1: key(d, 264), observation: key(d, 296),
    status: d[329]!, decimals0: d[331]!, decimals1: d[332]!, lpSupply: u64(d, 333),
    protocolFees0: u64(d, 341), protocolFees1: u64(d, 349), fundFees0: u64(d, 357), fundFees1: u64(d, 365), openTime: u64(d, 373),
    creatorFeeOn: d[389]!, creatorFeeEnabled: d[390] !== 0, creatorFees0: u64(d, 397), creatorFees1: u64(d, 405),
  }
}

/**
 * The share of a creator-fee collect Raydium keeps: the creator's own CreatorFeeShare account when
 * Raydium set one (few creators have it), else the AmmConfig's rate. A missing, empty or foreign
 * account means the config's rate, as CPMM itself resolves it.
 */
export function creatorFeeShareRate(config: AmmConfig, share: Info | null | undefined, creator: PublicKey, ammConfig: PublicKey): bigint {
  if (!share || share.data.length === 0 || !share.owner.equals(CPMM_PROGRAM_ID)) return config.creatorFeeShareRate
  const d = checked(share, DISCRIMINATOR.creatorFeeShare, 81, 'CreatorFeeShare')
  if (!key(d, 9).equals(creator) || !key(d, 41).equals(ammConfig)) throw new Error('CreatorFeeShare belongs to another creator or config')
  return u64(d, 73)
}

/** The rates a swap on this pool pays; the creator rate is zero while the pool's creator fee is off. */
export const cpmmRates = (pool: CpmmPool, config: AmmConfig): CpmmRates => ({
  trade: config.tradeFeeRate, protocol: config.protocolFeeRate, fund: config.fundFeeRate, creator: pool.creatorFeeEnabled ? config.creatorFeeRate : 0n,
})

const meta = (pubkey: PublicKey, isWritable = false, isSigner = false): AccountMeta => ({ pubkey, isWritable, isSigner })
const data = (tag: number[], ...values: bigint[]) => {
  const out = Buffer.alloc(8 + 8 * values.length)
  Buffer.from(tag).copy(out)
  values.forEach((v, i) => out.writeBigUInt64LE(v, 8 + 8 * i))
  return out
}

export type CpmmSwapInput = {
  payer: PublicKey
  pool: CpmmPool
  inputMint: PublicKey
  amount: { exactIn: bigint; minimumOut: bigint } | { exactOut: bigint; maximumIn: bigint }
}

/** swap_base_input / swap_base_output from the payer's ATAs. The payer signs but is not written. */
export function cpmmSwapInstruction(input: CpmmSwapInput): TransactionInstruction {
  const { pool, payer } = input
  const zeroIn = input.inputMint.equals(pool.mint0)
  if (!zeroIn && !input.inputMint.equals(pool.mint1)) throw new Error('the input mint is not in this pool')
  const [inMint, outMint] = zeroIn ? [pool.mint0, pool.mint1] : [pool.mint1, pool.mint0]
  const [inProgram, outProgram] = zeroIn ? [pool.tokenProgram0, pool.tokenProgram1] : [pool.tokenProgram1, pool.tokenProgram0]
  const keys = [
    meta(payer, false, true), meta(CPMM_AUTHORITY), meta(pool.ammConfig), meta(pool.address, true),
    meta(ata(payer, inMint, inProgram), true), meta(ata(payer, outMint, outProgram), true),
    meta(zeroIn ? pool.vault0 : pool.vault1, true), meta(zeroIn ? pool.vault1 : pool.vault0, true),
    meta(inProgram), meta(outProgram), meta(inMint), meta(outMint), meta(pool.observation, true),
  ]
  const body = 'exactIn' in input.amount
    ? data(DISCRIMINATOR.swapBaseInput, input.amount.exactIn, input.amount.minimumOut)
    : data(DISCRIMINATOR.swapBaseOutput, input.amount.maximumIn, input.amount.exactOut)
  return new TransactionInstruction({ programId: CPMM_PROGRAM_ID, keys, data: body })
}

/** Whether a swap from `inputMint` pays this pool's creator fee out of its input. */
export const swapPaysCreatorFeeOnInput = (pool: CpmmPool, inputMint: PublicKey) => creatorFeeOnInput(pool.creatorFeeOn, inputMint.equals(pool.mint0))

const creatorFeeAccounts = (pool: CpmmPool) => ({
  token0: ata(pool.poolCreator, pool.mint0, pool.tokenProgram0),
  token1: ata(pool.poolCreator, pool.mint1, pool.tokenProgram1),
  share: creatorFeeShareAddress(pool.poolCreator, pool.ammConfig),
})

/**
 * collect_creator_fee_permissionless: anyone pays, the pool creator's ATAs receive (opened if
 * missing). It fails on an empty bucket, so send it only when creatorFees0 or creatorFees1 is nonzero.
 */
export function collectCreatorFeePermissionlessInstruction(payer: PublicKey, pool: CpmmPool) {
  const a = creatorFeeAccounts(pool)
  return new TransactionInstruction({
    programId: CPMM_PROGRAM_ID, data: data(DISCRIMINATOR.collectCreatorFeePermissionless),
    keys: [
      meta(payer, true, true), meta(pool.poolCreator), meta(CPMM_AUTHORITY), meta(pool.address, true), meta(pool.vault0, true), meta(pool.vault1, true),
      meta(pool.mint0), meta(pool.mint1), meta(a.token0, true), meta(a.token1, true), meta(pool.tokenProgram0), meta(pool.tokenProgram1),
      meta(ASSOCIATED_TOKEN_PROGRAM_ID), meta(SystemProgram.programId), meta(pool.ammConfig), meta(a.share),
    ],
  })
}

/** collect_creator_fee, signed by the pool creator. The deployed program takes the creator_fee_share account last, one more than the public IDL lists. */
export function collectCreatorFeeInstruction(pool: CpmmPool) {
  const a = creatorFeeAccounts(pool)
  return new TransactionInstruction({
    programId: CPMM_PROGRAM_ID, data: data(DISCRIMINATOR.collectCreatorFee),
    keys: [
      meta(pool.poolCreator, true, true), meta(CPMM_AUTHORITY), meta(pool.address, true), meta(pool.ammConfig), meta(pool.vault0, true), meta(pool.vault1, true),
      meta(pool.mint0), meta(pool.mint1), meta(a.token0, true), meta(a.token1, true), meta(pool.tokenProgram0), meta(pool.tokenProgram1),
      meta(ASSOCIATED_TOKEN_PROGRAM_ID), meta(SystemProgram.programId), meta(a.share),
    ],
  })
}
