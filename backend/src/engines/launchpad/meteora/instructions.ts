// Shaping the SDKs' instruction lists before they go into a transaction. Their builders open a
// token account only when it is missing at the moment they read the chain, and their own cleanup
// closes the WSOL account; a transaction built ahead, or sent after another claim or unwrap, then
// fails inside the venue. Every list here opens what it pays into, idempotently, first.

import { ComputeBudgetProgram, type PublicKey, type TransactionInstruction } from '@solana/web3.js'
import { ASSOCIATED_TOKEN_PROGRAM_ID, NATIVE_MINT, createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token'

export type MintRef = { mint: PublicKey; program: PublicKey }
export type TokenAccountRef = MintRef & { owner: PublicKey }

export function withTokenAccounts(instructions: TransactionInstruction[], payer: PublicKey, accounts: TokenAccountRef[]): TransactionInstruction[] {
  const opens = accounts.flatMap(({ owner, mint, program }) => {
    const ata = getAssociatedTokenAddressSync(mint, owner, true, program)
    const opened = instructions.some((ix) => ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID) && ix.keys[1]?.pubkey.equals(ata))
    return opened ? [] : [createAssociatedTokenAccountIdempotentInstruction(payer, ata, owner, mint, program)]
  })
  return [...opens, ...instructions]
}

export const ownedBy = (owner: PublicKey, mints: MintRef[]): TokenAccountRef[] => mints.map((m) => ({ ...m, owner }))

/**
 * Where a fee claim pays: the receiver's accounts, except native SOL, which both venues pay into
 * the claimer's own WSOL account and then unwrap to the receiver.
 */
export const claimAccounts = (claimer: PublicKey, receiver: PublicKey, mints: MintRef[]): TokenAccountRef[] =>
  mints.map((m) => ({ ...m, owner: m.mint.equals(NATIVE_MINT) ? claimer : receiver }))

/** The transaction builder sets its own compute budget from a simulation. */
export const withoutComputeBudget = (instructions: TransactionInstruction[]) => instructions.filter((ix) => !ix.programId.equals(ComputeBudgetProgram.programId))

/** Only the venue program's own instructions, for callers that wrap a claim in their program's CPI. */
export const onlyProgram = (instructions: TransactionInstruction[], program: PublicKey) => instructions.filter((ix) => ix.programId.equals(program))
