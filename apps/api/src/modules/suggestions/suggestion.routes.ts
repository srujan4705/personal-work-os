import { Router } from 'express';
import { z } from 'zod';
import { ok, parse, userOf } from '../../lib/http';
import { DATE_REGEX } from '../../lib/time';
import { acceptOverridesSchema, acceptSuggestion, findUnloggedWork, ignoreSuggestion, listSuggestions, refreshSuggestionsForDate } from './suggestion.service';

export const suggestionRoutes = Router();
const date = z.string().regex(DATE_REGEX);

suggestionRoutes.get('/', async (req, res) => {
  const q = parse(z.object({ date }), req.query);
  const userId = userOf(req).id;
  await refreshSuggestionsForDate(userId, q.date);
  ok(res, await listSuggestions(userId, q.date));
});
suggestionRoutes.get('/unlogged', async (req, res) => ok(res, await findUnloggedWork(userOf(req).id, parse(z.object({ date }), req.query).date)));
suggestionRoutes.post('/:id/accept', async (req, res) => ok(res, await acceptSuggestion(userOf(req).id, req.params.id, parse(acceptOverridesSchema, req.body ?? {})), 201));
suggestionRoutes.post('/:id/ignore', async (req, res) => ok(res, await ignoreSuggestion(userOf(req).id, req.params.id)));
