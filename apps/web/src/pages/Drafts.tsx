import { useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { Button, Textarea } from '../components/ui';

/** Editable draft box: factual text first, optional AI rewrite, copy to clipboard. */
export function DraftBox({ initial, kind, params = {}, rows = 8 }: { initial: string; kind: 'weekly_summary' | 'next_week_focus' | 'retrospective' | 'standup'; params?: Record<string, string>; rows?: number }) {
  const [text, setText] = useState(initial);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const draft = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const r = await api.post<{ text: string; source: 'AI' | 'DETERMINISTIC'; notice?: string }>('/reports/drafts', { kind, ...params });
      setText(r.text);
      setStatus(r.source === 'AI' ? 'Drafted with AI from your data. Please review before using.' : r.notice ?? 'Factual draft.');
    } catch (e) {
      setStatus(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2">
      <Textarea rows={rows} value={text} onChange={(e) => setText(e.target.value)} aria-label="Draft text" />
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={draft} disabled={busy}>{busy ? 'Drafting…' : 'Draft with assistant'}</Button>
        <Button onClick={() => { void navigator.clipboard.writeText(text); setStatus('Copied.'); }}>Copy</Button>
        {status && <span className="text-xs text-graphite">{status}</span>}
      </div>
    </div>
  );
}
