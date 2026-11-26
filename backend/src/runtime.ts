import { PrismaClient } from '@prisma/client'
import type { IdlAccounts } from '@coral-xyz/anchor'
import { PublicKey, type Connection } from '@solana/web3.js'
import type { PoolClient } from 'pg'
import { addresses, bountyAddresses, bountyProgram, chainPrograms, decodeConfigAccount, PROGRAM_ID, ATTESTATION_PROGRAM_ID, type Voynich } from 'voynich/program'
import { env } from './config.js'
import { createDatabase } from './engines/server/db.js'
import { createReadiness, readinessKey } from './engines/server/readiness.js'
import { EventHub, streamEvent } from './engines/server/sse.js'
import { createRpc } from './engines/rpc/client.js'
import { ReadModel } from './chain/read-model.js'
import { runEnclaveHealth } from './chain/enclave-health.js'

export async function probeVoynichReady(deps: {
  connection: Pick<Connection, 'getMultipleAccountsInfo' | 'getAccountInfo'>
  voynich: { coder: { accounts: { decode: <T = unknown>(name: string, data: Buffer) => T } } }
  programId: PublicKey
  configAddress: PublicKey
}): Promise<boolean> {
  const [programInfo, configInfo] = await deps.connection.getMultipleAccountsInfo([deps.programId, deps.configAddress], 'confirmed')
  if (!programInfo?.executable || !configInfo || !configInfo.owner.equals(deps.programId)) return false
  let config: { attestationProgram: PublicKey }
  try { config = decodeConfigAccount(configInfo.data) }
  catch { config = deps.voynich.coder.accounts.decode<IdlAccounts<Voynich>['config']>('config', configInfo.data) }
  if (config.attestationProgram.equals(PublicKey.default)) return false
  const verifierInfo = await deps.connection.getAccountInfo(config.attestationProgram, 'confirmed')
  return !!verifierInfo?.executable
}

export function createChainRuntime(role: 'api' | 'indexer' | 'crank') {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required for chain services.')
  const database = createDatabase(env.DATABASE_URL, adapter => new PrismaClient({ adapter }))
  const { db, pool } = database
  const programId = new PublicKey(env.PROGRAM_ID ?? PROGRAM_ID)
  const attestationProgramId = new PublicKey(env.ATTESTATION_PROGRAM_ID ?? ATTESTATION_PROGRAM_ID)
  const bountyProgramId = env.BOUNTY_PROGRAM_ID ? new PublicKey(env.BOUNTY_PROGRAM_ID) : null
  const rpc = createRpc({ url: env.SOLANA_RPC_URL, service: `voynich-${role}`, rps: env.RPC_RPS, scanIntervalMs: env.RPC_SCAN_INTERVAL_MS })
  const programs = {
    ...chainPrograms(rpc.connection, { programId, attestationProgramId }),
    bounty: bountyProgramId ? bountyProgram(rpc.connection, bountyProgramId) : null,
  }
  const address = addresses(programId, attestationProgramId)
  const bountyPda = bountyProgramId ? bountyAddresses(bountyProgramId) : null
  const readiness = createReadiness({ pool, key: readinessKey(env.SOLANA_RPC_URL, [programId.toBase58(), address.config.toBase58()]),
    probe: () => probeVoynichReady({ connection: rpc.connection, voynich: programs.voynich, programId, configAddress: address.config }) })
  const readModel = new ReadModel(db, rpc.connection, programId, attestationProgramId)
  const hub = new EventHub()
  let listener: PoolClient | undefined
  let enclaveHealth: ReturnType<typeof runEnclaveHealth> | undefined
  let closed: Promise<void> | undefined
  async function notify(payload: string) {
    const event = JSON.parse(payload) as { type: string; id: string }
    const data = event.type === 'model.updated' ? await readModel.model(event.id)
      : event.type === 'enclave.updated' ? (await readModel.enclave(event.id)).enclave
      : event.type === 'call.updated' ? await readModel.call(event.id)
      : event.type === 'receipt.created' ? (await readModel.receipt(event.id)).receipt
      : event.type === 'bounty.updated' ? (await readModel.bounty(event.id)).bounty
      : event.type === 'measurement.updated' ? await readModel.measurement(event.id)
      : event.type === 'policy.updated' ? await readModel.modelPolicy(event.id)
      : event.type === 'policy.cleared' ? (() => { const [model, policy] = event.id.split(':'); return { model, policy } })()
      : event.type === 'version.published' ? await (async () => { const [model, ver] = event.id.split(':'); const list = await readModel.modelVersions(model!); return list.items.find(item => item.version === Number(ver)) ?? null })()
      : event.type === 'session.updated' ? await readModel.session(event.id)
      : event.type === 'split.updated' ? await readModel.modelSplit(event.id)
      : event.type === 'bond.updated' ? await readModel.enclaveBond(event.id)
      : event.type === 'benchmark.published' ? await readModel.benchmark(event.id)
      : event.type === 'pass.updated' ? await readModel.pass(event.id)
      : event.type === 'pass_plan.updated' ? await readModel.modelPassPlan(event.id) : null
    if (data) hub.publish(streamEvent(event.type, data))
  }
  return {
    env, db, pool, rpc, programs, addresses: address, bountyAddresses: bountyPda, programId, attestationProgramId, bountyProgramId, readiness, readModel, hub,
    async start() {
      await readiness.start()
      if (role === 'api') {
        const connection = await pool.connect()
        listener = connection
        connection.on('notification', message => { if (message.channel === 'voynich_events' && message.payload) void notify(message.payload).catch(error => console.error(JSON.stringify({ event: 'event_snapshot_failed', name: error.name }))) })
        connection.on('error', error => console.error(JSON.stringify({ event: 'event_connection_failed', name: error.name })))
        await connection.query('LISTEN voynich_events')
        enclaveHealth = runEnclaveHealth({ db, connectionString: env.DATABASE_URL!, ready: () => readiness.status() === 'ready' })
      }
    },
    close() { return closed ??= (async () => { await enclaveHealth?.stop(); await readiness.stop(); if (listener) { await listener.query('UNLISTEN voynich_events'); listener.release() }; await database.close() })() },
  }
}
export type ChainRuntime = ReturnType<typeof createChainRuntime>
