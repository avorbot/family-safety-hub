import { Router, type RequestHandler, type Response } from 'express';
import { z } from 'zod';
import { all, get, run, type Param } from '../db.js';
import { iso, type Ctx } from '../context.js';
import { HttpError, parseBody, parseDay, parseId } from '../http.js';
import {
  dayPolicy,
  getOwnedChild,
  listCheckIns,
  listChildren,
  listDevices,
  listTimeRequests,
  usageByLabel,
  weekTotals,
} from '../queries.js';
import { DUMMY_PASSWORD_HASH, hashPassword, newPairingCode, newToken, sha256, verifyPassword } from '../security.js';

export const SESSION_COOKIE = 'fsh_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PAIRING_TTL_MS = 15 * 60 * 1000;

const email = z.string().trim().toLowerCase().max(254).pipe(z.email());
const loginSchema = z.object({ email, password: z.string().min(1).max(200) });
const registerSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email,
  password: z.string().min(10, 'must be at least 10 characters').max(200),
});

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be a time in HH:MM format');
const childFields = {
  name: z.string().trim().min(1).max(60),
  birthYear: z.number().int().min(1990).max(2100).nullable(),
  dailyLimitMinutes: z.number().int().min(0).max(1440),
  bedtimeStart: clock.nullable(),
  bedtimeEnd: clock.nullable(),
};
const createChildSchema = z.object({
  ...childFields,
  birthYear: childFields.birthYear.optional(),
  bedtimeStart: childFields.bedtimeStart.optional(),
  bedtimeEnd: childFields.bedtimeEnd.optional(),
});
const updateChildSchema = z.object(childFields).partial();
const CHILD_COLUMN: Record<keyof typeof childFields, string> = {
  name: 'name',
  birthYear: 'birth_year',
  dailyLimitMinutes: 'daily_limit_minutes',
  bedtimeStart: 'bedtime_start',
  bedtimeEnd: 'bedtime_end',
};

