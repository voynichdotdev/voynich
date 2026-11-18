import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { Ed25519Program, PublicKey, SystemProgram, type TransactionInstruction } from '@solana/web3.js'
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, unpackAccount } from '@solana/spl-token'
import type { Build } from '@voynich/contract'
import { IDL as voyIDL } from 'voynich/idl/voynich'
import { IDL as attestIDL } from 'voynich/idl/attest'
import { IDL as bountyIDL } from 'voynich/idl/bounty'
import { buildUnsignedV0 } from '../engines/tx/server/build.js'
import { loadLookupTables } from '../engines/tx/server/lookup-tables.js'
import { InsufficientFundsError, registryFromIdls } from '../engines/tx/server/failure.js'
import { refresh, submit, type TxRecord, type TxStore } from '../engines/tx/server/ledger.js'
import type { TxSubmission } from '../engines/tx/types.js'
import type { ChainRuntime } from '../runtime.js'

const json = (value: unknown) => value as Prisma.InputJsonValue
export function transactions(runtime: ChainRuntime) {
  const { db, rpc } = runtime
  const store: TxStore = {
    async get(id) {
      const row = await db.transaction.findUnique({ where: { id } })
      if (!row) return null
      return Object.assign(
        { id: row.id, wallet: row.wallet, transactionBase64: row.transactionBase64, blockhash: row.blockhash, lastValidBlockHeight: Number(row.lastValidBlockHeight), cosigned: row.cosigned, contextSlot: row.contextSlot === null ? undefined : Number(row.contextSlot), status: row.status as TxRecord['status'], signature: row.signature ?? undefined, signedBase64: row.signedBase64 ?? undefined, submissionKey: row.submissionKey ?? undefined, ...(row.error === null ? {} : { error: row.error as TxRecord['error'] }) },
        { action: row.action },
      )
    },
    async claim(id, patch) {
      const result = await db.transaction.updateMany({ where: { id, status: 'built' }, data: { status: patch.status, signature: patch.signature, signedBase64: patch.signedBase64, submissionKey: patch.submissionKey } })
      return result.count === 1
    },
    async update(id, patch) { await db.transaction.update({ where: { id }, data: { status: patch.status, signature: patch.signature, signedBase64: patch.signedBase64, submissionKey: patch.submissionKey, ...(patch.error ? { error: json(patch.error) } : {}) } }) },
  }
  const registry = registryFromIdls(
    voyIDL,
    attestIDL,
    runtime.bountyProgramId ? { ...bountyIDL, address: runtime.bountyProgramId.toBase58() } : bountyIDL,
  )
  const bountyActions = new Set(['post_bounty', 'draw_bounty', 'collect_bounty', 'cancel_bounty'])
  const deps = { connection: rpc.connection, store, registry,
    action: (record: TxRecord) => ({
      requiredProgram: bountyActions.has((record as TxRecord & { action?: string }).action ?? '') && runtime.bountyProgramId ? runtime.bountyProgramId : runtime.programId,
      allowedPrograms: [SystemProgram.programId, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, Ed25519Program.programId],
    }) }
  return {
    async build(
      action: Build['action'],
      wallet: PublicKey,
      instructions: TransactionInstruction[],
      addresses: Build['addresses'],
      requiredLamports = 0n,
      tokens?: { mint: PublicKey; account: PublicKey; amount: bigint },
      options?: { walletSigned?: boolean },
    ): Promise<Build> {
      if (tokens) {
        const account = await rpc.connection.getAccountInfo(tokens.account, 'confirmed')
        const available = account ? unpackAccount(tokens.account, account, TOKEN_PROGRAM_ID).amount : 0n
        if (available < tokens.amount) throw new InsufficientFundsError(tokens.mint.toBase58(), tokens.amount, available)
      }
      const requiredSigners = [...new Set(instructions.flatMap(ix => ix.keys.filter(key => key.isSigner).map(key => key.pubkey.toBase58())).concat(wallet.toBase58()))]
      const tables = runtime.env.LOOKUP_TABLE ? await loadLookupTables(rpc.connection, [new PublicKey(runtime.env.LOOKUP_TABLE)]) : []
      const built = await buildUnsignedV0({ connection: rpc.connection, payer: wallet, instructions, cosigners: requiredSigners.filter(key => key !== wallet.toBase58()).map(key => new PublicKey(key)), lookupTables: tables, walletSigned: options?.walletSigned ?? true, registry, requiredLamports })
      const id = randomUUID()
      await db.transaction.create({ data: { id, wallet: wallet.toBase58(), action, actionData: json({ addresses, requiredSigners }), transactionBase64: built.transactionBase64, blockhash: built.blockhash, lastValidBlockHeight: BigInt(built.lastValidBlockHeight), contextSlot: BigInt(built.contextSlot), cosigned: false } })
      return { id, action, transactionBase64: built.transactionBase64, blockhash: built.blockhash, lastValidBlockHeight: built.lastValidBlockHeight, cosigned: false, requiredSigners, fixture: false, addresses }
    },
    submit: (body: TxSubmission) => submit(deps, body),
    follow: (id: string) => refresh(deps, id),
  }
}
