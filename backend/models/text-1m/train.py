"""Deterministic two-stage trainer and ONNX / voynich/adapter/v1 exporter for text-1m.

Stage 1 pretrains a 4-layer causal byte-level Transformer (d_model=192, n_heads=6, d_ff=512,
context_len=128, vocab_size=258) on public-domain English text (Tiny Shakespeare, 1.11 MB,
strict 90/10 train/held-out split) and exports text-1m-base.onnx.
Stage 2 freezes every base parameter, attaches rank-8 LoRA (alpha=16) on all 16 attention
projections plus lm_head and a delta on lm_head bias, fine-tunes on a separate train/held-out
split of concise Solana, cryptography, and confidential-compute Q&A prompts, verifies ONNX
merged logit parity (< 1e-4), benchmarks CPU inference latency, and writes text-1m.voya,
manifest.json, base.json, and metrics.json.

Usage:
  python train.py [data-dir]
"""

from __future__ import annotations

import hashlib
import json
import math
import random
import struct
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
import torch
import torch.nn as nn
import torch.nn.functional as F

SEED = 42
VOCAB_SIZE = 258
BOS_ID = 256
EOS_ID = 257
CONTEXT_LEN = 128
D_MODEL = 192
N_HEADS = 6
D_FF = 512
N_LAYERS = 4
LORA_RANK = 8
LORA_ALPHA = 16.0

SHAKESPEARE_URL = "https://raw.githubusercontent.com/karpathy/char-rnn/master/data/tinyshakespeare/input.txt"

