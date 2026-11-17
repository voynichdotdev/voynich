import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const source = new URL('../../models/sketch-32/manifest.json', import.meta.url)
// The browser-safe copy stays available when building a package without model artifacts.
if (existsSync(source)) {
  const manifest = JSON.parse(readFileSync(source, 'utf8'))
  const output = '// Generated from models/sketch-32/manifest.json by scripts/sync-manifest.mjs.\n' +
    "import type { Manifest } from './schemas.js'\n\n" +
    `export const fixtureManifest: Manifest & { inputKind: 'sketch'; inputShape: number[]; labels: string[] } = ${JSON.stringify(manifest, null, 2)}\n` +
    'export const SKETCH_LABELS: string[] = fixtureManifest.labels\n'
  writeFileSync(new URL('../src/sketch-manifest.ts', import.meta.url), output)
}
