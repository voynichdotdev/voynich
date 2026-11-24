import { readFileSync } from 'node:fs'
import { Keypair, PublicKey, SystemProgram, type TransactionInstruction } from '@solana/web3.js'
import type { Prisma } from '@prisma/client'
import { createAssociatedTokenAccountIdempotentInstruction, createBurnCheckedInstruction, getAssociatedTokenAddressSync, NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, unpackMint, type Mint } from '@solana/spl-token'
import { decodeCallAccount, decodeSessionAccount, eventAccounts, type DecodedSessionAccount } from 'voynich/program'
import { createKeeperRuntime } from '../engines/keeper/runtime.js'
import { createScheduler } from '../engines/keeper/scheduler.js'
import { createJournal } from '../engines/keeper/journal.js'
import { prismaKeeperStore } from '../engines/keeper/prisma-store.js'
import { SessionLease } from '../engines/indexer/session-lease.js'
import { createJupiterClient } from '../engines/jupiter/http.js'
import { quoteExactIn } from '../engines/jupiter/quote.js'
import { swapInstructions } from '../engines/jupiter/swap.js'
import { instructionFromWire, type WireInstruction } from '../engines/jupiter/schemas.js'
import { loadLookupTables } from '../engines/tx/server/lookup-tables.js'
import { createDamm, type Damm } from '../engines/launchpad/meteora/damm.js'
import { createDbc, type Dbc, type DbcSnapshot } from '../engines/launchpad/meteora/dbc.js'
import { creatorFeeAmounts, creatorFeeClaims } from '../engines/launchpad/meteora/fees.js'
import { findMigration } from '../engines/launchpad/meteora/migration.js'
import { buybackShareOf, combineBuybackCredits, dammPositionClaimInstructions, findClaimableDammPosition, parseClaimedBalances } from './trading-fees.js'
import type { ChainRuntime } from '../runtime.js'

const wire = (instruction: TransactionInstruction): WireInstruction => ({ programId: instruction.programId.toBase58(), accounts: instruction.keys.map(key => ({ pubkey: key.pubkey.toBase58(), isSigner: key.isSigner, isWritable: key.isWritable })), data: instruction.data.toString('base64') })

export function refundCallerTokenAccount(priceMint: PublicKey, caller: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(priceMint, caller, true)
}

export async function buildExpiredSessionCloseInstructions(
  voynichProgram: ChainRuntime['programs']['voynich'],
  closer: PublicKey,
  sessionKey: PublicKey,
  chainSession: DecodedSessionAccount,
): Promise<TransactionInstruction[]> {
  const token = !chainSession.mint.equals(PublicKey.default)
  const callerTokens = token ? getAssociatedTokenAddressSync(chainSession.mint, chainSession.caller, true) : null
  return [
    ...(token ? [createAssociatedTokenAccountIdempotentInstruction(closer, callerTokens!, chainSession.caller, chainSession.mint)] : []),
    await voynichProgram.methods
      .closeSession()
      .accountsStrict({
        closer,
        session: sessionKey,
        caller: chainSession.caller,
        sessionEscrow: token ? getAssociatedTokenAddressSync(chainSession.mint, sessionKey, true) : null,
        callerTokens,
        tokenProgram: token ? TOKEN_PROGRAM_ID : null,
        systemProgram: SystemProgram.programId,
        ...eventAccounts(voynichProgram.programId),
      })
      .instruction(),
  ]
}

export function readKey(value: string | undefined, name: string): Keypair {
  if (!value?.trim()) throw new Error(`Set ${name} before starting this crank role.`)
  try {
    const raw = value.trim().startsWith('[') ? value : readFileSync(value, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed) || parsed.length !== 64 || !parsed.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
      throw new Error('Invalid keypair array')
    }
    return Keypair.fromSecretKey(Uint8Array.from(parsed))
  }
  catch { throw new Error(`${name} must be a readable keypair file or a 64-byte JSON secret array.`) }
}

