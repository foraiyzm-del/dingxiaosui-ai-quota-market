// Offline-only provider fixture. No SDK, external fetch, payment, or model calls.
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const defaultPackage = Object.freeze({ packageId: 'trial', name: '丁小穗尝鲜卡', priceCents: 990 });
const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const timestamp = () => new Date().toISOString();
const fail = (status, message, code = 'MOCK_INVALID_REQUEST') => { throw Object.assign(new Error(message), { status, code, retryable: false }); };
function identifier(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 512) fail(400, '模拟请求标识无效');
  return value;
}
function requireOne(amount = 1) { if (amount !== 1) fail(400, '模拟套餐仅接受 amount=1'); return amount; }

export async function createMockOpcpay({ dbPath, port = 0, package: definition = defaultPackage } = {}) {
  if (typeof dbPath !== 'string' || !dbPath.trim()) fail(400, '必须指定独立的模拟数据库路径');
  if (!Number.isInteger(port) || (port !== 0 && (port < 1024 || port > 65535))) fail(400, '模拟端口无效');
  if (!definition || !['trial', 'week', 'month'].includes(definition.packageId)
    || typeof definition.name !== 'string' || !definition.name.trim() || definition.name.length > 128
    || !Number.isSafeInteger(definition.priceCents) || definition.priceCents < 1) fail(400, '固定模拟套餐配置无效');
  const savedDefinition = { packageId: definition.packageId, name: definition.name, priceCents: definition.priceCents };
  const option = Object.freeze({ sku_id: `opcpay-${definition.packageId}-sku`, plan_id: `opcpay-${definition.packageId}-plan`, display_name: definition.name,
    billing_mode: 'QUANTITY', price: (definition.priceCents / 100).toFixed(2), currency: 'CNY', price_version: 1,
    entitlement_rule: 'QUOTA', quota_unit: 'COUNT', quota_amount: 1 });
  const productName = definition.name + '（本地模拟）';
  if (dbPath !== ':memory:') mkdirSync(dirname(resolve(dbPath)), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS mock_accounts (
      user_id TEXT PRIMARY KEY, total INTEGER NOT NULL DEFAULT 0 CHECK(total>=0),
      used INTEGER NOT NULL DEFAULT 0 CHECK(used>=0 AND used<=total), next_mode TEXT NOT NULL DEFAULT 'success'
    );
    CREATE TABLE IF NOT EXISTS mock_purchases (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, idempotency_key TEXT NOT NULL,
      outcome TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(user_id,idempotency_key)
    );
    CREATE TABLE IF NOT EXISTS mock_consumptions (
      user_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, reason TEXT NOT NULL,
      response_json TEXT NOT NULL, succeeded INTEGER NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY(user_id,idempotency_key)
    );
    CREATE TABLE IF NOT EXISTS mock_metrics (id INTEGER PRIMARY KEY CHECK(id=1), consume_requests INTEGER NOT NULL DEFAULT 0);
    INSERT OR IGNORE INTO mock_metrics(id) VALUES(1);
    CREATE TABLE IF NOT EXISTS mock_identity (id INTEGER PRIMARY KEY CHECK(id=1), definition_json TEXT NOT NULL);
  `);
  function transaction(work) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = work(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  try {
    transaction(() => {
      const saved = db.prepare('SELECT definition_json FROM mock_identity WHERE id=1').get();
      const serialized = JSON.stringify(savedDefinition);
      // Before this metadata existed, every mock database was a trial project.
      if ((saved && saved.definition_json !== serialized)
        || (!saved && definition.packageId !== 'trial' && db.prepare('SELECT COUNT(*) AS count FROM mock_purchases').get().count)) {
        fail(409, '模拟数据库已绑定其他套餐，必须使用独立的模拟数据库路径');
      }
      if (!saved) db.prepare('INSERT INTO mock_identity(id,definition_json) VALUES(1,?)').run(serialized);
    });
  } catch (error) { db.close(); throw error; }
  const account = userId => db.prepare('SELECT * FROM mock_accounts WHERE user_id=?').get(userId) ?? { total: 0, used: 0, next_mode: 'success' };
  let baseUrl;
  function purchaseResult(row) {
    return { status: row.outcome === 'purchase-denied' ? 'FAILED' : 'READY', idempotency_key: row.idempotency_key,
      purchase_url: `${baseUrl}/purchase/${row.id}`, charging_option: { ...option },
      ...(row.outcome === 'purchase-denied' ? { message: '本地模拟：购买被拒绝', reason_code: 'MOCK_PURCHASE_DENIED' } : {}) };
  }
  function confirmPurchase(id, mode) {
    if (!['success', 'deny', 'lost', 'purchase-denied'].includes(mode)) fail(400, '模拟场景无效');
    return transaction(() => {
      const row = db.prepare('SELECT * FROM mock_purchases WHERE id=?').get(id);
      if (!row) fail(404, '模拟购买不存在');
      if (row.outcome !== 'pending') return row.outcome;
      db.prepare('UPDATE mock_purchases SET outcome=?,updated_at=? WHERE id=?').run(mode, timestamp(), id);
      if (mode !== 'purchase-denied') {
        db.prepare(`INSERT INTO mock_accounts(user_id,total,next_mode) VALUES(?,1,?)
          ON CONFLICT(user_id) DO UPDATE SET total=total+1,next_mode=excluded.next_mode`).run(row.user_id, mode);
      }
      return mode;
    });
  }
  function page(outcome) {
    const messages = { pending: '请选择本次本地模拟场景。', success: '模拟购买已确认。请返回套餐页面继续兑换。',
      deny: '模拟购买已确认。首次消费请求会明确拒绝，余额不会扣减。',
      lost: '模拟购买已确认。首次消费会成功扣减并丢失响应，随后可查询恢复。',
      'purchase-denied': '模拟购买已拒绝，没有增加任何权益。' };
    return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <title>本地模拟收银台 · ${escapeHTML(definition.name)}</title><style>
      *{box-sizing:border-box}body{margin:0;padding:48px 20px;background:#f4f2ea;color:#20372e;font:16px/1.7 system-ui,sans-serif}
      main{max-width:640px;margin:auto;padding:36px;background:#fff;border:1px solid #dedfd6;border-radius:16px}
      .eyebrow{font-size:13px;letter-spacing:.12em;color:#62776b}h1{font-size:30px;line-height:1.3;margin:18px 0}.price{font-size:40px;font-weight:750;margin:8px 0}
      .status{padding:16px;background:#eff4ed;border-left:4px solid #376b49;margin:24px 0}form{display:grid;gap:10px}
      button{font:inherit;text-align:left;padding:13px 16px;border-radius:8px;border:1px solid #c7d1c8;background:#fff;color:#20372e;cursor:pointer}
      button:first-child{background:#285e42;color:white;border-color:#285e42}button:focus-visible{outline:3px solid #d29930;outline-offset:3px}.note{font-size:14px;color:#68756c;margin-top:24px}
      </style><main><div class="eyebrow">OFFLINE FIXTURE · 支付宝购买流程模拟</div><h1>${escapeHTML(definition.name)}</h1>
      <div class="price">¥${option.price}</div><p>1 次固定套餐兑换权益 · QUANTITY / COUNT</p><p class="status" role="status">${messages[outcome]}</p>
      ${outcome === 'pending' ? `<form method="post"><button name="mode" value="success">模拟购买成功</button>
      <button name="mode" value="purchase-denied">模拟购买拒绝（不增加权益）</button>
      <button name="mode" value="deny">模拟购买成功，消费明确拒绝</button>
      <button name="mode" value="lost">模拟购买成功，扣减成功但响应丢失</button></form>` : ''}
      <p class="note">本页仅操作隔离的本地模拟数据库，不会连接支付宝、OPcPay 或真实支付渠道，也不会产生真实付款。刷新或重复确认不会重复增加权益。</p></main></html>`;
  }
  const server = createServer(async (request, response) => {
    const headers = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'same-origin',
      'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'" };
    try {
      if (request.headers.host !== new URL(baseUrl).host) fail(403, '仅允许本机模拟地址');
      const parsed = new URL(request.url, baseUrl);
      const match = /^\/purchase\/([a-f0-9]{48})$/.exec(parsed.pathname);
      if (!match || parsed.search) fail(404, '模拟购买不存在');
      const row = db.prepare('SELECT outcome FROM mock_purchases WHERE id=?').get(match[1]);
      if (!row) fail(404, '模拟购买不存在');
      let outcome = row.outcome;
      if (request.method === 'POST') {
        if (request.headers.origin !== baseUrl) fail(403, '模拟确认来源无效');
        if (!request.headers['content-type']?.startsWith('application/x-www-form-urlencoded')) fail(415, '模拟确认格式无效');
        const parts = []; let size = 0;
        for await (const part of request) { size += part.length; if (size > 1024) fail(413, '模拟请求过大'); parts.push(part); }
        const form = new URLSearchParams(Buffer.concat(parts).toString());
        if (form.getAll('mode').length !== 1) fail(400, '请选择一个模拟场景');
        outcome = confirmPurchase(match[1], form.get('mode'));
      } else if (request.method !== 'GET') fail(405, '模拟方法不支持');
      response.writeHead(200, headers); response.end(page(outcome));
    } catch (error) {
      response.writeHead(error.status ?? 500, { ...headers, 'content-type': 'text/plain; charset=utf-8' });
      response.end(error.status ? error.message : '本地模拟服务异常');
    }
  });
  try {
    await new Promise((accept, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', accept); });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  } catch (error) { db.close(); throw error; }
  const client = {
    async capabilities() {
      return { api_version: '1.1.2', provider_configured: true, capabilities: { purchase_entry: true, entitlement_query: true,
        consumption: true, purchase_request_query: true, purchase_request_list: false, consumption_list: false,
        webhooks: false, entitlement_monitoring: false, transaction_query: false, transaction_list: false,
        refund: false, refund_query: false, bills: false, automatic_renewal: false, consumption_reversal: false },
      webhook_events: [], limitations: ['Offline fixture only; no real payment or provider traffic.'] };
    },
    async product() {
      return { product_name: productName, capability_status: 'ENABLED', status_version: 1,
        billing_mode: 'QUANTITY', quota_unit: 'COUNT', charging_options: [{ ...option }] };
    },
    async purchase({ userId, idempotencyKey, skuId } = {}) {
      identifier(userId); identifier(idempotencyKey);
      if (skuId !== option.sku_id) fail(400, '模拟套餐 SKU 无效');
      const row = transaction(() => {
        const existing = db.prepare('SELECT * FROM mock_purchases WHERE user_id=? AND idempotency_key=?').get(userId, idempotencyKey);
        if (existing) return existing;
        const id = randomBytes(24).toString('hex'), at = timestamp();
        db.prepare('INSERT INTO mock_purchases(id,user_id,idempotency_key,created_at,updated_at) VALUES(?,?,?,?,?)').run(id, userId, idempotencyKey, at, at);
        return db.prepare('SELECT * FROM mock_purchases WHERE id=?').get(id);
      });
      return purchaseResult(row);
    },
    async purchaseQuery(userId, idempotencyKey) {
      identifier(userId); identifier(idempotencyKey);
      const row = db.prepare('SELECT * FROM mock_purchases WHERE user_id=? AND idempotency_key=?').get(userId, idempotencyKey);
      if (!row) fail(404, '模拟购买不存在', 'NOT_FOUND');
      return { id: row.id, kind: 'purchase', idempotency_key: idempotencyKey, status: row.outcome === 'purchase-denied' ? 'FAILED' : 'READY',
        user_id: userId, sku_id: option.sku_id, amount: null, reason: null, response: purchaseResult(row), expires_at: null,
        created_at: row.created_at, updated_at: row.updated_at, payment_status: 'NOT_AVAILABLE' };
    },
    async access(userId, amount = 1) {
      identifier(userId); requireOne(amount); const balance = account(userId), remaining = balance.total - balance.used;
      return { access_granted: remaining >= 1, requires_consumption: true, decision: remaining >= 1 ? 'ALLOW' : 'PURCHASE_REQUIRED',
        product_name: productName, capability_status: 'ENABLED', charging_options: [{ ...option }], quota_unit: 'COUNT',
        total: balance.total, used: balance.used, remaining, as_of_time: timestamp() };
    },
    async consume({ userId, idempotencyKey, amount = 1, reason } = {}) {
      identifier(userId); identifier(idempotencyKey); identifier(reason); requireOne(amount);
      const result = transaction(() => {
        db.prepare('UPDATE mock_metrics SET consume_requests=consume_requests+1 WHERE id=1').run();
        const existing = db.prepare('SELECT * FROM mock_consumptions WHERE user_id=? AND idempotency_key=?').get(userId, idempotencyKey);
        if (existing) {
          if (existing.reason !== reason) fail(409, '模拟幂等请求参数不一致', 'IDEMPOTENCY_CONFLICT');
          return { receipt: JSON.parse(existing.response_json), lost: false };
        }
        const balance = account(userId), available = balance.total - balance.used;
        const succeeded = available >= 1 && balance.next_mode !== 'deny';
        const receipt = { status: succeeded ? 'SUCCEEDED' : 'FAILED', confirmed: true, idempotency_key: idempotencyKey,
          consume_status: succeeded ? 'SUCCEEDED' : 'FAILED', consume_order_id: `mock-${randomBytes(16).toString('hex')}`,
          consume_reason: reason, quota_unit: 'COUNT', consumed: succeeded ? 1 : 0,
          remaining: available - (succeeded ? 1 : 0), update_time: timestamp(),
          ...(!succeeded ? { reason_code: balance.next_mode === 'deny' ? 'MOCK_CONSUMPTION_DENIED' : 'INSUFFICIENT_QUOTA' } : {}) };
        db.prepare('UPDATE mock_accounts SET used=used+?,next_mode=? WHERE user_id=?').run(succeeded ? 1 : 0, 'success', userId);
        db.prepare('INSERT INTO mock_consumptions(user_id,idempotency_key,reason,response_json,succeeded,created_at) VALUES(?,?,?,?,?,?)')
          .run(userId, idempotencyKey, reason, JSON.stringify(receipt), succeeded ? 1 : 0, timestamp());
        return { receipt, lost: succeeded && balance.next_mode === 'lost' };
      });
      if (result.lost) throw Object.assign(new Error('本地模拟：扣减已成功，但响应丢失；请查询原幂等键'), { code: 'MOCK_RESPONSE_LOST', retryable: true });
      return result.receipt;
    },
    async consumption(userId, idempotencyKey) {
      identifier(userId); identifier(idempotencyKey);
      const row = db.prepare('SELECT response_json FROM mock_consumptions WHERE user_id=? AND idempotency_key=?').get(userId, idempotencyKey);
      return row ? JSON.parse(row.response_json) : { status: 'UNKNOWN', confirmed: false, idempotency_key: idempotencyKey };
    },
  };
  let closePromise;
  return { client, baseUrl,
    stats() {
      const balances = db.prepare('SELECT COALESCE(SUM(total),0) AS total,COALESCE(SUM(used),0) AS used FROM mock_accounts').get();
      return { purchaseCount: db.prepare('SELECT COUNT(*) AS count FROM mock_purchases').get().count,
        confirmedPurchaseCount: db.prepare("SELECT COUNT(*) AS count FROM mock_purchases WHERE outcome IN ('success','deny','lost')").get().count,
        consumeCount: db.prepare('SELECT COUNT(*) AS count FROM mock_consumptions WHERE succeeded=1').get().count,
        consumeRequestCount: db.prepare('SELECT consume_requests FROM mock_metrics WHERE id=1').get().consume_requests,
        total: balances.total, used: balances.used, remaining: balances.total - balances.used };
    },
    close() {
      closePromise ??= new Promise((accept, reject) => {
        server.close(error => { db.close(); if (error) reject(error); else accept(); }); server.closeAllConnections();
      });
      return closePromise;
    },
  };
}
