# ---- build stage: install everything, generate Prisma client, build web + api ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/ai-contracts/package.json packages/ai-contracts/
RUN npm ci
COPY . .
RUN npx prisma generate \
 && npm run build --workspace @pwos/web \
 && npm run build --workspace @pwos/api

# ---- runtime stage: production dependencies + built artifacts only ----
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    WEB_DIST_DIR=/app/apps/web/dist \
    MIGRATIONS_DIR=/app/prisma/migrations
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/ai-contracts/package.json packages/ai-contracts/
RUN npm ci --omit=dev --workspace @pwos/api --include-workspace-root=false && npm cache clean --force
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/web/dist apps/web/dist
COPY prisma/migrations prisma/migrations
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Apply pending migrations, then start. Migrations are idempotent and lock-protected.
CMD ["sh", "-c", "node apps/api/dist/migrate.js && exec node apps/api/dist/server.js"]
