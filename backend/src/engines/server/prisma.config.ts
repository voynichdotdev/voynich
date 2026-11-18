// Prisma's config at the backend root. .env is optional (a deployed service has none), and an unset
// DATABASE_URL becomes "" so `prisma generate` runs in a build that has no database to reach.

import { defineConfig } from 'prisma/config'

try {
  process.loadEnvFile()
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DATABASE_URL ?? '' },
})
