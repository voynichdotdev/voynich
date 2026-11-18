# indexer

A program indexer on RPC and Postgres. It follows a set of addresses through
`getSignaturesForAddress`, decodes every new transaction (instructions, Anchor events, token
movements, the first failure), stores the product's facts for each, and applies them in chain order
inside one database transaction per page. LaserStream, a Helius webhook or `logsSubscribe` only
wake it up; the catch-up from saved cursors is the single path that reads transactions. One
leader runs it at a time, and a new deploy waits in standby until the old one lets go.

The product supplies two functions: `facts(decodedTx)` turns a transaction into plain JSON, and
`apply(tx, row)` writes those facts into its own tables.

## Modules

| File | What it does | Needs |
|---|---|---|
| `transaction.ts` | `normalizeTransaction(raw)`: legacy, v0 and v1 RPC JSON into resolved keys, one call tree (paths, parents, stack heights), token balances, logs and issues | `../core/encoding.ts` |
| `decoder.ts` | `decodeTransaction(raw, programs)`: named instructions, events from emit_cpi and `Program data:` logs, token flows, `firstFailure`; `eventFor`; the `ProgramDecoder` port | `transaction.ts`, `token-flows.ts`, `fields.ts`, `../core/encoding.ts` |
| `token-flows.ts` | SPL Token and Token-2022 Transfer, MintTo, Burn and their Checked forms; `descendants`, `amountMoved`, `walletFor` for fact builders | `transaction.ts` |
| `fields.ts` | `Json`, `Fields` and typed readers `text`, `raw`, `int`, `nested`, `variant` | |
| `anchor.ts` | `anchorProgram(idl)`: a `ProgramDecoder` from an Anchor IDL, with `account(name, data)`; `toJson` | `@coral-xyz/anchor` 0.31, `@solana/web3.js` |
| `rpc.ts` | the `Rpc` port, `httpRpc(url)`, `connectionRpc(connection)`; `signaturePage`, `readTransaction`, `blockSignatures`, `confirmedSlot` | `zod` |
| `store.ts` | the `IndexStore` port: staged transactions, cursors, discovered addresses, the apply transaction | |
| `prisma-store.ts` | `PrismaIndexStore`: the port on Postgres, plain SQL through the project's own Prisma client | `schema.prisma` |
| `indexer.ts` | `Indexer`: stage, then apply in chain order; polling, wake-ups, retry, discovery | `decoder.ts`, `rpc.ts`, `store.ts` |
| `laserstream.ts` | wake-ups from Helius LaserStream transaction statuses, reconnecting | `@triton-one/yellowstone-grpc` 4.0.2 |
| `helius-webhook.ts` | wake-ups from a Helius webhook: a fetch-style route and the webhook's address list | |
| `logs-stream.ts` | wake-ups from `logsSubscribe`, for localnet | `@solana/web3.js` |
| `session-lease.ts` | leader lease on a Postgres session advisory lock over its own connection | `pg` |
| `table-lease.ts` | leader lease on a `worker_leases` row, in database time | `schema.prisma` |
| `worker.ts` | `runWorker({ lease, job })`: runs the indexer only while holding the lease | |
| `schema.prisma` | `IndexedTransaction`, `IndexerCursor`, `WorkerLease` | `@prisma/client` 7 |

Copy the files you use plus `core/encoding.ts`. Nothing here imports from another engine; the
`market` engine's stores are called from your `apply`. The sources import without extensions; in a
NodeNext backend add `.js` to the relative imports when copying.

## Assembly

Paste `schema.prisma` into the project's schema and migrate. Then the worker process:

```ts
// src/indexer-worker.ts
import type { Idl } from '@coral-xyz/anchor'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, type Prisma } from './generated/prisma/client.js'
import { anchorProgram } from './engines/indexer/anchor.js'
import { Indexer } from './engines/indexer/indexer.js'
import { laserStream } from './engines/indexer/laserstream.js'
import { logsStream } from './engines/indexer/logs-stream.js'
import { PrismaIndexStore } from './engines/indexer/prisma-store.js'
import { httpRpc } from './engines/indexer/rpc.js'
import { SessionLease } from './engines/indexer/session-lease.js'
import { runWorker } from './engines/indexer/worker.js'
import { apply, facts, type Facts } from './facts.js'
import idl from './idl/program.json' with { type: 'json' }

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) })
const program = anchorProgram(idl as Idl)
type Tx = Prisma.TransactionClient

const indexer = new Indexer<Facts, Tx>({
  rpc: httpRpc(process.env.RPC_URL!),
  store: new PrismaIndexStore<Facts, Tx>(db, { lock: 'app:index-apply' }),
  programs: [program],
  addresses: [program.programId, process.env.CONFIG_ADDRESS!],
  facts,
  apply,
  discover: (f) => f.pools,
  stream: process.env.LASERSTREAM_URL
    ? laserStream({ endpoint: process.env.LASERSTREAM_URL, apiKey: process.env.HELIUS_API_KEY! })
    : logsStream({ rpcUrl: process.env.RPC_URL!, wsUrl: process.env.WS_URL }),
  log: (entry) => console.log(JSON.stringify(entry)),
})

const lease = new SessionLease({ connectionString: process.env.DATABASE_URL!, name: 'app:indexer' })
const worker = runWorker({ lease, job: indexer })
process.once('SIGTERM', async () => {
  await worker.stop()
  await db.$disconnect()
})
```

The product's part, kept apart from the engine:

