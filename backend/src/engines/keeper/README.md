# keeper

The background process that turns crank on chain: sweeps fees, posts roots, buys back, migrates.
One leader at a time, tasks on their own intervals, and transactions that survive a restart.

## Modules

| File | What it does | Needs |
|---|---|---|
| `runtime.ts` | `createKeeperRuntime`: hold the leader lease (renewed every leaseMs / 3), stand by without it, wait on a readiness gate, tick, release on stop; `health` for `/health`, `isLeader()` before writes | - |
| `scheduler.ts` | `createScheduler(tasks)`: each task on its own interval, its own one-minute backoff on failure; `phase` / `dueForItem` spread per-item work by a hash of the item | `node:crypto` |
| `journal.ts` | `createJournal`: run an action once by idempotency key; journal the signed bytes before sending; follow the same signature after a restart; rebuild only after proven expiry | `tx/server/{build,ed25519,failure,send}.ts` |
| `prisma-store.ts` | The journal's `KeeperTxStore` over Prisma | `@prisma/client` (generated) |
| `schema.prisma` | The `KeeperTransaction` model | - |

The lease itself is the `indexer` engine's: `SessionLease` (a `pg_try_advisory_lock` on a
connection of its own, released the moment the process disconnects) or `TableLease` (a row in
database time). Wrap it as `{ acquire, renew, release }`.

## Assembly

```ts
const signer = keypairFromEnv('KEEPER_SECRET_KEY')
expectKey('KEEPER_SECRET_KEY', signer, manifest.keeper)
const sender = { url: env.HELIUS_SENDER_URL, apiKey: env.HELIUS_API_KEY, tipLamports: 5_000n, microLamports: 50_000n }

const journal = createJournal({
  connection, store: prismaKeeperStore(db), signer,
  lookupTables: () => loadLookupTables(connection, [platformTable]),
  microLamports: async () => sender.microLamports,
  extra: (s) => [senderTip(s.publicKey, sender)],
  broadcast: senderBroadcast(sender),
  isLeader: () => runtime.isLeader(),
})

const scheduler = createScheduler([
  { name: 'resume', everyMs: 0, run: () => journal.resume() },
  { name: 'sweep', everyMs: 60_000, run: async (now) => {
    for (const coin of await coinsDueForSweep(now)) {
      await scheduler.safely(`sweep:${coin.mint}`, () => journal.execute(`sweep:${coin.mint}:${epochOf(now)}`, () => sweepInstructions(coin)))
    }
  } },
])

const session = new SessionLease({ connectionString: env.DATABASE_URL, name: 'app:keeper' })
const runtime = createKeeperRuntime({
  lease: { acquire: () => session.acquire(), renew: async () => session.held, release: () => session.release() },
  leaseMs: 15_000, tickMs: 5_000,
  gate: async () => (await programDeployed(connection)) ? 'ready' : 'waiting',
  tick: () => scheduler.tick(),
})
void runtime.run()
process.on('SIGTERM', () => runtime.stop().then(() => process.exit(0)))
```

## Behaviour worth knowing

- **Journal before send.** The signed bytes and their signature are written before the first
  broadcast. After a crash the keeper follows that signature; it never signs the same action
  again while the old one could still land.
- **A missing status is not an outcome.** An action is rebuilt only when its blockhash is dead at
  finalized on a node past the build slot and the signature still has no history.
- **Idempotency keys name the action, not the attempt** (`sweep:<mint>:<epoch>`), so two ticks
  or two replicas converge on one transaction; the store's unique key settles a race.
- **Standby is healthy.** Replicas without the lease report `standby`, so a rolling deploy keeps
  the old keeper until the new one takes the lease, and two never run at once.
- **The gate keeps a keeper alive before launch:** with no program or lookup table yet it reports
  `waiting` and makes no RPC calls beyond the gate's own check.
- **Check `isLeader()` before every write.** Leadership can be lost between ticks; the journal
  checks it before building and before every broadcast.
- **Per-task backoff.** One task's failing RPC or bad account backs that task off for a minute
  without stopping the rest; give per-item work its own name (`sweep:<mint>`) so one bad coin
  doesn't hold back the others.
- Keeper transactions reserve no wallet-guard room (`walletSigned: false`); a Sender tip and a
  positive compute-unit price go inside the signed bytes.
