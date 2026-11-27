// Graduation: migrate_to_cpswap moves a sold-out curve into a CPMM pool and locks the platform's
// LP share into a Fee Key. Only GlobalConfig.migrate_to_cpswap_wallet can sign it (Raydium's crank
// on mainnet) and no SDK builds it, so this builder serves localnet cranks, simulations and
// indexers reading a migration back. Account order and flags follow mainnet's crank.

import { SYSVAR_RENT_PUBKEY, SystemProgram, type AccountMeta, type Connection, type PublicKey, type TransactionInstruction, type VersionedTransactionResponse } from '@solana/web3.js'
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import {
  CPMM_AUTHORITY, CPMM_LAUNCHLAB_PERMISSION, CPMM_PROGRAM_ID, LAUNCHLAB_PROGRAM_ID, LOCK_AUTHORITY, LP_LOCK_PROGRAM_ID, METADATA_PROGRAM_ID,
  RAYDIUM, VAULT_AUTHORITY, ata, cpmmPoolAddresses, cpmmSupportMint, lockedLiquidityAddress, metadataAddress,
} from './addresses.js'
import { launchlabInstruction } from './codec.js'
import { fromBase58 } from '../../core/encoding.js'
import type { GlobalConfig, PlatformConfig, PoolState } from './accounts.js'

export type MigrationInput = {
  /** GlobalConfig.migrate_to_cpswap_wallet. */
  payer: PublicKey
  pool: Pick<PoolState, 'address' | 'baseMint' | 'quoteMint' | 'globalConfig' | 'platformConfig' | 'baseVault' | 'quoteVault' | 'creator'>
  platform: Pick<PlatformConfig, 'cpswapConfig' | 'platformNftWallet' | 'platformCpCreator'>
  /** A fresh keypair's key: the Fee Key NFT mint. It co-signs. */
  feeNftMint: PublicKey
  /** Leave unset for the canonical pool PDA. A keypair pool must sign as well. */
  cpmmPool?: PublicKey
}

/** The CPMM pool the migration creates, and its accounts. */
export const migrationPool = (input: Pick<MigrationInput, 'pool' | 'platform' | 'cpmmPool'>) =>
  cpmmPoolAddresses(input.platform.cpswapConfig, input.pool.baseMint, input.pool.quoteMint, input.cpmmPool)

/**
 * migrate_to_cpswap: the IDL's 28 accounts, then ten more in this order: platform nft wallet [w],
 * Fee Key mint [w, signer], its ATA for the nft wallet [w], LP-Lock ["locked_liquidity", mint] [w],
 * the mint's metadata [w], the pool creator [w], LaunchLab's CPMM permission PDA, platform_cp_creator
 * (the default key when unset), and the CPMM support_mint PDAs of the two mints in CPMM's sorted
 * order, not LaunchLab's base/quote order. Writable flags are mainnet's crank's on every captured
 * migration; the crank also marks global_config writable, which the IDL does not need. A platform
 * that burns all LP still passes all ten.
 */
export function migrateToCpswapInstruction(input: MigrationInput): TransactionInstruction {
  const { pool, platform } = input
  const cp = migrationPool(input)
  const canonical = cpmmPoolAddresses(platform.cpswapConfig, pool.baseMint, pool.quoteMint).pool
  const m = (pubkey: PublicKey, isWritable = false, isSigner = false): AccountMeta => ({ pubkey, isWritable, isSigner })
  const ix = launchlabInstruction('migrate_to_cpswap', {}, {
    payer: input.payer, base_mint: pool.baseMint, quote_mint: pool.quoteMint, platform_config: pool.platformConfig,
    cpswap_pool: cp.pool, cpswap_authority: CPMM_AUTHORITY, cpswap_lp_mint: cp.lpMint,
    cpswap_base_vault: cp.vaultFor(pool.baseMint), cpswap_quote_vault: cp.vaultFor(pool.quoteMint),
    cpswap_config: platform.cpswapConfig, cpswap_create_pool_fee: RAYDIUM.createPoolFee, cpswap_observation: cp.observation,
    lock_authority: LOCK_AUTHORITY, lock_lp_vault: cp.lockedLpVault, authority: VAULT_AUTHORITY, pool_state: pool.address,
    global_config: pool.globalConfig, base_vault: pool.baseVault, quote_vault: pool.quoteVault, pool_lp_token: ata(VAULT_AUTHORITY, cp.lpMint),
  }, [
    m(platform.platformNftWallet, true), m(input.feeNftMint, true, true), m(ata(platform.platformNftWallet, input.feeNftMint, TOKEN_PROGRAM_ID), true),
    m(lockedLiquidityAddress(input.feeNftMint), true), m(metadataAddress(input.feeNftMint), true), m(pool.creator, true),
    m(CPMM_LAUNCHLAB_PERMISSION), m(platform.platformCpCreator), m(cpmmSupportMint(cp.mint0)), m(cpmmSupportMint(cp.mint1)),
  ])
  if (!cp.pool.equals(canonical)) ix.keys[5]!.isSigner = true
  return ix
}

