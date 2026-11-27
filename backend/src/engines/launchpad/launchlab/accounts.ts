// LaunchLab's accounts as typed values: GlobalConfig, PlatformConfig, PoolState, the platform's
// allow config and curve rule. Decoders check the owner and discriminator; readers fetch and
// decode; and two adapters hand a pool to the curve engine's quotes.

import { PublicKey, type AccountInfo, type Commitment, type Connection } from '@solana/web3.js'
import { LAUNCHLAB_PROGRAM_ID } from './addresses.js'
import { decodeLaunchlabAccount } from './codec.js'
import type { CurveFeeRates, CurveState } from '../curve/launchlab.js'

export type GlobalConfig = {
  epoch: bigint; curveType: number; index: number; migrateFee: bigint; tradeFeeRate: bigint
  maxShareFeeRate: bigint; minBaseSupply: bigint; maxLockRate: bigint; minBaseSellRate: bigint
  minBaseMigrateRate: bigint; minQuoteFundRaising: bigint; quoteMint: PublicKey
  protocolFeeOwner: PublicKey; migrateFeeOwner: PublicKey; migrateToAmmWallet: PublicKey
  /** The only signer migrate_to_cpswap accepts. */
  migrateToCpswapWallet: PublicKey
}

export type PlatformConfig = {
  epoch: bigint; platformFeeWallet: PublicKey; platformNftWallet: PublicKey
  /** Shares of the migrated LP, out of 1,000,000: locked to the platform's Fee Key, creator (must be 0), burned. */
  platformScale: bigint; creatorScale: bigint; burnScale: bigint
  feeRate: bigint; name: string; web: string; img: string
  /** The CPMM AmmConfig (fee tier) pools on this platform graduate into. */
  cpswapConfig: PublicKey; creatorFeeRate: bigint; transferFeeExtensionAuth: PublicKey
  platformVestingWallet: PublicKey; platformVestingScale: bigint
  /** The graduated pool's CPMM creator; the default key means "the launch creator". */
  platformCpCreator: PublicKey
  restrictGlobalConfig: number; restrictCurveParam: number; curveRuleManager: PublicKey
}

/** 0 Fund (trading on the curve), 1 Migrate (sold out, waiting for the crank), 2 Trade (graduated). */
export type PoolStatus = 0 | 1 | 2

export type PoolState = {
  address: PublicKey
  epoch: bigint; authBump: number; status: PoolStatus; baseDecimals: number; quoteDecimals: number; migrateType: number
  supply: bigint; totalBaseSell: bigint; virtualBase: bigint; virtualQuote: bigint
  /** Tokens sold off the curve, not the base vault's balance. */
  realBase: bigint
  realQuote: bigint; totalQuoteFundRaising: bigint; quoteProtocolFee: bigint; platformFee: bigint; migrateFee: bigint
  vestingSchedule: { totalLockedAmount: bigint; cliffPeriod: bigint; unlockPeriod: bigint; startTime: bigint; allocatedShareAmount: bigint }
  globalConfig: PublicKey; platformConfig: PublicKey; baseMint: PublicKey; quoteMint: PublicKey
  baseVault: PublicKey; quoteVault: PublicKey; creator: PublicKey
  /** bit 0: base mint is Token-2022, bit 1: quote mint is Token-2022. */
  tokenProgramFlag: number
  ammCreatorFeeOn: 'quoteToken' | 'bothToken'
  platformVestingShare: bigint
}

export type ParamConstraint = { field: number; op: number; value: bigint }
export type PlatformCurveRule = {
  bump: number; version: number; platformConfig: PublicKey; globalConfig: PublicKey; epoch: bigint
  groups: { groupId: number; epoch: bigint; constraints: ParamConstraint[] }[]
}
export type PlatformAllowConfig = { bump: number; platformConfig: PublicKey; globalConfig: PublicKey }

type Info = Pick<AccountInfo<Buffer>, 'owner' | 'data'>
const owned = (info: Info | null | undefined, what: string): Buffer => {
  if (!info) throw new Error(`${what} does not exist`)
  if (!info.owner.equals(LAUNCHLAB_PROGRAM_ID)) throw new Error(`${what} is not owned by LaunchLab`)
  return info.data
}
const text = (bytes: number[]) => Buffer.from(bytes).toString('utf8').replace(/\0+$/, '')

export const decodeGlobalConfig = (info: Info | null | undefined) => decodeLaunchlabAccount<GlobalConfig>('GlobalConfig', owned(info, 'GlobalConfig'))

export function decodePlatformConfig(info: Info | null | undefined): PlatformConfig {
  const raw = decodeLaunchlabAccount<Omit<PlatformConfig, 'name' | 'web' | 'img'> & { name: number[]; web: number[]; img: number[] }>('PlatformConfig', owned(info, 'PlatformConfig'))
  return { ...raw, name: text(raw.name), web: text(raw.web), img: text(raw.img) }
}

export function decodePoolState(address: PublicKey, info: Info | null | undefined): PoolState {
  return { ...decodeLaunchlabAccount<Omit<PoolState, 'address'>>('PoolState', owned(info, 'PoolState')), address }
}

export const decodePlatformCurveRule = (info: Info | null | undefined) => decodeLaunchlabAccount<PlatformCurveRule>('PlatformCurveRule', owned(info, 'PlatformCurveRule'))
export const decodePlatformAllowConfig = (info: Info | null | undefined) => decodeLaunchlabAccount<PlatformAllowConfig>('PlatformAllowConfig', owned(info, 'PlatformAllowConfig'))

const get = (c: Connection, a: PublicKey, commitment: Commitment) => c.getAccountInfo(a, commitment)
export const readGlobalConfig = async (c: Connection, a: PublicKey, commitment: Commitment = 'confirmed') => decodeGlobalConfig(await get(c, a, commitment))
export const readPlatformConfig = async (c: Connection, a: PublicKey, commitment: Commitment = 'confirmed') => decodePlatformConfig(await get(c, a, commitment))
export const readPoolState = async (c: Connection, a: PublicKey, commitment: Commitment = 'confirmed') => decodePoolState(a, await get(c, a, commitment))

/** The pool as the curve engine reads it. */
export const curveState = (p: PoolState): CurveState => ({
  virtualBase: p.virtualBase, virtualQuote: p.virtualQuote, realBase: p.realBase, realQuote: p.realQuote, totalBaseSell: p.totalBaseSell,
})

/** The fee rates a trade on this pool pays: Raydium's from the GlobalConfig, the platform's and creator's from the PlatformConfig. */
export const curveFeeRates = (g: Pick<GlobalConfig, 'tradeFeeRate'>, p: Pick<PlatformConfig, 'feeRate' | 'creatorFeeRate'>, shareFeeRate = 0n): CurveFeeRates => ({
  protocol: g.tradeFeeRate, platform: p.feeRate, creator: p.creatorFeeRate, share: shareFeeRate,
})