const deviceSchema = z.object({ name: z.string().trim().min(1).max(60) });
const decisionSchema = z.object({ approve: z.boolean() });
const blockedSiteSchema = z.object({
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .transform((value) => value.replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').split(/[/?#:]/)[0] ?? '')
    .pipe(z.string().regex(/^(?!-)[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+$/, 'must be a domain like example.com')),
});

export function parentRouter(ctx: Ctx): Router {
  const { db } = ctx;
  const r = Router();

  const requireParent: RequestHandler = (req, res, next) => {
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    const session =
      typeof token === 'string'
        ? get<{ parentId: number }>(
            db,
            'SELECT parent_id AS parentId FROM sessions WHERE token_hash = ? AND expires_at > ?',
            sha256(token),
            iso(ctx.now()),
          )
        : undefined;
    if (!session) throw new HttpError(401, 'Not signed in');
    res.locals.parentId = session.parentId;
    next();
  };
  const parentId = (res: Response): number => res.locals.parentId as number;

  function startSession(res: Response, id: number) {
    const token = newToken();
    const now = ctx.now();
    run(
      db,
      'INSERT INTO sessions (token_hash, parent_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
      sha256(token),
      id,
      iso(now),
      iso(new Date(now.getTime() + SESSION_TTL_MS)),
    );
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: ctx.secureCookies,
      maxAge: SESSION_TTL_MS,
      path: '/',
    });
  }

  // ---- Accounts -------------------------------------------------------------

  r.post('/auth/register', (req, res) => {
    const body = parseBody(registerSchema, req.body);
    if (get(db, 'SELECT id FROM parents WHERE email = ?', body.email)) {
      throw new HttpError(409, 'An account with that email already exists');
    }
    const { id } = run(
      db,
      'INSERT INTO parents (name, email, password_hash, created_at) VALUES (?, ?, ?, ?)',
      body.name,
      body.email,
      hashPassword(body.password),
      iso(ctx.now()),
    );
    startSession(res, id);
    res.status(201).json({ parent: { id, name: body.name, email: body.email } });
  });

  r.post('/auth/login', (req, res) => {
    const body = parseBody(loginSchema, req.body);
    const parent = get<{ id: number; name: string; email: string; passwordHash: string }>(
      db,
      'SELECT id, name, email, password_hash AS passwordHash FROM parents WHERE email = ?',
      body.email,
    );
    const ok = verifyPassword(body.password, parent?.passwordHash ?? DUMMY_PASSWORD_HASH);
    if (!parent || !ok) throw new HttpError(401, 'Email or password is incorrect');
    startSession(res, parent.id);
    res.json({ parent: { id: parent.id, name: parent.name, email: parent.email } });
  });

  r.post('/auth/logout', (req, res) => {
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    if (typeof token === 'string') run(db, 'DELETE FROM sessions WHERE token_hash = ?', sha256(token));
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.status(204).end();
  });

  r.get('/auth/me', requireParent, (_req, res) => {
    const parent = get(db, 'SELECT id, name, email FROM parents WHERE id = ?', parentId(res));
    res.json({ parent });
  });

  // ---- Children -------------------------------------------------------------

  r.get('/children', requireParent, (_req, res) => {
    res.json({ children: listChildren(db, parentId(res)) });
  });

  r.post('/children', requireParent, (req, res) => {
    const body = parseBody(createChildSchema, req.body);
    const { id } = run(
      db,
      `INSERT INTO children (parent_id, name, birth_year, daily_limit_minutes, bedtime_start, bedtime_end, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      parentId(res),
      body.name,
      body.birthYear ?? null,
      body.dailyLimitMinutes,
      body.bedtimeStart ?? null,
      body.bedtimeEnd ?? null,
      iso(ctx.now()),
    );
    res.status(201).json({ child: getOwnedChild(db, parentId(res), id) });
  });

  r.patch('/children/:id', requireParent, (req, res) => {
    const child = getOwnedChild(db, parentId(res), parseId(req.params.id));
    const body = parseBody(updateChildSchema, req.body);
    const entries = Object.entries(body).filter(([, value]) => value !== undefined) as [
      keyof typeof childFields,
      Param,
    ][];
    if (entries.length > 0) {
      const assignments = entries.map(([key]) => `${CHILD_COLUMN[key]} = ?`).join(', ');
      run(db, `UPDATE children SET ${assignments} WHERE id = ?`, ...entries.map(([, value]) => value), child.id);
    }
    res.json({ child: getOwnedChild(db, parentId(res), child.id) });
  });

  r.delete('/children/:id', requireParent, (req, res) => {
    const child = getOwnedChild(db, parentId(res), parseId(req.params.id));
    run(db, 'DELETE FROM children WHERE id = ?', child.id);
    res.status(204).end();
  });

  r.get('/children/:id/summary', requireParent, (req, res) => {
    const child = getOwnedChild(db, parentId(res), parseId(req.params.id));
    const day = parseDay(req.query.day, ctx.now());
    res.json({
      child,
      policy: dayPolicy(db, child, day),
      usage: usageByLabel(db, child.id, day),
      week: weekTotals(db, child.id, day),
      devices: listDevices(db, child.id, iso(ctx.now())),
      blockedSites: listBlockedSites(child.id),
      timeRequests: listTimeRequests(db, child.id),
      checkIns: listCheckIns(db, child.id, 10),
    });
  });

  // ---- Devices --------------------------------------------------------------

  r.post('/children/:id/devices', requireParent, (req, res) => {
    const child = getOwnedChild(db, parentId(res), parseId(req.params.id));
    const body = parseBody(deviceSchema, req.body);
    const now = ctx.now();
    const pairingCode = newPairingCode();
    const pairingExpiresAt = iso(new Date(now.getTime() + PAIRING_TTL_MS));
    const { id } = run(
      db,
      'INSERT INTO devices (child_id, name, pairing_code_hash, pairing_expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      child.id,
      body.name,
      sha256(pairingCode),
      pairingExpiresAt,
      iso(now),
    );
    res.status(201).json({ device: { id, name: body.name, status: 'awaiting pairing' }, pairingCode, pairingExpiresAt });
  });

  r.delete('/devices/:id', requireParent, (req, res) => {
    const owned = get<{ id: number }>(
      db,
      'SELECT d.id FROM devices d JOIN children c ON c.id = d.child_id WHERE d.id = ? AND c.parent_id = ?',
      parseId(req.params.id),
      parentId(res),
    );
    if (!owned) throw new HttpError(404, 'Not found');
    run(db, 'DELETE FROM devices WHERE id = ?', owned.id);
    res.status(204).end();
  });

  // ---- Blocked sites --------------------------------------------------------

  function listBlockedSites(childId: number) {
    return all<{ id: number; domain: string }>(
      db,
      'SELECT id, domain FROM blocked_sites WHERE child_id = ? ORDER BY domain',
      childId,
    );
  }

  r.post('/children/:id/blocked-sites', requireParent, (req, res) => {
    const child = getOwnedChild(db, parentId(res), parseId(req.params.id));
    const { domain } = parseBody(blockedSiteSchema, req.body);
    run(db, 'INSERT OR IGNORE INTO blocked_sites (child_id, domain) VALUES (?, ?)', child.id, domain);
    res.status(201).json({ blockedSites: listBlockedSites(child.id) });
  });

  r.delete('/blocked-sites/:id', requireParent, (req, res) => {
    const owned = get<{ id: number }>(
      db,
      'SELECT b.id FROM blocked_sites b JOIN children c ON c.id = b.child_id WHERE b.id = ? AND c.parent_id = ?',
      parseId(req.params.id),
      parentId(res),
    );
    if (!owned) throw new HttpError(404, 'Not found');
    run(db, 'DELETE FROM blocked_sites WHERE id = ?', owned.id);
    res.status(204).end();
  });

  // ---- Time requests --------------------------------------------------------

  r.post('/time-requests/:id/decision', requireParent, (req, res) => {
    const { approve } = parseBody(decisionSchema, req.body);
    const request = get<{ id: number; status: string }>(
      db,
      `SELECT t.id, t.status FROM time_requests t JOIN children c ON c.id = t.child_id
       WHERE t.id = ? AND c.parent_id = ?`,
      parseId(req.params.id),
      parentId(res),
    );
    if (!request) throw new HttpError(404, 'Not found');
    if (request.status !== 'pending') throw new HttpError(409, `This request was already ${request.status}`);
    const status = approve ? 'approved' : 'denied';
    run(db, 'UPDATE time_requests SET status = ?, decided_at = ? WHERE id = ?', status, iso(ctx.now()), request.id);
    res.json({ timeRequest: { id: request.id, status } });
  });

  return r;
}
