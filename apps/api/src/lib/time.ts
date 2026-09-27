/**
 * Timezone helpers built on Intl (no dependency).
 * "date" strings are YYYY-MM-DD and "time" strings are HH:mm, both in the user's timezone.
 * @db.Date columns are stored as UTC midnight of that calendar date.
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

function parts(d: Date, tz: string) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    formatters.set(tz, f);
  }
  const o: Record<string, number> = {};
  for (const p of f.formatToParts(d)) if (p.type !== 'literal') o[p.type] = Number(p.value);
  return { y: o.year!, m: o.month!, d: o.day!, h: o.hour!, mi: o.minute!, s: o.second! };
}

const pad = (n: number) => String(n).padStart(2, '0');

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function localDate(d: Date, tz: string): string {
  const p = parts(d, tz);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

export function localTime(d: Date, tz: string): string {
  const p = parts(d, tz);
  return `${pad(p.h)}:${pad(p.mi)}`;
}

export function localMinutesOfDay(d: Date, tz: string): number {
  const p = parts(d, tz);
  return p.h * 60 + p.mi;
}

function offsetMs(d: Date, tz: string): number {
  const p = parts(d, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(d.getTime() / 1000) * 1000;
}

/** Wall-clock date + time in `tz` → UTC instant (DST-safe for all non-ambiguous times). */
export function zonedTimeToUtc(date: string, time: string, tz: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [h, mi] = time.split(':').map(Number) as [number, number];
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const first = guess - offsetMs(new Date(guess), tz);
  return new Date(guess - offsetMs(new Date(first), tz));
}

export function dayRangeUtc(date: string, tz: string): { start: Date; end: Date } {
  return { start: zonedTimeToUtc(date, '00:00', tz), end: zonedTimeToUtc(addDays(date, 1), '00:00', tz) };
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const dateToDb = (date: string) => new Date(`${date}T00:00:00.000Z`);
export const dbToDate = (d: Date) => d.toISOString().slice(0, 10);

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: string): number {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

export const startOfIsoWeek = (date: string) => addDays(date, 1 - isoWeekday(date));

export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${pad(last)}` };
}

export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

export function parseHm(value: string): number {
  const [h, m] = value.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

export const minutesBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 60000);

export const HM_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
export const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