# Stage 2: concise domain Q&A and completions (Solana, cryptography, confidential compute, Voynich, general prompts).
# Answers stay concise (<= 58 bytes) so greedy decoding finishes cleanly at EOS within maxOutputTokens=64.
# Strictly partitioned into train vs held-out validation pairs with zero overlap.
DOMAIN_TRAIN_PAIRS = [
    ("Q: What is Voynich?\nA:", " Voynich runs sealed models on Solana with verified receipts."),
    ("Q: Explain Voynich.\nA:", " Voynich seals encrypted models and verifies every enclave call."),
    ("Q: What does Voynich do?\nA:", " Owners seal encrypted weights and sell verified enclave calls."),
    ("Q: What is a sealed model?\nA:", " Encrypted weights on Solana that only granted enclaves open."),
    ("Q: Explain sealed models.\nA:", " Sealed models keep weights encrypted on chain until granted."),
    ("Q: What is a sealed adapter?\nA:", " Compact encrypted LoRA weights merged onto an open base."),
    ("Q: Explain sealed adapters.\nA:", " Sealed adapters pair a verified open base with private LoRA."),
    ("Q: How do sealed adapters work?\nA:", " Enclaves verify the open base SHA-256 and merge in memory."),
    ("Q: How does Voynich verify an answer?\nA:", " Receipts check signature, attestation, expiry, and output hash."),
    ("Q: How do receipts prove inference?\nA:", " Receipts bind input hash, output hash, and enclave signature."),
    ("Q: What cipher encrypts weights on Voynich?\nA:", " Weights use 64 KiB chunked XChaCha20-Poly1305 encryption."),
    ("Q: Why use XChaCha20-Poly1305?\nA:", " Each 64 KiB chunk verifies integrity and rejects tampered bytes."),
    ("Q: How are model weights committed on chain?\nA:", " Models commit a SHA-256 Merkle root over 64 KiB chunks."),
    ("Q: How does Merkle sealing work?\nA:", " Merkle sealing folds 64 KiB chunk hashes into one root."),
    ("Q: How does an enclave load an adapter?\nA:", " It verifies the open base and merges weights strictly in RAM."),
    ("Q: Does the enclave write plaintext weights to disk?\nA:", " No, decrypted adapters and merged models stay strictly in RAM."),
    ("Q: Where does the open base model live?\nA:", " Open bases load from HTTPS, IPFS, or HF verified by SHA-256."),
    ("Q: What prevents base model tampering?\nA:", " On-chain Model base fixes sha256 and sizeBytes permanently."),
    ("Q: How are call inputs protected?\nA:", " Callers encrypt inputs to the enclave X25519 key before calling."),
    ("Q: Who can read a sealed prompt?\nA:", " Only the attested enclave holding the X25519 private key."),
    ("Q: What is an open answer call?\nA:", " Open calls write plaintext answer bytes into the Solana receipt."),
    ("Q: What is a sealed answer call?\nA:", " Sealed calls encrypt the answer to the caller X25519 key."),
    ("Q: What happens if an enclave never answers?\nA:", " After the deadline slot, the caller refunds the full escrow."),
    ("Q: How does refund_call work?\nA:", " After the deadline expires, refund_call returns the escrow."),
    ("Q: How does payment split on settlement?\nA:", " Settlement splits escrow to owner, operator, and protocol."),
    ("Q: When is the enclave operator paid?\nA:", " Operators are paid atomically when settle_call writes receipts."),
    ("Q: What is a hardware measurement?\nA:", " A 48-byte SHA-384 digest identifying the exact enclave image."),
    ("Q: Who chooses allowed enclave measurements?\nA:", " The model owner sets up to eight allowed SHA-384 digests."),
    ("Q: How are grants shared across enclaves?\nA:", " A granted enclave wraps the key for another allowed enclave."),
    ("Q: What is grant_by_owner?\nA:", " grant_by_owner wraps the model key for an attested enclave."),
    ("Q: What is Solana?\nA:", " Solana is a high-throughput proof-of-stake blockchain."),
    ("Q: What is a Solana PDA?\nA:", " A deterministic off-curve address signed by its program."),
    ("Q: What is Solana CPI?\nA:", " Cross-program invocation lets one program call another."),
    ("Q: What is rent exemption on Solana?\nA:", " Accounts holding minimum lamports stay live permanently."),
    ("Q: How does Ed25519 verification work on Solana?\nA:", " The Ed25519 precompile verifies signatures before settling."),
    ("Q: What is X25519?\nA:", " Elliptic-curve Diffie-Hellman used to wrap keys and prompts."),
    ("Q: What is HKDF-SHA256?\nA:", " HKDF-SHA256 derives independent keys from one wallet signature."),
    ("Q: What is a Merkle root?\nA:", " A 32-byte hash committing ordered chunks verifiable in parts."),
    ("Q: What is LoRA?\nA:", " Low-rank adaptation adds A times B to a frozen weight matrix."),
    ("Q: Why use LoRA on chain?\nA:", " LoRA cuts on-chain storage and sealing txs by over 20x."),
    ("Q: How does LoRA merge into ONNX?\nA:", " Enclaves add alpha over rank times A times B in memory."),
    ("Q: What is ONNX?\nA:", " ONNX is an open protobuf format for neural network graphs."),
    ("Q: What is a byte-level tokenizer?\nA:", " It maps raw UTF-8 bytes 0 to 255 directly to token ids."),
    ("Q: Why use a byte-level tokenizer?\nA:", " Byte-level tokenization handles any UTF-8 prompt directly."),
    ("Q: What is confidential compute?\nA:", " Hardware enclaves isolate memory and prove code identity."),
    ("Q: What is Intel TDX?\nA:", " Intel TDX runs VMs in encrypted memory with signed quotes."),
    ("Q: What is AMD SEV-SNP?\nA:", " AMD SEV-SNP encrypts guest memory with hardware attestation."),
    ("Q: What is a Voynich receipt?\nA:", " A Solana account binding input hash, output hash, and payout."),
    ("Q: Can Solana programs call sealed models?\nA:", " Yes, programs call via CPI and read verified open receipts."),
    ("Q: How do you resume an interrupted seal?\nA:", " Run voynich seal with --model and --resume from chain state."),
    ("Q: Why does resume need no state file?\nA:", " One wallet signature derives model, nonce, and upload keys."),
    ("Q: What does verifyOnnxAdapterCompatibility check?\nA:", " It verifies base SHA-256 and ONNX tensor names and shapes."),
    ("Q: What is sketch-32?\nA:", " sketch-32 is Voynich first sealed 32-class drawing model."),
    ("Q: What is text-1m?\nA:", " text-1m is Voynich first sealed byte-level text adapter."),
    ("Q: How fast does an enclave open weights?\nA:", " Enclaves fetch 64 KiB ranges in parallel and decrypt once."),
    ("Q: What is a bounty on Voynich?\nA:", " A bounty pays automatically when an open receipt matches."),
    ("Q: What stops an enclave from faking inputs?\nA:", " Receipts bind the exact input hash escrowed in open_call."),
    ("Q: What stops a caller from altering answers?\nA:", " settle_call checks output hashes and Ed25519 signatures."),
    ("Q: How does Voynich handle model pricing?\nA:", " Owners price calls in SOL or any SPL token mint."),
    ("Q: What is the adapter binary magic?\nA:", " Every voynich/adapter/v1 file starts with ASCII VOYA and 1."),
    ("Q: What tensor ops does VOYA support?\nA:", " VOYA supports replace, delta, and low-rank lora updates."),
    ("Q: Why keep base models open?\nA:", " Open bases save chain rent while adapters stay sealed."),
    ("Q: What happens when a model is retired?\nA:", " Retiring stops new calls while old receipts stay verifiable."),
    ("Q: What are the four receipt checks?\nA:", " Signature, attestation binding, expiry, and answer hash."),
    ("Q: How do upload keys speed up sealing?\nA:", " Up to eight upload keys write 888-byte chunks in parallel."),
    ("Q: How does the enclave cache base models?\nA:", " Verified bases cache by SHA-256 and re-hash on every hit."),
    ("Q: What happens if a cached base is corrupted?\nA:", " Enclaves detect the mismatch, delete it, and re-download."),
    ("Q: What schemes can ModelBase source use?\nA:", " Base sources accept https, http, ipfs, and hf URIs."),
    ("Q: What input kinds does Voynich support?\nA:", " Manifests support sketch, float32 tensor, and text prompts."),
    ("Q: What formats can a text tokenizer use?\nA:", " Text manifests support byte-level, bpe, and word-piece."),
    ("Q: How does settle_call verify the enclave?\nA:", " It checks Ed25519, live attestation, and allowed digests."),
    ("Q: Can anyone verify a Voynich receipt?\nA:", " Yes, anyone can verify receipts directly against Solana."),
    ("Solana consensus:", " combines proof of history with Tower BFT voting."),
    ("Confidential inference:", " keeps private weights and prompts encrypted end to end."),
    ("Sealed adapters:", " pair a verified open base with encrypted LoRA on chain."),
    ("Receipt verification:", " checks signature, attestation, slot expiry, and hash."),
    ("Enclave attestation:", " binds signing and X25519 keys to a SHA-384 digest."),
    ("Merkle sealing:", " folds 64 KiB encrypted chunks into one fixed root."),
    ("Byte-level text:", " tokenizes any UTF-8 prompt without external tables."),
    ("Ask:", " Voynich seals adapters on Solana with verified receipts."),
    ("Hello:", " Voynich runs sealed models with verified Solana receipts."),
    ("Summary:", " Verified open base, sealed LoRA adapter, verified receipt."),
]

