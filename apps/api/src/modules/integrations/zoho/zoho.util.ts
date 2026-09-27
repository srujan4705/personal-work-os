import { zonedTimeToUtc } from '../../../lib/time';

/** Parses Zoho date-times: 20260922T100000Z, 20260922T100000+0530, 20260922 (all-day), or epoch ms. */
export function parseZohoDateTime(value: unknown, fallbackTz = 'UTC'): Date | null {
  if (typeof value === 'number') return new Date(value);
  if (typeof value !== 'string' || !value) return null;
  if (/^\d{12,}$/.test(value)) return new Date(Number(value));
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z|[+-]\d{4})?)?$/.exec(value);
  if (!m) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const [, y, mo, d, h = '00', mi = '00', s = '00', zone] = m;
  if (zone === 'Z') return new Date(Date.UTC(+y!, +mo! - 1, +d!, +h, +mi, +s));
  if (zone) {
    const sign = zone.startsWith('-') ? -1 : 1;
    const offset = sign * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(3, 5)));
    return new Date(Date.UTC(+y!, +mo! - 1, +d!, +h, +mi, +s) - offset * 60000);
  }
  return zonedTimeToUtc(`${y}-${mo}-${d}`, `${h}:${mi}`, fallbackTz);
}

export const formatZohoDate = (d: Date) => d.toISOString().slice(0, 10).replaceAll('-', '');

const MEETING_HOSTS = /https:\/\/[^\s"'<>]*(zoom\.us|meet\.google\.com|teams\.microsoft\.com|teams\.live\.com|meeting\.zoho\.[a-z.]+|webex\.com|whereby\.com)[^\s"'<>]*/i;

/** Finds a meeting URL on a known conferencing host. Only https URLs are returned. */
export function extractMeetingUrl(...values: unknown[]): string | null {
  for (const v of values) {
    if (typeof v !== 'string') continue;
    const m = MEETING_HOSTS.exec(v);
    if (m) return m[0];
  }
  return null;
}

/**
 * Zoho Sprints returns columnar payloads: { <x>JObj: { id: [values...] }, <x>_prop: { field: index } }.
 * This turns them into plain objects keyed by field name.
 */
export function decodeColumnar(payload: unknown, prefix: string): Record<string, unknown>[] {
  if (!payload || typeof payload !== 'object') return [];
  const p = payload as Record<string, unknown>;
  const rows = p[`${prefix}JObj`] as Record<string, unknown[]> | undefined;
  const props = p[`${prefix}_prop`] as Record<string, number> | undefined;
  if (!rows || !props) return [];
  const order = (p[`${prefix}Ids`] as string[] | undefined) ?? Object.keys(rows);
  return order
    .filter((id) => Array.isArray(rows[id]))
    .map((id) => {
      const values = rows[id]!;
      const obj: Record<string, unknown> = { id };
      for (const [name, idx] of Object.entries(props)) obj[name] = values[idx];
      return obj;
    });
}

export const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : typeof v === 'number' ? String(v) : null);