export async function runCrank(runtime: ChainRuntime) {
  const { db, rpc, env, programs, addresses } = runtime
  const keeper = readKey(env.KEEPER_KEYPAIR, 'KEEPER_KEYPAIR')
  const lease = new SessionLease({ connectionString: env.DATABASE_URL!, name: 'voynich:crank' })
  const store = prismaKeeperStore(db)
  let worker: ReturnType<typeof createKeeperRuntime>
  const journal = createJournal({ connection: rpc.connection, store, signer: keeper, isLeader: () => worker.isLeader(), followMs: 1000 })

  const refund = async () => {
    const slot = await runtime.readModel.currentSlot()
    const calls = await db.call.findMany({ where: { status: 'open', deadlineSlot: { lt: slot } }, orderBy: { deadlineSlot: 'asc' }, take: 50 })
    await Promise.all(calls.map(call => scheduler.safely(`refund:${call.address}`, async () => {
      const info = await rpc.connection.getAccountInfo(new PublicKey(call.address), 'confirmed')
      if (!info || !info.owner.equals(programs.voynich.programId)) return
      const chainCall = decodeCallAccount(info.data)
      if (!('open' in chainCall.status)) return
      const token = !chainCall.priceMint.equals(PublicKey.default)
      const callerTokens = token ? refundCallerTokenAccount(chainCall.priceMint, chainCall.caller) : null
      await journal.execute(`refund:${call.address}`, async () => [
        ...(token ? [createAssociatedTokenAccountIdempotentInstruction(keeper.publicKey, callerTokens!, chainCall.caller, chainCall.priceMint)] : []),
        await programs.voynich.methods.refundCall().accountsStrict({ actor: keeper.publicKey, call: new PublicKey(call.address), caller: chainCall.caller, escrowTokens: token ? getAssociatedTokenAddressSync(chainCall.priceMint, new PublicKey(call.address), true) : null, callerTokens, tokenProgram: token ? TOKEN_PROGRAM_ID : null, ...eventAccounts(programs.voynich.programId) }).instruction(),
      ])
    })))
  }

  const sweepSessions = async () => {
    const slot = await runtime.readModel.currentSlot()
    const expired = await db.session.findMany({ where: { status: 'open', expiresAtSlot: { lt: slot } }, orderBy: { expiresAtSlot: 'asc' }, take: 50 })
    await Promise.all(expired.map(sess => scheduler.safely(`close-session:${sess.address}`, async () => {
      const sessionKey = new PublicKey(sess.address)
      const info = await rpc.connection.getAccountInfo(sessionKey, 'confirmed')
      if (!info || !info.owner.equals(programs.voynich.programId)) return
      const chainSession = decodeSessionAccount(info.data)
      if (chainSession.status !== 'open') return
      if (slot <= BigInt(chainSession.expiresAtSlot.toString())) return
      await journal.execute(`close-session:${sess.address}`, () =>
        buildExpiredSessionCloseInstructions(programs.voynich, keeper.publicKey, sessionKey, chainSession),
      )
    })))
  }

  let feeKey: Keypair | undefined
  let claimJournal: ReturnType<typeof createJournal> | undefined
  let buyJournal: ReturnType<typeof createJournal> | undefined
  let cachedOutput: { mint: PublicKey; program: PublicKey; decimals: number; ata: PublicKey } | undefined
  let dbc: Dbc | undefined
  let damm: Damm | undefined
  let cachedDammPool: PublicKey | undefined
  let lookupTables: PublicKey[] = []
  const jupiter = createJupiterClient({ apiKey: env.JUPITER_API_KEY })

  const ensureFeeKey = async () => {
    if (!feeKey) {
      const loaded = readKey(env.FEE_RECIPIENT_KEYPAIR, 'FEE_RECIPIENT_KEYPAIR')
      const config = await runtime.readModel.config()
      if (!config || config.feeRecipient !== loaded.publicKey.toBase58()) {
        throw new Error('FEE_RECIPIENT_KEYPAIR does not match the chain fee recipient.')
      }
      feeKey = loaded
    }
    claimJournal ??= createJournal({ connection: rpc.connection, store, signer: feeKey, isLeader: () => worker.isLeader(), followMs: 5000 })
    buyJournal ??= createJournal({ connection: rpc.connection, store, signer: feeKey, isLeader: () => worker.isLeader(), followMs: 1000, lookupTables: () => loadLookupTables(rpc.connection, lookupTables) })
    return { feeKey, claimJournal, buyJournal }
  }

  const ensureOutputMint = async (owner: PublicKey) => {
    if (!env.TOKEN_MINT) throw new Error('Set TOKEN_MINT before enabling buybacks.')
    if (cachedOutput && cachedOutput.mint.toBase58() === env.TOKEN_MINT) return cachedOutput
    const mint = new PublicKey(env.TOKEN_MINT)
    const info = await rpc.connection.getAccountInfo(mint, 'confirmed')
    if (!info) throw new Error('The configured buyback mint does not exist.')
    const program = info.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID
    const unpacked: Mint = unpackMint(mint, info, program)
    const ata = getAssociatedTokenAddressSync(mint, owner, false, program)
    cachedOutput = { mint, program, decimals: unpacked.decimals, ata }
    return cachedOutput
  }

  const resolveDammPool = async (dbcPool: PublicKey, snap: DbcSnapshot): Promise<PublicKey | undefined> => {
    if (env.TRADING_FEE_DAMM_POOL) return new PublicKey(env.TRADING_FEE_DAMM_POOL)
    if (!snap.pool.poolState.isMigrated) return undefined
    if (cachedDammPool) return cachedDammPool
    const saved = await db.sharedProtocolState.findUnique({ where: { id: 'voynich:damm_pool' } })
    const savedAddress = (saved?.config as { dammPool?: unknown } | null)?.dammPool
    if (typeof savedAddress === 'string' && savedAddress) {
      cachedDammPool = new PublicKey(savedAddress)
      return cachedDammPool
    }
    const found = await findMigration(dbc!, damm!, dbcPool)
    await db.sharedProtocolState.upsert({
      where: { id: 'voynich:damm_pool' },
      create: { id: 'voynich:damm_pool', currentSlot: 0n, config: { dammPool: found.pool.toBase58(), signature: found.signature } },
      update: { config: { dammPool: found.pool.toBase58(), signature: found.signature } },
    })
    cachedDammPool = found.pool
    return cachedDammPool
  }

  const claimTradingFees = async (now: number) => {
    if (!env.TRADING_FEE_DBC_POOL || !env.TRADING_FEE_BUYBACK_BPS || env.TRADING_FEE_BUYBACK_BPS <= 0 || !env.TOKEN_MINT || env.CLUSTER === 'localnet') return
    const { feeKey: recipient, claimJournal: cj } = await ensureFeeKey()
    const out = await ensureOutputMint(recipient.publicKey)
    dbc ??= createDbc(rpc.connection, 'confirmed')
    damm ??= createDamm(rpc.connection, 'confirmed')

    const buildClaimIxs = async (item: { key: string; venue: string; pool: string }) => {
      if (item.venue === 'dbc') {
        return creatorFeeClaims(dbc!, damm!, { creator: recipient.publicKey, dbcPool: new PublicKey(item.pool) })
      }
      if (item.venue === 'damm') {
        const position = item.key.split(':')[2]
        if (!position) throw new Error('DAMM claim key missing position address.')
        return dammPositionClaimInstructions(damm!, { pool: new PublicKey(item.pool), position: new PublicKey(position), creator: recipient.publicKey })
      }
      throw new Error(`Unknown trading fee claim venue: ${item.venue}`)
    }

    const finalizeClaim = async (item: { key: string; venue: string; pool: string; claimKey: string; buybackBps: number }) => {
      let txRow = await store.get(item.claimKey)
      if (txRow?.state === 'failed') {
        await db.tradingFeeClaim.update({ where: { key: item.key }, data: { state: 'failed' } })
        return
      }
      if (!txRow || txRow.state !== 'confirmed') {
        const res = await cj.execute(item.claimKey, () => buildClaimIxs(item))
        if (res !== 'confirmed') return
        txRow = await store.get(item.claimKey)
      }
      if (!txRow || txRow.state !== 'confirmed') return
      const tx = await rpc.connection.getTransaction(txRow.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })
      if (!tx?.meta) throw new Error('The confirmed trading fee claim metadata is not readable yet.')
      const staticKeys = tx.transaction.message.staticAccountKeys.map(k => k.toBase58())
      const { claimedSol, claimedBase } = parseClaimedBalances(tx.meta, recipient.publicKey.toBase58(), out.mint.toBase58(), staticKeys)
      const buybackSol = buybackShareOf(claimedSol, item.buybackBps)
      const buybackBase = buybackShareOf(claimedBase, item.buybackBps)
      if (buybackBase > 0n) {
        const burnRes = await cj.execute(`${item.key}:burn-base`, () => [
          createBurnCheckedInstruction(out.ata, out.mint, recipient.publicKey, buybackBase, out.decimals, [], out.program),
        ])
        if (burnRes !== 'confirmed') return
      }
      await db.tradingFeeClaim.update({
        where: { key: item.key },
        data: { claimedAmount: String(claimedSol), buybackAmount: String(buybackSol), state: 'claimed' },
      })
      console.log(JSON.stringify({
        event: 'trading_fee.claimed',
        venue: item.venue,
        pool: item.pool,
        signature: txRow.signature,
        claimedLamports: String(claimedSol),
        buybackLamports: String(buybackSol),
        claimedBaseUnits: String(claimedBase),
        burnedBaseUnits: String(buybackBase),
        buybackBps: item.buybackBps,
      }))
    }

    for (const item of await db.tradingFeeClaim.findMany({ where: { state: 'claiming' }, orderBy: { createdAt: 'asc' } })) {
      await finalizeClaim(item)
    }
    if (await db.tradingFeeClaim.count({ where: { state: 'claiming' } })) return

    const interval = (env.TRADING_FEE_CLAIM_INTERVAL_SECONDS ?? 600) * 1000
    const epoch = Math.floor(now / interval)
    const minLamports = BigInt(env.TRADING_FEE_CLAIM_MIN_LAMPORTS ?? '50000000')
    const dbcPool = new PublicKey(env.TRADING_FEE_DBC_POOL)
    const snap = await dbc.snapshot(dbcPool)
    if (!snap.pool.poolState.creator.equals(recipient.publicKey)) {
      throw new Error('TRADING_FEE_DBC_POOL creator does not match FEE_RECIPIENT_KEYPAIR.')
    }
    const dammPool = await resolveDammPool(dbcPool, snap)
    const owed = await creatorFeeAmounts(dbc, damm, { dbcPool, creator: recipient.publicKey, dammPool })

    if (owed.curve.quote >= minLamports || owed.curve.base > 0n) {
      const key = `claim:dbc:${epoch}`
      if (!await db.tradingFeeClaim.findUnique({ where: { key } })) {
        const item = await db.tradingFeeClaim.create({
          data: { key, pool: dbcPool.toBase58(), venue: 'dbc', claimKey: key, mint: null, buybackBps: env.TRADING_FEE_BUYBACK_BPS, state: 'claiming' },
        })
        await finalizeClaim(item)
      }
      return
    }

    if (dammPool && (owed.positions.quote >= minLamports || owed.positions.base > 0n)) {
      const position = await findClaimableDammPosition(dbc, damm, { dbcPool, dammPool, creator: recipient.publicKey, minLamports })
      if (position) {
        const key = `claim:damm:${position.toBase58()}:${epoch}`
        if (!await db.tradingFeeClaim.findUnique({ where: { key } })) {
          const item = await db.tradingFeeClaim.create({
            data: { key, pool: dammPool.toBase58(), venue: 'damm', claimKey: key, mint: null, buybackBps: env.TRADING_FEE_BUYBACK_BPS, state: 'claiming' },
          })
          await finalizeClaim(item)
        }
      }
    }
  }

  const buyback = async (now: number) => {
    if (!env.TOKEN_MINT || env.CLUSTER === 'localnet') return
    if (env.BUYBACK_INTERVAL_SECONDS === undefined || env.BUYBACK_RESERVE_LAMPORTS === undefined || env.BUYBACK_SLIPPAGE_BPS === undefined) throw new Error('Set BUYBACK_INTERVAL_SECONDS, BUYBACK_RESERVE_LAMPORTS and BUYBACK_SLIPPAGE_BPS before enabling buybacks.')
    const { feeKey: recipient, buyJournal: bj } = await ensureFeeKey()
    const out = await ensureOutputMint(recipient.publicKey)

    // Finish every persisted purchase before spending another atom. Transaction metadata,
    // rather than a wallet's current balance, identifies exactly what that swap acquired.
    for (const item of await db.buyback.findMany({ where: { state: { in: ['purchasing', 'purchased'] } }, orderBy: { createdAt: 'asc' } })) {
      if (item.mint !== env.TOKEN_MINT) throw new Error('Finish outstanding purchases before changing TOKEN_MINT.')
      lookupTables = item.lookupTables.map(value => new PublicKey(value))
      const swap = await store.get(item.swapKey)
      if (swap?.state === 'failed') {
        await db.buyback.update({ where: { key: item.key }, data: { state: 'failed' } })
        continue
      }
      if (!swap || swap.state !== 'confirmed') {
        await bj.execute(item.swapKey, () => (item.instructions as unknown as WireInstruction[]).map(instructionFromWire))
        continue
      }
      let amount = item.acquiredAmount === null ? null : BigInt(item.acquiredAmount.toFixed(0))
      if (amount === null) {
        const transaction = await rpc.connection.getTransaction(swap.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })
        if (!transaction?.meta) throw new Error('The confirmed swap metadata is not readable yet.')
        const balances = (rows: typeof transaction.meta.preTokenBalances) => (rows ?? []).filter(row => row.mint === item.mint && row.owner === recipient.publicKey.toBase58()).reduce((sum, row) => sum + BigInt(row.uiTokenAmount.amount), 0n)
        amount = balances(transaction.meta.postTokenBalances) - balances(transaction.meta.preTokenBalances)
        if (amount <= 0n) throw new Error('The confirmed swap acquired no protocol tokens.')
        await db.buyback.update({ where: { key: item.key }, data: { acquiredAmount: String(amount), state: 'purchased' } })
      }
      const result = await bj.execute(item.burnKey, () => [createBurnCheckedInstruction(out.ata, out.mint, recipient.publicKey, amount!, out.decimals, [], out.program)])
      if (result === 'confirmed') {
        await db.buyback.update({ where: { key: item.key }, data: { state: 'burned' } })
        console.log(JSON.stringify({ event: 'buyback.burned', key: item.key, mint: item.mint, inputMint: item.inputMint, inputAmount: item.inputAmount.toFixed(0), burnedAmount: String(amount), swapSignature: swap.signature }))
      }
    }
    if (await db.buyback.count({ where: { state: { in: ['purchasing', 'purchased'] } } })) return
    const interval = env.BUYBACK_INTERVAL_SECONDS * 1000
    const epoch = Math.floor(now / interval)
    const fees = await db.payment.groupBy({ by: ['mint'], where: { role: 'protocol', recipient: recipient.publicKey.toBase58() }, _sum: { amount: true } })
    const tradingAgg = await db.tradingFeeClaim.aggregate({ where: { state: 'claimed', mint: null }, _sum: { buybackAmount: true } })
    const credits = combineBuybackCredits(
      fees.map(fee => ({ mint: fee.mint, amount: BigInt(fee._sum.amount?.toFixed(0) ?? '0') })),
      BigInt(tradingAgg._sum.buybackAmount?.toFixed(0) ?? '0'),
    )
    for (const fee of credits) {
      if (fee.mint === env.TOKEN_MINT) continue
      const spent = await db.buyback.aggregate({ where: { inputMint: fee.mint, state: { not: 'failed' } }, _sum: { inputAmount: true } })
      let amount = fee.amount - BigInt(spent._sum.inputAmount?.toFixed(0) ?? '0')
      if (env.BUYBACK_AMOUNT_BASE_UNITS !== undefined && amount > BigInt(env.BUYBACK_AMOUNT_BASE_UNITS)) amount = BigInt(env.BUYBACK_AMOUNT_BASE_UNITS)
      if (amount <= 0n) continue
      if (fee.mint === null) {
        const reserve = BigInt(await rpc.connection.getMinimumBalanceForRentExemption(0)) + BigInt(env.BUYBACK_RESERVE_LAMPORTS)
        const balance = await rpc.call<{ value: number | string }>('getBalance', [recipient.publicKey.toBase58(), { commitment: 'confirmed' }])
        const available = BigInt(balance.value) - reserve
        amount = amount < available ? amount : available
      } else {
        const source = getAssociatedTokenAddressSync(new PublicKey(fee.mint), recipient.publicKey)
        if (!await rpc.connection.getAccountInfo(source, 'confirmed')) continue
        const available = BigInt((await rpc.connection.getTokenAccountBalance(source, 'confirmed')).value.amount)
        amount = amount < available ? amount : available
      }
      if (amount <= 0n) continue
      const key = `buyback:${fee.mint ?? 'SOL'}:${epoch}`
      if (await db.buyback.findUnique({ where: { key } })) continue
      const quote = await quoteExactIn(jupiter, { inputMint: fee.mint ? new PublicKey(fee.mint) : NATIVE_MINT, outputMint: out.mint, amount, slippageBps: env.BUYBACK_SLIPPAGE_BPS, maxAccounts: 40 })
      const route = await swapInstructions(jupiter, { quote, taker: recipient.publicKey, destination: out.ata })
      lookupTables = route.lookupTables
      await db.buyback.create({ data: { key, mint: env.TOKEN_MINT, inputMint: fee.mint, inputAmount: String(amount), instructions: [...route.setup, route.swap, ...route.cleanup].map(wire) as unknown as Prisma.InputJsonValue, lookupTables: lookupTables.map(value => value.toBase58()), state: 'purchasing', swapKey: `${key}:swap`, burnKey: `${key}:burn` } })
      await bj.execute(`${key}:swap`, () => [...route.setup, route.swap, ...route.cleanup])
      break
    }
  }

  const scheduler = createScheduler([
    { name: 'resume', everyMs: 0, run: () => journal.resume() },
    { name: 'refunds', everyMs: 2000, run: refund },
    { name: 'sessions', everyMs: 5000, run: sweepSessions },
    { name: 'trading-fees', everyMs: 30_000, run: claimTradingFees },
    { name: 'buybacks', everyMs: 5000, run: buyback },
  ], { onError: (task, error) => console.error(JSON.stringify({ event: 'crank_task_failed', task, name: error instanceof Error ? error.name : 'Error', message: error instanceof Error ? error.message.replace(/https?:\/\/\S+/g, '[url]') : 'Unknown error' })) })
  worker = createKeeperRuntime({ lease: { acquire: () => lease.acquire(), renew: async () => lease.held, release: () => lease.release() }, leaseMs: 15000, tickMs: 1000, gate: async () => runtime.readiness.status() === 'ready' ? 'ready' : 'waiting', tick: () => scheduler.tick(), log: entry => console.log(JSON.stringify(entry)) })
  void worker.run()
  return { stop: async () => { await worker.stop(); await lease.release() }, state: () => worker.health }
}
