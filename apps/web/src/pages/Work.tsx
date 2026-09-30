import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatMinutes, titleCase } from '@pwos/shared';
import { api } from '../lib/api';
import { Button, Empty, ErrorNote, Field, Input, LabelChip, Loading, PageHeader, Section, Select, Stat, Tag, Textarea } from '../components/ui';

interface WorkItem {
  id: string;
  ticketKey: string | null;
  title: string;
  status: string | null;
  priority: string | null;
  isDone: boolean;
  projectName: string | null;
  sprintName: string | null;
  externalUrl: string | null;
  dueDate: string | null;
  personalStatus: string | null;
  labels: string[];
  loggedMinutes: number;
}

export function WorkPage() {
  const [q, setQ] = useState('');
  const [state, setState] = useState('open');
  const [assigned, setAssigned] = useState('me');
  const list = useQuery({ queryKey: ['work-items', q, state, assigned], queryFn: () => api.get<{ total: number; items: WorkItem[] }>(`/work-items?${new URLSearchParams({ q, state, assigned })}`) });
  return (
    <div className="space-y-5">
      <PageHeader title="My work">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by key or title" aria-label="Filter" />
        <Select value={state} onChange={(e) => setState(e.target.value)} aria-label="State"><option value="open">Open</option><option value="done">Done</option><option value="all">All</option></Select>
        <Select value={assigned} onChange={(e) => setAssigned(e.target.value)} aria-label="Assigned"><option value="me">Assigned to me</option><option value="all">Everything synced</option></Select>
      </PageHeader>
      {list.isLoading ? <Loading /> : list.error ? <ErrorNote error={list.error} /> : !list.data?.items.length ? (
        <Empty title="No tickets here">Tickets appear after Jira or Zoho is connected and synced (Settings → Integrations).</Empty>
      ) : (
        <ul className="glass panel divide-y divide-rule/70 overflow-hidden">
          {list.data.items.map((w) => (
            <li key={w.id} className="group flex flex-wrap items-center gap-3 px-5 py-3 transition-colors hover:bg-accent-1/[0.05]">
              <Link to={`/work/${w.id}`} className="min-w-0 flex-1">
                <p className="truncate"><span className="font-display font-semibold text-ink transition-colors group-hover:text-accent-1">{w.ticketKey ?? '—'}</span> {w.title}</p>
                <p className="text-xs text-graphite">{[w.projectName, w.sprintName, w.dueDate && `due ${w.dueDate}`].filter(Boolean).join(' · ')}</p>
              </Link>
              {w.personalStatus && <Tag tone="warn">{w.personalStatus}</Tag>}
              {w.labels.map((l) => <Tag key={l}>{l}</Tag>)}
              <Tag tone={w.isDone ? 'good' : 'neutral'}>{w.status ?? 'No status'}</Tag>
              <span className="w-16 text-right text-sm num text-graphite">{w.loggedMinutes ? formatMinutes(w.loggedMinutes) : ''}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface TicketHistory {
  workItem: { id: string; ticketKey: string | null; title: string; description: string | null; status: string | null; priority: string | null; projectName: string | null; sprintName: string | null; externalUrl: string | null };
  local: { notes: string | null; labels: string[]; personalStatus: string | null; personalEstimateMinutes: number | null };
  firstWorkDate: string | null;
  lastWorkDate: string | null;
  totalLoggedMinutes: number;
  sessions: number;
  entries: { id: string; date: string; activityType: string; durationMinutes: number; description: string | null }[];
  journalMentions: { date: string; accomplished: string | null; pending: string | null; blockers: string | null }[];
  journalNotes: { date: string; content: string }[];
  githubEvidence: { type: string; title: string; repo: string; url: string | null; date: string }[];
  sprintHistory: { sprint: string; status: string | null }[];
}

export function TicketPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['ticket', id], queryFn: () => api.get<TicketHistory>(`/work-items/${id}`) });
  const [local, setLocal] = useState({ notes: '', labels: '', personalStatus: '', estimate: '' });
  useEffect(() => {
    if (q.data) setLocal({ notes: q.data.local.notes ?? '', labels: q.data.local.labels.join(', '), personalStatus: q.data.local.personalStatus ?? '', estimate: q.data.local.personalEstimateMinutes ? String(q.data.local.personalEstimateMinutes) : '' });
  }, [q.data]);
  const save = useMutation({
    mutationFn: () => api.patch(`/work-items/${id}/local`, {
      notes: local.notes || null,
      labels: local.labels.split(',').map((l) => l.trim()).filter(Boolean),
      personalStatus: local.personalStatus || null,
      personalEstimateMinutes: local.estimate ? Number(local.estimate) : null,
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ticket', id] }),
  });
  if (!q.data) return q.isLoading ? <Loading /> : <ErrorNote error={q.error} />;
  const t = q.data;
  return (
    <div className="space-y-5">
      <PageHeader title={<>{t.workItem.ticketKey} {t.workItem.title}</>}>
        <LabelChip label="EXTERNAL" />
        {t.workItem.externalUrl && <a href={t.workItem.externalUrl} target="_blank" rel="noreferrer noopener" className="text-sm font-bold text-accent-1 underline-offset-2 hover:underline">Open original</a>}
      </PageHeader>
      <p className="text-sm text-graphite">{[t.workItem.status, t.workItem.priority, t.workItem.projectName, t.workItem.sprintName].filter(Boolean).join(' · ')}</p>
      <section className="glass panel grid grid-cols-2 gap-2 p-5 sm:grid-cols-3">
        <Stat accent value={formatMinutes(t.totalLoggedMinutes)} label="logged" />
        <Stat value={t.sessions} label="sessions" />
        <Stat value={<span className="text-base">{t.firstWorkDate ? `${t.firstWorkDate} → ${t.lastWorkDate}` : '—'}</span>} label={t.firstWorkDate ? 'first → last worked' : 'No time logged yet'} />
      </section>
      <div className="grid gap-5 md:grid-cols-2">
        <Section title="Your notes (never sent to Jira or Zoho)">
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
            <Field label="Notes"><Textarea rows={4} value={local.notes} onChange={(e) => setLocal({ ...local, notes: e.target.value })} /></Field>
            <Field label="Labels" hint="Comma separated"><Input value={local.labels} onChange={(e) => setLocal({ ...local, labels: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Personal status"><Input value={local.personalStatus} onChange={(e) => setLocal({ ...local, personalStatus: e.target.value })} placeholder="e.g. waiting on QA" /></Field>
              <Field label="Estimate (minutes)"><Input type="number" min={0} value={local.estimate} onChange={(e) => setLocal({ ...local, estimate: e.target.value })} /></Field>
            </div>
            <Button variant="primary" type="submit">Save notes</Button>
            <ErrorNote error={save.error} />
          </form>
        </Section>
        <Section title="Logged sessions">
          {t.entries.length ? <ul className="space-y-1 text-sm">{t.entries.map((e) => <li key={e.id} className="flex gap-3"><span className="num text-graphite">{e.date}</span><span className="flex-1">{titleCase(e.activityType)}{e.description ? ` · ${e.description}` : ''}</span><span className="num">{formatMinutes(e.durationMinutes)}</span></li>)}</ul> : <p className="text-sm text-graphite">No sessions yet.</p>}
        </Section>
        <Section title="GitHub evidence">
          {t.githubEvidence.length ? <ul className="space-y-1 text-sm">{t.githubEvidence.map((g, i) => <li key={i} className="flex items-start gap-2"><LabelChip label="OBSERVED" /><span className="num text-graphite">{g.date}</span>{g.url ? <a className="flex-1 hover:underline" href={g.url} target="_blank" rel="noreferrer noopener">{g.title}</a> : <span className="flex-1">{g.title}</span>}</li>)}</ul> : <p className="text-sm text-graphite">No commits or pull requests mention this ticket.</p>}
        </Section>
        <Section title="Journal">
          {t.journalMentions.length || t.journalNotes.length ? (
            <ul className="space-y-2 text-sm">
              {t.journalNotes.map((n, i) => <li key={`n${i}`}><span className="num text-graphite">{n.date}</span> {n.content}</li>)}
              {t.journalMentions.map((j) => <li key={j.date}><span className="num text-graphite">{j.date}</span> {[j.accomplished, j.pending, j.blockers].filter(Boolean).join(' / ')}</li>)}
            </ul>
          ) : <p className="text-sm text-graphite">No journal entries mention this ticket.</p>}
          {t.sprintHistory.length > 0 && <p className="mt-3 text-xs text-graphite">Sprints: {t.sprintHistory.map((s) => s.sprint).join(' → ')}</p>}
        </Section>
      </div>
    </div>
  );
}
