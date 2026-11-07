import { createHmac, randomBytes } from 'node:crypto';
import { createOpcpayClient } from './opcpay-client.mjs';

export const FIXED_PACKAGES = Object.freeze(Object.fromEntries([
  ['trial', '丁小穗尝鲜卡', 990, { text: 10, image: 15, video: 2 }],
  ['week', '丁小穗周卡', 2990, { text: 30, image: 45, video: 6 }],
  ['month', '丁小穗月卡', 9900, { text: 100, image: 150, video: 20 }],
].map(([id, name, priceCents, quota]) => [id, Object.freeze({ projectId: 'dingxiaosui', productId: 'dingxiaosui-opcpay-' + id,
  packageId: id, name, priceCents, quota: Object.freeze(quota), amount: 1 })])));
export const FIXED_PACKAGE = FIXED_PACKAGES.trial;
const fail = (status, message, code) => { throw Object.assign(new Error(message), { status, ...(code ? { code } : {}) }); };
const now = () => new Date().toISOString();
const sessionExpiry = () => new Date(Date.now() + 365 * 86400000).toISOString();
const terminal = new Set(['fulfilled', 'failed', 'cancelled', 'expired']);
const identifier = (value, label) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)) fail(400, `${label}无效`);
  return value;
};
function sameQuota(value, expected) { return value && Object.keys(value).length === 3 && ['text', 'image', 'video'].every(type => value[type] === expected[type]); }
function exactPrice(value, cents) {
  if (typeof value !== 'string' || !/^\d{1,9}(?:\.\d{1,2})?$/u.test(value)) return false;
  const [whole, part = ''] = value.split('.'); return BigInt(whole) * 100n + BigInt(part.padEnd(2, '0')) === BigInt(cents);
}
function validOption(value, skuId, cents) {
  return value?.sku_id === skuId && value.billing_mode === 'QUANTITY' && value.entitlement_rule === 'QUOTA'
    && value.quota_unit === 'COUNT' && value.quota_amount === 1 && value.currency === 'CNY' && exactPrice(value.price, cents);
}
function safeURL(value, localSandbox = false, allowAlipay = false) {
  if (typeof value !== 'string' || value.length > 8192) return undefined;
  try {
    const parsed = new URL(value);
    const allowed = parsed.protocol === 'https:' || (localSandbox && parsed.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname))
      || (allowAlipay && parsed.protocol === 'alipays:' && parsed.hostname === 'platformapi' && parsed.pathname === '/startapp' && !parsed.port && !parsed.hash);
    return allowed && !parsed.username && !parsed.password ? value : undefined;
  } catch { return undefined; }
}

/** Single-process SQLite entitlement coordinator. All provider writes have
 * durable IDs and immutable parameters before sending. Unknown consumption is
 * query-only except an explicit NOT_FOUND can restore that identical request;
 * repeated clicks never create a replacement debit. */
