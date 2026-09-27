import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery } from '@tanstack/react-query';
import { ACTIVITY_TYPES, titleCase } from '@pwos/shared';
import { api } from '../lib/api';
import { Button, Field, Input, Select } from './ui';

const hm = /^([01]\d|2[0-3]):[0-5]\d$/;
const schema = z
  .object({
    ticket: z.string().max(64),
    activityType: z.enum(ACTIVITY_TYPES),
    duration: z.string(),
    startTime: z.string().refine((v) => !v || hm.test(v), 'Use HH:mm'),
    endTime: z.string().refine((v) => !v || hm.test(v), 'Use HH:mm'),
    description: z.string().max(1000),
  })
  .refine((v) => !!v.duration || (v.startTime && v.endTime), { message: 'Add a duration or a start and end time.', path: ['duration'] })
  .refine((v) => !v.duration || /^\d+(\.\d+)?h?$|^\d+m$|^\d+h\s?\d+m$/.test(v.duration.trim()), { message: 'Try 30m, 1.5h or 1h 15m', path: ['duration'] });

export type EntryFormValues = z.infer<typeof schema>;

export function parseDuration(v: string): number | undefined {
  const s = v.trim().toLowerCase();
  if (!s) return undefined;
  const hm2 = /^(\d+)h\s?(\d+)m$/.exec(s);
  if (hm2) return Number(hm2[1]) * 60 + Number(hm2[2]);
  if (s.endsWith('m')) return Number(s.slice(0, -1));
  if (s.endsWith('h')) return Math.round(Number(s.slice(0, -1)) * 60);
  return Math.round(Number(s) * 60); // bare numbers are hours
}

export function toEntryPayload(v: EntryFormValues) {
  return {
    ...(v.ticket.trim() ? { ticket: v.ticket.trim() } : { workItemId: null }),
    activityType: v.activityType,
    durationMinutes: parseDuration(v.duration),
    startTime: v.startTime || null,
    endTime: v.endTime || null,
    description: v.description.trim() || null,
  };
}

/** Fast entry: ticket, activity, duration (or start/end). Duration shortcuts fill common values. */
export function EntryForm({ initial, submitLabel, onSubmit, onCancel }: { initial?: Partial<EntryFormValues>; submitLabel: string; onSubmit: (v: EntryFormValues) => Promise<void>; onCancel?: () => void }) {
  const recent = useQuery({ queryKey: ['recent-tickets'], queryFn: () => api.get<{ id: string; ticketKey: string | null; title: string }[]>('/timesheets/recent-tickets') });
  const { register, handleSubmit, setValue, reset, formState } = useForm<EntryFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { ticket: '', activityType: 'DEVELOPMENT', duration: '', startTime: '', endTime: '', description: '', ...initial },
  });
  const submit = handleSubmit(async (v) => {
    await onSubmit(v);
    if (!initial) reset({ ...v, duration: '', startTime: '', endTime: '', description: '' });
  });

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-6">
      <div className="sm:col-span-2">
        <Field label="Ticket" hint="Key like ER-431, or leave empty">
          <Input list="recent-tickets" placeholder="ER-431" {...register('ticket')} />
        </Field>
        <datalist id="recent-tickets">
          {recent.data?.map((t) => <option key={t.id} value={t.ticketKey ?? t.id}>{t.title}</option>)}
        </datalist>
      </div>
      <div className="sm:col-span-2">
        <Field label="Activity">
          <Select {...register('activityType')}>
            {ACTIVITY_TYPES.map((a) => <option key={a} value={a}>{titleCase(a)}</option>)}
          </Select>
        </Field>
      </div>
      <div className="sm:col-span-2">
        <Field label="Duration" hint={formState.errors.duration?.message ?? '30m, 1.5h, 1h 15m'}>
          <div className="flex gap-1">
            <Input className="w-full num" placeholder="1h" {...register('duration')} aria-invalid={!!formState.errors.duration} />
            {['15m', '30m', '1h'].map((d) => (
              <button type="button" key={d} onClick={() => setValue('duration', d, { shouldValidate: true })} className="rounded-md border border-rule px-2 text-xs hover:border-graphite">{d}</button>
            ))}
          </div>
        </Field>
      </div>
      <Field label="Start" hint={formState.errors.startTime?.message}><Input type="time" {...register('startTime')} /></Field>
      <Field label="End" hint={formState.errors.endTime?.message}><Input type="time" {...register('endTime')} /></Field>
      <div className="sm:col-span-4"><Field label="Description"><Input placeholder="What did you do?" {...register('description')} /></Field></div>
      <div className="flex gap-2 sm:col-span-6">
        <Button variant="primary" type="submit" disabled={formState.isSubmitting}>{submitLabel}</Button>
        {onCancel && <Button type="button" onClick={onCancel}>Cancel</Button>}
      </div>
    </form>
  );
}
