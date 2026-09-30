import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { titleCase } from '@pwos/shared';
import { api, errorMessage } from '../lib/api';
import { Button, ErrorNote, Field, Input, Loading, PageHeader, Section, Select, Tag, buttonClass } from '../components/ui';

type Settings = Record<string, unknown> & {
  timezone: string; workStartTime: string; workEndTime: string; expectedDailyMinutes: number; workingDays: number[];
  lunchStart: string | null; lunchEnd: string | null; version: number; notificationChannel: string; notificationFallbackChannel: string | null;
  aiEnabled: boolean; aiProvider: string; aiDataMode: string; aiConfirmationPolicy: string; aiDailyRequestLimit: number; assistantName: string;
  zohoSyncEnabled: boolean; githubSyncEnabled: boolean; jiraSyncEnabled: boolean; allowTimesheetReopen: boolean;
};
interface SyncStatus {
  zoho: { configured: boolean; status: string; portalId: string | null; sprintsTeamId: string | null; lastError: string | null; dataCenter: string };
  github: { configured: boolean; status: string; login: string | null; lastError: string | null };
  jira: { status: string; baseUrl: string | null; email: string | null; lastError: string | null };
  states: { provider: string; resource: string; lastSuccessAt: string | null; lastError: string | null }[];
}

const REMINDERS = [
  ['dailyReminderEnabled', 'dailyReminderTime', 'Timesheet reminder'],
  ['confirmationReminderEnabled', 'confirmationReminderTime', 'Timesheet confirmation'],
  ['tomorrowSummaryEnabled', 'tomorrowSummaryTime', 'Tomorrow’s schedule'],
  ['morningSummaryEnabled', 'morningSummaryTime', 'Morning summary'],
] as const;
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const CHANNELS = ['TELEGRAM', 'EMAIL', 'BROWSER_PUSH', 'IN_APP'];

