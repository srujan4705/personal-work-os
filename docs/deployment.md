# Deployment

> Free-tier alternative (Vercel + Render + Supabase): see [FREE_TIER_DEPLOYMENT.md](FREE_TIER_DEPLOYMENT.md).

## Docker Compose (recommended)
`docker-compose.yml` runs two services:
- `db`: `postgres:16-alpine`, named volume `pgdata`, `pg_isready` healthcheck, not published to the host.
- `app`: built from `docker/Dockerfile` (multi-stage). It runs `migrate.js` and then `server.js` as the non-root `node` user, with a `/api/v1/health` healthcheck and `restart: unless-stopped`.

```bash
cp .env.example .env      # fill section A of MANUAL_SETUP.md
docker compose up -d --build
docker compose logs -f app
```
Put a TLS reverse proxy (Caddy or nginx) in front for internet access (MANUAL_SETUP.md, section D).

## Without Docker
```bash
npm ci
npm run build            # prisma generate + web + api bundles
npm start                # migrate + serve on $PORT (serves apps/web/dist too)
```
Use a process manager (systemd, pm2) and the same reverse-proxy setup.

## Health endpoints
- `GET /api/v1/health` (liveness, no database access)
- `GET /api/v1/readiness` (checks the database)

## Backups
`scripts/backup.sh` / `scripts/restore.sh` (MANUAL_SETUP.md, section I).

## Upgrades
Back up, pull the new code, then `docker compose up -d --build`. Migrations apply automatically, inside a transaction and under an advisory lock.
