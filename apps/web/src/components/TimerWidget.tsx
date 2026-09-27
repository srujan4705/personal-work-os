import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ACTIVITY_TYPES, titleCase } from '@pwos/shared';
import { api } from '../lib/api';
import type { Timer } from '../lib/types';
import { Button, ErrorNote, Input, Select } from './ui';

const clock = (s: number) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

/** One active timer, stored on the server so it survives refreshes and devices. */
export function TimerWidget() {
  const qc = useQueryClient();
  const timer = useQuery({ queryKey: ['timer'], queryFn: () => api.get<Timer | null>('/timer'), refetchInterval: 60_000 });
  const [offset, setOffset] = useState(0);
  const [activity, setActivity] = useState('DEVELOPMENT');
  const [ticket, setTicket] = useState('');
  useEffect(() => {
    setOffset(0);
    if (timer.data?.status !== 'RUNNING') return;
    const t = setInterval(() => setOffset((o) => o + 1), 1000);
    return () => clearInterval(t);
  }, [timer.data]);
  const act = useMutation({
    mutationFn: (path: string) => api.post(`/timer/${path}`, path === 'start' ? { activityType: activity, ...(ticket.trim() && { ticket: ticket.trim() }) } : {}),
    onSuccess: () => qc.invalidateQueries(),
  });

  const t = timer.data;
  return (
    <div className="space-y-2">
      {t ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className={`text-2xl font-bold num ${t.status === 'PAUSED' ? 'text-graphite' : ''}`}>{clock(t.elapsedSeconds + offset)}</span>
          <span className="text-sm text-graphite">{t.ticketKey ?? titleCase(t.activityType)}{t.status === 'PAUSED' ? ' · paused' : ''}</span>
          <div className="flex gap-1.5">
            {t.status === 'RUNNING' ? <Button onClick={() => act.mutate('pause')}>Pause</Button> : <Button onClick={() => act.mutate('resume')}>Resume</Button>}
            <Button variant="primary" onClick={() => act.mutate('stop')}>Stop and save</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Select value={activity} onChange={(e) => setActivity(e.target.value)} aria-label="Timer activity">
            {ACTIVITY_TYPES.map((a) => <option key={a} value={a}>{titleCase(a)}</option>)}
          </Select>
          <Input value={ticket} onChange={(e) => setTicket(e.target.value)} placeholder="Ticket (optional)" className="w-36" aria-label="Timer ticket" />
          <Button variant="primary" onClick={() => act.mutate('start')}>Start timer</Button>
        </div>
      )}
      <ErrorNote error={act.error} />
    </div>
  );
}
