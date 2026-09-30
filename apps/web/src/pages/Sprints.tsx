import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatMinutes, titleCase } from '@pwos/shared';
import { api } from '../lib/api';
import { Bars, DayColumns } from '../components/Bars';
import { Button, Empty, ErrorNote, Field, Input, Loading, PageHeader, Section, Select, Stat, StatGrid, Tag } from '../components/ui';
import { DraftBox } from './Drafts';

interface SprintRow { id: string; name: string; status: string; provider: string; projectName: string; startDate: string | null; endDate: string | null; workItemCount: number }
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

function NewSprintForm({ onDone }: { onDone: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', goal: '', startDate: '', endDate: '' });
  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: () => api.post<{ id: string }>('/sprints/manual', { name: form.name, goal: form.goal || undefined, startDate: form.startDate || undefined, endDate: form.endDate || undefined }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['sprints'] }); setOpen(false); setForm({ name: '', goal: '', startDate: '', endDate: '' }); onDone(r.id); },
  });
  if (!open) return <Button onClick={() => setOpen(true)}>+ New sprint</Button>;
  return (
    <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="glass panel grid gap-2 p-4 sm:grid-cols-5">
      <div className="sm:col-span-2"><Field label="Name"><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field></div>
      <Field label="Start" hint="optional"><Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></Field>
      <Field label="End" hint="optional"><Input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></Field>
      <div className="flex items-end gap-2">
        <Button variant="primary" type="submit" disabled={create.isPending}>Create</Button>
        <Button type="button" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
      <div className="sm:col-span-5"><Field label="Goal" hint="optional"><Input value={form.goal} onChange={(e) => setForm({ ...form, goal: e.target.value })} /></Field></div>
      <ErrorNote error={create.error} />
    </form>
  );
}

/** Shown only for provider === 'MANUAL' sprints — everything else (Jira/Zoho) is sync-owned and read-only here. */
function ManualSprintTickets({ sprintId, onChanged }: { sprintId: string; onChanged: () => void }) {
  const unassigned = useQuery({ queryKey: ['unassigned-tickets'], queryFn: () => api.get<{ id: string; ticketKey: string | null; title: string }[]>('/sprints/unassigned-tickets') });
  const [pick, setPick] = useState('');
  const [newTicket, setNewTicket] = useState({ ticketKey: '', title: '' });
  const qc = useQueryClient();
  const after = () => { qc.invalidateQueries({ queryKey: ['sprints'] }); qc.invalidateQueries({ queryKey: ['sprint-report', sprintId] }); qc.invalidateQueries({ queryKey: ['unassigned-tickets'] }); onChanged(); };
  const assign = useMutation({ mutationFn: () => api.post(`/sprints/manual/${sprintId}/items/assign`, { workItemId: pick }), onSuccess: () => { setPick(''); after(); } });
  const addNew = useMutation({ mutationFn: () => api.post(`/sprints/manual/${sprintId}/items/new`, { title: newTicket.title, ticketKey: newTicket.ticketKey || undefined }), onSuccess: () => { setNewTicket({ ticketKey: '', title: '' }); after(); } });

  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-rule/70 pt-3 sm:flex-row">
      <form onSubmit={(e) => { e.preventDefault(); if (pick) assign.mutate(); }} className="flex flex-1 items-end gap-2">
        <Field label="Add an existing ticket">
          <Select value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Choose a ticket…</option>
            {unassigned.data?.map((t) => <option key={t.id} value={t.id}>{t.ticketKey ?? t.title}</option>)}
          </Select>
        </Field>
        <Button type="submit" disabled={!pick || assign.isPending}>Add</Button>
      </form>
      <form onSubmit={(e) => { e.preventDefault(); if (newTicket.title.trim()) addNew.mutate(); }} className="flex flex-1 items-end gap-2">
        <div className="w-20"><Field label="Key" hint="optional"><Input value={newTicket.ticketKey} onChange={(e) => setNewTicket({ ...newTicket, ticketKey: e.target.value })} /></Field></div>
        <div className="flex-1"><Field label="New ticket, not in Jira"><Input value={newTicket.title} onChange={(e) => setNewTicket({ ...newTicket, title: e.target.value })} /></Field></div>
        <Button type="submit" disabled={!newTicket.title.trim() || addNew.isPending}>Add</Button>
      </form>
    </div>
  );
}

