import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

/** Recreates the test database schema from the migration files once per run. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://pwos:pwos@localhost:5432/pwos_test';
  // Safety: this setup DROPS the public schema. Refuse anything that is not a local/CI database.
  const host = new URL(url).hostname;
  if (!['localhost', '127.0.0.1', '::1', '[::1]', 'postgres', 'db'].includes(host) && process.env.ALLOW_NONLOCAL_TEST_DB !== 'true') {
    throw new Error(`Refusing to run integration tests against non-local database host "${host}" (the test setup wipes the schema). Set ALLOW_NONLOCAL_TEST_DB=true only for a disposable database.`);
  }
  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
  } catch {
    throw new Error(`Integration tests need PostgreSQL at ${url}. Start it (docker compose up -d db) or set TEST_DATABASE_URL.`);
  }
  await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  const dir = path.resolve('prisma/migrations');
  for (const name of fs.readdirSync(dir).filter((n) => fs.existsSync(path.join(dir, n, 'migration.sql'))).sort()) {
    await client.query(fs.readFileSync(path.join(dir, name, 'migration.sql'), 'utf8'));
  }
  await client.end();
}
