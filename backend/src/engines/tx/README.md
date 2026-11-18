# tx

Server-built transactions, from instructions to a confirmed signature. The server holds the RPC
and builds every user transaction; the wallet signs; the server checks what came back, co-signs
when it must, sends, and answers status reads. The browser never broadcasts on its own.

```
server  instructions ─ build.ts ─▶ TxBuild ──────────────▶ browser
                                                           │ wallet signs (wallet engine)
        ledger.submit ◀── relay: signed bytes ─────────────┤
           │ relay.ts: wallet-copy checks, co-sign,        │
           │ simulate with sigVerify, journal, broadcast   │
        ledger.submit ◀── wallet-sent: signature ──────────┘
        ledger.refresh ◀── status reads until settled (client/flow.ts followStatus)
```

## Modules

| File | What it does | Needs |
|---|---|---|
| `types.ts` | Wire shapes both sides share: `TxBuild`, `TxStatus`, `TxSubmission`, `TxFailure`, `TxStage` | - |
| `server/build.ts` | `buildUnsignedV0`: strips caller budgets, waits for tables, probes at 1.4M CU and price 0, sets the limit from simulation (+ wallet-guard units), checks the size leaves 128 bytes for wallet guards, checks the signer set, simulates the final copy. `networkFee` splits base and priority | `@solana/web3.js` |
| `server/priority-fee.ts` | `recentPriorityFee`: a percentile of recent fees over the accounts the transaction writes, capped | `@solana/web3.js` |
| `server/lookup-tables.ts` | Load tables, wait until a fresh or freshly frozen table is usable, a safe `recentSlot` for create, extend in batches of 20 | `@solana/web3.js` |
| `server/wallet-copy.ts` | `acceptWalletSigned` (no server signature) and `cosignDifferences` / `assertCosignable` (server signs after the wallet) | `@solana/spl-token` (program ids) |
| `server/relay.ts` | `prepareRelay`: parse the wallet's bytes, run the right check, co-sign, simulate with `sigVerify: true` | the above |
| `server/send.ts` | `sendSigned`: broadcast the same bytes every 2 s while the lifetime holds, follow to a commitment, prove expiry before saying it. `followSignature` for wallet-sent signatures (read only) | `../core/encoding.ts` |
| `server/sender.ts` | Helius Sender: config checks, the tip instruction, `keepsSenderFees` after a wallet recompile, a `Broadcast` for `send.ts` | `node:crypto` |
| `server/ledger.ts` | `submit` and `refresh` over a `TxStore` you implement (one table): idempotent submissions, journal before broadcast, one reconcile step per status read | the above |
| `server/failure.ts` | `TxError` with a stage, `firstProgramFailure` (the program that raised the code, not its callers), `registryFromIdls`, `TOKEN_ERRORS`, `toFailure` | - |
| `server/ed25519.ts` | Signature checks with `node:crypto`, `signatureOf` | `node:crypto` |
| `server/pack.ts` | `pack`: as many items (claims, payouts) as fit one wallet-safe transaction | `@solana/web3.js` |
| `server/keys.ts` | `keypairFromEnv`: JSON byte array or base58, errors that never echo the value; `expectKey` | `../core/encoding.ts` |
| `server/testing/rewriting-wallet.ts` | A test signer that rewrites like Phantom, with an `attack` switch | - |
| `client/flow.ts` | `chooseRoute`, `signAndSubmit`, `followStatus`, `walletFailure` | `wallet/sign.ts`, `core/encoding.ts` |
| `client/react.ts` | `useTx`: building → review → signing → confirming → confirmed / failed, plus `check` for an unsettled one | `react`, `wallet/store.ts` |

Copy `server/` into the backend and `client/` + `types.ts` into the web (or put `types.ts` in the
contract package both import). `client/` needs the `wallet` engine.

## Assembly

