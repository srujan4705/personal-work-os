import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { logger } from './logger';

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (code: string, message: string) => new AppError(400, code, message);
export const unauthorized = (message = 'Please sign in.') => new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'Not allowed.') => new AppError(403, 'FORBIDDEN', message);
export const notFound = (what: string) => new AppError(404, 'NOT_FOUND', `${what} not found.`);
export const conflict = (code: string, message: string) => new AppError(409, code, message);
export const unavailable = (code: string, message: string) => new AppError(503, code, message);

function prismaCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err && typeof err.code === 'string' ? err.code : undefined;
}

export function isUniqueViolation(err: unknown): boolean {
  return prismaCode(err) === 'P2002';
}

export function toErrorBody(err: unknown): { status: number; code: string; message: string } {
  if (err instanceof AppError) return { status: err.status, code: err.code, message: err.message };
  if (err instanceof ZodError) {
    const message = err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
    return { status: 400, code: 'VALIDATION_ERROR', message };
  }
  if (err instanceof Error && err.name === 'ProviderHttpError') {
    return { status: 502, code: 'PROVIDER_ERROR', message: 'An external provider request failed.' };
  }
  if (err instanceof SyntaxError && 'body' in err) return { status: 400, code: 'INVALID_JSON', message: 'Invalid JSON body.' };
  const code = prismaCode(err);
  if (code === 'P2002') return { status: 409, code: 'CONFLICT', message: 'This record already exists.' };
  if (code === 'P2025') return { status: 404, code: 'NOT_FOUND', message: 'Record not found.' };
  return { status: 500, code: 'INTERNAL_ERROR', message: 'Something went wrong.' };
}

export const errorMiddleware: ErrorRequestHandler = (err, req, res, _next) => {
  const body = toErrorBody(err);
  if (body.status >= 500) logger.error({ err, path: req.path }, 'request.failed');
  res.status(body.status).json({ success: false, error: { code: body.code, message: body.message } });
};

export const apiNotFound: RequestHandler = (_req, res) => {
  res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Route not found.' } });
};
