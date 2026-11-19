import type { NextConfig } from 'next'
import path from 'node:path'

const config: NextConfig = {
  turbopack: { root: path.resolve(__dirname) },
  devIndicators: false,
  // the production server builds into its own folder, so it never disturbs a running dev server
  distDir: process.env.VOYNICH_DIST ?? '.next',
  experimental: { agentRules: false } as NextConfig['experimental'],
  async redirects() {
    return [
      {
        source: '/docs/program/reading-a-receipt',
        destination: '/docs/program/calling-a-model',
        permanent: true,
      },
    ]
  },
}

export default config
