import { runIndexer } from './chain/indexer.js'
import { startWorkerService } from './worker-service.js'
await startWorkerService('indexer', runIndexer)
