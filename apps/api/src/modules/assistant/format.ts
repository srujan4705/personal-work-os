import { formatMinutes, titleCase } from '@pwos/shared';
import type { ToolName } from '@pwos/ai-contracts';

type AnyObj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Plain-text renderings of tool results, used when AI is off and for Telegram commands. */
export function formatToolResult(name: ToolName, data: unknown): string {
  const d = data as AnyObj;
  switch (name) {
    case 'get_today_summary': {
      const lines = [`Today (${d.date}): ${formatMinutes(d.summary.loggedMinutes)} logged of ${formatMinutes(d.summary.expectedMinutes)} expected · timesheet ${String(d.status).toLowerCase()}.`];
      if (d.timer) lines.push(`Timer ${d.timer.status.toLowerCase()}: ${formatMinutes(d.timer.elapsedMinutes)}${d.timer.ticket ? ` on ${d.timer.ticket}` : ''}.`);
      if (d.entries.length) lines.push('Logged:', ...d.entries.map((e: AnyObj) => `• ${e.ticket ?? titleCase(e.activity)} — ${formatMinutes(e.minutes)}`));
      lines.push(d.meetings.length ? `Meetings: ${d.meetings.length}` : 'No meetings today.');
      if (d.pendingSuggestions.length) lines.push(`${d.pendingSuggestions.length} suggestion(s) waiting for review.`);
      if (d.possibleUntrackedWork.length) lines.push(...d.possibleUntrackedWork.map((g: string) => `• ${g}`));
      return lines.join('\n');
    }
    case 'get_timesheet':
      return [
        `Timesheet ${d.timesheet.date} (${String(d.timesheet.status).toLowerCase()}): ${formatMinutes(d.summary.loggedMinutes)} of ${formatMinutes(d.summary.expectedMinutes)}, ${formatMinutes(d.summary.remainingMinutes)} remaining.`,
        ...d.entries.map((e: AnyObj) => `• ${e.startTime ? `${e.startTime} ` : ''}${e.ticketKey ?? ''} ${titleCase(e.activityType)} — ${formatMinutes(e.durationMinutes)}${e.description ? ` (${e.description})` : ''}`.replace(/\s+/g, ' ')),
        ...d.issues.map((i: AnyObj) => `${i.level === 'error' ? '✖' : '⚠'} ${i.message}`),
      ].join('\n');
    case 'get_tomorrow_schedule':
      return d.count
        ? [`Tomorrow (${d.date}): ${d.count} meeting(s), ${formatMinutes(d.totalMinutes)} total.`, ...d.meetings.map((m: AnyObj) => `• ${m.start}–${m.end} ${m.title}`)].join('\n')
        : `No meetings scheduled for tomorrow (${d.date}).`;
    case 'get_current_sprint':
      if (!d.sprint) return d.message;
      return [`${d.sprint.name}${d.sprint.goal ? ` — ${d.sprint.goal}` : ''}`, ...d.myItems.map((i: AnyObj) => `• ${i.done ? '✓' : '○'} ${i.ticket ?? ''} ${i.title} (${i.status ?? 'no status'})`)].join('\n');
    case 'get_weekly_report':
    case 'get_monthly_report':
    case 'get_sprint_report':
      return [
        `${d.sprint ? d.sprint.name : `${d.range.from} → ${d.range.to}`}: ${formatMinutes(d.loggedMinutes)} logged of ${formatMinutes(d.expectedMinutes)} expected.`,
        `Tickets worked: ${d.ticketsWorked}; completed: ${d.ticketsCompleted.length}. Meetings logged: ${formatMinutes(d.focusVsMeetings.meetingMinutes)}. GitHub activities (observed): ${d.github.total}.`,
        ...d.byTicket.slice(0, 8).map((t: AnyObj) => `• ${t.ticketKey ?? ''} ${t.title} — ${formatMinutes(t.minutes)}`),
      ].join('\n');
    case 'generate_standup':
      return d.missing.length ? `${d.text}\n\nMissing: ${d.missing.join(' ')}` : d.text;
    case 'find_unlogged_work':
      return d.gaps.length ? d.gaps.map((g: AnyObj) => `• ${g.message}${g.observed.length ? ` Observed: ${g.observed.map((o: AnyObj) => `${o.at} ${o.label}`).join('; ')}` : ''}`).join('\n') : `No untracked gaps found for ${d.date}.`;
    case 'get_ticket_history':
      return `${d.workItem.ticketKey ?? ''} ${d.workItem.title}: ${formatMinutes(d.totalLoggedMinutes)} over ${d.sessions} session(s)${d.firstWorkDate ? `, ${d.firstWorkDate} → ${d.lastWorkDate}` : ''}.`;
    case 'add_time_entry':
    case 'update_time_entry':
      return `Saved: ${d.ticketKey ?? titleCase(d.activityType)} — ${formatMinutes(d.durationMinutes)}.`;
    case 'stop_timer':
      return `Timer stopped: ${formatMinutes(d.minutes)} saved as a draft entry.`;
    case 'start_timer':
      return `Timer started${d.ticketKey ? ` for ${d.ticketKey}` : ''}.`;
    default:
      return 'Done.';
  }
}
