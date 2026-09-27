import type { ToolArgs, ToolName } from '@pwos/ai-contracts';
import type { ActivityType } from '@pwos/shared';

export type DeterministicIntent =
  | { kind: 'tool'; name: ToolName; args: ToolArgs<ToolName> }
  | { kind: 'help' }
  | { kind: 'zoho_write'; ticket: string | null };

export const HELP_TEXT = [
  'Commands that always work (even without AI):',
  '/today — today’s summary',
  '/tomorrow — tomorrow’s meetings',
  '/timesheet — today’s timesheet',
  '/sprint — current sprint',
  '/summary — this week’s summary',
  '/standup — standup draft',
  '/gaps — possible untracked work today',
  'You can also say: “add 30 minutes testing to ER-431” or “remind me at 5:30 pm”.',
].join('\n');

const ACTIVITY_WORDS: [RegExp, ActivityType][] = [
  [/test/i, 'TESTING'], [/review/i, 'CODE_REVIEW'], [/meet/i, 'MEETING'], [/doc/i, 'DOCUMENTATION'], [/research|investigat/i, 'RESEARCH'],
  [/deploy|release/i, 'DEPLOYMENT'], [/support/i, 'SUPPORT'], [/bug|fix/i, 'BUG_FIX'], [/plan/i, 'PLANNING'], [/dev|cod|implement|build/i, 'DEVELOPMENT'],
];

const ZOHO_WRITE = [
  /\b(update|change|edit|close|move|assign|reassign|delete|create|comment|log|set|mark|reopen)\b[^.?!\n]*\bzoho\b/i,
  /\bzoho\b[^.?!\n]*\b(update|change|edit|close|move|assign|reassign|delete|create|comment|reopen)\b/i,
  /\b(close|reopen|reassign|assign)\s+(ticket\s+)?[A-Z][A-Z0-9]+-\d+/i,
  /\b(change|update|set)\s+(the\s+)?(status|priority|assignee|due date)\s+(of|for|on)\b/i,
];

/** Recognises slash commands and a few simple phrases without any AI. */
export function parseDeterministic(message: string, today: string, tomorrow: string): DeterministicIntent | null {
  const text = message.trim();
  if (ZOHO_WRITE.some((r) => r.test(text))) return { kind: 'zoho_write', ticket: /[A-Z][A-Z0-9]+-\d+/.exec(text)?.[0] ?? null };

  const cmd = /^\/(\w+)/.exec(text)?.[1]?.toLowerCase();
  switch (cmd) {
    case 'start':
    case 'help': return { kind: 'help' };
    case 'today': return { kind: 'tool', name: 'get_today_summary', args: {} };
    case 'tomorrow': return { kind: 'tool', name: 'get_tomorrow_schedule', args: {} };
    case 'timesheet': return { kind: 'tool', name: 'get_timesheet', args: { date: today } };
    case 'sprint': return { kind: 'tool', name: 'get_current_sprint', args: {} };
    case 'summary':
    case 'week': return { kind: 'tool', name: 'get_weekly_report', args: {} };
    case 'standup': return { kind: 'tool', name: 'generate_standup', args: {} };
    case 'gaps': return { kind: 'tool', name: 'find_unlogged_work', args: { date: today } };
  }

  const add = /\b(?:add|log)\s+(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?|m|min|mins|minutes?)\b(?:\s+(?:of\s+)?([a-z ]+?))?\s+(?:to|for|on)\s+([A-Z][A-Z0-9]+-\d+)(?:\s+(yesterday|today))?/i.exec(text);
  if (add) {
    const amount = Number(add[1]);
    const minutes = Math.round(/^h/i.test(add[2]!) ? amount * 60 : amount);
    const activity = ACTIVITY_WORDS.find(([r]) => r.test(add[3] ?? ''))?.[1] ?? 'DEVELOPMENT';
    const date = add[5]?.toLowerCase() === 'yesterday' ? addDaysIso(today, -1) : today;
    if (minutes >= 1 && minutes <= 1440) return { kind: 'tool', name: 'add_time_entry', args: { date, durationMinutes: minutes, activityType: activity, ticket: add[4]!.toUpperCase() } };
  }

  const remind = /\bremind me at (\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i.exec(text);
  if (remind) {
    let h = Number(remind[1]);
    const m = Number(remind[2] ?? 0);
    if (remind[3]?.toLowerCase() === 'pm' && h < 12) h += 12;
    if (remind[3]?.toLowerCase() === 'am' && h === 12) h = 0;
    if (h < 24 && m < 60) return { kind: 'tool', name: 'set_reminder_time', args: { reminder: 'DAILY', time: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` } };
  }

  if (/\bmeetings?\b.*\btomorrow\b|\btomorrow\b.*\bmeetings?\b/i.test(text)) return { kind: 'tool', name: 'get_tomorrow_schedule', args: {} };
  if (/\bstand-?up\b/i.test(text)) return { kind: 'tool', name: 'generate_standup', args: {} };
  if (/\bhow (many|much) (hours|time)\b.*\btoday\b/i.test(text)) return { kind: 'tool', name: 'get_timesheet', args: { date: today } };
  void tomorrow;
  return null;
}

function addDaysIso(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
