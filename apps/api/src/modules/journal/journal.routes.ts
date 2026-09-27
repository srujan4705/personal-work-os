import { Router } from 'express';
import { z } from 'zod';
import { ok, parse, userOf } from '../../lib/http';
import { DATE_REGEX } from '../../lib/time';
import { addJournalNote, deleteJournal, deleteJournalNote, getJournal, journalPatchSchema, listJournal, upsertJournal } from './journal.service';

export const journalRoutes = Router();
const date = z.string().regex(DATE_REGEX, 'Expected YYYY-MM-DD');

journalRoutes.get('/', async (req, res) => {
  const q = parse(z.object({ from: date, to: date }), req.query);
  ok(res, await listJournal(userOf(req).id, q.from, q.to));
});
journalRoutes.get('/:date', async (req, res) => ok(res, await getJournal(userOf(req).id, parse(date, req.params.date))));
const save = async (req: import('express').Request, res: import('express').Response) =>
  ok(res, await upsertJournal(userOf(req).id, parse(date, req.params.date), parse(journalPatchSchema, req.body)));
journalRoutes.post('/:date', save);
journalRoutes.patch('/:date', save);
journalRoutes.delete('/:date', async (req, res) => ok(res, await deleteJournal(userOf(req).id, parse(date, req.params.date))));
journalRoutes.post('/:date/notes', async (req, res) => {
  const body = parse(z.object({ content: z.string().min(1).max(4000), ticket: z.string().max(64).optional() }), req.body);
  ok(res, await addJournalNote(userOf(req).id, parse(date, req.params.date), body.content, body.ticket), 201);
});
journalRoutes.delete('/:date/notes/:noteId', async (req, res) => ok(res, await deleteJournalNote(userOf(req).id, req.params.noteId)));
