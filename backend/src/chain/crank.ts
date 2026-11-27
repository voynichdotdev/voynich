import { readFileSync } from 'node:fs'
import { Keypair, PublicKey, SystemProgram, type TransactionInstruction } from '@solana/web3.js'
import type { Prisma } from '@prisma/client'
import { createAssociatedTokenAccountIdempotentInstruction, createBurnCheckedInstruction, createCloseAccountInstruction, createSyncNativeInstruction, getAssociatedTokenAddressSync, NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, unpackMint, type Mint } from '@solana/spl-token'
import { bondPda, decodeBondAccount, decodeCallAccount, decodePassAccount, decodeSessionAccount, eventAccounts, type DecodedCallAccount, type DecodedPassAccount, type DecodedSessionAccount } from 'voynich/program'
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
import { ata as launchlabAta, creatorFeeShareAddress, creatorFeeVault } from '../engines/launchpad/launchlab/addresses.js'
import { curveFeeRates, curveState, readGlobalConfig, readPlatformConfig, readPoolState, type PlatformConfig, type PoolState } from '../engines/launchpad/launchlab/accounts.js'
import { claimCreatorFeeInstruction, unwrapAfterClaim } from '../engines/launchpad/launchlab/fees.js'
import { tradeInstructions } from '../engines/launchpad/launchlab/trade.js'
import { collectCreatorFeeInstruction, cpmmRates, cpmmSwapInstruction, creatorFeeShareRate, decodeAmmConfig, decodeCpmmPool, swapPaysCreatorFeeOnInput } from '../engines/launchpad/launchlab/cpmm.js'
import { cpmmCreatorOf, migratedPoolFromTransaction } from '../engines/launchpad/launchlab/migration.js'
import { buyExactIn as quoteCurveBuyExactIn } from '../engines/launchpad/curve/launchlab.js'
import { cpmmReserves, creatorFeePayout, swapBaseInput as quoteCpmmSwapBaseInput } from '../engines/launchpad/curve/cpmm.js'
import { minimumOut } from '../engines/launchpad/curve/math.js'
import { buybackShareOf, combineBuybackCredits, creatorBuybackAfterGas, creatorVolumeShareOf, dammPositionClaimInstructions, findClaimableDammPosition, parseClaimedBalances, parseCreatorClaimedBalances } from './trading-fees.js'
import type { ChainRuntime } from '../runtime.js'

const CREATOR_BUYBACK_PREFIX = 'buyback:creator:'
const CREATOR_WALLET_RESERVE_LAMPORTS = 50_000_000n
const tokenBalanceFromAccount = (data: Buffer | undefined) => (data && data.length >= 72 ? data.readBigUInt64LE(64) : 0n)

const wire = (instruction: TransactionInstruction): WireInstruction => ({ programId: instruction.programId.toBase58(), accounts: instruction.keys.map(key => ({ pubkey: key.pubkey.toBase58(), isSigner: key.isSigner, isWritable: key.isWritable })), data: instruction.data.toString('base64') })

export function refundCallerTokenAccount(priceMint: PublicKey, caller: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(priceMint, caller, true)
}

