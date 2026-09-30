import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatMinutes, titleCase } from '@pwos/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { addDays, prettyDate, weekday } from '../lib/date';
import type { Entry, Suggestion, Timesheet } from '../lib/types';
import { EntryForm, toEntryPayload } from '../components/EntryForm';
import { TimerWidget } from '../components/TimerWidget';
import { Button, Empty, ErrorNote, Input, LabelChip, Loading, PageHeader, Section, Select, Tag } from '../components/ui';
import { SuggestionList } from './Dashboard';

const SOURCE_LABEL: Record<string, string> = { TIMER: 'timer', CALENDAR: 'calendar', AI_SUGGESTION: 'assistant', GITHUB_SUGGESTION: 'GitHub suggestion', IMPORTED: 'import' };

export function DateNav({ date, onChange }: { date: string; onChange: (d: string) => void }) {
  const { today } = useAuth();
  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" onClick={() => onChange(addDays(date, -1))} aria-label="Previous day">‹</Button>
      <Input type="date" value={date} onChange={(e) => e.target.value && onChange(e.target.value)} aria-label="Date" />
      <Button variant="ghost" onClick={() => onChange(addDays(date, 1))} aria-label="Next day">›</Button>
      {date !== today && <Button variant="ghost" onClick={() => onChange(today)}>Today</Button>}
    </div>
  );
}

