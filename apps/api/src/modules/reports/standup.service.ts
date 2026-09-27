import { formatMinutes, titleCase } from '@pwos/shared';
import { prisma } from '../../lib/prisma';
import { addDays, dateToDb, isoWeekday, localTime } from '../../lib/time';
import { getUserContext, isWorkingDay, today } from '../settings/settings.service';
import { eventsForDate } from '../calendar/calendar.service';
import { currentSprint, isDone } from '../work/work.service';
import { sprintReport } from './report.service';

const lines = (text: string | null | undefined) => (text ?? '').split('\n').map((l) => l.replace(/^[-*•]\s*/, '').trim()).filter(Boolean);

/** Factual standup from local data. Missing information is reported as missing — nothing is invented. */
export async function generateStandup(userId: string, date?: string, now = new Date()) {
  const ctx = await getUserContext(userId);
  const day = date ?? today(ctx, now);
  let prev = addDays(day, -1);
  for (let i = 0; i < 7 && !isWorkingDay(ctx.settings, isoWeekday(prev)); i++) prev = addDays(prev, -1);

  const [entries, prevJournal, todayJournal, meetings, sprint] = await Promise.all([
    prisma.timeEntry.findMany({ where: { userId, timesheet: { date: dateToDb(prev) } }, include: { workItem: { select: { id: true, ticketKey: true, title: true } } } }),
    prisma.journalEntry.findUnique({ where: { userId_date: { userId, date: dateToDb(prev) } } }),
    prisma.journalEntry.findUnique({ where: { userId_date: { userId, date: dateToDb(day) } } }),
    eventsForDate(userId, day, ctx.tz),
    currentSprint(userId),
  ]);

  const grouped = new Map<string, { label: string; minutes: number; activities: Set<string> }>();
  for (const e of entries) {
    const key = e.workItem?.id ?? `${e.activityType}:${e.description ?? ''}`;
    const label = e.workItem ? `${e.workItem.ticketKey ?? ''} ${e.workItem.title}`.trim() : e.description || titleCase(e.activityType);
    const g = grouped.get(key) ?? { label, minutes: 0, activities: new Set<string>() };
    g.minutes += e.durationMinutes;
    g.activities.add(titleCase(e.activityType).toLowerCase());
    grouped.set(key, g);
  }
  const yesterday = [
    ...[...grouped.values()].sort((a, b) => b.minutes - a.minutes).map((g) => `${g.label} (${formatMinutes(g.minutes)}, ${[...g.activities].join(', ')})`),
    ...lines(prevJournal?.accomplished).map((l) => `${l} (journal)`),
  ];

  const openTickets = sprint
    ? (await prisma.workItem.findMany({ where: { userId, sprintId: sprint.id, isAssignedToMe: true }, take: 20 })).filter((w) => !isDone(w)).slice(0, 5)
    : [];
  const todayItems = [
    ...lines(prevJournal?.tomorrow).map((l) => `${l} (planned yesterday)`),
    ...meetings.filter((m) => !m.isAllDay).map((m) => `${localTime(m.startAt, ctx.tz)} ${m.title} (meeting)`),
    ...openTickets.map((w) => `${w.ticketKey ?? ''} ${w.title} (open in ${sprint!.name})`.trim()),
  ];
  const blockers = [...lines(todayJournal?.blockers), ...lines(prevJournal?.blockers)];

  const missing: string[] = [];
  if (!entries.length) missing.push(`No time entries were logged for ${prev}.`);
  if (!prevJournal) missing.push(`No journal entry for ${prev}.`);
  if (!prevJournal?.tomorrow) missing.push('No plan for today was recorded in yesterday\'s journal.');
  if (!blockers.length) missing.push('No blockers recorded.');

  const section = (title: string, items: string[], empty: string) => `${title}\n${items.length ? items.map((i) => `• ${i}`).join('\n') : `• ${empty}`}`;
  const text = [
    section(`Yesterday (${prev})`, yesterday, 'No recorded work.'),
    section('Today', todayItems, 'Nothing planned yet.'),
    section('Blockers', blockers, 'None recorded.'),
  ].join('\n\n');

  return { date: day, previousWorkingDay: prev, sections: { yesterday, today: todayItems, blockers }, missing, text };
}

/** Factual retrospective scaffold. Answers are for the user (optionally AI-drafted) to edit. */
export async function generateRetrospective(userId: string, sprintRef?: string) {
  const report = await sprintReport(userId, sprintRef);
  const hints = {
    wentWell: [
      `${report.ticketSummary.completed} of ${report.ticketSummary.total} sprint tickets completed (per Zoho snapshot).`,
      ...report.journalHighlights.accomplishments.slice(0, 5).map((a) => `${a.date}: ${a.text}`),
    ],
    difficult: report.journalHighlights.blockers.map((b) => `${b.date}: ${b.text}`),
    continue: report.byActivity.slice(0, 3).map((a) => `${titleCase(a.label)}: ${formatMinutes(a.minutes)}`),
    improve: [
      `Meetings took ${formatMinutes(report.focusVsMeetings.meetingMinutes)} of ${formatMinutes(report.loggedMinutes)} logged.`,
      ...(report.missingMinutes > 0 ? [`${formatMinutes(report.missingMinutes)} below expected time.`] : []),
    ],
    carryForward: report.tickets.filter((t) => t.carriedForward || (!t.completed && t.isAssignedToMe)).map((t) => `${t.ticketKey ?? ''} ${t.title}`.trim()),
  };
  return {
    sprint: report.sprint,
    metrics: {
      loggedMinutes: report.loggedMinutes, expectedMinutes: report.expectedMinutes, meetingMinutes: report.focusVsMeetings.meetingMinutes,
      ticketsWorked: report.ticketsWorked, ticketSummary: report.ticketSummary, githubActivities: report.github.total, byActivity: report.byActivity,
    },
    prompts: [
      { key: 'wentWell', question: 'What went well?', hints: hints.wentWell },
      { key: 'difficult', question: 'What was difficult?', hints: hints.difficult },
      { key: 'continue', question: 'What should I continue?', hints: hints.continue },
      { key: 'improve', question: 'What should I improve?', hints: hints.improve },
      { key: 'carryForward', question: 'What should I carry forward?', hints: hints.carryForward },
    ],
  };
}
