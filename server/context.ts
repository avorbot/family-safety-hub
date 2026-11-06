import type { DB } from './db.js';

export interface Ctx {
  db: DB;
  now: () => Date;
  /** Add the Secure flag to cookies. Turn on whenever the app is served over HTTPS. */
  secureCookies: boolean;
}

export const iso = (date: Date): string => date.toISOString();
