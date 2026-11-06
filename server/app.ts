import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { DB } from './db.js';
import type { Ctx } from './context.js';
import { errorHandler } from './http.js';
import { deviceRouter } from './routes/device.js';
import { parentRouter } from './routes/parent.js';

export interface AppOptions {
  db: DB;
  secureCookies?: boolean;
  /** Built front end to serve (from `npm run build`). Skipped if it doesn't exist, e.g. in dev. */
  webDir?: string;
  now?: () => Date;
}

export function createApp(options: AppOptions): Express {
  const ctx: Ctx = {
    db: options.db,
    now: options.now ?? (() => new Date()),
    secureCookies: options.secureCookies ?? false,
  };

  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.use('/api/device', deviceRouter(ctx));
  app.use('/api', parentRouter(ctx));
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  if (options.webDir && existsSync(join(options.webDir, 'index.html'))) {
    const webDir = resolve(options.webDir);
    app.use(express.static(webDir, { index: 'index.html' }));
    // Client-side routes such as /device fall back to the single-page app.
    app.get('/{*path}', (_req, res) => {
      res.sendFile(join(webDir, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}