export function TimesheetPage() {
  const { today } = useAuth();
  const qc = useQueryClient();
  const [date, setDate] = useState(today);
  const [editing, setEditing] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const sheet = useQuery({ queryKey: ['timesheet', date], queryFn: () => api.get<Timesheet>(`/timesheets/${date}`) });
  const week = useQuery({ queryKey: ['week', date], queryFn: () => api.get<{ days: { date: string; loggedMinutes: number; expectedMinutes: number; status: string }[] }>(`/timesheets/week/${date}`) });
  const suggestions = useQuery({ queryKey: ['suggestions', date], queryFn: () => api.get<Suggestion[]>(`/suggestions?date=${date}`) });
  const invalidate = () => qc.invalidateQueries();
  const run = useMutation({ mutationFn: (fn: () => Promise<unknown>) => fn(), onSuccess: () => { invalidate(); setSelected([]); } });

  if (sheet.isLoading) return <Loading />;
  if (!sheet.data) return <ErrorNote error={sheet.error} />;
  const { timesheet, entries, issues, summary } = sheet.data;
  const editable = timesheet.status === 'DRAFT';
  const issuesFor = (id: string) => issues.filter((i) => i.entryIds.includes(id));
  const base = `/timesheets/${date}`;

  const duplicate = (e: Entry) => run.mutate(() => api.post(`${base}/entries`, { ticket: e.ticketKey ?? undefined, activityType: e.activityType, durationMinutes: e.durationMinutes, description: e.description }));
  const split = (e: Entry) => {
    const v = window.prompt(`Split ${formatMinutes(e.durationMinutes)} — minutes for the first part:`, String(Math.floor(e.durationMinutes / 2)));
    if (v) run.mutate(() => api.post(`${base}/entries/${e.id}/split`, { firstMinutes: Number(v) }));
  };

  return (
    <div className="space-y-5">
      <PageHeader title={prettyDate(date)}><DateNav date={date} onChange={(d) => { setDate(d); setEditing(null); }} /></PageHeader>

      <ol className="grid grid-cols-7 gap-1" aria-label="This week">
        {week.data?.days.map((d) => (
          <li key={d.date}>
            <button onClick={() => setDate(d.date)} className={`w-full rounded-control px-1 py-2 text-center text-xs transition-all duration-200 ${d.date === date ? 'gradient-accent text-white shadow-[0_8px_20px_-8px_var(--color-accent-1)]' : 'glass text-graphite hover:border-accent-2/50 hover:text-ink'}`}>
              <span className="block">{weekday(d.date)}</span>
              <span className="block font-display font-semibold num">{d.loggedMinutes ? formatMinutes(d.loggedMinutes) : '–'}</span>
              {d.status === 'SUBMITTED' && <span className="block text-[10px]">✓ submitted</span>}
            </button>
          </li>
        ))}
      </ol>

      <section className="glass panel flex flex-wrap items-center justify-between gap-3 p-5">
        <p className="num"><span className="font-display text-3xl font-semibold gradient-text">{formatMinutes(summary.loggedMinutes)}</span><span className="text-graphite"> logged · {formatMinutes(summary.expectedMinutes)} expected · {formatMinutes(summary.remainingMinutes)} remaining</span></p>
        <div className="flex flex-wrap items-center gap-2">
          <Tag tone={editable ? 'neutral' : 'good'}>{titleCase(timesheet.status)}</Tag>
          <Select value={timesheet.dayType} disabled={!editable} onChange={(e) => run.mutate(() => api.post(`${base}/day-type`, { dayType: e.target.value }))} aria-label="Day type">
            <option value="WORKDAY">Work day</option><option value="HALF_DAY">Half day</option><option value="LEAVE">Leave</option><option value="HOLIDAY">Holiday</option>
          </Select>
          {editable ? (
            <>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className="w-40" aria-label="Submission note" />
              <Button variant="primary" onClick={() => run.mutate(() => api.post(`${base}/submit`, { note: note || undefined }))}>Submit day</Button>
            </>
          ) : <Button onClick={() => run.mutate(() => api.post(`${base}/reopen`))}>Reopen</Button>}
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink/[0.08]"><div className="gradient-accent h-full rounded-full transition-[width] duration-500 ease-out" style={{ width: `${summary.expectedMinutes ? Math.min(100, (summary.loggedMinutes / summary.expectedMinutes) * 100) : 0}%` }} /></div>
        <p className="w-full text-xs text-graphite">Submitting saves the day in Work OS only. Nothing is sent to Jira or Zoho.</p>
      </section>
      <ErrorNote error={run.error} />

      {editable && <Section title="Add time"><EntryForm submitLabel="Add entry" onSubmit={async (v) => { await api.post(`${base}/entries`, toEntryPayload(v)); invalidate(); }} /></Section>}

      <Section
        title={`Entries (${entries.length})`}
        action={editable && selected.length >= 2 ? <Button onClick={() => run.mutate(() => api.post(`${base}/entries/merge`, { ids: selected }))}>Merge {selected.length}</Button> : null}
      >
        {issues.filter((i) => !i.entryIds.length).map((i) => <p key={i.code} className="mb-2 text-sm text-suggested">⚠ {i.message}</p>)}
        {!entries.length ? <Empty title="No time logged for this day">Add an entry above, start the timer, or accept a suggestion.</Empty> : (
          <ul className="divide-y divide-rule/70">
            {entries.map((e) => (
              <li key={e.id} className="-mx-2 rounded-control px-2 py-2.5 transition-colors hover:bg-ink/[0.03]">
                {editing === e.id ? (
                  <EntryForm
                    submitLabel="Save changes"
                    initial={{ ticket: e.ticketKey ?? '', activityType: e.activityType as never, duration: `${e.durationMinutes}m`, startTime: e.startTime ?? '', endTime: e.endTime ?? '', description: e.description ?? '' }}
                    onCancel={() => setEditing(null)}
                    onSubmit={async (v) => { await api.patch(`${base}/entries/${e.id}`, { ...toEntryPayload(v), version: e.version }); setEditing(null); invalidate(); }}
                  />
                ) : (
                  <div className="flex flex-wrap items-start gap-3">
                    {editable && <input type="checkbox" className="mt-1.5" aria-label="Select for merge" checked={selected.includes(e.id)} onChange={(x) => setSelected((s) => (x.target.checked ? [...s, e.id] : s.filter((y) => y !== e.id)))} />}
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="w-24 text-sm text-graphite num">{e.startTime ? `${e.startTime}–${e.endTime ?? ''}` : 'no time'}</span>
                        <span className="font-display font-semibold text-ink">{e.ticketKey ?? titleCase(e.activityType)}</span>
                        {e.ticketTitle && <span className="truncate text-sm text-graphite">{e.ticketTitle}</span>}
                      </p>
                      <p className="ml-26 text-sm text-graphite sm:ml-[6.5rem]">{titleCase(e.activityType)}{e.description ? ` · ${e.description}` : ''}{e.source !== 'MANUAL' ? ` · via ${SOURCE_LABEL[e.source] ?? titleCase(e.source)}` : ''}</p>
                      {issuesFor(e.id).map((i, k) => <p key={k} className={`text-xs sm:ml-[6.5rem] ${i.level === 'error' ? 'text-danger' : 'text-suggested'}`}>{i.level === 'error' ? '✖' : '⚠'} {i.message}</p>)}
                    </div>
                    <span className="font-display font-semibold num text-ink">{formatMinutes(e.durationMinutes)}</span>
                    <LabelChip label="CONFIRMED" />
                    {editable && (
                      <div className="flex gap-0.5">
                        <Button variant="ghost" onClick={() => setEditing(e.id)}>Edit</Button>
                        <Button variant="ghost" onClick={() => duplicate(e)}>Duplicate</Button>
                        <Button variant="ghost" onClick={() => split(e)} disabled={e.durationMinutes < 2}>Split</Button>
                        <Button variant="ghost" className="text-danger" onClick={() => window.confirm('Delete this entry?') && run.mutate(() => api.del(`${base}/entries/${e.id}`))}>Delete</Button>
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div className="grid gap-5 md:grid-cols-2">
        <Section title="Suggestions for this day">{editable ? <SuggestionList suggestions={suggestions.data ?? []} /> : <p className="text-sm text-graphite">Reopen the day to add suggestions.</p>}</Section>
        <Section title="Timer"><TimerWidget /></Section>
      </div>
    </div>
  );
}
