import { z } from 'zod';
import { ACTIVITY_TYPES, JOURNAL_SECTIONS, NOTIFICATION_TYPES, formatMinutes } from '@pwos/shared';

/**
 * AI tool contracts — the ONLY functions an LLM can ask for.
 *
 * Rules enforced by tests (apps/api/test/tool-registry.test.ts):
 *  - Every schema is strict (unknown keys rejected).
 *  - No schema accepts a user id: identity always comes from the session.
 *  - Tools whose dataSource is ZOHO_READ or GITHUB_READ must be READ_ONLY.
 *  - No tool name refers to writing to an external system.
 */

export type ToolPermission = 'READ_ONLY' | 'LOCAL_WRITE' | 'DANGEROUS_WRITE';
export type ToolDataSource = 'LOCAL_DB' | 'ZOHO_READ' | 'GITHUB_READ';

export interface ToolDefinition<S extends z.ZodType = z.ZodType> {
  description: string;
  permission: ToolPermission;
  dataSource: ToolDataSource;
  input: S;
  /** Human-readable text for the confirmation prompt. */
  summarize?: (args: z.infer<S>) => string;
}

const defineTool = <S extends z.ZodType>(t: ToolDefinition<S>): ToolDefinition<S> => t;

// ─── Shared input primitives ───

export { ACTIVITY_TYPES, NOTIFICATION_TYPES, JOURNAL_SECTIONS };

const date = z.iso.date(); // YYYY-MM-DD in the user's timezone
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected YYYY-MM');
const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:mm');
const id = z.string().min(1).max(64);
const ticket = z.string().min(1).max(64).describe('Ticket key (e.g. ER-431) or work item id');
const sprintRef = z.string().min(1).max(128).describe('Sprint name or id; omit for current sprint');
const activityType = z.enum(ACTIVITY_TYPES);
const minutes = z.number().int().min(1).max(24 * 60);
const text = z.string().min(1).max(4000);
const range = { from: date, to: date };

const hm = formatMinutes;

// ─── Registry ───

