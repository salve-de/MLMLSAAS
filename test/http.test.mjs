import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { database } from '../src/db.mjs';
import { application } from '../src/server.mjs';
import { seedDemo } from '../src/platform.mjs';

async function harness(t, demo = false) {
  const db = database(':memory:', demo);
  if (demo) seedDemo(db);
  const config = { origin: 'http://localhost', demo, secure: false, live: false, payouts: false, trustProxy: false, secret: 'test-secret-at-least-32-characters', holdMs: 1000, minPayout: 3000 };
  const server = application(db, config); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  config.origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close(); });
  const jar = new Map(); let csrf = '';
  const call = async (path, data, overrides = {}) => {
    const response = await fetch(`${config.origin}${path}`, { method: data === undefined ? 'GET' : 'POST', redirect: 'manual',
      headers: { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), ...(data === undefined ? {} : { Origin: config.origin, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }), ...overrides }, body: data === undefined ? undefined : JSON.stringify(data) });
    for (const value of response.headers.getSetCookie()) { const part = value.split(';')[0]; const i = part.indexOf('='); jar.set(part.slice(0, i), part.slice(i + 1)); }
    const result = (response.headers.get('content-type') || '').includes('application/json') ? await response.json() : await response.text();
    if (result?.csrf) csrf = result.csrf;
    return { response, result };
  };
  return { db, config, call, jar };
}

test('public app serves security headers and never exposes unauthenticated dashboards', async t => {
  const h = await harness(t);
  const page = await h.call('/'); assert.equal(page.response.status, 200); assert.ok(page.result.includes('MLMLSAAS'));
  assert.ok(page.response.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
  assert.equal((await h.call('/api/dashboard')).response.status, 401);
  assert.equal((await h.call('/api/admin/payouts.csv')).response.status, 401);
  assert.equal((await h.call('/api/me')).result.user, null);
  assert.equal((await h.call('/api/products')).result.products.length, 0);
});
test('authentication, origin/CSRF checks, authorization and logout work end to end', async t => {
  const h = await harness(t);
  const registration = { name: 'New User', email: 'new@example.test', password: 'a-long-password-for-test', role: 'admin' };
  assert.equal((await h.call('/api/auth/register', registration, { Origin: 'https://attacker.test' })).response.status, 403);
  const registered = await h.call('/api/auth/register', registration); assert.equal(registered.response.status, 200); assert.equal(registered.result.user.role, 'member');
  assert.ok(registered.response.headers.get('set-cookie').includes('HttpOnly')); assert.ok(registered.response.headers.get('set-cookie').includes('SameSite=Lax'));
  assert.equal((await h.call('/api/dashboard')).response.status, 200);
  assert.equal((await h.call('/api/admin')).response.status, 403);
  assert.equal((await h.call('/api/auth/logout', {}, { 'X-CSRF-Token': 'wrong' })).response.status, 403);
  assert.equal((await h.call('/api/billing/events', {})).response.status, 503);
  assert.equal((await h.call('/api/checkout', {})).response.status, 503);
  assert.equal((await h.call('/api/demo/login', {})).response.status, 404);
  assert.equal((await h.call('/api/auth/logout', {})).response.status, 200);
  assert.equal((await h.call('/api/dashboard')).response.status, 401);
});
test('demo flow credits only test sales, applies refunds and prohibits payouts', async t => {
  const h = await harness(t, true);
  await h.call('/api/demo/login', {});
  assert.equal((await h.call('/api/dashboard')).result.direct, 0);
  const sale = { productId: 'demo-signal', idempotencyKey: 'test-sale-key-000001' };
  assert.equal((await h.call('/api/demo/sale', sale)).response.status, 200);
  assert.equal((await h.call('/api/demo/sale', sale)).result.duplicate, true);
  assert.equal((await h.call('/api/dashboard')).result.direct, 1743);
  await h.call('/api/demo/sale', { ...sale, idempotencyKey: 'test-sale-key-000002', through: 'network' });
  assert.equal((await h.call('/api/dashboard')).result.network, 124);
  assert.equal((await h.call('/api/payouts', { amount: 1000, idempotencyKey: 'request-key-00001' })).response.status, 503);
  assert.equal((await h.call('/api/demo/refund', {})).response.status, 200);
  assert.equal((await h.call('/api/dashboard')).result.network, 0);
});
test('referral capture is first-touch, authenticated and never trusts request referrerId', async t => {
  const h = await harness(t, true);
  const link = await h.call('/r/demo-seller/signal'); assert.equal(link.response.status, 302); assert.equal(link.response.headers.get('location'), '/p/signal');
  await h.call('/r/demo-partner/signal');
  const registered = await h.call('/api/auth/register', { name: 'Referred', email: 'referred@example.test', password: 'a-long-password-for-test', sponsorId: 'demo-owner' });
  assert.equal(h.db.prepare('SELECT sponsor_id FROM users WHERE id=?').get(registered.result.user.id).sponsor_id, 'demo-seller');
  const intent = await h.call('/api/intents', { productId: 'demo-signal', referrerId: 'demo-owner' });
  assert.equal(intent.result.referrerId, 'demo-seller');
  assert.equal((await h.call('/api/network?parent=demo-owner')).response.status, 403);
});
test('demo administration can approve products and exports are read-only', async t => {
  const h = await harness(t, true); await h.call('/api/demo/login', {});
  const p = await h.call('/api/products', { name: 'Test tool', tagline: 'Useful test tool', description: 'Useful test tool description', category: 'ビジネス', price: 1980, directBps: 3000, networkBps: 1000, url: 'https://example.test' });
  assert.equal(p.response.status, 201); assert.equal(p.result.product.status, 'pending');
  assert.equal((await h.call('/api/admin/products', { id: p.result.product.id, status: 'active' })).response.status, 403);
  await h.call('/api/demo/login', { role: 'admin' });
  assert.equal((await h.call('/api/admin/products', { id: p.result.product.id, status: 'active' })).response.status, 200);
  const exported = await h.call('/api/admin/payouts.csv'); assert.equal(exported.response.status, 200); assert.ok(exported.result.includes('amount_jpy'));
  assert.equal(h.db.prepare('SELECT COUNT(*) n FROM payouts').get().n, 0);
});
