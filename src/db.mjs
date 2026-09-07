import { DatabaseSync } from 'node:sqlite';

export function database(path, demo = false) {
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password TEXT NOT NULL, name TEXT NOT NULL,
      code TEXT NOT NULL UNIQUE, sponsor_id TEXT REFERENCES users(id), role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('member','admin')),
      created_at INTEGER NOT NULL, CHECK(sponsor_id IS NULL OR sponsor_id != id));
    CREATE TRIGGER IF NOT EXISTS sponsor_immutable BEFORE UPDATE OF sponsor_id ON users
      WHEN NEW.sponsor_id IS NOT OLD.sponsor_id BEGIN SELECT RAISE(ABORT, 'Sponsor is immutable'); END;
    CREATE INDEX IF NOT EXISTS users_sponsor ON users(sponsor_id);
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), csrf TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS rates (key TEXT PRIMARY KEY, hits INTEGER NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL, tagline TEXT NOT NULL, description TEXT NOT NULL, category TEXT NOT NULL,
      price INTEGER NOT NULL CHECK(price BETWEEN 100 AND 10000000), direct_bps INTEGER NOT NULL CHECK(direct_bps BETWEEN 0 AND 5000),
      network_bps INTEGER NOT NULL CHECK(network_bps BETWEEN 0 AND 1000), url TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','active','rejected')), demo INTEGER NOT NULL DEFAULT 0 CHECK(demo IN (0,1)), created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS attributions (
      visitor TEXT NOT NULL, product_id TEXT NOT NULL REFERENCES products(id), referrer_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL,
      PRIMARY KEY(visitor, product_id));
    CREATE INDEX IF NOT EXISTS attribution_expiry ON attributions(expires_at);
    CREATE TABLE IF NOT EXISTS intents (
      id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES users(id), product_id TEXT NOT NULL REFERENCES products(id),
      referrer_id TEXT REFERENCES users(id), direct_bps INTEGER NOT NULL, network_bps INTEGER NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY, source TEXT NOT NULL, external_id TEXT NOT NULL, intent_id TEXT NOT NULL REFERENCES intents(id),
      amount INTEGER NOT NULL CHECK(amount > 0), state TEXT NOT NULL CHECK(state IN ('paid','refunded')),
      created_at INTEGER NOT NULL, UNIQUE(source, external_id));
    CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, digest TEXT NOT NULL, order_id TEXT NOT NULL REFERENCES orders(id), created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS ledger (
      id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), user_id TEXT REFERENCES users(id),
      kind TEXT NOT NULL CHECK(kind IN ('direct','network','creator','platform')), depth INTEGER NOT NULL DEFAULT 0,
      amount INTEGER NOT NULL CHECK(amount != 0), available_at INTEGER NOT NULL,
      reversal_of TEXT UNIQUE REFERENCES ledger(id), created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS ledger_user ON ledger(user_id, available_at);
    CREATE INDEX IF NOT EXISTS ledger_order ON ledger(order_id);
    CREATE TABLE IF NOT EXISTS payouts (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), amount INTEGER NOT NULL CHECK(amount > 0),
      state TEXT NOT NULL CHECK(state IN ('requested','paid','rejected')), reference TEXT UNIQUE, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS clicks (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), product_id TEXT NOT NULL REFERENCES products(id), visitor TEXT NOT NULL, day TEXT NOT NULL,
      UNIQUE(user_id, product_id, visitor, day));
    CREATE TABLE IF NOT EXISTS audits (id TEXT PRIMARY KEY, actor TEXT, action TEXT NOT NULL, target TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TRIGGER IF NOT EXISTS ledger_no_update BEFORE UPDATE ON ledger BEGIN SELECT RAISE(ABORT, 'Ledger is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS ledger_no_delete BEFORE DELETE ON ledger BEGIN SELECT RAISE(ABORT, 'Ledger is append-only'); END;`);
  const mode = db.prepare("SELECT value FROM settings WHERE key = 'mode'").get();
  if (mode && mode.value !== (demo ? 'demo' : 'live')) { db.close(); throw new Error('Demo and live data must use separate database files'); }
  db.prepare("INSERT OR IGNORE INTO settings VALUES ('mode', ?)").run(demo ? 'demo' : 'live');
  db.prepare("INSERT OR IGNORE INTO settings VALUES ('schema_version', '1')").run();
  return db;
}

export function atomic(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
