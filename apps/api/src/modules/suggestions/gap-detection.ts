import { parseHm, zonedTimeToUtc } from '../../lib/time';

export interface Interval {
  start: Date;
  end: Date;
}

export interface ObservedSignal {
  at: Date;
  label: string;
}

export interface Gap {
  start: Date;
  end: Date;
  minutes: number;
  observed: ObservedSignal[];
}

/**
 * Finds windows inside working hours (excluding lunch and the future) not covered by any
 * confirmed entry, timer or meeting. Gaps are "possible untracked work" — never facts.
 */
export function findGaps(input: {
  date: string;
  tz: string;
  workStartTime: string;
  workEndTime: string;
  lunchStart?: string | null;
  lunchEnd?: string | null;
  busy: Interval[];
  observed: ObservedSignal[];
  now: Date;
  minGapMinutes?: number;
}): Gap[] {
  const minGap = input.minGapMinutes ?? 60;
  const dayStart = zonedTimeToUtc(input.date, input.workStartTime, input.tz);
  const dayEnd = new Date(Math.min(zonedTimeToUtc(input.date, input.workEndTime, input.tz).getTime(), input.now.getTime()));
  if (dayEnd <= dayStart) return [];

  const blocks: Interval[] = [...input.busy];
  if (input.lunchStart && input.lunchEnd && parseHm(input.lunchEnd) > parseHm(input.lunchStart)) {
    blocks.push({ start: zonedTimeToUtc(input.date, input.lunchStart, input.tz), end: zonedTimeToUtc(input.date, input.lunchEnd, input.tz) });
  }
  blocks.sort((a, b) => a.start.getTime() - b.start.getTime());

  const gaps: Gap[] = [];
  let cursor = dayStart;
  const push = (start: Date, end: Date) => {
    const minutes = Math.round((end.getTime() - start.getTime()) / 60000);
    if (minutes >= minGap) {
      gaps.push({ start, end, minutes, observed: input.observed.filter((o) => o.at >= start && o.at < end) });
    }
  };
  for (const b of blocks) {
    if (b.end <= cursor) continue;
    if (b.start >= dayEnd) break;
    if (b.start > cursor) push(cursor, b.start);
    if (b.end > cursor) cursor = b.end;
  }
  if (cursor < dayEnd) push(cursor, dayEnd);
  return gaps;
}
