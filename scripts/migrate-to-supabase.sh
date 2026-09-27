#!/usr/bin/env bash
# One-time copy of the Docker Compose database (EC2) into an EMPTY Supabase database.
# Run on the EC2 host from the project directory, AFTER `docker compose stop app` (write freeze).
#
#   TARGET_DATABASE_URL='postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres' \
#   TARGET_SSL_ROOT_CERT=./prod-ca-2021.crt \
#   ./scripts/migrate-to-supabase.sh
#
# Steps: dump (public schema) -> check target is empty -> restore in ONE transaction ->
# apply scripts/supabase-hardening.sql -> compare exact row counts per table.
# The source database is only read. Nothing on EC2 is changed.
# Overrides (for testing / non-Docker sources): SOURCE_DATABASE_URL (use local pg_dump/psql
# instead of the compose "db" container), TARGET_PSQL (psql command for the target).
set -euo pipefail
: "${TARGET_DATABASE_URL:?Set TARGET_DATABASE_URL (Supabase Session pooler URL, port 5432)}"
: "${TARGET_SSL_ROOT_CERT:?Set TARGET_SSL_ROOT_CERT (Supabase CA certificate file)}"
[ -f "$TARGET_SSL_ROOT_CERT" ] || { echo "CA file not found: $TARGET_SSL_ROOT_CERT"; exit 1; }
CA_ABS="$(cd "$(dirname "$TARGET_SSL_ROOT_CERT")" && pwd)/$(basename "$TARGET_SSL_ROOT_CERT")"

src_dump() { if [ -n "${SOURCE_DATABASE_URL:-}" ]; then pg_dump "$SOURCE_DATABASE_URL" "$@"; else docker compose exec -T db pg_dump -U pwos -d pwos "$@"; fi; }
src_psql() { if [ -n "${SOURCE_DATABASE_URL:-}" ]; then psql "$SOURCE_DATABASE_URL" "$@"; else docker compose exec -T db psql -U pwos -d pwos "$@"; fi; }
tgt_psql() {
  if [ -n "${TARGET_PSQL:-}" ]; then PGSSLMODE=verify-full PGSSLROOTCERT="$CA_ABS" $TARGET_PSQL "$TARGET_DATABASE_URL" "$@"
  else docker run --rm -i -e PGSSLMODE=verify-full -e PGSSLROOTCERT=/ca.crt -v "$CA_ABS:/ca.crt:ro" postgres:17-alpine psql "$TARGET_DATABASE_URL" "$@"; fi
}
COUNT_SQL="SELECT string_agg(format('SELECT %L AS t, count(*) AS n FROM public.%I', tablename, tablename), ' UNION ALL ' ORDER BY tablename) FROM pg_tables WHERE schemaname = 'public'"

if [ -z "${SOURCE_DATABASE_URL:-}" ] && [ -n "$(docker compose ps -q --status running app 2>/dev/null)" ]; then
  echo "The app container is running. Stop it first so no writes are lost: docker compose stop app"; exit 1
fi

mkdir -p backups
dump="backups/supabase-migration-$(date +%Y%m%d-%H%M%S).sql"
echo "1/5 Dumping source database (public schema) -> $dump"
src_dump --schema=public --no-owner --no-privileges > "$dump"
grep -q '_prisma_migrations' "$dump" || { echo "Dump looks incomplete (no _prisma_migrations)."; exit 1; }

echo "2/5 Checking the target is empty and reachable over verified TLS"
existing="$(tgt_psql -tAc "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")"
[ "$existing" = "0" ] || { echo "Target public schema already has $existing tables. Use an empty database."; exit 1; }

echo "3/5 Restoring (single transaction; any error rolls everything back)"
# The public schema already exists on the target (and may be owned by another role):
# skip only the schema-level statements, never table data or definitions.
grep -v -E '^(DROP SCHEMA IF EXISTS public;|CREATE SCHEMA public;|COMMENT ON SCHEMA public IS .*;)$' "$dump" | tgt_psql -q -v ON_ERROR_STOP=1 --single-transaction >/dev/null

echo "4/5 Hardening: revoke Data API roles, enable RLS"
tgt_psql -q -v ON_ERROR_STOP=1 < scripts/supabase-hardening.sql >/dev/null

echo "5/5 Comparing row counts"
src_counts="$(src_psql -tA -F' ' -c "$(src_psql -tAc "$COUNT_SQL")")"
tgt_counts="$(tgt_psql -tA -F' ' -c "$(tgt_psql -tAc "$COUNT_SQL")")"
if [ "$src_counts" = "$tgt_counts" ]; then
  echo "$tgt_counts" | awk '{ s += $2 } END { printf "OK: %d tables, %d rows, identical counts.\n", NR, s }'
  echo "Keep $dump until the migration is final (it contains all your data; store it securely)."
else
  echo "ROW COUNT MISMATCH:"; diff <(echo "$src_counts") <(echo "$tgt_counts") || true; exit 1
fi
