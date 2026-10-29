import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createPayments, epaySign } from '../sidecar/payments.mjs';

const config = { merchantId: '10001', merchantKey: 'test-merchant-key', storePort: 18080 };

function status(expected) {
  return (error) => error instanceof Error && error.status === expected;
}

function params(changes = {}) {
  const data = {
    pid: config.merchantId,
    type: 'wxpay',
    out_trade_no: 'ORDER-1',
    notify_url: 'http://127.0.0.1:18080/api/v1/payments/callback',
    return_url: 'http://127.0.0.1:18080/orders/ORDER-1',
    name: '测试次数包',
    money: '19.90',
    ...changes,
  };
  data.sign = epaySign(data, config.merchantKey);
  data.sign_type = 'MD5';
  return data;
}

function setup(t, fetcher = async () => { throw new Error('Unexpected network attempt'); }) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  return { db, payments: createPayments(db, config, { fetcher }) };
}

function proof(reference = 'user-reported-reference') {
  return { reference, payer: '测试付款人', paidAt: '2026-10-28T19:30:00+08:00' };
}

function approval(reference = 'verified-wechat-reference') {
  return { verifiedReference: reference, confirmed: true, note: '测试：已在真实账单核验的占位说明' };
}

function capturedCallback(url, init) {
  const data = Object.fromEntries(new URLSearchParams(init.body));
  assert.equal(url, 'http://127.0.0.1:18080/api/v1/payments/callback');
  assert.equal(init.method, 'POST');
  assert.equal(init.redirect, 'error');
  assert.equal(init.headers['content-type'], 'application/x-www-form-urlencoded');
  assert.equal(data.pid, config.merchantId);
  assert.equal(data.trade_status, 'TRADE_SUCCESS');
  assert.equal(data.sign_type, 'MD5');
  assert.equal(data.sign, epaySign(data, config.merchantKey));
  return data;
}

test('EasyPay V1 signs sorted non-empty fields with a known MD5 vector', (t) => {
  const data = params();
  assert.equal(data.sign, 'd2b6507aae68b2908eb481f603d0ee6d');
  assert.equal(epaySign({ ...data, empty: '', absent: null, omitted: undefined, sign: 'ignored', sign_type: 'ignored' }, config.merchantKey), data.sign);
  const { payments } = setup(t);
  const order = payments.create({ ...data, sign: data.sign.toUpperCase() });
  assert.equal(order.cents, 1990);
  assert.equal(order.state, 'awaiting_payment');
});

test('invalid signatures, merchant identity, amount and malicious callback destinations are rejected', (t) => {
  let requests = 0;
  const { payments } = setup(t, async () => { requests += 1; return new Response('success'); });
  assert.throws(() => payments.create({ ...params(), sign: '0'.repeat(32) }), status(403));
  assert.throws(() => payments.create(params({ pid: 'other-merchant' })), status(403));
  assert.throws(() => payments.create({ ...params(), sign_type: 'RSA' }), status(400));
  assert.throws(() => payments.create(params({ type: 'alipay' })), status(400));
  assert.throws(() => payments.create(params({ name: '' })), status(400));
  for (const money of ['0', '-1.00', '1e2', 'NaN', 'Infinity', '19.999', '1000000.00', '', ' 1.00 ']) {
    assert.throws(() => payments.create(params({ money })), status(400), `money=${money}`);
  }
  for (const notify_url of [
    'https://attacker.example/api/v1/payments/callback',
    'http://127.0.0.1:1/api/v1/payments/callback',
    'http://127.0.0.1:18080/admin',
    'http://127.0.0.1:18080@attacker.example/api/v1/payments/callback',
    'file:///etc/passwd',
    'not-a-url',
  ]) {
    assert.throws(() => payments.create(params({ notify_url })), status(400), notify_url);
  }
  assert.throws(() => payments.create(params({ return_url: 'https://attacker.example/return' })), status(400));
  assert.equal(payments.list().length, 0);
  assert.equal(requests, 0);
});

test('repeated order numbers are idempotent only while their commercial facts stay unchanged', (t) => {
  const { payments } = setup(t);
  const first = payments.create(params());
  const repeated = payments.create(params({ money: '19.9' }));
  assert.deepEqual(repeated, first);
  assert.equal(payments.list().length, 1);
  for (const changed of [{ money: '20.00' }, { name: '其他套餐' }, { return_url: 'http://127.0.0.1:18080/orders/different' }]) {
    assert.throws(() => payments.create(params(changed)), status(409));
  }
  assert.equal(payments.list().length, 1);
});

test('customer payment declarations only enter submitted and cannot trigger delivery', async (t) => {
  let requests = 0;
  const { payments } = setup(t, async () => { requests += 1; return new Response('success'); });
  const order = payments.create(params());
  assert.throws(() => payments.read(order.id, 'wrong-token'), status(403));
  assert.throws(() => payments.submit(order.id, 'wrong-token', proof()), status(403));
  assert.throws(() => payments.submit(order.id, order.token, {}), status(400));
  assert.throws(() => payments.submit(order.id, order.token, { ...proof(), paidAt: 'invalid' }), status(400));
  const submitted = payments.submit(order.id, order.token, proof());
  assert.equal(submitted.state, 'submitted');
  assert.equal(submitted.cents, 1990);
  assert.equal(submitted.verifiedAt, null);
  assert.equal(submitted.deliveredAt, null);
  assert.ok(submitted.submittedAt);
  assert.equal(payments.list()[0].callbackAttempts, 0);
  assert.equal(payments.list()[0].verifiedReference, null);
  await assert.rejects(payments.deliver(order.id), status(409));
  assert.equal(requests, 0);
});

