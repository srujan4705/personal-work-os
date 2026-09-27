import { Router } from 'express';
import { z } from 'zod';
import { ok, parse, userOf } from '../../lib/http';
import { DATE_REGEX } from '../../lib/time';
import { getDashboard } from './dashboard.service';
import { getCloseOut } from './close-out.service';
import { getTimeline } from '../timeline/timeline.service';
import { search, searchQuerySchema } from '../search/search.service';

export const dashboardRoutes = Router();
dashboardRoutes.get('/dashboard', async (req, res) => ok(res, await getDashboard(userOf(req).id)));
dashboardRoutes.get('/close-out/:date', async (req, res) => ok(res, await getCloseOut(userOf(req).id, parse(z.string().regex(DATE_REGEX), req.params.date))));
dashboardRoutes.get('/timeline/:date', async (req, res) => ok(res, await getTimeline(userOf(req).id, parse(z.string().regex(DATE_REGEX), req.params.date))));
dashboardRoutes.get('/search', async (req, res) => ok(res, await search(userOf(req).id, parse(searchQuerySchema, req.query))));
