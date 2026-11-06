import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type DB = DatabaseSync;
export type Param = string | number | null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS parents (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  parent_id  INTEGER NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS children (
  id                  INTEGER PRIMARY KEY,
  parent_id           INTEGER NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  birth_year          INTEGER,
  daily_limit_minutes INTEGER NOT NULL DEFAULT 120,
  bedtime_start       TEXT,
  bedtime_end         TEXT,
  created_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
  id                 INTEGER PRIMARY KEY,
  child_id           INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  pairing_code_hash  TEXT UNIQUE,
  pairing_expires_at TEXT,
  token_hash         TEXT UNIQUE,
  paired_at          TEXT,
  acknowledged_at    TEXT,
  last_seen_at       TEXT,
  created_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS usage (
  id        INTEGER PRIMARY KEY,
  device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  child_id  INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  day       TEXT NOT NULL,
  label     TEXT NOT NULL,
  category  TEXT NOT NULL,
  minutes   INTEGER NOT NULL,
  UNIQUE (device_id, day, label)
);
CREATE INDEX IF NOT EXISTS usage_child_day ON usage (child_id, day);

CREATE TABLE IF NOT EXISTS blocked_sites (
  id       INTEGER PRIMARY KEY,
  child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  domain   TEXT NOT NULL,
  UNIQUE (child_id, domain)
);

CREATE TABLE IF NOT EXISTS time_requests (
  id         INTEGER PRIMARY KEY,
  child_id   INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  day        TEXT NOT NULL,
  minutes    INTEGER NOT NULL,
  reason     TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
  created_at TEXT NOT NULL,
  decided_at TEXT
);
CREATE INDEX IF NOT EXISTS time_requests_child ON time_requests (child_id, status);

CREATE TABLE IF NOT EXISTS check_ins (
  id         INTEGER PRIMARY KEY,
  child_id   INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  message    TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

export function openDatabase(path: string): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return db;
}

const statementCache = new WeakMap<DB, Map<string, StatementSync>>();

function prepare(db: DB, sql: string): StatementSync {
  let cache = statementCache.get(db);
  if (!cache) {
    cache = new Map();
    statementCache.set(db, cache);
  }
  let stmt = cache.get(sql);
  if (!stmt) {
    stmt = db.prepare(sql);
    cache.set(sql, stmt);
  }
  return stmt;
}

export function get<T>(db: DB, sql: string, ...params: Param[]): T | undefined {
  return prepare(db, sql).get(...params) as unknown as T | undefined;
}

export function all<T>(db: DB, sql: string, ...params: Param[]): T[] {
  return prepare(db, sql).all(...params) as unknown as T[];
}

export function run(db: DB, sql: string, ...params: Param[]): { changes: number; id: number } {
  const result = prepare(db, sql).run(...params);
  return { changes: Number(result.changes), id: Number(result.lastInsertRowid) };
}

export function transaction<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const value = fn();
    db.exec('COMMIT');
    return value;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
