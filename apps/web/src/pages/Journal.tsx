import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { JOURNAL_SECTIONS, JOURNAL_SECTION_LABELS, type JournalSection } from '@pwos/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button, ErrorNote, Field, Input, Loading, PageHeader, Section, Textarea } from '../components/ui';
import { DateNav } from './Timesheet';

type Journal = Record<JournalSection, string | null> & { items: { id: string; content: string; ticketKey: string | null; createdAt: string }[] };
const empty = () => Object.fromEntries(JOURNAL_SECTIONS.map((s) => [s, ''])) as Record<JournalSection, string>;

export function JournalPage() {
  const { today } = useAuth();
  const qc = useQueryClient();
  const [date, setDate] = useState(today);
  const q = useQuery({ queryKey: ['journal', date], queryFn: () => api.get<Journal | null>(`/journal/${date}`) });
  const [form, setForm] = useState(empty());
  const [note, setNote] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    const j = q.data;
    setForm(j ? (Object.fromEntries(JOURNAL_SECTIONS.map((s) => [s, j[s] ?? ''])) as Record<JournalSection, string>) : empty());
    setSaved(false);
  }, [q.data]);
  const refresh = () => qc.invalidateQueries({ queryKey: ['journal', date] });
  const save = useMutation({ mutationFn: () => api.post(`/journal/${date}`, Object.fromEntries(JOURNAL_SECTIONS.map((s) => [s, form[s] || null]))), onSuccess: () => { setSaved(true); refresh(); } });
  const addNote = useMutation({ mutationFn: () => api.post(`/journal/${date}/notes`, { content: note }), onSuccess: () => { setNote(''); refresh(); } });
  const remove = useMutation({ mutationFn: () => api.del(`/journal/${date}`), onSuccess: refresh });

  return (
    <div className="space-y-5">
      <PageHeader title="Journal"><DateNav date={date} onChange={setDate} /></PageHeader>
      {q.isLoading ? <Loading /> : (
        <>
          <form className="space-y-4 rounded-lg border border-rule bg-sheet p-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
            <p className="text-sm text-graphite">Your own words about the day. Stored only in Work OS.</p>
            {JOURNAL_SECTIONS.map((s) => (
              <Field key={s} label={JOURNAL_SECTION_LABELS[s]}>
                <Textarea rows={s === 'workedOn' || s === 'accomplished' ? 3 : 2} value={form[s]} onChange={(e) => { setForm({ ...form, [s]: e.target.value }); setSaved(false); }} />
              </Field>
            ))}
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" type="submit" disabled={save.isPending}>Save journal</Button>
              {saved && <span className="text-sm text-confirmed">Saved</span>}
              {q.data && <Button type="button" variant="danger" className="ml-auto" onClick={() => window.confirm('Delete this day’s journal?') && remove.mutate()}>Delete day</Button>}
            </div>
            <ErrorNote error={save.error ?? remove.error} />
          </form>
          <Section title="Quick notes">
            <form className="mb-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (note.trim()) addNote.mutate(); }}>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Jot something down" className="flex-1" aria-label="Quick note" />
              <Button type="submit">Add note</Button>
            </form>
            {q.data?.items.length ? (
              <ul className="space-y-1 text-sm">{q.data.items.map((n) => <li key={n.id}><span className="num text-graphite">{new Date(n.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span> {n.content}</li>)}</ul>
            ) : <p className="text-sm text-graphite">No notes for this day.</p>}
          </Section>
        </>
      )}
    </div>
  );
}