DOMAIN_HELDOUT_PAIRS = [
    ("Q: Why seal an adapter instead of full weights?\nA:", " Sealed adapters keep weights private at far lower chain cost."),
    ("Q: How does the enclave trust an open base file?\nA:", " It hashes downloaded bytes against the on-chain base sha256."),
    ("Q: How does a caller verify a sealed receipt?\nA:", " Check signature, attestation record, expiry, and output hash."),
    ("Q: What makes LoRA weights compact?\nA:", " LoRA factors updates into two low-rank matrices per weight."),
    ("Q: How are call payments protected before settlement?\nA:", " open_call escrows funds and refunds if the deadline passes."),
    ("Q: What is inside a voynich/adapter/v1 file?\nA:", " VOYA header with baseSha256 and packed float32 payloads."),
    ("Q: How can a program read an enclave answer?\nA:", " Use open answer mode so settle_call writes bytes on chain."),
    ("Q: What guarantees an enclave runs the right code?\nA:", " Model owners allow only attested SHA-384 enclave digests."),
    ("Q: How does zero-state-file resume work?\nA:", " One wallet signature re-derives keys and checks chain chunks."),
    ("Q: Why use XChaCha20-Poly1305 for weights?\nA:", " Each 64 KiB chunk decrypts independently with integrity."),
    ("Q: What is the role of the enclave X25519 key?\nA:", " Callers encrypt prompts and owners wrap keys for it."),
    ("Q: How does Voynich handle text inputs?\nA:", " Text manifests declare a tokenizer for verified generation."),
    ("Sealed compute:", " runs encrypted weights in enclaves with verified receipts."),
    ("Adapter verification:", " checks base SHA-256 and ONNX shapes before sealing."),
]


def set_seed(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)


def fetch_open_corpus(cache_dir: Path) -> bytes:
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / "tinyshakespeare.txt"
    if not path.exists() or path.stat().st_size < 1_000_000:
        body = urllib.request.urlopen(SHAKESPEARE_URL, timeout=30).read()
        path.write_bytes(body)
    return path.read_bytes()


class CausalSelfAttention(nn.Module):
    def __init__(self, d_model: int, n_heads: int, context_len: int) -> None:
        super().__init__()
        assert d_model % n_heads == 0
        self.d_model = d_model
        self.n_heads = n_heads
        self.head_dim = d_model // n_heads
        scale = 1.0 / math.sqrt(d_model)
        # Explicit [in_dim, out_dim] layout so torch.onnx.export emits clean MatMul initializers directly.
        self.q_w = nn.Parameter(torch.randn(d_model, d_model) * scale)
        self.k_w = nn.Parameter(torch.randn(d_model, d_model) * scale)
        self.v_w = nn.Parameter(torch.randn(d_model, d_model) * scale)
        self.o_w = nn.Parameter(torch.randn(d_model, d_model) * (scale / math.sqrt(2 * N_LAYERS)))
        mask = torch.triu(torch.full((1, 1, context_len, context_len), -1e9), diagonal=1)
        self.register_buffer("causal_mask", mask, persistent=True)

    def forward(
        self,
        x: torch.Tensor,
        lora: dict[str, tuple[torch.Tensor, torch.Tensor]] | None = None,
        lora_scale: float = 1.0,
    ) -> torch.Tensor:
        bsz, seq, dim = x.shape

        def proj(w: torch.Tensor, key: str) -> torch.Tensor:
            out = torch.matmul(x, w)
            if lora is not None and key in lora:
                a, b = lora[key]
                out = out + torch.matmul(torch.matmul(x, a), b) * lora_scale
            return out

        q = proj(self.q_w, "q_w").view(bsz, seq, self.n_heads, self.head_dim).transpose(1, 2)
        k = proj(self.k_w, "k_w").view(bsz, seq, self.n_heads, self.head_dim).transpose(1, 2)
        v = proj(self.v_w, "v_w").view(bsz, seq, self.n_heads, self.head_dim).transpose(1, 2)
        scores = torch.matmul(q, k.transpose(-2, -1)) * (1.0 / math.sqrt(self.head_dim))
        scores = scores + self.causal_mask[:, :, :seq, :seq]
        weights = torch.softmax(scores, dim=-1)
        if self.training:
            weights = F.dropout(weights, p=0.05, training=True)
        ctx = torch.matmul(weights, v).transpose(1, 2).contiguous().view(bsz, seq, dim)
        out = torch.matmul(ctx, self.o_w)
        if lora is not None and "o_w" in lora:
            a, b = lora["o_w"]
            out = out + torch.matmul(torch.matmul(ctx, a), b) * lora_scale
        return out


