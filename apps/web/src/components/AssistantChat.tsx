import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../lib/api';
import { Button, Textarea } from './ui';

interface Msg { id: string; role: 'USER' | 'ASSISTANT'; content: string }
interface Pending { actionId: string; summary: string }
interface Reply { conversationId: string; reply: string; actions: Pending[]; mode: 'AI' | 'DETERMINISTIC' }

/** Pending actions are shown as Confirm cards, so their "Please confirm: …" lines would duplicate them. */
const hideConfirmLines = (text: string, pending: Pending[]) =>
  text.split('\n').filter((l) => !pending.some((a) => l === `Please confirm: ${a.summary}`)).join('\n').trim();

const SUGGESTED = ['What did I do today?', 'What meetings do I have tomorrow?', 'How many hours have I logged today?', 'Generate my standup', 'Show my current sprint', 'What am I missing in my timesheet?'];

/** Chat with the assistant. Every change it proposes needs an explicit Confirm. */
export function AssistantChat({ conversationId, onConversation }: { conversationId: string | null; onConversation: (id: string | null) => void }) {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['assistant-status'], queryFn: () => api.get<{ available: boolean; provider: string | null; reason: string | null; assistantName: string; isRemote: boolean; dataMode: string }>('/assistant/status') });
  const [messages, setMessages] = useState<Msg[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      setPending([]);
      return undefined;
    }
    api.get<{ messages: Msg[]; pendingActions: Pending[] }>(`/assistant/conversations/${conversationId}`)
      .then((c) => {
        setMessages(c.messages.map((m) => (m.role === 'ASSISTANT' ? { ...m, content: hideConfirmLines(m.content, c.pendingActions) } : m)).filter((m) => m.content));
        setPending(c.pendingActions);
      })
      .catch(() => onConversation(null));
    return undefined;
  }, [conversationId, onConversation]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, pending]);

  const send = async (message: string) => {
    if (!message.trim() || busy) return;
    setBusy(true);
    setError(null);
    setMessages((m) => [...m, { id: `local-${Date.now()}`, role: 'USER', content: message }]);
    setText('');
    try {
      const r = await api.post<Reply>('/assistant/message', { message, conversationId: conversationId ?? undefined });
      const shown = hideConfirmLines(r.reply, r.actions);
      if (shown) setMessages((m) => [...m, { id: `local-${Date.now()}-a`, role: 'ASSISTANT', content: shown }]);
      setPending(r.actions);
      if (r.conversationId !== conversationId) onConversation(r.conversationId);
      qc.invalidateQueries({ queryKey: ['conversations'] });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const resolve = async (actionId: string, confirm: boolean) => {
    try {
      const r = await api.post<{ reply: string }>(confirm ? '/assistant/confirm-action' : '/assistant/cancel-action', { actionId });
      setPending((p) => p.filter((a) => a.actionId !== actionId));
      setMessages((m) => [...m, { id: `local-${Date.now()}-c`, role: 'ASSISTANT', content: r.reply }]);
      if (confirm) qc.invalidateQueries();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3" aria-live="polite">
        {status.data && !status.data.available && (
          <p className="rounded-control border border-ink/[0.07] bg-ink/[0.04] px-3 py-2 text-xs text-graphite">AI is off ({status.data.reason}) Commands like /today, /tomorrow, /timesheet, /sprint, /summary and /standup still work.</p>
        )}
        {status.data?.available && status.data.isRemote && (
          <p className="text-xs text-graphite">Answers use {status.data.provider}. Only the data needed for your question is sent ({status.data.dataMode === 'MINIMAL_REMOTE' ? 'minimal: no emails, descriptions or meeting links' : 'full context'}).</p>
        )}
        {!messages.length && (
          <div className="space-y-2">
            <p className="text-sm text-graphite">Ask about your work. Changes are only made after you confirm them.</p>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTED.map((s) => (
                <button key={s} onClick={() => send(s)} className="glass rounded-full px-3 py-1 text-xs text-ink/90 transition-colors hover:border-accent-2/60 hover:text-ink">{s}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={m.role === 'USER' ? 'gradient-accent ml-10 rounded-card rounded-br-md px-3.5 py-2 text-sm text-white shadow-[0_8px_20px_-10px_var(--color-accent-1)]' : 'glass mr-6 whitespace-pre-wrap rounded-card rounded-bl-md px-3.5 py-2 text-sm'}>{m.content}</div>
        ))}
        {pending.map((a) => (
          <div key={a.actionId} className="rounded-card border border-dashed border-suggested/70 bg-suggested/[0.07] p-4 text-sm">
            <p className="font-display font-semibold text-ink">Confirm this change?</p>
            <p className="mt-1">{a.summary}</p>
            <div className="mt-2 flex gap-2">
              <Button variant="primary" onClick={() => resolve(a.actionId, true)}>Confirm</Button>
              <Button onClick={() => resolve(a.actionId, false)}>Cancel</Button>
            </div>
          </div>
        ))}
        {busy && (
          <p className="flex items-center gap-1.5 text-sm text-graphite" aria-label="Thinking">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent-1 [animation-delay:-0.3s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent-1 [animation-delay:-0.15s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent-2" />
          </p>
        )}
        {error && <p role="alert" className="rounded-control border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
        <div ref={endRef} />
      </div>
      <form className="flex items-end gap-2 border-t border-rule/70 p-3" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
        <Textarea
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(text); } }}
          placeholder="Ask or type /help"
          aria-label="Message"
          className="max-h-32 resize-none"
        />
        <Button variant="primary" type="submit" disabled={busy || !text.trim()}>Send</Button>
      </form>
    </div>
  );
}
