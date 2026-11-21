# text-1m

A compact 4-layer causal byte-level Transformer paired with a sealed rank-8 LoRA adapter (`voynich/adapter/v1`). It is the second sealed model on Voynich and the first sealed text adapter: its open ONNX base is fetched and verified by SHA-256, its encrypted LoRA adapter lives in Solana accounts, and granted enclaves merge both strictly in memory before running inference.

| | |
|---|---|
| Architecture | 4-layer causal Transformer (`d_model=192`, `n_heads=6`, `d_ff=512`, `context_len=128`, `vocab_size=258`) |
| Parameters | `1,506,434` base (`53,010` adapter: rank-8 `alpha=16` LoRA on 16 attention projections + `lm_head`, plus `lm_head_b` delta) |
| Base ONNX size | `6,143,522` bytes (`text-1m-base.onnx`, SHA-256 `1184a80cdd836f39c6e4af1e26c463042eeaaeecf0b7ee3750f4dbffcc93c84f`) |
| Sealed adapter size | `214,673` bytes (`text-1m.voya`, `28.62x` smaller than base, one Weights account) |
| Domain held-out loss / bpb / ppl | Base `3.1173` / `4.4973` / `22.59` -> Adapter `2.8538` / `4.1171` / `17.35` (`836` held-out tokens) |
| ONNX parity & CPU latency | `onnxMaxLogitDiff = 1.51e-05` (`< 1e-4`), `24.71` ms per 32-token generation on CPU |
| Input | `input_ids`, int64 `[1, seq]` (`1 <= seq <= 128`), byte-level UTF-8 `0..255` + `BOS=256` + `EOS=257` |
| Output | `logits`, float32 `[1, seq, 258]` |

Exact figures: `metrics.json`. Tokenizer and input kind: `manifest.json`. Base digest and size: `base.json`.

**Two-stage training (`train.py`, seed `42`):**
1. **Base pretraining (`text-1m-base.onnx`):** trains all `1,506,434` parameters for `750` steps on the first `90%` (`1,003,854` bytes) of public-domain Tiny Shakespeare (`1,115,394` bytes total), measuring `1.9118` loss (`2.7582` bpb) on the remaining `10%` (`111,540` bytes) held-out split. Exports single-file fp32 ONNX opset 13 with dynamic sequence length `1..128`.
2. **Sealed adapter fine-tuning (`text-1m.voya`):** freezes every base parameter, attaches rank-8 (`alpha=16`) LoRA adapters to all 16 attention projections (`blocks.{0..3}.attn.{q,k,v,o}_w`) and `lm_head_w` plus an elementwise `delta` on `lm_head_b`, and fine-tunes for `50` epochs on the domain Q&A train split (`7,667` tokens) while evaluating on the disjoint held-out split (`836` tokens).

**Train again:** `python train.py [data-dir]` downloads the open corpus into `data-dir` (or a system temp cache), trains both stages deterministically, verifies ONNX merged logit parity against PyTorch, benchmarks CPU latency, and rewrites `text-1m-base.onnx`, `text-1m.voya`, `manifest.json`, `base.json`, and `metrics.json`.