export function createOpcpay(db, { commerce, secret, config = {}, client, clients = {} } = {}) {
  if (!commerce?.fulfillEntitlement || typeof secret !== 'string' || secret.length < 16) fail(400, '权益服务配置无效');
  // Clone configuration so an unrelated caller cannot mutate a live operation.
  config = structuredClone(config);
  const injected = new Map([['trial', client], ['week', clients.week], ['month', clients.month]]);
  const clientCache = new Map(injected);
  const localSandbox = config.sandbox === true && [...injected.values()].some(Boolean);
  const hash = value => createHmac('sha256', secret).update(value).digest('hex');
  const credentialHash = value => hash(`opcpay-credential:${value}`);
  const packageFor = id => {
    if (typeof id !== 'string' || !Object.hasOwn(FIXED_PACKAGES, id)) fail(400, '不支持此兑换套餐');
    return FIXED_PACKAGES[id];
  };
  const profileFor = id => { packageFor(id); return id === 'trial' ? config : config.packages?.[id] ?? {}; };
  const fingerprint = id => {
    const profile = profileFor(id);
    return hash(`opcpay-merchant:${profile.apiKey ?? ''}:${profile.baseURL ?? 'https://ai6666.com/opcpay/api/pay/v1'}`);
  };
  const intentPackage = row => {
    const id = JSON.parse(row.provider_json).profileId ?? 'trial';
    const expected = packageFor(id), snapshot = JSON.parse(row.snapshot_json);
    if (snapshot.packageId !== expected.packageId || snapshot.productId !== expected.productId || snapshot.projectId !== expected.projectId
      || snapshot.priceCents !== expected.priceCents || !sameQuota(snapshot.quota, expected.quota)) fail(409, '原兑换套餐快照与收款绑定不一致', 'CONFIG_MISMATCH');
    return id;
  };
  db.exec(`
    CREATE TABLE IF NOT EXISTS opcpay_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS opcpay_buyers (
      id TEXT PRIMARY KEY, provider_user_id TEXT UNIQUE NOT NULL,
      session_hash TEXT UNIQUE NOT NULL, recovery_hash TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL, recovered_at TEXT
    );
    CREATE TABLE IF NOT EXISTS opcpay_intents (
      id TEXT PRIMARY KEY, buyer_id TEXT NOT NULL REFERENCES opcpay_buyers(id),
      status TEXT NOT NULL, snapshot_json TEXT NOT NULL, provider_json TEXT NOT NULL,
      purchase_key TEXT UNIQUE NOT NULL, consume_key TEXT UNIQUE NOT NULL,
      reason TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      expires_at TEXT NOT NULL, purchase_started_at TEXT, consume_started_at TEXT,
      confirmed_at TEXT, receipt_json TEXT, purchase_json TEXT, message TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS opcpay_intents_buyer ON opcpay_intents(buyer_id,created_at);
    CREATE TABLE IF NOT EXISTS opcpay_intent_requests (
      buyer_id TEXT NOT NULL REFERENCES opcpay_buyers(id), request_id TEXT NOT NULL,
      intent_id TEXT NOT NULL REFERENCES opcpay_intents(id), PRIMARY KEY(buyer_id,request_id)
    );
  `);
  const buyerColumns = new Set(db.prepare('PRAGMA table_info(opcpay_buyers)').all().map(column => column.name));
  if (!buyerColumns.has('session_expires_at')) {
    db.exec('ALTER TABLE opcpay_buyers ADD COLUMN session_expires_at TEXT');
    db.prepare('UPDATE opcpay_buyers SET session_expires_at=? WHERE session_expires_at IS NULL').run(sessionExpiry());
  }
  const operatingMode = localSandbox ? 'local-sandbox' : 'live';
  const savedMode = db.prepare("SELECT value FROM opcpay_meta WHERE key='operating_mode'").get()?.value;
  if (savedMode && savedMode !== operatingMode && db.prepare('SELECT COUNT(*) AS count FROM opcpay_buyers').get().count > 0) {
    fail(409, '模拟与真实权益必须使用不同数据库，不能切换已有身份的运行模式', 'MODE_MISMATCH');
  }
  db.prepare("INSERT INTO opcpay_meta(key,value) VALUES ('operating_mode',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(operatingMode);
  const locks = new Map();
  function transaction(work) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = work(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  async function serial(buyerId, work) {
    const prior = locks.get(buyerId) ?? Promise.resolve();
    const next = prior.catch(() => {}).then(work); locks.set(buyerId, next);
    try { return await next; } finally { if (locks.get(buyerId) === next) locks.delete(buyerId); }
  }
  function configProblem(id = 'trial') {
    const profile = profileFor(id), expected = packageFor(id);
    if (profile.enabled !== true) return '该套餐权益支付尚未启用';
    if (config.sandbox === true && !injected.get(id)) return '沙箱只允许显式注入的独立本地模拟，不会请求真实平台';
    if (typeof profile.apiKey !== 'string' || !profile.apiKey.trim()) return '尚未配置服务端 OPCPay Key';
    if (typeof profile.skuId !== 'string' || !profile.skuId.trim() || profile.skuId.trim() !== profile.skuId || profile.skuId.length > 128) return '尚未配置固定收款套餐';
    if (typeof profile.merchantProjectName !== 'string' || !profile.merchantProjectName.trim()) return '尚未确认专用收款项目名称';
    if (profile.termsConfirmed !== true) return '尚未确认商户开通与收款条款';
    for (const field of ['projectId', 'productId', 'packageId']) if (profile[field] !== expected[field]) return '收款配置与固定套餐不一致';
    if (profile.verifiedPackage?.priceCents !== expected.priceCents || profile.verifiedPackage?.quotaUnit !== 'COUNT' || profile.verifiedPackage?.amount !== 1) return '尚未确认固定价格兑换 1 次权益的收款套餐';
    // Existing trial access must remain available even if a new profile was
    // copied incorrectly. New packages cannot share any entitlement pool.
    if (id !== 'trial') for (const otherId of Object.keys(FIXED_PACKAGES).filter(value => value !== id)) {
      const other = profileFor(otherId);
      if ((typeof other.apiKey === 'string' && other.apiKey.trim() === profile.apiKey.trim())
        || (typeof other.merchantProjectName === 'string' && other.merchantProjectName.trim() === profile.merchantProjectName.trim())) return '每种额度卡须使用不同的专用收款项目和 API Key';
    }
    return null;
  }
  function ready(id) { const problem = configProblem(id); if (problem) fail(503, problem, 'OPCPAY_NOT_READY'); }
  function providerClient(id) {
    ready(id);
    if (!clientCache.get(id)) { const profile = profileFor(id); clientCache.set(id, createOpcpayClient({ apiKey: profile.apiKey, baseURL: profile.baseURL })); }
    return clientCache.get(id);
  }
  function requireBuyer(buyerId) {
    const row = typeof buyerId === 'string' && db.prepare('SELECT * FROM opcpay_buyers WHERE id=?').get(buyerId);
    if (!row) fail(403, '购买身份无效，请恢复购买身份');
    return row;
  }
  function rawIntent({ buyerId, id }) {
    requireBuyer(buyerId); identifier(id, '兑换意向');
    const row = db.prepare('SELECT * FROM opcpay_intents WHERE id=? AND buyer_id=?').get(id, buyerId);
    if (!row) fail(404, '兑换意向不存在');
    // Only unused intents expire locally. A started purchase/debit must remain
    // recoverable even when browser or merchant entry timers have elapsed.
    if (row.status === 'created' && !row.purchase_started_at && !row.consume_started_at && row.expires_at <= now()) {
      update(row.id, 'expired', '兑换意向已过期，请重新创建');
      return db.prepare('SELECT * FROM opcpay_intents WHERE id=?').get(id);
    }
    return row;
  }
  function update(id, status, message = '') {
    db.prepare('UPDATE opcpay_intents SET status=?,message=?,updated_at=? WHERE id=?').run(status, message, now(), id);
  }
  function publicIntent(row) {
    const { apiBindings, mediaSpec, ...snapshot } = JSON.parse(row.snapshot_json);
    const purchase = row.purchase_json ? JSON.parse(row.purchase_json) : {};
    const result = { id: row.id, status: row.status, message: row.message,
      canCancel: !terminal.has(row.status) && !row.consume_started_at, snapshot,
      createdAt: row.created_at, updatedAt: row.updated_at, expiresAt: row.expires_at,
      ...(purchase.purchaseUrl ? { purchaseUrl: purchase.purchaseUrl } : {}),
      ...(purchase.purchaseQrCode ? { purchaseQrCode: purchase.purchaseQrCode } : {}) };
    if (row.status === 'fulfilled') result.order = commerce.getEntitlementOrder({ redemptionId: row.id, buyerId: row.buyer_id });
    return result;
  }
  function localSnapshot(id = 'trial') {
    const expected = packageFor(id), snapshot = commerce.snapshotEntitlement(expected);
    if (snapshot.projectId !== expected.projectId || snapshot.productId !== expected.productId || snapshot.packageId !== expected.packageId
      || snapshot.priceCents !== expected.priceCents || !sameQuota(snapshot.quota, expected.quota)) fail(409, '本地额度卡套餐与约定不一致', 'CONFIG_MISMATCH');
    return snapshot;
  }
  function binding(row, { allowRotatedCredential = false } = {}) {
    const id = intentPackage(row), profile = profileFor(id); ready(id);
    const saved = JSON.parse(row.provider_json);
    if ((!allowRotatedCredential && saved.fingerprint !== fingerprint(id)) || saved.skuId !== profile.skuId || saved.merchantProjectName !== profile.merchantProjectName
      || (saved.baseURL ?? 'https://ai6666.com/opcpay/api/pay/v1') !== (profile.baseURL ?? 'https://ai6666.com/opcpay/api/pay/v1')) {
      fail(409, '原收款项目配置已变化，请恢复原配置后查询原权益记录', 'CONFIG_MISMATCH');
    }
    return saved;
  }
  async function verifyMerchant(row, { newPurchase = false, allowRotatedCredential = false } = {}) {
    const id = intentPackage(row), expected = packageFor(id);
    const saved = binding(row, { allowRotatedCredential }), pay = providerClient(id);
    const [caps, product] = await Promise.all([pay.capabilities(), pay.product()]);
    // COUNT access is project-wide, not SKU-specific. A dedicated one-SKU
    // merchant project is mandatory to avoid exchanging unrelated entitlements.
    if (caps?.provider_configured !== true || (newPurchase && caps.capabilities?.purchase_entry !== true) || caps.capabilities?.entitlement_query !== true
      || caps.capabilities?.consumption !== true || !(newPurchase ? ['ENABLED'] : ['ENABLED', 'DISABLED', 'TERMINATED']).includes(product?.capability_status)
      || product.product_name !== saved.merchantProjectName || product.billing_mode !== 'QUANTITY' || product.quota_unit !== 'COUNT'
      || !Array.isArray(product.charging_options) || product.charging_options.length !== 1 || !validOption(product.charging_options[0], saved.skuId, expected.priceCents)) {
      fail(409, `收款项目须为${expected.name}专用项目，唯一套餐 ${(expected.priceCents / 100).toFixed(2)} 元 / 1 次权益`, 'CONFIG_MISMATCH');
    }
    return pay;
  }
  function finish(row) {
    try {
      commerce.fulfillEntitlement({ redemptionId: row.id, buyerId: row.buyer_id, snapshot: JSON.parse(row.snapshot_json) });
      update(row.id, 'fulfilled', '权益已兑换，额度卡已发放');
    } catch {
      // Durable confirmation stays separate from issuance. A failed transaction
      // rolls back inventory and is safely replayed after restart.
      update(row.id, 'consumed', '权益已核销，卡密交付待恢复；不会再次扣减');
    }
    return publicIntent(rawIntent({ buyerId: row.buyer_id, id: row.id }));
  }
  function acceptReceipt(row, receipt, userId) {
    const saved = JSON.parse(row.provider_json);
    const matches = receipt?.idempotency_key === row.consume_key
      && (receipt.user_id === undefined || receipt.user_id === userId)
      && (receipt.sku_id === undefined || receipt.sku_id === saved.skuId);
    if (matches && receipt.status === 'SUCCEEDED' && receipt.confirmed === true && receipt.consumed === 1 && receipt.quota_unit === 'COUNT') {
      // Commit the minimal independently verifiable receipt before card issuance.
      const proof = { status: 'SUCCEEDED', confirmed: true, idempotency_key: row.consume_key, consumed: 1, quota_unit: 'COUNT',
        ...(typeof receipt.consume_order_id === 'string' ? { consume_order_id: receipt.consume_order_id.slice(0, 200) } : {}) };
      db.prepare("UPDATE opcpay_intents SET status='consumed',receipt_json=?,confirmed_at=?,updated_at=?,message=? WHERE id=?")
        .run(JSON.stringify(proof), now(), now(), '权益已核销，正在交付卡密', row.id);
      return finish(rawIntent({ buyerId: row.buyer_id, id: row.id }));
    }
    if (matches && receipt.status === 'FAILED' && (receipt.consumed === undefined || receipt.consumed === 0)) update(row.id, 'failed', '权益核销明确失败，未发卡');
    else update(row.id, 'unknown', '核销结果尚未确认，请查询原记录；不会重复扣减');
    return publicIntent(rawIntent({ buyerId: row.buyer_id, id: row.id }));
  }
  async function reconcileWork(args) {
    let row = rawIntent(args);
    if (terminal.has(row.status)) return publicIntent(row);
    if (row.status === 'consumed') return finish(row);
    const userId = requireBuyer(args.buyerId).provider_user_id;
    if (row.consume_started_at) {
      binding(row, { allowRotatedCredential: true });
      try {
        let receipt;
        try { receipt = await providerClient(intentPackage(row)).consumption(userId, row.consume_key); }
        catch (error) {
          if (error.status !== 404 || error.code !== 'NOT_FOUND') throw error;
          const pay = await verifyMerchant(row);
          // The durable mark may precede the network send when a process dies.
          // Only the authoritative absence of this exact key permits restoring
          // the original request, never allocating a new key or new parameters.
          receipt = await pay.consume({ userId, idempotencyKey: row.consume_key, amount: 1, reason: row.reason });
        }
        return acceptReceipt(row, receipt, userId);
      }
      catch { update(row.id, 'unknown', '原核销记录暂未确认，请稍后继续查询；不会重复扣减'); return publicIntent(rawIntent(args)); }
    }
    const pay = await verifyMerchant(row);
    let access;
    try { access = await pay.access(userId, 1); }
    catch { row = rawIntent(args); if (!terminal.has(row.status)) update(row.id, row.status, '暂时无法查询权益，请稍后重试'); return publicIntent(rawIntent(args)); }
    row = rawIntent(args); // Cancellation/expiry can happen while access awaits.
    if (terminal.has(row.status)) return publicIntent(row);
    if (!(access?.access_granted === true && access.requires_consumption === true && access.quota_unit === 'COUNT'
      && typeof access.remaining === 'number' && Number.isFinite(access.remaining) && access.remaining >= 1)) {
      update(row.id, 'awaiting_payment', '尚无可兑换权益，请完成购买后查询'); return publicIntent(rawIntent(args));
    }
    // Commit frozen arguments before making the only allowed debit request.
    db.prepare("UPDATE opcpay_intents SET status='consuming',consume_started_at=?,updated_at=?,message=? WHERE id=?")
      .run(now(), now(), '正在核销 1 次权益', row.id);
    row = rawIntent(args);
    try { return acceptReceipt(row, await pay.consume({ userId, idempotencyKey: row.consume_key, amount: 1, reason: row.reason }), userId); }
    catch { update(row.id, 'unknown', '核销请求结果未知，请查询原记录；不会重复扣减'); return publicIntent(rawIntent(args)); }
  }
  return {
    publicInfo(packageId = 'trial') {
      packageFor(packageId);
      const packages = Object.keys(FIXED_PACKAGES).map(id => {
        const profile = profileFor(id); let reason = configProblem(id);
        if (!reason) { try { localSnapshot(id); } catch { reason = '本地额度卡尚未按约定配置完成'; } }
        return { enabled: profile.enabled === true, ready: !reason, sandbox: config.sandbox === true, reason,
          package: structuredClone(packageFor(id)), merchantProjectName: profile.merchantProjectName ?? '' };
      });
      return { ...packages.find(item => item.package.packageId === packageId), packages };
    },
    createBuyer() {
      const buyerId = `buyer_${randomBytes(16).toString('hex')}`, sessionToken = randomBytes(32).toString('hex'), recoveryCode = randomBytes(24).toString('hex');
      db.prepare('INSERT INTO opcpay_buyers(id,provider_user_id,session_hash,recovery_hash,created_at,session_expires_at) VALUES (?,?,?,?,?,?)')
        .run(buyerId, `dss_${randomBytes(20).toString('hex')}`, credentialHash(sessionToken), credentialHash(recoveryCode), now(), sessionExpiry());
      return { buyerId, sessionToken, recoveryCode };
    },
    authenticate(sessionToken) {
      if (typeof sessionToken !== 'string' || !/^[a-f0-9]{64}$/u.test(sessionToken)) return null;
      return db.prepare('SELECT id FROM opcpay_buyers WHERE session_hash=? AND session_expires_at>?').get(credentialHash(sessionToken), now())?.id ?? null;
    },
    revokeSession(sessionToken) {
      if (typeof sessionToken !== 'string' || !/^[a-f0-9]{64}$/u.test(sessionToken)) return;
      db.prepare('UPDATE opcpay_buyers SET session_hash=?,session_expires_at=? WHERE session_hash=?')
        .run(credentialHash(randomBytes(32).toString('hex')), now(), credentialHash(sessionToken));
    },
    recoverBuyer(recoveryCode) {
      if (typeof recoveryCode !== 'string' || !/^[a-f0-9]{48}$/u.test(recoveryCode)) fail(403, '购买身份恢复码无效');
      const row = db.prepare('SELECT id FROM opcpay_buyers WHERE recovery_hash=?').get(credentialHash(recoveryCode));
      if (!row) fail(403, '购买身份恢复码无效');
      const sessionToken = randomBytes(32).toString('hex');
      db.prepare('UPDATE opcpay_buyers SET session_hash=?,recovered_at=?,session_expires_at=? WHERE id=?').run(credentialHash(sessionToken), now(), sessionExpiry(), row.id);
      return { buyerId: row.id, sessionToken };
    },
    createIntent({ buyerId, requestId, packageId = 'trial' } = {}) {
      requireBuyer(buyerId); requestId = identifier(requestId, '请求编号');
      packageFor(packageId);
      const replay = db.prepare('SELECT intent_id FROM opcpay_intent_requests WHERE buyer_id=? AND request_id=?').get(buyerId, requestId);
      if (replay) {
        const row = rawIntent({ buyerId, id: replay.intent_id });
        if (intentPackage(row) !== packageId) fail(409, '此请求编号已绑定其他套餐');
        return publicIntent(row);
      }
      // A pending operation is reusable only for its immutable package.
      for (const pending of db.prepare("SELECT id FROM opcpay_intents WHERE buyer_id=? AND status NOT IN ('fulfilled','failed','cancelled','expired') ORDER BY created_at").all(buyerId)) {
        const row = rawIntent({ buyerId, id: pending.id });
        if (!terminal.has(row.status) && intentPackage(row) === packageId) {
          db.prepare('INSERT INTO opcpay_intent_requests VALUES (?,?,?)').run(buyerId, requestId, row.id); return publicIntent(row);
        }
      }
      ready(packageId); const snapshot = localSnapshot(packageId), profile = profileFor(packageId);
      return transaction(() => {
        const id = `redemption_${randomBytes(16).toString('hex')}`, timestamp = now();
        db.prepare(`INSERT INTO opcpay_intents(id,buyer_id,status,snapshot_json,provider_json,purchase_key,consume_key,reason,created_at,updated_at,expires_at)
          VALUES (?,?,'created',?,?,?,?,?,?,?,?)`).run(id, buyerId, JSON.stringify(snapshot),
            JSON.stringify({ profileId: packageId, skuId: profile.skuId, merchantProjectName: profile.merchantProjectName, baseURL: profile.baseURL ?? 'https://ai6666.com/opcpay/api/pay/v1', fingerprint: fingerprint(packageId) }),
            `purchase_${randomBytes(16).toString('hex')}`, `consume_${randomBytes(16).toString('hex')}`, packageFor(packageId).name + '：1 次权益兑换 1 张卡',
            timestamp, timestamp, new Date(Date.now() + 30 * 60 * 1000).toISOString());
        db.prepare('INSERT INTO opcpay_intent_requests VALUES (?,?,?)').run(buyerId, requestId, id);
        return publicIntent(rawIntent({ buyerId, id }));
      });
    },
    getIntent(args = {}) { return publicIntent(rawIntent(args)); },
    listIntents(buyerId) {
      requireBuyer(buyerId);
      return db.prepare('SELECT id FROM opcpay_intents WHERE buyer_id=? ORDER BY created_at DESC,id DESC').all(buyerId)
        .map(row => publicIntent(rawIntent({ buyerId, id: row.id })));
    },
    purchase(args = {}) {
      requireBuyer(args.buyerId);
      return serial(args.buyerId, async () => {
        let row = rawIntent(args);
        if (terminal.has(row.status) || row.consume_started_at) return publicIntent(row);
        if (row.purchase_json) return publicIntent(row);
        const pay = await verifyMerchant(row, { newPurchase: !row.purchase_started_at, allowRotatedCredential: Boolean(row.purchase_started_at) });
        row = rawIntent(args); if (terminal.has(row.status)) return publicIntent(row);
        const userId = requireBuyer(args.buyerId).provider_user_id, saved = JSON.parse(row.provider_json);
        const started = Boolean(row.purchase_started_at);
        if (!started) db.prepare('UPDATE opcpay_intents SET purchase_started_at=? WHERE id=?').run(now(), row.id);
        try {
          let result;
          if (started) {
            try {
              const queried = await pay.purchaseQuery(userId, row.purchase_key);
              if (queried.user_id !== userId || queried.idempotency_key !== row.purchase_key || queried.sku_id !== saved.skuId) throw new Error('purchase query mismatch');
              result = queried.response;
            } catch (error) {
              if (error.status !== 404 || error.code !== 'NOT_FOUND') throw error;
              row = rawIntent(args); if (terminal.has(row.status)) return publicIntent(row);
              await verifyMerchant(row, { newPurchase: true });
              result = await pay.purchase({ userId, idempotencyKey: row.purchase_key, skuId: saved.skuId });
            }
          } else result = await pay.purchase({ userId, idempotencyKey: row.purchase_key, skuId: saved.skuId });
          row = rawIntent(args); if (terminal.has(row.status)) return publicIntent(row);
          if (result?.idempotency_key !== row.purchase_key || (result.charging_option && !validOption(result.charging_option, saved.skuId, packageFor(intentPackage(row)).priceCents))) throw new Error('purchase mismatch');
          const purchaseUrl = safeURL(result.purchase_url, localSandbox, true), purchaseQrCode = safeURL(result.purchase_qr_code, localSandbox);
          if (result.status === 'READY' && (purchaseUrl || purchaseQrCode)) {
            db.prepare('UPDATE opcpay_intents SET purchase_json=? WHERE id=?').run(JSON.stringify({ purchaseUrl, purchaseQrCode }), row.id);
            update(row.id, 'awaiting_payment', '请在收款页面完成购买，再查询并兑换权益');
          } else if (result.status === 'FAILED') update(row.id, 'failed', '购买入口创建失败，未核销权益');
          else update(row.id, 'purchase_unknown', '购买入口结果未知，请恢复原购买记录');
        } catch { row = rawIntent(args); if (!terminal.has(row.status)) update(row.id, 'purchase_unknown', '购买入口结果未知，请恢复原购买记录'); }
        return publicIntent(rawIntent(args));
      });
    },
    reconcile(args = {}) { requireBuyer(args.buyerId); return serial(args.buyerId, () => reconcileWork(args)); },
    cancel(args = {}) {
      const row = rawIntent(args);
      if (row.status === 'cancelled' || row.status === 'expired') return publicIntent(row);
      if (row.consume_started_at || terminal.has(row.status)) fail(409, '核销已开始或兑换已结束，请查询原记录');
      update(row.id, 'cancelled', '本次兑换意向已取消；已有权益仍保留在购买身份下'); return publicIntent(rawIntent(args));
    },
    async recoverPending() {
      const rows = db.prepare("SELECT id,buyer_id FROM opcpay_intents WHERE status='consumed' OR (consume_started_at IS NOT NULL AND status NOT IN ('fulfilled','failed','cancelled','expired'))").all();
      const result = [];
      for (const row of rows) {
        try { result.push(await serial(row.buyer_id, () => reconcileWork({ buyerId: row.buyer_id, id: row.id }))); }
        catch { result.push(publicIntent(rawIntent({ buyerId: row.buyer_id, id: row.id }))); }
      }
      return result;
    },
  };
}
