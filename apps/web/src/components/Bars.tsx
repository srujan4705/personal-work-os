import { formatMinutes, titleCase } from '@pwos/shared';

/** Horizontal bars for factual breakdowns. No scores, no rankings of the person. */
export function Bars({ rows, total, max = 8 }: { rows: { key: string; label: string; minutes: number }[]; total?: number; max?: number }) {
  const top = Math.max(1, ...rows.map((r) => r.minutes));
  if (!rows.length) return <p className="text-sm text-graphite">No logged time in this period.</p>;
  return (
    <ul className="space-y-2.5">
      {rows.slice(0, max).map((r) => (
        <li key={r.key} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-sm">
          <span className="truncate" title={r.label}>{/^[A-Z_]+$/.test(r.label) ? titleCase(r.label) : r.label}</span>
          <span className="h-2 overflow-hidden rounded-full bg-ink/[0.07]">
            <span className="gradient-accent block h-full rounded-full transition-[width] duration-500 ease-out" style={{ width: `${(r.minutes / top) * 100}%` }} />
          </span>
          <span className="num text-graphite">{formatMinutes(r.minutes)}{total ? ` · ${Math.round((r.minutes / total) * 100)}%` : ''}</span>
        </li>
      ))}
    </ul>
  );
}

export function DayColumns({ days }: { days: { date: string; loggedMinutes: number; expectedMinutes: number }[] }) {
  const top = Math.max(60, ...days.map((d) => Math.max(d.loggedMinutes, d.expectedMinutes)));
  return (
    <div className="flex h-36 gap-1.5" role="img" aria-label="Logged time by day">
      {days.map((d) => (
        <div key={d.date} className="flex min-w-0 flex-1 flex-col items-center gap-1">
          <div className="relative w-full flex-1">
            {d.expectedMinutes > 0 && <div className="absolute inset-x-0 border-t border-dashed border-graphite/45" style={{ bottom: `${(d.expectedMinutes / top) * 100}%` }} />}
            <div className="absolute inset-x-1 bottom-0 rounded-t-[0.4rem] bg-gradient-to-t from-accent-1 to-accent-2 shadow-[0_-4px_16px_-6px_var(--color-accent-2)] transition-[height] duration-500 ease-out" style={{ height: `${(d.loggedMinutes / top) * 100}%` }} title={`${d.date}: ${formatMinutes(d.loggedMinutes)}`} />
          </div>
          <span className="text-[11px] text-graphite num">{d.date.slice(8)}</span>
        </div>
      ))}
    </div>
  );
}
