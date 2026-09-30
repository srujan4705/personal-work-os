import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatMinutes } from '@pwos/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { addDays } from '../lib/date';
import { Bars, DayColumns } from '../components/Bars';
import { Button, ErrorNote, Input, Loading, PageHeader, Section, Segmented, Stat, StatGrid, buttonClass } from '../components/ui';
import { DraftBox } from './Drafts';

interface Report {
  range: { from: string; to: string };
  loggedMinutes: number;
  expectedMinutes: number;
  missingMinutes: number;
  daysWorked: number;
  averageMinutesPerWorkedDay: number;
  byActivity: { key: string; label: string; minutes: number }[];
  byProject: { key: string; label: string; minutes: number }[];
  byTicket: { workItemId: string; ticketKey: string | null; title: string; minutes: number; isDone: boolean }[];
  byDay: { date: string; loggedMinutes: number; expectedMinutes: number }[];
  focusVsMeetings: { meetingMinutes: number; focusMinutes: number };
  meetings: { observedCount: number; observedMinutes: number };
  ticketsWorked: number;
  ticketsCompleted: { ticketKey: string | null; title: string }[];
  github: { total: number; byType: { type: string; count: number }[] };
  journal: { date: string; accomplished: string | null; pending: string | null; blockers: string | null }[];
}
type Period = 'daily' | 'weekly' | 'monthly';

export function ReportsPage() {
  const { today } = useAuth();
  const [period, setPeriod] = useState<Period>('weekly');
  const [anchor, setAnchor] = useState(today);
  const qs = period === 'daily' ? `date=${anchor}` : period === 'weekly' ? `weekOf=${anchor}` : `month=${anchor.slice(0, 7)}`;
  const q = useQuery({ queryKey: ['report', period, anchor], queryFn: () => api.get<Report>(`/reports/${period}?${qs}`) });
  const standup = useQuery({ queryKey: ['standup'], queryFn: () => api.get<{ text: string; missing: string[] }>('/reports/standup') });
  const step = period === 'daily' ? 1 : period === 'weekly' ? 7 : 31;
  const r = q.data;

  return (
    <div className="space-y-5">
      <PageHeader title="Reports">
        <Segmented label="Report period" options={['daily', 'weekly', 'monthly'] as Period[]} value={period} onChange={setPeriod} />
        <Button variant="ghost" onClick={() => setAnchor(addDays(anchor, -step))} aria-label="Previous">‹</Button>
        <Input type="date" value={anchor} onChange={(e) => e.target.value && setAnchor(e.target.value)} aria-label="Report date" />
        <Button variant="ghost" onClick={() => setAnchor(addDays(anchor, step))} aria-label="Next">›</Button>
        {r && <a className={buttonClass('quiet')} href={`/api/v1/exports/time-entries.csv?from=${r.range.from}&to=${r.range.to}`}>Export CSV</a>}
      </PageHeader>
      {q.isLoading ? <Loading /> : q.error ? <ErrorNote error={q.error} /> : r && (
        <>
          <section className="glass panel p-5">
            <p className="mb-3 text-sm text-graphite num">{r.range.from} → {r.range.to}</p>
            <StatGrid>
              <Stat accent value={formatMinutes(r.loggedMinutes)} label={`logged of ${formatMinutes(r.expectedMinutes)}`} />
              <Stat value={r.daysWorked} label="day(s) with time" />
              <Stat value={formatMinutes(r.averageMinutesPerWorkedDay)} label="average per day worked" />
              <Stat value={r.ticketsWorked} label={`tickets · ${r.ticketsCompleted.length} completed`} />
              <Stat value={r.github.total} label="GitHub activities (observed)" />
            </StatGrid>
            {r.missingMinutes > 0 && <p className="mt-3 text-sm text-suggested">{formatMinutes(r.missingMinutes)} below expected.</p>}
          </section>
          <div className="grid gap-5 md:grid-cols-2">
            {period !== 'daily' && <Section title="Time by day"><DayColumns days={r.byDay} /></Section>}
            <Section title="Focus vs meetings">
              <Bars rows={[{ key: 'f', label: 'Focus work', minutes: r.focusVsMeetings.focusMinutes }, { key: 'm', label: 'Meetings (logged)', minutes: r.focusVsMeetings.meetingMinutes }]} total={r.loggedMinutes} />
              <p className="mt-2 text-xs text-graphite">Calendar shows {r.meetings.observedCount} meeting(s), {formatMinutes(r.meetings.observedMinutes)} scheduled.</p>
            </Section>
            <Section title="By activity"><Bars rows={r.byActivity} total={r.loggedMinutes} /></Section>
            <Section title="By project"><Bars rows={r.byProject} total={r.loggedMinutes} /></Section>
            <Section title="By ticket" className="md:col-span-2"><Bars rows={r.byTicket.map((t) => ({ key: t.workItemId, label: `${t.ticketKey ?? ''} ${t.title}`.trim(), minutes: t.minutes }))} total={r.loggedMinutes} max={12} /></Section>
          </div>
          {period === 'weekly' && (
            <div className="grid gap-5 md:grid-cols-2">
              <Section title="Weekly summary"><DraftBox key={`s${r.range.from}`} kind="weekly_summary" params={{ weekOf: r.range.from }} initial={r.journal.map((j) => j.accomplished).filter(Boolean).join('\n')} /></Section>
              <Section title="Next week’s focus"><DraftBox key={`n${r.range.from}`} kind="next_week_focus" params={{ weekOf: r.range.from }} initial={r.journal.map((j) => j.pending).filter(Boolean).join('\n')} /></Section>
            </div>
          )}
        </>
      )}
      <Section title="Standup">
        {standup.data ? (
          <>
            {standup.data.missing.length > 0 && <p className="mb-2 text-xs text-graphite">Missing: {standup.data.missing.join(' ')}</p>}
            <DraftBox key={standup.data.text} kind="standup" initial={standup.data.text} />
          </>
        ) : <Loading />}
      </Section>
    </div>
  );
}
