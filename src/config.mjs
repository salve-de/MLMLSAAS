import { randomBytes } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

export function configuration(env = process.env, demo = process.argv.includes('--demo')) {
  const production = env.NODE_ENV === 'production';
  const base = new URL(env.BASE_URL || 'http://localhost:3000');
  if (!['http:', 'https:'].includes(base.protocol) || base.pathname !== '/' || base.search || base.hash || base.username || base.password) throw new Error('BASE_URL must be an HTTP(S) origin');
  const number = (key, fallback, min, max) => {
    const value = Number(env[key] || fallback);
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Invalid ${key}`);
    return value;
  };
  const live = env.LIVE_PAYMENTS_ENABLED === 'true';
  const payouts = env.PAYOUTS_ENABLED === 'true';
  if (demo && (production || live || payouts)) throw new Error('Demo mode cannot run with production or real-money processing');
  if (production && (base.protocol !== 'https:' || (env.APP_SECRET || '').length < 32)) throw new Error('Production requires HTTPS BASE_URL and APP_SECRET of at least 32 characters');
  if (live && ((env.BILLING_WEBHOOK_SECRET || '').length < 32 || !env.PAYMENT_APPROVAL_REFERENCE)) throw new Error('Live billing requires webhook secret and approval reference');
  if (payouts && !live) throw new Error('Payouts require live billing');
  const databasePath = resolve(demo ? (env.DEMO_DATABASE_PATH || './data/demo.db') : (env.DATABASE_PATH || './data/platform.db'));
  mkdirSync(dirname(databasePath), { recursive: true });
  let secret = env.APP_SECRET;
  if (!secret) {
    const path = `${databasePath}.secret`;
    if (!existsSync(path)) writeFileSync(path, randomBytes(48).toString('hex'), { mode: 0o600, flag: 'wx' });
    secret = readFileSync(path, 'utf8').trim();
  }
  return { production, demo, live, payouts, databasePath, secret, origin: base.origin, secure: base.protocol === 'https:',
    port: number('PORT', 3000, 1, 65535), host: env.HOST || '127.0.0.1', trustProxy: env.TRUST_PROXY === 'true',
    webhookSecret: env.BILLING_WEBHOOK_SECRET || '', holdMs: number('HOLD_DAYS', 30, 0, 365) * 86400000,
    minPayout: number('MIN_PAYOUT_JPY', 3000, 1, 10000000) };
}
