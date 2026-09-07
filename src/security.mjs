import { randomBytes, createHash, createHmac, timingSafeEqual, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);
export class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
export function assert(condition, message, status = 400) { if (!condition) throw new HttpError(status, message); }
export const hash = (value) => createHash('sha256').update(value).digest('hex');
export const token = () => randomBytes(32).toString('base64url');
export const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export async function passwordHash(password) {
  assert(typeof password === 'string' && password.length >= 12 && password.length <= 128, 'パスワードは12〜128文字で入力してください。');
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${Buffer.from(await scrypt(password, salt, 64)).toString('hex')}`;
}
export async function passwordMatches(password, stored) {
  if (typeof password !== 'string' || password.length > 128) return false;
  const [salt, expected] = stored.split(':');
  const actual = Buffer.from(await scrypt(password, salt, 64)).toString('hex');
  return equal(actual, expected);
}
export function sign(value, secret) {
  const body = Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}
export function verify(value, secret, now = Date.now()) {
  try {
    const [body, mac, extra] = String(value).split('.');
    if (extra || !equal(mac, createHmac('sha256', secret).update(body).digest('base64url'))) return null;
    const data = JSON.parse(Buffer.from(body, 'base64url').toString());
    return Number.isSafeInteger(data.exp) && data.exp > now ? data : null;
  } catch { return null; }
}
export function cookies(request) {
  const result = {};
  for (const item of (request.headers.cookie || '').split(';')) {
    const i = item.indexOf('=');
    if (i > 0) result[item.slice(0, i).trim()] = item.slice(i + 1).trim();
  }
  return result;
}
export function cookie(name, value, config, age = 2592000) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${config.secure ? '; Secure' : ''}`;
}
export function rate(db, key, limit = 20, now = Date.now()) {
  db.prepare('DELETE FROM rates WHERE expires_at < ?').run(now);
  const row = db.prepare(`INSERT INTO rates VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET hits=hits+1 RETURNING hits`).get(hash(key), now + 900000);
  assert(row.hits <= limit, '操作が多すぎます。時間をおいて再試行してください。', 429);
}
export async function body(request) {
  assert((request.headers['content-type'] || '').split(';')[0] === 'application/json', 'JSONが必要です。', 415);
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    assert(length <= 32768, 'リクエストが大きすぎます。', 413);
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  try { return { raw, value: JSON.parse(raw) }; }
  catch { throw new HttpError(400, 'JSONを解析できません。'); }
}
export function text(value, min, max, label) {
  assert(typeof value === 'string' && value.trim().length >= min && value.trim().length <= max, `${label}を確認してください。`);
  return value.trim();
}
export function integer(value, min, max, label) {
  assert(Number.isSafeInteger(value) && value >= min && value <= max, `${label}を確認してください。`); return value;
}
export function verifyWebhook(raw, timestamp, signature, secret, now = Date.now()) {
  assert(/^\d{10,13}$/.test(timestamp || ''), 'Invalid signature', 401);
  assert(Math.abs(now - Number(timestamp)) <= 300000, 'Expired signature', 401);
  const expected = createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex');
  assert(equal(signature, expected), 'Invalid signature', 401);
}
export function csv(rows) {
  return '\uFEFF' + rows.map(row => row.map(value => {
    let str = String(value ?? '');
    if (/^[\s]*[=+\-@]|^[\t\r\n]/.test(str)) str = `'${str}`;
    return `"${str.replaceAll('"', '""')}"`;
  }).join(',')).join('\r\n');
}
