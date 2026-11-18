"""Train sketch-32: a small CNN that names a 28x28 drawing as one of 32 Quick, Draw! categories.

Data: Google Creative Lab, "The Quick, Draw! Dataset", numpy bitmaps (CC BY 4.0),
https://github.com/googlecreativelab/quickdraw-dataset

usage: python train.py <data-dir>

Reads the first ROWS drawings of each category with an HTTP range request (no full download),
trains on the first TRAIN of them, measures accuracy on the remaining held-out drawings, and
writes sketch-32.onnx, manifest.json and metrics.json next to this file.
"""
import json
import pathlib
import sys
import time
import urllib.parse
import urllib.request

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from PIL import Image

HERE = pathlib.Path(__file__).resolve().parent
LABELS = [
    "airplane", "apple", "banana", "bicycle", "bird", "butterfly", "car", "cat",
    "clock", "cloud", "cup", "envelope", "eye", "fish", "flower", "guitar",
    "hat", "house", "key", "ladder", "light bulb", "moon", "mountain", "pizza",
    "snail", "spider", "star", "sun", "sword", "television", "tree", "umbrella",
]
ROWS, TRAIN = 15000, 14000
BASE = "https://storage.googleapis.com/quickdraw_dataset/full/numpy_bitmap/"
SEED = 32


def fetch(label: str, cache: pathlib.Path) -> np.ndarray:
    path = cache / f"{label}.u8"
    if not path.exists() or path.stat().st_size != ROWS * 784:
        url = BASE + urllib.parse.quote(label) + ".npy"
        head = urllib.request.urlopen(urllib.request.Request(url, headers={"Range": "bytes=0-255"})).read()
        header_len = int.from_bytes(head[8:10], "little") + 10
        rng = f"bytes={header_len}-{header_len + ROWS * 784 - 1}"
        body = urllib.request.urlopen(urllib.request.Request(url, headers={"Range": rng})).read()
        assert len(body) == ROWS * 784, (label, len(body))
        path.write_bytes(body)
    return np.frombuffer(path.read_bytes(), dtype=np.uint8).reshape(ROWS, 28, 28)


def center(img: np.ndarray) -> np.ndarray:
    """The preprocessing every client applies too: crop to the ink, fit the longer side
    to 24 px keeping aspect, center in 28x28, values 0..1 (ink high)."""
    ys, xs = np.nonzero(img > 16)
    if len(ys) == 0:
        return np.zeros((28, 28), np.float32)
    crop = img[ys.min(): ys.max() + 1, xs.min(): xs.max() + 1]
    h, w = crop.shape
    s = 24 / max(h, w)
    nh, nw = max(1, round(h * s)), max(1, round(w * s))
    small = np.asarray(Image.fromarray(crop).resize((nw, nh), Image.BILINEAR), np.float32)
    out = np.zeros((28, 28), np.float32)
    y0, x0 = (28 - nh) // 2, (28 - nw) // 2
    out[y0: y0 + nh, x0: x0 + nw] = small / 255.0
    return out


