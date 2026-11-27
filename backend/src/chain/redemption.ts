import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { Keypair, PublicKey, SystemProgram, VersionedTransaction, type Connection, type TransactionInstruction } from '@solana/web3.js'
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  unpackAccount,
} from '@solana/spl-token'
import type { Hono } from 'hono'
import { z } from 'zod'
import * as s from '@voynich/contract'
import type { ApiVariables } from '../engines/server/app.js'
import { ApiFailure } from '../engines/server/errors.js'
import { readJson, readParam } from '../engines/server/input.js'
import { writeLimit } from '../engines/server/limits.js'
import { buildUnsignedV0, PACKET_BYTES } from '../engines/tx/server/build.js'
import { signatureOf } from '../engines/tx/server/ed25519.js'
import { failureFromLogs, toFailure } from '../engines/tx/server/failure.js'
import { loadLookupTables } from '../engines/tx/server/lookup-tables.js'
import { blockhashExpired } from '../engines/tx/server/send.js'
import { assertCosignable, decompile, LIGHTHOUSE_PROGRAM_ID } from '../engines/tx/server/wallet-copy.js'
import type { ChainRuntime } from '../runtime.js'

type SnapshotEntry = { wallet: string; rawAmount: string }
type SnapshotFile = {
  mint: string
  decimals: number
  snapshotSlot: number
  snapshotBlockTime: number
  snapshotTimestampUtc: string
  circulatingRaw: string
  poolAddress: string
  poolBaseRaw: string
  poolQuoteLamports: string
  totalHolders: number
  totalEligibleRaw: string
  snapshotSha256: string
  holders: SnapshotEntry[]
}

const snapshotData = JSON.parse(
  readFileSync(new URL('../../prisma/redemption-snapshot.json', import.meta.url), 'utf8'),
) as SnapshotFile

const HOLDER_MAP = new Map<string, bigint>(
  snapshotData.holders.map((h) => [h.wallet, BigInt(h.rawAmount)]),
)
const TOTAL_ELIGIBLE_RAW = BigInt(snapshotData.totalEligibleRaw)
const SNAPSHOT_MINT = new PublicKey(snapshotData.mint)

const BuildClaimBody = z.strictObject({
  wallet: s.Address,
})

const SubmitClaimBody = z.strictObject({
  buildId: z.string().uuid(),
  signedTransactionBase64: s.Base64,
  idempotencyKey: z.string().min(1).max(128),
})

function redemptionBad(status: 400 | 404 | 409 | 422, code: string, message: string, retryable = false): never {
  throw new ApiFailure(status, { error: { code, message, retryable, stage: 'validation' } })
}

function parseVaultKeypair(raw?: string): Keypair | null {
  if (!raw?.trim()) return null
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw.trim()) as number[]))
}

function payoutFor(tokensRaw: bigint, poolLamports: bigint): bigint {
  if (tokensRaw <= 0n || poolLamports <= 0n || TOTAL_ELIGIBLE_RAW <= 0n) return 0n
  return (tokensRaw * poolLamports) / TOTAL_ELIGIBLE_RAW
}

function shareBpsOf(tokensRaw: bigint): number {
  if (tokensRaw <= 0n || TOTAL_ELIGIBLE_RAW <= 0n) return 0
  return Number((tokensRaw * 10_000n) / TOTAL_ELIGIBLE_RAW)
}

function sharePctOf(tokensRaw: bigint): string {
  if (tokensRaw <= 0n || TOTAL_ELIGIBLE_RAW <= 0n) return '0.0000'
  const scaled = (tokensRaw * 1_000_000n) / TOTAL_ELIGIBLE_RAW
  return (Number(scaled) / 10_000).toFixed(4)
}

async function readHolderTokenAccounts(
  connection: Connection,
  owner: PublicKey,
  mint: PublicKey,
): Promise<{ totalRaw: bigint; accounts: { pubkey: PublicKey; amount: bigint }[] }> {
  const res = await connection.getTokenAccountsByOwner(owner, { mint }, 'confirmed')
  const accounts: { pubkey: PublicKey; amount: bigint }[] = []
  let totalRaw = 0n
  for (const item of res.value) {
    const unpacked = unpackAccount(item.pubkey, item.account, TOKEN_PROGRAM_ID)
    if (unpacked.amount > 0n) {
      accounts.push({ pubkey: item.pubkey, amount: unpacked.amount })
      totalRaw += unpacked.amount
    }
  }
  accounts.sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0))
  return { totalRaw, accounts }
}

