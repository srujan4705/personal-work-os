import { prisma } from '../../lib/prisma';
import type { ActionRecord, ActionStatus, ActionStore } from './tool-gateway';
import type { ToolName } from '@pwos/ai-contracts';

type Row = NonNullable<Awaited<ReturnType<typeof prisma.assistantActionLog.findUnique>>>;
const toRecord = (r: Row): ActionRecord => ({ ...r, toolName: r.toolName as ToolName, arguments: r.arguments, status: r.status as ActionStatus });

/** Prisma-backed action store. transition() is an atomic compare-and-set on status. */
export const prismaActionStore: ActionStore = {
  async create(record) {
    return toRecord(await prisma.assistantActionLog.create({ data: { ...record, arguments: record.arguments as object } }));
  },
  async findById(id) {
    const r = await prisma.assistantActionLog.findUnique({ where: { id } });
    return r ? toRecord(r) : null;
  },
  async transition(id, from, to, patch = {}) {
    const res = await prisma.assistantActionLog.updateMany({ where: { id, status: from }, data: { status: to, ...patch } });
    if (res.count !== 1) return null;
    return toRecord(await prisma.assistantActionLog.findUniqueOrThrow({ where: { id } }));
  },
};
