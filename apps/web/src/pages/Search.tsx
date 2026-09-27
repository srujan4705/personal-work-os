import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { formatMinutes, titleCase } from '@pwos/shared';
import { api } from '../lib/api';
import { Empty, ErrorNote, LabelChip, Loading, PageHeader } from '../components/ui';

interface Results {
  tickets: { id: string; ticketKey: string | null; title: string; status: string | null }[];
  projects: { id: string; name: string }[];
  sprints: { id: string; name: string; status: string }[];
  journal: { id: string; date: string; snippet: string }[];
  entries: { id: string; date: string; ticketKey: string | null; description: string | null; durationMinutes: number; activityType: string }[];
  calendar: { id: string; title: string; date: string }[];
  github: { id: string; type: string; title: string; repo: string; url: string | null; date: string }[];
  repositories: { id: string; fullName: string; url: string }[];
}

export function SearchPage() {
  const [params] = useSearchParams();
  const q = params.get('q') ?? '';
  const r = useQuery({ queryKey: ['search', q], queryFn: () => api.get<Results>(`/search?q=${encodeURIComponent(q)}`), enabled: !!q });
  const d = r.data;
  const total = d ? Object.values(d).filter(Array.isArray).reduce((s, a) => s + a.length, 0) : 0;
  const group = (title: string, children: React.ReactNode, n: number) => n > 0 && (
    <section><h2 className="mb-1 font-bold">{title}</h2><ul className="divide-y divide-rule rounded-lg border border-rule bg-sheet text-sm">{children}</ul></section>
  );
  return (
    <div className="space-y-5">
      <PageHeader title={`Search: ${q}`} />
      {r.isLoading ? <Loading /> : r.error ? <ErrorNote error={r.error} /> : !total ? <Empty title="No matches">Try a ticket key, a word from a commit, or a meeting title.</Empty> : d && (
        <div className="space-y-4">
          {group('Tickets', d.tickets.map((t) => <li key={t.id} className="px-3 py-2"><Link to={`/work/${t.id}`} className="hover:underline"><b>{t.ticketKey}</b> {t.title}</Link> <span className="text-graphite">{t.status}</span></li>), d.tickets.length)}
          {group('Time entries', d.entries.map((e) => <li key={e.id} className="flex gap-3 px-3 py-2"><span className="num text-graphite">{e.date}</span><span className="flex-1">{e.ticketKey} {e.description ?? titleCase(e.activityType)}</span><span className="num">{formatMinutes(e.durationMinutes)}</span></li>), d.entries.length)}
          {group('Journal', d.journal.map((j) => <li key={j.id} className="px-3 py-2"><span className="num text-graphite">{j.date}</span> {j.snippet}</li>), d.journal.length)}
          {group('Meetings', d.calendar.map((c) => <li key={c.id} className="px-3 py-2"><span className="num text-graphite">{c.date}</span> {c.title}</li>), d.calendar.length)}
          {group('GitHub', d.github.map((g) => <li key={g.id} className="flex items-center gap-2 px-3 py-2"><LabelChip label="OBSERVED" /><span className="num text-graphite">{g.date}</span>{g.url ? <a className="hover:underline" href={g.url} target="_blank" rel="noreferrer noopener">{g.title}</a> : g.title}<span className="text-graphite">{g.repo}</span></li>), d.github.length)}
          {group('Projects & sprints', [...d.projects.map((p) => <li key={p.id} className="px-3 py-2">{p.name}</li>), ...d.sprints.map((s) => <li key={s.id} className="px-3 py-2">{s.name} <span className="text-graphite">{titleCase(s.status)}</span></li>)], d.projects.length + d.sprints.length)}
          {group('Repositories', d.repositories.map((r2) => <li key={r2.id} className="px-3 py-2"><a className="hover:underline" href={r2.url} target="_blank" rel="noreferrer noopener">{r2.fullName}</a></li>), d.repositories.length)}
        </div>
      )}
    </div>
  );
}
