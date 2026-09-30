import { hmToMinutes } from '../lib/date';
import type { Label } from '../lib/types';

export interface StripItem {
  id: string;
  label: Label;
  start: string | null;
  end: string | null;
  title: string;
}

/**
 * The day ledger: a band across working hours. Confirmed work is solid, suggestions are
 * dashed, observed evidence is a tick, external items are grey. Same code on every page.
 */
export function DayStrip({ items, workStart = '09:00', workEnd = '18:00', now }: { items: StripItem[]; workStart?: string; workEnd?: string; now?: string | null }) {
  const from = Math.min(hmToMinutes(workStart), ...items.filter((i) => i.start).map((i) => hmToMinutes(i.start!))) - 30;
  const to = Math.max(hmToMinutes(workEnd), ...items.filter((i) => i.end ?? i.start).map((i) => hmToMinutes((i.end ?? i.start)!))) + 30;
  const span = Math.max(60, to - from);
  const pct = (hm: string) => `${((hmToMinutes(hm) - from) / span) * 100}%`;
  const width = (a: string, b: string) => `${Math.max(0.6, ((hmToMinutes(b) - hmToMinutes(a)) / span) * 100)}%`;
  const hours: number[] = [];
  for (let h = Math.ceil(from / 60); h * 60 <= to; h++) hours.push(h);

  return (
    <figure aria-label="Day overview" className="select-none">
      <div className="relative h-14 overflow-hidden rounded-control border border-ink/[0.07] bg-ink/[0.04]">
        <div className="absolute inset-y-0 bg-accent-1/[0.07]" style={{ left: pct(workStart), width: width(workStart, workEnd) }} />
        {hours.map((h) => (
          <div key={h} className="absolute inset-y-0 border-l border-ink/[0.07]" style={{ left: `${((h * 60 - from) / span) * 100}%` }} />
        ))}
        {items.filter((i) => i.start && i.end && i.label !== 'OBSERVED').map((i) => (
          <div
            key={i.id}
            title={`${i.start}–${i.end} ${i.title}`}
            className={`absolute rounded-[0.35rem] transition-transform duration-150 hover:-translate-y-px ${
              i.label === 'CONFIRMED' ? 'top-2 bottom-5 bg-gradient-to-b from-confirmed to-confirmed/75 shadow-[0_4px_12px_-4px_var(--color-confirmed)]'
              : i.label === 'SUGGESTED' ? 'top-2 bottom-5 border-2 border-dashed border-suggested bg-suggested/10'
              : 'top-2 bottom-5 bg-external/35'
            }`}
            style={{ left: pct(i.start!), width: width(i.start!, i.end!) }}
          />
        ))}
        {items.filter((i) => i.start && (i.label === 'OBSERVED' || !i.end)).map((i) => (
          <div key={i.id} title={`${i.start} ${i.title}`} className="absolute bottom-1.5 h-3 w-[3px] rounded-full bg-observed shadow-[0_0_8px_var(--color-observed)]" style={{ left: pct(i.start!) }} />
        ))}
        {now && <div className="absolute inset-y-0 w-0.5 bg-accent-2 shadow-[0_0_10px_var(--color-accent-2)]" style={{ left: pct(now) }} aria-label={`Now ${now}`} />}
      </div>
      <div className="relative mt-1 h-4 text-[11px] text-graphite num">
        {hours.filter((_, i) => i % 2 === 0).map((h) => (
          <span key={h} className="absolute -translate-x-1/2" style={{ left: `${((h * 60 - from) / span) * 100}%` }}>{String(h).padStart(2, '0')}</span>
        ))}
      </div>
      <figcaption className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-graphite">
        <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-4 rounded-[0.2rem] bg-confirmed" />Logged</span>
        <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-4 rounded-[0.2rem] border-2 border-dashed border-suggested" />Suggested</span>
        <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-[3px] rounded-full bg-observed" />Observed activity</span>
        <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-4 rounded-[0.2rem] bg-external/35" />Meetings (not logged)</span>
        <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-0.5 bg-accent-2" />Now</span>
      </figcaption>
    </figure>
  );
}
