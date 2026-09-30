import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatMinutes } from '@pwos/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { TimelineItem } from '../lib/types';
import { DayStrip } from '../components/DayStrip';
import { Empty, ErrorNote, LabelChip, Loading, PageHeader } from '../components/ui';
import { DateNav } from './Timesheet';

export function TimelinePage() {
  const { today } = useAuth();
  const [date, setDate] = useState(today);
  const q = useQuery({ queryKey: ['timeline', date], queryFn: () => api.get<{ items: TimelineItem[]; summary: { loggedMinutes: number } }>(`/timeline/${date}`) });
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.get<{ workStartTime: string; workEndTime: string }>('/settings') });
  return (
    <div className="space-y-5">
      <PageHeader title="Timeline"><DateNav date={date} onChange={setDate} /></PageHeader>
      {q.isLoading ? <Loading /> : q.error ? <ErrorNote error={q.error} /> : (
        <>
          <div className="glass panel p-5"><DayStrip items={q.data!.items.map((i) => ({ id: i.id, label: i.kind === 'MEETING' ? 'EXTERNAL' : i.label, start: i.time, end: i.endTime, title: i.title }))} workStart={settings.data?.workStartTime} workEnd={settings.data?.workEndTime} /></div>
          {!q.data!.items.length ? <Empty title="Nothing recorded for this day" /> : (
            <ol className="glass panel relative space-y-4 py-5 pl-9 pr-5 before:absolute before:inset-y-6 before:left-5 before:w-px before:bg-gradient-to-b before:from-accent-1/60 before:via-accent-2/40 before:to-transparent">
              {q.data!.items.map((i) => (
                <li key={`${i.kind}-${i.id}`} className="relative">
                  <span className={`absolute -left-[22px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-paper ${i.label === 'CONFIRMED' ? 'bg-confirmed shadow-[0_0_10px_var(--color-confirmed)]' : i.label === 'SUGGESTED' ? 'bg-suggested' : i.kind === 'MEETING' ? 'bg-external' : 'bg-observed shadow-[0_0_10px_var(--color-observed)]'}`} />
                  <p className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="w-24 num text-graphite">{i.time ? `${i.time}${i.endTime ? `–${i.endTime}` : ''}` : 'All day'}</span>
                    <LabelChip label={i.kind === 'MEETING' ? 'EXTERNAL' : i.label} />
                    {i.url ? <a href={i.url} target="_blank" rel="noreferrer noopener" className="font-bold text-ink transition-colors hover:text-accent-1">{i.title}</a> : <span className="font-bold text-ink">{i.title}</span>}
                    {i.durationMinutes ? <span className="num text-graphite">{formatMinutes(i.durationMinutes)}</span> : null}
                  </p>
                  {i.detail && <p className="text-xs text-graphite sm:ml-[6.5rem]">{i.detail}</p>}
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </div>
  );
}
