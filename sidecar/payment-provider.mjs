import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { epaySign } from './payments.mjs';

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const now = () => new Date().toISOString();
const equal = (a, b) => { const x = Buffer.from(String(a ?? '')), y = Buffer.from(String(b ?? '')); return x.length === y.length && timingSafeEqual(x, y); };
const string = (value, max = 200) => {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) fail(400, '支付配置或参数格式无效');
  return value.trim();
};
function httpsUrl(value, { originOnly = false, allowLocal = false } = {}) {
  let url; try { url = new URL(value); } catch { fail(400, '请输入完整 HTTPS 地址'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(allowLocal && local && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash || (!allowLocal && local)) fail(400, '支付网关及回调域名必须使用公开 HTTPS 地址');
  if (originOnly && url.pathname !== '/') fail(400, '回调域名只填写域名，不含路径');
  return originOnly ? url.origin : url.href.replace(/\/$/, '');
}

/** EasyPay V1 signed checkout + asynchronous notification. Browser returns never settle orders. */
export function createPaymentProvider(db, { commerce, secret, allowLocal = false }) {
  const encryptionKey = createHash('sha256').update(`payment-provider:${secret}`).digest();
  function seal(data, aad) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
    cipher.setAAD(Buffer.from(aad));
    const content = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
    return JSON.stringify({ iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: content.toString('base64') });
  }
  function unseal(value, aad) {
    const v = JSON.parse(value), cipher = createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(v.iv, 'base64'));
    cipher.setAAD(Buffer.from(aad)); cipher.setAuthTag(Buffer.from(v.tag, 'base64'));
    return JSON.parse(Buffer.concat([cipher.update(Buffer.from(v.data, 'base64')), cipher.final()]).toString());
  }
  db.exec(`CREATE TABLE IF NOT EXISTS payment_provider_settings (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS payment_attempts (
      order_id TEXT PRIMARY KEY REFERENCES shop_orders(id), order_no TEXT NOT NULL UNIQUE,
      return_token TEXT NOT NULL UNIQUE, snapshot TEXT NOT NULL, status TEXT NOT NULL,
      trade_no TEXT UNIQUE, message TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );`);
  const defaults = { mode: 'manual', gatewayUrl: '', merchantId: '', apiKey: '', publicBaseUrl: '', enabledMethods: ['wxpay', 'alipay'] };
  const settings = () => { const r = db.prepare('SELECT payload FROM payment_provider_settings WHERE id=1').get(); return r ? unseal(r.payload, 'settings') : defaults; };
  const safeSettings = () => { const { apiKey, ...rest } = settings(); return { ...rest, hasKey: !!apiKey, keyHint: apiKey ? '已加密保存' : '' }; };
  function saveSettings(data) {
    if (!data || typeof data !== 'object') fail(400, '支付配置格式无效');
    const old = settings(), next = { ...old };
    if (data.mode !== undefined) next.mode = string(data.mode, 20);
    if (!['manual', 'epay'].includes(next.mode)) fail(400, '支付模式无效');
    for (const key of ['gatewayUrl', 'publicBaseUrl', 'merchantId']) if (data[key] !== undefined) next[key] = string(data[key], 1000);
    if (data.apiKey !== undefined && data.apiKey !== '') next.apiKey = string(data.apiKey, 4096);
    if (data.enabledMethods !== undefined) next.enabledMethods = data.enabledMethods;
    if (!Array.isArray(next.enabledMethods) || !next.enabledMethods.length || next.enabledMethods.some(m => !['wxpay', 'alipay'].includes(m))) fail(400, '请选择微信或支付宝支付');
    next.enabledMethods = [...new Set(next.enabledMethods)];
    if (next.gatewayUrl) next.gatewayUrl = httpsUrl(next.gatewayUrl, { allowLocal });
    if (next.publicBaseUrl) next.publicBaseUrl = httpsUrl(next.publicBaseUrl, { originOnly: true, allowLocal });
    if (next.mode === 'epay' && (!next.gatewayUrl || !next.publicBaseUrl || !next.merchantId || !next.apiKey)) fail(400, '易支付需要网关地址、商户号、密钥及回调域名');
    db.prepare('INSERT INTO payment_provider_settings(id,payload) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(seal(next, 'settings'));
    return safeSettings();
  }
  function publicSettings(qrConfigured = false) {
    const s = settings(); return { mode: s.mode, configured: s.mode === 'manual' ? qrConfigured : !!(s.apiKey && s.publicBaseUrl && s.gatewayUrl), enabledMethods: s.mode === 'manual' ? ['wxpay'] : s.enabledMethods };
  }
  function begin({ id, token, method = 'wxpay' }) {
    const order = commerce.getOrder({ id, token });
    if (order.settlementKind === 'entitlement') fail(409, '权益兑换记录不能发起现金支付');
    if (!['pending', 'submitted'].includes(order.status)) fail(409, '此订单当前不能发起付款');
    const s = settings();
    if (s.mode === 'manual') return { mode: 'manual' };
    if (!s.enabledMethods.includes(method)) fail(400, '该支付方式未开启');
    let attempt = db.prepare('SELECT * FROM payment_attempts WHERE order_id=?').get(id);
    if (attempt && attempt.status !== 'pending') fail(409, '付款已收到，请刷新订单');
    // Snapshot credentials so a merchant-key rotation cannot invalidate in-flight payments.
    if (!attempt) {
      const snapshot = { ...s, checkoutToken: token, amount: order.priceCents, name: order.productName };
      db.prepare('INSERT INTO payment_attempts(order_id,order_no,return_token,snapshot,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
        .run(id, order.orderNo, randomBytes(32).toString('hex'), seal(snapshot, id), 'pending', now(), now());
      attempt = db.prepare('SELECT * FROM payment_attempts WHERE order_id=?').get(id);
    }
    const snapshot = unseal(attempt.snapshot, id);
    if (!snapshot.enabledMethods.includes(method)) fail(400, '此订单未启用该支付方式');
    const params = { pid: snapshot.merchantId, type: method, out_trade_no: order.orderNo,
      notify_url: `${snapshot.publicBaseUrl}/api/payment/notify`, return_url: `${snapshot.publicBaseUrl}/payment-return/${attempt.return_token}`,
      name: [...snapshot.name].slice(0, 40).join(''), money: (snapshot.amount / 100).toFixed(2) };
    params.sign = epaySign(params, snapshot.apiKey); params.sign_type = 'MD5';
    const endpoint = snapshot.gatewayUrl.endsWith('/submit.php') ? snapshot.gatewayUrl : `${snapshot.gatewayUrl}/submit.php`;
    return { mode: 'epay', redirectUrl: `${endpoint}?${new URLSearchParams(params)}` };
  }
  function notify(params) {
    if (!params || Object.entries(params).some(([k, v]) => k.length > 80 || typeof v !== 'string' || v.length > 2000)) fail(400, '支付通知格式无效');
    const attempt = db.prepare('SELECT * FROM payment_attempts WHERE order_no=?').get(params.out_trade_no ?? '');
    if (!attempt) fail(404, '支付订单不存在');
    const snapshot = unseal(attempt.snapshot, attempt.order_id);
    if (params.sign_type && params.sign_type !== 'MD5') fail(400, '支付签名类型无效');
    if (!/^[a-f0-9]{32}$/i.test(params.sign ?? '') || !equal(epaySign(params, snapshot.apiKey), params.sign.toLowerCase())) fail(403, '支付签名无效');
    if (params.pid !== snapshot.merchantId || params.trade_status !== 'TRADE_SUCCESS' || !snapshot.enabledMethods.includes(params.type)) fail(400, '支付商户、方式或状态不匹配');
    if (!/^\d{1,9}(\.\d{1,2})?$/.test(params.money ?? '')) fail(400, '支付金额格式无效');
    const [whole, decimal = ''] = params.money.split('.');
    if (BigInt(whole) * 100n + BigInt(decimal.padEnd(2, '0')) !== BigInt(snapshot.amount)) fail(400, '支付金额不匹配');
    const tradeNo = string(params.trade_no ?? '', 100);
    if (!tradeNo || (attempt.trade_no && attempt.trade_no !== tradeNo)) fail(409, '支付交易单号冲突');
    const duplicated = db.prepare('SELECT order_id FROM payment_attempts WHERE trade_no=? AND order_id<>?').get(tradeNo, attempt.order_id);
    if (duplicated) fail(409, '该支付交易已用于其他订单');
    if (attempt.status === 'paid') return { ok: true, orderId: attempt.order_id, status: 'paid' };
    // Save authenticated payment before fulfillment: failure remains visible and recoverable.
    db.prepare("UPDATE payment_attempts SET trade_no=?,status='needs_review',message=?,updated_at=? WHERE order_id=?")
      .run(tradeNo, '已核实支付，等待库存发货', now(), attempt.order_id);
    try {
      const order = commerce.approveOrder({ id: attempt.order_id, confirmed: true, verifiedReference: tradeNo, note: '易支付服务端通知验签与金额校验通过' });
      if (order.status !== 'fulfilled') fail(409, '支付成功但库存尚未交付');
      db.prepare("UPDATE payment_attempts SET status='paid',message=NULL,updated_at=? WHERE order_id=?").run(now(), attempt.order_id);
      return { ok: true, orderId: attempt.order_id, status: 'paid' };
    } catch (error) {
      db.prepare('UPDATE payment_attempts SET message=?,updated_at=? WHERE order_id=?').run(error.status ? error.message : '已到账，发卡异常，请管理员核查', now(), attempt.order_id);
      return { ok: true, orderId: attempt.order_id, status: 'needs_review' };
    }
  }
  function returnLocation(returnToken) {
    const r = db.prepare('SELECT * FROM payment_attempts WHERE return_token=?').get(returnToken);
    if (!r) fail(404, '支付返回凭证无效');
    return `/checkout/${r.order_id}?token=${encodeURIComponent(unseal(r.snapshot, r.order_id).checkoutToken)}`;
  }
  function listIssues() {
    return db.prepare("SELECT order_id AS orderId,order_no AS orderNo,trade_no AS tradeNo,status,message,created_at AS createdAt FROM payment_attempts WHERE status='needs_review' ORDER BY created_at DESC").all();
  }
  function recover({ orderId, note, confirmed }) {
    const row = db.prepare("SELECT * FROM payment_attempts WHERE order_id=? AND status='needs_review'").get(orderId);
    if (!row) fail(404, '待处理支付不存在');
    if (confirmed !== true || !string(note ?? '', 500)) fail(400, '请确认实际到账并填写处理备注');
    const order = commerce.approveOrder({ id: orderId, verifiedReference: row.trade_no, confirmed: true, recovery: true, note });
    if (order.status === 'fulfilled') db.prepare("UPDATE payment_attempts SET status='paid',message=NULL,updated_at=? WHERE order_id=?").run(now(), orderId);
    return order;
  }
  return { safeSettings, saveSettings, publicSettings, begin, notify, returnLocation, listIssues, recover };
}
