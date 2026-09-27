import { Router } from 'express';
import { prisma } from '../../lib/prisma';

export const healthRoutes = Router();
healthRoutes.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});
healthRoutes.get('/readiness', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ready', database: 'ok' });
  } catch {
    res.status(503).json({ status: 'not_ready', database: 'unreachable' });
  }
});