class Sketch32(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        def block(i: int, o: int) -> nn.Sequential:
            return nn.Sequential(nn.Conv2d(i, o, 3, padding=1), nn.BatchNorm2d(o), nn.ReLU(), nn.MaxPool2d(2))
        self.features = nn.Sequential(block(1, 16), block(16, 32), block(32, 64))  # 28 -> 14 -> 7 -> 3
        self.head = nn.Sequential(nn.Flatten(), nn.Dropout(0.3), nn.Linear(64 * 3 * 3, 64), nn.ReLU(), nn.Linear(64, len(LABELS)))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.head(self.features(x))


def augment(x: torch.Tensor) -> torch.Tensor:
    n = x.shape[0]
    scale = torch.empty(n).uniform_(0.85, 1.15)
    angle = torch.empty(n).uniform_(-0.2, 0.2)
    shift = torch.empty(n, 2).uniform_(-0.12, 0.12)
    cos, sin = torch.cos(angle) / scale, torch.sin(angle) / scale
    theta = torch.stack([torch.stack([cos, -sin, shift[:, 0]], 1), torch.stack([sin, cos, shift[:, 1]], 1)], 1)
    grid = F.affine_grid(theta, x.shape, align_corners=False)
    return F.grid_sample(x, grid, align_corners=False)


def main() -> None:
    cache = pathlib.Path(sys.argv[1])
    cache.mkdir(parents=True, exist_ok=True)
    torch.manual_seed(SEED)
    torch.set_num_threads(16)

    xs, ys = [], []
    for i, label in enumerate(LABELS):
        raw = fetch(label, cache)
        xs.append(np.stack([center(im) for im in raw]))
        ys.append(np.full(ROWS, i, np.int64))
        print(f"{label}: {ROWS} drawings", flush=True)
    x = torch.from_numpy(np.stack(xs)).unsqueeze(2)  # [32, ROWS, 1, 28, 28]
    y = torch.from_numpy(np.stack(ys))
    x_train, y_train = x[:, :TRAIN].reshape(-1, 1, 28, 28), y[:, :TRAIN].reshape(-1)
    x_test, y_test = x[:, TRAIN:].reshape(-1, 1, 28, 28), y[:, TRAIN:].reshape(-1)

    model = Sketch32()
    epochs, batch = 8, 512
    opt = torch.optim.AdamW(model.parameters(), lr=3e-3, weight_decay=1e-4)
    steps = epochs * (len(x_train) // batch)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=3e-3, total_steps=steps)
    for epoch in range(epochs):
        model.train()
        order = torch.randperm(len(x_train))
        t0, total = time.time(), 0.0
        for k in range(len(x_train) // batch):
            idx = order[k * batch: (k + 1) * batch]
            loss = F.cross_entropy(model(augment(x_train[idx])), y_train[idx], label_smoothing=0.05)
            opt.zero_grad()
            loss.backward()
            opt.step()
            sched.step()
            total += loss.item()
        acc = evaluate(model, x_test, y_test)[0]
        print(f"epoch {epoch + 1}: loss {total / (k + 1):.3f}, held-out top-1 {acc:.4f}, {time.time() - t0:.0f}s", flush=True)

    top1, top3 = evaluate(model, x_test, y_test)
    model.eval()
    onnx_path = HERE / "sketch-32.onnx"
    torch.onnx.export(model, torch.zeros(1, 1, 28, 28), str(onnx_path), input_names=["input"], output_names=["logits"],
                      opset_version=17, dynamo=False)
    params = sum(p.numel() for p in model.parameters())
    (HERE / "manifest.json").write_text(json.dumps({
        "name": "sketch-32",
        "inputKind": "sketch",
        "inputShape": [1, 1, 28, 28],
        "inputName": "input",
        "outputName": "logits",
        "preprocess": "Crop the drawing to its ink, scale the longer side to 24 px keeping aspect, center it in 28x28; float32, background 0, ink 1.",
        "labels": LABELS,
    }, indent=2) + "\n")
    (HERE / "metrics.json").write_text(json.dumps({
        "heldOutDrawings": len(x_test),
        "trainDrawings": len(x_train),
        "top1": round(top1, 4),
        "top3": round(top3, 4),
        "parameters": params,
        "onnxBytes": onnx_path.stat().st_size,
        "epochs": epochs,
        "seed": SEED,
    }, indent=2) + "\n")
    print(f"held-out top-1 {top1:.4f}, top-3 {top3:.4f}; {params} parameters; {onnx_path.stat().st_size} bytes")


@torch.no_grad()
def evaluate(model: nn.Module, x: torch.Tensor, y: torch.Tensor) -> tuple[float, float]:
    model.eval()
    logits = torch.cat([model(x[i: i + 4096]) for i in range(0, len(x), 4096)])
    top3 = logits.topk(3, 1).indices
    return (top3[:, 0] == y).float().mean().item(), (top3 == y[:, None]).any(1).float().mean().item()


if __name__ == "__main__":
    main()
