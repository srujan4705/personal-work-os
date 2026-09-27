import type { NotificationType } from '@pwos/shared';

/**
 * Message templates. Edit this file to customise wording for every channel.
 * Keep them factual: they are built from local data only.
 */
export interface NotificationMessage {
  type: NotificationType;
  title: string;
  body: string;
  url?: string | null;
  actionLabel?: string | null;
}

export const templates = {
  meetingReminder: (m: { title: string; startTime: string; minutes: number; meetingUrl: string | null }): Omit<NotificationMessage, 'type'> => ({
    title: `Meeting in ${m.minutes} min: ${m.title}`,
    body: `${m.title} starts at ${m.startTime}.`,
    url: m.meetingUrl,
    actionLabel: m.meetingUrl ? 'Join meeting' : null,
  }),
  tomorrowSchedule: (lines: string[]) => ({
    title: 'Tomorrow’s schedule',
    body: lines.length ? lines.join('\n') : 'No meetings scheduled for tomorrow.',
  }),
  morningSummary: (m: { meetings: string[]; expected: string; openTickets: number }) => ({
    title: 'Good morning',
    body: [`Expected today: ${m.expected}.`, `Open tickets: ${m.openTickets}.`, m.meetings.length ? `Meetings:\n${m.meetings.join('\n')}` : 'No meetings today.'].join('\n'),
  }),
  timesheetReminder: (m: { logged: string; expected: string }) => ({
    title: 'Timesheet reminder',
    body: `You have logged ${m.logged} of ${m.expected} today. Add missing work before closing out.`,
  }),
  timesheetConfirmation: (m: { logged: string; entries: number }) => ({
    title: 'Confirm today’s timesheet',
    body: `${m.entries} entr${m.entries === 1 ? 'y' : 'ies'}, ${m.logged} logged. Review and submit (locally) when ready.`,
  }),
  timesheetOverdue: (m: { date: string; logged: string }) => ({
    title: 'Timesheet not submitted',
    body: `The timesheet for ${m.date} is still a draft (${m.logged} logged).`,
  }),
  weeklySummary: (m: { logged: string; expected: string; tickets: number; meetings: string }) => ({
    title: 'Weekly summary',
    body: `This week: ${m.logged} logged of ${m.expected} expected, ${m.tickets} tickets worked, ${m.meetings} in meetings.`,
  }),
  sprintReportReady: (m: { name: string }) => ({ title: 'Sprint report ready', body: `${m.name} ends today. Your sprint report and retrospective prompts are ready.` }),
  syncFailure: (m: { resource: string; message: string }) => ({ title: 'Sync problem', body: `Sync of ${m.resource} failed: ${m.message}. Your local data is safe.` }),
};