export function mountFixtureRedemptionRoutes<V extends object>(app: Hono<{ Variables: V & ApiVariables }>) {
  const samplePool = 48_095_134_823n
  app.get('/v1/redemption', (c) =>
    c.json({
      open: false,
      mint: snapshotData.mint,
      decimals: snapshotData.decimals,
      snapshotSlot: snapshotData.snapshotSlot,
      snapshotTimestampUtc: snapshotData.snapshotTimestampUtc,
      snapshotSha256: snapshotData.snapshotSha256,
      totalHolders: snapshotData.totalHolders,
      totalEligibleRaw: snapshotData.totalEligibleRaw,
      poolLamports: samplePool.toString(),
      vaultAddress: null,
      claimedTokensRaw: '0',
      claimedLamports: '0',
      claimsCount: 0,
    }),
  )
  app.get('/v1/redemption/:wallet', (c) => {
    const wallet = readParam(c, 'wallet', s.Address)
    const snapshotRaw = HOLDER_MAP.get(wallet) ?? 0n
    const alloc = payoutFor(snapshotRaw, samplePool)
    return c.json({
      wallet,
      open: false,
      eligible: snapshotRaw > 0n,
      mint: snapshotData.mint,
      decimals: snapshotData.decimals,
      snapshotSlot: snapshotData.snapshotSlot,
      snapshotRaw: snapshotRaw.toString(),
      shareBps: shareBpsOf(snapshotRaw),
      sharePct: sharePctOf(snapshotRaw),
      liveBalanceRaw: snapshotRaw.toString(),
      claimedTokensRaw: '0',
      claimedLamports: '0',
      remainingSnapshotRaw: snapshotRaw.toString(),
      redeemableNowRaw: snapshotRaw.toString(),
      poolLamports: samplePool.toString(),
      totalAllocationLamports: alloc.toString(),
      redeemableNowLamports: alloc.toString(),
      pendingBuildId: null,
      lastSignature: null,
    })
  })
}

