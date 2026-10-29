import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export function epaySign(params, key) {
  const base = Object.keys(params).filter(k => k !== 'sign' && k !== 'sign_type' && params[k] !== '' && params[k] != null)
    .sort().map(k => `${k}=${params[k]}`).join('&');
  return createHash('md5').update(base + key).digest('hex');
}
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const now = () => new Date().toISOString();
const safeEqual = (a, b) => {
  const x = Buffer.from(String(a ?? '')), y = Buffer.from(String(b ?? ''));
  return x.length === y.length && timingSafeEqual(x, y);
};
const text = (value, max = 200) => typeof value === 'string' ? value.trim().slice(0, max) : '';

export function createPayments(db, config, { fetcher = fetch } = {}) {
  const origin = `http://127.0.0.1:${config.storePort}`;
  const locks = new Set();
  db.exec(`CREATE TABLE IF NOT EXISTS manual_payments (
    id TEXT PRIMARY KEY, out_trade_no TEXT UNIQUE NOT NULL, trade_no TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL, cents INTEGER NOT NULL, notify_url TEXT NOT NULL, return_url TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'awaiting_payment', proof TEXT, verified_reference TEXT UNIQUE,
    verification_note TEXT, created_at TEXT NOT NULL, submitted_at TEXT, verified_at TEXT,
    delivered_at TEXT, callback_attempts INTEGER NOT NULL DEFAULT 0, callback_error TEXT
  );`);
  function get(id) {
    const row = db.prepare('SELECT * FROM manual_payments WHERE id=?').get(id);
    if (!row) fail(404, '订单不存在');
    return row;
  }
  const tokenFor = id => createHmac('sha256', config.merchantKey).update(`payment:${id}`).digest('hex');
  function checkToken(id, token) { if (!safeEqual(tokenFor(id), token)) fail(403, '订单访问凭证无效'); }
  function publicRow(row) {
    return { id: row.id, orderNo: row.out_trade_no, name: row.name, cents: row.cents, state: row.state,
      createdAt: row.created_at, submittedAt: row.submitted_at, verifiedAt: row.verified_at,
      deliveredAt: row.delivered_at, returnUrl: row.return_url };
  }
  function create(params) {
    if (String(params.pid) !== String(config.merchantId) || !safeEqual(epaySign(params, config.merchantKey), String(params.sign ?? '').toLowerCase())) fail(403, '支付签名无效');
    if (params.sign_type && params.sign_type !== 'MD5') fail(400, '仅支持 MD5 签名');
    if (params.type !== 'wxpay') fail(400, '当前只配置微信人工核验');
    const orderNo = text(params.out_trade_no, 120), name = text(params.name);
    if (!orderNo || !name || !/^\d{1,6}(\.\d{1,2})?$/.test(String(params.money))) fail(400, '订单字段或金额无效');
    const cents = Math.round(Number(params.money) * 100);
    if (cents < 1 || cents > 100000000) fail(400, '金额超出范围');
    let notify, ret;
    try { notify = new URL(params.notify_url); ret = new URL(params.return_url); } catch { fail(400, '回调地址无效'); }
    if (notify.origin !== origin || notify.pathname !== '/api/v1/payments/callback' || ret.origin !== origin) fail(400, '仅允许回调本机已配置商城');
    const old = db.prepare('SELECT * FROM manual_payments WHERE out_trade_no=?').get(orderNo);
    if (old) {
      if (old.cents !== cents || old.name !== name || old.notify_url !== notify.href || old.return_url !== ret.href) fail(409, '订单号已存在且内容不同');
      return { ...publicRow(old), token: tokenFor(old.id) };
    }
    const id = randomBytes(16).toString('hex');
    db.prepare('INSERT INTO manual_payments(id,out_trade_no,trade_no,name,cents,notify_url,return_url,created_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(id, orderNo, `MAN${randomBytes(12).toString('hex').toUpperCase()}`, name, cents, notify.href, ret.href, now());
    return { ...publicRow(get(id)), token: tokenFor(id) };
  }
  function read(id, token) { checkToken(id, token); return publicRow(get(id)); }
  function submit(id, token, proof) {
    checkToken(id, token);
    const row = get(id);
    if (row.state === 'approved' || row.state === 'delivered') return publicRow(row);
    const reference = text(proof?.reference, 100), payer = text(proof?.payer, 80), paidAt = text(proof?.paidAt, 60);
    if (!reference || !paidAt || !Number.isFinite(Date.parse(paidAt))) fail(400, '请填写交易单号和付款时间');
    db.prepare("UPDATE manual_payments SET state='submitted',proof=?,submitted_at=? WHERE id=?")
      .run(JSON.stringify({ reference, payer, paidAt }), now(), id);
    return publicRow(get(id));
  }
  async function deliver(id) {
    const row = get(id);
    if (row.state === 'delivered') return publicRow(row);
    if (row.state !== 'approved') fail(409, '需要先由管理员核实到账');
    if (locks.has(id)) fail(409, '发货确认正在处理中，请稍后刷新');
    locks.add(id);
    const params = { pid: String(config.merchantId), out_trade_no: row.out_trade_no, trade_no: row.trade_no,
      type: 'wxpay', name: row.name, money: (row.cents / 100).toFixed(2), trade_status: 'TRADE_SUCCESS' };
    params.sign = epaySign(params, config.merchantKey);
    params.sign_type = 'MD5';
    db.prepare('UPDATE manual_payments SET callback_attempts=callback_attempts+1,callback_error=NULL WHERE id=?').run(id);
    try {
      const response = await fetcher(row.notify_url, { method: 'POST', redirect: 'error',
        headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params), signal: AbortSignal.timeout(10000) });
      const body = await response.text();
      if (!response.ok || body.trim().toLowerCase() !== 'success') throw new Error(`商城未确认（HTTP ${response.status}）。请检查商城订单状态后重试通知。`);
      db.prepare("UPDATE manual_payments SET state='delivered',delivered_at=?,callback_error=NULL WHERE id=?").run(now(), id);
    } catch (error) {
      db.prepare('UPDATE manual_payments SET callback_error=? WHERE id=?').run(text(error.message, 400), id);
    } finally { locks.delete(id); }
    return publicRow(get(id));
  }
  async function approve(id, { verifiedReference, note, confirmed } = {}) {
    if (confirmed !== true) fail(400, '请先核对微信真实账单，再勾选确认');
    const reference = text(verifiedReference, 120);
    if (!reference) fail(400, '请输入账单中的真实微信交易单号');
    db.exec('BEGIN IMMEDIATE');
    try {
      const row = get(id);
      if (row.verified_reference && row.verified_reference !== reference) fail(409, '此订单已有不同的核验交易记录');
      const duplicate = db.prepare('SELECT id FROM manual_payments WHERE verified_reference=? AND id<>?').get(reference, id);
      if (duplicate) fail(409, '此微信交易单号已核验其他订单');
      if (row.state !== 'approved' && row.state !== 'delivered') {
        db.prepare("UPDATE manual_payments SET state='approved',verified_reference=?,verification_note=?,verified_at=? WHERE id=?")
          .run(reference, text(note, 400), now(), id);
      }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return deliver(id);
  }
  function list() { return db.prepare('SELECT * FROM manual_payments ORDER BY created_at DESC LIMIT 300').all().map(row => ({
    ...publicRow(row), proof: row.proof ? JSON.parse(row.proof) : null, verifiedReference: row.verified_reference,
    callbackError: row.callback_error, callbackAttempts: row.callback_attempts, verificationNote: row.verification_note
  })); }
  return { create, read, submit, approve, deliver, list, tokenFor };
}