```ts
// backend: POST /trades/build
const tables = await loadLookupTables(connection, [platformTable])
const build = await buildUnsignedV0({
  connection, payer: wallet, instructions: [...setup, buyIx],
  lookupTables: tables, microLamports: await recentPriorityFee(connection, [buyIx]),
  registry: registryFromIdls(launchlabIdl, myProgramIdl),
})
await txStore.insert({ id, wallet: wallet.toBase58(), status: 'built', cosigned: false, ...pick(build, 'transactionBase64', 'blockhash', 'lastValidBlockHeight') })

// backend: POST /transactions/submit and GET /transactions/:id
const deps = { connection, store: txStore, action: (r) => ({ requiredProgram: LAUNCHLAB_ID, cosigner: r.cosigned ? mintKeyFor(r) : undefined }) }
app.post('/transactions/submit', async (c) => c.json(await submit(deps, await c.req.json())))
app.get('/transactions/:id', async (c) => c.json(await refresh(deps, c.req.param('id'))))
// onError: a TxError becomes { error: toFailure(e, nextStepFor) } with a 4xx/5xx by stage
```

```tsx
// web
const tx = useTx({ api, wallet, walletReachesCluster: cluster !== 'localnet' })
<button onClick={() => tx.prepare(() => api.buildTrade(input))}>Review</button>
{tx.step === 'review' && <button onClick={() => tx.send(tx.build!)}>Sign</button>}
{tx.failure && <p>{STAGE_LABEL[tx.failure.stage]}: {tx.failure.message}</p>}
```

Keepers sign their own transactions: `buildUnsignedV0({ ..., walletSigned: false })`, sign, write
the bytes down, then `sendSigned(connection, { bytes, blockhash, lastValidBlockHeight, broadcast: senderBroadcast(cfg) })`.

## Behaviour worth knowing

- **The wallet always signs first.** Phantom blocks a transaction another key already signed
  ("could be malicious"). A vanity mint or partner key signs the copy the wallet returns.
- **Wallets rewrite what they sign.** Phantom replaces the compute budget and appends Lighthouse
  guards (100+ bytes, about 3,000 CU), so builds keep 128 bytes and 4,000 CU of room, and no check
  demands the same bytes or the same instruction order. A strict "same instructions, in order,
  only Lighthouse after them" check passes a test signer and still refuses the real wallet; test
  every user-signed flow with `rewriteLikePhantom`.
- **What a co-signature authorizes is all the server checks** in a co-signed copy: those
  instructions present and unchanged by resolved address, the co-signer in no other instruction
  except Lighthouse's, the blockhash unchanged, the co-signer slot still empty, every other
  signature valid. A transaction with no server signature is accepted however the wallet
  rewrote it, once the owner signed as fee payer and no program outside the action's appears.
- **A request Phantom blocks** usually means it can't predict the outcome: check that no other
  key signed first, that the transaction simulates cleanly with `sigVerify: false`, and that it
  sets its own compute budget.
- **Single-signer transactions go out through the wallet** (`signAndSendTransaction`) where it
  can; a localnet build relays everything because the wallet's own RPC can't reach it.
- **The probe simulates at price 0** so the 1.4M-CU ceiling can't refuse a payer who can afford
  the measured transaction.
- **A fresh lookup table can pass simulation and still be dropped** by the leader; builds wait
  past its last extension (and past its freeze, for a frozen one) plus 3 slots. Create tables
  with a `recentSlot` from `getBlocks(finalized-32, finalized-4)`, not the finalized slot.
- **Signed bytes are immutable intent.** Rebroadcast the same bytes; never rebuild a payment
  because its status is unreadable. Expiry needs the block height past the lifetime, the
  blockhash invalid at finalized, and no history. A wallet-sent signature is never declared
  expired from the build's lifetime (the wallet may have re-dated it).
- **The custom code belongs to the first failing program**; its callers fail after it with the
  same code. Anchor programs all number from 6000, so a code is read only with its program.
  Finalized failures need `getTransaction` for their logs.
- **Sender** needs the tip and a positive CU price inside the signed bytes: 5,000 lamports on the
  SWQoS-only route, 1,000,000 on the full route. After a wallet recompile, check
  `keepsSenderFees` before relaying.
- Fee claims and payouts that don't fit one transaction: `pack` takes them in order and reports
  how many it covered; build the rest next.