export function mountRedemptionRoutes<V extends object>(
  app: Hono<{ Variables: V & ApiVariables }>,
  runtime: ChainRuntime,
) {
  const { db, rpc } = runtime
  const vaultKeypair = parseVaultKeypair(runtime.env.REDEMPTION_VAULT_KEYPAIR)
  const poolLamports = BigInt(runtime.env.REDEMPTION_POOL_LAMPORTS ?? '0')
  const isOpen = runtime.env.REDEMPTION_OPEN === 'true' && poolLamports > 0n && vaultKeypair !== null
  const mint = SNAPSHOT_MINT

  async function reconcileWalletClaim(wallet: string): Promise<{
    claimedTokensRaw: bigint
    claimedLamports: bigint
    pendingBuildId: string | null
    lastSignature: string | null
  }> {
    const row = await db.redemptionClaim.findUnique({ where: { wallet } })
    if (!row) {
      return { claimedTokensRaw: 0n, claimedLamports: 0n, pendingBuildId: null, lastSignature: null }
    }
    if (!row.pendingBuildId) {
      return {
        claimedTokensRaw: BigInt(row.claimedTokensRaw),
        claimedLamports: BigInt(row.claimedLamports),
        pendingBuildId: null,
        lastSignature: row.lastSignature,
      }
    }

    const txRow = await db.transaction.findUnique({ where: { id: row.pendingBuildId } })
    if (!txRow) {
      await db.redemptionClaim.update({
        where: { wallet },
        data: { pendingBuildId: null, pendingTokensRaw: null, pendingLamports: null },
      })
      return {
        claimedTokensRaw: BigInt(row.claimedTokensRaw),
        claimedLamports: BigInt(row.claimedLamports),
        pendingBuildId: null,
        lastSignature: row.lastSignature,
      }
    }

    let status = txRow.status
    const sig = txRow.signature
    if (sig && (status === 'submitted' || status === 'confirmed' || status === 'unconfirmed')) {
      const chainStatus = (await rpc.connection.getSignatureStatuses([sig], { searchTransactionHistory: true })).value[0]
      if (chainStatus?.err) {
        status = 'failed'
        await db.transaction.update({ where: { id: txRow.id }, data: { status: 'failed' } })
      } else if (chainStatus?.confirmationStatus === 'finalized') {
        status = 'finalized'
        await db.transaction.update({ where: { id: txRow.id }, data: { status: 'finalized' } })
      } else if (chainStatus?.confirmationStatus === 'confirmed') {
        status = 'confirmed'
        await db.transaction.update({ where: { id: txRow.id }, data: { status: 'confirmed' } })
      } else if (!chainStatus) {
        const height = await rpc.connection.getBlockHeight('confirmed')
        if (height > Number(txRow.lastValidBlockHeight)) {
          const expired = await blockhashExpired(rpc.connection, {
            blockhash: txRow.blockhash,
            lastValidBlockHeight: Number(txRow.lastValidBlockHeight),
            contextSlot: txRow.contextSlot === null ? undefined : Number(txRow.contextSlot),
          })
          const again = (await rpc.connection.getSignatureStatuses([sig], { searchTransactionHistory: true })).value[0]
          if (!again && expired === true) {
            status = 'expired'
            await db.transaction.update({ where: { id: txRow.id }, data: { status: 'expired' } })
          }
        } else if (txRow.signedBase64) {
          try {
            await rpc.connection.sendRawTransaction(Buffer.from(txRow.signedBase64, 'base64'), { skipPreflight: true, maxRetries: 0 })
          } catch {}
        }
      }
    } else if (status === 'built') {
      const height = await rpc.connection.getBlockHeight('confirmed')
      if (height > Number(txRow.lastValidBlockHeight)) {
        status = 'expired'
        await db.transaction.update({ where: { id: txRow.id }, data: { status: 'expired' } })
      }
    }

    if (status === 'confirmed' || status === 'finalized') {
      const nextTokens = BigInt(row.claimedTokensRaw) + BigInt(row.pendingTokensRaw ?? '0')
      const nextLamports = BigInt(row.claimedLamports) + BigInt(row.pendingLamports ?? '0')
      await db.redemptionClaim.update({
        where: { wallet },
        data: {
          claimedTokensRaw: nextTokens.toString(),
          claimedLamports: nextLamports.toString(),
          pendingBuildId: null,
          pendingTokensRaw: null,
          pendingLamports: null,
          lastSignature: sig ?? row.lastSignature,
        },
      })
      return { claimedTokensRaw: nextTokens, claimedLamports: nextLamports, pendingBuildId: null, lastSignature: sig ?? row.lastSignature }
    }

    if (status === 'failed' || status === 'expired') {
      await db.redemptionClaim.update({
        where: { wallet },
        data: { pendingBuildId: null, pendingTokensRaw: null, pendingLamports: null },
      })
      return {
        claimedTokensRaw: BigInt(row.claimedTokensRaw),
        claimedLamports: BigInt(row.claimedLamports),
        pendingBuildId: null,
        lastSignature: row.lastSignature,
      }
    }

    return {
      claimedTokensRaw: BigInt(row.claimedTokensRaw),
      claimedLamports: BigInt(row.claimedLamports),
      pendingBuildId: row.pendingBuildId,
      lastSignature: row.lastSignature,
    }
  }

  app.get('/v1/redemption', async (c) => {
    const rows = await db.redemptionClaim.findMany()
    let claimedTokensRaw = 0n
    let claimedLamports = 0n
    let claimsCount = 0
    for (const r of rows) {
      const t = BigInt(r.claimedTokensRaw)
      const l = BigInt(r.claimedLamports)
      claimedTokensRaw += t
      claimedLamports += l
      if (t > 0n) claimsCount++
    }
    return c.json({
      open: isOpen,
      mint: mint.toBase58(),
      decimals: snapshotData.decimals,
      snapshotSlot: snapshotData.snapshotSlot,
      snapshotTimestampUtc: snapshotData.snapshotTimestampUtc,
      snapshotSha256: snapshotData.snapshotSha256,
      totalHolders: snapshotData.totalHolders,
      totalEligibleRaw: snapshotData.totalEligibleRaw,
      poolLamports: poolLamports.toString(),
      vaultAddress: vaultKeypair?.publicKey.toBase58() ?? null,
      claimedTokensRaw: claimedTokensRaw.toString(),
      claimedLamports: claimedLamports.toString(),
      claimsCount,
    })
  })

  app.get('/v1/redemption/tx/:id', async (c) => {
    const id = readParam(c, 'id', z.string().uuid())
    const txRow = await db.transaction.findUnique({ where: { id } })
    if (!txRow) redemptionBad(404, 'NOT_FOUND', 'This redemption build was not found.')
    await reconcileWalletClaim(txRow.wallet)
    const updated = await db.transaction.findUnique({ where: { id } })
    return c.json({
      id: updated!.id,
      status: updated!.status,
      ...(updated!.signature ? { signature: updated!.signature } : {}),
      ...(updated!.error ? { error: updated!.error } : {}),
    })
  })

  app.get('/v1/redemption/:wallet', async (c) => {
    const wallet = readParam(c, 'wallet', s.Address)
    const snapshotRaw = HOLDER_MAP.get(wallet) ?? 0n
    const state = await reconcileWalletClaim(wallet)
    const live = snapshotRaw > 0n
      ? await readHolderTokenAccounts(rpc.connection, new PublicKey(wallet), mint)
      : { totalRaw: 0n, accounts: [] }
    const remainingSnapshotRaw = snapshotRaw > state.claimedTokensRaw ? snapshotRaw - state.claimedTokensRaw : 0n
    const redeemableNowRaw = remainingSnapshotRaw < live.totalRaw ? remainingSnapshotRaw : live.totalRaw
    const totalAllocationLamports = payoutFor(snapshotRaw, poolLamports)
    const redeemableNowLamports = payoutFor(redeemableNowRaw, poolLamports)
    return c.json({
      wallet,
      open: isOpen,
      eligible: snapshotRaw > 0n,
      mint: mint.toBase58(),
      decimals: snapshotData.decimals,
      snapshotSlot: snapshotData.snapshotSlot,
      snapshotRaw: snapshotRaw.toString(),
      shareBps: shareBpsOf(snapshotRaw),
      sharePct: sharePctOf(snapshotRaw),
      liveBalanceRaw: live.totalRaw.toString(),
      claimedTokensRaw: state.claimedTokensRaw.toString(),
      claimedLamports: state.claimedLamports.toString(),
      remainingSnapshotRaw: remainingSnapshotRaw.toString(),
      redeemableNowRaw: redeemableNowRaw.toString(),
      poolLamports: poolLamports.toString(),
      totalAllocationLamports: totalAllocationLamports.toString(),
      redeemableNowLamports: redeemableNowLamports.toString(),
      pendingBuildId: state.pendingBuildId,
      lastSignature: state.lastSignature,
    })
  })

  app.post('/v1/redemption/build', writeLimit(20), async (c) => {
    if (!isOpen || !vaultKeypair) {
      redemptionBad(409, 'REDEMPTION_NOT_OPEN', 'SOL claims are not open yet. Check back once the claim window opens.', true)
    }
    const { wallet } = await readJson(c, BuildClaimBody)
    const snapshotRaw = HOLDER_MAP.get(wallet) ?? 0n
    if (snapshotRaw <= 0n) {
      redemptionBad(422, 'NOT_IN_SNAPSHOT', 'This wallet did not hold VOYNICH at the snapshot slot.')
    }

    await reconcileWalletClaim(wallet)

    const holderPk = new PublicKey(wallet)
    const live = await readHolderTokenAccounts(rpc.connection, holderPk, mint)
    if (live.totalRaw <= 0n || live.accounts.length === 0) {
      redemptionBad(422, 'NO_TOKEN_BALANCE', 'This wallet currently holds 0 VOYNICH to send.')
    }

    // Ensure row exists before row-level lock
    await db.redemptionClaim.upsert({
      where: { wallet },
      create: { wallet, snapshotRaw: snapshotRaw.toString() },
      update: {},
    })

    const locked = await db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{
          wallet: string
          snapshot_raw: string
          claimed_tokens_raw: string
          claimed_lamports: string
          pending_build_id: string | null
        }>
      >`SELECT wallet, snapshot_raw, claimed_tokens_raw, claimed_lamports, pending_build_id FROM redemption_claims WHERE wallet = ${wallet} FOR UPDATE`
      const row = rows[0]!
      if (row.pending_build_id) {
        const existingTx = await tx.transaction.findUnique({ where: { id: row.pending_build_id } })
        if (existingTx && existingTx.status === 'built') {
          await tx.transaction.update({ where: { id: existingTx.id }, data: { status: 'expired' } })
        } else if (existingTx) {
          redemptionBad(409, 'CLAIM_IN_PROGRESS', 'A claim transaction for this wallet is already confirming on chain. Wait a moment and refresh.', true)
        }
      }
      const claimedTokens = BigInt(row.claimed_tokens_raw)
      const remaining = snapshotRaw > claimedTokens ? snapshotRaw - claimedTokens : 0n
      if (remaining <= 0n) {
        redemptionBad(409, 'ALREADY_CLAIMED', 'This wallet has already claimed its full snapshot allocation.')
      }
      const redeemableNowRaw = remaining < live.totalRaw ? remaining : live.totalRaw
      const payoutLamports = payoutFor(redeemableNowRaw, poolLamports)
      if (payoutLamports <= 0n) {
        redemptionBad(422, 'AMOUNT_TOO_SMALL', 'The redeemable balance rounds to 0 lamports.')
      }
      return { redeemableNowRaw, payoutLamports }
    })

    const { redeemableNowRaw, payoutLamports } = locked
    const [vaultBalance, rentMin] = await Promise.all([
      rpc.connection.getBalance(vaultKeypair.publicKey, 'confirmed'),
      rpc.connection.getMinimumBalanceForRentExemption(0),
    ])
    if (BigInt(vaultBalance) < payoutLamports + BigInt(rentMin)) {
      redemptionBad(409, 'VAULT_UNDERFUNDED', 'The redemption vault does not currently hold enough SOL for this payout.', true)
    }

    const vaultAta = getAssociatedTokenAddressSync(mint, vaultKeypair.publicKey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID)
    const vaultAtaInfo = await rpc.connection.getAccountInfo(vaultAta, 'confirmed')
    const instructions: TransactionInstruction[] = vaultAtaInfo
      ? []
      : [createAssociatedTokenAccountIdempotentInstruction(holderPk, vaultAta, vaultKeypair.publicKey, mint, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID)]
    const expectedTokenTransfers: Array<{ source: string; dest: string; owner: string; amount: string }> = []
    let remainingToTransfer = redeemableNowRaw
    for (const acc of live.accounts) {
      if (remainingToTransfer <= 0n) break
      const chunk = acc.amount < remainingToTransfer ? acc.amount : remainingToTransfer
      const transferIx = createTransferCheckedInstruction(acc.pubkey, mint, vaultAta, holderPk, chunk, snapshotData.decimals, [], TOKEN_PROGRAM_ID)
      instructions.push(transferIx)
      expectedTokenTransfers.push({
        source: acc.pubkey.toBase58(),
        dest: vaultAta.toBase58(),
        owner: holderPk.toBase58(),
        amount: chunk.toString(),
      })
      remainingToTransfer -= chunk
    }
    const solTransferIx = SystemProgram.transfer({
      fromPubkey: vaultKeypair.publicKey,
      toPubkey: holderPk,
      lamports: payoutLamports,
    })
    instructions.push(solTransferIx)

    const tables = runtime.env.LOOKUP_TABLE ? await loadLookupTables(rpc.connection, [new PublicKey(runtime.env.LOOKUP_TABLE)]) : []
    const built = await buildUnsignedV0({
      connection: rpc.connection,
      payer: holderPk,
      instructions,
      cosigners: [vaultKeypair.publicKey],
      lookupTables: tables,
      walletSigned: true,
    })

    const id = randomUUID()
    await db.$transaction([
      db.transaction.create({
        data: {
          id,
          wallet,
          action: 'redeem_token',
          actionData: {
            redeemableNowRaw: redeemableNowRaw.toString(),
            payoutLamports: payoutLamports.toString(),
            expectedTokenTransfers,
            expectedSolTransfer: {
              from: vaultKeypair.publicKey.toBase58(),
              to: holderPk.toBase58(),
              lamports: payoutLamports.toString(),
            },
          },
          transactionBase64: built.transactionBase64,
          blockhash: built.blockhash,
          lastValidBlockHeight: BigInt(built.lastValidBlockHeight),
          contextSlot: BigInt(built.contextSlot),
          cosigned: true,
        },
      }),
      db.redemptionClaim.update({
        where: { wallet },
        data: {
          pendingBuildId: id,
          pendingTokensRaw: redeemableNowRaw.toString(),
          pendingLamports: payoutLamports.toString(),
        },
      }),
    ])

    return c.json({
      id,
      action: 'redeem_token',
      transactionBase64: built.transactionBase64,
      blockhash: built.blockhash,
      lastValidBlockHeight: built.lastValidBlockHeight,
      cosigned: true,
      requiredSigners: [wallet, vaultKeypair.publicKey.toBase58()],
      fixture: false,
      addresses: { vault: vaultKeypair.publicKey.toBase58(), vaultAta: vaultAta.toBase58() },
      redeemableNowRaw: redeemableNowRaw.toString(),
      payoutLamports: payoutLamports.toString(),
    })
  })

  app.post('/v1/redemption/submit', writeLimit(20), async (c) => {
    if (!isOpen || !vaultKeypair) {
      redemptionBad(409, 'REDEMPTION_NOT_OPEN', 'SOL claims are not open yet.', true)
    }
    const body = await readJson(c, SubmitClaimBody)
    const txRow = await db.transaction.findUnique({ where: { id: body.buildId } })
    if (!txRow || txRow.action !== 'redeem_token') {
      redemptionBad(404, 'NOT_FOUND', 'This redemption build was not found.')
    }
    if (txRow.status !== 'built') {
      if (txRow.submissionKey && txRow.submissionKey !== body.idempotencyKey) {
        redemptionBad(409, 'IDEMPOTENCY_CONFLICT', 'This build was already submitted with another idempotency key.')
      }
      return c.json({
        id: txRow.id,
        status: txRow.status,
        ...(txRow.signature ? { signature: txRow.signature } : {}),
      })
    }

    const raw = Buffer.from(body.signedTransactionBase64, 'base64')
    if (raw.length > PACKET_BYTES) redemptionBad(400, 'PAYLOAD_TOO_LARGE', 'The signed transaction exceeds packet size.')
    let signed: VersionedTransaction
    try {
      signed = VersionedTransaction.deserialize(raw)
    } catch {
      redemptionBad(400, 'INVALID_TRANSACTION', 'Invalid signed transaction bytes.')
    }
    const original = VersionedTransaction.deserialize(Buffer.from(txRow.transactionBase64, 'base64'))
    const [signedTables, originalTables] = await Promise.all([
      loadLookupTables(rpc.connection, signed.message.addressTableLookups.map((l) => l.accountKey)),
      loadLookupTables(rpc.connection, original.message.addressTableLookups.map((l) => l.accountKey)),
    ])

    const payerPk = new PublicKey(txRow.wallet)
    assertCosignable({
      original,
      signed,
      originalTables,
      signedTables,
      payer: payerPk,
      cosigner: vaultKeypair.publicKey,
    })

    // Compare against the decompiled original build (not pre-compile instructions, because v0 compilation
    // merges payer/writable flags across instructions) and allow standard wallet guard programs.
    const beforeIxs = decompile(original, originalTables)
    const afterIxs = decompile(signed, signedTables)
    const isGuardProgram = (prog: string) =>
      prog === 'ComputeBudget111111111111111111111111111111' ||
      prog === LIGHTHOUSE_PROGRAM_ID.toBase58() ||
      prog === 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr' ||
      prog === 'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo'

    // Match instructions ignoring non-authoritative isWritable promotions caused by wallet Lighthouse guards
    const canonicalIx = (ix: TransactionInstruction) =>
      JSON.stringify([
        ix.programId.toBase58(),
        ix.data.toString('base64'),
        ix.keys.map((k) => [k.pubkey.toBase58(), k.isSigner]),
      ])

    const requiredCore = beforeIxs.filter((ix) => !isGuardProgram(ix.programId.toBase58())).map(canonicalIx)
    const afterCore = afterIxs.filter((ix) => !isGuardProgram(ix.programId.toBase58())).map(canonicalIx)
    if (requiredCore.length !== afterCore.length || requiredCore.some((v, idx) => v !== afterCore[idx])) {
      redemptionBad(400, 'WALLET_CHANGED', 'The signed transaction altered the VOYNICH transfer or SOL payout instruction.')
    }

    signed.sign([vaultKeypair])
    const sim = await rpc.connection.simulateTransaction(signed, { sigVerify: true, commitment: 'confirmed' })
    if (sim.value.err) {
      const err = toFailure(failureFromLogs('simulation', sim.value.logs))
      throw new ApiFailure(422, { error: { code: 'SIMULATION_FAILED', message: err.message, retryable: err.retryable, stage: 'simulation' } })
    }

    const finalBytes = signed.serialize()
    const signedBase64 = Buffer.from(finalBytes).toString('base64')
    const signature = signatureOf(signed)

    const claimed = await db.transaction.updateMany({
      where: { id: txRow.id, status: 'built' },
      data: {
        status: 'submitted',
        signature,
        signedBase64,
        submissionKey: body.idempotencyKey,
      },
    })
    if (claimed.count === 1) {
      try {
        await rpc.connection.sendRawTransaction(finalBytes, { skipPreflight: true, maxRetries: 3 })
      } catch {}
    }

    const latest = await db.transaction.findUnique({ where: { id: txRow.id } })
    return c.json({
      id: latest!.id,
      status: latest!.status,
      ...(latest!.signature ? { signature: latest!.signature } : {}),
    })
  })
}
