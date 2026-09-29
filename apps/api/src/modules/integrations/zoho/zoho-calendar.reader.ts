import type { ReadOnlyHttpClient } from '../http/read-only-http-client';
import type { DateRange, ExternalCalendar, ExternalCalendarEvent } from '../providers';
import type { ZohoCalendarReader } from './zoho.readers';
import { ZOHO_CALENDAR_MAX_RANGE_DAYS } from './zoho.scopes';
import { extractMeetingUrl, formatZohoDate, parseZohoDateTime, str } from './zoho.util';

interface RawEvent {
  uid?: string;
  title?: string;
  description?: string;
  location?: string;
  organizer?: string;
  isallday?: boolean;
  dateandtime?: { timezone?: string; start?: string; end?: string };
  attendees?: { email?: string; name?: string; status?: string }[];
  conference?: unknown;
  url?: string;
  status?: string;
}

/** READ-ONLY Zoho Calendar provider. */
export class ZohoCalendarApiReader implements ZohoCalendarReader {
  constructor(
    private readonly http: ReadOnlyHttpClient,
    private readonly host: string,
    private readonly logShape?: (resource: string, keys: string[]) => void,
  ) {}

  private url(path: string) {
    return `https://${this.host}/api/v1${path}`;
  }

  async listCalendars(): Promise<ExternalCalendar[]> {
    const res = await this.http.get<{ calendars?: { uid?: string; name?: string; isdefault?: boolean; category?: string }[] }>(this.url('/calendars'));
    return (res.data?.calendars ?? [])
      .filter((c) => c.uid && c.category !== 'holiday')
      .map((c) => ({ externalId: c.uid!, name: c.name ?? 'Calendar', isPrimary: !!c.isdefault }));
  }

  /** Zoho limits the event range per request, so the window is fetched in chunks. */
  async listEvents(calendarId: string, range: DateRange): Promise<ExternalCalendarEvent[]> {
    const out: ExternalCalendarEvent[] = [];
    const stepMs = (ZOHO_CALENDAR_MAX_RANGE_DAYS - 1) * 86_400_000;
    for (let start = range.from.getTime(); start < range.to.getTime(); start += stepMs + 86_400_000) {
      const end = Math.min(start + stepMs, range.to.getTime());
      const res = await this.http.get<{ events?: RawEvent[] }>(this.url(`/calendars/${encodeURIComponent(calendarId)}/events`), {
        query: { range: JSON.stringify({ start: formatZohoDate(new Date(start)), end: formatZohoDate(new Date(end)) }) },
      });
      const rawEvents = res.data?.events ?? [];
      if (this.logShape) {
        const keys = Array.from(new Set(rawEvents.flatMap((e) => Object.keys(e)))).sort();
        this.logShape(`calendar:${calendarId}`, [`count=${rawEvents.length}`, ...keys]);
      }
      for (const e of rawEvents) {
        const mapped = this.map(calendarId, e);
        if (mapped) out.push(mapped);
      }
    }
    return out;
  }

  async getEvent(calendarId: string, eventId: string): Promise<ExternalCalendarEvent | null> {
    const res = await this.http.get<{ events?: RawEvent[] }>(this.url(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`));
    const e = res.data?.events?.[0];
    return e ? this.map(calendarId, e) : null;
  }

  private map(calendarId: string, e: RawEvent): ExternalCalendarEvent | null {
    const tz = e.dateandtime?.timezone ?? 'UTC';
    const startAt = parseZohoDateTime(e.dateandtime?.start, tz);
    const endAt = parseZohoDateTime(e.dateandtime?.end, tz);
    if (!e.uid || !startAt || !endAt) return null;
    const status = (e.status ?? '').toLowerCase();
    return {
      externalId: e.uid,
      calendarExternalId: calendarId,
      title: e.title?.trim() || '(No title)',
      description: str(e.description),
      location: str(e.location),
      meetingUrl: extractMeetingUrl(JSON.stringify(e.conference ?? ''), e.url, e.location, e.description),
      organizer: str(e.organizer),
      attendees: (e.attendees ?? []).map((a) => ({ name: str(a.name), email: str(a.email) })),
      startAt,
      endAt,
      isAllDay: !!e.isallday,
      status: status.includes('cancel') ? 'CANCELLED' : status.includes('tentative') ? 'TENTATIVE' : 'CONFIRMED',
    };
  }
}
