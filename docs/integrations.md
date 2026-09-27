# Integrations

## Read-only by construction
- All provider traffic goes through `integrations/http/read-only-http-client.ts`. It exposes **only** `get()`, sends `method: 'GET'`, requires `https:`, checks the host against an allow-list per client, supports `If-None-Match`/ETag, and returns `rateLimitRemaining`.
- `integrations/providers.ts` defines interfaces with `list*`/`get*` methods only.
- `test/external-read-only.test.ts` scans `integrations/zoho/**` and `integrations/github/**` and fails on `method:`, `fetch(`, `.post/.put/.patch/.delete/.request(`, HTTP-library imports or `graphql`. It also checks that Zoho scopes all end in `.READ`.
- The only non-GET calls that touch Zoho are OAuth token exchange, refresh and revoke with the **accounts** server, in `integrations/oauth/zoho-oauth.ts`, outside the scanned folders. None of them modify Zoho data.

## Zoho
| Product | Endpoints (read) | Local tables |
|---|---|---|
| Calendar | `GET /api/v1/calendars`, `GET /api/v1/calendars/{uid}/events?range=…` (chunked to ≤31 days) | `calendar_events` |
| Projects (REST v1, portal-scoped) | `GET /restapi/portals/`, `…/portal/{id}/projects/`, `…/projects/{id}/tasks/`, `…/mytasks/` | `projects`, `work_items` |
| Sprints | `GET /zsapi/teams/`, `…/team/{t}/projects/`, `…/sprints/`, `…/sprints/{s}/item/` (columnar payloads decoded by `decodeColumnar`) | `projects`, `sprints`, `work_items`, `work_item_sprint_snapshots` |

- Sync window: `ZOHO_SYNC_PAST_DAYS` back to `ZOHO_SYNC_FUTURE_DAYS` ahead. Events in the window that are no longer returned are marked deleted.
- Zoho Sprints ids are stored with a `sprints:` prefix, so they never collide with Zoho Projects ids.
- Mapping caveat: see README → Status. `ZOHO_DEBUG_SHAPES=true` logs response keys only.

## GitHub
REST GET only, with a fine-grained read-only token (`GITHUB_TOKEN`):
- `GET /user`, `GET /user/repos` (list; choose tracked repos in Settings or with `GITHUB_REPOS`)
- `GET /repos/{r}/commits?author=&since=`, with an ETag per repository
- `GET /search/issues` for authored PRs and issues, and PRs reviewed by you; `GET /repos/{r}/pulls/{n}/reviews` for review timestamps

Ticket keys (`ABC-123`) are extracted from commit messages and PR/issue titles. GitHub activity is labelled **Observed**: evidence, never logged time.

## Failure handling
Each resource syncs independently. Errors are stored in `sync_states.lastError`, shown in Settings, and raise one `SYNC_FAILURE` notification per resource per day. Local features keep working.
