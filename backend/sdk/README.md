# voynich

TypeScript SDK for Voynich, with browser and Node entries and the `voynich` CLI. `@voynich/contract` supplies the HTTP types and client. Install from the workspace or packed tarballs:

```sh
npm install @voynich/contract voynich
```

## Call and verify

Node reads `VOYNICH_API_URL` (default `http://127.0.0.1:9702`) and, for writes, `VOYNICH_KEYPAIR`, the path to a Solana JSON keypair. Public `models`, `model`, `enclaves`, `enclave`, `verify`, and `account(wallet)` calls never load that keypair, even when its configured path is invalid. Writes and `account()` without a wallet load the signing identity lazily in the Node entry.

```ts
import voynich from 'voynich'
const { output, receipt, verified } = await voynich.call('sketch-32', input)
```

In a browser, supply a wallet with a `PublicKey` and `signTransaction(VersionedTransaction)`:

```ts
import { createVoynich } from 'voynich'
const voynich = createVoynich({ apiUrl: 'http://127.0.0.1:9702', signer: wallet })
const result = await voynich.call('sketch-32', pixels, {
  onStep: step => console.log(step), // encrypting, awaiting-signature, escrowed, answering, verified
  signal: abortController.signal,
  enclave: enclaveAddress, // optional account address or signing key; otherwise select automatically
})
```

`sketch-32` accepts a 28×28 matrix, a flat 784-element array (including `Float32Array` or `Float64Array`), or `{ strokes, width, height }`. Each stroke is an array of `[x, y]` points. Pixel values are floats from 0 (background) to 1 (ink). `preprocessSketch` crops to ink, scales the longer side to 24 pixels while keeping aspect, and centers the result in 28×28, following the published manifest. Tensor models accept their JSON tensor directly.

`call` chooses a live granted enclave, authenticates its encryption key and active grant against chain accounts, encrypts locally, signs the escrow transaction, relays ciphertext, polls the answer, authenticates the receipt, then decrypts. Owner grants also authenticate the recipient enclave before wrapping the model key. These checks bind the requested model to its canonical PDA, the software measurement to the model's allowed list, and the record's owner, layout, signing key and current expiry to the chain configuration. The wallet signs first; additional local keys sign the wallet's returned transaction. Transaction submission and following use the API ledger. Polling after confirmation waits for the indexer's snapshot before dependent reads.

Enclave responses include `reachable` and `lastSeen` (the latest successful probe time, or null). Availability is separate from attestation expiry. The SDK selects only live, reachable enclaves holding an active grant; an explicit `enclave` choice must meet the same conditions. If none qualify, it fails before opening escrow.

`verify(receiptAddressOrCallOrTransactionSignature)` binds the supplied identifier to the receipt, then reads chain accounts through the configured RPC, checks account owners and PDAs, receipt fields and payments, the Ed25519 signature, allowed measurement, and attestation expiry **at the receipt slot**. For a transaction signature it also requires a successful transaction containing an authenticated `CallSettled` self-CPI event for that exact receipt. A currently expired record can verify an older receipt. If the record was refreshed after settlement, the SDK reads authenticated `RecordUpdated` self-CPI events from retained RPC history. Missing history raises an error; it is never accepted as verification. Callers can supply their own `Connection` through `createVoynich`.

Fixture mode uses real envelope encryption and signature checks, but has no chain proof. Fixture results return `fixture: true`, `verified: false`, and individual `checks`; decryption still works. Real results require signature, record and expiry checks all to pass.

The SDK binds real operations to its compiled Voynich program ID and reads the attestation program and layout from that program's on-chain Config. The RPC connection is a trusted chain view: the API's configured RPC/relay is the default, or supply a trusted `Connection` explicitly. Fixture mode and RPC endpoint selection are trusted application configuration; receipt and enclave facts from the API are checked against that chain view.

## Seal, grant, refund

