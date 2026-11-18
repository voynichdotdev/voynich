# server

The frame of a product's backend: a Hono API with one error envelope, CORS from an exact origin
allowlist, fixture scenarios the web builds against before any chain exists, SSE with resync, a
program-readiness gate shared by every process, and the start-up and shutdown a Railway service
needs. The `contract/` files are the browser-safe half: zod schemas that are at once the server's
validation, the client's response parsing and the OpenAPI document.

## Modules

| File | What it does | Needs |
|---|---|---|
| `app.ts` | `createApi({ origins, allowHeaders, credentials, contractVersion })`: request id, one JSON log line per request, CORS plus an explicit `ORIGIN_NOT_ALLOWED`, body limit, `X-Contract-Version`, the envelope for every failure | `hono`, `errors.ts` |
| `errors.ts` | `ApiFailure`, `fail` for the base codes, `failer(status)` for the product's own, `parse` (zod issues → `fieldErrors`), `toFailure`, `redact` | `zod`, `contract/errors.ts` |
| `input.ts` | `readJson` (requires `application/json`), `readQuery`, `readParam` | `errors.ts` |
| `limits.ts` | `clientIp` behind a proxy, `createWindows`, `writeLimit(perMinute)` | `@hono/node-server`, `errors.ts` |
| `sse.ts` | `EventHub`, `streamEvent`, `streamEvents(c, { hub, filter, ready })` | `hono` |
| `fixture.ts` | `fixtureScenario` (header or `?fixture=`; an error code forces that envelope), `FixtureSessions` (state per tab) | `errors.ts` |
| `readiness.ts` | `createReadiness` (one probe per interval for every process, through a row), `waitingForConfig`, `programProbe`, `readinessKey`, `requireReady` | `pg` (types), `errors.ts` |
| `program-errors.ts` | `firstFailure(logs)`, `customError(err)`, `catalogFromIdl`, `programFailure` → `CHAIN_REFUSED` naming the program | `errors.ts` |
| `config.ts` | `readEnv`, `parseEnv(schema)`, zod helpers `port` `host` `origins` `httpUrl` `wsUrl` `address` `flag` `u64` `cluster`, `requireWhen` | `zod`, `../core/encoding.ts` |
| `db.ts` | `createDatabase(url, (adapter) => new PrismaClient({ adapter }))`: one pg Pool for Prisma and raw SQL | `@prisma/adapter-pg`, `pg` |
| `lifecycle.ts` | `createShutdown`, `onShutdownSignals`, `sleep`, `runLoop` | - |
| `serve.ts` | `serve(app, { port, host, close })` with graceful shutdown | `@hono/node-server`, `lifecycle.ts` |
| `contract/primitives.ts` | `Address`, `Signature`, `BaseUnits`, `U64`, `PositiveU64`, `Base64`, `Timestamp`, `PageQuery`, `page`, `paginate` | `zod`, `../../core/encoding.ts` |
| `contract/errors.ts` | `BASE_ERROR_STATUS`, `ErrorStage`, `ProgramError`, `defineErrors(extra)` → `{ status, ErrorCode, ApiError }` | `zod` |
| `contract/http.ts` | `createHttp(baseUrl, { apiError })`: `get`/`post` parsed by the response schema, `ApiClientError`, `streamUrl` | `zod` (types) |
| `contract/openapi.ts` | `openApiDocument({ schemas, operations, error, fixture })` | `zod` |
| `contract/fixtures.ts` | `fixtureAddress(seed)`, `fixtureSignature`, `fixtureTransaction`, `fixtureErrors(details)` | `../../core/encoding.ts` |
| `start-service.mjs` | Start script: `prisma migrate deploy`, then the role, signals forwarded | `prisma` |
| `prisma.config.ts` | Prisma config: `.env` optional, `generate` without a database | `prisma` |
| `.railwayignore` | Upload filter for a Node backend | - |

Versions the files are written against: `hono` 4.13.16, `@hono/node-server` 2.1.6, `zod` 4.6.7,
`prisma` / `@prisma/client` / `@prisma/adapter-pg` 7.10.1, `pg` 8.16, Node 22. Imports are
extensionless (bundler resolution); under `NodeNext` add `.js`.

