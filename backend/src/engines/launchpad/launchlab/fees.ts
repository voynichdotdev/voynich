// Collecting LaunchLab's curve fees: the platform's share from its fee vault and the creator's
// from theirs. Both vaults are per quote mint and shared by every pool of that platform or
// creator. Claims pay into the claimant's canonical ATA, which LaunchLab opens when missing.

import { NATIVE_MINT, TOKEN_PROGRAM_ID, createCloseAccountInstruction } from '@solana/spl-token'
import type { PublicKey, TransactionInstruction } from '@solana/web3.js'
import {
  CREATOR_FEE_VAULT_AUTHORITY, PLATFORM_FEE_VAULT_AUTHORITY, ata, creatorFeeVault, platformFeeVault,
} from './addresses.js'
import { launchlabInstruction } from './codec.js'

/**
 * claim_platform_fee_from_vault, signed by the platform's fee wallet as a writable payer (it pays
 * the ATA's rent when it opens one; a PDA fee wallet needs rent-exempt lamports to sign as payer).
 * The vault's authority is ["platform_fee_vault_auth_seed"], not the creator vault's.
 */
export function claimPlatformFeeInstruction(input: { feeWallet: PublicKey; platformConfig: PublicKey; quoteMint: PublicKey; quoteTokenProgram?: PublicKey }) {
  const tokenProgram = input.quoteTokenProgram ?? TOKEN_PROGRAM_ID
  return launchlabInstruction('claim_platform_fee_from_vault', {}, {
    platform_fee_wallet: input.feeWallet, fee_vault_authority: PLATFORM_FEE_VAULT_AUTHORITY, platform_config: input.platformConfig,
    platform_fee_vault: platformFeeVault(input.platformConfig, input.quoteMint),
    recipient_token_account: ata(input.feeWallet, input.quoteMint, tokenProgram), quote_mint: input.quoteMint, token_program: tokenProgram,
  })
}

/** claim_creator_fee, signed by the pool creator as a writable payer, for every pool it created in this quote mint. */
export function claimCreatorFeeInstruction(input: { creator: PublicKey; quoteMint: PublicKey; quoteTokenProgram?: PublicKey }) {
  const tokenProgram = input.quoteTokenProgram ?? TOKEN_PROGRAM_ID
  return launchlabInstruction('claim_creator_fee', {}, {
    creator: input.creator, fee_vault_authority: CREATOR_FEE_VAULT_AUTHORITY, creator_fee_vault: creatorFeeVault(input.creator, input.quoteMint),
    recipient_token_account: ata(input.creator, input.quoteMint, tokenProgram), quote_mint: input.quoteMint, token_program: tokenProgram,
  })
}

/**
 * Fees in WSOL land as WSOL. Closing the claimant's WSOL ATA after the claim unwraps them to the
 * owner, together with the ATA's rent: a ledger that counts fee income subtracts that rent, or
 * returns it to whoever paid it.
 */
export function unwrapAfterClaim(owner: PublicKey, quoteMint: PublicKey): TransactionInstruction[] {
  return quoteMint.equals(NATIVE_MINT) ? [createCloseAccountInstruction(ata(owner, NATIVE_MINT), owner, owner)] : []
}
