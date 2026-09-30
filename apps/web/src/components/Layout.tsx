import { useEffect, useState, type ReactNode, type SVGProps } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { AssistantChat } from './AssistantChat';
import { Button, Input } from './ui';

type Icon = (p: SVGProps<SVGSVGElement>) => ReactNode;
const icon =
  (d: string): Icon =>
  (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d={d} />
    </svg>
  );

type IconName = 'today' | 'timesheet' | 'calendar' | 'work' | 'timeline' | 'journal' | 'sprints' | 'reports' | 'assistant' | 'settings';
const ICONS: Record<IconName, Icon> = {
  today: icon('M12 3v3M12 18v3M5 5l2 2M17 17l2 2M3 12h3M18 12h3M5 19l2-2M17 7l2-2M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z'),
  timesheet: icon('M8 2v3M16 2v3M3.5 9h17M5 5h14a1.5 1.5 0 0 1 1.5 1.5v13A1.5 1.5 0 0 1 19 21H5a1.5 1.5 0 0 1-1.5-1.5v-13A1.5 1.5 0 0 1 5 5Zm2.5 7h3M7.5 15.5h9'),
  calendar: icon('M8 2v3M16 2v3M3.5 9h17M5 5h14a1.5 1.5 0 0 1 1.5 1.5v13A1.5 1.5 0 0 1 19 21H5a1.5 1.5 0 0 1-1.5-1.5v-13A1.5 1.5 0 0 1 5 5Z'),
  work: icon('M9 6V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V6M4.5 8h15a1 1 0 0 1 1 1v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V9a1 1 0 0 1 1-1Zm0 5h15'),
  timeline: icon('M4 6h11M4 12h16M4 18h8M17 4v4M15 10v4'),
  journal: icon('M6 3.5h9.5L19 7v13.5H6a1.5 1.5 0 0 1-1.5-1.5V5A1.5 1.5 0 0 1 6 3.5Zm9 0V7h4M9 11h6M9 14.5h6'),
  sprints: icon('M13 3 4 14h6l-1 7 9-11h-6l1-7Z'),
  reports: icon('M4 20V10M10 20V4M16 20v-7M4 20h16'),
  assistant: icon('M12 3a7 7 0 0 0-7 7c0 2.3 1.1 4.2 2.5 5.4V19a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-.3a6.9 6.9 0 0 0 3 0V19a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-3.6A6.98 6.98 0 0 0 19 10a7 7 0 0 0-7-7Zm-2.2 8.2 1.7 1.7 3.2-3.4'),
  settings: icon('M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm7.4-3.5a7.6 7.6 0 0 0-.14-1.44l1.9-1.48-1.9-3.3-2.24.9a7.6 7.6 0 0 0-1.25-.72L15.4 3H12.6l-.37 2.46c-.44.18-.86.42-1.25.72l-2.24-.9-1.9 3.3 1.9 1.48a7.6 7.6 0 0 0 0 2.88l-1.9 1.48 1.9 3.3 2.24-.9c.39.3.81.54 1.25.72L12.6 21h2.8l.37-2.46c.44-.18.86-.42 1.25-.72l2.24.9 1.9-3.3-1.9-1.48c.09-.47.14-.95.14-1.44Z'),
};

