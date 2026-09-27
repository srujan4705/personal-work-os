import type { Request, Response } from 'express';
import type { z } from 'zod';
import { unauthorized } from './errors';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  timezone: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

export function userOf(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

export function ok(res: Response, data: unknown, status = 200) {
  res.status(status).json({ success: true, data });
}

export function parse<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  return schema.parse(value);
}
