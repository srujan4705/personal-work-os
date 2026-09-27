import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatMinutes, titleCase } from '@pwos/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { prettyDate } from '../lib/date';
import type { Gap, Suggestion, TimelineItem, Timer } from '../lib/types';
import { DayStrip } from '../components/DayStrip';
import { TimerWidget } from '../components/TimerWidget';
import { Button, Empty, ErrorNote, LabelChip, Loading, Section, Tag } from '../components/ui';

interface Dashboard {
  greeting: string;
  name: string;
  date: string;
  timesheet: { loggedMinutes: number; expectedMinutes: number; remainingMinutes: number; status: string; dayType: string; entriesCount: number };
  timer: Timer | null;
  meetings: { id: string; title: string; startTime: string; endTime: string; meetingUrl: string | null }[];
  nextMeeting: { title: string; startTime: string; meetingUrl: string | null } | null;
  currentSprint: { id: string; name: string; goal: string | null; endDate: string | null } | null;
  openTickets: number;
  suggestions: Suggestion[];
  possibleMissingWork: Gap[];
  journal: { status: 'NOT_STARTED' | 'STARTED' | 'FILLED' };
  recentActivity: { kind: string; label: 'CONFIRMED' | 'OBSERVED'; title: string; at: string; minutes: number | null }[];
  integrations: { zoho: string; github: string };
  showCloseOut: boolean;
}

export function SuggestionList({ suggestions }: { suggestions: Suggestion[] }) {
  const qc = useQueryClient();
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'accept' | 'ignore' }) => api.post(`/suggestions/${id}/${action}`),
    onSuccess: () => qc.invalidateQueries(),
  });
  if (!suggestions.length) return <p className="text-sm text-graphite">No suggestions waiting. Meetings and GitHub activity show up here after a sync.</p>;
  return (
    <ul className="divide-y divide-rule">
      {suggestions.map((s) => (
        <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm"><LabelChip label="SUGGESTED" /><span className="truncate font-bold">{s.description ?? titleCase(s.activityType)}</span></p>
            <p className="text-xs text-graphite num">
              {s.startTime ? `${s.startTime}–${s.endTime} · ` : ''}{s.durationMinutes ? formatMinutes(s.durationMinutes) : 'duration unknown'} · from {s.source.toLowerCase()}
            </p>
            {s.evidence?.basis && <p className="text-xs text-graphite">{s.evidence.basis}</p>}
          </div>
          <div className="flex gap-1.5">
            <Button variant="primary" onClick={() => act.mutate({ id: s.id, action: 'accept' })}>Add to timesheet</Button>
            <Button variant="ghost" onClick={() => act.mutate({ id: s.id, action: 'ignore' })}>Ignore</Button>
          </div>
        </li>
      ))}
      <ErrorNote error={act.error} />
    </ul>
  );
}

