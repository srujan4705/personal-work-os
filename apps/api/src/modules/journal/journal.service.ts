import { z } from 'zod';
import { JOURNAL_SECTIONS, type JournalSection } from '@pwos/shared';
import { prisma } from '../../lib/prisma';
import { notFound } from '../../lib/errors';
import { dateToDb, dbToDate } from '../../lib/time';
import { audit } from '../audit/audit.service';
import { resolveWork } from '../timesheets/timesheet.service';
import type { AuditActor } from '../../generated/prisma/enums';

const text = z.string().max(8000).nullable().optional();
export const journalPatchSchema = z.strictObject(
  Object.fromEntries(JOURNAL_SECTIONS.map((s) => [s, text])) as Record<JournalSection, typeof text>,
);
export type JournalPatch = Partial<Record<JournalSection, string | null>>;

const include = { notesItems: { include: { workItem: { select: { ticketKey: true, title: true } } }, orderBy: { createdAt: 'asc' as const } } };

type JournalRow = NonNullable<Awaited<ReturnType<typeof prisma.journalEntry.findFirst<{ include: typeof include }>>>>;

export type JournalDto = Record<JournalSection, string | null> & {
  id: string;
  date: string;
  items: { id: string; content: string; ticketKey: string | null; createdAt: Date }[];
  updatedAt: Date;
};

export function toJournalDto(j: JournalRow): JournalDto {
  return {
    id: j.id,
    date: dbToDate(j.date),
    ...(Object.fromEntries(JOURNAL_SECTIONS.map((s) => [s, j[s]])) as Record<JournalSection, string | null>),
    items: j.notesItems.map((n) => ({ id: n.id, content: n.content, ticketKey: n.workItem?.ticketKey ?? null, createdAt: n.createdAt })),
    updatedAt: j.updatedAt,
  };
}

export async function getJournal(userId: string, date: string) {
  const j = await prisma.journalEntry.findUnique({ where: { userId_date: { userId, date: dateToDb(date) } }, include });
  return j ? toJournalDto(j) : null;
}

export async function listJournal(userId: string, from: string, to: string) {
  const rows = await prisma.journalEntry.findMany({ where: { userId, date: { gte: dateToDb(from), lte: dateToDb(to) } }, include, orderBy: { date: 'asc' } });
  return rows.map(toJournalDto);
}

export async function upsertJournal(userId: string, date: string, patch: JournalPatch, actor: AuditActor = 'USER') {
  const j = await prisma.journalEntry.upsert({
    where: { userId_date: { userId, date: dateToDb(date) } },
    create: { userId, date: dateToDb(date), ...patch },
    update: { ...patch, version: { increment: 1 } },
    include,
  });
  await audit(userId, actor, 'journal.changed', 'JournalEntry', j.id, { date, sections: Object.keys(patch) });
  return toJournalDto(j);
}

export async function appendJournal(userId: string, date: string, section: JournalSection, textValue: string, actor: AuditActor = 'USER') {
  const existing = await prisma.journalEntry.findUnique({ where: { userId_date: { userId, date: dateToDb(date) } } });
  const prev = existing?.[section];
  return upsertJournal(userId, date, { [section]: prev ? `${prev}\n${textValue}` : textValue }, actor);
}

export async function deleteJournal(userId: string, date: string, actor: AuditActor = 'USER') {
  const res = await prisma.journalEntry.deleteMany({ where: { userId, date: dateToDb(date) } });
  if (res.count === 0) throw notFound('Journal entry');
  await audit(userId, actor, 'journal.deleted', 'JournalEntry', null, { date });
  return { deleted: true };
}

export async function addJournalNote(userId: string, date: string, content: string, ticket?: string) {
  const work = ticket ? await resolveWork(userId, { ticket }) : { workItemId: null };
  const j = await prisma.journalEntry.upsert({
    where: { userId_date: { userId, date: dateToDb(date) } },
    create: { userId, date: dateToDb(date) },
    update: {},
  });
  await prisma.journalNote.create({ data: { journalEntryId: j.id, content, workItemId: work.workItemId } });
  await audit(userId, 'USER', 'journal.note_added', 'JournalEntry', j.id, { date });
  return getJournal(userId, date);
}

export async function deleteJournalNote(userId: string, noteId: string) {
  const note = await prisma.journalNote.findFirst({ where: { id: noteId, journalEntry: { userId } } });
  if (!note) throw notFound('Journal note');
  await prisma.journalNote.delete({ where: { id: noteId } });
  return { deleted: true };
}
