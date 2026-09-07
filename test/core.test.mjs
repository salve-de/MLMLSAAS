import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { allocate } from '../src/commission.mjs';
import { database } from '../src/db.mjs';
import { platform, seedDemo } from '../src/platform.mjs';
import { configuration } from '../src/config.mjs';
import { passwordHash, passwordMatches, sign, verify, verifyWebhook, csv, body, rate } from '../src/security.mjs';

function fixture(overrides = {}) {
  const config = { demo: false, payouts: true, live: true, holdMs: 0, minPayout: 1000, ...overrides };
  const db = database(':memory:', config.demo);
  const addUser = (id, parent = null, role = 'member') => db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?,?)').run(id, `${id}@example.test`, 'unused', id, `code-${id}`, parent, role, Date.now());
  addUser('owner', null, 'admin'); addUser('a'); addUser('b', 'a'); addUser('c', 'b'); addUser('buyer');
  db.prepare('INSERT INTO products VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('p', 'owner', 'product', 'Product', 'A real tool', 'Product description', 'ビジネス', 10000, 2500, 1000, 'https://example.test', 'active', config.demo ? 1 : 0, Date.now());
  const service = platform(db, config);
  const intent = service.createIntent('buyer', 'p', 'c');
  const paid = (overrides = {}) => ({ type: 'sale.paid', currency: 'JPY', eventId: randomUUID(), orderId: randomUUID(), intentId: intent.id, amountJpy: 10000, ...overrides });
  return { db, config, service, intent, paid, addUser };
}

const users = { c: { id: 'c', sponsor_id: 'b' }, b: { id: 'b', sponsor_id: 'a' }, a: { id: 'a', sponsor_id: null } };
const plan = overrides => allocate({ amount: 10000, directBps: 2500, networkBps: 1000, referrer: 'c', customerId: 'buyer', creatorId: 'owner', getUser: id => users[id], ...overrides });

