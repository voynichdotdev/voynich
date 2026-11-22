# Voynich backend

Solana Anchor programs, shared contract schemas, TypeScript SDK and CLI, reproducible enclave runtime, and the PostgreSQL-backed API, indexer, and crank services.

## Packages and programs

| Path | Description |
| --- | --- |
| `programs/voynich` | Core protocol program: models, chunked weights, enclaves, grants, calls, receipts, and published measurements |
| `programs/attest` | Attestation verifier program for development and pre-cutover mainnet enclaves |
| `programs/cpi-caller` | Example CPI caller demonstrating on-chain model calls |
| `programs/bounty` | Example bounty escrow program settled by verified Voynich receipts |
| `voynich-cpi` | Rust CPI client crate for calling Voynich from other Solana programs |
| `contract/` | `@voynich/contract` Zod schemas, typed HTTP client, fixtures, and OpenAPI generator |
| `sdk/` | `voynich` browser/Node SDK and CLI |
| `enclave/` | `voynich-enclave` reproducible ONNX inference runtime |
| `src/` | Hono API server, chain indexer worker, and refund/buyback crank worker |
| `prisma/` | PostgreSQL schema and migrations |
| `models/` | Training scripts, manifests, and weights for `sketch-32` and `text-1m` |

## Build

Requires Node 22.

```bash
npm install
cp .env.example .env
npm run build
```

`npm run build` generates the Prisma client, builds `@voynich/contract`, `voynich`, and `voynich-enclave`, and compiles the API, workers, and scripts.

## Verify the enclave build

```bash
npm run verify:build --workspace voynich-enclave
```

This runs clean builds from separate working directories, confirms byte-identical `enclave/dist/runtime.js` output with zero host-specific paths, and prints the SHA-384 `measurement` and SHA-256 `recipeHash`.

## Services

All three roles share one PostgreSQL database (`MODE=chain` for live chain indexing, or `MODE=fixture` for local UI development without PostgreSQL or Solana):

| Role | Start command | Responsibility |
| --- | --- | --- |
| API | `npm start` | Public reads, ciphertext range proxy, transaction building, submission, encrypted relay, SSE |
| Indexer | `npm run start:indexer` | Chain event ingestion, PostgreSQL apply, durable cursors, account enrichment |
| Crank | `npm run start:crank` | Expired call refunds and protocol-fee buyback and burn |

See `deploy/*.env.example` for per-service environment variables and `enclave/README.md` for running an enclave node.
