/**
 * Applies prisma/migrations/* with plain `pg`, recording them in Prisma's `_prisma_migrations`
 * table (same format as `prisma migrate deploy`), so no Prisma engine binary is needed at runtime.
 * Each migration runs in a transaction; already-applied migrations are skipped; checksum drift aborts.
 */
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { pgConnectionConfig } from '../src/lib/db-connection';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const dir = process.env.MIGRATIONS_DIR ?? path.resolve(process.cwd(), 'prisma/migrations');

const client = new pg.Client(pgConnectionConfig(url, process.env.DATABASE_SSL_CA || undefined));
await client.connect();
try {
  await client.query('SELECT pg_advisory_lock(72707207)');
  await client.query(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id" VARCHAR(36) PRIMARY KEY NOT NULL,
    "checksum" VARCHAR(64) NOT NULL,
    "finished_at" TIMESTAMPTZ,
    "migration_name" VARCHAR(255) NOT NULL,
    "logs" TEXT,
    "rolled_back_at" TIMESTAMPTZ,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "applied_steps_count" INTEGER NOT NULL DEFAULT 0
  )`);
  const applied = new Map(
    (await client.query<{ migration_name: string; checksum: string }>('SELECT migration_name, checksum FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')).rows.map((r) => [r.migration_name, r.checksum]),
  );
  const names = fs.readdirSync(dir).filter((n) => fs.existsSync(path.join(dir, n, 'migration.sql'))).sort();
  let count = 0;
  for (const name of names) {
    const sql = fs.readFileSync(path.join(dir, name, 'migration.sql'), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    if (applied.has(name)) {
      if (applied.get(name) !== checksum) throw new Error(`Migration ${name} was modified after it was applied.`);
      continue;
    }
    const id = randomUUID();
    await client.query('BEGIN');
    try {
      await client.query('INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at) VALUES ($1, $2, $3, now())', [id, checksum, name]);
      await client.query(sql);
      await client.query('UPDATE "_prisma_migrations" SET finished_at = now(), applied_steps_count = 1 WHERE id = $1', [id]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${name} failed: ${(err as Error).message}`);
    }
    console.log(`applied ${name}`);
    count++;
  }
  console.log(count ? `${count} migration(s) applied.` : 'Database is up to date.');
} finally {
  await client.query('SELECT pg_advisory_unlock(72707207)').catch(() => {});
  await client.end();
}
