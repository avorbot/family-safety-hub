import { Router, type RequestHandler, type Response } from 'express';
import { z } from 'zod';
import { get, run, transaction } from '../db.js';
import { iso, type Ctx } from '../context.js';
import { HttpError, parseBody, parseDay } from '../http.js';
import { MONITORING_NOTICE } from '../notice.js';
import { dayPolicy, getChild, listCheckIns, listTimeRequests, usageByLabel } from '../queries.js';
import { newToken, sha256 } from '../security.js';

interface DeviceRow {
  id: number;
  childId: number;
  name: string;
  acknowledgedAt: string | null;
}

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date in YYYY-MM-DD format')
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), 'must be a real date');

const pairSchema = z.object({
  code: z.string().trim().toUpperCase().min(4).max(16),
  deviceName: z.string().trim().min(1).max(60).optional(),
});
const usageSchema = z.object({
  day,
  entries: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(100),
        category: z.enum(['app', 'website', 'game', 'video', 'other']),
        minutes: z.number().int().min(1).max(1440),
      }),
    )
    .min(1)
    .max(200),
});
const timeRequestSchema = z.object({
  day,
  minutes: z.number().int().min(5).max(240),
  reason: z.string().trim().min(1).max(280),
});
const checkInSchema = z.object({ message: z.string().trim().min(1).max(280) });

/**
 * Endpoints called by the app on the child's device. The device authenticates with the bearer
 * token it receives when it pairs, and reports nothing until the child has seen and
 * acknowledged the monitoring notice on that device.
 */
export function deviceRouter(ctx: Ctx): Router {
  const { db } = ctx;
  const r = Router();

  const authenticate =
    (requireAcknowledged: boolean): RequestHandler =>
    (req, res, next) => {
      const match = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') ?? '');
      if (!match?.[1]) throw new HttpError(401, 'Missing device token');
      const device = get<DeviceRow>(
        db,
        'SELECT id, child_id AS childId, name, acknowledged_at AS acknowledgedAt FROM devices WHERE token_hash = ?',
        sha256(match[1]),
      );
      if (!device) throw new HttpError(401, 'This device is not paired (or was removed by a parent)');
      if (requireAcknowledged && !device.acknowledgedAt) {
        throw new HttpError(403, 'The monitoring notice has not been acknowledged on this device yet', {
          code: 'acknowledgement_required',
          notice: MONITORING_NOTICE,
        });
      }
      run(db, 'UPDATE devices SET last_seen_at = ? WHERE id = ?', iso(ctx.now()), device.id);
      res.locals.device = device;
      next();
    };
  const device = (res: Response): DeviceRow => res.locals.device as DeviceRow;
  const ready = authenticate(true);

  r.post('/pair', (req, res) => {
    const body = parseBody(pairSchema, req.body);
    const now = iso(ctx.now());
    const pending = get<{ id: number; childId: number; name: string }>(
      db,
      `SELECT id, child_id AS childId, name FROM devices
       WHERE pairing_code_hash = ? AND pairing_expires_at > ? AND token_hash IS NULL`,
      sha256(body.code),
      now,
    );
    if (!pending) throw new HttpError(400, 'That pairing code is invalid or has expired');
    const token = newToken();
    const name = body.deviceName ?? pending.name;
    run(
      db,
      `UPDATE devices SET token_hash = ?, pairing_code_hash = NULL, pairing_expires_at = NULL, paired_at = ?, name = ?
       WHERE id = ?`,
      sha256(token),
      now,
      name,
      pending.id,
    );
    const child = getChild(db, pending.childId);
    res.status(201).json({ token, device: { id: pending.id, name }, childName: child.name, notice: MONITORING_NOTICE });
  });

  r.post('/acknowledge', authenticate(false), (_req, res) => {
    const current = device(res);
    const acknowledgedAt = current.acknowledgedAt ?? iso(ctx.now());
    run(db, 'UPDATE devices SET acknowledged_at = ? WHERE id = ?', acknowledgedAt, current.id);
    res.json({ acknowledgedAt });
  });

  r.get('/policy', ready, (req, res) => {
    const child = getChild(db, device(res).childId);
    res.json({ childName: child.name, ...dayPolicy(db, child, parseDay(req.query.day, ctx.now())) });
  });

  r.post('/usage', ready, (req, res) => {
    const body = parseBody(usageSchema, req.body);
    const { id, childId } = device(res);
    transaction(db, () => {
      for (const entry of body.entries) {
        run(
          db,
          `INSERT INTO usage (device_id, child_id, day, label, category, minutes) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (device_id, day, label) DO UPDATE SET minutes = minutes + excluded.minutes, category = excluded.category`,
          id,
          childId,
          body.day,
          entry.label,
          entry.category,
          entry.minutes,
        );
      }
    });
    const child = getChild(db, childId);
    res.status(201).json({ policy: dayPolicy(db, child, body.day) });
  });

  r.post('/time-requests', ready, (req, res) => {
    const body = parseBody(timeRequestSchema, req.body);
    const childId = device(res).childId;
    const pending = get<{ n: number }>(
      db,
      `SELECT COUNT(*) AS n FROM time_requests WHERE child_id = ? AND status = 'pending'`,
      childId,
    )!.n;
    if (pending >= 3) throw new HttpError(429, 'You already have 3 requests waiting for an answer');
    const { id } = run(
      db,
      'INSERT INTO time_requests (child_id, day, minutes, reason, created_at) VALUES (?, ?, ?, ?, ?)',
      childId,
      body.day,
      body.minutes,
      body.reason,
      iso(ctx.now()),
    );
    res.status(201).json({ timeRequest: { id, ...body, status: 'pending' } });
  });

  r.post('/check-ins', ready, (req, res) => {
    const { message } = parseBody(checkInSchema, req.body);
    const createdAt = iso(ctx.now());
    const { id } = run(
      db,
      'INSERT INTO check_ins (child_id, message, created_at) VALUES (?, ?, ?)',
      device(res).childId,
      message,
      createdAt,
    );
    res.status(201).json({ checkIn: { id, message, createdAt } });
  });

  /** Everything the parent can see about this child, shown to the child too. */
  r.get('/me', ready, (req, res) => {
    const current = device(res);
    const child = getChild(db, current.childId);
    const day = parseDay(req.query.day, ctx.now());
    res.json({
      childName: child.name,
      device: { id: current.id, name: current.name, acknowledgedAt: current.acknowledgedAt },
      notice: MONITORING_NOTICE,
      policy: dayPolicy(db, child, day),
      usage: usageByLabel(db, child.id, day),
      timeRequests: listTimeRequests(db, child.id, 10),
      checkIns: listCheckIns(db, child.id, 10),
    });
  });

  return r;
}
