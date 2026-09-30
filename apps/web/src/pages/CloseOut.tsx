import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatMinutes } from '@pwos/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Gap } from '../lib/types';
import { Button, ErrorNote, Field, Loading, PageHeader, Section, Stat, Textarea } from '../components/ui';

interface CloseOut {
  date: string;
  summary: { loggedMinutes: number; expectedMinutes: number; remainingMinutes: number };
  status: string;
  meetings: number;
  tickets: string[];
  githubActivities: number;
  possibleMissingWork: Gap[];
  journal: { accomplished: string; pending: string; blockers: string };
}

/** End-of-day flow: review, fill the three journal questions, then complete the day. */
export function CloseOutPage() {
  const { today } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['close-out', today], queryFn: () => api.get<CloseOut>(`/close-out/${today}`) });
  const [form, setForm] = useState({ accomplished: '', pending: '', blockers: '' });
  useEffect(() => { if (q.data) setForm(q.data.journal); }, [q.data]);
  const complete = useMutation({
    mutationFn: () => api.post(`/timesheets/${today}/complete-day`, form),
    onSuccess: () => { qc.invalidateQueries(); navigate('/'); },
  });
  if (!q.data) return q.isLoading ? <Loading /> : <ErrorNote error={q.error} />;
  const d = q.data;

  return (
    <div className="space-y-5">
      <PageHeader title="Close out today" />
      <Section title="Today">
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Stat accent value={formatMinutes(d.summary.loggedMinutes)} label={`logged of ${formatMinutes(d.summary.expectedMinutes)}`} />
          <Stat value={d.meetings} label="meeting(s)" />
          <Stat value={d.tickets.length} label={d.tickets.length ? `ticket(s): ${d.tickets.join(', ')}` : 'ticket(s)'} />
          <Stat value={d.githubActivities} label="GitHub activities observed" />
        </div>
        {d.possibleMissingWork.map((g) => <p key={g.start} className="mt-2 text-sm text-suggested">⚠ {g.message}</p>)}
        {d.summary.remainingMinutes > 0 && <p className="mt-2 text-sm text-graphite">{formatMinutes(d.summary.remainingMinutes)} below your expected time. That’s fine if it reflects your day.</p>}
      </Section>
      <Section title="Your notes">
        <div className="space-y-3">
          <Field label="What did you accomplish?"><Textarea rows={3} value={form.accomplished} onChange={(e) => setForm({ ...form, accomplished: e.target.value })} /></Field>
          <Field label="What is pending?"><Textarea rows={2} value={form.pending} onChange={(e) => setForm({ ...form, pending: e.target.value })} /></Field>
          <Field label="Any blockers?"><Textarea rows={2} value={form.blockers} onChange={(e) => setForm({ ...form, blockers: e.target.value })} /></Field>
        </div>
      </Section>
      <ErrorNote error={complete.error} />
      <div className="flex gap-2">
        <Button variant="primary" onClick={() => complete.mutate()} disabled={complete.isPending}>{d.status === 'DRAFT' ? 'Save notes and submit day' : 'Save notes'}</Button>
        <Button onClick={() => navigate('/timesheet')}>Review timesheet first</Button>
      </div>
    </div>
  );
}
