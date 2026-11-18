// Graduation from DBC to DAMM v2, and finding a graduated pool after the fact.
//
// DBC migration borrows the rent of the accounts it creates from its pool-authority PDA (a
// shared flash-rent lender) and repays it within the instruction, so that lender must hold 1 SOL.
// A localnet seeds it from its faucet, or every migration fails there.

import type { Keypair, PublicKey, TransactionInstruction, VersionedTransactionResponse } from '@solana/web3.js'
import { DynamicBondingCurveIdl, deriveDbcPoolAuthority } from '@meteora-ag/dynamic-bonding-curve-sdk'
import { derivePoolAddress, derivePositionAddress, derivePositionNftAccount } from '@meteora-ag/cp-amm-sdk'
import { fromBase58 } from '../../core/encoding.js'
import type { Damm } from './damm.js'
import type { Dbc } from './dbc.js'
import { withoutComputeBudget } from './instructions.js'
import { DBC_PROGRAM_ID, dammConfigFor, graduatedPool } from './pdas.js'

const MIGRATE = DynamicBondingCurveIdl.instructions.find((i) => i.name === 'migration_damm_v2')!
const account = (name: string) => MIGRATE.accounts.findIndex((a) => a.name === name)
/** The DAMM v2 config rides as the first account after the IDL's named ones. */
const DAMM_CONFIG = MIGRATE.accounts.length
const isMigration = (programId: PublicKey, data: Uint8Array) => programId.equals(DBC_PROGRAM_ID) && MIGRATE.discriminator.every((b, i) => data[i] === b)

export type Migration = {
  instructions: TransactionInstruction[]
  /** the two position NFT mints: fresh keys that sign this keeper transaction and nothing a wallet signs */
  signers: Keypair[]
  dammPool: PublicKey
  positions: { nftMint: PublicKey; position: PublicKey; nftAccount: PublicKey }[]
}

/**
 * Permissionless: any keeper sends it once the curve is complete. The DAMM v2 config follows from
 * the curve's own migration fee option unless one is given.
 */
export async function migrationInstructions(dbc: Dbc, args: { pool: PublicKey; payer: PublicKey; dammConfig?: PublicKey }): Promise<Migration> {
  const snap = await dbc.snapshot(args.pool)
  const dammConfig = args.dammConfig ?? dammConfigFor(snap.config)
  const result = await dbc.client.migration.migrateToDammV2({ pool: args.pool, payer: args.payer, dammConfig })
  const instructions = withoutComputeBudget(result.transaction.instructions)
  const migrate = instructions.find((ix) => isMigration(ix.programId, ix.data))
  if (!migrate?.keys[DAMM_CONFIG]?.pubkey.equals(dammConfig)) throw new Error('The migration must carry the DAMM v2 config as its first remaining account.')
  const signers = [result.firstPositionNftKeypair, result.secondPositionNftKeypair]
  return {
    instructions,
    signers,
    dammPool: graduatedPool(dammConfig, snap.pool.poolState.baseMint, snap.config.quoteMint),
    positions: signers.map(({ publicKey: nftMint }) => ({ nftMint, position: derivePositionAddress(nftMint), nftAccount: derivePositionNftAccount(nftMint) })),
  }
}

type Call = { programId: PublicKey; accounts: PublicKey[]; data: Uint8Array }

/** Top-level and inner instructions of a landed transaction, accounts resolved through its lookups. */
function calls(tx: VersionedTransactionResponse): Call[] {
  const keys = tx.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta?.loadedAddresses })
  const key = (i: number) => keys.get(i)!
  const out: Call[] = []
  tx.transaction.message.compiledInstructions.forEach((ix, top) => {
    out.push({ programId: key(ix.programIdIndex), accounts: ix.accountKeyIndexes.map(key), data: ix.data })
    for (const inner of tx.meta?.innerInstructions?.find((g) => g.index === top)?.instructions ?? []) {
      out.push({ programId: key(inner.programIdIndex), accounts: inner.accounts.map(key), data: fromBase58(inner.data) })
    }
  })
  return out
}

/**
 * The DAMM v2 pool a migrated curve graduated into. DBC 0.2.2 stores no migrated-pool address,
 * so the curve's own history is searched for the migration that succeeded, directly or by CPI,
 * and the pool it names is checked against chain state before it is believed. For recovering a
 * pool the indexer missed; the indexer's own receipt of the migration is the usual source.
 */
export async function findMigration(dbc: Dbc, damm: Damm, virtualPool: PublicKey, maxPages = 20) {
  const { connection } = dbc
  const snap = await dbc.snapshot(virtualPool)
  if (!snap.pool.poolState.isMigrated) throw new Error(`Curve ${virtualPool.toBase58()} has not migrated.`)
  let before: string | undefined
  for (let page = 0; page < maxPages; page++) {
    const signatures = await connection.getSignaturesForAddress(virtualPool, { limit: 100, before }, 'confirmed')
    for (const s of signatures) {
      if (s.err) continue
      let tx: VersionedTransactionResponse | null
      try {
        tx = await connection.getTransaction(s.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })
      } catch (e) {
        // A v1 transaction answers -32015 and web3.js 1.x cannot ask for it: skip, never stop.
        if ((e as { code?: unknown }).code === -32015) continue
        throw e
      }
      if (!tx?.meta) throw new Error(`Curve history is not readable at ${s.signature}.`)
      const call = calls(tx).find((c) => isMigration(c.programId, c.data) && c.accounts[account('virtual_pool')]?.equals(virtualPool))
      if (!call) continue
      const pool = call.accounts[account('pool')]
      const dammConfig = call.accounts[DAMM_CONFIG]
      if (!pool || !dammConfig) throw new Error(`The migration at ${s.signature} does not name a DBC-created DAMM v2 pool.`)
      const [state, config] = await Promise.all([damm.pool(pool), damm.amm.fetchConfigState(dammConfig)])
      const authority = deriveDbcPoolAuthority()
      const genuine =
        state.tokenAMint.equals(snap.pool.poolState.baseMint) &&
        state.tokenBMint.equals(snap.config.quoteMint) &&
        state.creator.equals(authority) &&
        config.poolCreatorAuthority.equals(authority) &&
        derivePoolAddress(dammConfig, state.tokenAMint, state.tokenBMint).equals(pool)
      if (!genuine) throw new Error(`The migration at ${s.signature} does not name a DBC-created DAMM v2 pool.`)
      return { signature: s.signature, pool, dammConfig }
    }
    if (signatures.length < 100) break
    before = signatures.at(-1)!.signature
  }
  throw new Error(`No readable migration of ${virtualPool.toBase58()} in its recent history.`)
}
