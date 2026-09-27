#!/usr/bin/env sh
# Creates a compressed PostgreSQL dump in ./backups (Docker Compose setup).
# Schedule it with cron, e.g.:  0 2 * * *  cd /opt/personal-work-os && ./scripts/backup.sh
set -eu
mkdir -p backups
file="backups/pwos-$(date +%Y%m%d-%H%M%S).sql.gz"
docker compose exec -T db pg_dump -U pwos -d pwos --clean --if-exists | gzip > "$file"
echo "Backup written to $file"
# Keep the 30 newest backups.
ls -1t backups/pwos-*.sql.gz 2>/dev/null | tail -n +31 | xargs -r rm --
