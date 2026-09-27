#!/usr/bin/env sh
# Restores a backup made by backup.sh. Usage: ./scripts/restore.sh backups/pwos-YYYYMMDD-HHMMSS.sql.gz
# WARNING: replaces the current database contents.
set -eu
[ -f "${1:-}" ] || { echo "Usage: $0 <backup.sql.gz>"; exit 1; }
printf "This will overwrite the current database. Type 'restore' to continue: "
read -r answer
[ "$answer" = "restore" ] || { echo "Aborted."; exit 1; }
docker compose stop app
gunzip -c "$1" | docker compose exec -T db psql -U pwos -d pwos -v ON_ERROR_STOP=1 >/dev/null
docker compose start app
echo "Restore complete."
