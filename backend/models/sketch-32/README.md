# sketch-32

A small convolutional network that names a 28×28 drawing as one of 32 things. It is the first sealed model on Voynich: its ONNX weights are encrypted and written into Solana accounts, and only granted enclaves open and run it.

| | |
|---|---|
| Held-out top-1 | 91.16% on 32,000 drawings (1,000 per category, never seen in training) |
| Held-out top-3 | 96.71% |
| Parameters | 62,528 |
| ONNX size | 252,081 bytes (`sketch-32.onnx`), one Weights account |
| Input | `input`, float32 `[1, 1, 28, 28]`, background 0, ink 1 |
| Output | `logits`, float32 `[1, 32]`, in label order |

Exact figures: `metrics.json`. Labels, input shape and preprocessing: `manifest.json`.

**Labels:** airplane, apple, banana, bicycle, bird, butterfly, car, cat, clock, cloud, cup, envelope, eye, fish, flower, guitar, hat, house, key, ladder, light bulb, moon, mountain, pizza, snail, spider, star, sun, sword, television, tree, umbrella.

**Preprocessing**, the same on every client: crop the drawing to its ink, scale the longer side to 24 px keeping aspect, center it in 28×28.

**Network:** three blocks of 3×3 convolution, batch norm, ReLU and 2×2 max pool (16, 32, 64 channels), then 576 → 64 → 32. Trained 8 epochs with AdamW and a one-cycle schedule, random rotation, scale and shift.

**Data:** the first 15,000 drawings of each category from Google Creative Lab's Quick, Draw! numpy bitmaps (CC BY 4.0, https://github.com/googlecreativelab/quickdraw-dataset): 14,000 for training, 1,000 held out.

**Train again:** `python train.py <data-dir>` fetches only the rows it needs with HTTP range requests and rewrites the three output files.