class TransformerBlock(nn.Module):
    def __init__(self, d_model: int, n_heads: int, d_ff: int, context_len: int) -> None:
        super().__init__()
        self.ln1 = nn.LayerNorm(d_model)
        self.attn = CausalSelfAttention(d_model, n_heads, context_len)
        self.ln2 = nn.LayerNorm(d_model)
        scale = 1.0 / math.sqrt(d_model)
        self.ff1_w = nn.Parameter(torch.randn(d_model, d_ff) * scale)
        self.ff1_b = nn.Parameter(torch.zeros(d_ff))
        self.ff2_w = nn.Parameter(torch.randn(d_ff, d_model) * (1.0 / math.sqrt(d_ff * 2 * N_LAYERS)))
        self.ff2_b = nn.Parameter(torch.zeros(d_model))

    def forward(
        self,
        x: torch.Tensor,
        lora: dict[str, tuple[torch.Tensor, torch.Tensor]] | None = None,
        lora_scale: float = 1.0,
    ) -> torch.Tensor:
        attn_out = self.attn(self.ln1(x), lora=lora, lora_scale=lora_scale)
        if self.training:
            attn_out = F.dropout(attn_out, p=0.05, training=True)
        x = x + attn_out
        h = torch.matmul(self.ln2(x), self.ff1_w) + self.ff1_b
        h = F.gelu(h)
        if self.training:
            h = F.dropout(h, p=0.05, training=True)
        h = torch.matmul(h, self.ff2_w) + self.ff2_b
        return x + h


