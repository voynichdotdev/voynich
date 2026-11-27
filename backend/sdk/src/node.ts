export * from './index.js'
import { Keypair } from '@solana/web3.js'
import { createVoynich } from './client.js'
import type { Voynich } from './client.js'

let readOnly: Promise<Voynich> | undefined
let signing: Promise<Voynich> | undefined
async function fromEnvironment(requiresSigner: boolean): Promise<Voynich> {
  let signer: Keypair | undefined
  if (requiresSigner && process.env.VOYNICH_KEYPAIR) {
    const { readFile } = await import('node:fs/promises')
    let decoded: unknown
    try { decoded = JSON.parse(await readFile(process.env.VOYNICH_KEYPAIR, 'utf8')) }
    catch { throw new Error('VOYNICH_KEYPAIR must name a readable Solana JSON keypair file') }
    if (!Array.isArray(decoded) || decoded.length !== 64 || !decoded.every(value => Number.isInteger(value) && value >= 0 && value <= 255)) throw new Error('VOYNICH_KEYPAIR must name a Solana JSON keypair file')
    signer = Keypair.fromSecretKey(Uint8Array.from(decoded))
  }
  return createVoynich({
    apiUrl: process.env.VOYNICH_API_URL ?? 'http://127.0.0.1:9702',
    rpcUrl: process.env.SOLANA_RPC_URL || undefined,
    signer,
  })
}
const load = (requiresSigner = false) => requiresSigner ? signing ??= fromEnvironment(true) : readOnly ??= fromEnvironment(false)
const voynich = {
  config: async () => (await load()).api.config(),
  call: async (...args: Parameters<Voynich['call']>) => (await load(true)).call(...args),
  stream: async (...args: Parameters<Voynich['stream']>) => (await load(true)).stream(...args),
  openStream: async (...args: Parameters<Voynich['openStream']>) => (await load(true)).openStream(...args),
  streamPieces: async function* (...args: Parameters<Voynich['streamPieces']>) {
    yield* (await load()).streamPieces(...args)
  },
  settle: async (...args: Parameters<Voynich['settle']>) => (await load(true)).settle(...args),
  verify: async (...args: Parameters<Voynich['verify']>) => (await load()).verify(...args),
  seal: async (...args: Parameters<Voynich['seal']>) => (await load(true)).seal(...args),
  models: async (...args: Parameters<Voynich['models']>) => (await load()).models(...args),
  model: async (...args: Parameters<Voynich['model']>) => (await load()).model(...args),
  enclaves: async (...args: Parameters<Voynich['enclaves']>) => (await load()).enclaves(...args),
  enclave: async (...args: Parameters<Voynich['enclave']>) => (await load()).enclave(...args),
  measurements: async (...args: Parameters<Voynich['measurements']>) => (await load()).measurements(...args),
  measurement: async (...args: Parameters<Voynich['measurement']>) => (await load()).measurement(...args),
  publishMeasurement: async (...args: Parameters<Voynich['publishMeasurement']>) => (await load(true)).publishMeasurement(...args),
  deprecateMeasurement: async (...args: Parameters<Voynich['deprecateMeasurement']>) => (await load(true)).deprecateMeasurement(...args),
  grant: async (...args: Parameters<Voynich['grant']>) => (await load(true)).grant(...args),
  refund: async (...args: Parameters<Voynich['refund']>) => (await load(true)).refund(...args),
  setPrice: async (...args: Parameters<Voynich['setPrice']>) => (await load(true)).setPrice(...args),
  retire: async (...args: Parameters<Voynich['retire']>) => (await load(true)).retire(...args),
  revoke: async (...args: Parameters<Voynich['revoke']>) => (await load(true)).revoke(...args),
  setQuote: async (...args: Parameters<Voynich['setQuote']>) => (await load(true)).setQuote(...args),
  listVersions: async (...args: Parameters<Voynich['listVersions']>) => (await load()).listVersions(...args),
  publishVersion: async (...args: Parameters<Voynich['publishVersion']>) => (await load(true)).publishVersion(...args),
  openSession: async (...args: Parameters<Voynich['openSession']>) => (await load(true)).openSession(...args),
  closeSession: async (...args: Parameters<Voynich['closeSession']>) => (await load(true)).closeSession(...args),
  listSessions: async (...args: Parameters<Voynich['listSessions']>) => (await load(args[0] === undefined)).listSessions(...args),
  session: async (...args: Parameters<Voynich['session']>) => (await load()).session(...args),
  policy: async (...args: Parameters<Voynich['policy']>) => (await load()).policy(...args),
  setPolicy: async (...args: Parameters<Voynich['setPolicy']>) => (await load(true)).setPolicy(...args),
  clearPolicy: async (...args: Parameters<Voynich['clearPolicy']>) => (await load(true)).clearPolicy(...args),
  getSplit: async (...args: Parameters<Voynich['getSplit']>) => (await load()).getSplit(...args),
  setSplit: async (...args: Parameters<Voynich['setSplit']>) => (await load(true)).setSplit(...args),
  claimSplit: async (...args: Parameters<Voynich['claimSplit']>) => (await load(true)).claimSplit(...args),
  getBond: async (...args: Parameters<Voynich['getBond']>) => (await load()).getBond(...args),
  depositBond: async (...args: Parameters<Voynich['depositBond']>) => (await load(true)).depositBond(...args),
  withdrawBond: async (...args: Parameters<Voynich['withdrawBond']>) => (await load(true)).withdrawBond(...args),
  listBenchmarks: async (...args: Parameters<Voynich['listBenchmarks']>) => (await load()).listBenchmarks(...args),
  listModelBenchmarks: async (...args: Parameters<Voynich['listModelBenchmarks']>) => (await load()).listModelBenchmarks(...args),
  publishBenchmark: async (...args: Parameters<Voynich['publishBenchmark']>) => (await load(true)).publishBenchmark(...args),
  getPassPlan: async (...args: Parameters<Voynich['getPassPlan']>) => (await load()).getPassPlan(...args),
  setPassPlan: async (...args: Parameters<Voynich['setPassPlan']>) => (await load(true)).setPassPlan(...args),
  buyPass: async (...args: Parameters<Voynich['buyPass']>) => (await load(true)).buyPass(...args),
  listPasses: async (...args: Parameters<Voynich['listPasses']>) => (await load(args[0] === undefined)).listPasses(...args),
  pass: async (...args: Parameters<Voynich['pass']>) => (await load(true)).pass(...args),
  closePass: async (...args: Parameters<Voynich['closePass']>) => (await load(true)).closePass(...args),
  getReferralConfig: async (...args: Parameters<Voynich['getReferralConfig']>) => (await load()).getReferralConfig(...args),
  setReferralConfig: async (...args: Parameters<Voynich['setReferralConfig']>) => (await load(true)).setReferralConfig(...args),
  listReferrals: async (...args: Parameters<Voynich['listReferrals']>) => (await load(args[0] === undefined)).listReferrals(...args),
  claimReferral: async (...args: Parameters<Voynich['claimReferral']>) => (await load(true)).claimReferral(...args),
  listQuorums: async (...args: Parameters<Voynich['listQuorums']>) => (await load()).listQuorums(...args),
  listModelQuorums: async (...args: Parameters<Voynich['listModelQuorums']>) => (await load()).listModelQuorums(...args),
  quorum: async (...args: Parameters<Voynich['quorum']>) => (await load()).quorum(...args),
  openQuorum: async (...args: Parameters<Voynich['openQuorum']>) => (await load(true)).openQuorum(...args),
  finalizeQuorum: async (...args: Parameters<Voynich['finalizeQuorum']>) => (await load(true)).finalizeQuorum(...args),
  runQuorum: async (...args: Parameters<Voynich['runQuorum']>) => (await load(true)).runQuorum(...args),
  listBatches: async (...args: Parameters<Voynich['listBatches']>) => (await load()).listBatches(...args),
  listModelBatches: async (...args: Parameters<Voynich['listModelBatches']>) => (await load()).listModelBatches(...args),
  batch: async (...args: Parameters<Voynich['batch']>) => (await load()).batch(...args),
  openBatch: async (...args: Parameters<Voynich['openBatch']>) => (await load(true)).openBatch(...args),
  appendBatchReceipts: async (...args: Parameters<Voynich['appendBatchReceipts']>) => (await load(true)).appendBatchReceipts(...args),
  runBatch: async (...args: Parameters<Voynich['runBatch']>) => (await load(true)).runBatch(...args),
  account: async (...args: Parameters<Voynich['account']>) => (await load(args[0] === undefined)).account(...args),
}
export default voynich