test('admin approval requires explicit confirmation and a verified real transaction reference', async (t) => {
  let requests = 0;
  const { payments } = setup(t, async () => { requests += 1; return new Response('success'); });
  const order = payments.create(params());
  for (const confirmed of [undefined, false, 'true', 1]) {
    await assert.rejects(payments.approve(order.id, { verifiedReference: 'wechat-1', confirmed }), status(400));
  }
  await assert.rejects(payments.approve(order.id, { confirmed: true, verifiedReference: '' }), status(400));
  assert.equal(payments.read(order.id, order.token).state, 'awaiting_payment');
  assert.equal(requests, 0);
  const approved = await payments.approve(order.id, approval());
  assert.equal(approved.state, 'delivered');
  assert.ok(approved.verifiedAt);
  assert.equal(requests, 1);
});

test('verified transaction references cannot be reused across orders or silently replaced', async (t) => {
  let requests = 0;
  const { payments } = setup(t, async () => { requests += 1; return new Response('success'); });
  const first = payments.create(params());
  const second = payments.create(params({ out_trade_no: 'ORDER-2' }));
  await payments.approve(first.id, approval('actual-wechat-1'));
  await assert.rejects(payments.approve(second.id, approval('actual-wechat-1')), status(409));
  await assert.rejects(payments.approve(first.id, approval('actual-wechat-2')), status(409));
  assert.equal(payments.read(second.id, second.token).state, 'awaiting_payment');
  assert.equal(requests, 1);
  assert.equal((await payments.approve(second.id, approval('actual-wechat-2'))).state, 'delivered');
  assert.equal(requests, 2);
});

test('failed merchant callbacks preserve approved state and can be retried without a new trade number', async (t) => {
  const callbacks = [];
  const { payments } = setup(t, async (url, init) => {
    callbacks.push(capturedCallback(url, init));
    return callbacks.length === 1 ? new Response('temporary failure', { status: 503 }) : new Response('success');
  });
  const order = payments.create(params());
  const failed = await payments.approve(order.id, approval());
  assert.equal(failed.state, 'approved');
  assert.equal(failed.deliveredAt, null);
  assert.equal(payments.list()[0].callbackAttempts, 1);
  assert.match(payments.list()[0].callbackError, /503/u);
  const retried = await payments.deliver(order.id);
  assert.equal(retried.state, 'delivered');
  assert.ok(retried.deliveredAt);
  assert.equal(payments.list()[0].callbackError, null);
  assert.equal(payments.list()[0].callbackAttempts, 2);
  assert.equal(callbacks[0].money, '19.90');
  assert.equal(callbacks[0].out_trade_no, 'ORDER-1');
  assert.equal(callbacks[1].trade_no, callbacks[0].trade_no);
  assert.deepEqual(await payments.deliver(order.id), retried);
  assert.deepEqual(await payments.approve(order.id, approval()), retried);
  assert.equal(callbacks.length, 2);
});

test('lost callback responses retry the same payment identity and do not create another transaction', async (t) => {
  const callbacks = [];
  const merchantFulfilments = new Set();
  const { payments, db } = setup(t, async (url, init) => {
    const data = capturedCallback(url, init);
    callbacks.push(data);
    // This stub models an idempotent merchant, not the real store's fulfilment.
    merchantFulfilments.add(`${data.out_trade_no}:${data.trade_no}`);
    if (callbacks.length === 1) throw new Error('response lost after merchant processed payment');
    return new Response('success');
  });
  const order = payments.create(params());
  assert.equal((await payments.approve(order.id, approval())).state, 'approved');
  assert.match(payments.list()[0].callbackError, /response lost/u);
  assert.equal((await payments.approve(order.id, approval())).state, 'delivered');
  assert.equal(callbacks.length, 2);
  assert.equal(callbacks[0].trade_no, callbacks[1].trade_no);
  assert.equal(merchantFulfilments.size, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM manual_payments').get().count, 1);
});

test('simultaneous approval of one order allows only one in-flight callback', async (t) => {
  let finish;
  const callbacks = [];
  const response = new Promise((resolve) => { finish = resolve; });
  t.after(() => finish(new Response('success')));
  const { payments, db } = setup(t, async (url, init) => {
    callbacks.push(capturedCallback(url, init));
    return response;
  });
  const order = payments.create(params());
  const first = payments.approve(order.id, approval());
  assert.equal(callbacks.length, 1);
  await assert.rejects(payments.approve(order.id, approval()), status(409));
  await assert.rejects(payments.deliver(order.id), status(409));
  assert.equal(callbacks.length, 1);
  assert.equal(db.prepare('SELECT callback_attempts FROM manual_payments WHERE id=?').get(order.id).callback_attempts, 1);
  finish(new Response('success'));
  assert.equal((await first).state, 'delivered');
  assert.equal((await payments.approve(order.id, approval())).state, 'delivered');
  assert.equal(callbacks.length, 1);
});