export async function buildExpiredCallRefundInstructions(
  voynichProgram: ChainRuntime['programs']['voynich'],
  actor: PublicKey,
  callKey: PublicKey,
  chainCall: Pick<DecodedCallAccount, 'caller' | 'priceMint'>,
  bondKey?: PublicKey | null,
): Promise<TransactionInstruction[]> {
  const token = !chainCall.priceMint.equals(PublicKey.default)
  const callerTokens = token ? refundCallerTokenAccount(chainCall.priceMint, chainCall.caller) : null
  const builder = voynichProgram.methods.refundCall().accountsStrict({
    actor,
    call: callKey,
    caller: chainCall.caller,
    escrowTokens: token ? getAssociatedTokenAddressSync(chainCall.priceMint, callKey, true) : null,
    callerTokens,
    tokenProgram: token ? TOKEN_PROGRAM_ID : null,
    ...eventAccounts(voynichProgram.programId),
  })
  const refundIx = await (bondKey
    ? builder.remainingAccounts([{ pubkey: bondKey, isWritable: true, isSigner: false }])
    : builder
  ).instruction()
  return [
    ...(token ? [createAssociatedTokenAccountIdempotentInstruction(actor, callerTokens!, chainCall.caller, chainCall.priceMint)] : []),
    refundIx,
  ]
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

export async function buildExpiredPassCloseInstructions(
  voynichProgram: ChainRuntime['programs']['voynich'],
  closer: PublicKey,
  passKey: PublicKey,
  chainPass: Pick<DecodedPassAccount, 'holder' | 'mint'>,
): Promise<TransactionInstruction[]> {
  const token = !chainPass.mint.equals(PublicKey.default)
  const holderTokens = token ? getAssociatedTokenAddressSync(chainPass.mint, chainPass.holder, true) : null
  return [
    ...(token ? [createAssociatedTokenAccountIdempotentInstruction(closer, holderTokens!, chainPass.holder, chainPass.mint)] : []),
    await voynichProgram.methods
      .closePass()
      .accountsStrict({
        closer,
        pass: passKey,
        holder: chainPass.holder,
        passEscrow: token ? getAssociatedTokenAddressSync(chainPass.mint, passKey, true) : null,
        holderTokens,
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
      const callKey = new PublicKey(call.address)
      const candidateBond = bondPda(chainCall.enclave, programs.voynich.programId)
      const bondInfo = await rpc.connection.getAccountInfo(candidateBond, 'confirmed')
      let activeBond: PublicKey | null = null
      if (bondInfo && bondInfo.owner.equals(programs.voynich.programId)) {
        try {
          if (BigInt(decodeBondAccount(bondInfo.data).bondedLamports.toString()) > 0n) activeBond = candidateBond
        } catch {}
      }
      await journal.execute(`refund:${call.address}`, () =>
        buildExpiredCallRefundInstructions(programs.voynich, keeper.publicKey, callKey, chainCall, activeBond),
      )
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

  const sweepPasses = async () => {
    const slot = await runtime.readModel.currentSlot()
    const openPasses = await db.pass.findMany({ where: { status: 'open' }, orderBy: { expiresAtSlot: 'asc' }, take: 100 })
    const closable = openPasses.filter(p => p.expiresAtSlot < slot || p.callsUsed >= p.callsTotal).slice(0, 50)
    await Promise.all(closable.map(passRow => scheduler.safely(`close-pass:${passRow.address}`, async () => {
      const passKey = new PublicKey(passRow.address)
      const info = await rpc.connection.getAccountInfo(passKey, 'confirmed')
      if (!info || !info.owner.equals(programs.voynich.programId)) return
      const chainPass = decodePassAccount(info.data)
      if (chainPass.status !== 'open') return
      const expired = slot > BigInt(chainPass.expiresAtSlot.toString())
      const exhausted = chainPass.callsUsed >= chainPass.callsTotal
      if (!expired && !exhausted) return
      await journal.execute(`close-pass:${passRow.address}`, () =>
        buildExpiredPassCloseInstructions(programs.voynich, keeper.publicKey, passKey, chainPass),
      )
    })))
  }

  let feeKey: Keypair | undefined
  let claimJournal: ReturnType<typeof createJournal> | undefined
  let buyJournal: ReturnType<typeof createJournal> | undefined
  let cachedOutput: { mint: PublicKey; program: PublicKey; decimals: number; ata: PublicKey } | undefined
  let creatorSigner: Keypair | undefined
  let creatorClaimJournal: ReturnType<typeof createJournal> | undefined
  let creatorBuyJournal: ReturnType<typeof createJournal> | undefined
  let cachedCreatorOutput: { mint: PublicKey; program: PublicKey; decimals: number; ata: PublicKey } | undefined
  let cachedCpmmPool: { launchlabPool: string; cpmmPool: PublicKey } | undefined
  let dbc: Dbc | undefined
  let damm: Damm | undefined
  let cachedDammPool: PublicKey | undefined
  let lookupTables: PublicKey[] = []
  let creatorLookupTables: PublicKey[] = []
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

  const ensureCreatorKey = () => {
    creatorSigner ??= readKey(env.LAUNCHLAB_CREATOR_KEYPAIR, 'LAUNCHLAB_CREATOR_KEYPAIR')
    creatorClaimJournal ??= createJournal({ connection: rpc.connection, store, signer: creatorSigner, isLeader: () => worker.isLeader(), followMs: 5000 })
    creatorBuyJournal ??= createJournal({ connection: rpc.connection, store, signer: creatorSigner, isLeader: () => worker.isLeader(), followMs: 1000, lookupTables: () => loadLookupTables(rpc.connection, creatorLookupTables) })
    return { creatorSigner, creatorClaimJournal, creatorBuyJournal }
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

  const ensureCreatorOutputMint = async (owner: PublicKey) => {
    if (!env.TOKEN_MINT) throw new Error('Set TOKEN_MINT before enabling buybacks.')
    if (cachedCreatorOutput && cachedCreatorOutput.mint.toBase58() === env.TOKEN_MINT) return cachedCreatorOutput
    const mint = new PublicKey(env.TOKEN_MINT)
    const info = await rpc.connection.getAccountInfo(mint, 'confirmed')
    if (!info) throw new Error('The configured buyback mint does not exist.')
    const program = info.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID
    const unpacked: Mint = unpackMint(mint, info, program)
    const ata = getAssociatedTokenAddressSync(mint, owner, false, program)
    cachedCreatorOutput = { mint, program, decimals: unpacked.decimals, ata }
    return cachedCreatorOutput
  }

  const resolveCpmmPool = async (llPool: PublicKey, poolState: PoolState, platform: PlatformConfig): Promise<PublicKey | undefined> => {
    if (env.TRADING_FEE_CPMM_POOL) return new PublicKey(env.TRADING_FEE_CPMM_POOL)
    if (poolState.status !== 2) return undefined
    const llBase58 = llPool.toBase58()
    if (cachedCpmmPool?.launchlabPool === llBase58) return cachedCpmmPool.cpmmPool
    const saved = await db.sharedProtocolState.findUnique({ where: { id: 'voynich:cpmm_pool' } })
    const savedCfg = saved?.config as { launchlabPool?: unknown; cpmmPool?: unknown } | null
    if (savedCfg?.launchlabPool === llBase58 && typeof savedCfg.cpmmPool === 'string' && savedCfg.cpmmPool) {
      const resolved = new PublicKey(savedCfg.cpmmPool)
      cachedCpmmPool = { launchlabPool: llBase58, cpmmPool: resolved }
      return resolved
    }
    const expectedCreator = cpmmCreatorOf(platform, poolState)
    const sigs = await rpc.connection.getSignaturesForAddress(llPool, { limit: 25 }, 'confirmed')
    for (const entry of sigs) {
      if (entry.err) continue
      const tx = await rpc.connection.getTransaction(entry.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })
      const found = tx ? migratedPoolFromTransaction(tx, llPool) : null
      if (!found) continue
      const foundInfo = await rpc.connection.getAccountInfo(found, 'confirmed')
      const decoded = decodeCpmmPool(found, foundInfo)
      if (!decoded.poolCreator.equals(expectedCreator)) continue
      await db.sharedProtocolState.upsert({
        where: { id: 'voynich:cpmm_pool' },
        create: { id: 'voynich:cpmm_pool', currentSlot: 0n, config: { launchlabPool: llBase58, cpmmPool: found.toBase58(), signature: entry.signature } },
        update: { config: { launchlabPool: llBase58, cpmmPool: found.toBase58(), signature: entry.signature } },
      })
      cachedCpmmPool = { launchlabPool: llBase58, cpmmPool: found }
      return found
    }
    return undefined
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

    for (const item of await db.tradingFeeClaim.findMany({ where: { state: 'claiming', venue: { in: ['dbc', 'damm'] } }, orderBy: { createdAt: 'asc' } })) {
      await finalizeClaim(item)
    }
    if (await db.tradingFeeClaim.count({ where: { state: 'claiming', venue: { in: ['dbc', 'damm'] } } })) return

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

  const claimLaunchlabCreatorFees = async (now: number) => {
    if (!env.LAUNCHLAB_CREATOR_KEYPAIR || !env.TRADING_FEE_LAUNCHLAB_POOL || !env.TOKEN_MINT || env.CLUSTER === 'localnet') return
    const targetVolumePpm = BigInt(env.TRADING_FEE_CREATOR_VOLUME_PPM ?? 5_000)
    if (targetVolumePpm <= 0n) return
    const { creatorSigner: creator, creatorClaimJournal: cj } = ensureCreatorKey()
    const out = await ensureCreatorOutputMint(creator.publicKey)
    const wsolAta = launchlabAta(creator.publicKey, NATIVE_MINT)

    const readCreatorRates = async (venue: string, poolAddr: string) => {
      if (venue === 'launchlab') {
        const p = await readPoolState(rpc.connection, new PublicKey(poolAddr))
        const plat = await readPlatformConfig(rpc.connection, p.platformConfig)
        return { grossCreatorRatePpm: plat.creatorFeeRate, protocolShareRatePpm: 0n }
      }
      if (venue === 'cpmm') {
        const pk = new PublicKey(poolAddr)
        const cpmm = decodeCpmmPool(pk, await rpc.connection.getAccountInfo(pk, 'confirmed'))
        const [ammInfo, shareInfo] = await rpc.connection.getMultipleAccountsInfo([cpmm.ammConfig, creatorFeeShareAddress(cpmm.poolCreator, cpmm.ammConfig)], 'confirmed')
        const amm = decodeAmmConfig(ammInfo)
        const share = creatorFeeShareRate(amm, shareInfo, cpmm.poolCreator, cpmm.ammConfig)
        return { grossCreatorRatePpm: amm.creatorFeeRate, protocolShareRatePpm: share }
      }
      throw new Error(`Unsupported creator fee venue: ${venue}`)
    }

    const buildCreatorClaimIxs = async (item: { venue: string; pool: string }) => {
      if (item.venue === 'launchlab') {
        return [
          claimCreatorFeeInstruction({ creator: creator.publicKey, quoteMint: NATIVE_MINT }),
          ...unwrapAfterClaim(creator.publicKey, NATIVE_MINT),
        ]
      }
      if (item.venue === 'cpmm') {
        const pk = new PublicKey(item.pool)
        const cpmm = decodeCpmmPool(pk, await rpc.connection.getAccountInfo(pk, 'confirmed'))
        return [
          createAssociatedTokenAccountIdempotentInstruction(creator.publicKey, wsolAta, creator.publicKey, NATIVE_MINT),
          collectCreatorFeeInstruction(cpmm),
          ...unwrapAfterClaim(creator.publicKey, NATIVE_MINT),
        ]
      }
      throw new Error(`Unsupported creator fee venue: ${item.venue}`)
    }

    const finalizeCreatorClaim = async (item: { key: string; venue: string; pool: string; claimKey: string }) => {
      let txRow = await store.get(item.claimKey)
      if (txRow?.state === 'failed') {
        await db.tradingFeeClaim.update({ where: { key: item.key }, data: { state: 'failed' } })
        return
      }
      if (!txRow || txRow.state !== 'confirmed') {
        const res = await cj.execute(item.claimKey, () => buildCreatorClaimIxs(item))
        if (res !== 'confirmed') return
        txRow = await store.get(item.claimKey)
      }
      if (!txRow || txRow.state !== 'confirmed') return
      const tx = await rpc.connection.getTransaction(txRow.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })
      if (!tx?.meta) throw new Error('The confirmed creator fee claim metadata is not readable yet.')
      const staticKeys = tx.transaction.message.staticAccountKeys.map(k => k.toBase58())
      const { claimedSol, claimedBase } = parseCreatorClaimedBalances(
        tx.meta,
        creator.publicKey.toBase58(),
        wsolAta.toBase58(),
        out.ata.toBase58(),
        out.mint.toBase58(),
        staticKeys,
      )
      const rates = await readCreatorRates(item.venue, item.pool)
      const solShare = creatorVolumeShareOf(claimedSol, rates.grossCreatorRatePpm, rates.protocolShareRatePpm, targetVolumePpm)
      const buybackSol = creatorBuybackAfterGas(solShare.buybackAmount, BigInt(tx.meta.fee ?? 5_000))
      const baseShare = creatorVolumeShareOf(claimedBase, rates.grossCreatorRatePpm, rates.protocolShareRatePpm, targetVolumePpm)
      const buybackBase = baseShare.buybackAmount
      if (buybackBase > 0n) {
        const burnRes = await cj.execute(`${item.key}:burn-base`, () => [
          createBurnCheckedInstruction(out.ata, out.mint, creator.publicKey, buybackBase, out.decimals, [], out.program),
        ])
        if (burnRes !== 'confirmed') return
      }
      await db.tradingFeeClaim.update({
        where: { key: item.key },
        data: { claimedAmount: String(claimedSol), buybackAmount: String(buybackSol), buybackBps: solShare.effectiveBps, state: 'claimed' },
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
        buybackBps: solShare.effectiveBps,
      }))
    }

    for (const item of await db.tradingFeeClaim.findMany({ where: { state: 'claiming', venue: { in: ['launchlab', 'cpmm'] } }, orderBy: { createdAt: 'asc' } })) {
      await finalizeCreatorClaim(item)
    }
    if (await db.tradingFeeClaim.count({ where: { state: 'claiming', venue: { in: ['launchlab', 'cpmm'] } } })) return

    const interval = (env.TRADING_FEE_CLAIM_INTERVAL_SECONDS ?? 300) * 1000
    const epoch = Math.floor(now / interval)
    const minLamports = BigInt(env.TRADING_FEE_CLAIM_MIN_LAMPORTS ?? '50000000')
    const llPoolPk = new PublicKey(env.TRADING_FEE_LAUNCHLAB_POOL)
    const pool = await readPoolState(rpc.connection, llPoolPk)
    if (!pool.creator.equals(creator.publicKey)) {
      throw new Error('TRADING_FEE_LAUNCHLAB_POOL creator does not match LAUNCHLAB_CREATOR_KEYPAIR.')
    }
    const platform = await readPlatformConfig(rpc.connection, pool.platformConfig)
    const vaultPk = creatorFeeVault(creator.publicKey, NATIVE_MINT)
    const vaultInfo = await rpc.connection.getAccountInfo(vaultPk, 'confirmed')
    const vaultWsol = tokenBalanceFromAccount(vaultInfo?.data)
    const curveThreshold = pool.status === 2 ? 5_000_000n : minLamports

    if (vaultWsol >= curveThreshold) {
      const key = `claim:launchlab:${llPoolPk.toBase58()}:${epoch}`
      if (!await db.tradingFeeClaim.findUnique({ where: { key } })) {
        const share = creatorVolumeShareOf(vaultWsol, platform.creatorFeeRate, 0n, targetVolumePpm)
        const item = await db.tradingFeeClaim.create({
          data: { key, pool: llPoolPk.toBase58(), venue: 'launchlab', claimKey: key, mint: null, buybackBps: share.effectiveBps, state: 'claiming' },
        })
        await finalizeCreatorClaim(item)
      }
      return
    }

    if (pool.status !== 2) return
    const cpmmPoolPk = await resolveCpmmPool(llPoolPk, pool, platform)
    if (!cpmmPoolPk) return
    const cpmm = decodeCpmmPool(cpmmPoolPk, await rpc.connection.getAccountInfo(cpmmPoolPk, 'confirmed'))
    if (!cpmm.poolCreator.equals(creator.publicKey)) {
      throw new Error('Graduated CPMM pool creator does not match LAUNCHLAB_CREATOR_KEYPAIR.')
    }
    const [ammInfo, shareInfo] = await rpc.connection.getMultipleAccountsInfo([cpmm.ammConfig, creatorFeeShareAddress(cpmm.poolCreator, cpmm.ammConfig)], 'confirmed')
    const amm = decodeAmmConfig(ammInfo)
    const shareRate = creatorFeeShareRate(amm, shareInfo, cpmm.poolCreator, cpmm.ammConfig)
    const wsolGross = cpmm.mint0.equals(NATIVE_MINT) ? cpmm.creatorFees0 : cpmm.mint1.equals(NATIVE_MINT) ? cpmm.creatorFees1 : 0n
    const wsolNet = creatorFeePayout(wsolGross, shareRate).creator

    if (wsolNet >= minLamports) {
      const key = `claim:cpmm:${cpmmPoolPk.toBase58()}:${epoch}`
      if (!await db.tradingFeeClaim.findUnique({ where: { key } })) {
        const share = creatorVolumeShareOf(wsolNet, amm.creatorFeeRate, shareRate, targetVolumePpm)
        const item = await db.tradingFeeClaim.create({
          data: { key, pool: cpmmPoolPk.toBase58(), venue: 'cpmm', claimKey: key, mint: null, buybackBps: share.effectiveBps, state: 'claiming' },
        })
        await finalizeCreatorClaim(item)
      }
    }
  }

  const buybackCreatorFees = async (now: number) => {
    if (!env.LAUNCHLAB_CREATOR_KEYPAIR || !env.TRADING_FEE_LAUNCHLAB_POOL || !env.TOKEN_MINT || env.CLUSTER === 'localnet') return
    if (env.BUYBACK_INTERVAL_SECONDS === undefined || env.BUYBACK_SLIPPAGE_BPS === undefined) return
    const { creatorSigner: creator, creatorBuyJournal: bj } = ensureCreatorKey()
    const out = await ensureCreatorOutputMint(creator.publicKey)

    for (const item of await db.buyback.findMany({ where: { key: { startsWith: CREATOR_BUYBACK_PREFIX }, state: { in: ['purchasing', 'purchased'] } }, orderBy: { createdAt: 'asc' } })) {
      const itemMintPk = new PublicKey(item.mint)
      const itemInfo = item.mint === env.TOKEN_MINT ? null : await rpc.connection.getAccountInfo(itemMintPk, 'confirmed')
      const itemProgram = item.mint === env.TOKEN_MINT ? out.program : (itemInfo?.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID)
      const itemDecimals = item.mint === env.TOKEN_MINT ? out.decimals : (itemInfo ? unpackMint(itemMintPk, itemInfo, itemProgram).decimals : 6)
      const itemAta = item.mint === env.TOKEN_MINT ? out.ata : getAssociatedTokenAddressSync(itemMintPk, creator.publicKey, false, itemProgram)
      creatorLookupTables = item.lookupTables.map(value => new PublicKey(value))
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
        if (!transaction?.meta) throw new Error('The confirmed creator swap metadata is not readable yet.')
        const balances = (rows: typeof transaction.meta.preTokenBalances) => (rows ?? []).filter(row => row.mint === item.mint && row.owner === creator.publicKey.toBase58()).reduce((sum, row) => sum + BigInt(row.uiTokenAmount.amount), 0n)
        amount = balances(transaction.meta.postTokenBalances) - balances(transaction.meta.preTokenBalances)
        if (amount <= 0n) throw new Error('The confirmed creator swap acquired no protocol tokens.')
        await db.buyback.update({ where: { key: item.key }, data: { acquiredAmount: String(amount), state: 'purchased' } })
      }
      const result = await bj.execute(item.burnKey, () => [createBurnCheckedInstruction(itemAta, itemMintPk, creator.publicKey, amount!, itemDecimals, [], itemProgram)])
      if (result === 'confirmed') {
        await db.buyback.update({ where: { key: item.key }, data: { state: 'burned' } })
        console.log(JSON.stringify({ event: 'buyback.burned', source: 'creator_fee', key: item.key, mint: item.mint, inputMint: item.inputMint, inputAmount: item.inputAmount.toFixed(0), burnedAmount: String(amount), swapSignature: swap.signature }))
      }
    }
    if (await db.buyback.count({ where: { key: { startsWith: CREATOR_BUYBACK_PREFIX }, state: { in: ['purchasing', 'purchased'] } } })) return

    const interval = env.BUYBACK_INTERVAL_SECONDS * 1000
    const epoch = Math.floor(now / interval)
    const claimedAgg = await db.tradingFeeClaim.aggregate({ where: { state: 'claimed', mint: null, venue: { in: ['launchlab', 'cpmm'] } }, _sum: { buybackAmount: true } })
    const spentAgg = await db.buyback.aggregate({ where: { key: { startsWith: CREATOR_BUYBACK_PREFIX }, inputMint: null, state: { not: 'failed' } }, _sum: { inputAmount: true } })
    let amount = BigInt(claimedAgg._sum.buybackAmount?.toFixed(0) ?? '0') - BigInt(spentAgg._sum.inputAmount?.toFixed(0) ?? '0')
    if (env.BUYBACK_AMOUNT_BASE_UNITS !== undefined && amount > BigInt(env.BUYBACK_AMOUNT_BASE_UNITS)) amount = BigInt(env.BUYBACK_AMOUNT_BASE_UNITS)
    if (amount <= 0n) return

    const balance = await rpc.call<{ value: number | string }>('getBalance', [creator.publicKey.toBase58(), { commitment: 'confirmed' }])
    const available = BigInt(balance.value) - CREATOR_WALLET_RESERVE_LAMPORTS
    if (available < amount) amount = available
    if (amount <= 0n) return

    const key = `${CREATOR_BUYBACK_PREFIX}SOL:${epoch}`
    if (await db.buyback.findUnique({ where: { key } })) return

    let instructions: TransactionInstruction[]
    let tables: PublicKey[] = []
    let actualAmount = amount
    try {
      const quote = await quoteExactIn(jupiter, { inputMint: NATIVE_MINT, outputMint: out.mint, amount, slippageBps: env.BUYBACK_SLIPPAGE_BPS, maxAccounts: 40 })
      const route = await swapInstructions(jupiter, { quote, taker: creator.publicKey, destination: out.ata })
      instructions = [...route.setup, route.swap, ...route.cleanup]
      tables = route.lookupTables
    } catch {
      const llPoolPk = new PublicKey(env.TRADING_FEE_LAUNCHLAB_POOL)
      const pool = await readPoolState(rpc.connection, llPoolPk)
      const platform = await readPlatformConfig(rpc.connection, pool.platformConfig)
      if (pool.status === 0) {
        const global = await readGlobalConfig(rpc.connection, pool.globalConfig)
        const q = quoteCurveBuyExactIn(curveState(pool), amount, curveFeeRates(global, platform))
        actualAmount = q.quote
        instructions = tradeInstructions({ payer: creator.publicKey, pool, side: 'buy', amount: { exactIn: q.quote, minimumOut: minimumOut(q.base, env.BUYBACK_SLIPPAGE_BPS) } })
      } else if (pool.status === 2) {
        const cpmmPoolPk = await resolveCpmmPool(llPoolPk, pool, platform)
        if (!cpmmPoolPk) return
        const cpmm = decodeCpmmPool(cpmmPoolPk, await rpc.connection.getAccountInfo(cpmmPoolPk, 'confirmed'))
        const [v0Info, v1Info, ammInfo] = await rpc.connection.getMultipleAccountsInfo([cpmm.vault0, cpmm.vault1, cpmm.ammConfig], 'confirmed')
        const amm = decodeAmmConfig(ammInfo)
        const { reserve0, reserve1 } = cpmmReserves(tokenBalanceFromAccount(v0Info?.data), tokenBalanceFromAccount(v1Info?.data), cpmm)
        const wsolIs0 = cpmm.mint0.equals(NATIVE_MINT)
        const q = quoteCpmmSwapBaseInput(amount, wsolIs0 ? reserve0 : reserve1, wsolIs0 ? reserve1 : reserve0, cpmmRates(cpmm, amm), swapPaysCreatorFeeOnInput(cpmm, NATIVE_MINT))
        const wsolAta = launchlabAta(creator.publicKey, NATIVE_MINT)
        instructions = [
          createAssociatedTokenAccountIdempotentInstruction(creator.publicKey, out.ata, creator.publicKey, out.mint, out.program),
          createAssociatedTokenAccountIdempotentInstruction(creator.publicKey, wsolAta, creator.publicKey, NATIVE_MINT),
          SystemProgram.transfer({ fromPubkey: creator.publicKey, toPubkey: wsolAta, lamports: amount }),
          createSyncNativeInstruction(wsolAta),
          cpmmSwapInstruction({ payer: creator.publicKey, pool: cpmm, inputMint: NATIVE_MINT, amount: { exactIn: amount, minimumOut: minimumOut(q.amountOut, env.BUYBACK_SLIPPAGE_BPS) } }),
          createCloseAccountInstruction(wsolAta, creator.publicKey, creator.publicKey),
        ]
      } else {
        return
      }
    }

    creatorLookupTables = tables
    await db.buyback.create({
      data: {
        key,
        mint: env.TOKEN_MINT,
        inputMint: null,
        inputAmount: String(actualAmount),
        instructions: instructions.map(wire) as unknown as Prisma.InputJsonValue,
        lookupTables: tables.map(value => value.toBase58()),
        state: 'purchasing',
        swapKey: `${key}:swap`,
        burnKey: `${key}:burn`,
      },
    })
    await bj.execute(`${key}:swap`, () => instructions)
  }

  const buyback = async (now: number) => {
    if (!env.TOKEN_MINT || env.CLUSTER === 'localnet') return
    if (env.BUYBACK_INTERVAL_SECONDS === undefined || env.BUYBACK_RESERVE_LAMPORTS === undefined || env.BUYBACK_SLIPPAGE_BPS === undefined) throw new Error('Set BUYBACK_INTERVAL_SECONDS, BUYBACK_RESERVE_LAMPORTS and BUYBACK_SLIPPAGE_BPS before enabling buybacks.')
    const { feeKey: recipient, buyJournal: bj } = await ensureFeeKey()
    const out = await ensureOutputMint(recipient.publicKey)

    // Finish every persisted purchase before spending another atom. Transaction metadata,
    // rather than a wallet's current balance, identifies exactly what that swap acquired.
    for (const item of await db.buyback.findMany({ where: { NOT: { key: { startsWith: CREATOR_BUYBACK_PREFIX } }, state: { in: ['purchasing', 'purchased'] } }, orderBy: { createdAt: 'asc' } })) {
      const itemMintPk = new PublicKey(item.mint)
      const itemInfo = item.mint === env.TOKEN_MINT ? null : await rpc.connection.getAccountInfo(itemMintPk, 'confirmed')
      const itemProgram = item.mint === env.TOKEN_MINT ? out.program : (itemInfo?.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID)
      const itemDecimals = item.mint === env.TOKEN_MINT ? out.decimals : (itemInfo ? unpackMint(itemMintPk, itemInfo, itemProgram).decimals : 6)
      const itemAta = item.mint === env.TOKEN_MINT ? out.ata : getAssociatedTokenAddressSync(itemMintPk, recipient.publicKey, false, itemProgram)
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
      const result = await bj.execute(item.burnKey, () => [createBurnCheckedInstruction(itemAta, itemMintPk, recipient.publicKey, amount!, itemDecimals, [], itemProgram)])
      if (result === 'confirmed') {
        await db.buyback.update({ where: { key: item.key }, data: { state: 'burned' } })
        console.log(JSON.stringify({ event: 'buyback.burned', key: item.key, mint: item.mint, inputMint: item.inputMint, inputAmount: item.inputAmount.toFixed(0), burnedAmount: String(amount), swapSignature: swap.signature }))
      }
    }
    if (await db.buyback.count({ where: { NOT: { key: { startsWith: CREATOR_BUYBACK_PREFIX } }, state: { in: ['purchasing', 'purchased'] } } })) return
    const interval = env.BUYBACK_INTERVAL_SECONDS * 1000
    const epoch = Math.floor(now / interval)
    const fees = await db.payment.groupBy({ by: ['mint'], where: { role: 'protocol', recipient: recipient.publicKey.toBase58() }, _sum: { amount: true } })
    const tradingAgg = await db.tradingFeeClaim.aggregate({ where: { state: 'claimed', mint: null, venue: { in: ['dbc', 'damm'] } }, _sum: { buybackAmount: true } })
    const credits = combineBuybackCredits(
      fees.map(fee => ({ mint: fee.mint, amount: BigInt(fee._sum.amount?.toFixed(0) ?? '0') })),
      BigInt(tradingAgg._sum.buybackAmount?.toFixed(0) ?? '0'),
    )
    for (const fee of credits) {
      if (fee.mint === env.TOKEN_MINT) continue
      const spent = await db.buyback.aggregate({ where: { NOT: { key: { startsWith: CREATOR_BUYBACK_PREFIX } }, inputMint: fee.mint, state: { not: 'failed' } }, _sum: { inputAmount: true } })
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
    { name: 'passes', everyMs: 5000, run: sweepPasses },
    { name: 'trading-fees', everyMs: 30_000, run: claimTradingFees },
    { name: 'launchlab-creator-fees', everyMs: 30_000, run: claimLaunchlabCreatorFees },
    { name: 'buybacks', everyMs: 5000, run: buyback },
    { name: 'creator-buybacks', everyMs: 5000, run: buybackCreatorFees },
  ], { onError: (task, error) => console.error(JSON.stringify({ event: 'crank_task_failed', task, name: error instanceof Error ? error.name : 'Error', message: error instanceof Error ? error.message.replace(/https?:\/\/\S+/g, '[url]') : 'Unknown error' })) })
  worker = createKeeperRuntime({ lease: { acquire: () => lease.acquire(), renew: async () => lease.held, release: () => lease.release() }, leaseMs: 15000, tickMs: 1000, gate: async () => runtime.readiness.status() === 'ready' ? 'ready' : 'waiting', tick: () => scheduler.tick(), log: entry => console.log(JSON.stringify(entry)) })
  void worker.run()
  return { stop: async () => { await worker.stop(); await lease.release() }, state: () => worker.health }
}
