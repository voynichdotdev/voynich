// Program ids, Raydium's fixed mainnet accounts, and every PDA a LaunchLab launch touches: its
// own pool and fee vaults, the CPMM pool it graduates into, LP-Lock's Fee Key, Metaplex metadata.
// Seeds are the deployed IDLs'; nothing here reads the chain.

import { PublicKey } from '@solana/web3.js'
import { getAssociatedTokenAddressSync } from '@solana/spl-token'

export const LAUNCHLAB_PROGRAM_ID = new PublicKey('LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj')
export const CPMM_PROGRAM_ID = new PublicKey('CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C')
export const LP_LOCK_PROGRAM_ID = new PublicKey('LockrWmn6K5twhz3y9w1dQERbmgSaRkfnTeTKbpofwE')
export const METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s')
export const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr')

/** Raydium's mainnet accounts that launches meet. */
export const RAYDIUM = {
  /** migrate_to_cpswap_wallet on every mainnet GlobalConfig: the only signer that can graduate a pool. */
  migrationCrank: new PublicKey('RAYpQbFNq9i3mu6cKpTKKRwwHFDeK5AuZz8xvxUrCgw'),
  /** CPMM's pool-creation fee receiver, written by every migration. */
  createPoolFee: new PublicKey('DNXgeM9EiiaAbaWvwjHj9fQQLAX5ZsfHyvmYUNRAdNC8'),
  /** The lookup table mainnet launches compile against. initialize_v2 plus a first buy fits one transaction only over it. */
  lookupTable: new PublicKey('AcL1Vo8oy1ULiavEcjSUcwfBSForXMudcZvDZy5nzJkU'),
}

type Seed = string | PublicKey | Uint8Array
const bytes = (s: Seed) => (typeof s === 'string' ? Buffer.from(s) : s instanceof PublicKey ? s.toBuffer() : Buffer.from(s))
export const pda = (program: PublicKey, ...seeds: Seed[]) => PublicKey.findProgramAddressSync(seeds.map(bytes), program)[0]
const ll = (...seeds: Seed[]) => pda(LAUNCHLAB_PROGRAM_ID, ...seeds)
const cp = (...seeds: Seed[]) => pda(CPMM_PROGRAM_ID, ...seeds)

/** ATA of any owner, PDAs included. */
export const ata = (owner: PublicKey, mint: PublicKey, tokenProgram?: PublicKey) => getAssociatedTokenAddressSync(mint, owner, true, tokenProgram)

// LaunchLab
export const VAULT_AUTHORITY = ll('vault_auth_seed')
export const EVENT_AUTHORITY = ll('__event_authority')
export const PLATFORM_FEE_VAULT_AUTHORITY = ll('platform_fee_vault_auth_seed')
export const CREATOR_FEE_VAULT_AUTHORITY = ll('creator_fee_vault_auth_seed')

/** One GlobalConfig per (quote mint, curve type, index); only Raydium can create them. Every live config is curve type 0, index 0. */
export function globalConfigAddress(quoteMint: PublicKey, curveType = 0, index = 0) {
  const i = Buffer.alloc(2)
  i.writeUInt16LE(index)
  return ll('global_config', quoteMint, Uint8Array.of(curveType), i)
}
/** One platform per admin key: a client that wants a platform per coin gives each coin its own admin. */
export const platformConfigAddress = (admin: PublicKey) => ll('platform_config', admin)
export const poolAddress = (baseMint: PublicKey, quoteMint: PublicKey) => ll('pool', baseMint, quoteMint)
export const poolVaultAddress = (pool: PublicKey, mint: PublicKey) => ll('pool_vault', pool, mint)
/** Where a platform's curve fees accrue, shared by all its pools in one quote mint. No prefix seed. */
export const platformFeeVault = (platformConfig: PublicKey, quoteMint: PublicKey) => ll(platformConfig, quoteMint)
/** Where a creator's curve fees accrue, shared by all its pools in one quote mint. No prefix seed. */
export const creatorFeeVault = (creator: PublicKey, quoteMint: PublicKey) => ll(creator, quoteMint)
export const platformAllowConfigAddress = (platformConfig: PublicKey, globalConfig: PublicKey) => ll('platform_allow_config', platformConfig, globalConfig)
export const platformCurveRuleAddress = (platformConfig: PublicKey, globalConfig: PublicKey) => ll('platform_curve_rule', platformConfig, globalConfig)
export const vestingRecordAddress = (pool: PublicKey, beneficiary: PublicKey) => ll('pool_vesting', pool, beneficiary)
export const metadataAddress = (mint: PublicKey) => pda(METADATA_PROGRAM_ID, 'metadata', METADATA_PROGRAM_ID, mint)

// LP-Lock
export const LOCK_AUTHORITY = pda(LP_LOCK_PROGRAM_ID, 'lock_cp_authority_seed')
export const lockedLiquidityAddress = (feeNftMint: PublicKey) => pda(LP_LOCK_PROGRAM_ID, 'locked_liquidity', feeNftMint)

// CPMM
export const CPMM_AUTHORITY = cp('vault_and_lp_mint_auth_seed')
/** LaunchLab's permission to create CPMM pools: InitializeWithPermission checks it on every migration. */
export const CPMM_LAUNCHLAB_PERMISSION = cp('permission', VAULT_AUTHORITY)
export const cpmmSupportMint = (mint: PublicKey) => cp('support_mint', mint)
export const creatorFeeShareAddress = (creator: PublicKey, ammConfig: PublicKey) => cp('creator_fee_share', creator, ammConfig)

/** CPMM orders a pool's mints by their bytes; token 0 is the smaller. */
export const sortMints = (a: PublicKey, b: PublicKey): [PublicKey, PublicKey] => (Buffer.compare(a.toBuffer(), b.toBuffer()) < 0 ? [a, b] : [b, a])

/**
 * The canonical CPMM pool for a config and two mints, with its derived accounts. A pool made from a
 * keypair (any third party can make one) has another address: read a migrated pool's address
 * from its migration, never infer it from the mints.
 */
export function cpmmPoolAddresses(ammConfig: PublicKey, mintA: PublicKey, mintB: PublicKey, pool?: PublicKey) {
  const [mint0, mint1] = sortMints(mintA, mintB)
  const address = pool ?? cp('pool', ammConfig, mint0, mint1)
  const lpMint = cp('pool_lp_mint', address)
  return {
    pool: address, ammConfig, mint0, mint1, lpMint,
    vault0: cp('pool_vault', address, mint0),
    vault1: cp('pool_vault', address, mint1),
    vaultFor: (mint: PublicKey) => cp('pool_vault', address, mint),
    observation: cp('observation', address),
    lockedLpVault: ata(LOCK_AUTHORITY, lpMint),
  }
}
