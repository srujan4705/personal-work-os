import { formatMinutes } from '@pwos/shared';
import { localMinutesOfDay, parseHm } from '../../lib/time';

export type IssueLevel = 'error' | 'warning';

export interface ValidationIssue {
  level: IssueLevel;
  code:
    | 'INVALID_DURATION'
    | 'NEGATIVE_DURATION'
    | 'DURATION_EXCEEDS_RANGE'
    | 'OVERLAP'
    | 'DUPLICATE'
    | 'OUTSIDE_WORKING_HOURS'
    | 'MISSING_TIME';
  message: string;
  entryIds: string[];
}

export interface EntryLike {
  id: string;
  workItemId: string | null;
  activityType: string;
  description: string | null;
  durationMinutes: number;
  startTime: Date | null;
  endTime: Date | null;
}

export interface ValidationSettings {
  tz: string;
  workStartTime: string;
  workEndTime: string;
  expectedMinutes: number;
}

/**
 * Pure timesheet validation. Errors are hard problems; warnings are informational
 * (overlaps, duplicates, outside hours, missing time). Exactly 8 hours is never enforced.
 */
export function validateEntries(entries: EntryLike[], s: ValidationSettings): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const e of entries) {
    if (!Number.isInteger(e.durationMinutes) || e.durationMinutes <= 0 || e.durationMinutes > 1440) {
      issues.push({ level: 'error', code: 'INVALID_DURATION', message: 'Duration must be between 1 minute and 24 hours.', entryIds: [e.id] });
    }
    if (e.startTime && e.endTime) {
      const span = (e.endTime.getTime() - e.startTime.getTime()) / 60000;
      if (span <= 0) {
        issues.push({ level: 'error', code: 'NEGATIVE_DURATION', message: 'End time is before start time.', entryIds: [e.id] });
      } else if (e.durationMinutes > Math.ceil(span)) {
        issues.push({ level: 'error', code: 'DURATION_EXCEEDS_RANGE', message: 'Duration is longer than the start–end range.', entryIds: [e.id] });
      }
    }
  }

  const timed = entries
    .filter((e): e is EntryLike & { startTime: Date; endTime: Date } => !!e.startTime && !!e.endTime && e.endTime > e.startTime)
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length && timed[j]!.startTime < timed[i]!.endTime; j++) {
      issues.push({ level: 'warning', code: 'OVERLAP', message: 'These entries overlap.', entryIds: [timed[i]!.id, timed[j]!.id] });
    }
  }

  const seen = new Map<string, string>();
  for (const e of entries) {
    const key = [e.workItemId, e.activityType, e.durationMinutes, e.startTime?.getTime() ?? '', (e.description ?? '').trim().toLowerCase()].join('|');
    const first = seen.get(key);
    if (first) issues.push({ level: 'warning', code: 'DUPLICATE', message: 'This looks like a duplicate entry.', entryIds: [first, e.id] });
    else seen.set(key, e.id);
  }

  const workStart = parseHm(s.workStartTime);
  const workEnd = parseHm(s.workEndTime);
  for (const e of timed) {
    if (localMinutesOfDay(e.startTime, s.tz) < workStart || localMinutesOfDay(e.endTime, s.tz) > workEnd || localMinutesOfDay(e.endTime, s.tz) < localMinutesOfDay(e.startTime, s.tz)) {
      issues.push({ level: 'warning', code: 'OUTSIDE_WORKING_HOURS', message: 'Entry is outside your working hours.', entryIds: [e.id] });
    }
  }

  const logged = entries.reduce((sum, e) => sum + Math.max(0, e.durationMinutes), 0);
  if (logged < s.expectedMinutes) {
    issues.push({ level: 'warning', code: 'MISSING_TIME', message: `${formatMinutes(s.expectedMinutes - logged)} below your expected time.`, entryIds: [] });
  }
  return issues;
}
