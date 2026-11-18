import { runCrank } from './chain/crank.js'
import { startWorkerService } from './worker-service.js'
await startWorkerService('crank', runCrank)
