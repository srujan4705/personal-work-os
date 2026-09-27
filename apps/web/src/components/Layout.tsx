import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { AssistantChat } from './AssistantChat';
import { Button, Input } from './ui';

const NAV = [
  { to: '/', label: 'Today', end: true },
  { to: '/timesheet', label: 'Timesheet' },
  { to: '/calendar', label: 'Calendar' },
  { to: '/work', label: 'My work' },
  { to: '/timeline', label: 'Timeline' },
  { to: '/journal', label: 'Journal' },
  { to: '/sprints', label: 'Sprints' },
  { to: '/reports', label: 'Reports' },
  { to: '/assistant', label: 'Assistant' },
  { to: '/settings', label: 'Settings' },
];
const MOBILE = ['/', '/timesheet', '/calendar', '/journal'];

export function Layout({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
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

  const link = ({ isActive }: { isActive: boolean }) => `block rounded-md px-3 py-1.5 text-sm ${isActive ? 'bg-ink font-bold text-paper' : 'text-graphite hover:bg-rule/60 hover:text-ink'}`;

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[13rem_1fr]">
      <aside className="hidden border-r border-rule px-3 py-5 md:flex md:flex-col md:gap-4">
        <div className="px-3">
          <p className="text-lg font-bold">Work OS</p>
          <p className="truncate text-xs text-graphite">{me?.name}</p>
        </div>
        <nav className="flex flex-col gap-0.5" aria-label="Main">
          {NAV.map((n) => <NavLink key={n.to} to={n.to} end={n.end} className={link}>{n.label}</NavLink>)}
        </nav>
        <div className="mt-auto px-3 text-xs text-graphite">
          <button onClick={logout} className="hover:text-ink">Sign out</button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col overflow-x-clip">
        <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-rule bg-paper/95 px-4 py-2 backdrop-blur">
          <form className="flex-1" onSubmit={(e) => { e.preventDefault(); if (q.trim()) navigate(`/search?q=${encodeURIComponent(q.trim())}`); }}>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tickets, notes, meetings, commits" aria-label="Search" className="w-full max-w-md" />
          </form>
          <Button variant="primary" onClick={() => setDrawer(true)} title="Assistant (Ctrl/⌘ K)">Ask</Button>
        </div>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-24 pt-5 md:pb-10">{children}</main>
      </div>

      <nav aria-label="Main mobile" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-rule bg-sheet pb-[env(safe-area-inset-bottom)] md:hidden">
        {NAV.filter((n) => MOBILE.includes(n.to)).map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `py-2.5 text-center text-xs ${isActive ? 'font-bold text-ink' : 'text-graphite'}`}>{n.label}</NavLink>
        ))}
        <button onClick={() => setMore((m) => !m)} className="py-2.5 text-xs text-graphite" aria-expanded={more}>More</button>
      </nav>
      {more && (
        <div className="fixed inset-x-0 bottom-12 z-30 border-t border-rule bg-sheet p-3 md:hidden" onClick={() => setMore(false)}>
          <div className="grid grid-cols-3 gap-1">
            {NAV.filter((n) => !MOBILE.includes(n.to)).map((n) => <NavLink key={n.to} to={n.to} className={link}>{n.label}</NavLink>)}
            <button onClick={logout} className="rounded-md px-3 py-1.5 text-left text-sm text-graphite">Sign out</button>
          </div>
        </div>
      )}

      {drawer && (
        <div className="fixed inset-0 z-40 flex justify-end bg-ink/30" onClick={() => setDrawer(false)}>
          <div role="dialog" aria-label="Assistant" className="flex h-full w-full max-w-md flex-col bg-sheet shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-rule px-3 py-2">
              <p className="font-bold">Assistant</p>
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
