# Voynich Agent Caller Example

`agent-caller.mjs` is a self-contained Node.js script showing how an autonomous agent calls a live sealed model on Voynich with its own Solana keypair, verifies the returned on-chain Receipt before trusting the inference output, and emits a JSON report carrying the proof.

## What it does

1. Loads a Solana keypair from `VOYNICH_KEYPAIR`.
2. Creates a `voynich` SDK client with `createVoynich({ apiUrl, signer })`.
3. Runs `client.call(model, drawing, { answerMode })`, paying the model fee in escrow, encrypting the input to the enclave's attested X25519 key, and waiting for on-chain settlement.
4. Performs an independent verification pass via `client.verify(receipt.address)` checking the enclave Ed25519 signature, on-chain Receipt and attestation record bindings, attestation slot window, and answer hash.
5. Aborts with exit code `1` unless `verification.verified === true`.
6. Prints the JSON report to stdout and optionally POSTs it to `REPORT_WEBHOOK_URL`.

## Environment variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `VOYNICH_KEYPAIR` | Yes | | Path to a 64-byte Solana JSON keypair file funded with SOL for call fees and rent. |
| `VOYNICH_API_URL` | No | `https://api.voynich.dev` | Voynich API base URL. |
| `VOYNICH_SITE_URL` | No | `https://voynich.dev` | Voynich web base URL used for `receiptUrl` and `accountUrl`. |
| `VOYNICH_MODEL` | No | `sketch-32` | Model slug or address to call. |
| `VOYNICH_ANSWER_MODE` | No | `open` | `open` (writes answer bytes into the Receipt) or `sealed` (encrypted to the caller). |
| `REPORT_WEBHOOK_URL` | No | | Optional HTTP(S) URL that receives the verified JSON report via `POST`. |

## Run

From the `backend/` workspace:

```bash
VOYNICH_KEYPAIR=./agent.json \
VOYNICH_MODEL=sketch-32 \
VOYNICH_ANSWER_MODE=open \
node sdk/examples/agent-caller.mjs
```

Or on PowerShell:

```powershell
$env:VOYNICH_KEYPAIR = ".\agent.json"
$env:VOYNICH_MODEL = "sketch-32"
$env:VOYNICH_ANSWER_MODE = "open"
node sdk/examples/agent-caller.mjs
```

## Output report

```json
{
  "agent": "<agent-wallet-pubkey>",
  "model": "sketch-32",
  "answerMode": "open",
  "output": {
    "label": "clock",
    "probability": 0.97
  },
  "receiptAddress": "<receipt-pda>",
  "receiptUrl": "https://voynich.dev/receipts/<receipt-pda>",
  "accountUrl": "https://voynich.dev/account?wallet=<agent-wallet-pubkey>",
  "slot": "419284102",
  "transactionSignature": "<settle-tx-signature>",
  "verified": true,
  "checks": {
    "signature": true,
    "record": true,
    "expiry": true,
    "answer": true
  }
}
```

Inspect all receipts settled by the agent wallet at `/account` (or programmatically via `GET /v1/accounts/<agent-wallet-pubkey>`).
