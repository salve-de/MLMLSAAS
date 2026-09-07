const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const yen = value => new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' }).format(value || 0);
const date = value => new Date(value).toLocaleDateString('ja-JP');
const pct = value => `${value / 100}%`;
const names = { market: 'マーケット', dashboard: 'ダッシュボード', network: '紹介ネットワーク', earnings: '報酬・出金', creator: '商品を掲載', admin: '運営管理', product: '商品詳細' };
const kinds = { direct: '直接紹介', network: 'ネットワーク', creator: '商品収益', platform: '運営手数料' };
const state = { me: null, products: [], category: 'すべて', query: '', sort: 'commission', epoch: 0 };
let toastTimer;
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4500); }
async function api(path, data) {
  const response = await fetch(path, { method: data === undefined ? 'GET' : 'POST', credentials: 'same-origin',
    headers: data === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': state.me?.csrf || '' },
    body: data === undefined ? undefined : JSON.stringify(data) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '処理に失敗しました。');
  return result;
}
async function refresh() {
  const [me, catalog] = await Promise.all([api('/api/me'), api('/api/products')]);
  state.me = me; state.products = catalog.products;
  $('#admin-nav').hidden = me.user?.role !== 'admin';
  $('#connection').textContent = me.demo ? 'デモ環境' : '決済未接続';
  $('#connection').className = `connection${me.demo ? ' demo' : ''}`;
  $('#environment').hidden = false;
  $('#environment').innerHTML = me.demo ? '<strong>DEMO</strong> サンプル商品・テスト台帳です。実際の購入・出金はできません。<button class="text-button" data-action="demo-admin">運営画面を試す ↗</button>' : '<strong>SETUP</strong> 決済画面・実送金は未接続です。掲載審査済みの商品でも購入はまだ実行できません。';
  $('#profile-name').innerHTML = me.user ? `${escape(me.user.name)}<small>${me.user.role === 'admin' ? '運営アカウント' : '無料パートナー'}</small>` : 'ゲスト<small>無料で始める</small>';
  $('#profile-button').dataset.action = me.user ? 'logout' : 'login';
  $('#account-button').dataset.action = me.user ? 'logout' : 'register';
  $('#account-button').textContent = me.user ? 'ログアウト' : '無料で始める ↗';
}
function empty(title, description, action = '<a class="button" href="/#market">商品を探す ↗</a>') {
  return `<div class="empty"><div class="empty-icon">↗</div><h3>${escape(title)}</h3><p>${escape(description)}</p>${action}</div>`;
}
function pageHeading(kicker, title, description, side = '') {
  return `<div class="page-heading"><div><div class="eyebrow">${kicker}</div><h1>${title}</h1><p>${description}</p></div>${side}</div>`;
}
function logo(product, large = false) {
  const palette = ['mint', 'pink', 'lavender', 'sand', 'blue', 'peach'];
  const index = state.products.findIndex(p => p.id === product.id);
  return `<span class="product-logo ${palette[(index + 6) % 6]}${large ? ' large' : ''}">${escape(product.name.slice(0, 1))}<span>↗</span></span>`;
}
function card(product) {
  return `<article class="product-card"><div class="card-top">${logo(product)}<span class="badge">${product.demo ? '掲載サンプル' : '審査済み'}</span></div>
    <a class="product-title" href="/p/${encodeURIComponent(product.slug)}">${escape(product.name)} <span>↗</span></a><p class="tagline">${escape(product.tagline)}</p>
    <div class="category-label">${escape(product.category)}</div><div class="card-pricing"><span>紹介報酬 / 対象売上</span><strong>${pct(product.direct_bps)}<small>継続購入ごと</small></strong></div>
    <div class="card-bottom"><div><small>掲載月額</small><b>${yen(product.price)}<span> / 月</span></b></div><button class="button outline small" data-action="product" data-id="${escape(product.id)}">詳しく見る ↗</button></div>
  </article>`;
}
function filteredProducts() {
  return state.products.filter(p => (state.category === 'すべて' || p.category === state.category) && `${p.name} ${p.tagline} ${p.category}`.toLowerCase().includes(state.query.toLowerCase())).sort((a, b) => state.sort === 'price' ? a.price - b.price : state.sort === 'newest' ? b.created_at - a.created_at : b.price * b.direct_bps - a.price * a.direct_bps);
}
function updateGrid() {
  const products = filteredProducts();
  if (!$('#product-grid')) return;
  $('#product-grid').innerHTML = products.length ? products.map(card).join('') : empty('該当する商品がありません', '検索条件を変更するか、最初の商品を掲載してください。', '<a class="button" href="/#creator">商品を掲載する ↗</a>');
  $('#product-count').textContent = `${products.length} products`;
  document.querySelectorAll('[data-category]').forEach(button => { button.classList.toggle('selected', button.dataset.category === state.category); button.setAttribute('aria-pressed', String(button.dataset.category === state.category)); });
}
function market() {
  return `<section class="hero"><div class="hero-copy"><div class="eyebrow light"><span class="live-dot"></span> DISCOVER. SHARE. EARN.</div><h1>いいプロダクトを、<br><em>あなたの収益に。</em></h1><p>紹介したい商品を見つけて、リンクをシェア。<br>対象の売上から、継続的に紹介報酬を受け取る。</p><div class="hero-actions"><a class="button lime" href="#catalog">商品を探す <span>↗</span></a><button class="text-button light" data-action="help">仕組みを見る →</button></div><div class="hero-foot"><span>参加費 0円</span><span>商品購入の義務なし</span><span>報酬・条件を公開</span></div></div>
    <div class="hero-visual" aria-hidden="true"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><div class="visual-node node-a">作る人<span>PRODUCT</span></div><div class="visual-node node-b">紹介する人<span>PARTNER</span></div><div class="visual-node node-c">使う人<span>CUSTOMER</span></div><div class="center-node">m<span>↗</span></div><div class="visual-note">価値を届ける。売上を分け合う。</div></div></section>
    <section class="how-strip"><div><span>01</span><p><strong>選ぶ</strong>紹介したい商品を見つける</p></div><div><span>02</span><p><strong>シェアする</strong>あなた専用のリンクで紹介</p></div><div><span>03</span><p><strong>積み上げる</strong>対象の継続購入から報酬</p></div>${state.me.demo && !state.me.user ? '<button class="button outline small" data-action="demo-login">デモで試す ↗</button>' : ''}</section>
    <section id="catalog"><div class="section-title"><h2>あなたに合う、次のプロダクト。</h2><span id="product-count">${state.products.length} products</span></div><p class="section-note">${state.me.demo ? '掲載内容・価格はサンプルです。成約率・継続率・収益実績は捏造せず、データ未取得のまま表示しています。' : '審査済みの商品を表示します。紹介報酬は税・決済費用などを除いた対象売上から計算します。'}</p>
    <div class="catalog-tools"><div class="search-box"><span>⌕</span><input id="search" aria-label="商品を検索" placeholder="商品名やカテゴリで検索" value="${escape(state.query)}"></div><label class="sort-label">並び順 <select id="sort"><option value="commission" ${state.sort === 'commission' ? 'selected' : ''}>掲載価格×直接報酬率</option><option value="price" ${state.sort === 'price' ? 'selected' : ''}>価格が低い順</option><option value="newest" ${state.sort === 'newest' ? 'selected' : ''}>新着順</option></select></label></div>
    <div class="categories" role="group" aria-label="カテゴリ">${['すべて', 'AI・自動化', 'マーケティング', 'ビジネス', 'クリエイティブ'].map(c => `<button data-category="${c}" aria-pressed="${state.category === c}" class="category ${state.category === c ? 'selected' : ''}">${c}</button>`).join('')}</div><div class="product-grid" id="product-grid">${filteredProducts().map(card).join('') || empty('最初の商品を掲載しましょう', '本番環境にはサンプル商品を自動追加しません。', '<a class="button" href="/#creator">商品を掲載する ↗</a>')}</div></section>
    <section class="builder-banner"><div><span class="eyebrow">FOR PRODUCT BUILDERS</span><h2>あなたは作る。届ける仲間が、ここにいる。</h2><p>価格と報酬条件を設定して、デジタル商品を掲載申請。</p></div><a class="button outline" href="/#creator">商品を掲載する ↗</a></section>`;
}
function stats(data) {
  return `<div class="stats"><div class="stat"><span>直接紹介報酬</span><strong>${yen(data.direct)}</strong><small>返金取消を反映した累計</small></div><div class="stat"><span>ネットワーク報酬</span><strong>${yen(data.network)}</strong><small>下位紹介者の対象売上から</small></div><div class="stat"><span>確定・未出金残高</span><strong>${yen(data.available)}</strong><small>${state.me.demo ? 'テスト残高 / 換金不可' : '出金予約・送金済みを控除'}</small></div><div class="stat"><span>保留中の報酬</span><strong>${yen(data.pending)}</strong><small>返金保留期間の終了を待機</small></div></div>`;
}
function ledger(data) {
  if (!data.ledger.length) return empty('まだ報酬は発生していません', '対象の売上が確認されると、ここに取引ごとの報酬が記録されます。');
  return `<div class="table-scroll"><table><thead><tr><th>商品 / 日付</th><th>区分</th><th>階層</th><th>状態</th><th class="number">金額</th></tr></thead><tbody>${data.ledger.map(row => `<tr><td><b>${escape(row.product)}</b><small>${date(row.created_at)}</small></td><td>${kinds[row.kind]}</td><td>${row.kind === 'network' ? `${row.depth}段上` : '—'}</td><td><span class="badge ${row.reversal_of ? 'warning' : ''}">${row.reversal_of ? '返金取消' : row.state === 'refunded' ? '取消済み原票' : row.available_at > Date.now() ? '保留中' : state.me.demo ? 'テスト確定' : '確定'}</span></td><td class="number ${row.amount < 0 ? 'negative' : ''}">${row.amount > 0 ? '+' : ''}${yen(row.amount)}</td></tr>`).join('')}</tbody></table></div><p class="table-note">直近100件を表示。集計値は全台帳から計算します。</p>`;
}
function demoControls() {
  return state.me.demo ? `<section class="demo-lab"><div><strong>売上を発生させて、台帳を試す。</strong><p>金銭は動きません。報酬計算と返金取消を確認できます。</p></div><div class="demo-actions"><label class="sr-only" for="demo-product">デモ商品</label><select id="demo-product">${state.products.filter(p => p.demo).map(p => `<option value="${escape(p.id)}">${escape(p.name)} / ${yen(p.price)}</option>`).join('')}</select><button class="button small" data-action="demo-sale">直接売上をテスト</button>${state.me.user.id === 'demo-seller' ? '<button class="button outline small" data-action="demo-network-sale">下位売上をテスト</button>' : ''}<button class="text-button" data-action="demo-refund">直近売上を返金</button></div></section>` : '';
}
async function dashboard(earnings = false) {
  const data = await api('/api/dashboard');
  return `${pageHeading(earnings ? 'YOUR EARNINGS' : 'YOUR WORKSPACE', earnings ? '報酬を、ひとつの台帳に。' : `${escape(state.me.user.name)}さんのワークスペース。`, '売上・紹介・返金を記録。確認できた数字だけを表示します。', '<a class="button outline" href="/#market">商品を探す ↗</a>')}${stats(data)}${demoControls()}
    ${earnings ? `<div class="notice"><strong>${state.me.payoutsEnabled ? '出金は運営による本人確認・実送金照合が必要です。' : '実送金は接続されていません。'}</strong><p>${state.me.demo ? 'デモ残高は架空のテスト値です。現金・ポイント等に交換できません。' : '出金申請・CSV出力だけで銀行振込は行われません。支払事業者・本人確認・税務対応が別途必要です。'}</p><button class="button small" data-action="payout" ${!state.me.payoutsEnabled || data.available < state.me.minPayout ? 'disabled' : ''} data-amount="${Math.max(0, data.available)}">出金を申請する</button></div>` : `<div class="overview-row"><div class="panel compact"><span class="eyebrow">TRAFFIC</span><h3>あなたが届けたつながり</h3><div class="traffic-values"><span><b>${data.clicks}</b> 紹介リンク訪問</span><span><b>${data.customers}</b> 購入者</span></div><p class="muted">訪問はブラウザ識別子・商品・日単位で重複排除。人間の実人数ではありません。</p></div><div class="panel compact"><span class="eyebrow">YOUR PRODUCTS</span><h3>掲載商品の収益</h3><strong class="creator-total">${yen(data.creator)}</strong><p class="muted">紹介料と運営手数料を差し引いた台帳上の配分額。</p></div></div>`}
    <section class="panel"><div class="panel-heading"><h2>報酬の履歴</h2><span class="muted">JPY · 整数円</span></div>${ledger(data)}</section>${earnings && data.payouts.length ? `<section class="panel"><div class="panel-heading"><h2>出金申請</h2></div><div class="table-scroll"><table><thead><tr><th>申請日</th><th>状態</th><th class="number">金額</th></tr></thead><tbody>${data.payouts.map(p => `<tr><td>${date(p.created_at)}</td><td>${{ requested: '確認待ち', paid: '実送金記録済み', rejected: '却下' }[p.state]}</td><td class="number">${yen(p.amount)}</td></tr>`).join('')}</tbody></table></div></section>` : ''}`;
}
async function network(params) {
  const parent = params.get('parent') || state.me.user.id;
  const page = Math.max(0, Number(params.get('page') || 0));
  const data = await api(`/api/network?parent=${encodeURIComponent(parent)}&offset=${page * 50}`);
  const link = `${state.me.origin}/join/${state.me.user.code}`;
  return `${pageHeading('YOUR NETWORK', 'ひとりの紹介が、次のつながりに。', '登録だけでは報酬は発生しません。ネットワーク報酬は、対象の商品売上から分配します。')}
    <section class="invite-card"><div><span class="eyebrow light">INVITE A PARTNER</span><h2>一緒に紹介する仲間を、招待する。</h2><p>参加は無料。商品を買う必要はありません。</p><div class="copy-field"><code>${escape(link)}</code><button class="button lime small" data-action="copy-invite">リンクをコピー ↗</button></div></div><div class="invite-total"><strong>${data.total}</strong><span>ネットワークの参加者</span></div></section>
    <div class="network-rules"><p><b>固定の階層上限なし</b><span>報酬総額は商品ごとのネットワーク原資内。1円未満になる階層は配分しません。</span></p><p><b>紹介元は登録時に確定</b><span>後から付け替えず、循環・自己紹介を防ぎます。</span></p></div>
    <section class="panel"><div class="panel-heading"><h2>${escape(data.parent.name)}さんの直接紹介</h2>${parent !== state.me.user.id ? '<a class="text-button" href="/#network">自分のネットワークへ戻る ↗</a>' : ''}</div>
    ${data.members.length ? `<div class="network-list">${data.members.map((m, index) => `<div class="network-person"><span class="avatar member-${index % 3}">${escape(m.name.slice(0, 1))}</span><div><strong>${escape(m.name)}</strong><small>${date(m.created_at)} 登録</small></div><span class="member-count">直接紹介 ${m.children}人</span>${m.children ? `<a class="button outline small" href="/#network?parent=${encodeURIComponent(m.id)}">下の階層を見る ↗</a>` : '<span class="muted">まだ紹介なし</span>'}</div>`).join('')}</div>` : empty('ここから、ネットワークを育てる', 'あなたの招待リンクから登録した紹介者がここに表示されます。', '<button class="button" data-action="copy-invite">招待リンクをコピー ↗</button>')}
    <div class="pagination">${page > 0 ? `<a href="/#network?parent=${encodeURIComponent(parent)}&page=${page - 1}">← 前へ</a>` : ''}<span>最大50人ずつ表示</span>${data.hasMore ? `<a href="/#network?parent=${encodeURIComponent(parent)}&page=${page + 1}">次へ →</a>` : ''}</div></section>`;
}
async function creator() {
  const data = await api('/api/my-products');
  return `${pageHeading('FOR BUILDERS', '作った価値を、届けてもらう。', '商品を申請し、運営が確認してから公開。掲載料・参加費はありません。')}
    <div class="creator-layout"><section class="panel"><div class="panel-heading"><h2>商品を掲載申請</h2><span class="badge">審査あり</span></div><form id="product-form" class="form-stack">
      <label>商品名<input name="name" required minlength="2" maxlength="60" placeholder="あなたのプロダクト名"></label><label>ひとことで説明<input name="tagline" required minlength="5" maxlength="120" placeholder="誰の、どんな課題を解決しますか？"></label>
      <label>商品の詳細<textarea name="description" rows="4" required minlength="10" maxlength="3000" placeholder="機能、利用条件、対象ユーザーを説明してください。"></textarea></label>
      <div class="form-row"><label>カテゴリ<select name="category">${['AI・自動化', 'マーケティング', 'ビジネス', 'クリエイティブ'].map(c => `<option>${c}</option>`).join('')}</select></label><label>月額（円）<input type="number" name="price" min="100" max="10000000" step="1" value="4980" required></label></div>
      <div class="form-row"><label>直接紹介報酬<select name="directBps">${[2500, 3000, 3500, 4000, 5000].map(n => `<option value="${n}" ${n === 3500 ? 'selected' : ''}>${pct(n)}</option>`).join('')}</select></label><label>ネットワーク原資の上限<select name="networkBps"><option value="1000">10%</option><option value="500">5%</option><option value="0">0%（直接紹介のみ）</option></select></label></div>
      <label>商品公式URL<input type="url" name="url" required maxlength="500" placeholder="https://your-product.example"></label><p class="field-hint">別途、対象売上の10%が運営手数料です。報酬計算は税・決済費用等を除いた原資に対して行います。</p><p class="form-error" id="product-error" role="alert"></p><button class="button" type="submit">掲載を申請する ↗</button></form></section>
      <aside class="creator-side"><div class="panel compact"><span class="eyebrow">BEFORE YOU PUBLISH</span><h3>商品そのものに価値を。</h3><p>紹介権、参加費、教材の強制購入を販売する仕組みにはしません。利用者が紹介報酬抜きでも欲しい商品を掲載してください。</p><hr><h3>申請と決済は別です。</h3><p>このMVPは商品を掲載するプラットフォームです。商品本体・決済画面・外部販売者の売上照合は自動では作成されません。</p></div></aside></div>
      <section class="panel"><div class="panel-heading"><h2>あなたの掲載商品</h2><span>${data.products.length}件</span></div>${data.products.length ? `<div class="network-list">${data.products.map(p => `<div class="network-person">${logo(p)}<div><strong>${escape(p.name)}</strong><small>${yen(p.price)} / 月</small></div><span class="badge">${{ pending: '審査待ち', active: '公開中', rejected: '非公開' }[p.status]}</span></div>`).join('')}</div>` : empty('まだ掲載商品がありません', '上のフォームから最初の商品を申請してください。', '')}</section>`;
}
async function admin() {
  const data = await api('/api/admin');
  return `${pageHeading('OPERATIONS', 'プラットフォームを管理する。', '商品審査・出金照合・監査ログ。デモでは実送金操作は無効です。', '<a class="button outline" href="/api/admin/payouts.csv">出金確認CSVを出力 ↓</a>')}
    <div class="notice"><strong>CSVは銀行送金ファイルではありません。</strong><p>外部の支払手続きと本人確認を終え、実際の送金番号を確認してから支払済みとして記録してください。</p></div>
    <section class="panel"><div class="panel-heading"><h2>商品の公開審査</h2><span class="muted">直近100件</span></div><div class="review-list">${data.products.map(p => `<article class="review-item"><div><strong>${escape(p.name)}</strong> <span class="badge">${{ active: '公開中', pending: '審査待ち', rejected: '非公開' }[p.status]}</span><p>${escape(p.description)}</p><a href="${escape(p.url)}" target="_blank" rel="noopener noreferrer nofollow">商品URLを確認 ↗</a><small>${yen(p.price)} / 直接 ${pct(p.direct_bps)} / ネットワーク上限 ${pct(p.network_bps)}</small></div><div class="review-actions"><button class="button small" data-action="approve" data-id="${escape(p.id)}" ${p.status === 'active' ? 'disabled' : ''}>公開する</button><button class="button outline small" data-action="reject" data-id="${escape(p.id)}" ${p.status === 'rejected' ? 'disabled' : ''}>非公開にする</button></div></article>`).join('') || empty('審査する商品はありません', '商品申請が届くとここに表示します。', '')}</div></section>
    <section class="panel"><div class="panel-heading"><h2>出金の照合</h2></div>${data.payouts.length ? `<div class="review-list">${data.payouts.map(p => `<article class="review-item"><div><strong>${escape(p.name)} / ${yen(p.amount)}</strong><small>${escape(p.state)} · ${date(p.created_at)}</small></div>${p.state === 'requested' ? `<div class="review-actions"><button class="button small" data-action="paid" data-id="${escape(p.id)}">実送金を照合</button><button class="button outline small" data-action="payout-reject" data-id="${escape(p.id)}">却下する</button></div>` : ''}</article>`).join('')}</div>` : empty('未処理の出金申請はありません', '出金接続後、申請をここで照合します。', '')}</section>
    <section class="panel"><div class="panel-heading"><h2>監査ログ</h2><span class="muted">直近50件</span></div><div class="audit-list">${data.audits.map(row => `<div><code>${escape(row.action)}</code><span>${date(row.created_at)}</span><small>${escape(row.target)}</small></div>`).join('') || '<p class="muted compact">操作ログはまだありません。</p>'}</div></section>`;
}
function productDetail(product, standalone = false) {
  return `<div class="product-detail">${!standalone ? '<button class="close-dialog" data-action="close-detail" aria-label="閉じる">×</button>' : ''}<div class="detail-header">${logo(product, true)}<div><span class="eyebrow">${escape(product.category)}</span><h2 id="detail-title">${escape(product.name)}</h2><p>${escape(product.tagline)}</p></div></div><span class="badge">${product.demo ? 'サンプル商品 / 購入不可' : '掲載審査済み / 決済未接続'}</span><p class="detail-description">${escape(product.description)}</p>
    <div class="detail-numbers"><div><span>掲載月額</span><strong>${yen(product.price)}</strong></div><div><span>直接紹介報酬</span><strong>${pct(product.direct_bps)}</strong></div><div><span>ネットワーク原資</span><strong>最大${pct(product.network_bps)}</strong></div></div>
    <div class="notice"><strong>報酬率と実際の受取額は異なります。</strong><p>直接報酬は対象売上×報酬率。ネットワークは原資の1/2、1/4、1/8…を上位へ配分し、1円未満は配分しません。税・決済費用・返金等を除いた原資を使うため、掲載価格からの単純計算は収益保証ではありません。</p></div>
    <div class="detail-actions"><button class="button" data-action="copy-product" data-id="${escape(product.id)}">紹介リンクをコピー ↗</button><button class="button outline" data-action="copy-post" data-id="${escape(product.id)}">紹介文をコピー</button><button class="button outline" disabled>購入：決済未接続</button></div><p class="field-hint">紹介文には「広告 / PR」を明示します。自己購入・参加者登録だけでは報酬は発生しません。</p>${!product.demo ? `<a class="text-button" href="${escape(product.url)}" target="_blank" rel="noopener noreferrer nofollow">商品公式サイト ↗</a>` : ''}</div>`;
}
function showAuth(mode = 'login') {
  if ($('#detail-dialog').open) $('#detail-dialog').close();
  const register = mode === 'register';
  $('#auth-dialog').innerHTML = `<button class="close-dialog" data-action="close-auth" aria-label="閉じる">×</button><div class="eyebrow">YOUR NEXT OPPORTUNITY</div><h2 id="auth-title">${register ? '無料で、はじめよう。' : 'おかえりなさい。'}</h2><p class="muted">${register ? '販売参加のための商品購入・有料登録は不要です。' : 'あなたの紹介リンクと報酬を確認しましょう。'}</p>${register && state.me.inviter ? `<div class="notice compact">紹介者：${escape(state.me.inviter)}<br><small>この紹介関係は登録後に変更できません。</small></div>` : ''}<form id="auth-form" class="form-stack" data-mode="${mode}">${register ? '<label>表示名<input name="name" required minlength="2" maxlength="40" autocomplete="nickname"></label>' : ''}<label>メールアドレス<input type="email" name="email" required maxlength="254" autocomplete="email"></label><label>パスワード<input type="password" name="password" required ${register ? 'minlength="12"' : ''} maxlength="128" autocomplete="${register ? 'new-password' : 'current-password'}" placeholder="${register ? '12文字以上' : ''}"></label><p class="form-error" id="auth-error" role="alert"></p><button class="button" type="submit">${register ? '無料で登録する' : 'ログインする'} ↗</button></form><div class="auth-switch">${register ? 'すでに登録済みですか？' : 'アカウントをお持ちでない方'}<button class="text-button" data-action="${register ? 'login' : 'register'}">${register ? 'ログイン' : '無料登録'}</button></div>${state.me.demo ? '<button class="button outline full" data-action="demo-login">入力せずにデモで試す ↗</button>' : ''}`;
  if (!$('#auth-dialog').open) $('#auth-dialog').showModal();
}
function help() {
  $('#detail-dialog').innerHTML = `<div class="product-detail"><button class="close-dialog" data-action="close-detail" aria-label="閉じる">×</button><span class="eyebrow">HOW IT WORKS</span><h2 id="detail-title">売上に基づく、紹介ネットワーク。</h2><div class="help-section"><h3>1. 登録は無料</h3><p>有料会員登録・商品購入・教材購入を参加条件にしません。人を登録させる行為だけでは報酬を払いません。</p><h3>2. 報酬原資は確認できた売上</h3><p>直接紹介者への配分、上位紹介者への逓減配分、運営手数料10%を控除し、残額を商品提供者へ。返金は元の配分をそのまま取り消します。</p><h3>3. 紹介リンクは30日・最初の接点を優先</h3><p>同じブラウザ・商品について最初に有効な紹介リンクを記録します。Cookie削除、別端末、外部サイトでの未連携決済は追跡できません。</p><h3>4. このリリースの範囲</h3><p>決済画面、支払事業者、本人確認・税務、メール確認、正式な規約等の本番準備は別途必要です。紹介の階層数だけで法的適合性を判断しません。</p><h3>5. 収入保証はありません</h3><p>表示された率は配分ルールであり、成約・継続・収益を保証しません。広告であることを明示し、誇大な勧誘を行わないでください。</p></div></div>`;
  $('#detail-dialog').showModal();
}
async function copy(value) {
  try { await navigator.clipboard.writeText(value); toast('コピーしました。'); }
  catch { toast('クリップボードを利用できません。表示されたリンクを選択してコピーしてください。'); $('#detail-dialog').innerHTML = `<div class="product-detail"><button class="close-dialog" data-action="close-detail" aria-label="閉じる">×</button><h2 id="detail-title">リンク・紹介文</h2><textarea class="copy-fallback" readonly>${escape(value)}</textarea></div>`; if (!$('#detail-dialog').open) $('#detail-dialog').showModal(); $('.copy-fallback').select(); }
}
async function render() {
  const epoch = ++state.epoch;
  const raw = location.hash.slice(1);
  const [route, query] = raw.split('?');
  const page = names[route] ? route : !raw && location.pathname.startsWith('/p/') ? 'product' : 'market';
  $('#page-title').textContent = names[page];
  document.querySelectorAll('[data-nav]').forEach(link => { link.classList.toggle('active', link.dataset.nav === page); if (link.dataset.nav === page) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); });
  $('#sidebar').classList.remove('mobile-open'); $('#mobile-menu').setAttribute('aria-expanded', 'false');
  let markup;
  try {
    if (page === 'market') markup = market();
    else if (page === 'product') { const product = state.products.find(p => p.slug === location.pathname.split('/')[2]); markup = product ? `<section class="panel standalone-detail">${productDetail(product, true)}</section>` : empty('商品が見つかりません', '非公開になっているか、URLが異なります。'); }
    else if (!state.me.user) markup = empty('無料登録で、ワークスペースを作る。', '紹介リンク・ネットワーク・報酬台帳をひとつに。', '<button class="button" data-action="register">無料で登録する ↗</button>');
    else if (page === 'dashboard' || page === 'earnings') markup = await dashboard(page === 'earnings');
    else if (page === 'network') markup = await network(new URLSearchParams(query));
    else if (page === 'creator') markup = await creator();
    else markup = state.me.user.role === 'admin' ? await admin() : empty('管理者専用のページです', 'このアカウントでは閲覧できません。');
    if (epoch !== state.epoch) return;
    $('#content').innerHTML = markup;
    if (route === 'register' && !state.me.user) showAuth('register');
    if (route === 'catalog') $('#catalog')?.scrollIntoView({ behavior: 'smooth' });
  } catch (error) { if (epoch === state.epoch) $('#content').innerHTML = empty('読み込めませんでした', error.message, '<button class="button" data-action="retry">もう一度試す</button>'); }
}
document.addEventListener('click', async event => {
  const category = event.target.closest('[data-category]');
  if (category) { state.category = category.dataset.category; updateGrid(); return; }
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  if (action === 'login' || action === 'register') return showAuth(action);
  if (action === 'close-auth') return $('#auth-dialog').close();
  if (action === 'close-detail') return $('#detail-dialog').close();
  if (action === 'help') return help();
  if (action === 'product') { const p = state.products.find(p => p.id === button.dataset.id); $('#detail-dialog').innerHTML = productDetail(p); return $('#detail-dialog').showModal(); }
  const requiresAccount = ['copy-product', 'copy-post', 'copy-invite', 'payout'];
  if (requiresAccount.includes(action) && !state.me.user) return showAuth('register');
  button.disabled = true;
  try {
    if (action === 'retry') await refresh();
    if (action === 'copy-invite') return await copy(`${state.me.origin}/join/${state.me.user.code}`);
    if (action === 'copy-product' || action === 'copy-post') {
      const p = state.products.find(p => p.id === button.dataset.id);
      const link = `${state.me.origin}/r/${state.me.user.code}/${p.slug}`;
      return await copy(action === 'copy-post' ? `【広告 / PR】${p.demo ? '【デモ・購入不可】' : ''}${p.name} — ${p.tagline}\n掲載価格 ${yen(p.price)} / 月。機能・条件は商品ページをご確認ください。\n${link}\nこのリンク経由の対象購入から紹介報酬を受け取る場合があります。` : link);
    }
    if (action === 'demo-login' || action === 'demo-admin') { await api('/api/demo/login', { role: action === 'demo-admin' ? 'admin' : 'seller' }); $('#auth-dialog').close(); await refresh(); location.hash = action === 'demo-admin' ? 'admin' : 'dashboard'; }
    else if (action === 'logout') { await api('/api/auth/logout', {}); await refresh(); location.hash = 'market'; }
    else if (action === 'demo-sale' || action === 'demo-network-sale') { button.dataset.key ||= crypto.randomUUID(); await api('/api/demo/sale', { productId: $('#demo-product').value, through: action === 'demo-network-sale' ? 'network' : 'self', idempotencyKey: button.dataset.key }); toast('テスト売上を台帳に記録しました。実際の金銭は動いていません。'); }
    else if (action === 'demo-refund') { await api('/api/demo/refund', {}); toast('元の配分と同額の取消仕訳を記録しました。'); }
    else if (action === 'approve' || action === 'reject') { await api('/api/admin/products', { id: button.dataset.id, status: action === 'approve' ? 'active' : 'rejected' }); await refresh(); toast('掲載状態を更新しました。'); }
    else if (action === 'payout') { if (!confirm(`${yen(Number(button.dataset.amount))}の出金確認を申請します。申請だけでは送金されません。続行しますか？`)) return; button.dataset.key ||= crypto.randomUUID(); await api('/api/payouts', { amount: Number(button.dataset.amount), idempotencyKey: button.dataset.key }); toast('出金確認を申請しました。'); }
    else if (action === 'paid' || action === 'payout-reject') { const reference = action === 'paid' ? prompt('実際の銀行・支払事業者の送金照合番号（8文字以上）') : null; if (action === 'paid' && !reference) return; if (!confirm(action === 'paid' ? '実送金を確認済みとして記録します。この操作は送金を実行しません。確定しますか？' : 'この出金申請を却下しますか？')) return; await api('/api/admin/payouts', { id: button.dataset.id, status: action === 'paid' ? 'paid' : 'rejected', reference }); }
    await render();
  } catch (error) { toast(error.message); } finally { button.disabled = false; }
});
document.addEventListener('submit', async event => {
  if (!['auth-form', 'product-form'].includes(event.target.id)) return;
  event.preventDefault();
  const form = event.target;
  const submit = form.querySelector('[type=submit]');
  const errorBox = form.querySelector('.form-error');
  errorBox.textContent = ''; submit.disabled = true;
  try {
    const values = Object.fromEntries(new FormData(form));
    if (form.id === 'auth-form') { await api(`/api/auth/${form.dataset.mode}`, values); await refresh(); $('#auth-dialog').close(); location.hash = 'dashboard'; await render(); }
    else { await api('/api/products', { ...values, price: Number(values.price), directBps: Number(values.directBps), networkBps: Number(values.networkBps) }); toast('掲載を申請しました。運営確認後に公開されます。'); await render(); }
  } catch (error) { errorBox.textContent = error.message; } finally { submit.disabled = false; }
});
document.addEventListener('input', event => { if (event.target.id === 'search') { state.query = event.target.value; updateGrid(); } });
document.addEventListener('change', event => { if (event.target.id === 'sort') { state.sort = event.target.value; updateGrid(); } });
$('#mobile-menu').addEventListener('click', () => { const open = $('#sidebar').classList.toggle('mobile-open'); $('#mobile-menu').setAttribute('aria-expanded', String(open)); });
window.addEventListener('hashchange', render);
refresh().then(render).catch(error => { $('#content').innerHTML = empty('サーバーに接続できません', error.message, '<button class="button" data-action="retry">再試行</button>'); });
