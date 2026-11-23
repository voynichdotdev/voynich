# Voynich enclave runtime

The runtime loads sealed ONNX models and settles signed encrypted answers. This
round runs as a normal Node 22 process, with CPU inference from `onnxruntime-node`.
The same container can run inside a confidential VM. Development reports are signed
by the configured development root; they are not hardware attestation.

Build from `backend/` with `npm run build --workspace voynich-enclave` after the
contract and SDK builds. `build.mjs` runs `esbuild` with a fixed working directory
(`enclave/`), `charset: 'utf8'`, `legalComments: 'none'`, LF line endings, and a
host-path guard so `enclave/dist/runtime.js` is byte-identical across clean builds
and operating systems. The build also writes `enclave/dist/recipe.json` with
`version`, `nodeVersion`, `esbuildVersion`, `lockfileSha256`, `runtimeBytes`,
`measurement`, and `recipeHash` (the SHA-256 of the canonical `voynich/enclave-recipe/v1`
manifest over `enclave/Dockerfile`, `enclave/build.mjs`, `enclave/package.json`, and
`package-lock.json`). `Dockerfile` pins `node:22-bookworm-slim` by OCI digest, sets
`SOURCE_DATE_EPOCH`, and installs dependencies with `npm ci --include=dev`.

Run `npm run verify:build --workspace voynich-enclave` from `backend/` to execute
clean builds from separate working directories, confirm byte-for-byte identical
`enclave/dist/runtime.js`, `measurement`, and `recipeHash` with zero host paths, and
print `{ reproducible, measurement, recipeHash, bytes }`. `node enclave/dist/runtime.js --measurement`
prints the 48-byte SHA-384 measurement of the built bundle without booting the runtime.
The bundle includes the SDK and JavaScript dependencies; the native ONNX package stays
external. Local setup reads this exact file when setting a model's allowed measurement.

Operators can install `voynich-enclave` alongside `voynich`. Its executable resolves
real paths when checking the entry point, including npm's linked bin. RPC logs and
runtime diagnostics go to stderr; command results on stdout remain JSON. Package
0.1.3 includes the shared compact-manifest decoder. The rebuilt bundle has a new
measurement, so local setup must seal against it when starting a fresh local stack.

From `backend/`, run:

```bash
node --env-file=.env --env-file=.local/services.env enclave/dist/runtime.js
```

The SDK CLI's `enclave register`, `enclave status` and `enclave run` use the runtime's
`registerFromEnv`, `statusFromEnv` and `runFromEnv` exports. Registration performs
attestation and registration only, with no HTTP server or background loop.
Status reads existing sealed state and chain accounts without creating keys or
writing files. When no state file exists, it returns `registered: false` with null
enclave and signing-key addresses.

Required configuration:

| Variable | Meaning |
| --- | --- |
| `SOLANA_RPC_URL` | The chain RPC endpoint. |
| `CLUSTER` | `localnet`, `devnet`, or `mainnet-beta`. |
| `OPERATOR_KEYPAIR` | Operator keypair JSON file, or a JSON 64-byte secret array. Set to your operator keypair path. |
| `DEV_ATTESTATION_ROOT_KEYPAIR` | Development root keypair file or JSON array; it must match attest Config. Set to your development root keypair path. |
| `DEV_SEALING_KEY` | A 32-byte key as 64 hexadecimal characters. Required on remote clusters. On localnet only, absent values derive a named development stand-in key from the operator secret and `voynich/dev-sealing/v1`. |
| `PROGRAM_ID`, `ATTESTATION_PROGRAM_ID` | Optional overrides of the bundled program IDs. |
| `LOOKUP_TABLE` | The prepared table written by setup into `.local/services.env`. |
| `ENCLAVE_STATE_PATH` | Sealed persistent state; default `.local/enclave.sealed.json`. A second enclave needs a separate path. |
| `ENCLAVE_ENDPOINT` | Published endpoint; default `http://127.0.0.1:9707`, or the configured port. |
| `ENCLAVE_REGION` | Optional lowercase region code (1 to 16 characters, `a-z`, `0-9`, `-`, e.g. `us-east`), reported on `/health` and `voynich enclave status` and checked against each model's on-chain `Policy.allowed_regions`. |
| `ENCLAVE_HOST`, `ENCLAVE_PORT`, `PORT` | Listener; defaults `127.0.0.1` (`0.0.0.0` when `PORT` is set), `9707`. `PORT` overrides `ENCLAVE_PORT` for Railway/container hosts. Use `9708` for the second local enclave. |
| `ENCLAVE_POLL_MS` | Grant, discovery and pre-expiry refresh interval; default `5000`. |
| `ENCLAVE_RPC_RPS`, `ENCLAVE_SCAN_INTERVAL_MS` | Required budgets for a remote RPC; loopback uses the verified RPC engine's local defaults. |

Persist the state file across restarts and provide the same sealing key. It is
AES-256-GCM encrypted with a fresh nonce at each atomic write. It holds the Ed25519
seed, X25519 secret, wrapped grants, encrypted call envelopes, answers and signed
transaction journal. A state file is bound to its chain genesis and program IDs.
The runtime journals signed bytes before broadcast and follows those same bytes
after restart. Decrypted model weights stay in memory.

The runtime refreshes reports before expiry, registers its encryption key with the
operator and enclave transaction signatures, and polls its grants. For each grant it
reads the ordered weights accounts, checks their headers and the complete ciphertext
SHA-256, unwraps the model key, authenticates every weight chunk, and loads ONNX from
memory. It grants other registered live enclaves only when their measurement is
allowed. It leaves owner-revoked grants revoked.
Sync failures are logged with redacted messages and retried on the next configured
poll interval while the HTTP server continues serving requests.

`POST /v1/calls/:call/input` accepts `{ "envelope": "<base64>" }`. It checks the
on-chain call, enclave, input hash, deadline and attestation before inference. The
decrypted input is `{ "input": [numbers], "outputPublicKey": "<base64>" }`.
Inputs are flat tensors in manifest order; sketches contain 784 normalized numbers
with background 0 and ink 1. The manifest supplies the tensor shape and optional
ONNX input/output names. Outputs are logits, converted with softmax to
`{ "label": "...", "scores": [{ "label": "...", "probability": 0.9 }] }`,
with the five highest scores.

`GET /v1/calls/:call/answer` returns `status`, nullable `outputEnvelope`, `outputHash`,
`signature`, `settleTransaction`, `receiptAddress` and `failure`. The API joins this
with its indexed Call. Only `status: "answered"` means settlement confirmed. Failures
include whether the full escrow is awaiting its deadline, refundable or refunded.
The runtime creates any SPL recipient ATAs and verifies the receipt's Ed25519
signature in the same transaction that settles the call.

The linked entry point and read-only status command were checked locally, including
JSON-only stdout and RPC logs on stderr.
