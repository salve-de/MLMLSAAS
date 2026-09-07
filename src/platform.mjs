import { randomUUID, randomBytes } from 'node:crypto';
import { atomic } from './db.mjs';
import { allocate } from './commission.mjs';
import { assert, integer, text, hash, token, passwordHash, passwordMatches, HttpError } from './security.mjs';

export function platform(db, config) {
  const getUser = id => db.prepare('SELECT * FROM users WHERE id=?').get(id);
  const publicUser = user => user ? { id: user.id, name: user.name, email: user.email, code: user.code, role: user.role } : null;
  const audit = (actor, action, target) => db.prepare('INSERT INTO audits VALUES (?,?,?,?,?)').run(randomUUID(), actor, action, target, Date.now());
  const getProduct = id => db.prepare('SELECT * FROM products WHERE id=? OR slug=?').get(id, id);
  const cleanEmail = input => {
    const email = text(input, 3, 254, 'メールアドレス').toLowerCase();
    assert(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'メールアドレスを確認してください。'); return email;
  };
  function session(userId) {
    const value = token();
    const csrf = token();
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
    db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(hash(value), userId, csrf, Date.now() + 2592000000);
    return { token: value, csrf, user: publicUser(getUser(userId)) };
  }
  async function register(input, sponsorId = null) {
    const email = cleanEmail(input.email);
    const name = text(input.name, 2, 40, '表示名');
    const password = await passwordHash(input.password);
    assert(!sponsorId || getUser(sponsorId), '紹介者が見つかりません。');
    const id = randomUUID();
    try {
      db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?,?)').run(id, email, password, name, randomBytes(9).toString('base64url'), sponsorId, 'member', Date.now());
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) throw new HttpError(409, '登録できませんでした。登録済みの場合はログインしてください。');
      throw error;
    }
    return session(id);
  }
  async function login(input) {
    const email = cleanEmail(input.email);
    const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
    // Always perform scrypt, including unknown accounts, to reduce account enumeration.
    const ok = await passwordMatches(input.password, user?.password || `${'0'.repeat(32)}:${'0'.repeat(128)}`);
    assert(user && ok, 'メールアドレスまたはパスワードが違います。', 401);
    return session(user.id);
  }
  function authenticate(value) {
    if (!value) return null;
    const row = db.prepare('SELECT * FROM sessions WHERE token=? AND expires_at>?').get(hash(value), Date.now());
    return row ? { ...row, user: getUser(row.user_id) } : null;
  }
  function submitProduct(ownerId, input) {
    const url = text(input.url, 8, 500, '商品URL');
    let parsed;
    try { parsed = new URL(url); } catch { throw new HttpError(400, '有効な商品URLを入力してください。'); }
    assert(parsed.protocol === 'https:' && !parsed.username && !parsed.password, '商品URLはHTTPSで指定してください。');
    const id = randomUUID();
    const category = text(input.category, 2, 30, 'カテゴリ');
    assert(['AI・自動化', 'マーケティング', 'ビジネス', 'クリエイティブ'].includes(category), 'カテゴリを確認してください。');
    db.prepare('INSERT INTO products VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, ownerId, `product-${randomBytes(6).toString('hex')}`,
      text(input.name, 2, 60, '商品名'), text(input.tagline, 5, 120, '説明'), text(input.description, 10, 3000, '詳細'), category,
      integer(input.price, 100, 10000000, '価格'), integer(input.directBps, 0, 5000, '紹介率'), integer(input.networkBps, 0, 1000, 'ネットワーク率'),
      url, 'pending', config.demo ? 1 : 0, Date.now());
    audit(ownerId, 'product.submit', id);
    return getProduct(id);
  }
  function createIntent(customerId, productId, referrerId) {
    const product = getProduct(productId);
    assert(product && product.status === 'active', 'この商品は現在受け付けていません。', 404);
    const referrer = referrerId ? getUser(referrerId) : null;
    // A purchaser cannot earn on their own purchase; do not fall back to their sponsor.
    const attributed = referrer && customerId !== product.owner_id && referrer.id !== customerId && referrer.id !== product.owner_id ? referrer.id : null;
    const id = randomUUID();
    db.prepare('INSERT INTO intents VALUES (?,?,?,?,?,?,?)').run(id, customerId, product.id, attributed, product.direct_bps, product.network_bps, Date.now());
    return { id, productId: product.id, customerId, referrerId: attributed };
  }
  function applyEvent(input, now = Date.now()) {
    assert(input && typeof input === 'object' && !Array.isArray(input), 'イベントが不正です。');
    assert(input.currency === 'JPY', 'JPYのみ対応します。', 422);
    const type = text(input.type, 1, 40, 'イベント種別');
    assert(['sale.paid', 'sale.refunded'].includes(type), '未対応のイベントです。', 422);
    const external = text(input.orderId, 1, 150, '取引ID');
    const source = config.demo ? 'demo' : 'provider';
    const eventId = `${source}:${text(input.eventId, 1, 150, 'イベントID')}`;
    const amount = integer(input.amountJpy, 1, 100000000, '円建て報酬原資');
    const digest = hash(JSON.stringify([type, external, amount, input.intentId || null]));
    return atomic(db, () => {
      const existingEvent = db.prepare('SELECT * FROM events WHERE id=?').get(eventId);
      if (existingEvent) {
        assert(existingEvent.digest === digest, '同じイベントIDの内容が異なります。', 409);
        return { duplicate: true, orderId: existingEvent.order_id };
      }
      let order = db.prepare('SELECT * FROM orders WHERE source=? AND external_id=?').get(source, external);
      if (type === 'sale.paid') {
        if (order) {
          assert(order.amount === amount && order.intent_id === input.intentId, '取引IDが競合しています。', 409);
        } else {
          const intent = db.prepare('SELECT * FROM intents WHERE id=?').get(text(input.intentId, 1, 100, '購入意図ID'));
          assert(intent, '購入意図が見つかりません。', 404);
          const renewed = db.prepare('SELECT id FROM orders WHERE intent_id=? LIMIT 1').get(intent.id);
          assert(renewed || now - intent.created_at <= 86400000, '購入意図が期限切れです。', 409);
          const product = getProduct(intent.product_id);
          const entries = allocate({ amount, directBps: intent.direct_bps, networkBps: intent.network_bps,
            referrer: intent.referrer_id, customerId: intent.customer_id, creatorId: product.owner_id, getUser });
          order = { id: randomUUID(), amount, intent_id: intent.id, state: 'paid' };
          db.prepare('INSERT INTO orders VALUES (?,?,?,?,?,?,?)').run(order.id, source, external, intent.id, amount, 'paid', now);
          for (const entry of entries) db.prepare('INSERT INTO ledger VALUES (?,?,?,?,?,?,?,?,?)').run(randomUUID(), order.id, entry.userId,
            entry.kind, entry.depth, entry.amount, now + (config.demo ? 0 : config.holdMs), null, now);
        }
      } else {
        assert(order, '元売上が未到着です。先に売上を同期して再試行してください。', 409);
        assert(order.amount === amount, 'このMVPは全額返金のみ対応します。部分返金は要手動照合です。', 422);
        if (order.state !== 'refunded') {
          for (const row of db.prepare('SELECT * FROM ledger WHERE order_id=? AND reversal_of IS NULL').all(order.id)) {
            db.prepare('INSERT INTO ledger VALUES (?,?,?,?,?,?,?,?,?)').run(randomUUID(), order.id, row.user_id, row.kind, row.depth, -row.amount, row.available_at, row.id, now);
          }
          db.prepare("UPDATE orders SET state='refunded' WHERE id=?").run(order.id);
        }
      }
      db.prepare('INSERT INTO events VALUES (?,?,?,?)').run(eventId, digest, order.id, now);
      audit(null, type, order.id);
      return { duplicate: false, orderId: order.id };
    });
  }
  function balance(userId, now = Date.now()) {
    const sums = db.prepare(`SELECT COALESCE(SUM(CASE WHEN available_at<=? THEN amount ELSE 0 END),0) mature,
      COALESCE(SUM(CASE WHEN available_at>? THEN amount ELSE 0 END),0) pending FROM ledger WHERE user_id=?`).get(now, now, userId);
    const reserved = db.prepare("SELECT COALESCE(SUM(amount),0) amount FROM payouts WHERE user_id=? AND state!='rejected'").get(userId).amount;
    return { available: sums.mature - reserved, pending: sums.pending, paidOrReserved: reserved };
  }
  function dashboard(userId) {
    const totals = db.prepare(`SELECT kind, SUM(amount) amount FROM ledger WHERE user_id=? GROUP BY kind`).all(userId);
    const byKind = Object.fromEntries(totals.map(row => [row.kind, row.amount]));
    const ledger = db.prepare(`SELECT l.id,l.kind,l.depth,l.amount,l.available_at,l.created_at,l.reversal_of,o.state,p.name product
      FROM ledger l JOIN orders o ON o.id=l.order_id JOIN intents i ON i.id=o.intent_id JOIN products p ON p.id=i.product_id
      WHERE l.user_id=? ORDER BY l.created_at DESC,l.rowid DESC LIMIT 100`).all(userId);
    const clicks = db.prepare('SELECT COUNT(*) count FROM clicks WHERE user_id=?').get(userId).count;
    const customers = db.prepare(`SELECT COUNT(DISTINCT i.customer_id) count FROM orders o JOIN intents i ON i.id=o.intent_id WHERE i.referrer_id=? AND o.state='paid'`).get(userId).count;
    return { ...balance(userId), direct: byKind.direct || 0, network: byKind.network || 0, creator: byKind.creator || 0, clicks, customers, ledger,
      payouts: db.prepare('SELECT id,amount,state,created_at FROM payouts WHERE user_id=? ORDER BY created_at DESC LIMIT 50').all(userId) };
  }
  function network(userId, parentId = userId, offset = 0) {
    integer(offset, 0, 100000000, 'ページ位置');
    const tree = db.prepare(`WITH RECURSIVE tree(id) AS (SELECT id FROM users WHERE id=? UNION SELECT u.id FROM users u JOIN tree ON u.sponsor_id=tree.id)
      SELECT COUNT(*) total, MAX(CASE WHEN id=? THEN 1 ELSE 0 END) allowed FROM tree`).get(userId, parentId);
    assert(tree.allowed === 1, 'このネットワークは閲覧できません。', 403);
    const members = db.prepare(`SELECT id,name,created_at, (SELECT COUNT(*) FROM users c WHERE c.sponsor_id=u.id) children FROM users u
      WHERE sponsor_id=? ORDER BY created_at DESC,id LIMIT 51 OFFSET ?`).all(parentId, offset);
    return { total: tree.total - 1, parent: { id: parentId, name: getUser(parentId).name }, members: members.slice(0, 50), hasMore: members.length > 50 };
  }
  function requestPayout(userId, amount, idempotencyKey) {
    assert(config.payouts && !config.demo, '出金は未接続です。実送金の準備完了まで利用できません。', 503);
    integer(amount, config.minPayout, 100000000, '出金額');
    const id = text(idempotencyKey, 16, 80, '操作ID');
    return atomic(db, () => {
      const prior = db.prepare('SELECT * FROM payouts WHERE id=?').get(id);
      if (prior) {
        assert(prior.user_id === userId && prior.amount === amount, '操作IDが競合しています。', 409);
        return { id, duplicate: true };
      }
      assert(balance(userId).available >= amount, '出金可能額が不足しています。', 409);
      db.prepare('INSERT INTO payouts VALUES (?,?,?,?,?,?)').run(id, userId, amount, 'requested', null, Date.now());
      audit(userId, 'payout.request', id); return { id };
    });
  }
  function reviewPayout(actorId, id, state, reference) {
    assert(config.payouts && !config.demo, '出金は無効です。', 503);
    assert(getUser(actorId)?.role === 'admin', '管理者権限が必要です。', 403);
    assert(['paid', 'rejected'].includes(state), '出金状態を確認してください。');
    return atomic(db, () => {
      const payout = db.prepare('SELECT * FROM payouts WHERE id=?').get(id);
      assert(payout, '出金申請がありません。', 404);
      if (payout.state === state && (state !== 'paid' || payout.reference === reference)) return { duplicate: true };
      assert(payout.state === 'requested', 'すでに処理済みです。', 409);
      if (state === 'paid') {
        text(reference, 8, 150, '実送金の照合番号');
        assert(balance(payout.user_id).available >= 0, '返金等により残高が不足しています。送金できません。', 409);
      }
      db.prepare('UPDATE payouts SET state=?,reference=? WHERE id=?').run(state, state === 'paid' ? reference : null, id);
      audit(actorId, `payout.${state}`, id); return { ok: true };
    });
  }
  function reviewProduct(actorId, id, state) {
    assert(getUser(actorId)?.role === 'admin', '管理者権限が必要です。', 403);
    assert(['active', 'rejected'].includes(state), '状態を確認してください。');
    assert(getProduct(id), '商品がありません。', 404);
    db.prepare('UPDATE products SET status=? WHERE id=?').run(state, id);
    audit(actorId, `product.${state}`, id); return { ok: true };
  }
  return { getUser, publicUser, getProduct, session, register, login, authenticate, submitProduct, createIntent,
    applyEvent, balance, dashboard, network, requestPayout, reviewPayout, reviewProduct, audit };
}

