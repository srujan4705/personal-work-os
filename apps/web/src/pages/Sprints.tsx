import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { formatMinutes, titleCase } from '@pwos/shared';
import { api } from '../lib/api';
import { Bars, DayColumns } from '../components/Bars';
import { Empty, ErrorNote, Loading, PageHeader, Section, Select, Stat, StatGrid, Tag } from '../components/ui';
import { DraftBox } from './Drafts';

interface SprintRow { id: string; name: string; status: string; projectName: string; startDate: string | null; endDate: string | null; workItemCount: number }
interface SprintReport {
  sprint: { id: string; name: string; goal: string | null; status: string; startDate: string; endDate: string };
  loggedMinutes: number;
  expectedMinutes: number;
  byActivity: { key: string; label: string; minutes: number }[];
  byTicket: { workItemId: string; ticketKey: string | null; title: string; minutes: number }[];
  byDay: { date: string; loggedMinutes: number; expectedMinutes: number }[];
  focusVsMeetings: { meetingMinutes: number; focusMinutes: number };
  github: { total: number };
  tickets: { id: string; ticketKey: string | null; title: string; status: string | null; worked: boolean; completed: boolean; carriedForward: boolean; loggedMinutes: number }[];
  ticketSummary: { total: number; worked: number; completed: number; carriedForward: number };
  journalHighlights: { accomplishments: { date: string; text: string }[]; blockers: { date: string; text: string }[] };
}
interface Retro { prompts: { key: string; question: string; hints: string[] }[] }

export function SprintsPage() {
  const sprints = useQuery({ queryKey: ['sprints'], queryFn: () => api.get<SprintRow[]>('/sprints') });
  const [selected, setSelected] = useState('');
  const current = selected || sprints.data?.find((s) => s.status === 'ACTIVE')?.id || sprints.data?.[0]?.id || '';
  const report = useQuery({ queryKey: ['sprint-report', current], queryFn: () => api.get<SprintReport>(`/reports/sprint?sprint=${current}`), enabled: !!current });
  const retro = useQuery({ queryKey: ['retro', current], queryFn: () => api.get<Retro>(`/reports/retrospective?sprint=${current}`), enabled: !!current });

  if (sprints.isLoading) return <Loading />;
  if (!sprints.data?.length) return <><PageHeader title="Sprints" /><Empty title="No sprints synced yet">Connect Zoho Sprints in Settings to see sprint reports.</Empty></>;
  const r = report.data;
  const retroText = retro.data?.prompts.map((p) => `${p.question}\n${p.hints.map((h) => `• ${h}`).join('\n') || '• '}`).join('\n\n') ?? '';

  return (
    <div className="space-y-5">
      <PageHeader title="Sprints">
        <Select value={current} onChange={(e) => setSelected(e.target.value)} aria-label="Sprint">
          {sprints.data.map((s) => <option key={s.id} value={s.id}>{s.name} ({titleCase(s.status)})</option>)}
        </Select>
      </PageHeader>
      {report.isLoading ? <Loading /> : report.error ? <ErrorNote error={report.error} /> : r && (
        <>
          <section className="glass panel p-5">
            <p className="mb-3 text-sm text-graphite">{r.sprint.startDate} → {r.sprint.endDate}{r.sprint.goal ? ` · Goal: ${r.sprint.goal}` : ''}</p>
            <StatGrid>
              <Stat accent value={formatMinutes(r.loggedMinutes)} label="logged" />
              <Stat value={`${r.ticketSummary.completed}/${r.ticketSummary.total}`} label="tickets completed" />
              <Stat value={r.ticketSummary.carriedForward} label="carried forward" />
              <Stat value={formatMinutes(r.focusVsMeetings.meetingMinutes)} label="meetings" />
              <Stat value={r.github.total} label="GitHub activities" />
            </StatGrid>
          </section>
          <div className="grid gap-5 md:grid-cols-2">
            <Section title="Time by day"><DayColumns days={r.byDay} /></Section>
            <Section title="Time by activity"><Bars rows={r.byActivity} total={r.loggedMinutes} /></Section>
          </div>
          <Section title="Tickets in this sprint">
            <ul className="divide-y divide-rule/70 text-sm">
              {r.tickets.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-2 py-2">
                  <Link to={`/work/${t.id}`} className="min-w-0 flex-1 truncate transition-colors hover:text-accent-1"><b className="font-display font-semibold">{t.ticketKey}</b> {t.title}</Link>
                  {t.completed && <Tag tone="good">Completed</Tag>}
                  {t.carriedForward && <Tag tone="warn">Carried forward</Tag>}
                  {!t.worked && <Tag>Not worked</Tag>}
                  <span className="w-16 text-right num text-graphite">{t.loggedMinutes ? formatMinutes(t.loggedMinutes) : ''}</span>
                </li>
              ))}
            </ul>
          </Section>
          <Section title="Retrospective">
            <p className="mb-2 text-sm text-graphite">Starting points come from your logged time, tickets and journal. Edit freely.</p>
            {retro.data && <DraftBox key={current} kind="retrospective" params={{ sprint: current }} initial={retroText} rows={14} />}
          </Section>
        </>
      )}
    </div>
  );
}
