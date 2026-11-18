// A test signer that rewrites the way Phantom does: replaces and reorders the compute budget,
// then appends real Lighthouse assertions before signing. Every user-signed flow should pass
// with it; a strict "same bytes" or "same instructions in order" check fails here, as it would
// against the real wallet. `attack` adds an instruction that misuses the co-signer, which the
// co-sign check must refuse.

import { ComputeBudgetProgram, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction, type Connection, type Keypair } from '@solana/web3.js'
import { LIGHTHOUSE_PROGRAM_ID } from '../wallet-copy.js'

// Lighthouse AssertAccountInfo(5), log level Silent(0), IsSigner(5), true(1), Equal(0).
const ASSERT_IS_SIGNER = Buffer.from([5, 0, 5, 1, 0])

export async function rewriteLikePhantom(
  connection: Connection,
  transactionBase64: string,
  wallet: Keypair,
  options: { cosigner?: PublicKey; attack?: boolean; lighthouse?: PublicKey } = {},
): Promise<string> {
  const original = VersionedTransaction.deserialize(Buffer.from(transactionBase64, 'base64'))
  const tables = await Promise.all(original.message.addressTableLookups.map(async (l) => (await connection.getAddressLookupTable(l.accountKey)).value!))
  const message = TransactionMessage.decompile(original.message, { addressLookupTableAccounts: tables })
  const lighthouse = options.lighthouse ?? LIGHTHOUSE_PROGRAM_ID
  const guarded = [wallet.publicKey, ...(options.cosigner ? [options.cosigner] : [])]
  const instructions = [
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 0 }),
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_350_000 }),
    ...message.instructions.filter((ix) => !ix.programId.equals(ComputeBudgetProgram.programId)),
    ...guarded.map((pubkey) => new TransactionInstruction({ programId: lighthouse, keys: [{ pubkey, isSigner: false, isWritable: false }], data: ASSERT_IS_SIGNER })),
    ...(options.attack && options.cosigner ? [SystemProgram.transfer({ fromPubkey: options.cosigner, toPubkey: wallet.publicKey, lamports: 1n })] : []),
  ]
  const rewritten = new VersionedTransaction(
    new TransactionMessage({ payerKey: wallet.publicKey, recentBlockhash: message.recentBlockhash, instructions }).compileToV0Message(tables),
  )
  rewritten.sign([wallet])
  return Buffer.from(rewritten.serialize()).toString('base64')
}