class ByteCausalTransformer(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.tok_emb = nn.Parameter(torch.randn(VOCAB_SIZE, D_MODEL) * 0.04)
        self.pos_emb = nn.Parameter(torch.randn(CONTEXT_LEN, D_MODEL) * 0.02)
        self.blocks = nn.ModuleList(
            [TransformerBlock(D_MODEL, N_HEADS, D_FF, CONTEXT_LEN) for _ in range(N_LAYERS)]
        )
        self.ln_f = nn.LayerNorm(D_MODEL)
        self.lm_head_w = nn.Parameter(torch.randn(D_MODEL, VOCAB_SIZE) * (1.0 / math.sqrt(D_MODEL)))
        self.lm_head_b = nn.Parameter(torch.zeros(VOCAB_SIZE))

    def forward(self, input_ids: torch.Tensor) -> torch.Tensor:
        seq = input_ids.shape[1]
        x = F.embedding(input_ids, self.tok_emb) + self.pos_emb[:seq, :].unsqueeze(0)
        for block in self.blocks:
            x = block(x)
        x = self.ln_f(x)
        return torch.matmul(x, self.lm_head_w) + self.lm_head_b

    def forward_with_adapter(self, input_ids: torch.Tensor, adapter: "LoraAdapter") -> torch.Tensor:
        seq = input_ids.shape[1]
        x = F.embedding(input_ids, self.tok_emb) + self.pos_emb[:seq, :].unsqueeze(0)
        scale = adapter.alpha / adapter.rank
        for idx, block in enumerate(self.blocks):
            layer_lora = {
                proj: adapter.get_pair(f"blocks.{idx}.attn.{proj}")
                for proj in ("q_w", "k_w", "v_w", "o_w")
            }
            x = block(x, lora=layer_lora, lora_scale=scale)
        x = self.ln_f(x)
        logits = torch.matmul(x, self.lm_head_w) + self.lm_head_b
        a_lm, b_lm = adapter.get_pair("lm_head_w")
        logits = logits + torch.matmul(torch.matmul(x, a_lm), b_lm) * scale + adapter.lm_head_b_delta
        return logits


class LoraAdapter(nn.Module):
    def __init__(self, rank: int = LORA_RANK, alpha: float = LORA_ALPHA) -> None:
        super().__init__()
        self.rank = rank
        self.alpha = alpha
        self.a_params = nn.ParameterDict()
        self.b_params = nn.ParameterDict()
        self.onnx_names: list[str] = []
        a_std = 1.0 / math.sqrt(D_MODEL)
        for idx in range(N_LAYERS):
            for proj in ("q_w", "k_w", "v_w", "o_w"):
                name = f"blocks.{idx}.attn.{proj}"
                key = self._key(name)
                self.onnx_names.append(name)
                self.a_params[key] = nn.Parameter(torch.randn(D_MODEL, rank) * a_std)
                self.b_params[key] = nn.Parameter(torch.zeros(rank, D_MODEL))
        self.onnx_names.append("lm_head_w")
        self.a_params[self._key("lm_head_w")] = nn.Parameter(torch.randn(D_MODEL, rank) * a_std)
        self.b_params[self._key("lm_head_w")] = nn.Parameter(torch.zeros(rank, VOCAB_SIZE))
        self.lm_head_b_delta = nn.Parameter(torch.zeros(VOCAB_SIZE))

    @staticmethod
    def _key(onnx_name: str) -> str:
        return onnx_name.replace(".", "__")

    def get_pair(self, onnx_name: str) -> tuple[torch.Tensor, torch.Tensor]:
        key = self._key(onnx_name)
        return self.a_params[key], self.b_params[key]


def sample_corpus_batch(data: np.ndarray, batch_size: int, seq_len: int, gen: np.random.Generator) -> tuple[torch.Tensor, torch.Tensor]:
    # Prepend BOS at position 0 so BOS embeddings train cleanly alongside byte sequences.
    max_start = len(data) - seq_len
    starts = gen.integers(0, max_start, size=batch_size)
    x = np.empty((batch_size, seq_len), dtype=np.int64)
    y = np.empty((batch_size, seq_len), dtype=np.int64)
    for row, s in enumerate(starts):
        chunk = data[s : s + seq_len]
        x[row, 0] = BOS_ID
        x[row, 1:] = chunk[:-1]
        y[row, :] = chunk
    return torch.from_numpy(x), torch.from_numpy(y)


@torch.no_grad()
def evaluate_corpus(model: ByteCausalTransformer, data: np.ndarray, seq_len: int = CONTEXT_LEN, n_chunks: int = 40) -> tuple[float, int]:
    model.eval()
    stride = max(1, (len(data) - seq_len - 1) // n_chunks)
    total_loss = 0.0
    total_tokens = 0
    for i in range(n_chunks):
        s = i * stride
        if s + seq_len >= len(data):
            break
        chunk = data[s : s + seq_len]
        x = np.empty((1, seq_len), dtype=np.int64)
        x[0, 0] = BOS_ID
        x[0, 1:] = chunk[:-1]
        logits = model(torch.from_numpy(x))
        loss = F.cross_entropy(logits.view(-1, VOCAB_SIZE), torch.from_numpy(chunk.astype(np.int64)), reduction="sum")
        total_loss += float(loss.item())
        total_tokens += seq_len
    return total_loss / max(1, total_tokens), total_tokens


@torch.no_grad()
def evaluate_qa_answers(
    model: ByteCausalTransformer,
    pairs: list[tuple[str, str]],
    adapter: LoraAdapter | None = None,
) -> tuple[float, int]:
    """Computes cross-entropy loss strictly over answer tokens (including EOS) given prompt context."""
    model.eval()
    total_loss = 0.0
    total_tokens = 0
    for prompt, answer in pairs:
        p_ids = [BOS_ID, *prompt.encode("utf-8")]
        a_ids = [*answer.encode("utf-8"), EOS_ID]
        full = (p_ids + a_ids)[: CONTEXT_LEN + 1]
        x = torch.tensor([full[:-1]], dtype=torch.long)
        y = torch.tensor(full[1:], dtype=torch.long)
        ans_start = max(0, len(p_ids) - 1)
        logits = model.forward_with_adapter(x, adapter) if adapter is not None else model(x)
        ans_logits = logits[0, ans_start:, :]
        ans_targets = y[ans_start:]
        loss = F.cross_entropy(ans_logits, ans_targets, reduction="sum")
        total_loss += float(loss.item())
        total_tokens += int(ans_targets.numel())
    return total_loss / max(1, total_tokens), total_tokens


def encode_voya_adapter(
    base_sha256: str,
    adapter: LoraAdapter,
    initializer_shapes: dict[str, list[int]],
) -> bytes:
    header_tensors: list[dict[str, object]] = []
    payload_parts: list[bytes] = []
    offset = 0

    for name in sorted(adapter.onnx_names):
        assert name in initializer_shapes, f"Missing ONNX initializer {name}"
        dims = initializer_shapes[name]
        a_param, b_param = adapter.get_pair(name)
        a_np = a_param.detach().cpu().numpy().astype("<f4", copy=False)
        b_np = b_param.detach().cpu().numpy().astype("<f4", copy=False)
        assert list(a_np.shape) == [dims[0], adapter.rank]
        assert list(b_np.shape) == [adapter.rank, dims[1]]
        a_bytes = a_np.tobytes(order="C")
        b_bytes = b_np.tobytes(order="C")
        a_offset = offset
        offset += len(a_bytes)
        b_offset = offset
        offset += len(b_bytes)
        payload_parts.append(a_bytes)
        payload_parts.append(b_bytes)
        header_tensors.append(
            {
                "name": name,
                "op": "lora",
                "dims": dims,
                "rank": adapter.rank,
                "alpha": adapter.alpha,
                "aOffset": a_offset,
                "aLength": len(a_bytes),
                "bOffset": b_offset,
                "bLength": len(b_bytes),
            }
        )

    bias_name = "lm_head_b"
    assert bias_name in initializer_shapes, f"Missing ONNX initializer {bias_name}"
    bias_np = adapter.lm_head_b_delta.detach().cpu().numpy().astype("<f4", copy=False)
    bias_bytes = bias_np.tobytes(order="C")
    header_tensors.append(
        {
            "name": bias_name,
            "op": "delta",
            "dims": initializer_shapes[bias_name],
            "byteOffset": offset,
            "byteLength": len(bias_bytes),
        }
    )
    payload_parts.append(bias_bytes)

    header = {
        "version": 1,
        "baseSha256": base_sha256,
        "format": "onnx",
        "tensors": header_tensors,
    }
    header_bytes = json.dumps(header, separators=(",", ":")).encode("utf-8")
    return b"VOYA" + bytes([1]) + struct.pack("<I", len(header_bytes)) + header_bytes + b"".join(payload_parts)


def merge_onnx_in_memory(base_onnx_bytes: bytes, adapter: LoraAdapter) -> bytes:
    proto = onnx.load_from_string(base_onnx_bytes)
    scale = adapter.alpha / adapter.rank
    target_set = set(adapter.onnx_names)
    for init in proto.graph.initializer:
        if init.name in target_set:
            arr = onnx.numpy_helper.to_array(init).astype(np.float32, copy=True)
            a_param, b_param = adapter.get_pair(init.name)
            a_np = a_param.detach().cpu().numpy().astype(np.float32)
            b_np = b_param.detach().cpu().numpy().astype(np.float32)
            merged = (arr + scale * (a_np @ b_np)).astype("<f4")
            init.ClearField("float_data")
            init.raw_data = merged.tobytes(order="C")
        elif init.name == "lm_head_b":
            arr = onnx.numpy_helper.to_array(init).astype(np.float32, copy=True)
            delta = adapter.lm_head_b_delta.detach().cpu().numpy().astype(np.float32)
            merged = (arr + delta).astype("<f4")
            init.ClearField("float_data")
            init.raw_data = merged.tobytes(order="C")
    return proto.SerializeToString()


def greedy_generate(session: ort.InferenceSession, prompt: str, max_tokens: int = 64) -> tuple[str, int, str]:
    ids = [BOS_ID, *prompt.encode("utf-8")][:CONTEXT_LEN]
    generated: list[int] = []
    finish_reason = "length"
    for _ in range(max_tokens):
        window = ids[-CONTEXT_LEN:]
        arr = np.asarray([window], dtype=np.int64)
        logits = session.run(["logits"], {"input_ids": arr})[0]
        next_id = int(np.argmax(logits[0, -1, :]))
        if next_id == EOS_ID:
            finish_reason = "eos"
            break
        generated.append(next_id)
        ids.append(next_id)
    text = bytes([b for b in generated if 0 <= b <= 255]).decode("utf-8", errors="replace")
    return text, len(generated), finish_reason


def main() -> None:
    reuse_base = "--reuse-base" in sys.argv
    pos_args = [arg for arg in sys.argv[1:] if not arg.startswith("--")]
    out_dir = Path(__file__).resolve().parent
    data_dir = Path(pos_args[0]) if pos_args else Path(tempfile.gettempdir()) / "voynich-text-1m-data"
    set_seed(SEED)
    torch.set_num_threads(min(8, max(1, torch.get_num_threads())))
    rng = random.Random(SEED)
    np_rng = np.random.default_rng(SEED)

    # Fetch open public-domain English corpus (Tiny Shakespeare) and split strictly 90% train / 10% held-out.
    corpus_bytes = fetch_open_corpus(data_dir)
    corpus_arr = np.frombuffer(corpus_bytes, dtype=np.uint8)
    split_idx = int(len(corpus_arr) * 0.9)
    base_train_arr = corpus_arr[:split_idx]
    base_val_arr = corpus_arr[split_idx:]

    model = ByteCausalTransformer()
    total_params = sum(p.numel() for p in model.parameters())
    print(f"text-1m-base params: {total_params:,}; open corpus: {len(corpus_arr):,} bytes (train {len(base_train_arr):,}, val {len(base_val_arr):,})")

    base_onnx_path = out_dir / "text-1m-base.onnx"
    if reuse_base and base_onnx_path.exists():
        loaded_proto = onnx.load(str(base_onnx_path))
        init_map = {init.name: onnx.numpy_helper.to_array(init) for init in loaded_proto.graph.initializer}
        with torch.no_grad():
            for pname, param in model.named_parameters():
                if pname in init_map:
                    param.copy_(torch.from_numpy(init_map[pname].copy()))
        base_val_loss, base_val_tokens = evaluate_corpus(model, base_val_arr)
        print(f"Loaded existing base ONNX: English held-out loss={base_val_loss:.4f}, bpb={base_val_loss / math.log(2):.4f}")
    else:
        # Stage 1: pretrain open base model on public-domain English text (750 steps x batch 24 x 128 = 2.30M tokens).
        t0 = time.perf_counter()
        base_steps = 750
        base_batch = 24
        base_lr = 1.2e-3
        warmup_steps = 30
        opt_base = torch.optim.AdamW(model.parameters(), lr=base_lr, weight_decay=0.01)
        model.train()
        for step in range(base_steps):
            if step < warmup_steps:
                lr_now = base_lr * float(step + 1) / float(warmup_steps)
            else:
                prog = float(step - warmup_steps) / float(max(1, base_steps - warmup_steps))
                lr_now = 1e-4 + 0.5 * (base_lr - 1e-4) * (1.0 + math.cos(math.pi * prog))
            for pg in opt_base.param_groups:
                pg["lr"] = lr_now
            x, y = sample_corpus_batch(base_train_arr, base_batch, CONTEXT_LEN, np_rng)
            opt_base.zero_grad(set_to_none=True)
            logits = model(x)
            loss = F.cross_entropy(logits.view(-1, VOCAB_SIZE), y.view(-1))
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt_base.step()
            if (step + 1) % 250 == 0:
                val_loss, _ = evaluate_corpus(model, base_val_arr)
                print(f"  Base step {step + 1}/{base_steps}: train={loss.item():.4f}, val={val_loss:.4f} (bpb={val_loss / math.log(2):.3f})")
                model.train()

        base_val_loss, base_val_tokens = evaluate_corpus(model, base_val_arr)
        print(f"Stage 1 pretrain done in {time.perf_counter() - t0:.1f}s: English held-out loss={base_val_loss:.4f}, bpb={base_val_loss / math.log(2):.4f}")

        # Export frozen text-1m-base.onnx (opset 13, dynamic sequence length 1..128).
        model.eval()
        dummy_ids = torch.tensor([[BOS_ID, 81, 58, 32, 86, 111, 121]], dtype=torch.long)
        torch.onnx.export(
            model,
            (dummy_ids,),
            str(base_onnx_path),
            input_names=["input_ids"],
            output_names=["logits"],
            dynamic_axes={"input_ids": {1: "seq"}, "logits": {1: "seq"}},
            opset_version=13,
            do_constant_folding=True,
            dynamo=False,
        )
    base_onnx_bytes = base_onnx_path.read_bytes()
    base_sha256 = hashlib.sha256(base_onnx_bytes).hexdigest()

    # Verify ONNX dynamic sequence lengths (1, 7, 32, 128) and inspect clean 2D initializer names.
    proto = onnx.load_from_string(base_onnx_bytes)
    initializer_shapes = {init.name: list(init.dims) for init in proto.graph.initializer}
    base_session = ort.InferenceSession(base_onnx_bytes, providers=["CPUExecutionProvider"])
    for seq_len in (1, 7, 32, CONTEXT_LEN):
        test_arr = np.full((1, seq_len), 65, dtype=np.int64)
        out = base_session.run(["logits"], {"input_ids": test_arr})[0]
        assert list(out.shape) == [1, seq_len, VOCAB_SIZE], f"Unexpected ONNX shape for seq={seq_len}: {out.shape}"

    # Evaluate frozen base on the domain held-out validation split BEFORE LoRA fine-tuning.
    base_domain_loss, domain_heldout_tokens = evaluate_qa_answers(model, DOMAIN_HELDOUT_PAIRS)
    base_domain_bpb = base_domain_loss / math.log(2.0)
    base_domain_ppl = math.exp(min(base_domain_loss, 20.0))
    print(f"Frozen base on domain held-out: loss={base_domain_loss:.4f}, bpb={base_domain_bpb:.4f}, ppl={base_domain_ppl:.2f}")

    # Stage 2: freeze base completely, attach rank-8 LoRA (alpha=16) + lm_head bias delta, fine-tune on domain train split.
    for param in model.parameters():
        param.requires_grad_(False)
    adapter = LoraAdapter(rank=LORA_RANK, alpha=LORA_ALPHA)
    adapter_params = sum(p.numel() for p in adapter.parameters())

    domain_train_tokens = sum(min(len(p.encode("utf-8")) + len(a.encode("utf-8")) + 1, CONTEXT_LEN) for p, a in DOMAIN_TRAIN_PAIRS)

    t1 = time.perf_counter()
    adapter_epochs = 50
    lora_lr = 1.8e-3
    opt_lora = torch.optim.AdamW(adapter.parameters(), lr=lora_lr, weight_decay=0.02)
    sched_lora = torch.optim.lr_scheduler.CosineAnnealingLR(opt_lora, T_max=adapter_epochs, eta_min=1.5e-4)
    model.eval()

    for epoch in range(adapter_epochs):
        adapter.train()
        order = list(range(len(DOMAIN_TRAIN_PAIRS)))
        rng.shuffle(order)
        epoch_loss = 0.0
        steps = 0
        for start in range(0, len(order), 8):
            batch_pairs = [DOMAIN_TRAIN_PAIRS[i] for i in order[start : start + 8]]
            seqs: list[tuple[list[int], int]] = []
            for prompt, answer in batch_pairs:
                p_ids = [BOS_ID, *prompt.encode("utf-8")]
                a_ids = [*answer.encode("utf-8"), EOS_ID]
                full = (p_ids + a_ids)[: CONTEXT_LEN + 1]
                seqs.append((full, max(0, len(p_ids) - 1)))
            max_len = max(len(s) - 1 for s, _ in seqs)
            x = torch.zeros((len(seqs), max_len), dtype=torch.long)
            y_all = torch.full((len(seqs), max_len), -100, dtype=torch.long)
            y_ans = torch.full((len(seqs), max_len), -100, dtype=torch.long)
            for row, (full, ans_start) in enumerate(seqs):
                usable = len(full) - 1
                x[row, :usable] = torch.tensor(full[:usable], dtype=torch.long)
                y_all[row, :usable] = torch.tensor(full[1 : usable + 1], dtype=torch.long)
                y_ans[row, ans_start:usable] = torch.tensor(full[ans_start + 1 : usable + 1], dtype=torch.long)
            opt_lora.zero_grad(set_to_none=True)
            logits = model.forward_with_adapter(x, adapter)
            loss_ans = F.cross_entropy(logits.view(-1, VOCAB_SIZE), y_ans.view(-1), ignore_index=-100, label_smoothing=0.12)
            loss_all = F.cross_entropy(logits.view(-1, VOCAB_SIZE), y_all.view(-1), ignore_index=-100, label_smoothing=0.12)
            loss = 0.85 * loss_ans + 0.15 * loss_all
            loss.backward()
            torch.nn.utils.clip_grad_norm_(adapter.parameters(), 1.0)
            opt_lora.step()
            epoch_loss += float(loss.item())
            steps += 1
        sched_lora.step()
        if (epoch + 1) % 10 == 0 or epoch == adapter_epochs - 1:
            val_loss, _ = evaluate_qa_answers(model, DOMAIN_HELDOUT_PAIRS, adapter=adapter)
            print(f"  LoRA epoch {epoch + 1}/{adapter_epochs}: train={epoch_loss / max(1, steps):.4f}, held-out={val_loss:.4f}")

    model.eval()
    adapter.eval()
    adapter_domain_loss, _ = evaluate_qa_answers(model, DOMAIN_HELDOUT_PAIRS, adapter=adapter)
    adapter_domain_bpb = adapter_domain_loss / math.log(2.0)
    adapter_domain_ppl = math.exp(min(adapter_domain_loss, 20.0))
    print(
        f"Stage 2 LoRA done in {time.perf_counter() - t1:.1f}s: "
        f"domain held-out loss={adapter_domain_loss:.4f} (base {base_domain_loss:.4f}), "
        f"bpb={adapter_domain_bpb:.4f} (base {base_domain_bpb:.4f}), "
        f"ppl={adapter_domain_ppl:.2f} (base {base_domain_ppl:.2f})"
    )

    # Export text-1m.voya (voynich/adapter/v1).
    adapter_bytes = encode_voya_adapter(base_sha256, adapter, initializer_shapes)
    adapter_path = out_dir / "text-1m.voya"
    adapter_path.write_bytes(adapter_bytes)

    # Verify ONNX merged logit parity against PyTorch forward_with_adapter (< 1e-4).
    merged_onnx = merge_onnx_in_memory(base_onnx_bytes, adapter)
    merged_session = ort.InferenceSession(merged_onnx, providers=["CPUExecutionProvider"])
    parity_prompts = [
        "Q: What is Voynich?\nA:",
        "Q: What is a sealed adapter?\nA:",
        "Ask:",
    ]
    max_logit_diff = 0.0
    for prompt in parity_prompts:
        ids = [BOS_ID, *prompt.encode("utf-8")][:CONTEXT_LEN]
        with torch.no_grad():
            pt_logits = model.forward_with_adapter(torch.tensor([ids], dtype=torch.long), adapter).numpy()
        ort_logits = merged_session.run(["logits"], {"input_ids": np.asarray([ids], dtype=np.int64)})[0]
        diff = float(np.max(np.abs(pt_logits - ort_logits)))
        max_logit_diff = max(max_logit_diff, diff)
    assert max_logit_diff < 1e-4, f"ONNX merged logit diff {max_logit_diff} exceeded 1e-4"

    # Benchmark CPU 32-token greedy generation latency.
    bench_prompt = "Q: What is Voynich?\nA:"
    greedy_generate(merged_session, bench_prompt, max_tokens=32)
    t_gen = time.perf_counter()
    _, gen_tokens, _ = greedy_generate(merged_session, bench_prompt, max_tokens=32)
    gen_ms = (time.perf_counter() - t_gen) * 1000.0
    cpu_ms_per_32 = gen_ms * (32.0 / max(1, gen_tokens))

    sample_prompts = [
        "Q: What is Voynich?\nA:",
        "Q: What is a sealed adapter?\nA:",
        "Q: How does Voynich verify an answer?\nA:",
        "Ask:",
    ]
    samples = []
    for prompt in sample_prompts:
        text, tokens, finish = greedy_generate(merged_session, prompt, max_tokens=64)
        samples.append({"prompt": prompt, "text": text, "tokens": tokens, "finishReason": finish})
        print(f"Sample [{prompt!r}] -> {text!r} ({tokens} tok, {finish})")

    manifest = {
        "name": "text-1m",
        "inputKind": "text",
        "inputName": "input_ids",
        "outputName": "logits",
        "tokenizer": {
            "format": "byte-level",
            "vocabSize": VOCAB_SIZE,
            "maxInputTokens": CONTEXT_LEN,
            "maxOutputTokens": 64,
            "bosTokenId": BOS_ID,
            "eosTokenId": EOS_ID,
        },
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8", newline="\n")

    base_meta = {
        "sha256": base_sha256,
        "sizeBytes": len(base_onnx_bytes),
        "format": "onnx",
    }
    (out_dir / "base.json").write_text(json.dumps(base_meta, indent=2) + "\n", encoding="utf-8", newline="\n")

    metrics = {
        "seed": SEED,
        "architecture": {
            "layers": N_LAYERS,
            "dModel": D_MODEL,
            "heads": N_HEADS,
            "dFf": D_FF,
            "contextLen": CONTEXT_LEN,
            "vocabSize": VOCAB_SIZE,
            "loraRank": LORA_RANK,
            "loraAlpha": LORA_ALPHA,
        },
        "parameters": total_params,
        "adapterParameters": adapter_params,
        "baseOnnxBytes": len(base_onnx_bytes),
        "baseSha256": base_sha256,
        "adapterBytes": len(adapter_bytes),
        "compressionRatio": round(len(base_onnx_bytes) / len(adapter_bytes), 2),
        "baseTrainTokens": int(len(base_train_arr)),
        "baseHeldOutTokens": int(len(base_val_arr)),
        "baseProseHeldOutLoss": round(base_val_loss, 4),
        "domainTrainTokens": domain_train_tokens,
        "domainHeldOutTokens": domain_heldout_tokens,
        "baseHeldOutLoss": round(base_domain_loss, 4),
        "baseHeldOutBpb": round(base_domain_bpb, 4),
        "baseHeldOutPpl": round(base_domain_ppl, 2),
        "adapterHeldOutLoss": round(adapter_domain_loss, 4),
        "adapterHeldOutBpb": round(adapter_domain_bpb, 4),
        "adapterHeldOutPpl": round(adapter_domain_ppl, 2),
        "onnxMaxLogitDiff": float(f"{max_logit_diff:.2e}"),
        "cpuMsPer32Tokens": round(cpu_ms_per_32, 2),
        "samples": samples,
    }
    (out_dir / "metrics.json").write_text(json.dumps(metrics, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"Exported text-1m-base.onnx ({len(base_onnx_bytes):,}B) and text-1m.voya ({len(adapter_bytes):,}B, {metrics['compressionRatio']}x smaller)")
    print(f"onnxMaxLogitDiff={max_logit_diff:.2e}, cpuMsPer32Tokens={cpu_ms_per_32:.2f}ms")


if __name__ == "__main__":
    main()