function urlBase64ToUint8Array(base64: string) {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

export function SettingsPage() {
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const s = useQuery({ queryKey: ['settings'], queryFn: () => api.get<Settings>('/settings') });
  const sync = useQuery({ queryKey: ['sync-status'], queryFn: () => api.get<SyncStatus>('/sync/status') });
  const tg = useQuery({ queryKey: ['telegram'], queryFn: () => api.get<{ configured: boolean; linked: boolean; mode: string; botUsername: string | null }>('/telegram/status') });
  const channels = useQuery({ queryKey: ['channels'], queryFn: () => api.get<Record<string, boolean>>('/notifications/channels') });
  const history = useQuery({ queryKey: ['notif-history'], queryFn: () => api.get<{ id: string; type: string; title: string; status: string; createdAt: string; deliveries: { channel: string; status: string; error: string | null }[] }[]>('/notifications/history') });
  const ai = useQuery({ queryKey: ['assistant-status'], queryFn: () => api.get<{ available: boolean; reason: string | null; usageToday: { requests: number }; dailyLimit: number }>('/assistant/status') });
  const repos = useQuery({ queryKey: ['repos'], queryFn: () => api.get<{ id: string; fullName: string; isSelected: boolean }[]>('/integrations/github/repositories') });
  const [form, setForm] = useState<Settings | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [link, setLink] = useState<{ code: string; deepLink: string | null; instructions: string } | null>(null);
  const [zohoOpts, setZohoOpts] = useState<{ portals: { id: string; name: string }[]; teams: { id: string; name: string }[] } | null>(null);
  const [jiraForm, setJiraForm] = useState({ baseUrl: '', email: '', apiToken: '' });
  useEffect(() => { if (s.data) setForm(s.data); }, [s.data]);

  const run = useMutation({ mutationFn: async (fn: () => Promise<unknown>) => fn(), onSuccess: () => qc.invalidateQueries(), onError: (e) => setMsg(errorMessage(e)) });
  if (!form) return s.isLoading ? <Loading /> : <ErrorNote error={s.error} />;
  const set = (k: string, v: unknown) => setForm({ ...form, [k]: v });

  const save = () => {
    const keys = ['timezone', 'workStartTime', 'workEndTime', 'expectedDailyMinutes', 'workingDays', 'lunchStart', 'lunchEnd', 'allowTimesheetReopen', 'meetingReminderEnabled', 'meetingReminderMinutes', 'notificationChannel', 'notificationFallbackChannel', 'aiEnabled', 'aiProvider', 'aiDataMode', 'aiConfirmationPolicy', 'aiDailyRequestLimit', 'assistantName', 'zohoSyncEnabled', 'githubSyncEnabled', 'jiraSyncEnabled', 'version', ...REMINDERS.flatMap(([a, b]) => [a, b])];
    const body = Object.fromEntries(keys.map((k) => [k, form[k] === '' ? null : form[k]]));
    setMsg(null);
    run.mutate(() => api.patch('/settings', body).then(() => setMsg('Settings saved.')));
  };

  const enablePush = async () => {
    try {
      const { publicKey, configured } = await api.get<{ publicKey: string | null; configured: boolean }>('/notifications/push/public-key');
      if (!configured || !publicKey) return setMsg('Browser push is not configured on the server (VAPID keys).');
      if ((await Notification.requestPermission()) !== 'granted') return setMsg('Notification permission was not granted.');
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
      await api.post('/notifications/push/subscribe', sub.toJSON());
      setMsg('Browser notifications enabled on this device.');
      qc.invalidateQueries({ queryKey: ['channels'] });
    } catch (e) {
      setMsg(errorMessage(e));
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Settings"><Button variant="primary" onClick={save}>Save settings</Button></PageHeader>
      {params.get('zoho') === 'connected' && <p className="rounded-control border border-confirmed/30 bg-confirmed/10 px-3 py-2 text-sm text-confirmed">Zoho connected (read-only). Pick your portal and team below, then sync.</p>}
      {msg && <p role="status" className="rounded-control border border-accent-2/30 bg-accent-2/[0.08] px-3 py-2 text-sm text-ink">{msg}</p>}

      <Section title="Working hours">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Timezone"><Input value={form.timezone} onChange={(e) => set('timezone', e.target.value)} /></Field>
          <Field label="Start"><Input type="time" value={form.workStartTime} onChange={(e) => set('workStartTime', e.target.value)} /></Field>
          <Field label="End"><Input type="time" value={form.workEndTime} onChange={(e) => set('workEndTime', e.target.value)} /></Field>
          <Field label="Expected minutes per day" hint="Used for “remaining”. Never enforced."><Input type="number" min={0} max={1440} value={form.expectedDailyMinutes} onChange={(e) => set('expectedDailyMinutes', Number(e.target.value))} /></Field>
          <Field label="Lunch start"><Input type="time" value={form.lunchStart ?? ''} onChange={(e) => set('lunchStart', e.target.value || null)} /></Field>
          <Field label="Lunch end"><Input type="time" value={form.lunchEnd ?? ''} onChange={(e) => set('lunchEnd', e.target.value || null)} /></Field>
        </div>
        <fieldset className="mt-3 flex flex-wrap gap-3 text-sm">
          <legend className="mb-1 font-bold">Working days</legend>
          {DAYS.map((d, i) => (
            <label key={d} className="flex items-center gap-1">
              <input type="checkbox" checked={form.workingDays.includes(i + 1)} onChange={(e) => set('workingDays', e.target.checked ? [...form.workingDays, i + 1].sort() : form.workingDays.filter((x) => x !== i + 1))} />{d}
            </label>
          ))}
          <label className="ml-4 flex items-center gap-1"><input type="checkbox" checked={form.allowTimesheetReopen} onChange={(e) => set('allowTimesheetReopen', e.target.checked)} />Allow reopening submitted days</label>
        </fieldset>
      </Section>

      <Section title="Reminders and notifications">
        <div className="grid gap-3 sm:grid-cols-2">
          {REMINDERS.map(([en, time, label]) => (
            <div key={en} className="flex items-end gap-2">
              <label className="flex flex-1 items-center gap-2 text-sm"><input type="checkbox" checked={!!form[en]} onChange={(e) => set(en, e.target.checked)} />{label}</label>
              <Input type="time" value={String(form[time])} onChange={(e) => set(time, e.target.value)} aria-label={`${label} time`} />
            </div>
          ))}
          <div className="flex items-end gap-2">
            <label className="flex flex-1 items-center gap-2 text-sm"><input type="checkbox" checked={!!form.meetingReminderEnabled} onChange={(e) => set('meetingReminderEnabled', e.target.checked)} />Meeting reminder (minutes before)</label>
            <Input type="number" min={1} max={240} className="w-20" value={Number(form.meetingReminderMinutes)} onChange={(e) => set('meetingReminderMinutes', Number(e.target.value))} aria-label="Minutes before meeting" />
          </div>
          <Field label="Send notifications via">
            <Select value={form.notificationChannel} onChange={(e) => set('notificationChannel', e.target.value)}>{CHANNELS.map((c) => <option key={c} value={c}>{titleCase(c)}{channels.data && !channels.data[c] ? ' (not set up)' : ''}</option>)}</Select>
          </Field>
          <Field label="If that fails, use">
            <Select value={form.notificationFallbackChannel ?? ''} onChange={(e) => set('notificationFallbackChannel', e.target.value || null)}><option value="">Nothing</option>{CHANNELS.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}</Select>
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {CHANNELS.filter((c) => c !== 'IN_APP').map((c) => <Button key={c} onClick={() => run.mutate(() => api.post<{ sent: boolean; reason?: string }>('/notifications/test', { channel: c }).then((r) => setMsg(r.sent ? `Test sent via ${titleCase(c)}.` : r.reason ?? 'Not sent.')))}>Test {titleCase(c).toLowerCase()}</Button>)}
          <Button onClick={enablePush}>Enable browser notifications here</Button>
        </div>
      </Section>

      <Section title="Telegram">
        {!tg.data?.configured ? <p className="text-sm text-graphite">Not configured on the server. See MANUAL_SETUP.md, section E.</p> : tg.data.linked ? (
          <div className="flex items-center gap-3 text-sm"><Tag tone="good">Linked</Tag><Button variant="danger" onClick={() => run.mutate(() => api.del('/telegram/link'))}>Unlink</Button></div>
        ) : (
          <div className="space-y-2 text-sm">
            <Button onClick={() => run.mutate(() => api.post<{ code: string; deepLink: string | null; instructions: string }>('/telegram/link-code').then(setLink))}>Create link code</Button>
            {link && <p>{link.deepLink ? <a className="font-bold underline" href={link.deepLink} target="_blank" rel="noreferrer noopener">Open the bot and link</a> : link.instructions} <span className="text-graphite">(valid 10 minutes, single use)</span></p>}
          </div>
        )}
      </Section>

      <Section title="Integrations">
        <div className="space-y-4 text-sm">
          <div>
            <p className="flex flex-wrap items-center gap-2"><b>Zoho</b><Tag tone={sync.data?.zoho.status === 'CONNECTED' ? 'good' : sync.data?.zoho.status === 'ERROR' ? 'bad' : 'neutral'}>{titleCase(sync.data?.zoho.status ?? 'DISCONNECTED')}</Tag><span className="text-graphite">read-only · data centre {sync.data?.zoho.dataCenter}</span></p>
            {sync.data?.zoho.lastError && <p className="text-danger">{sync.data.zoho.lastError}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {sync.data?.zoho.status === 'DISCONNECTED' || !sync.data ? (
                sync.data?.zoho.configured ? <a className={buttonClass('primary')} href="/api/v1/integrations/zoho/connect">Connect Zoho (read-only)</a> : <span className="text-graphite">Add ZOHO_CLIENT_ID / SECRET to the server first (MANUAL_SETUP.md, section H).</span>
              ) : (
                <>
                  <Button variant="primary" onClick={() => run.mutate(() => api.post('/sync/zoho').then(() => setMsg('Zoho sync finished.')))}>Sync now</Button>
                  <Button onClick={() => run.mutate(() => api.get<typeof zohoOpts>('/integrations/zoho/options').then(setZohoOpts))}>Choose portal / team</Button>
                  <label className="flex items-center gap-1"><input type="checkbox" checked={form.zohoSyncEnabled} onChange={(e) => set('zohoSyncEnabled', e.target.checked)} />Automatic sync</label>
                  <Button variant="danger" onClick={() => window.confirm('Disconnect Zoho? Synced data stays; no more updates.') && run.mutate(() => api.del('/integrations/zoho'))}>Disconnect</Button>
                </>
              )}
            </div>
            {zohoOpts && (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <Field label="Zoho Projects portal"><Select defaultValue={sync.data?.zoho.portalId ?? ''} onChange={(e) => run.mutate(() => api.patch('/integrations/zoho', { portalId: e.target.value || null }))}><option value="">Not used</option>{zohoOpts.portals.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
                <Field label="Zoho Sprints team"><Select defaultValue={sync.data?.zoho.sprintsTeamId ?? ''} onChange={(e) => run.mutate(() => api.patch('/integrations/zoho', { sprintsTeamId: e.target.value || null }))}><option value="">Not used</option>{zohoOpts.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
              </div>
            )}
          </div>
          <div>
            <p className="flex flex-wrap items-center gap-2"><b>GitHub</b><Tag tone={sync.data?.github.status === 'CONNECTED' ? 'good' : sync.data?.github.status === 'ERROR' ? 'bad' : 'neutral'}>{titleCase(sync.data?.github.status ?? 'DISCONNECTED')}</Tag>{sync.data?.github.login && <span className="text-graphite">as {sync.data.github.login} · read-only</span>}</p>
            {sync.data?.github.lastError && <p className="text-danger">{sync.data.github.lastError}</p>}
            {sync.data?.github.configured ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button variant="primary" onClick={() => run.mutate(() => api.post('/sync/github').then(() => setMsg('GitHub sync finished.')))}>Sync now</Button>
                <label className="flex items-center gap-1"><input type="checkbox" checked={form.githubSyncEnabled} onChange={(e) => set('githubSyncEnabled', e.target.checked)} />Automatic sync</label>
              </div>
            ) : <p className="text-graphite">Add a read-only GITHUB_TOKEN to the server (MANUAL_SETUP.md, section G).</p>}
            {!!repos.data?.length && (
              <details className="mt-2"><summary className="cursor-pointer">Repositories ({repos.data.filter((r) => r.isSelected).length} tracked)</summary>
                <ul className="mt-1 max-h-60 space-y-0.5 overflow-auto">{repos.data.map((r) => <li key={r.id}><label className="flex items-center gap-2"><input type="checkbox" checked={r.isSelected} onChange={(e) => run.mutate(() => api.patch(`/integrations/github/repositories/${r.id}`, { isSelected: e.target.checked }))} />{r.fullName}</label></li>)}</ul>
              </details>
            )}
          </div>
          <div>
            <p className="flex flex-wrap items-center gap-2"><b>Jira</b><Tag tone={sync.data?.jira?.status === 'CONNECTED' ? 'good' : sync.data?.jira?.status === 'ERROR' ? 'bad' : 'neutral'}>{titleCase(sync.data?.jira?.status ?? 'DISCONNECTED')}</Tag>{sync.data?.jira?.email && <span className="text-graphite">as {sync.data.jira?.email} · read-only</span>}</p>
            {sync.data?.jira?.lastError && <p className="text-danger">{sync.data.jira?.lastError}</p>}
            {(sync.data?.jira?.status ?? 'DISCONNECTED') === 'DISCONNECTED' ? (
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                <Field label="Jira site URL"><Input placeholder="https://yourcompany.atlassian.net" value={jiraForm.baseUrl} onChange={(e) => setJiraForm({ ...jiraForm, baseUrl: e.target.value })} /></Field>
                <Field label="Jira email"><Input type="email" value={jiraForm.email} onChange={(e) => setJiraForm({ ...jiraForm, email: e.target.value })} /></Field>
                <Field label="API token" hint="Create one at id.atlassian.com/manage-profile/security/api-tokens"><Input type="password" value={jiraForm.apiToken} onChange={(e) => setJiraForm({ ...jiraForm, apiToken: e.target.value })} /></Field>
                <div className="sm:col-span-3">
                  <Button variant="primary" onClick={() => run.mutate(() => api.post('/integrations/jira/connect', jiraForm).then(() => { setJiraForm({ baseUrl: '', email: '', apiToken: '' }); setMsg('Jira connected.'); }))}>Connect Jira (read-only)</Button>
                </div>
              </div>
            ) : (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button variant="primary" onClick={() => run.mutate(() => api.post('/sync/jira').then(() => setMsg('Jira sync finished.')))}>Sync now</Button>
                <label className="flex items-center gap-1"><input type="checkbox" checked={!!form.jiraSyncEnabled} onChange={(e) => set('jiraSyncEnabled', e.target.checked)} />Automatic sync</label>
                <Button variant="danger" onClick={() => window.confirm('Disconnect Jira? Synced data stays; no more updates.') && run.mutate(() => api.del('/integrations/jira'))}>Disconnect</Button>
              </div>
            )}
          </div>
          {!!sync.data?.states.length && (
            <details><summary className="cursor-pointer">Sync details</summary>
              <ul className="mt-1 space-y-0.5 text-xs">{sync.data.states.map((st) => <li key={st.provider + st.resource}><b>{st.provider}</b> {st.resource}: {st.lastError ? <span className="text-danger">{st.lastError}</span> : st.lastSuccessAt ? `ok ${new Date(st.lastSuccessAt).toLocaleString()}` : 'never'}</li>)}</ul>
            </details>
          )}
        </div>
      </Section>

      <Section title="Assistant (AI)">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.aiEnabled} onChange={(e) => set('aiEnabled', e.target.checked)} />Use an AI provider</label>
          <Field label="Provider"><Select value={form.aiProvider} onChange={(e) => set('aiProvider', e.target.value)}><option value="NONE">None</option><option value="GEMINI">Gemini</option><option value="OPENROUTER">OpenRouter</option><option value="OLLAMA">Ollama (local)</option></Select></Field>
          <Field label="Assistant name"><Input value={form.assistantName} onChange={(e) => set('assistantName', e.target.value)} /></Field>
          <Field label="Data sent to AI" hint="Minimal leaves out emails, descriptions and links. Local-only needs Ollama.">
            <Select value={form.aiDataMode} onChange={(e) => set('aiDataMode', e.target.value)}><option value="LOCAL_ONLY">Local only</option><option value="MINIMAL_REMOTE">Minimal</option><option value="FULL_CONTEXT">Full context</option></Select>
          </Field>
          <Field label="Confirm before">
            <Select value={form.aiConfirmationPolicy} onChange={(e) => set('aiConfirmationPolicy', e.target.value)}><option value="ALWAYS_CONFIRM_WRITES">Every change</option><option value="CONFIRM_DANGEROUS_ONLY">Deletes, leave and submit only</option></Select>
          </Field>
          <Field label="Daily request limit" hint={ai.data ? `${ai.data.usageToday.requests} used today` : undefined}><Input type="number" min={0} value={form.aiDailyRequestLimit} onChange={(e) => set('aiDailyRequestLimit', Number(e.target.value))} /></Field>
        </div>
        <p className="mt-3 text-xs text-graphite">{ai.data?.available ? 'AI is available.' : `AI is off: ${ai.data?.reason ?? ''}`} The assistant can never change Zoho or GitHub, and every change inside Work OS goes through the confirmation rules above.</p>
      </Section>

      <Section title="Your data">
        <div className="flex flex-wrap gap-2">
          <a className={buttonClass('quiet')} href="/api/v1/exports/all.json">Download everything (JSON)</a>
        </div>
      </Section>

      <Section title="Notification history">
        {history.data?.length ? (
          <ul className="max-h-72 space-y-1 overflow-auto text-sm">
            {history.data.map((n) => <li key={n.id} className="flex flex-wrap gap-2"><span className="num text-graphite">{new Date(n.createdAt).toLocaleString()}</span><b>{n.title}</b><Tag tone={n.status === 'SENT' ? 'good' : n.status === 'FAILED' ? 'bad' : 'neutral'}>{titleCase(n.status)}</Tag><span className="text-graphite">{n.deliveries.map((d) => `${titleCase(d.channel)}: ${d.status.toLowerCase()}${d.error ? ` (${d.error})` : ''}`).join(', ')}</span></li>)}
          </ul>
        ) : <p className="text-sm text-graphite">No notifications sent yet.</p>}
      </Section>
      <ErrorNote error={run.error} />
    </div>
  );
}