export function SprintsPage() {
  const qc = useQueryClient();
  const sprints = useQuery({ queryKey: ['sprints'], queryFn: () => api.get<SprintRow[]>('/sprints') });
  const [selected, setSelected] = useState('');
  const current = selected || sprints.data?.find((s) => s.status === 'ACTIVE')?.id || sprints.data?.[0]?.id || '';
  const report = useQuery({ queryKey: ['sprint-report', current], queryFn: () => api.get<SprintReport>(`/reports/sprint?sprint=${current}`), enabled: !!current });
  const retro = useQuery({ queryKey: ['retro', current], queryFn: () => api.get<Retro>(`/reports/retrospective?sprint=${current}`), enabled: !!current });
  const removeItem = useMutation({
    mutationFn: (workItemId: string) => api.del(`/sprints/manual/${current}/items/${workItemId}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sprints'] }); qc.invalidateQueries({ queryKey: ['sprint-report', current] }); qc.invalidateQueries({ queryKey: ['unassigned-tickets'] }); },
  });
  const deleteSprint = useMutation({
    mutationFn: () => api.del(`/sprints/manual/${current}`),
    onSuccess: () => { setSelected(''); qc.invalidateQueries({ queryKey: ['sprints'] }); },
  });

  if (sprints.isLoading) return <Loading />;
  const currentRow = sprints.data?.find((s) => s.id === current);
  const isManual = currentRow?.provider === 'MANUAL';

  if (!sprints.data?.length) {
    return (
      <div className="space-y-5">
        <PageHeader title="Sprints" />
        <Empty title="No sprints yet">Connect Jira or Zoho Sprints in Settings, or create your own below.</Empty>
        <NewSprintForm onDone={setSelected} />
      </div>
    );
  }
  const r = report.data;
  const retroText = retro.data?.prompts.map((p) => `${p.question}\n${p.hints.map((h) => `• ${h}`).join('\n') || '• '}`).join('\n\n') ?? '';

  return (
    <div className="space-y-5">
      <PageHeader title="Sprints">
        <Select value={current} onChange={(e) => setSelected(e.target.value)} aria-label="Sprint">
          {sprints.data.map((s) => <option key={s.id} value={s.id}>{s.name} ({titleCase(s.status)}){s.provider === 'MANUAL' ? ' · Manual' : ''}</option>)}
        </Select>
        <NewSprintForm onDone={setSelected} />
        {isManual && <Button variant="danger" onClick={() => window.confirm(`Delete "${currentRow?.name}"? Synced tickets in it are kept, just unassigned.`) && deleteSprint.mutate()}>Delete sprint</Button>}
      </PageHeader>
      {report.isLoading ? <Loading /> : report.error ? <ErrorNote error={report.error} /> : r && (
        <>
          <section className="glass panel p-5">
            <p className="mb-3 flex items-center gap-2 text-sm text-graphite">
              {isManual && <Tag>Manual</Tag>}
              {r.sprint.startDate} → {r.sprint.endDate}{r.sprint.goal ? ` · Goal: ${r.sprint.goal}` : ''}
            </p>
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
                  {isManual && <Button variant="ghost" onClick={() => removeItem.mutate(t.id)} aria-label={`Remove ${t.ticketKey ?? t.title} from this sprint`}>Remove</Button>}
                </li>
              ))}
              {!r.tickets.length && <li className="py-2 text-graphite">No tickets in this sprint yet.</li>}
            </ul>
            {isManual && <ManualSprintTickets sprintId={current} onChanged={() => report.refetch()} />}
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
