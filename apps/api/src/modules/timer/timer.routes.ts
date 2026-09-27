import { Router } from 'express';
import { ok, parse, userOf } from '../../lib/http';
import { getTimer, pauseTimer, resumeTimer, startTimer, startTimerSchema, stopTimer } from './timer.service';

export const timerRoutes = Router();
timerRoutes.get('/', async (req, res) => ok(res, await getTimer(userOf(req).id)));
timerRoutes.post('/start', async (req, res) => ok(res, await startTimer(userOf(req).id, parse(startTimerSchema, req.body)), 201));
timerRoutes.post('/pause', async (req, res) => ok(res, await pauseTimer(userOf(req).id)));
timerRoutes.post('/resume', async (req, res) => ok(res, await resumeTimer(userOf(req).id)));
timerRoutes.post('/stop', async (req, res) => ok(res, await stopTimer(userOf(req).id)));