## The contract package

The contract is its own package inside the backend, browser-safe, versioned, and installed by the
web as a tarball:

```
backend/
  contract/                 @example/contract
    src/encoding.ts         core/encoding.ts
    src/primitives.ts       contract/primitives.ts   (import from './encoding')
    src/errors.ts           contract/errors.ts
    src/http.ts             contract/http.ts
    src/schemas.ts          the product's schemas, built from the primitives
    src/client.ts           createClient: one line per route over createHttp
    src/fixtures.ts         contract/fixtures.ts plus the product's samples
    src/write-openapi.ts    openApiDocument(...) written to ../openapi.json
    package.json
  src/                      the API, importing @example/contract
```

```json
{
  "name": "@example/contract",
  "version": "0.1.0",
  "type": "module",
  "sideEffects": false,
  "files": ["dist", "openapi.json"],
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
    "./fixtures": { "types": "./dist/fixtures.d.ts", "import": "./dist/fixtures.js" },
    "./openapi.json": "./openapi.json"
  },
  "scripts": { "build": "tsc -p tsconfig.json && node dist/write-openapi.js" },
  "dependencies": { "zod": "4.6.7" }
}
```

The web installs it as `"@example/contract": "file:vendor/example-contract-0.1.0.tgz"`, made by
`npm pack --pack-destination ../web/vendor` from a backend script that packs it again on every
change. A `file:../backend/contract` path breaks on Railway, where only the web folder uploads, and
a symlinked package duplicates peers such as `@solana/web3.js`. Bump the version with every repack:
a tarball replaced under the same name fails the lockfile's integrity check.

```ts
// contract/src/schemas.ts
export const CONTRACT_VERSION = '0.1.0'
export const errors = defineErrors({ QUOTE_EXPIRED: 409 })
export type ErrorCode = z.output<typeof errors.ErrorCode>
export const Coin = z.strictObject({ mint: Address, name: z.string(), raised: BaseUnits })
export const CoinsPage = page(Coin)
export const BuyRequest = z.strictObject({ wallet: Address, amount: PositiveU64 })
export const Build = z.strictObject({ id: z.string(), transactionBase64: Base64, expiresAt: Timestamp })
export const SCENARIOS = ['empty', 'waiting'] as const

// contract/src/client.ts
export function createClient(baseUrl: string, options: Omit<HttpOptions, 'apiError'> = {}) {
  const http = createHttp(baseUrl, { ...options, apiError: errors.ApiError })
  return {
    coins: (query: z.input<typeof PageQuery> = {}) => http.get('/v1/coins', CoinsPage, { query }),
    buy: (mint: string, body: z.input<typeof BuyRequest>) => http.post(`/v1/coins/${encodeURIComponent(mint)}/buy`, Build, body),
    eventsUrl: (mint?: string) => http.streamUrl('/v1/events', { mint }),
  }
}

// contract/src/write-openapi.ts
const doc = openApiDocument({
  title: 'Example API',
  version: CONTRACT_VERSION,
  schemas: { Address, Coin, CoinsPage, BuyRequest, Build, ApiError: errors.ApiError },
  operations: [
    { method: 'get', path: '/v1/coins', operationId: 'coins', summary: 'Coin feed', response: 'CoinsPage', query: PageQuery },
    { method: 'post', path: '/v1/coins/{mint}/buy', operationId: 'buy', summary: 'Build a buy', response: 'Build', request: 'BuyRequest', params: { mint: 'Address' } },
  ],
  error: { schema: 'ApiError', statuses: [...new Set(Object.values(errors.status))] },
  fixture: { header: 'X-Fixture', values: [...SCENARIOS, ...errors.ErrorCode.options] },
})
writeFileSync(new URL('../openapi.json', import.meta.url), JSON.stringify(doc, null, 2) + '\n')
```

## Assembly

