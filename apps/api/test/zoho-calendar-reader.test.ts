import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReadOnlyHttpClient } from '../src/modules/integrations/http/read-only-http-client';
import { ZohoCalendarApiReader } from '../src/modules/integrations/zoho/zoho-calendar.reader';

/**
 * Regression test for a bug that has now happened TWICE in this codebase: Zoho gives every
 * occurrence of a recurring event the same `uid` and a distinct `recurrenceid`. Mapping only
 * on `uid` makes every occurrence upsert onto the same database row — "Daily Standup" then
 * appears on exactly one day (whichever synced last) instead of every weekday — with no error
 * anywhere, which is exactly why it went unnoticed the first time it regressed.
 */
describe('Zoho calendar reader: recurring events', () => {
  const rawEvent = (uid: string, recurrenceid: string | undefined, start: string) => ({
    uid, recurrenceid, title: 'Daily Standup',
    dateandtime: { timezone: 'UTC', start, end: start },
  });

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            events: [
              rawEvent('series-uid-1', 'rec-001', '20261001T093000+0000'),
              rawEvent('series-uid-1', 'rec-002', '20261002T093000+0000'),
              rawEvent('series-uid-1', 'rec-003', '20261003T093000+0000'),
              { uid: 'one-off-uid', title: 'Backlog Refinement', dateandtime: { timezone: 'UTC', start: '20261001T100000+0000', end: '20261001T100000+0000' } },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('gives every occurrence of a recurring series its own externalId', async () => {
    const http = new ReadOnlyHttpClient({ allowedHosts: ['calendar.zoho.com'], authorization: async () => 'Zoho-oauthtoken test' });
    const reader = new ZohoCalendarApiReader(http, 'calendar.zoho.com');
    const events = await reader.listEvents('cal-1', { from: new Date('2026-09-25'), to: new Date('2026-10-10') });

    const standups = events.filter((e) => e.title === 'Daily Standup');
    expect(standups).toHaveLength(3); // the bug: this collapses to 1 when externalId ignores recurrenceid

    const externalIds = new Set(standups.map((e) => e.externalId));
    expect(externalIds.size).toBe(3); // every occurrence must be independently upsertable

    // Exact id shape matters too — this is what sync.service.ts's upsert key relies on.
    expect(standups.map((e) => e.externalId).sort()).toEqual(['series-uid-1:rec-001', 'series-uid-1:rec-002', 'series-uid-1:rec-003']);

    // A genuinely one-off event (no recurrenceid) keeps its plain uid, unchanged.
    const oneOff = events.find((e) => e.title === 'Backlog Refinement');
    expect(oneOff?.externalId).toBe('one-off-uid');
  });
});
