import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatMinutes } from '@pwos/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { addDays, prettyDate, shortDate, weekday } from '../lib/date';
import { Button, Empty, ErrorNote, Input, LabelChip, Loading, PageHeader, Segmented, Tag } from '../components/ui';

interface CalEvent {
  id: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  isAllDay: boolean;
  status: string;
  location: string | null;
  meetingUrl: string | null;
  description: string | null;
  local: { note: string | null; reminderEnabled: boolean };
  logStatus: 'LOGGED' | 'IGNORED' | 'PENDING';
}

type View = 'agenda' | 'day' | 'week' | 'month';

function range(view: View, anchor: string) {
  if (view === 'day') return { from: anchor, to: anchor };
  if (view === 'week') {
    const dow = (new Date(`${anchor}T00:00:00Z`).getUTCDay() + 6) % 7;
    const from = addDays(anchor, -dow);
    return { from, to: addDays(from, 6) };
  }
  if (view === 'month') {
    const from = `${anchor.slice(0, 8)}01`;
    const next = new Date(`${from}T00:00:00Z`);
    next.setUTCMonth(next.getUTCMonth() + 1);
    return { from, to: addDays(next.toISOString().slice(0, 10), -1) };
  }
  return { from: anchor, to: addDays(anchor, 13) };
}

function EventRow({ e }: { e: CalEvent }) {
  const qc = useQueryClient();
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState(e.local.note ?? '');
  const act = useMutation({ mutationFn: (fn: () => Promise<unknown>) => fn(), onSuccess: () => qc.invalidateQueries() });
  const cancelled = e.status === 'CANCELLED';
  return (
    <li className="py-2.5">
      <div className="flex flex-wrap items-start gap-3">
        <span className="w-24 text-sm text-graphite num">{e.isAllDay ? 'All day' : `${e.startTime}–${e.endTime}`}</span>
        <div className="min-w-0 flex-1">
          <p className={`font-bold ${cancelled ? 'line-through text-graphite' : ''}`}>{e.title}</p>
          <p className="text-xs text-graphite">
            {formatMinutes(e.durationMinutes)}{e.location ? ` · ${e.location}` : ''}
            {e.meetingUrl && <> · <a href={e.meetingUrl} target="_blank" rel="noreferrer noopener" className="font-bold text-observed underline">Join meeting</a></>}
          </p>
          {e.local.note && !noting && <p className="text-sm">Note: {e.local.note}</p>}
          {noting && (
            <form className="mt-1 flex gap-1" onSubmit={(x) => { x.preventDefault(); act.mutate(() => api.patch(`/calendar/events/${e.id}/local`, { note: note || null })); setNoting(false); }}>
              <Input value={note} onChange={(x) => setNote(x.target.value)} className="flex-1" placeholder="Private note (stays in Work OS)" autoFocus />
              <Button type="submit">Save</Button>
            </form>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <LabelChip label="EXTERNAL" />
          {e.logStatus === 'LOGGED' && <Tag tone="good">Logged</Tag>}
          {e.logStatus === 'IGNORED' && <Tag>Ignored</Tag>}
          {e.logStatus !== 'LOGGED' && !e.isAllDay && !cancelled && <Button onClick={() => act.mutate(() => api.post(`/calendar/events/${e.id}/accept`))}>Log time</Button>}
          {e.logStatus === 'PENDING' && !e.isAllDay && !cancelled && <Button variant="ghost" onClick={() => act.mutate(() => api.post(`/calendar/events/${e.id}/ignore`))}>Ignore</Button>}
          <Button variant="ghost" onClick={() => setNoting((n) => !n)}>Note</Button>
          <Button variant="ghost" title="Reminder before this meeting" onClick={() => act.mutate(() => api.patch(`/calendar/events/${e.id}/local`, { reminderEnabled: !e.local.reminderEnabled }))}>
            {e.local.reminderEnabled ? 'Reminder on' : 'Reminder off'}
          </Button>
        </div>
      </div>
      <ErrorNote error={act.error} />
    </li>
  );
}

export function CalendarPage() {
  const { today } = useAuth();
  const [view, setView] = useState<View>('agenda');
  const [anchor, setAnchor] = useState(today);
  const { from, to } = range(view, anchor);
  const q = useQuery({ queryKey: ['calendar', from, to], queryFn: () => api.get<CalEvent[]>(`/calendar/events?from=${from}&to=${to}`) });
  const step = view === 'day' ? 1 : view === 'week' ? 7 : view === 'month' ? 30 : 14;
  const byDate = new Map<string, CalEvent[]>();
  for (const e of q.data ?? []) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);

  return (
    <div className="space-y-5">
      <PageHeader title="Calendar">
        <Segmented label="Calendar view" options={['agenda', 'day', 'week', 'month'] as View[]} value={view} onChange={setView} />
        <Button variant="ghost" onClick={() => setAnchor(addDays(anchor, -step))} aria-label="Previous">‹</Button>
        <Button variant="ghost" onClick={() => setAnchor(today)}>Today</Button>
        <Button variant="ghost" onClick={() => setAnchor(addDays(anchor, step))} aria-label="Next">›</Button>
      </PageHeader>
      <p className="text-sm text-graphite">Synced read-only from Zoho Calendar. Logging a meeting adds it to your local timesheet only.</p>
      {q.isLoading ? <Loading /> : q.error ? <ErrorNote error={q.error} /> : view === 'month' ? (
        <div className="grid grid-cols-7 gap-1 text-xs">
          {Array.from({ length: 7 }, (_, i) => <div key={i} className="px-1 font-bold text-graphite">{weekday(addDays('2026-01-05', i))}</div>)}
          {Array.from({ length: (new Date(`${from}T00:00:00Z`).getUTCDay() + 6) % 7 }, (_, i) => <div key={`pad${i}`} />)}
          {Array.from({ length: Number(to.slice(8)) }, (_, i) => {
            const d = addDays(from, i);
            const evs = byDate.get(d) ?? [];
            return (
              <button key={d} onClick={() => { setAnchor(d); setView('day'); }} className={`panel-hover min-h-24 rounded-control p-1.5 text-left ${d === today ? 'glass border-accent-2/60 gradient-ring' : 'glass'}`}>
                <span className={`mb-0.5 block font-display font-semibold num ${d === today ? 'gradient-text' : 'text-ink'}`}>{Number(d.slice(8))}</span>
                {evs.slice(0, 3).map((e) => <span key={e.id} className="mb-0.5 block truncate rounded-[0.35rem] bg-accent-1/[0.1] px-1 text-ink/90"><span className="num text-graphite">{e.isAllDay ? '' : e.startTime}</span> {e.title}</span>)}
                {evs.length > 3 && <span className="text-graphite">+{evs.length - 3} more</span>}
              </button>
            );
          })}
        </div>
      ) : byDate.size === 0 ? (
        <Empty title="No meetings in this range">If you expected some, run a Zoho sync from Settings.</Empty>
      ) : (
        [...byDate.entries()].map(([d, evs]) => (
          <section key={d} className="glass panel px-5 py-3">
            <h2 className="pt-1 font-display font-semibold text-ink">{d === today ? `Today, ${shortDate(d)}` : prettyDate(d)}</h2>
            <ul className="divide-y divide-rule/70">{evs.map((e) => <EventRow key={e.id} e={e} />)}</ul>
          </section>
        ))
      )}
    </div>
  );
}
