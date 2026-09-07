import { randomUUID, randomBytes } from 'node:crypto';
import { configuration } from '../src/config.mjs';
import { database } from '../src/db.mjs';
import { passwordHash } from '../src/security.mjs';
const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Set ADMIN_EMAIL');
const password = await passwordHash(process.env.ADMIN_PASSWORD);
const config = configuration(process.env, false);
const db = database(config.databasePath);
try {
  if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) throw new Error('Account exists. This command never promotes or overwrites an existing account.');
  db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(), email, password, '運営', randomBytes(9).toString('base64url'), null, 'admin', Date.now());
  console.log('Admin created. Remove ADMIN_PASSWORD from your environment after use.');
} finally { db.close(); }