```ts
// src/facts.ts
import type { Prisma } from './generated/prisma/client.js'
import { eventFor, type DecodedTransaction } from './engines/indexer/decoder.js'
import { raw, text } from './engines/indexer/fields.js'
import type { StagedTransaction } from './engines/indexer/store.js'

export type Facts = { swaps: { pool: string; wallet: string; amountIn: string }[]; pools: string[]; issues: string[] }

export function facts(tx: DecodedTransaction): Facts {
  const out: Facts = { swaps: [], pools: [], issues: [] }
  for (const ix of tx.instructions) {
    try {
      if (ix.name === 'create_pool') out.pools.push(ix.namedAccounts.pool)
      if (ix.name === 'swap') {
        const event = eventFor(tx, ix, 'SwapEvent')
        if (!event) throw new Error('swap without its event')
        out.swaps.push({ pool: ix.namedAccounts.pool, wallet: text(event.data.user), amountIn: raw(event.data.amount_in) })
      }
    } catch (error) {
      out.issues.push(`${ix.path.index}: ${(error as Error).message}`)
    }
  }
  return out
}

export async function apply(tx: Prisma.TransactionClient, row: StagedTransaction<Facts>) {
  if (row.failed || !row.facts || !row.blockTime) return
  for (const swap of row.facts.swaps) await tx.swap.create({ data: { signature: row.signature, ...swap, at: row.blockTime } })
}
```

With a Helius webhook instead of a stream, the route lives in the indexer's own process:

```ts
const hook = heliusWebhook({ apiKey, webhookId, webhookUrl: 'https://worker.example.com/webhooks/helius', authorization: process.env.HELIUS_WEBHOOK_AUTH! })
app.post('/webhooks/helius', (c) => hook.handler(c.req.raw)) // Hono; any fetch-style router works
// new Indexer({ ..., stream: hook.stream })
```

A health route returns `worker.state()`: `active` and `standby` are both healthy.
`await indexer.catchUp()` runs one cycle without `start()`, for a backfill script.

## Behaviour worth knowing

- Each cycle reads the confirmed slot first, then pages every watched address back to its cursor
  and stages each new transaction: fetched as raw JSON, decoded, its facts stored. Only then are
  staged rows at or below that slot applied, oldest first, 50 per database transaction under
  `pg_advisory_xact_lock`. Rows above it wait for the next cycle, so transactions seen from
  different addresses apply in true chain order even when one address takes minutes to backfill.
- Signature lists order one address only. When a slot holds two staged transactions, their order
  comes from `getBlock` with `transactionDetails: 'signatures'`.
- `apply` runs inside the page's transaction; the rows are marked applied and the cursors written
  last, in the same commit. A cursor only moves to a transaction already applied, and an address
  whose newest transactions were applied through another address still moves to its head. A
  restart re-reads signature pages from the cursors but fetches only what isn't staged yet.
- It never calls `getProgramAccounts`. New addresses come from `discover(facts)`; they are stored
  in `indexer_cursors.discovered_by` when staged, reloaded every cycle, and read from the start of
  their history, so transactions between a pool's creation and the stream noticing it are never lost.
- Streams and webhooks are hints. A missed one costs one poll interval (5 s). Wakes during a cycle
  fold into one more cycle. LaserStream reconnects after 60 s and wakes the loop on reconnect.
- A throw from `facts`, `apply` or an RPC read stops the cycle; it runs again after `retryMs`
  (60 s), and wakes don't shorten that. Record per-instruction problems in your facts instead of
  throwing; the decoder already turns unreadable instructions and events into issues, stored in
  `decode_error`. A transaction the node can't serve yet (`getTransaction` null) is retried this way.
- Failed transactions are staged and applied like the rest (`row.failed`, `row.chainError`, and
  `firstFailure` in the decoded transaction), so a product can mark its own pending actions failed.
- web3.js v1's `getTransaction` parses only legacy and v0 and throws on v1. `readTransaction`
  asks for raw JSON with `maxSupportedTransactionVersion: 1` and `normalizeTransaction` reads all
  three. Account keys are the static keys, then for legacy and v0 the lookup-table addresses,
  writable before readonly; a v1 message carries every key inline.
- An emit_cpi event counts only when the self-invocation is signed by the program's
  `__event_authority` PDA and sits directly under the same program: anyone can call a program with
  the event tag. emit_cpi events survive log truncation; `Program data:` events don't, and
  `logsTruncated` says when that happened.
- Facts are stored as JSON. `toJson` turns BN, bigint and PublicKey into strings; keep amounts as
  strings in your facts too.
- `pg_advisory_xact_lock` returns void, which `$queryRaw` can't read back; the store runs it with
  `$executeRaw`. Give each indexer sharing a database its own `lock` name, and never its lease's
  name: `SessionLease` holds that key as a session lock, so a page transaction locking the same key
  waits on it forever and the indexer stops after staging its first page.
- `new PrismaIndexStore<Facts, Prisma.TransactionClient>(db)` types the `tx` your `apply` gets;
  with only `<Facts>` it is the bare raw-query surface.
- `SessionLease` holds its lock on a connection of its own and drops it when the process dies, with
  no expiry to wait out; point it at a direct database URL, not a transaction-mode pooler.
  `TableLease` compares expiry in database time (`clock_timestamp()`); its 30 s lease is renewed on
  every 5 s worker tick.
- Anchor ships CommonJS, so `anchor.ts` takes `BorshCoder` and `BN` off its default export.
  Yellowstone 4.0.2's CJS and ESM export maps disagree under NodeNext, so `laserstream.ts` loads the
  CJS build through `createRequire`.
- RPC errors name the method only: RPC URLs carry API keys. The webhook strips its key from logged
  errors, registers addresses only when the set changes, and waits a minute after a failed
  registration; one webhook follows at most 100,000 addresses.
