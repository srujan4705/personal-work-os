import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { AssistantChat } from '../components/AssistantChat';
import { Button, PageHeader } from '../components/ui';

export function AssistantPage() {
  const qc = useQueryClient();
  const [conversation, setConversation] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['conversations'], queryFn: () => api.get<{ id: string; title: string | null; channel: string; updatedAt: string }[]>('/assistant/conversations') });
  const remove = useMutation({ mutationFn: (id: string | null) => api.del(id ? `/assistant/conversations/${id}` : '/assistant/conversations'), onSuccess: () => { setConversation(null); qc.invalidateQueries({ queryKey: ['conversations'] }); } });
  return (
    <div className="space-y-4">
      <PageHeader title="Assistant">
        <Button onClick={() => setConversation(null)}>New chat</Button>
        {!!list.data?.length && <Button variant="danger" onClick={() => window.confirm('Delete all conversations?') && remove.mutate(null)}>Delete all</Button>}
      </PageHeader>
      <div className="grid gap-4 md:grid-cols-[14rem_1fr]">
        <nav aria-label="Conversations" className="space-y-1">
          {list.data?.map((c) => (
            <div key={c.id} className={`group flex items-center rounded-md ${conversation === c.id ? 'bg-ink text-paper' : 'hover:bg-rule/60'}`}>
              <button className="min-w-0 flex-1 truncate px-2 py-1.5 text-left text-sm" onClick={() => setConversation(c.id)}>{c.channel === 'TELEGRAM' ? 'Telegram: ' : ''}{c.title ?? 'Conversation'}</button>
              <button className="px-2 text-xs opacity-60 hover:opacity-100" onClick={() => remove.mutate(c.id)} aria-label="Delete conversation">✕</button>
            </div>
          ))}
          {!list.data?.length && <p className="text-sm text-graphite">No conversations yet.</p>}
        </nav>
        <div className="h-[70dvh] overflow-hidden rounded-lg border border-rule bg-sheet">
          <AssistantChat conversationId={conversation} onConversation={(id) => { setConversation(id); qc.invalidateQueries({ queryKey: ['conversations'] }); }} />
        </div>
      </div>
    </div>
  );
}