const NAV: { to: string; label: string; end?: boolean; icon: IconName }[] = [
  { to: '/', label: 'Today', end: true, icon: 'today' },
  { to: '/timesheet', label: 'Timesheet', icon: 'timesheet' },
  { to: '/calendar', label: 'Calendar', icon: 'calendar' },
  { to: '/work', label: 'My work', icon: 'work' },
  { to: '/timeline', label: 'Timeline', icon: 'timeline' },
  { to: '/journal', label: 'Journal', icon: 'journal' },
  { to: '/sprints', label: 'Sprints', icon: 'sprints' },
  { to: '/reports', label: 'Reports', icon: 'reports' },
  { to: '/assistant', label: 'Assistant', icon: 'assistant' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
];
const MOBILE = ['/', '/timesheet', '/calendar', '/journal'];

export function Layout({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [drawer, setDrawer] = useState(false);
  const [more, setMore] = useState(false);
  const [conversation, setConversation] = useState<string | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setDrawer((d) => !d);
      }
      if (e.key === 'Escape') setDrawer(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const logout = async () => {
    await api.post('/auth/logout').catch(() => {});
    // Mark signed-out first (the auth observer must see it), then drop every cached query with personal data.
    qc.setQueryData(['me'], null);
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
    navigate('/login', { replace: true });
  };

  const navClass = ({ isActive }: { isActive: boolean }) =>
    `group relative flex items-center gap-2.5 rounded-control px-3 py-2 text-sm font-bold transition-colors duration-150 ${
      isActive ? 'text-ink' : 'text-graphite hover:text-ink hover:bg-ink/[0.05]'
    }`;

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_1fr]">
      <aside className="hidden md:sticky md:top-0 md:flex md:h-dvh md:flex-col md:gap-5 md:overflow-y-auto md:p-3">
        <div className="glass panel flex h-full flex-col gap-5 p-4">
          <div className="flex items-center gap-2.5 px-1">
            <span className="gradient-accent grid h-8 w-8 place-items-center rounded-control text-sm font-bold text-white shadow-[0_6px_16px_-6px_var(--color-accent-1)]">W</span>
            <div className="min-w-0">
              <p className="font-display text-sm font-semibold leading-tight text-ink">Work OS</p>
              <p className="truncate text-xs text-graphite">{me?.name}</p>
            </div>
          </div>
          <nav className="flex flex-1 flex-col gap-0.5" aria-label="Main">
            {NAV.map((n) => {
              const Icon = ICONS[n.icon];
              return (
                <NavLink key={n.to} to={n.to} end={n.end} className={navClass}>
                  {({ isActive }) => (
                    <>
                      {isActive && <span className="gradient-accent absolute inset-0 -z-10 rounded-control opacity-[0.14]" aria-hidden="true" />}
                      {isActive && <span className="gradient-accent absolute inset-y-1 left-0 w-[3px] rounded-full" aria-hidden="true" />}
                      <Icon className="h-[18px] w-[18px] shrink-0" />
                      {n.label}
                    </>
                  )}
                </NavLink>
              );
            })}
          </nav>
          <div className="border-t border-rule/70 px-1 pt-3 text-xs text-graphite">
            <button onClick={logout} className="rounded-control px-2 py-1 transition-colors hover:bg-ink/[0.05] hover:text-ink">
              Sign out
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col overflow-x-clip">
        <div className="glass sticky top-0 z-20 flex items-center gap-2 px-4 py-2.5 md:mx-3 md:mt-3 md:rounded-card">
          <form className="flex-1" onSubmit={(e) => { e.preventDefault(); if (q.trim()) navigate(`/search?q=${encodeURIComponent(q.trim())}`); }}>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tickets, notes, meetings, commits" aria-label="Search" className="w-full max-w-md" />
          </form>
          <Button variant="primary" onClick={() => setDrawer(true)} title="Assistant (Ctrl/⌘ K)">Ask</Button>
        </div>
        <main key={location.pathname} className="enter mx-auto w-full max-w-5xl flex-1 px-4 pb-24 pt-5 md:pb-10">{children}</main>
      </div>

      <nav aria-label="Main mobile" className="glass-strong fixed inset-x-2 bottom-2 z-30 grid grid-cols-5 rounded-card pb-[env(safe-area-inset-bottom)] md:hidden">
        {NAV.filter((n) => MOBILE.includes(n.to)).map((n) => {
          const Icon = ICONS[n.icon];
          return (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `flex flex-col items-center gap-0.5 py-2.5 text-[11px] ${isActive ? 'font-bold text-ink' : 'text-graphite'}`}>
              <Icon className="h-5 w-5" />
              {n.label}
            </NavLink>
          );
        })}
        <button onClick={() => setMore((m) => !m)} className="flex flex-col items-center gap-0.5 py-2.5 text-[11px] text-graphite" aria-expanded={more}>
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>
          More
        </button>
      </nav>
      {more && (
        <div className="glass-strong fixed inset-x-2 bottom-16 z-30 rounded-card p-3 md:hidden" onClick={() => setMore(false)}>
          <div className="grid grid-cols-3 gap-1">
            {NAV.filter((n) => !MOBILE.includes(n.to)).map((n) => (
              <NavLink key={n.to} to={n.to} className={navClass}>{n.label}</NavLink>
            ))}
            <button onClick={logout} className="rounded-control px-3 py-2 text-left text-sm font-bold text-graphite">Sign out</button>
          </div>
        </div>
      )}

      {drawer && (
        <div className="fixed inset-0 z-40 flex justify-end bg-ink/40 backdrop-blur-sm" onClick={() => setDrawer(false)}>
          <div role="dialog" aria-label="Assistant" className="glass-strong flex h-full w-full max-w-md flex-col shadow-[var(--shadow-overlay)]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-rule/70 px-4 py-3">
              <p className="font-display font-semibold text-ink">Assistant</p>
              <div className="flex gap-1">
                <Button variant="ghost" onClick={() => setConversation(null)}>New chat</Button>
                <Button variant="ghost" onClick={() => setDrawer(false)} aria-label="Close assistant">Close</Button>
              </div>
            </div>
            <AssistantChat conversationId={conversation} onConversation={setConversation} />
          </div>
        </div>
      )}
    </div>
  );
}
