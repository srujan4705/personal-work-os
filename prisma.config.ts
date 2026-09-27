import { defineConfig } from 'prisma/config';

// Connection URL for Prisma CLI commands (migrate dev / studio). The app itself
// connects through the pg driver adapter in apps/api/src/lib/prisma.ts.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DATABASE_URL ?? '' },
});
