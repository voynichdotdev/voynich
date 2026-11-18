import { env } from './config.js'
import { serve } from './engines/server/serve.js'
import { createChainRuntime } from './runtime.js'
import { buildChainApp } from './chain/app.js'

if (env.MODE === 'fixture') {
  const { buildApp } = await import('./app.js')
  serve(buildApp(), { port: env.PORT, host: env.HOST })
}
else {
  const runtime = createChainRuntime('api')
  await runtime.start()
  serve(buildChainApp(runtime), { port: env.PORT, host: env.HOST, close: () => runtime.close() })
}