```ts
// src/config.ts
export const env = parseEnv(
  z.object({
    PORT: port(4000),
    HOST: host(),
    CORS_ORIGINS: origins,
    DATABASE_URL: z.string().optional(),
    MODE: z.enum(['fixture', 'chain']).default('fixture'),
    CLUSTER: cluster,
    SOLANA_RPC_URL: httpUrl.default('http://127.0.0.1:8899'),
    PROGRAM_ID: address.optional(),
    LOOKUP_TABLE: address.optional(),
  }).superRefine(requireWhen('CLUSTER', 'mainnet', ['PROGRAM_ID', 'DATABASE_URL'])),
)
export const fail: Fail<ErrorCode> = failer(errors.status)
```

```ts
// src/runtime.ts: building it opens connections but starts no loop
export function createRuntime() {
  const { db, pool, close } = createDatabase(env.DATABASE_URL!, (adapter) => new PrismaClient({ adapter }))
  const rpc = createRpc({ url: env.SOLANA_RPC_URL, service: 'example-api', rps: 20, scanIntervalMs: 10_000 })
  const readiness = env.LOOKUP_TABLE
    ? createReadiness({
        pool,
        key: readinessKey(env.SOLANA_RPC_URL, [env.PROGRAM_ID!, env.LOOKUP_TABLE]),
        probe: programProbe(() => rpc.connection.getMultipleAccountsInfo([programKey, lookupTableKey], 'confirmed')),
      })
    : waitingForConfig()
  const hub = new EventHub()
  const { signal, shutdown } = createShutdown(async () => {
    await readiness.stop()
    await close()
  })
  return {
    db, pool, rpc, readiness, hub, close: shutdown,
    async start() {
      await readiness.start()
      void runLoop({ name: 'indexer', signal, everyMs: 2_000, run: async () => (readiness.status() === 'ready' ? indexOnce() : 'waiting') })
    },
  }
}
```

```ts
// src/app.ts
export function buildApp(runtime: Runtime | null) {
  const app = createApi<{ scenario: Scenario | null }>({
    origins: env.CORS_ORIGINS,
    allowHeaders: ['X-Fixture', 'X-Fixture-Session', 'Last-Event-ID'],
    contractVersion: CONTRACT_VERSION,
  })
  app.get('/health', (c) => c.json({ status: runtime ? (runtime.readiness.status() === 'ready' ? 'ready' : 'waiting') : 'fixture' }))
  if (!runtime) return fixtureRoutes(app)
  app.use('/v1/*', writeLimit(60))
  app.get('/v1/coins', async (c) => c.json(await coins(runtime, readQuery(c, PageQuery))))
  app.post('/v1/coins/:mint/buy', requireReady(runtime.readiness), async (c) => {
    const mint = readParam(c, 'mint', Address)
    const body = await readJson(c, BuyRequest)
    return c.json(await buildBuy(runtime, mint, body))
  })
  app.get('/v1/events', (c) => streamEvents(c, { hub: runtime.hub, ready: () => ({ status: runtime.readiness.status() }) }))
  return app
}

// src/server.ts
const runtime = env.MODE === 'chain' ? createRuntime() : null
const app = buildApp(runtime)
await runtime?.start()
serve(app, { port: env.PORT, host: env.HOST, close: async () => runtime?.close() })
```

```json
"scripts": {
  "dev": "tsx watch src/server.ts",
  "build": "prisma generate && tsc -p tsconfig.json",
  "start": "node scripts/start-service.mjs api",
  "start:worker": "node scripts/start-service.mjs worker"
}
```

Fixture routes are a function over a Hono app, so the same routes serve fixture mode at the root
and, in chain mode, a preview under `/fixture` (`app.route('/fixture', previews)` where `previews`
is a plain `new Hono()` given the same routes). A second `createApi` mounted inside the first would
run CORS and logging twice.

## Behaviour worth knowing

- Every failure is `{ error: { code, message, retryable, stage, fieldErrors?, programError?,
  retryAfterSeconds?, requestId? } }`. The UI branches on `code`, shows `message`, offers a retry
  when `retryable`, and marks fields from `fieldErrors` (keyed by the zod path). Unknown errors
  answer `INTERNAL_ERROR` with only a request id; the log line has the error name and a message
  with every URL cut to its host, since RPC and database URLs carry keys.
