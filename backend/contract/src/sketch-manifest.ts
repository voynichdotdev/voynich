// Generated from models/sketch-32/manifest.json by scripts/sync-manifest.mjs.
import type { Manifest } from './schemas.js'

export const fixtureManifest: Manifest & { inputKind: 'sketch'; inputShape: number[]; labels: string[] } = {
  "name": "sketch-32",
  "inputKind": "sketch",
  "inputShape": [
    1,
    1,
    28,
    28
  ],
  "inputName": "input",
  "outputName": "logits",
  "preprocess": "Crop the drawing to its ink, scale the longer side to 24 px keeping aspect, center it in 28x28; float32, background 0, ink 1.",
  "labels": [
    "airplane",
    "apple",
    "banana",
    "bicycle",
    "bird",
    "butterfly",
    "car",
    "cat",
    "clock",
    "cloud",
    "cup",
    "envelope",
    "eye",
    "fish",
    "flower",
    "guitar",
    "hat",
    "house",
    "key",
    "ladder",
    "light bulb",
    "moon",
    "mountain",
    "pizza",
    "snail",
    "spider",
    "star",
    "sun",
    "sword",
    "television",
    "tree",
    "umbrella"
  ]
}
export const SKETCH_LABELS: string[] = fixtureManifest.labels