export function DashboardPage() {
  const { today } = useAuth();
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<Dashboard>('/dashboard'), refetchInterval: 120_000 });
  const timeline = useQuery({ queryKey: ['timeline', today], queryFn: () => api.get<{ items: TimelineItem[] }>(`/timeline/${today}`), enabled: !!today });
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.get<{ workStartTime: string; workEndTime: string }>('/settings') });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorNote error={q.error} />;
  const d = q.data;
  const pct = d.timesheet.expectedMinutes ? Math.min(100, (d.timesheet.loggedMinutes / d.timesheet.expectedMinutes) * 100) : 0;
  const nowHm = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: undefined }).format(new Date());

  return (
    <div className="space-y-5">
      <header>
        <p className="text-sm text-graphite">{prettyDate(d.date)}</p>
        <h1 className="text-2xl font-bold tracking-tight">{d.greeting}, {d.name}.</h1>
      </header>

      <section aria-label="Today at a glance" className="rounded-lg border border-rule bg-sheet p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <p className="text-lg">
            <span className="text-3xl font-bold num">{formatMinutes(d.timesheet.loggedMinutes)}</span>
            <span className="text-graphite"> logged of {formatMinutes(d.timesheet.expectedMinutes)}</span>
            {d.timesheet.remainingMinutes > 0 && <span className="text-graphite"> · {formatMinutes(d.timesheet.remainingMinutes)} to go</span>}
          </p>
          <div className="flex items-center gap-2">
            <Tag tone={d.timesheet.status === 'SUBMITTED' ? 'good' : 'neutral'}>{d.timesheet.status === 'DRAFT' ? 'Draft' : titleCase(d.timesheet.status)}</Tag>
            {d.timesheet.dayType !== 'WORKDAY' && <Tag tone="warn">{titleCase(d.timesheet.dayType)}</Tag>}
            <Link to="/timesheet" className="text-sm font-bold underline-offset-2 hover:underline">Open timesheet</Link>
          </div>
        </div>
        <div className="mt-2 h-1.5 rounded-full bg-rule"><div className="h-full rounded-full bg-confirmed" style={{ width: `${pct}%` }} /></div>
        <div className="mt-4">
          <DayStrip
            items={(timeline.data?.items ?? []).map((i) => ({ id: i.id, label: i.kind === 'MEETING' ? 'EXTERNAL' : i.label, start: i.time, end: i.endTime, title: i.title }))}
            workStart={settings.data?.workStartTime}
            workEnd={settings.data?.workEndTime}
            now={nowHm}
          />
        </div>
      </section>

      {d.showCloseOut && d.timesheet.status === 'DRAFT' && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-ink px-4 py-3 text-paper">
          <p className="text-sm">Your working day is nearly over. Review and close it out.</p>
          <Link to="/close-out" className="rounded-md bg-paper px-3 py-1.5 text-sm font-bold text-ink">Close out today</Link>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[3fr_2fr]">
        <div className="min-w-0 space-y-5">
          <Section title="Timer"><TimerWidget /></Section>
          <Section title="Waiting for review" action={<span className="text-xs text-graphite">{d.suggestions.length} suggestion(s)</span>}>
            <SuggestionList suggestions={d.suggestions} />
            {d.possibleMissingWork.length > 0 && (
              <div className="mt-3 space-y-1 border-t border-rule pt-3">
                {d.possibleMissingWork.map((g) => (
                  <p key={g.start} className="text-sm"><span className="font-bold">{g.message}</span>{g.observed.length > 0 && <span className="text-graphite"> Observed: {g.observed.map((o) => `${o.at} ${o.label}`).join('; ')}</span>}</p>
                ))}
              </div>
            )}
          </Section>
        </div>
        <div className="min-w-0 space-y-5">
          <Section title="Meetings today">
            {d.nextMeeting && (
              <p className="mb-2 text-sm">Next: <span className="font-bold">{d.nextMeeting.startTime} {d.nextMeeting.title}</span>{d.nextMeeting.meetingUrl && <> · <a className="underline" href={d.nextMeeting.meetingUrl} target="_blank" rel="noreferrer noopener">Join</a></>}</p>
            )}
            {d.meetings.length ? (
              <ul className="space-y-1 text-sm">{d.meetings.map((m) => <li key={m.id} className="flex gap-2"><span className="num text-graphite">{m.startTime}</span><span className="truncate">{m.title}</span></li>)}</ul>
            ) : <p className="text-sm text-graphite">No meetings today.</p>}
          </Section>
          <Section title="Work">
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              <dt className="text-graphite">Sprint</dt><dd>{d.currentSprint ? <Link className="font-bold hover:underline" to="/sprints">{d.currentSprint.name}</Link> : 'None active'}</dd>
              <dt className="text-graphite">Open tickets</dt><dd className="num"><Link className="hover:underline" to="/work">{d.openTickets}</Link></dd>
              <dt className="text-graphite">Journal</dt><dd><Link className="hover:underline" to="/journal">{d.journal.status === 'FILLED' ? 'Written' : d.journal.status === 'STARTED' ? 'Started' : 'Not started'}</Link></dd>
              <dt className="text-graphite">Zoho</dt><dd>{titleCase(d.integrations.zoho)}</dd>
              <dt className="text-graphite">GitHub</dt><dd>{titleCase(d.integrations.github)}</dd>
            </dl>
          </Section>
          <Section title="Recent activity">
            {d.recentActivity.length ? (
              <ul className="space-y-1.5 text-sm">
                {d.recentActivity.map((a, i) => <li key={i} className="flex items-start gap-2"><LabelChip label={a.label} /><span className="min-w-0 flex-1 truncate">{a.title}</span>{a.minutes && <span className="num text-graphite">{formatMinutes(a.minutes)}</span>}</li>)}
              </ul>
            ) : <Empty title="Nothing yet">Log your first entry on the timesheet.</Empty>}
          </Section>
        </div>
      </div>
    </div>
  );
}
