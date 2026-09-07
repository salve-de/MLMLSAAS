import { assert, integer } from './security.mjs';

/** JPY integer accounting. No floating-point percentages. No recruitment payment.
 * The graph has no depth cap. Monetary allocation stops below 1 JPY; unpaid dust
 * stays with the creator. Ineligible ancestors are skipped WITHOUT compression.
 */
export function allocate({ amount, directBps, networkBps, referrer, customerId, creatorId, getUser }) {
  integer(amount, 1, 100000000, '報酬原資');
  integer(directBps, 0, 5000, '直接報酬率');
  integer(networkBps, 0, 1000, 'ネットワーク報酬率');
  const portion = bps => Number(BigInt(amount) * BigInt(bps) / 10000n);
  const entries = [];
  const add = (userId, kind, value, depth = 0) => { if (value > 0) entries.push({ userId, kind, amount: value, depth }); };
  const eligible = id => id && id !== customerId && id !== creatorId;
  let user = referrer ? getUser(referrer) : null;
  // A self-purchase never rewards either the purchaser or their upstream network.
  if (user && eligible(user.id) && customerId !== creatorId) {
    add(user.id, 'direct', portion(directBps));
    const seen = new Set([user.id]);
    let reward = Math.floor(portion(networkBps) / 2);
    let depth = 1;
    while (user.sponsor_id && reward > 0) {
      assert(!seen.has(user.sponsor_id), '紹介ネットワークが循環しています。', 409);
      seen.add(user.sponsor_id);
      user = getUser(user.sponsor_id);
      assert(user, '紹介ネットワークが不整合です。', 409);
      if (eligible(user.id)) add(user.id, 'network', reward, depth);
      reward = Math.floor(reward / 2);
      depth++;
    }
  }
  add(null, 'platform', portion(1000));
  add(creatorId, 'creator', amount - entries.reduce((sum, entry) => sum + entry.amount, 0));
  assert(entries.reduce((sum, entry) => sum + entry.amount, 0) === amount, '会計の不整合', 500);
  return entries;
}