export const TOOLS = {
  // READ_ONLY — local database
  get_today_summary: defineTool({
    description: "Today's logged time, meetings, timesheet status and suggestions.",
    permission: 'READ_ONLY', dataSource: 'LOCAL_DB', input: z.strictObject({}),
  }),
  get_timesheet: defineTool({
    description: 'Timesheet and entries for a date.',
    permission: 'READ_ONLY', dataSource: 'LOCAL_DB', input: z.strictObject({ date }),
  }),
  get_time_entries: defineTool({
    description: 'Time entries in a date range, optionally for one ticket.',
    permission: 'READ_ONLY', dataSource: 'LOCAL_DB',
    input: z.strictObject({ ...range, ticket: ticket.optional() }),
  }),
  search_work: defineTool({
    description: 'Search tickets, journal, time entries, meetings and GitHub activity.',
    permission: 'READ_ONLY', dataSource: 'LOCAL_DB',
    input: z.strictObject({
      query: z.string().min(1).max(200),
      from: date.optional(),
      to: date.optional(),
      limit: z.number().int().min(1).max(50).default(20),
    }),
  }),
  get_current_sprint: defineTool({
    description: 'Current sprint and my work items in it.',
    permission: 'READ_ONLY', dataSource: 'LOCAL_DB', input: z.strictObject({}),
  }),
  get_sprint_report: defineTool({
    description: 'Factual sprint report.',
    permission: 'READ_ONLY', dataSource: 'LOCAL_DB', input: z.strictObject({ sprint: sprintRef.optional() }),
  }),
  get_weekly_report: defineTool({
    description: 'Weekly report for the week containing weekOf (default: this week).',
    permission: 'READ_ONLY', dataSource: 'LOCAL_DB', input: z.strictObject({ weekOf: date.optional() }),
  }),
  get_monthly_report: defineTool({
    description: 'Monthly report.',
    permission: 'READ_ONLY', dataSource: 'LOCAL_DB', input: z.strictObject({ month }),
  }),
  get_calendar_events: defineTool({
    description: 'Synchronized calendar events in a date range.',
    permission: 'READ_ONLY', dataSource: 'LOCAL_DB', input: z.strictObject(range),
  }),
  get_tomorrow_schedule: defineTool({
    description: "Tomorrow's meetings with count and total duration.",
    permission: 'READ_ONLY', dataSource: 'LOCAL_DB', input: z.strictObject({}),
  }),
  get_journal_entries: defineTool({
    description: 'Journal entries in a date range.',
    permission: 'READ_ONLY', dataSource: 'LOCAL_DB', input: z.strictObject(range),
  }),
  get_github_activity: defineTool({
    description: 'Synchronized GitHub activity (observed evidence, not logged time).',
    permission: 'READ_ONLY', dataSource: 'LOCAL_DB', input: z.strictObject(range),
  }),
  get_ticket_history: defineTool({
    description: 'Full local history of one ticket.',
    permission: 'READ_ONLY', dataSource: 'LOCAL_DB', input: z.strictObject({ ticket }),
  }),
  find_unlogged_work: defineTool({
    description: 'Possible untracked gaps for a date, based on observed activity.',
    permission: 'READ_ONLY', dataSource: 'LOCAL_DB', input: z.strictObject({ date }),
  }),
  generate_standup: defineTool({
    description: 'Factual Yesterday/Today/Blockers data for a standup.',
    permission: 'READ_ONLY', dataSource: 'LOCAL_DB', input: z.strictObject({ date: date.optional() }),
  }),
  generate_retrospective: defineTool({
    description: 'Factual sprint metrics for a retrospective draft.',
    permission: 'READ_ONLY', dataSource: 'LOCAL_DB', input: z.strictObject({ sprint: sprintRef.optional() }),
  }),
  get_settings: defineTool({
    description: 'Non-secret user settings.',
    permission: 'READ_ONLY', dataSource: 'LOCAL_DB', input: z.strictObject({}),
  }),

  // READ_ONLY — live external read (through the read-only provider)
  get_meeting_details: defineTool({
    description: 'Details of one meeting; refreshes from Zoho Calendar (read-only) when reachable.',
    permission: 'READ_ONLY', dataSource: 'ZOHO_READ', input: z.strictObject({ eventId: id }),
  }),

  // LOCAL_WRITE
  add_time_entry: defineTool({
    description: 'Add a time entry to the local timesheet.',
    permission: 'LOCAL_WRITE', dataSource: 'LOCAL_DB',
    input: z.strictObject({
      date,
      durationMinutes: minutes,
      activityType,
      ticket: ticket.optional(),
      startTime: clockTime.optional(),
      description: z.string().max(1000).optional(),
    }),
    summarize: (a) =>
      `Add ${hm(a.durationMinutes)} of ${a.activityType.toLowerCase()}${a.ticket ? ` to ${a.ticket}` : ''} on ${a.date}.`,
  }),
  update_time_entry: defineTool({
    description: 'Update one local time entry.',
    permission: 'LOCAL_WRITE', dataSource: 'LOCAL_DB',
    input: z.strictObject({
      entryId: id,
      durationMinutes: minutes.optional(),
      activityType: activityType.optional(),
      ticket: ticket.optional(),
      description: z.string().max(1000).optional(),
    }),
    summarize: (a) => `Update time entry ${a.entryId}.`,
  }),
  start_timer: defineTool({
    description: 'Start the local timer.',
    permission: 'LOCAL_WRITE', dataSource: 'LOCAL_DB',
    input: z.strictObject({ activityType, ticket: ticket.optional(), description: z.string().max(1000).optional() }),
    summarize: (a) => `Start a ${a.activityType.toLowerCase()} timer${a.ticket ? ` for ${a.ticket}` : ''}.`,
  }),
  stop_timer: defineTool({
    description: 'Stop the timer and create a draft time entry.',
    permission: 'LOCAL_WRITE', dataSource: 'LOCAL_DB', input: z.strictObject({}),
    summarize: () => 'Stop the running timer and save it as a draft entry.',
  }),
  add_journal_entry: defineTool({
    description: 'Append text to a journal section.',
    permission: 'LOCAL_WRITE', dataSource: 'LOCAL_DB',
    input: z.strictObject({ date, section: z.enum(JOURNAL_SECTIONS), text }),
    summarize: (a) => `Add a note to "${a.section}" in the ${a.date} journal.`,
  }),
  update_journal_entry: defineTool({
    description: 'Replace the text of a journal section.',
    permission: 'LOCAL_WRITE', dataSource: 'LOCAL_DB',
    input: z.strictObject({ date, section: z.enum(JOURNAL_SECTIONS), text }),
    summarize: (a) => `Replace "${a.section}" in the ${a.date} journal.`,
  }),
  accept_time_suggestion: defineTool({
    description: 'Accept a suggestion as a local time entry.',
    permission: 'LOCAL_WRITE', dataSource: 'LOCAL_DB', input: z.strictObject({ suggestionId: id }),
    summarize: (a) => `Accept suggestion ${a.suggestionId} as a time entry.`,
  }),
  ignore_time_suggestion: defineTool({
    description: 'Ignore a suggestion.',
    permission: 'LOCAL_WRITE', dataSource: 'LOCAL_DB', input: z.strictObject({ suggestionId: id }),
    summarize: (a) => `Ignore suggestion ${a.suggestionId}.`,
  }),
  set_reminder_time: defineTool({
    description: 'Change a reminder time.',
    permission: 'LOCAL_WRITE', dataSource: 'LOCAL_DB',
    input: z.strictObject({
      reminder: z.enum(['DAILY', 'CONFIRMATION', 'TOMORROW_SUMMARY', 'MORNING_SUMMARY']),
      time: clockTime,
    }),
    summarize: (a) => `Set the ${a.reminder.toLowerCase().replace('_', ' ')} reminder to ${a.time}.`,
  }),
  enable_notification: defineTool({
    description: 'Enable a notification type.',
    permission: 'LOCAL_WRITE', dataSource: 'LOCAL_DB', input: z.strictObject({ type: z.enum(NOTIFICATION_TYPES) }),
    summarize: (a) => `Enable ${a.type} notifications.`,
  }),
  disable_notification: defineTool({
    description: 'Disable a notification type.',
    permission: 'LOCAL_WRITE', dataSource: 'LOCAL_DB', input: z.strictObject({ type: z.enum(NOTIFICATION_TYPES) }),
    summarize: (a) => `Disable ${a.type} notifications.`,
  }),

  // DANGEROUS_WRITE — always require confirmation
  delete_time_entry: defineTool({
    description: 'Permanently delete one local time entry.',
    permission: 'DANGEROUS_WRITE', dataSource: 'LOCAL_DB', input: z.strictObject({ entryId: id }),
    summarize: (a) => `Permanently delete local time entry ${a.entryId}.`,
  }),
  delete_journal_entry: defineTool({
    description: 'Permanently delete the local journal for a date.',
    permission: 'DANGEROUS_WRITE', dataSource: 'LOCAL_DB', input: z.strictObject({ date }),
    summarize: (a) => `Permanently delete the local journal for ${a.date}.`,
  }),
  mark_leave: defineTool({
    description: 'Mark a day as full or half-day leave.',
    permission: 'DANGEROUS_WRITE', dataSource: 'LOCAL_DB',
    input: z.strictObject({ date, kind: z.enum(['FULL_DAY', 'HALF_DAY']) }),
    summarize: (a) => `Mark ${a.date} as ${a.kind === 'FULL_DAY' ? 'a full day' : 'a half day'} of leave.`,
  }),
  submit_timesheet: defineTool({
    description: 'Submit the local timesheet for a date.',
    permission: 'DANGEROUS_WRITE', dataSource: 'LOCAL_DB', input: z.strictObject({ date }),
    summarize: (a) => `Submit the local timesheet for ${a.date}.`,
  }),
} as const;

export type ToolName = keyof typeof TOOLS;
export type ToolArgs<N extends ToolName> = z.infer<(typeof TOOLS)[N]['input']>;

export const TOOL_NAMES = Object.keys(TOOLS) as ToolName[];

export function isToolName(name: string): name is ToolName {
  return Object.prototype.hasOwnProperty.call(TOOLS, name);
}

/** Tool declaration handed to an AIProvider (name, description, JSON Schema). */
export function toProviderToolSpec(name: ToolName) {
  const t = TOOLS[name];
  return { name, description: t.description, parameters: z.toJSONSchema(t.input) };
}