```ts
const result = await voynich.seal({
  weights: onnxBytes, manifest,
  price: { amount: '100000', mint: null, decimals: 9, symbol: 'SOL' },
  operatorShareBps: 2500,
  allowedMeasurements: [measurementHex],
  uploadFundingLamports: quotedUploadFunding,
  grantEnclave: enclaveAddress,
  onPrepared: async state => saveEncryptedState(state),
  onProgress: progress => updateProgress(progress),
})
await voynich.grant(result.model.address, anotherEnclave, result.resume.modelKey)
await voynich.refund(callAddress)
```

Prices and funding are decimal base-unit strings. Null mint means SOL. Upload funding is explicit: choose it from current transaction fees and the number of writes, rather than assuming a network fee constant.

The device encrypts weights into authenticated 64 KiB plaintext chunks. It allocates program-owned Weights accounts (up to eight, each at most 10 MiB including its 56-byte header) in separate owner-signed transactions before `create_model`. This adds one wallet approval per Weights account; it keeps account allocation out of a crowded create-model transaction. The owner then approves create, seal and, when requested, grant. Each upload write is signed by the funded one-time upload key without further owner prompts. API-built writes carry at most 512 ciphertext bytes and stop at each account boundary. Uploads run in waves of four parallel writes; progress counts confirmed bytes and transactions, including resumed progress.

`onPrepared` runs before chain allocation so a browser can durably encrypt and save the model key, ciphertext, nonce prefix, upload key and allocation keys. Retain that state until the seal completes. To resume, pass it as `resume` with the original manifest and settings. The SDK skips existing allocations and written ranges, uploads the rest, seals, and optionally grants. Keypairs in browser state need an explicit serialization format; never store them as plaintext JSON. The returned `resume` contains secrets and must not be logged.

Before any allocation or wallet approval, `seal` requests a cost quote with the complete create metadata. It requires a positive `canCreate` size verdict; an oversized manifest fails with its transaction byte count and the 1104-byte wallet-safe limit. A size-only quote provides costs but cannot approve creation.

The quote's `requiredUpfrontLamports` includes a rent-exempt minimum retained in the owner's wallet during the upload, in addition to costs and the temporary upload-key reserve. The retained minimum remains available after sealing; it is not an extra fee.

`INSUFFICIENT_FUNDS` responses carry optional `funding: { mint, required, available, shortfall }` in the error envelope. Amounts are decimal base-unit strings; null mint means lamports. Native requirements include the transaction fee, new account rent and the action's native escrow or upload funding. Token shortages identify the SPL mint separately. Callers can read these fields through `ApiClientError.body.error.funding` and show the amount needed before another approval.

Seal returns `{ model, resume }`. Other writes return the confirmed transaction status. Read methods are `models`, `model`, `enclaves`, `enclave`, and `account`; `api` exposes the complete typed HTTP client. `VoynichError` carries a code and, for known call failures, the Call and refund state.

Transaction status is `built` until submission. Unknown build or transaction IDs return `NOT_FOUND` (404). Repeating a submission's idempotency key returns its recorded status; using another key for the same build returns `IDEMPOTENCY_CONFLICT` (409). The current API omits `error` when there is no failure. The contract also accepts legacy `error: null` responses for compatibility.

Owners can manage a model with `setPrice(model, price: Money, operatorShareBps)`, `retire(model)`, and `revoke(model, enclaveAddressOrSigningKey)`. Each accepts optional `{ signal }` as its final argument and returns the confirmed transaction status. Retirement blocks new calls; revocation blocks new calls through that grant. Existing open calls can still settle or refund.

The revoke HTTP build is `POST /v1/models/{id}/revoke/build` with `{ wallet, enclave }`, where `enclave` is the enclave account address. `api.revokeGrant(model, body)` returns a `Build` with action `revoke_grant`; the owner signs and submits it through the transaction ledger. A missing grant returns `GRANT_REQUIRED`. Reads remain public, and the program enforces the owner's signing authority.

## CLI

