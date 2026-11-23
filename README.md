# Voynich

> Hide your model in plain sight.

Voynich is a Solana protocol for sealed machine learning models. Model weights live on chain as XChaCha20-Poly1305 ciphertext that anyone can inspect and fetch. Only attested enclaves holding a wrapped key grant can decrypt and run them. Every inference call escrows payment on chain, returns an encrypted answer, and settles with an Ed25519-signed receipt verified against the enclave's attestation record.

Live app: [voynich.dev](https://voynich.dev)
API: `https://api.voynich.dev`
X: [@voynichdotdev](https://x.com/voynichdotdev)

## Mainnet addresses

| Component | Address |
| --- | --- |
| `voynich` program | `65H3C7T6C2DmbkR9ssBBmNtqpybWcYwotkkETL4E7RSS` |
| `attest` verifier | `9nt8ErJoyTnn79Hd79tEzViQGavTF2HLiJ4fjoN7U64g` |
| `cpi-caller` program | `5niikRYqdGcR4KJd9aXfQaYdoQHzdrF1sDyiwrTvbEoa` |
| `bounty` program | `8Sm13coiVCjiHAp6NNvuJv36xcFqLN84ykZgqYBmX2ws` |
| `sketch-32` model | `431poxuxU5h5BE4nxazgLfxVEdg1xjipQWknyVN8ZobW` |
| `text-1m` model | `3PyKubqJiGi9aFUiQJMBX9VMFsegTSxZtZMmoJic6oza` |
| `VOYNICH` token mint | `baQxEuzMJ69RExbkCGLSrdSueWXCfp4tbi4nKZQpvoy` |

## Repository layout

```text
backend/
  programs/       Solana Anchor programs (voynich, attest, cpi-caller, bounty)
  voynich-cpi/    Rust CPI crate for calling sealed models from Solana programs
  contract/       @voynich/contract schemas, typed HTTP client, OpenAPI spec
  sdk/            voynich browser and Node SDK + CLI
  enclave/        voynich-enclave reproducible ONNX runtime and Dockerfile
  src/            API server, chain indexer, and refund/buyback crank
  prisma/         PostgreSQL schema and migrations
  models/         sketch-32 (Quick, Draw! CNN) and text-1m (LoRA Transformer)
  tests/          Program and backend integration tests
web/
  app/            Next.js App Router site, model runner, sealing studio, docs
  components/     UI components and receipt verifier
  content/docs/   Product, SDK, CLI, CPI, and operator documentation
  lib/            Browser crypto, wallet integration, and API client
```

## Quickstart

### Call a sealed model from Node

```ts
import voynich from 'voynich'

const { output, receipt, verified } = await voynich.call('sketch-32', input)
```

Set `VOYNICH_API_URL=https://api.voynich.dev` and `VOYNICH_KEYPAIR=/path/to/keypair.json` in your environment. See `backend/sdk/examples/` for complete scripts.

### Build and verify the enclave runtime

The enclave runtime builds deterministically so anyone can reproduce the on-chain SHA-384 measurement from source:

```bash
cd backend
npm ci
npm run build --workspace @voynich/contract
npm run build --workspace voynich
npm run verify:build --workspace voynich-enclave
```

`verify:build` runs clean builds across isolated directories, checks for zero host-specific paths, and prints the bundle `measurement` (SHA-384) and `recipeHash` (SHA-256 over `enclave/Dockerfile`, `enclave/build.mjs`, `enclave/package.json`, and `package-lock.json`).

For this source tree:
- `measurement`: `75aa88f05b96d48b7fd1d609c79f8329e80fadd0134e01639fe6c38b507a5266edd9273a7afbf4964841d722b4257543`
- `recipeHash`: `527238c19a5d9925a92a4b8c6c64cbe1160d37b81be9ea067fe1bdfaad78ba57`

### Run the web app locally

```bash
cd web
npm install
npm run dev
```

Point `NEXT_PUBLIC_API_URL` at `https://api.voynich.dev` (or a local backend running in `MODE=fixture` or `MODE=chain`).

## License

MIT. See [LICENSE](LICENSE).
