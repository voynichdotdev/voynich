// Trading on a LaunchLab curve: buy or sell, exact in or exact out, with an optional referral
// share fee, plus the account setup around it (ATAs, wrapping and unwrapping WSOL). Works for any
// quote mint and either token program, read from the pool's token_program_flag.

import { SystemProgram, type AccountMeta, type PublicKey, type TransactionInstruction } from '@solana/web3.js'
import {
  NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction, createSyncNativeInstruction,
} from '@solana/spl-token'
import { EVENT_AUTHORITY, LAUNCHLAB_PROGRAM_ID, VAULT_AUTHORITY, ata, creatorFeeVault, platformFeeVault } from './addresses.js'
import { launchlabInstruction } from './codec.js'
import type { PoolState } from './accounts.js'

export type TradePool = Pick<PoolState, 'address' | 'globalConfig' | 'platformConfig' | 'baseMint' | 'quoteMint' | 'baseVault' | 'quoteVault' | 'creator' | 'tokenProgramFlag'>

export type TradeAmount =
  | { exactIn: bigint; minimumOut: bigint }
  | { exactOut: bigint; maximumIn: bigint }

export type TradeInput = {
  payer: PublicKey
  pool: TradePool
  side: 'buy' | 'sell'
  amount: TradeAmount
  /** A referral share of the trade, at most the GlobalConfig's max_share_fee_rate, paid to the receiver's quote ATA. */
  shareFee?: { rate: bigint; receiver: PublicKey }
}

export const tokenProgramFor = (flag: number, side: 'base' | 'quote') => (flag & (side === 'base' ? 1 : 2) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID)

/** The trader's base and quote ATAs under the pool's token programs. */
export function traderAccounts(owner: PublicKey, pool: TradePool) {
  const baseProgram = tokenProgramFor(pool.tokenProgramFlag, 'base'), quoteProgram = tokenProgramFor(pool.tokenProgramFlag, 'quote')
  return { baseProgram, quoteProgram, base: ata(owner, pool.baseMint, baseProgram), quote: ata(owner, pool.quoteMint, quoteProgram) }
}

/**
 * The trade itself. After the IDL's fifteen accounts it names, in this order: the share fee
 * receiver's quote ATA (only with a share fee), the System program, the platform fee vault
 * [platform_config, quote_mint] and the creator fee vault [creator, quote_mint]. Fees land in
 * those vaults at trade time; the first trade into a new vault pays its rent.
 */
export function tradeInstruction(input: TradeInput): TransactionInstruction {
  const { pool, payer } = input
  const user = traderAccounts(payer, pool)
  const exactIn = 'exactIn' in input.amount
  const name = `${input.side}_exact_${exactIn ? 'in' : 'out'}`
  const share = input.shareFee?.rate ?? 0n
  const args = 'exactIn' in input.amount
    ? { amount_in: input.amount.exactIn, minimum_amount_out: input.amount.minimumOut, share_fee_rate: share }
    : { amount_out: input.amount.exactOut, maximum_amount_in: input.amount.maximumIn, share_fee_rate: share }
  const w = (pubkey: PublicKey): AccountMeta => ({ pubkey, isSigner: false, isWritable: true })
  const remaining: AccountMeta[] = [
    ...(input.shareFee && share > 0n ? [w(ata(input.shareFee.receiver, pool.quoteMint, user.quoteProgram))] : []),
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    w(platformFeeVault(pool.platformConfig, pool.quoteMint)),
    w(creatorFeeVault(pool.creator, pool.quoteMint)),
  ]
  return launchlabInstruction(name, args, {
    payer, authority: VAULT_AUTHORITY, global_config: pool.globalConfig, platform_config: pool.platformConfig, pool_state: pool.address,
    user_base_token: user.base, user_quote_token: user.quote, base_vault: pool.baseVault, quote_vault: pool.quoteVault,
    base_token_mint: pool.baseMint, quote_token_mint: pool.quoteMint, base_token_program: user.baseProgram, quote_token_program: user.quoteProgram,
    event_authority: EVENT_AUTHORITY, program: LAUNCHLAB_PROGRAM_ID,
  }, remaining)
}

/**
 * The trade with its setup: both ATAs created idempotently (the WSOL one every time, even if a
 * flow just closed it), the share receiver's ATA when there is one, lamports wrapped for a WSOL
 * buy, and the WSOL ATA closed after, so the trader ends holding SOL. An exact-out buy wraps its
 * maximum input; closing the account returns what was not spent.
 */
export function tradeInstructions(input: TradeInput): TransactionInstruction[] {
  const { payer, pool } = input
  const user = traderAccounts(payer, pool)
  const wsol = pool.quoteMint.equals(NATIVE_MINT)
  const out: TransactionInstruction[] = [
    createAssociatedTokenAccountIdempotentInstruction(payer, user.base, payer, pool.baseMint, user.baseProgram),
    createAssociatedTokenAccountIdempotentInstruction(payer, user.quote, payer, pool.quoteMint, user.quoteProgram),
  ]
  if (input.shareFee && input.shareFee.rate > 0n) {
    const receiver = input.shareFee.receiver
    out.push(createAssociatedTokenAccountIdempotentInstruction(payer, ata(receiver, pool.quoteMint, user.quoteProgram), receiver, pool.quoteMint, user.quoteProgram))
  }
  if (wsol && input.side === 'buy') {
    const lamports = 'exactIn' in input.amount ? input.amount.exactIn : input.amount.maximumIn
    out.push(SystemProgram.transfer({ fromPubkey: payer, toPubkey: user.quote, lamports }), createSyncNativeInstruction(user.quote))
  }
  out.push(tradeInstruction(input))
  if (wsol) out.push(createCloseAccountInstruction(user.quote, payer, payer))
  return out
}