test('JPY split conserves the full amount and gives the closer ancestor more', () => {
  const entries = plan();
  assert.equal(entries.reduce((n, e) => n + e.amount, 0), 10000);
  assert.deepEqual(entries.map(e => [e.userId, e.kind, e.amount]), [['c', 'direct', 2500], ['b', 'network', 500], ['a', 'network', 250], [null, 'platform', 1000], ['owner', 'creator', 5750]]);
});
test('geometric network never exceeds its cap across 2,000 randomized examples', () => {
  let seed = 19;
  for (let i = 0; i < 2000; i++) {
    seed = (seed * 16807) % 2147483647;
    const amount = seed % 100000000 + 1;
    const networkBps = seed % 1001;
    const entries = plan({ amount, directBps: seed % 5001, networkBps });
    assert.equal(entries.reduce((n, e) => n + e.amount, 0), amount);
    assert.ok(entries.every(e => Number.isSafeInteger(e.amount) && e.amount > 0));
    assert.ok(entries.filter(e => e.kind === 'network').reduce((n, e) => n + e.amount, 0) <= Math.floor(amount * networkBps / 10000));
  }
});
test('1 yen and zero rates retain dust for the creator', () => { assert.deepEqual(plan({ amount: 1 }), [{ userId: 'owner', kind: 'creator', amount: 1, depth: 0 }]); });
test('self purchase suppresses the entire affiliate chain', () => {
  assert.deepEqual(plan({ customerId: 'c' }).map(e => e.kind), ['platform', 'creator']);
  assert.deepEqual(plan({ creatorId: 'c' }).map(e => e.kind), ['platform', 'creator']);
  assert.deepEqual(plan({ customerId: 'owner' }).map(e => e.kind), ['platform', 'creator']);
});
test('ineligible ancestor is skipped without rate compression', () => {
  const entries = plan({ customerId: 'b' });
  assert.equal(entries.find(e => e.userId === 'a').amount, 250);
  assert.equal(entries.some(e => e.userId === 'b'), false);
});
test('cycle or missing parent fails closed before posting', () => {
  assert.throws(() => plan({ getUser: id => ({ id, sponsor_id: id }) }), /循環/);
  assert.throws(() => plan({ getUser: id => id === 'c' ? users.c : null }), /不整合/);
});
test('invalid money and rates are rejected', () => {
  for (const amount of [0, -1, 1.1, NaN, Infinity, 100000001, '100']) assert.throws(() => plan({ amount }));
  assert.throws(() => plan({ directBps: 5001 })); assert.throws(() => plan({ networkBps: 1001 }));
});
test('hold period separates pending from mature balances', t => {
  const f = fixture({ holdMs: 86400000 }); t.after(() => f.db.close());
  const now = Date.now(); f.service.applyEvent(f.paid(), now);
  assert.equal(f.service.balance('c', now).pending, 2500);
  assert.equal(f.service.balance('c', now).available, 0);
  assert.equal(f.service.balance('c', now + 86400000).available, 2500);
});
test('event retries and duplicated invoice notifications do not double credit', t => {
  const f = fixture(); t.after(() => f.db.close()); const event = f.paid();
  f.service.applyEvent(event); assert.equal(f.service.applyEvent(event).duplicate, true);
  f.service.applyEvent({ ...event, eventId: 'different-notification' });
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM orders').get().n, 1);
  assert.equal(f.service.balance('c').available, 2500);
  assert.throws(() => f.service.applyEvent({ ...event, amountJpy: 11000 }), /内容が異なります/);
});
test('renewals reuse immutable attribution and commission snapshots', t => {
  const f = fixture(); t.after(() => f.db.close());
  f.service.applyEvent(f.paid());
  f.db.prepare('UPDATE products SET direct_bps=5000 WHERE id=?').run('p');
  f.service.applyEvent(f.paid());
  assert.equal(f.service.balance('c').available, 5000);
});
test('full refund writes exact reversals once, never edits original ledger', t => {
  const f = fixture(); t.after(() => f.db.close()); const event = f.paid();
  f.service.applyEvent(event);
  const count = f.db.prepare('SELECT COUNT(*) n FROM ledger').get().n;
  const refund = { type: 'sale.refunded', currency: 'JPY', orderId: event.orderId, eventId: 'refund-1', amountJpy: 10000 };
  f.service.applyEvent(refund); f.service.applyEvent(refund); f.service.applyEvent({ ...refund, eventId: 'refund-2' });
  assert.equal(f.service.balance('c').available, 0);
  assert.equal(f.db.prepare('SELECT SUM(amount) n FROM ledger').get().n, 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM ledger').get().n, count * 2);
  f.service.applyEvent({ ...event, eventId: 'late-sale-retry' });
  assert.equal(f.service.balance('c').available, 0);
});
test('partial and out-of-order refunds fail atomically for reconciliation', t => {
  const f = fixture(); t.after(() => f.db.close()); const event = f.paid();
  assert.throws(() => f.service.applyEvent({ type: 'sale.refunded', currency: 'JPY', orderId: event.orderId, eventId: 'early', amountJpy: 10000 }), /未到着/);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM events').get().n, 0);
  f.service.applyEvent(event);
  assert.throws(() => f.service.applyEvent({ type: 'sale.refunded', currency: 'JPY', orderId: event.orderId, eventId: 'partial', amountJpy: 300 }), /全額返金/);
  assert.equal(f.service.balance('c').available, 2500);
});
test('expired initial purchase intent is rejected but recorded renewals continue', t => {
  const f = fixture(); t.after(() => f.db.close());
  f.db.prepare('UPDATE intents SET created_at=? WHERE id=?').run(Date.now() - 90000000, f.intent.id);
  assert.throws(() => f.service.applyEvent(f.paid()), /期限切れ/);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM orders').get().n, 0);
});
test('sponsor relation and ledger entries cannot be rewritten through SQL', t => {
  const f = fixture(); t.after(() => f.db.close()); f.service.applyEvent(f.paid());
  assert.throws(() => f.db.prepare('UPDATE users SET sponsor_id=? WHERE id=?').run('c', 'a'), /immutable/);
  assert.throws(() => f.db.exec('UPDATE ledger SET amount=999999'), /append-only/);
  assert.throws(() => f.db.exec('DELETE FROM ledger'), /append-only/);
});
test('network graph supports 2,000 generations, paginates and restricts access', t => {
  const f = fixture(); t.after(() => f.db.close());
  let parent = 'c'; for (let i = 0; i < 2000; i++) { const id = `depth-${i}`; f.addUser(id, parent); parent = id; }
  assert.equal(f.service.network('a').total, 2002);
  assert.equal(f.service.network('a', parent).members.length, 0);
  assert.throws(() => f.service.network('buyer', 'a'), /閲覧できません/);
  for (let i = 0; i < 55; i++) f.addUser(`wide-${i}`, 'buyer');
  assert.equal(f.service.network('buyer').members.length, 50);
  assert.equal(f.service.network('buyer').hasMore, true);
  assert.equal(f.service.network('buyer', 'buyer', 50).members.length, 5);
  assert.equal('email' in f.service.network('buyer').members[0], false);
});
test('payout requests reserve balances atomically and are idempotent', t => {
  const f = fixture(); t.after(() => f.db.close()); f.service.applyEvent(f.paid());
  f.service.requestPayout('c', 2000, 'payout-request-0001');
  assert.equal(f.service.requestPayout('c', 2000, 'payout-request-0001').duplicate, true);
  assert.equal(f.service.balance('c').available, 500);
  assert.throws(() => f.service.requestPayout('c', 2000, 'payout-request-0002'), /不足/);
  assert.throws(() => f.service.requestPayout('b', 2000, 'payout-request-0001'), /競合/);
});
test('refund during payout hold blocks marking paid; rejection releases reservation', t => {
  const f = fixture(); t.after(() => f.db.close()); const event = f.paid(); f.service.applyEvent(event);
  f.service.requestPayout('c', 2000, 'payout-request-0001');
  f.service.applyEvent({ type: 'sale.refunded', currency: 'JPY', orderId: event.orderId, eventId: 'refund', amountJpy: 10000 });
  assert.throws(() => f.service.reviewPayout('owner', 'payout-request-0001', 'paid', 'bank-reference-123'), /不足/);
  f.service.reviewPayout('owner', 'payout-request-0001', 'rejected');
  assert.equal(f.service.balance('c').available, 0);
});
test('refund after actual payment creates a negative carry-forward, not fake zero', t => {
  const f = fixture(); t.after(() => f.db.close()); const event = f.paid(); f.service.applyEvent(event);
  f.service.requestPayout('c', 2000, 'payout-request-0001');
  f.service.reviewPayout('owner', 'payout-request-0001', 'paid', 'bank-reference-123');
  assert.equal(f.service.reviewPayout('owner', 'payout-request-0001', 'paid', 'bank-reference-123').duplicate, true);
  f.service.applyEvent({ type: 'sale.refunded', currency: 'JPY', orderId: event.orderId, eventId: 'refund', amountJpy: 10000 });
  assert.equal(f.service.balance('c').available, -2000);
});
test('payouts cannot run in demo or when disabled', t => {
  const a = fixture({ payouts: false }); const b = fixture({ demo: true }); t.after(() => { a.db.close(); b.db.close(); });
  assert.throws(() => a.service.requestPayout('c', 1000, 'payout-request-0001'), /未接続/);
  assert.throws(() => b.service.requestPayout('c', 1000, 'payout-request-0001'), /未接続/);
});
test('product submissions remain pending and non-admins cannot publish', t => {
  const f = fixture(); t.after(() => f.db.close());
  const input = { name: 'A tool', tagline: 'Useful tool', description: 'A tool with useful functions.', category: 'ビジネス', price: 1980, directBps: 3000, networkBps: 1000, url: 'https://example.test', status: 'active' };
  const p = f.service.submitProduct('a', input);
  assert.equal(p.status, 'pending'); assert.throws(() => f.service.createIntent('buyer', p.id, 'a'), /受け付けていません/);
  assert.throws(() => f.service.reviewProduct('a', p.id, 'active'), /管理者/);
  f.service.reviewProduct('owner', p.id, 'active'); assert.equal(f.service.getProduct(p.id).status, 'active');
  assert.throws(() => f.service.submitProduct('a', { ...input, url: 'javascript:alert(1)' }), /HTTPS/);
});
test('registration hashes password and never honors caller-supplied role', async t => {
  const f = fixture(); t.after(() => f.db.close());
  const account = await f.service.register({ name: 'Member', email: 'Test@Example.test', password: 'long-enough-password', role: 'admin', sponsorId: 'owner' }, 'a');
  const stored = f.service.getUser(account.user.id);
  assert.notEqual(stored.password, 'long-enough-password'); assert.equal(stored.role, 'member'); assert.equal(stored.sponsor_id, 'a');
  assert.equal((await f.service.login({ email: 'test@example.test', password: 'long-enough-password' })).user.id, stored.id);
  await assert.rejects(() => f.service.login({ email: 'test@example.test', password: 'incorrect-password' }), /違います/);
  assert.ok(f.service.authenticate(account.token)); assert.equal(f.service.authenticate('fabricated'), null);
});
test('password policy and timing-safe verification work', async () => {
  await assert.rejects(() => passwordHash('short'));
  const stored = await passwordHash('LongPasswordForTesting');
  assert.equal(await passwordMatches('LongPasswordForTesting', stored), true);
  assert.equal(await passwordMatches('SomethingElseEntirely', stored), false);
});
test('signed referrals cannot be altered or used past expiration', () => {
  const value = sign({ userId: 'a', exp: 2000 }, 'secret');
  assert.equal(verify(value, 'secret', 1000).userId, 'a');
  assert.equal(verify(`${value}x`, 'secret', 1000), null); assert.equal(verify(value, 'wrong', 1000), null); assert.equal(verify(value, 'secret', 2000), null);
});
test('webhook HMAC is bound to body and freshness', () => {
  const raw = '{"eventId":"e"}'; const timestamp = '1800000000000'; const secret = 'very-long-secret';
  const signature = createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex');
  verifyWebhook(raw, timestamp, signature, secret, Number(timestamp));
  assert.throws(() => verifyWebhook(`${raw} `, timestamp, signature, secret, Number(timestamp)), /signature/);
  assert.throws(() => verifyWebhook(raw, timestamp, signature, secret, Number(timestamp) + 300001), /Expired/);
});
test('CSV export neutralizes spreadsheet formulas and quotes', () => { const result = csv([['=HYPERLINK("evil")', ' +2', '@sum', '\t1', 'normal']]); assert.ok(result.includes("'=HYPERLINK")); assert.ok(result.includes("' +2")); assert.ok(result.includes('"normal"')); });
test('JSON parser preserves multibyte UTF-8 across stream chunks', async () => {
  const bytes = Buffer.from('{"name":"あいうえお"}'); const req = Readable.from([bytes.subarray(0, 11), bytes.subarray(11, 13), bytes.subarray(13)]); req.headers = { 'content-type': 'application/json' };
  assert.equal((await body(req)).value.name, 'あいうえお');
});
test('oversized request bodies are rejected', async () => {
  const req = Readable.from([Buffer.alloc(32769)]); req.headers = { 'content-type': 'application/json' }; await assert.rejects(() => body(req), /大きすぎ/);
});
test('persistent rate limits reset after expiration', t => {
  const db = database(':memory:'); t.after(() => db.close()); rate(db, 'user', 2, 1000); rate(db, 'user', 2, 1000); assert.throws(() => rate(db, 'user', 2, 1000), /多すぎ/); rate(db, 'user', 2, 901001);
});
test('database refuses to mix demo and live data', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mlml-mode-')); const path = join(dir, 'db');
  try { const db = database(path, true); seedDemo(db); db.close(); assert.throws(() => database(path, false), /separate/); } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('configuration rejects unsafe production and incomplete billing setup', () => {
  assert.throws(() => configuration({ NODE_ENV: 'production' }, false), /Production/);
  assert.throws(() => configuration({ NODE_ENV: 'production' }, true), /Demo/);
  assert.throws(() => configuration({ LIVE_PAYMENTS_ENABLED: 'true' }, false), /approval/);
  assert.throws(() => configuration({ PAYOUTS_ENABLED: 'true' }, false), /Payouts/);
  assert.throws(() => configuration({ BASE_URL: 'javascript:alert(1)' }, false), /origin/);
});

test('billing rejects unsupported currency without posting money', t => {
  const f = fixture(); t.after(() => f.db.close());
  assert.throws(() => f.service.applyEvent(f.paid({ currency: 'USD' })), /JPY/);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM orders').get().n, 0);
});
