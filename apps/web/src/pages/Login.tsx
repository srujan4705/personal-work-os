import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../lib/api';
import { useAuth, type Me } from '../lib/auth';
import { Button, Field, Input } from '../components/ui';

export function LoginPage() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (me) return <Navigate to="/" replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ user: Me }>('/auth/login', { email, password });
      qc.setQueryData(['me'], r.user);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <form onSubmit={submit} className="glass panel w-full max-w-sm space-y-5 p-8">
        <div className="space-y-1.5">
          <span className="gradient-accent grid h-10 w-10 place-items-center rounded-control text-base font-bold text-white shadow-[0_8px_20px_-8px_var(--color-accent-1)]">W</span>
          <h1 className="font-display text-xl font-semibold tracking-tight text-ink">Work OS</h1>
          <p className="text-sm text-graphite">Your own record of what you worked on.</p>
        </div>
        <Field label="Email"><Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Password"><Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        {error && <p role="alert" className="rounded-control border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
        <Button variant="primary" type="submit" disabled={busy} className="w-full py-2">{busy ? 'Signing in…' : 'Sign in'}</Button>
      </form>
    </main>
  );
}
