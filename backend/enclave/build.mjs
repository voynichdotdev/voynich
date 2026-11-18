import { build } from 'esbuild'

await build({
  entryPoints: ['src/runtime.ts'],
  outfile: 'dist/runtime.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  external: ['onnxruntime-node'],
})