```sh
voynich models
voynich call sketch-32 drawing.json
voynich verify RECEIPT_OR_CALL_OR_TRANSACTION
voynich account WALLET
voynich seal model.onnx --manifest manifest.json --state owner.enc.json --price 100000 --operator-share-bps 2500 --measurement HEX_48_BYTES --upload-funding LAMPORTS --enclave ENCLAVE
voynich seal --resume --manifest manifest.json --state owner.enc.json --price 100000 --operator-share-bps 2500 --measurement HEX_48_BYTES --upload-funding LAMPORTS --enclave ENCLAVE
voynich grant sketch-32 ENCLAVE --state owner.enc.json
voynich refund CALL
voynich model price sketch-32 --price 120000 --operator-share-bps 2500
voynich model revoke sketch-32 ENCLAVE
voynich model retire sketch-32
voynich enclave register
voynich enclave run
voynich enclave status
```

`--api-url` and `--keypair` override their environment variables. An SPL-priced model also needs `--mint`, `--decimals`, and optionally `--symbol` (the default unit label is the mint address). The CLI prints public JSON results on stdout; prompts, progress and runtime diagnostics go to stderr. Verification failures return a nonzero exit code while retaining their JSON result.

For signing commands, the CLI uses `--keypair`, then `VOYNICH_KEYPAIR`, then the Solana CLI config's `keypair_path` in `~/.config/solana/cli/config.yml`. If that config is absent, it uses `~/.config/solana/id.json`. Public reads such as `models`, `verify`, and `account WALLET` do not load a default wallet. Enclave register/run use `--keypair` as an `OPERATOR_KEYPAIR` override, otherwise retain `OPERATOR_KEYPAIR` or use the Solana CLI default path; enclave status does not configure an operator signer. The Node SDK itself continues to use `VOYNICH_KEYPAIR` only.

The CLI asks once for an owner-file password during seal or grant, without echoing it. `VOYNICH_PASSWORD` supplies it for noninteractive use. Owner files use scrypt (N=131072, r=8, p=1, random 16-byte salt) and XChaCha20-Poly1305 (random 24-byte nonce); writes replace the encrypted file atomically. No plaintext model or upload keys are written.

The enclave commands dynamically load the separately installed `voynich-enclave` Node package. Its runtime owns operator/attestation setup and reads its documented environment variables. It is excluded from the SDK's browser dependency graph.

## Program and crypto modules

`voynich/crypto` is pure browser-safe XChaCha20-Poly1305, X25519/HKDF-SHA256 and Ed25519. `voynich/program` exports typed program clients, `PROGRAM_ID`, `ATTESTATION_PROGRAM_ID`, `BN`, PDA helpers, event accounts and the attestation decoder. The generated IDLs are TS modules under `voynich/idl/voynich` and `voynich/idl/attest`.

`@voynich/contract` exports browser-safe `encodeManifest` and `decodeManifest`. On-chain storage uses minified JSON and omits the sketch's default `[1,1,28,28]` shape, `input`/`logits` names and canonical preprocessing text. Decoding restores those defaults and retains every label; existing full JSON manifests remain readable. Tensor shapes and custom metadata remain explicit. API builds, setup, indexer, SDK and runtime share this codec.

`sealWeights(plaintext, key?)` chooses a fresh nonce prefix. To reconstruct the identical ciphertext and SHA-256 from the original weights, pass the original key and cipher header as a third argument:

```ts
import { sealWeights } from 'voynich/crypto'
const reconstructed = sealWeights(originalOnnxBytes, modelKey, originalCipherHeader)
```

The header is `{ cipher: 'xchacha20poly1305-64k-v1', chunkBytes: 65536, noncePrefix: Uint8Array(16), plaintextBytes: number }`. The supplied header must match the plaintext length and supported format. Reuse it only with the exact original weights and key; changed weights need a fresh nonce prefix. The existing `seal({ resume })` path already retains ciphertext and does not reconstruct it automatically.

The root entry selects `dist/index.js` for browser builds and `dist/node.js` for Node. Filesystem access, password prompts and encrypted file handling stay in Node-only entry points.
