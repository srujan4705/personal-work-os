import { describe, expect, it } from 'vitest';
import { addDays, dayRangeUtc, isoWeekday, localDate, localTime, startOfIsoWeek, zonedTimeToUtc } from '../src/lib/time';
import { validateEntries } from '../src/modules/timesheets/timesheet.validation';
import { findGaps } from '../src/modules/suggestions/gap-detection';
import { parseDeterministic } from '../src/modules/assistant/deterministic';
import { decodeColumnar, extractMeetingUrl, parseZohoDateTime } from '../src/modules/integrations/zoho/zoho.util';
import { toCsv } from '../src/modules/exports/export.service';
import { minimizeForAi } from '../src/modules/ai/ai-guard';
import { isDue } from '../src/modules/scheduler/jobs';
import { toGeminiSchema } from '../src/modules/ai/gemini.provider';
import { extractTicketKeys, formatMinutes } from '@pwos/shared';
import { decodeCa, pgConnectionConfig } from '../src/lib/db-connection';
import { trustProxySetting } from '../src/config/env';

describe('time helpers', () => {
  it('converts wall-clock time in a timezone to UTC, including DST', () => {
    expect(zonedTimeToUtc('2026-09-22', '09:30', 'Asia/Kolkata').toISOString()).toBe('2026-09-22T04:00:00.000Z');
    expect(zonedTimeToUtc('2026-07-01', '09:00', 'America/New_York').toISOString()).toBe('2026-07-01T13:00:00.000Z');
    expect(zonedTimeToUtc('2026-01-15', '09:00', 'America/New_York').toISOString()).toBe('2026-01-15T14:00:00.000Z');
  });
  it('derives local date/time and ranges', () => {
    const d = new Date('2026-09-22T20:00:00Z');
    expect(localDate(d, 'Asia/Kolkata')).toBe('2026-09-23');
    expect(localTime(d, 'Asia/Kolkata')).toBe('01:30');
    expect(dayRangeUtc('2026-09-23', 'Asia/Kolkata').start.toISOString()).toBe('2026-09-22T18:30:00.000Z');
    expect(isoWeekday('2026-09-27')).toBe(7);
    expect(startOfIsoWeek('2026-09-27')).toBe('2026-09-21');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('timesheet validation', () => {
  const base = { workItemId: null, activityType: 'DEVELOPMENT', description: null };
  const settings = { tz: 'UTC', workStartTime: '09:00', workEndTime: '18:00', expectedMinutes: 480 };
  const t = (h: string) => new Date(`2026-09-22T${h}:00Z`);

  it('warns (does not error) on overlap and missing time', () => {
    const issues = validateEntries([
      { ...base, id: 'a', durationMinutes: 60, startTime: t('10:00'), endTime: t('11:00') },
      { ...base, id: 'b', durationMinutes: 60, startTime: t('10:30'), endTime: t('11:30'), activityType: 'TESTING' },
    ], settings);
    expect(issues.find((i) => i.code === 'OVERLAP')?.level).toBe('warning');
    expect(issues.find((i) => i.code === 'MISSING_TIME')?.level).toBe('warning');
    expect(issues.some((i) => i.level === 'error')).toBe(false);
  });
  it('flags hard errors for impossible entries', () => {
    const issues = validateEntries([{ ...base, id: 'a', durationMinutes: 90, startTime: t('10:00'), endTime: t('11:00') }], settings);
    expect(issues.find((i) => i.code === 'DURATION_EXCEEDS_RANGE')?.level).toBe('error');
  });
  it('warns on duplicates and outside working hours, never forces exactly 8h', () => {
    const e = { ...base, durationMinutes: 600, startTime: t('07:00'), endTime: t('17:00') };
    const issues = validateEntries([{ ...e, id: 'a' }, { ...e, id: 'b' }], settings);
    expect(issues.map((i) => i.code)).toEqual(expect.arrayContaining(['DUPLICATE', 'OUTSIDE_WORKING_HOURS']));
    expect(issues.some((i) => i.code === 'MISSING_TIME')).toBe(false);
  });
});

describe('gap detection', () => {
  it('reports possible untracked windows with observed evidence, excluding lunch', () => {
    const t = (h: string) => new Date(`2026-09-22T${h}:00Z`);
    const gaps = findGaps({
      date: '2026-09-22', tz: 'UTC', workStartTime: '09:00', workEndTime: '18:00', lunchStart: '13:00', lunchEnd: '14:00',
      busy: [{ start: t('09:00'), end: t('11:00') }, { start: t('14:00'), end: t('18:00') }],
      observed: [{ at: t('11:30'), label: 'commit' }], now: t('20:00'),
    });
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ minutes: 120 });
    expect(gaps[0]!.observed).toHaveLength(1);
  });
  it('ignores the future part of today', () => {
    const t = (h: string) => new Date(`2026-09-22T${h}:00Z`);
    expect(findGaps({ date: '2026-09-22', tz: 'UTC', workStartTime: '09:00', workEndTime: '18:00', busy: [], observed: [], now: t('09:30') })).toEqual([]);
  });
});

describe('deterministic assistant commands', () => {
  const p = (m: string) => parseDeterministic(m, '2026-09-23', '2026-09-24');
  it('parses slash commands', () => {
    expect(p('/today')).toMatchObject({ kind: 'tool', name: 'get_today_summary' });
    expect(p('/standup')).toMatchObject({ kind: 'tool', name: 'generate_standup' });
    expect(p('/help')).toEqual({ kind: 'help' });
  });
  it('parses simple time entries and reminders', () => {
    expect(p('Add 30 minutes testing to ER-431')).toMatchObject({ name: 'add_time_entry', args: { durationMinutes: 30, activityType: 'TESTING', ticket: 'ER-431', date: '2026-09-23' } });
    expect(p('log 1.5h to ER-9 yesterday')).toMatchObject({ args: { durationMinutes: 90, date: '2026-09-22' } });
    expect(p('Remind me at 5:30 pm')).toMatchObject({ name: 'set_reminder_time', args: { time: '17:30' } });
  });
  it('detects requests to modify Zoho', () => {
    for (const m of ['Update ER-431 status in Zoho', 'close ER-431', 'Please change the status of ER-12 to done', 'zoho: assign ER-1 to me']) {
      expect(p(m)?.kind).toBe('zoho_write');
    }
    expect(p('add 30 minutes to ER-431')?.kind).toBe('tool');
  });
});

describe('zoho helpers', () => {
  it('parses Zoho date formats', () => {
    expect(parseZohoDateTime('20260922T100000Z')?.toISOString()).toBe('2026-09-22T10:00:00.000Z');
    expect(parseZohoDateTime('20260922T100000+0530')?.toISOString()).toBe('2026-09-22T04:30:00.000Z');
    expect(parseZohoDateTime('20260922T100000', 'Asia/Kolkata')?.toISOString()).toBe('2026-09-22T04:30:00.000Z');
  });
  it('decodes Zoho Sprints columnar payloads', () => {
    const rows = decodeColumnar({ sprintJObj: { s1: ['Sprint 1', 2] }, sprint_prop: { sprintName: 0, sprintType: 1 }, sprintIds: ['s1'] }, 'sprint');
    expect(rows).toEqual([{ id: 's1', sprintName: 'Sprint 1', sprintType: 2 }]);
  });
  it('only extracts https meeting links on known hosts', () => {
    expect(extractMeetingUrl('join: https://zoom.us/j/123?pwd=x')).toBe('https://zoom.us/j/123?pwd=x');
    expect(extractMeetingUrl('javascript:alert(1) http://zoom.us/j/1')).toBeNull();
  });
});

describe('misc', () => {
  it('guards CSV against formula injection', () => {
    expect(toCsv([{ a: '=HYPERLINK("x")', b: 'x,y' }], ['a', 'b'])).toBe('a,b\n"\'=HYPERLINK(""x"")","x,y"\n');
  });
  it('minimizes data sent to remote AI', () => {
    const out = minimizeForAi({ title: 'Sync', attendees: [{ email: 'a@b.c' }], description: 'secret plans', accessToken: 'x' }, 'MINIMAL_REMOTE');
    expect(out).toEqual({ title: 'Sync' });
    expect(minimizeForAi({ accessToken: 'x', description: 'd' }, 'FULL_CONTEXT')).toEqual({ description: 'd' });
  });
  it('schedules time-of-day jobs in a window', () => {
    expect(isDue(17 * 60, '17:00')).toBe(true);
    expect(isDue(17 * 60 + 29, '17:00')).toBe(true);
    expect(isDue(17 * 60 + 30, '17:00')).toBe(false);
    expect(isDue(16 * 60 + 59, '17:00')).toBe(false);
  });
  it('strips JSON-schema keywords Gemini rejects', () => {
    expect(toGeminiSchema({ $schema: 'x', type: 'object', additionalProperties: false, properties: { d: { type: 'string', pattern: '^x$' } } })).toEqual({ type: 'object', properties: { d: { type: 'string' } } });
  });
  it('formats minutes and extracts ticket keys', () => {
    expect(formatMinutes(290)).toBe('4h 50m');
    expect(extractTicketKeys('ER-431: fix ER-12 and er-3')).toEqual(['ER-431', 'ER-12']);
  });
});

describe('deployment portability helpers', () => {
  const pem = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n';
  it('keeps the URL unchanged without a CA', () => {
    expect(pgConnectionConfig('postgresql://u:p@h:5432/db?sslmode=require')).toEqual({ connectionString: 'postgresql://u:p@h:5432/db?sslmode=require' });
  });
  it('enforces verified TLS with a CA and strips URL TLS params', () => {
    const c = pgConnectionConfig('postgresql://u:p@h:5432/db?sslmode=require&application_name=x', pem);
    expect(c.connectionString).toBe('postgresql://u:p@h:5432/db?application_name=x');
    expect(c.ssl).toEqual({ ca: pem, rejectUnauthorized: true });
  });
  it('accepts PEM, escaped PEM and base64 PEM; rejects junk', () => {
    expect(decodeCa(pem.replace(/\n/g, '\\n'))).toBe(pem);
    expect(decodeCa(Buffer.from(pem).toString('base64'))).toBe(pem);
    expect(() => decodeCa('not-a-cert')).toThrow(/PEM/);
  });
  it('parses TRUST_PROXY', () => {
    expect(trustProxySetting('2')).toBe(2);
    expect(trustProxySetting('false')).toBe(false);
    expect(trustProxySetting('loopback, 10.0.0.0/8')).toBe('loopback, 10.0.0.0/8');
  });
});
