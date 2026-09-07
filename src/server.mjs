import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { configuration } from './config.mjs';
import { database } from './db.mjs';
import { platform, seedDemo } from './platform.mjs';
import { HttpError, assert, body, cookies, cookie, hash, token, sign, verify, equal, rate, verifyWebhook, csv } from './security.mjs';

const assets = new Map([
  ['/app.js', ['text/javascript; charset=utf-8', readFileSync(new URL('../public/app.js', import.meta.url))]],
  ['/styles.css', ['text/css; charset=utf-8', readFileSync(new URL('../public/styles.css', import.meta.url))]],
  ['/favicon.svg', ['image/svg+xml', readFileSync(new URL('../public/favicon.svg', import.meta.url))]],
]);
const html = () => readFileSync(new URL('../public/index.html', import.meta.url));

export function application(db, config) {
  const service = platform(db, config);
  const server = createServer(async (req, res) => {
    let url;
    try { url = new URL(req.url || '/', config.origin); }
    catch { res.writeHead(400, { 'Content-Type': 'text/plain' }); res.end('Invalid URL'); return; }
    const path = url.pathname;
    const jar = cookies(req);
    let auth = null;
    const ip = config.trustProxy ? String(req.headers['x-forwarded-for'] || req.socket.remoteAddress).split(',')[0].trim() : req.socket.remoteAddress;
    const securityHeaders = {
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'; object-src 'none'",
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'DENY', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()', 'Cache-Control': 'no-store',
      ...(config.secure ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}),
      ...(config.demo ? { 'X-Robots-Tag': 'noindex, nofollow' } : {}),
    };
    const send = (status, payload, headers = {}) => {
      res.writeHead(status, { ...securityHeaders, 'Content-Type': 'application/json; charset=utf-8', ...headers });
      res.end(typeof payload === 'string' || Buffer.isBuffer(payload) ? payload : JSON.stringify(payload));
    };
    const member = () => { assert(auth, 'ログインしてください。', 401); return auth.user; };
    const admin = () => { const user = member(); assert(user.role === 'admin', '管理者権限が必要です。', 403); return user; };
    const startSession = result => send(200, { user: result.user, csrf: result.csrf }, { 'Set-Cookie': cookie('mlml_session', result.token, config) });
    try {
      auth = service.authenticate(jar.mlml_session);
      if (req.method === 'GET' && path === '/healthz') return send(200, { status: 'ok', mode: config.demo ? 'demo' : 'live' });
      if (req.method === 'GET' && assets.has(path)) {
        const [type, file] = assets.get(path); return send(200, file, { 'Content-Type': type });
      }
      if (req.method === 'GET' && (path === '/' || /^\/p\/[A-Za-z0-9_-]+$/.test(path))) return send(200, html(), { 'Content-Type': 'text/html; charset=utf-8' });
      const referral = path.match(/^\/r\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)$/);
      const invite = path.match(/^\/join\/([A-Za-z0-9_-]+)$/);
      if (req.method === 'GET' && (referral || invite)) {
        rate(db, `ref:${ip}`, 300);
        const code = (referral || invite)[1];
        const user = db.prepare('SELECT id FROM users WHERE code=?').get(code);
        assert(user, '紹介リンクが見つかりません。', 404);
        const headers = [];
        const exp = Date.now() + 2592000000;
        if (!verify(jar.mlml_sponsor, config.secret)) headers.push(cookie('mlml_sponsor', sign({ userId: user.id, exp }, config.secret), config));
        if (referral) {
          const product = service.getProduct(referral[2]);
          assert(product?.status === 'active', '商品が見つかりません。', 404);
          const visitor = /^[A-Za-z0-9_-]{43}$/.test(jar.mlml_visitor || '') ? jar.mlml_visitor : token();
          db.prepare('DELETE FROM attributions WHERE expires_at < ?').run(Date.now());
          db.prepare('INSERT OR IGNORE INTO attributions VALUES (?,?,?,?)').run(hash(visitor), product.id, user.id, exp);
          const day = new Date().toISOString().slice(0, 10);
          db.prepare('INSERT OR IGNORE INTO clicks VALUES (?,?,?,?,?)').run(randomUUID(), user.id, product.id, hash(`${visitor}:${day}`), day);
          headers.push(cookie('mlml_visitor', visitor, config));
          return send(302, '', { Location: `/p/${product.slug}`, 'Set-Cookie': headers, 'Content-Type': 'text/plain; charset=utf-8' });
        }
        return send(302, '', { Location: '/#register', 'Set-Cookie': headers, 'Content-Type': 'text/plain; charset=utf-8' });
      }
      if (req.method === 'GET' && path === '/api/me') {
        const sponsor = verify(jar.mlml_sponsor, config.secret);
        return send(200, { user: service.publicUser(auth?.user), csrf: auth?.csrf || null,
          inviter: sponsor ? service.getUser(sponsor.userId)?.name || null : null,
          demo: config.demo, live: config.live, payoutsEnabled: config.payouts, origin: config.origin, minPayout: config.minPayout });
      }
      if (req.method === 'GET' && path === '/api/products') return send(200, { products: db.prepare("SELECT * FROM products WHERE status='active' ORDER BY created_at DESC,name").all() });
      if (req.method === 'GET' && path === '/api/dashboard') return send(200, service.dashboard(member().id));
      if (req.method === 'GET' && path === '/api/network') return send(200, service.network(member().id, url.searchParams.get('parent') || member().id, Number(url.searchParams.get('offset') || 0)));
      if (req.method === 'GET' && path === '/api/my-products') return send(200, { products: db.prepare('SELECT * FROM products WHERE owner_id=? ORDER BY created_at DESC').all(member().id) });
      if (req.method === 'GET' && path === '/api/admin') {
        admin();
        return send(200, { products: db.prepare('SELECT * FROM products ORDER BY created_at DESC LIMIT 100').all(),
          payouts: db.prepare('SELECT p.*,u.name FROM payouts p JOIN users u ON u.id=p.user_id ORDER BY p.created_at DESC LIMIT 100').all(),
          audits: db.prepare('SELECT * FROM audits ORDER BY created_at DESC LIMIT 50').all() });
      }
      if (req.method === 'GET' && path === '/api/admin/payouts.csv') {
        admin();
        const rows = db.prepare("SELECT p.id,p.user_id,u.email,p.amount,p.state FROM payouts p JOIN users u ON u.id=p.user_id WHERE p.state='requested'").all();
        return send(200, csv([['request_id', 'user_id', 'email', 'amount_jpy', 'state'], ...rows.map(row => Object.values(row))]),
          { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="payout-review.csv"' });
      }
      if (req.method !== 'POST') throw new HttpError(404, 'ページが見つかりません。');
      if (path === '/api/billing/events') {
        assert(config.live && !config.demo, '本番決済は接続されていません。', 503);
        const input = await body(req);
        verifyWebhook(input.raw, req.headers['x-billing-timestamp'], req.headers['x-billing-signature'], config.webhookSecret);
        return send(200, service.applyEvent(input.value));
      }
      assert(req.headers.origin === config.origin && req.headers['sec-fetch-site'] !== 'cross-site', '送信元を確認できません。', 403);
      const { value: input } = await body(req);
      assert(input && typeof input === 'object' && !Array.isArray(input), '入力が不正です。');
      if (path === '/api/auth/register' || path === '/api/auth/login') {
        rate(db, `auth:${ip}`, 25);
        rate(db, `email:${String(input.email || '').toLowerCase().slice(0, 254)}`, 15);
        if (path.endsWith('/register')) {
          const sponsor = verify(jar.mlml_sponsor, config.secret);
          return startSession(await service.register(input, sponsor?.userId || null));
        }
        return startSession(await service.login(input));
      }
      if (path === '/api/demo/login') {
        assert(config.demo, 'デモは無効です。', 404);
        rate(db, `demo-login:${ip}`, 30);
        return startSession(service.session(input.role === 'admin' ? 'demo-owner' : 'demo-seller'));
      }
      const user = member();
      assert(equal(req.headers['x-csrf-token'], auth.csrf), 'セッションを更新して再試行してください。', 403);
      rate(db, `member:${user.id}`, 120);
      if (path === '/api/auth/logout') {
        db.prepare('DELETE FROM sessions WHERE token=?').run(auth.token);
        return send(200, { ok: true }, { 'Set-Cookie': cookie('mlml_session', '', config, 0) });
      }
      if (path === '/api/products') {
        rate(db, `product:${user.id}`, 10);
        return send(201, { product: service.submitProduct(user.id, input) });
      }
      if (path === '/api/intents') {
        const ref = jar.mlml_visitor ? db.prepare('SELECT referrer_id FROM attributions WHERE visitor=? AND product_id=? AND expires_at>?').get(hash(jar.mlml_visitor), input.productId, Date.now()) : null;
        return send(201, { ...service.createIntent(user.id, input.productId, ref?.referrer_id), checkoutConnected: false });
      }
      if (path === '/api/checkout') throw new HttpError(503, '決済プロバイダー未接続です。購入は実行されません。');
      if (path === '/api/payouts') return send(201, service.requestPayout(user.id, input.amount, input.idempotencyKey));
      if (path === '/api/admin/products') { admin(); return send(200, service.reviewProduct(user.id, input.id, input.status)); }
      if (path === '/api/admin/payouts') { admin(); return send(200, service.reviewPayout(user.id, input.id, input.status, input.reference)); }
      if (path === '/api/demo/sale') {
        assert(config.demo, 'デモは無効です。', 404);
        const product = service.getProduct(input.productId);
        assert(product?.demo && product.status === 'active', 'デモ商品を選択してください。');
        const referrer = input.through === 'network' && user.id === 'demo-seller' ? 'demo-member' : user.id;
        assert(typeof input.idempotencyKey === 'string' && /^[A-Za-z0-9_-]{16,80}$/.test(input.idempotencyKey), '操作IDが不正です。');
        const external = `demo-${input.idempotencyKey}`;
        const previous = db.prepare("SELECT intent_id FROM orders WHERE source='demo' AND external_id=?").get(external);
        const intent = previous ? { id: previous.intent_id } : service.createIntent('demo-buyer', product.id, referrer);
        return send(200, service.applyEvent({ type: 'sale.paid', currency: 'JPY', eventId: external, orderId: external, intentId: intent.id, amountJpy: product.price }));
      }
      if (path === '/api/demo/refund') {
        assert(config.demo, 'デモは無効です。', 404);
        const order = db.prepare(`SELECT o.* FROM orders o JOIN ledger l ON l.order_id=o.id WHERE l.user_id=? AND o.source='demo' AND o.state='paid' ORDER BY o.created_at DESC LIMIT 1`).get(user.id);
        assert(order, '返金できるデモ売上がありません。', 409);
        return send(200, service.applyEvent({ type: 'sale.refunded', currency: 'JPY', eventId: `refund-${order.id}`, orderId: order.external_id, amountJpy: order.amount }));
      }
      throw new HttpError(404, '機能が見つかりません。');
    } catch (error) {
      if (!error.status) console.error('Request failed:', error.message);
      if (!res.headersSent) send(error.status || 500, { error: error.status ? error.message : '処理に失敗しました。もう一度お試しください。' });
      else res.end();
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = configuration();
  const db = database(config.databasePath, config.demo);
  if (config.demo) seedDemo(db);
  const server = application(db, config);
  server.listen(config.port, config.host, () => console.log(`MLMLSAAS ${config.demo ? '[DEMO — no real money]' : '[billing adapter required]'}: ${config.origin}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { db.close(); process.exit(0); }));
}
