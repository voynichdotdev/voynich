# jupiter

Jupiter quotes and swap instructions for servers and keepers (buybacks, fee conversion), every
answer checked before it is built on: the quote against the request, the route against the quote,
the setup against the taker. Two takers: one that signs at top level (a wallet, a keeper key), and
a program PDA whose program signs the route by CPI.

## Modules

| File | What it does | Needs |
|---|---|---|
| `http.ts` | `createJupiterClient({ apiKey })`: paced queue, one retry on 503, `JupiterError` (`RETRY`, `NO_ROUTE`, `REFUSED`, `INVALID_RESPONSE`, `MISMATCH`) | `fetch` |
| `schemas.ts` | zod shapes of quote and swap-instructions answers, `instructionFromWire` | `zod`, `@solana/web3.js` |
| `quote.ts` | `quoteExactIn(client, request)`: bound to the request, minimum checked with Jupiter's rounding; `minimumOut` | `http.ts`, `schemas.ts` |
| `route-data.ts` | `readRouteArgs`, `writeRouteArgs`: amounts of `route`, `shared_accounts_route`, `route_v2`, `shared_accounts_route_v2` at their fixed offsets | nothing |
| `instructions.ts` | `fetchSwapInstructions`, `checkRoute`, `readAtaCreate`, `JUPITER_PROGRAM_ID` | `@solana/spl-token` |
| `swap.ts` | `swapInstructions(client, { quote, taker })`: setup, swap, cleanup and lookup tables for a top-level signer, WSOL opened first | the files above |
| `pda-taker.ts` | `pdaSwapInstructions(client, { quote, taker, payer, source, destination })`: route for a CPI, setup paid by the crank, hop accounts listed | the files above |

The lookup tables come back as addresses; the transaction builder (`tx` engine) loads them and
compiles over them together with its own.

## Assembly

```ts
const jupiter = createJupiterClient({ apiKey: process.env.JUPITER_API_KEY })

// a keeper key buying the product token with SOL it holds
const quote = await quoteExactIn(jupiter, { inputMint: NATIVE_MINT, outputMint: mint, amount: lamports, slippageBps: 100, maxAccounts: 40 })
const { setup, swap, cleanup, lookupTables } = await swapInstructions(jupiter, { quote, taker: keeper.publicKey })
// claim + setup + swap + cleanup + burn of quote.minimumOut, compiled by the tx engine

// a buyback PDA as the taker: the program CPIs `swap` with the PDA's seeds
const route = await pdaSwapInstructions(jupiter, { quote, taker: vaultPda, payer: crank.publicKey, source: vaultWsol, destination: vaultTokens })
const ix = await program.methods.buyback(new BN(quote.inAmount.toString()), Buffer.from(route.swap.data))
  .accountsStrict({ ... })
  .remainingAccounts(route.remainingAccounts)
  .instruction()
// transaction: route.setup, then ix
```

## Behaviour worth knowing

- `otherAmountThreshold` is `outAmount − floor(outAmount × slippageBps / 10000)`: the minimum
  rounds up. `quoteExactIn` checks Jupiter's value with that formula, and every other place that
  recomputes a minimum (server, client, a program, a localnet stand-in) rounds the same way, or
  live quotes are refused. Captured responses keep Jupiter's own field.
- Route data is read and rewritten at fixed offsets per instruction (v2 layouts right after the
  discriminator or the shared variant's id byte, v1 layouts in the last 19 bytes). Never search
  the data for an amount's bytes.
- `skipUserAccountsRpcCalls` is always on, so Jupiter reads nothing of the taker's. It then lists
  an open for every taker token account the route might use, including the output ATA when
  `destinationTokenAccount` names another account; opens no route meta uses are dropped, and the
  rest are rebuilt as idempotent opens.
- A swap into or out of SOL with `wrapAndUnwrapSol` pays through the taker's WSOL account, and
  Jupiter leaves out opening it when it existed at build time while its own cleanup closes it.
  Swaps built ahead, or sent after an unwrap, then fail inside the route (Token
  `InvalidAccountData`, Jupiter 6025). `swapInstructions` opens it idempotently in front of every
  such swap.
- A PDA cannot pay or sign at top level: its token-account opens are paid by `payer`, and
  `remainingAccounts` carries the route with every signer flag cleared, the Jupiter program first.
  The program invokes `swap` with the PDA as signer.
- With a PDA taker, a multi-hop `route_v2` moves each middle mint through the taker's own ATA for
  that mint; `hops` lists them. A PDA that holds other balances (a fee PDA with an ATA per mint)
  sees those accounts in the route. After the CPI the program checks every taker token account
  the route touched: still owned by the PDA, no delegate, no close authority, and no smaller
  unless it is the source. The PDA's signature reaches every program the route calls.
- A buyback that anyone may call can't take the caller's minimum. Price the route on chain
  against the token's own venue (its curve or pool reserves with the venue's fees, which match
  Jupiter's quotes to the unit) and require the route to deliver that less a small allowance.
- `dexes` picks a venue by label, not one pool among several of the same venue. When the route
  must use a specific pool, check `routePlan[0].swapInfo.ammKey` and build that leg yourself
  when Jupiter prefers another pool.
- `maxAccounts` budgets the route so the instructions around it still fit. Direct routes into
  pump.fun mints go through Meteora DLMM pools and need 20 or more; a proof-carrying swap with a
  real route outgrows Jupiter's own tables, so keep a lookup table on the server and extend it the
  first time each pool is used.
- A burn after a buyback burns what the swap delivered, read from the transaction's pre and post
  token balances, never the account's whole balance (it may hold a team allocation of the same
  token).
- Keyless use is paced at one request every two seconds per client (the allowance is per IP); a
  key lifts the pacing unless `intervalMs` sets one. Jupiter answers 503 in bursts: one retry,
  then `RETRY` with a message to request a new quote. lite-api.jup.ag stopped on 30 October 2026;
  api.jup.ag takes the same paths.