export function seedDemo(db) {
  const now = Date.now();
  for (const [id, name, parent, role] of [
    ['demo-owner', 'プロダクト運営', null, 'admin'], ['demo-seller', 'あなた', null, 'member'],
    ['demo-partner', '青木 / クリエイター', 'demo-seller', 'member'], ['demo-member', '中村 / 個人開発', 'demo-partner', 'member'],
    ['demo-buyer', 'テスト購入者', null, 'member']]) {
    db.prepare('INSERT OR IGNORE INTO users VALUES (?,?,?,?,?,?,?,?)').run(id, `${id}@example.invalid`, '!demo-no-password', name, id, parent, role, now);
  }
  const samples = [
    ['signal', 'Signal', '競合の変化を、次のアクションに。', 'ビジネス', 4980, 3500, '競合サイトの更新を追跡するサービスの掲載サンプルです。実際の商品・契約・利用権は提供されません。'],
    ['reelkit', 'Reelkit', 'ひとつのアイデアから、ショート動画へ。', 'クリエイティブ', 3980, 3000, 'ショート動画制作ツールの掲載サンプルです。機能説明・価格はデモ用で、購入できません。'],
    ['flowpilot', 'Flowpilot', '繰り返しの仕事を、小さな自動化に。', 'AI・自動化', 9800, 2500, '業務自動化ツールの掲載サンプルです。このリポジトリに当該SaaSの機能は含まれていません。'],
    ['searchlight', 'Searchlight', '検索から見つかる、ブランドをつくる。', 'マーケティング', 7980, 3000, '検索可視性分析ツールの掲載サンプルです。利用実績や成約率を示すものではありません。'],
    ['draftroom', 'Draftroom', '伝えたいことを、公開できる文章に。', 'AI・自動化', 2980, 4000, '文章制作ツールの掲載サンプルです。実際のAI APIや有料サービスには接続していません。'],
    ['launchboard', 'Launchboard', '事業の数字を、ひとつの画面に。', 'ビジネス', 5980, 3000, '事業ダッシュボードの掲載サンプルです。掲載価格は収益や将来利益を保証しません。']
  ];
  for (const [slug, name, tagline, category, price, direct, description] of samples) {
    db.prepare('INSERT OR IGNORE INTO products VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(`demo-${slug}`, 'demo-owner', slug,
      name, tagline, description, category, price, direct, 1000, 'https://example.invalid', 'active', 1, now);
  }
}
