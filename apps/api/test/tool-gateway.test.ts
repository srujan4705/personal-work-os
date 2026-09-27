import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TOOL_NAMES, type ToolName } from '@pwos/ai-contracts';
import type { Mock } from 'vitest';
import {
  ToolGateway,
  type ActionRecord,
  type ActionStatus,
  type ActionStore,
  type ToolContext,
  type ToolHandlers,
} from '../src/modules/assistant/tool-gateway';

class InMemoryActionStore implements ActionStore {
  records = new Map<string, ActionRecord>();
  private seq = 0;
  async create(r: Omit<ActionRecord, 'id'>) {
    const rec = { ...r, id: `a${++this.seq}` };
    this.records.set(rec.id, rec);
    return { ...rec };
  }
  async findById(id: string) {
    const r = this.records.get(id);
    return r ? { ...r } : null;
  }
  async transition(id: string, from: ActionStatus, to: ActionStatus, patch = {}) {
    const r = this.records.get(id);
    if (!r || r.status !== from) return null;
    Object.assign(r, patch, { status: to });
    return { ...r };
  }
}

const logger = { info: vi.fn(), warn: vi.fn() };
const ctx: ToolContext = { userId: 'u1', conversationId: 'c1', confirmationPolicy: 'CONFIRM_DANGEROUS_ONLY' };

function makeHandlers() {
  return Object.fromEntries(TOOL_NAMES.map((n) => [n, vi.fn(async () => ({ ok: n }))])) as Record<ToolName, Mock>;
}

describe('ToolGateway', () => {
  let store: InMemoryActionStore;
  let handlers: ReturnType<typeof makeHandlers>;
  let now: Date;
  let gw: ToolGateway;

  beforeEach(() => {
    store = new InMemoryActionStore();
    handlers = makeHandlers();
    now = new Date('2026-09-22T10:00:00Z');
    gw = new ToolGateway(handlers as unknown as ToolHandlers, store, logger, { now: () => now, confirmationTtlMs: 60_000 });
  });

  it('rejects tools outside the allowlist without touching the store', async () => {
    for (const name of ['zoho.update', 'zoho_log_time', 'run_sql', '__proto__', 'constructor']) {
      const r = await gw.execute({ name, arguments: {} }, ctx);
      expect(r).toMatchObject({ status: 'REJECTED', code: 'UNKNOWN_TOOL' });
    }
    expect(store.records.size).toBe(0);
  });

  it('rejects invalid and extra arguments, including a smuggled userId', async () => {
    const bad = await gw.execute({ name: 'get_timesheet', arguments: { date: 'yesterday' } }, ctx);
    expect(bad).toMatchObject({ status: 'REJECTED', code: 'INVALID_ARGUMENTS' });
    const smuggled = await gw.execute({ name: 'get_timesheet', arguments: { date: '2026-09-22', userId: 'u2' } }, ctx);
    expect(smuggled).toMatchObject({ status: 'REJECTED', code: 'INVALID_ARGUMENTS' });
    expect(handlers.get_timesheet).not.toHaveBeenCalled();
  });

  it('executes READ_ONLY tools immediately with the session user and audits them', async () => {
    const r = await gw.execute({ name: 'get_timesheet', arguments: { date: '2026-09-22' } }, ctx);
    expect(r).toMatchObject({ status: 'EXECUTED', toolName: 'get_timesheet' });
    expect(handlers.get_timesheet).toHaveBeenCalledWith({ date: '2026-09-22' }, { userId: 'u1' });
    expect([...store.records.values()][0]).toMatchObject({ status: 'EXECUTED', permission: 'READ_ONLY' });
  });

  it('LOCAL_WRITE runs immediately under CONFIRM_DANGEROUS_ONLY', async () => {
    const r = await gw.execute(
      { name: 'add_time_entry', arguments: { date: '2026-09-22', durationMinutes: 60, activityType: 'DEVELOPMENT', ticket: 'ER-431' } },
      ctx,
    );
    expect(r.status).toBe('EXECUTED');
  });

  it('LOCAL_WRITE waits for confirmation under ALWAYS_CONFIRM_WRITES', async () => {
    const r = await gw.execute(
      { name: 'add_time_entry', arguments: { date: '2026-09-22', durationMinutes: 45, activityType: 'TESTING', ticket: 'ER-431' } },
      { ...ctx, confirmationPolicy: 'ALWAYS_CONFIRM_WRITES' },
    );
    expect(r).toMatchObject({ status: 'AWAITING_CONFIRMATION', summary: 'Add 45m of testing to ER-431 on 2026-09-22.' });
    expect(handlers.add_time_entry).not.toHaveBeenCalled();
  });

  it('DANGEROUS_WRITE always requires confirmation, then executes exactly once', async () => {
    const r = await gw.execute({ name: 'delete_time_entry', arguments: { entryId: 'e1' } }, ctx);
    expect(r.status).toBe('AWAITING_CONFIRMATION');
    expect(handlers.delete_time_entry).not.toHaveBeenCalled();
    const id = (r as { actionId: string }).actionId;

    expect(await gw.confirm(id, { userId: 'u1' })).toMatchObject({ status: 'EXECUTED' });
    expect(await gw.confirm(id, { userId: 'u1' })).toMatchObject({ status: 'REJECTED', code: 'INVALID_STATE' });
    expect(handlers.delete_time_entry).toHaveBeenCalledTimes(1);
    expect(store.records.get(id)).toMatchObject({ status: 'EXECUTED', confirmed: true, confirmationRequired: true });
  });

  it("another user cannot confirm or cancel someone else's action", async () => {
    const r = (await gw.execute({ name: 'submit_timesheet', arguments: { date: '2026-09-22' } }, ctx)) as { actionId: string };
    expect(await gw.confirm(r.actionId, { userId: 'u2' })).toMatchObject({ code: 'NOT_FOUND' });
    expect(await gw.cancel(r.actionId, { userId: 'u2' })).toMatchObject({ code: 'NOT_FOUND' });
    expect(handlers.submit_timesheet).not.toHaveBeenCalled();
  });

  it('expired confirmations are cancelled, not executed', async () => {
    const r = (await gw.execute({ name: 'mark_leave', arguments: { date: '2026-09-23', kind: 'FULL_DAY' } }, ctx)) as { actionId: string };
    now = new Date(now.getTime() + 61_000);
    expect(await gw.confirm(r.actionId, { userId: 'u1' })).toMatchObject({ code: 'EXPIRED' });
    expect(store.records.get(r.actionId)?.status).toBe('CANCELLED');
    expect(handlers.mark_leave).not.toHaveBeenCalled();
  });

  it('cancel prevents later confirmation', async () => {
    const r = (await gw.execute({ name: 'delete_journal_entry', arguments: { date: '2026-09-21' } }, ctx)) as { actionId: string };
    expect(await gw.cancel(r.actionId, { userId: 'u1' })).toMatchObject({ status: 'CANCELLED' });
    expect(await gw.confirm(r.actionId, { userId: 'u1' })).toMatchObject({ code: 'INVALID_STATE' });
    expect(handlers.delete_journal_entry).not.toHaveBeenCalled();
  });

  it('handler errors become FAILED without leaking internals', async () => {
    handlers.get_settings.mockRejectedValueOnce(new Error('connection string postgres://secret'));
    const r = await gw.execute({ name: 'get_settings', arguments: {} }, ctx);
    expect(r).toEqual(expect.objectContaining({ status: 'FAILED', message: 'The action failed.' }));
    expect(JSON.stringify(r)).not.toContain('secret');
  });
});
