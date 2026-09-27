/** Constants and helpers shared by the API and the web app. */

export const ACTIVITY_TYPES = [
  'DEVELOPMENT', 'TESTING', 'CODE_REVIEW', 'MEETING', 'DOCUMENTATION', 'RESEARCH',
  'DEPLOYMENT', 'SUPPORT', 'BUG_FIX', 'PLANNING', 'OTHER',
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const NOTIFICATION_TYPES = [
  'MEETING_REMINDER', 'TOMORROW_SCHEDULE', 'MORNING_SUMMARY', 'TIMESHEET_REMINDER',
  'TIMESHEET_CONFIRMATION', 'TIMESHEET_OVERDUE', 'WEEKLY_SUMMARY', 'SPRINT_REPORT_READY',
  'SYNC_FAILURE', 'UNLOGGED_WORK', 'JOURNAL_REMINDER',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const JOURNAL_SECTIONS = [
  'workedOn', 'accomplished', 'pending', 'blockers', 'notes', 'tomorrow', 'lessonsLearned',
] as const;
export type JournalSection = (typeof JOURNAL_SECTIONS)[number];

export const JOURNAL_SECTION_LABELS: Record<JournalSection, string> = {
  workedOn: 'What did I work on?',
  accomplished: 'What did I accomplish?',
  pending: 'What is still pending?',
  blockers: 'Blockers',
  notes: 'Notes',
  tomorrow: 'Tomorrow',
  lessonsLearned: 'Lessons learned',
};

/** Ticket keys like ER-431. */
export const TICKET_KEY_REGEX = /\b[A-Z][A-Z0-9]{1,9}-\d{1,7}\b/g;

export function extractTicketKeys(...texts: (string | null | undefined)[]): string[] {
  const keys = new Set<string>();
  for (const t of texts) for (const m of (t ?? '').matchAll(TICKET_KEY_REGEX)) keys.add(m[0]);
  return [...keys];
}

export function formatMinutes(total: number): string {
  const m = Math.max(0, Math.round(total));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r}m`;
  return r === 0 ? `${h}h` : `${h}h ${r}m`;
}

export function titleCase(value: string): string {
  return value.toLowerCase().split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