/** The graduated pool's CPMM creator: platform_cp_creator when the platform set one, else the launch creator. */
export const cpmmCreatorOf = (platform: Pick<PlatformConfig, 'platformCpCreator'>, pool: Pick<PoolState, 'creator'>) =>
  platform.platformCpCreator.equals(SystemProgram.programId) ? pool.creator : platform.platformCpCreator

/**
 * Why a migration would be refused, before simulating it. GlobalConfig pins the crank: every
 * mainnet config names Raydium's, so a local crank runs only on a clone whose GlobalConfig has
 * migrate_to_cpswap_wallet (bytes 211..243) rewritten to its key.
 */
export function migrationProblems(input: { payer: PublicKey; pool: PoolState; global: GlobalConfig; platform: PlatformConfig }): string[] {
  const { pool, global, platform } = input
  const problems: string[] = []
  if (pool.status !== 1) problems.push(`pool status is ${pool.status}; migration needs 1 (sold out, waiting)`)
  if (pool.migrateType !== 1) problems.push('pool does not migrate to CPMM (migrate_type is not 1)')
  if (!global.migrateToCpswapWallet.equals(input.payer)) problems.push(`GlobalConfig only lets ${global.migrateToCpswapWallet.toBase58()} migrate`)
  if (!global.quoteMint.equals(pool.quoteMint)) problems.push('pool quote mint differs from its GlobalConfig')
  if (platform.platformScale + platform.creatorScale + platform.burnScale !== 1_000_000n) problems.push('platform LP scales do not add up to 1,000,000')
  return problems
}

const REQUIRED: [number, string][] = [
  [0, 'migration payer'], [1, 'base mint'], [2, 'quote mint'], [3, 'PlatformConfig'], [4, 'CPMM program'], [10, 'CPMM AmmConfig'],
  [11, 'CPMM pool-fee wallet'], [13, 'LP-Lock program'], [17, 'LaunchLab pool'], [18, 'GlobalConfig'], [19, 'base vault'], [20, 'quote vault'],
  [22, 'Token program'], [23, 'Token-2022 program'], [24, 'ATA program'], [27, 'Metaplex program'],
]

/** After an AccountNotFound: which accounts the migration needs to exist are missing (on a localnet, the clones to add). */
export async function missingMigrationAccounts(connection: Connection, ix: TransactionInstruction): Promise<string[]> {
  const infos = await connection.getMultipleAccountsInfo(REQUIRED.map(([i]) => ix.keys[i]!.pubkey), 'confirmed')
  return REQUIRED.flatMap(([i, name], n) => (infos[n] ? [] : [`${name} ${ix.keys[i]!.pubkey.toBase58()}`]))
}

/**
 * The CPMM pool a confirmed migration created, read from the transaction itself. Never infer a
 * graduated pool from its mints: anyone can create another CPMM pool for the same pair and config.
 */
export function migratedPoolFromTransaction(tx: VersionedTransactionResponse, launchlabPool: PublicKey): PublicKey | null {
  const keys = tx.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta?.loadedAddresses })
  const tag = Buffer.from([136, 92, 200, 103, 28, 218, 144, 140])
  const ixs = [
    ...tx.transaction.message.compiledInstructions.map((i) => ({ program: i.programIdIndex, accounts: i.accountKeyIndexes, data: Buffer.from(i.data) })),
    ...(tx.meta?.innerInstructions ?? []).flatMap((g) => g.instructions.map((i) => ({ program: i.programIdIndex, accounts: i.accounts, data: Buffer.from(fromBase58(i.data)) }))),
  ]
  for (const i of ixs) {
    if (!keys.get(i.program)?.equals(LAUNCHLAB_PROGRAM_ID) || !i.data.subarray(0, 8).equals(tag) || i.accounts.length < 18) continue
    if (keys.get(i.accounts[17]!)?.equals(launchlabPool)) return keys.get(i.accounts[5]!) ?? null
  }
  return null
}

// Programs and sysvars the IDL pins, for a lookup table that carries migrations.
export const MIGRATION_STATIC_ACCOUNTS = [
  CPMM_PROGRAM_ID, CPMM_AUTHORITY, CPMM_LAUNCHLAB_PERMISSION, RAYDIUM.createPoolFee, LP_LOCK_PROGRAM_ID, LOCK_AUTHORITY, VAULT_AUTHORITY,
  TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, SystemProgram.programId, SYSVAR_RENT_PUBKEY, METADATA_PROGRAM_ID,
]
