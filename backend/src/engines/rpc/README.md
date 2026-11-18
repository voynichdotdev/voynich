# rpc

One Solana RPC endpoint per service, spent like the shared budget it is: every call from the
service's web3.js `Connection`, its raw JSON-RPC calls and the browser relay takes its turn from
one clock, program scans keep their own wider spacing, each call logs one JSON line with its method
name, and u64 numbers arrive exact.

## Modules

| File | What it does | Needs |
|---|---|---|
| `client.ts` | `createRpc({ url, service, rps, scanIntervalMs })` → `{ connection, call, forward, genesisHash }`, `RpcError` | `@solana/web3.js`, `pace.ts`, `json.ts` |
| `pace.ts` | `pacer(service, { rps, scanIntervalMs })`: one clock per named budget in the process | - |
| `json.ts` | `parseExact` (integers past 2^53 keep their digits as strings), `toU64` | - |
| `accounts.ts` | `getAccounts` in pages of 100, `getAccount`: data as bytes, lamports as BigInt | `client.ts`, `../core/encoding.ts` |
| `relay.ts` | `rpcRelay({ rpc })` for a browser-facing `/rpc`, `RELAY_METHODS`, `RELAY_HEADERS` | `hono`, `../server/limits.ts` |

`@solana/web3.js` 1.99, `hono` 4.13.16 for the relay, Node 22.

## Assembly

```ts
const rpc = createRpc({
  url: env.SOLANA_RPC_URL,
  service: 'example-api', // the budget's name
  rps: 20,
  scanIntervalMs: 10_000,
})

const slot = await rpc.connection.getSlot() // web3.js, paced and logged
const fee = await rpc.call<{ value: number | string | null }>('getFeeForMessage', [message, { commitment: 'confirmed' }])
const [config, vault] = await getAccounts(rpc, [configAddress, vaultAddress])
const cluster = await rpc.genesisHash() // read once per process
```

```ts
// API: the browser reads through the API, the key stays on the server
const app = createApi({ origins: env.CORS_ORIGINS, allowHeaders: [...RELAY_HEADERS] })
app.route('/rpc', rpcRelay({ rpc, ready: () => readiness.status() === 'ready' }))

// web
const connection = new Connection(`${process.env.NEXT_PUBLIC_API_URL}/rpc`, 'confirmed')
```

A worker in its own process makes its own client under its own service name (`example-indexer`)
with its own share of the budget; two clients with the same name in one process share one pace.

## Behaviour worth knowing

- A remote endpoint won't start without `rps` and `scanIntervalMs`: one provider key serves every
  product, so each service's caps are chosen to add up under the plan's requests a second with room
  for the others. Localnet defaults to 50 and 0.
- `getProgramAccounts` costs more and has its own provider cap, so it also keeps
  `scanIntervalMs` between scans, without delaying the calls queued behind it. A holder read (a
  token program filtered to one mint) answers a single page and keeps only the request pace. A
  batch takes one turn per request inside it.
- web3.js retries a 429 on its own with backoff, multiplying calls on a spent budget; the
  `Connection` here has that off, and the caller decides.
- Each call logs `{ event: 'rpc', service, method, status, ms }`. The URL carries the provider
  key, so it never reaches a log or an `RpcError` message.
- Calls time out after 15 s. `RpcError.code` is the HTTP status, the JSON-RPC error code, or -1
  when no answer arrived.
- `call` and `getAccounts` parse with `parseExact`: Node 22's reviver sees each number's source
  text, so 18446744073709551615 survives as a string and becomes BigInt through `toU64`. Typed
  web3.js reads return JavaScript numbers; read money that can pass 2^53 through `call`.
- The genesis hash identifies the cluster and never changes: one read per process, a failure not
  kept.
- The relay takes one request at a time (no batches), only allowlisted methods, 600 reads and 30
  writes a minute per client, and rebuilds the request from its parsed fields so duplicate keys
  can't show one method to the allowlist and another to the provider. The provider's answer is
  passed through as text, numbers byte for byte. A relayed call queues on the service budget for at
  most `maxWaitMs` (1 s), then gets 429 with `Retry-After`.
- web3.js adds a `solana-client` header to every request; a CORS preflight that doesn't allow it
  fails every call in the browser while server-side checks pass. `RELAY_HEADERS` carries it.
- While the program isn't deployed, `ready` answers relayed calls locally with JSON-RPC error
  -32004 and spends nothing.
- Relay POSTs aren't product writes: put `writeLimit` on the product's routes, not on `/rpc`.
- Subscriptions (`onAccountChange`, websocket confirmation) go over the websocket and bypass the
  pace and the log; poll `getSignatureStatuses` through the relay or `call`, and index over
  LaserStream on mainnet.
