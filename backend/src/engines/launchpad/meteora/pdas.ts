// Meteora's program ids and the addresses a DBC launch and its DAMM v2 graduation use, derived
// with the SDKs' own seeds.

import { PublicKey } from '@solana/web3.js'
import {
  DAMM_V2_MIGRATION_FEE_ADDRESS,
  DAMM_V2_PROGRAM_ID,
  DYNAMIC_BONDING_CURVE_PROGRAM_ID,
  METAPLEX_PROGRAM_ID,
  deriveDammV2PoolAddress,
  deriveDbcEventAuthority,
  deriveDbcPoolAddress,
  deriveDbcPoolAuthority,
  deriveDbcTokenVaultAddress,
  type PoolConfig,
} from '@meteora-ag/dynamic-bonding-curve-sdk'

export { DAMM_V2_PROGRAM_ID, METAPLEX_PROGRAM_ID }
export const DBC_PROGRAM_ID = DYNAMIC_BONDING_CURVE_PROGRAM_ID

export const mintMetadata = (mint: PublicKey) =>
  PublicKey.findProgramAddressSync([Buffer.from('metadata'), METAPLEX_PROGRAM_ID.toBuffer(), mint.toBuffer()], METAPLEX_PROGRAM_ID)[0]

/**
 * The accounts initialize_virtual_pool creates or checks for `baseMint` under `config`. The pool
 * authority is also the flash-rent lender DBC borrows migration rent from.
 */
export function dbcLaunchAddresses(config: PublicKey, baseMint: PublicKey, quoteMint: PublicKey) {
  const pool = deriveDbcPoolAddress(quoteMint, baseMint, config)
  return {
    pool,
    baseVault: deriveDbcTokenVaultAddress(pool, baseMint),
    quoteVault: deriveDbcTokenVaultAddress(pool, quoteMint),
    metadata: mintMetadata(baseMint),
    poolAuthority: deriveDbcPoolAuthority(),
    eventAuthority: deriveDbcEventAuthority(),
  }
}

/** The DAMM v2 pool a DBC pool graduates into under `dammConfig`. */
export const graduatedPool = (dammConfig: PublicKey, baseMint: PublicKey, quoteMint: PublicKey) => deriveDammV2PoolAddress(dammConfig, baseMint, quoteMint)

/** The DAMM v2 config a curve migrates under, picked by its migration fee option (FixedBps100 → the 1% config). */
export function dammConfigFor(config: Pick<PoolConfig, 'migrationFeeOption'>): PublicKey {
  const address = DAMM_V2_MIGRATION_FEE_ADDRESS[config.migrationFeeOption]
  if (!address) throw new Error(`No DAMM v2 config for migration fee option ${config.migrationFeeOption}.`)
  return address
}
