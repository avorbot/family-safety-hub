import { all, get, type DB } from './db.js';
import { HttpError } from './http.js';

export interface Child {
  id: number;
  name: string;
  birthYear: number | null;
  dailyLimitMinutes: number;
  bedtimeStart: string | null;
  bedtimeEnd: string | null;
}

const CHILD_COLUMNS = `c.id, c.name, c.birth_year AS birthYear, c.daily_limit_minutes AS dailyLimitMinutes,
  c.bedtime_start AS bedtimeStart, c.bedtime_end AS bedtimeEnd`;

export function listChildren(db: DB, parentId: number) {
  return all<Child & { pendingRequests: number }>(
    db,
    `SELECT ${CHILD_COLUMNS},
       (SELECT COUNT(*) FROM time_requests t WHERE t.child_id = c.id AND t.status = 'pending') AS pendingRequests
     FROM children c WHERE c.parent_id = ? ORDER BY c.name COLLATE NOCASE, c.id`,
    parentId,
  );
}

/** Returns the child only if it belongs to this parent; anything else is a 404 so ids can't be probed. */
export function getOwnedChild(db: DB, parentId: number, childId: number): Child {
  const child = get<Child>(db, `SELECT ${CHILD_COLUMNS} FROM children c WHERE c.id = ? AND c.parent_id = ?`, childId, parentId);
  if (!child) throw new HttpError(404, 'Not found');
  return child;
}

export function getChild(db: DB, childId: number): Child {
  const child = get<Child>(db, `SELECT ${CHILD_COLUMNS} FROM children c WHERE c.id = ?`, childId);
  if (!child) throw new HttpError(404, 'Not found');
  return child;
}

export function dayPolicy(db: DB, child: Child, day: string) {
  const used = get<{ m: number }>(
    db,
    'SELECT COALESCE(SUM(minutes), 0) AS m FROM usage WHERE child_id = ? AND day = ?',
    child.id,
    day,
  )!.m;
  const extra = get<{ m: number }>(
    db,
    `SELECT COALESCE(SUM(minutes), 0) AS m FROM time_requests WHERE child_id = ? AND day = ? AND status = 'approved'`,
    child.id,
    day,
  )!.m;
  const allowed = child.dailyLimitMinutes + extra;
  return {
    day,
    dailyLimitMinutes: child.dailyLimitMinutes,
    extraMinutes: extra,
    usedMinutes: used,
    remainingMinutes: Math.max(0, allowed - used),
    limitReached: used >= allowed,
    bedtime: child.bedtimeStart && child.bedtimeEnd ? { start: child.bedtimeStart, end: child.bedtimeEnd } : null,
    blockedDomains: all<{ domain: string }>(
      db,
      'SELECT domain FROM blocked_sites WHERE child_id = ? ORDER BY domain',
      child.id,
    ).map((row) => row.domain),
  };
}

export function usageByLabel(db: DB, childId: number, day: string) {
  return all<{ label: string; category: string; minutes: number }>(
    db,
    `SELECT label, category, SUM(minutes) AS minutes FROM usage
     WHERE child_id = ? AND day = ? GROUP BY label, category ORDER BY minutes DESC, label`,
    childId,
    day,
  );
}

/** Minutes per day for the 7 days ending on `day`, oldest first, with empty days filled in. */
export function weekTotals(db: DB, childId: number, day: string) {
  const rows = all<{ day: string; minutes: number }>(
    db,
    `SELECT day, SUM(minutes) AS minutes FROM usage
     WHERE child_id = ? AND day BETWEEN date(?, '-6 days') AND ? GROUP BY day`,
    childId,
    day,
    day,
  );
  const byDay = new Map(rows.map((row) => [row.day, row.minutes]));
  const end = Date.parse(`${day}T00:00:00Z`);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(end - (6 - i) * 86_400_000).toISOString().slice(0, 10);
    return { day: d, minutes: byDay.get(d) ?? 0 };
  });
}

export function listTimeRequests(db: DB, childId: number, limit = 20) {
  return all<{ id: number; day: string; minutes: number; reason: string; status: string; createdAt: string; decidedAt: string | null }>(
    db,
    `SELECT id, day, minutes, reason, status, created_at AS createdAt, decided_at AS decidedAt
     FROM time_requests WHERE child_id = ?
     ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC, id DESC LIMIT ?`,
    childId,
    limit,
  );
}

export function listCheckIns(db: DB, childId: number, limit = 20) {
  return all<{ id: number; message: string; createdAt: string }>(
    db,
    'SELECT id, message, created_at AS createdAt FROM check_ins WHERE child_id = ? ORDER BY created_at DESC, id DESC LIMIT ?',
    childId,
    limit,
  );
}

export function listDevices(db: DB, childId: number, nowIso: string) {
  const rows = all<{
    id: number;
    name: string;
    paired: number;
    pairedAt: string | null;
    acknowledgedAt: string | null;
    lastSeenAt: string | null;
    pairingExpiresAt: string | null;
  }>(
    db,
    `SELECT id, name, token_hash IS NOT NULL AS paired, paired_at AS pairedAt, acknowledged_at AS acknowledgedAt,
       last_seen_at AS lastSeenAt, pairing_expires_at AS pairingExpiresAt
     FROM devices WHERE child_id = ? ORDER BY created_at, id`,
    childId,
  );
  return rows.map(({ paired, ...device }) => ({
    ...device,
    status: paired
      ? device.acknowledgedAt
        ? 'active'
        : 'awaiting acknowledgement'
      : device.pairingExpiresAt && device.pairingExpiresAt > nowIso
        ? 'awaiting pairing'
        : 'pairing code expired',
  }));
}
