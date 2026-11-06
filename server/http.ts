import type { ErrorRequestHandler } from 'express';
import type { z } from 'zod';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function parseBody<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data ?? {});
  if (!result.success) {
    const message = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
      .join('; ');
    throw new HttpError(400, message);
  }
  return result.data;
}

export function parseId(value: unknown): number {
  const id = typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(404, 'Not found');
  return id;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A calendar day as YYYY-MM-DD. Devices send their own local day; the server falls back to UTC. */
export function parseDay(value: unknown, now: Date): string {
  if (value === undefined || value === '') return now.toISOString().slice(0, 10);
  if (typeof value !== 'string' || !DAY.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new HttpError(400, 'day: must be a date in YYYY-MM-DD format');
  }
  return value;
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, ...err.extra });
    return;
  }
  // body-parser and other middleware errors carry a 4xx status.
  const status = typeof err?.status === 'number' ? err.status : 500;
  if (status >= 400 && status < 500) {
    res.status(status).json({ error: err.type === 'entity.parse.failed' ? 'Invalid JSON body' : err.message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
};
