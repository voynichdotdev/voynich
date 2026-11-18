import { CONTRACT_VERSION } from '@voynich/contract'
import { createApi } from './engines/server/app.js'
import { serve } from './engines/server/serve.js'
import { createChainRuntime, type ChainRuntime } from './runtime.js'

type Worker = { stop(): Promise<void> }
export async function startWorkerService(role: 'indexer' | 'crank', start: (runtime: ChainRuntime) => Promise<Worker>) {
  const runtime = createChainRuntime(role)
  await runtime.start()
  const app = createApi({ origins: [], contractVersion: CONTRACT_VERSION })
  app.get('/health', c => c.json({ status: runtime.readiness.status(), contractVersion: CONTRACT_VERSION }))
  let worker: Worker | undefined
  let stopping = false
  let starting: Promise<void> | undefined
  const { shutdown } = serve(app, { port: runtime.env.PORT, host: runtime.env.HOST, close: async () => {
    stopping = true
    await runtime.readiness.stop()
    await starting?.catch(() => {})
    await worker?.stop()
    await runtime.close()
  } })
  starting = runtime.readiness.waitUntilReady().then(async () => { if (!stopping) worker = await start(runtime) })
  void starting.catch(async error => {
    if (stopping) return
    console.error(JSON.stringify({ event: 'worker_start_failed', role, name: error.name, message: error.message }))
    process.exitCode = 1
    await shutdown()
  })
}