- `fail` from `failer` must be exported with its type (`export const fail: Fail<ErrorCode>`), or
  TypeScript won't treat the call as never returning and narrowing after it stops working.
- CORS only stops a browser from reading an answer; a simple cross-site POST still runs. The
  explicit `ORIGIN_NOT_ALLOWED` refusal and `readJson`'s `application/json` requirement together
  are what keep a cookie session from being driven by another site. Origins match exactly;
  `origins` in `config.ts` normalizes `https://x.com/` to `https://x.com`.
- Before the program exists every service is up and healthy: `/health` answers 200
  `{ status: 'waiting' }`, never a 503 (every failed fetch logs a console error and pages
  monitors), reads answer empty, and routes behind `requireReady` answer `PROGRAM_UNAVAILABLE`
  (409, retryable). The service goes live by itself when the probe sees the program.
- The readiness probe costs one RPC read per `probeEveryMs` (30 s) for the whole product, however
  many replicas, workers and tabs: the `ServiceReadiness` row reserves each probe on the
  database's clock. A failed read is never taken as ready. Until the lookup table (made at
  launch) is configured, `waitingForConfig()` makes no RPC or database call at all.
- `runLoop` logs only status changes, waits `waitingMs` while waiting and at least a minute after
  a failure, so a worker retrying a broken setup can't spin on a shared RPC key.
- Building a runtime starts no loop and binds no port, so scripts and rehearsals construct it
  freely; `start()` does. One idempotent shutdown serves signals and tests. Railway starts the new
  deployment before stopping the old, so a worker holding a lease releases it in `close()` on
  SIGTERM and the next one takes over at once.
- `serve` cuts open connections on shutdown; an open SSE stream would otherwise hold
  `server.close()` forever.
- SSE events are named by `type` and carry the whole envelope as data. Nothing is replayed: a
  reconnect with `Last-Event-ID`, or a client that fell 500 events behind, gets `resync` and
  refetches its snapshots. A comment line every 15 s keeps proxies from closing the stream. Hidden
  tabs close their EventSource and reconnect, refetching, when visible.
- Fixture scenarios ride the `X-Fixture` header, or `?fixture=` for EventSource, which can't set
  headers. Any error code as the scenario answers that code's sample envelope, so every error
  state can be drawn. `FixtureSessions` keys state by scenario and `X-Fixture-Session` (an id the
  web keeps in sessionStorage), capped at 200. Fixture transaction bytes decode to a label, not a
  transaction, so a real wallet or RPC refuses them outright.
- Custom program error codes overlap (every Anchor program starts at 6000). `firstFailure` takes
  the first `failed: custom program error` line in the logs: an inner program's failure is
  re-logged by every caller above it with the same code.
- Amounts travel as base-unit strings and are added in BigInt. OpenAPI can't bound an integer
  string with `maximum`, so `U64` and `PositiveU64` get a lexical pattern; use them as they are
  (wrapping in `optional()` or `nullable()` keeps the pattern).
- The client parses each response with the schema the server answered with, so contract drift
  fails at the boundary. An envelope is an error whatever its HTTP status; a non-JSON answer (a
  proxy page) still becomes an `ApiClientError`. A bare `fetch` kept on an object throws "Illegal
  invocation" in browsers; `createHttp` binds it.
- `createDatabase` shares one pg Pool between Prisma and raw SQL, and listens for pool errors: a
  dropped idle connection otherwise surfaces as an uncaught exception that ends the process.
  Prisma 7's generated client lives where the project's schema puts it, so it comes in as a
  factory. Declare timestamps `@db.Timestamptz(3)`: Railway Postgres runs in UTC and a JS Date
  binds as timestamptz.
- On Railway `prisma generate` runs in the build and `prisma migrate deploy` at start
  (`start-service.mjs`), since the build can't reach the internal network. The port is Railway's
  `PORT`; `host()` binds `::` there, which takes both the public edge and the IPv6-only private
  network, and loopback elsewhere. `.railwayignore` keeps a root `Cargo.toml` out of the upload,
  since Railpack would build a Rust image with no Node in it.
