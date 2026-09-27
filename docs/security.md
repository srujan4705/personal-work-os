# Security

| Area | Measure |
|---|---|
| Authentication | Email and password; scrypt hashing (N=16384); timing-equalised failures; login rate-limited (10 per 15 minutes); changing the password revokes all sessions. |
| Sessions | Random 256-bit token in an `HttpOnly; SameSite=Lax; Secure` (production) cookie. Only its SHA-256 is stored. Expiry is `SESSION_TTL_DAYS`. |
| CSRF | State-changing requests need the custom header `x-pwos-csrf: 1`, which cross-site pages cannot send without a CORS preflight. CORS allows only `APP_URL`. SameSite=Lax cookies. |
| Authorisation | The user id always comes from the session. Every query is scoped by `userId`, and strict Zod schemas reject client-supplied ids. Cross-user access returns 404 (existence is not leaked). |
| Input | Zod validation everywhere; JSON body limit 1 MB; standard error envelope without stack traces. |
| Headers | helmet with a strict CSP (`default-src 'self'`, no inline scripts, `frame-ancestors 'none'`). |
| Rate limits | API-wide, login, assistant, sync, notification tests and the Telegram webhook, all configurable. |
| Secrets | Only in env or the database. OAuth tokens are AES-256-GCM encrypted. pino redacts auth headers, cookies and token or password fields. Exports exclude hashes and tokens. |
| External systems | Zoho and GitHub are read-only by construction (GET-only client, host allow-list, static test scan, READ-only scopes). |
| AI | Tool allow-list, strict schemas, confirmation state machine, data minimisation, untrusted-data wrapping, cost limits. The AI never sees credentials, never runs SQL or code, and never calls external APIs. |
| Cron endpoint | Disabled unless `CRON_SECRET` (≥ 32 chars) is set. Bearer secret compared in constant time (SHA-256 digests). Rate-limited. No cookies, so it is exempt from CSRF by design. It can only run the scheduled jobs; it returns no personal data. |
| Database TLS | `DATABASE_SSL_CA` enforces certificate-verified TLS (`rejectUnauthorized: true`); URL TLS parameters are ignored so they cannot weaken it. |
| Caching | Every `/api` response sends `Cache-Control: no-store` (and `vercel.json` repeats it at the edge). |
| Telegram | Webhook authenticated with the secret header (constant-time compare). Single-use hashed link codes with a 10-minute TTL. Only the linked user's private chat is served. |
| Links | Meeting and ticket URLs are rendered only if `http(s)`, with `rel="noreferrer noopener"`. Email HTML is escaped. |
| CSV | Spreadsheet formula injection is neutralised (`'` prefix for `= + - @`). |
| Audit | Timesheet, journal, settings, timer, integration and AI actions are written to `audit_logs`. |
