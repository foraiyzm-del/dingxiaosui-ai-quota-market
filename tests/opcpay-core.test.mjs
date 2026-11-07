import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createQuota } from '../sidecar/quota.mjs';
import { createCommerce } from '../sidecar/commerce.mjs';
import { createOpcpay } from '../sidecar/opcpay.mjs';

const secret = 'isolated-opcpay-tests-secret-no-live-credentials';
const allocation = { text: 10, image: 15, video: 2 };
const product = { id: 'dingxiaosui-opcpay-trial', projectId: 'dingxiaosui', name: '丁小穗尝鲜卡', units: 27, priceCents: 990,
  fulfillment: 'on_payment', packageOptions: [{ id: 'trial', label: '尝鲜卡', quota: allocation, priceCents: 990 }] };
const config = { enabled: true, apiKey: 'isolated-test-key', skuId: 'merchant-trial', projectId: 'dingxiaosui', productId: product.id,
  packageId: 'trial', merchantProjectName: '丁小穗权益', sandbox: false, termsConfirmed: true,
  verifiedPackage: { priceCents: 990, quotaUnit: 'COUNT', amount: 1 } };
const option = { sku_id: config.skuId, plan_id: 'plan-trial', display_name: '尝鲜权益', billing_mode: 'QUANTITY',
  price: '9.90', currency: 'CNY', price_version: 1, entitlement_rule: 'QUOTA', quota_unit: 'COUNT', quota_amount: 1 };
function provider(overrides = {}) {
  const calls = { consume: [], purchase: [], lookup: [] };
  const receipts = new Map();
  return { calls, receipts,
    async capabilities() { return { provider_configured: true, capabilities: { purchase_entry: true, entitlement_query: true, consumption: true } }; },
    async product() { return { product_name: config.merchantProjectName, capability_status: 'ENABLED', billing_mode: 'QUANTITY', quota_unit: 'COUNT', charging_options: [option] }; },
    async purchase(input) { calls.purchase.push(input); return { status: 'READY', idempotency_key: input.idempotencyKey, purchase_url: 'https://cashier.example.test/pay', charging_option: option }; },
    async purchaseQuery(userId, key) { return { user_id: userId, idempotency_key: key, sku_id: config.skuId, response: { status: 'READY', idempotency_key: key, purchase_url: 'https://cashier.example.test/pay', charging_option: option } }; },
    async access() { return { access_granted: true, requires_consumption: true, decision: 'ALLOW', quota_unit: 'COUNT', remaining: 1 }; },
    async consume(input) { calls.consume.push(input); const result = { status: 'SUCCEEDED', confirmed: true, idempotency_key: input.idempotencyKey, quota_unit: 'COUNT', consumed: 1 }; receipts.set(input.idempotencyKey, result); return result; },
    async consumption(userId, key) { calls.lookup.push({ userId, key }); return receipts.get(key) ?? { status: 'UNKNOWN', confirmed: false, idempotency_key: key }; }, ...overrides };
}
function setup(t, overrides = {}) {
  const db = overrides.db ?? new DatabaseSync(':memory:');
  if (!overrides.db) t.after(() => db.close());
  const quota = createQuota(db); quota.createProject({ id: 'dingxiaosui', name: '丁小穗' });
  const commerce = createCommerce(db, { quota, secret }); commerce.saveProduct(product);
  const client = overrides.client ?? provider();
  const pay = createOpcpay(db, { commerce, secret, config: { ...config, ...overrides.config }, client });
  const buyer = pay.createBuyer();
  return { db, quota, commerce, client, pay, buyer, intent: (requestId = 'click-1') => pay.createIntent({ buyerId: buyer.buyerId, requestId }) };
}
const input = (buyer, intent) => ({ buyerId: buyer.buyerId, id: intent.id });

const extraPackages = {
  week: { name: '丁小穗周卡', priceCents: 2990, quota: { text: 30, image: 45, video: 6 } },
  month: { name: '丁小穗月卡', priceCents: 9900, quota: { text: 100, image: 150, video: 20 } },
};
function multiSetup(t, overrides = {}) {
  const base = setup(t, overrides);
  const packages = Object.fromEntries(Object.entries(extraPackages).map(([id, item]) => {
    const definition = { ...item, id: 'dingxiaosui-opcpay-' + id, projectId: 'dingxiaosui',
      units: Object.values(item.quota).reduce((sum, count) => sum + count, 0), fulfillment: 'on_payment',
      packageOptions: [{ id, label: item.name, quota: item.quota, priceCents: item.priceCents }] };
    base.commerce.saveProduct(definition);
    return [id, { ...config, apiKey: 'isolated-' + id + '-key', skuId: 'merchant-' + id,
      productId: definition.id, packageId: id, merchantProjectName: item.name + '专用',
      verifiedPackage: { priceCents: item.priceCents, quotaUnit: 'COUNT', amount: 1 } }];
  }));
  const multiConfig = { ...config, packages, ...overrides.multiConfig };
  const clients = Object.fromEntries(Object.entries(extraPackages).map(([id, item]) => {
    const sku = { ...option, sku_id: packages[id].skuId, price: (item.priceCents / 100).toFixed(2) };
    return [id, provider({
      async product() { return { product_name: packages[id].merchantProjectName, capability_status: 'ENABLED', billing_mode: 'QUANTITY', quota_unit: 'COUNT', charging_options: [sku] }; },
      async purchase(value) { this.calls.purchase.push(value); return { status: 'READY', idempotency_key: value.idempotencyKey, purchase_url: 'https://cashier.example.test/' + id, charging_option: sku }; },
      async purchaseQuery(userId, key) { return { user_id: userId, idempotency_key: key, sku_id: packages[id].skuId,
        response: { status: 'READY', idempotency_key: key, purchase_url: 'https://cashier.example.test/' + id, charging_option: sku } }; },
    })];
  }));
  const pay = createOpcpay(base.db, { commerce: base.commerce, secret, config: multiConfig, client: base.client, clients });
  return { ...base, pay, clients, multiConfig,
    intent: (packageId, requestId = 'click-' + packageId) => pay.createIntent({ buyerId: base.buyer.buyerId, requestId, packageId }) };
}

test('weekly and monthly fixed packages issue and activate their own exact card once under concurrent retries', async t => {
  const { pay, buyer, intent, clients, client, quota, commerce } = multiSetup(t);
  assert.equal(pay.publicInfo().packages.length, 3);
  for (const [id, expected] of Object.entries(extraPackages)) {
    const record = intent(id), args = input(buyer, record);
    assert.equal(record.snapshot.packageId, id);
    assert.equal(record.snapshot.priceCents, expected.priceCents);
    assert.deepEqual(record.snapshot.quota, expected.quota);
    assert.equal(pay.publicInfo(id).ready, true);
    assert.equal(pay.publicInfo(id).package.packageId, id);
    assert.equal((await pay.purchase(args)).purchaseUrl, 'https://cashier.example.test/' + id);
    const results = await Promise.all(Array.from({ length: 6 }, () => pay.reconcile(args)));
    assert.ok(results.every(row => row.status === 'fulfilled'));
    assert.equal(new Set(results.map(row => row.order.code)).size, 1);
    assert.equal(clients[id].calls.consume.length, 1);
    assert.equal(clients[id].calls.consume[0].amount, 1);
    const first = quota.redeem({ projectId: 'dingxiaosui', userId: id + '-user', code: results[0].order.code });
    assert.throws(() => quota.redeem({ projectId: 'dingxiaosui', userId: id + '-user', code: results[0].order.code }), { status: 409 });
    assert.deepEqual(first.quota, expected.quota);
    assert.deepEqual(quota.balance({ projectId: 'dingxiaosui', userId: id + '-user' }), first.balance);
  }
  assert.equal(client.calls.consume.length, 0);
  assert.equal(commerce.listOrders().length, 2);
  assert.equal(commerce.stats().revenueCents, 0);
  assert.doesNotMatch(JSON.stringify(pay.publicInfo()), /isolated-.*-key|apiKey|fingerprint/);
});

test('package selection cannot reuse another package request or unresolved intent', t => {
  const { pay, buyer, intent } = multiSetup(t);
  const trial = intent('trial', 'shared-click');
  assert.throws(() => intent('week', 'shared-click'), { status: 409 });
  const week = intent('week'), month = intent('month');
  assert.notEqual(week.id, trial.id); assert.notEqual(month.id, week.id);
  assert.equal(intent('week', 'another-week-click').id, week.id);
  assert.equal(pay.listIntents(buyer.buyerId).length, 3);
  for (const id of ['season', 'custom', '__proto__', '', null]) assert.throws(() => intent(id, 'invalid-' + id), { status: 400 });
  assert.throws(() => pay.publicInfo('season'), { status: 400 });
});

test('a trial entitlement cannot fund a weekly or monthly card and merchant profiles must be separate', async t => {
  const { db, pay, buyer, intent, clients, client, commerce, multiConfig } = multiSetup(t);
  for (const id of ['week', 'month']) {
    clients[id].access = async () => ({ access_granted: false, requires_consumption: true, quota_unit: 'COUNT', remaining: 0 });
    assert.equal((await pay.reconcile(input(buyer, intent(id)))).status, 'awaiting_payment');
    assert.equal(clients[id].calls.consume.length, 0);
  }
  assert.equal((await pay.reconcile(input(buyer, intent('trial')))).status, 'fulfilled');
  assert.equal(client.calls.consume.length, 1); assert.equal(commerce.listOrders().length, 1);
  for (const key of ['apiKey', 'merchantProjectName']) {
    const invalid = structuredClone(multiConfig); invalid.packages.week[key] = config[key];
    const blocked = createOpcpay(db, { commerce, secret, config: invalid, client, clients });
    assert.equal(blocked.publicInfo('week').ready, false);
    assert.equal(blocked.publicInfo('trial').ready, true);
    assert.throws(() => blocked.createIntent({ buyerId: blocked.createBuyer().buyerId, packageId: 'week', requestId: 'bad-profile' }), { status: 503 });
  }
});

test('lost monthly response recovers its persisted profile and key after reopening without a second debit', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'opcpay-multi-restart-'));
  let db = new DatabaseSync(join(directory, 'ledger.sqlite'));
  t.after(() => { if (db.isOpen) db.close(); rmSync(directory, { recursive: true, force: true }); });
  const { pay, buyer, intent, clients, client, multiConfig } = multiSetup(t, { db });
  const consume = clients.month.consume;
  clients.month.consume = async value => { await consume(value); throw new Error('lost response'); };
  const args = input(buyer, intent('month'));
  assert.equal((await pay.reconcile(args)).status, 'unknown');
  db.close(); db = new DatabaseSync(join(directory, 'ledger.sqlite'));
  const quota = createQuota(db), commerce = createCommerce(db, { quota, secret });
  const reopened = createOpcpay(db, { commerce, secret, config: multiConfig, client, clients });
  await reopened.recoverPending();
  const delivered = reopened.getIntent(args);
  assert.equal(delivered.status, 'fulfilled'); assert.deepEqual(delivered.order.quota, extraPackages.month.quota);
  assert.equal(clients.month.calls.consume.length, 1);
  assert.equal(clients.month.calls.lookup[0].key, clients.month.calls.consume[0].idempotencyKey);
  assert.equal(client.calls.consume.length, 0); assert.equal(clients.week.calls.consume.length, 0);
  assert.equal(reopened.recoverBuyer(buyer.recoveryCode).buyerId, buyer.buyerId);
});

test('weekly confirmed debit recovers the same card after delivery interruption and profile removal', async t => {
  const { pay, buyer, intent, clients, commerce, db, client, quota } = multiSetup(t);
  const args = input(buyer, intent('week')), fulfill = commerce.fulfillEntitlement;
  commerce.fulfillEntitlement = () => { throw new Error('delivery interrupted'); };
  assert.equal((await pay.reconcile(args)).status, 'consumed');
  commerce.fulfillEntitlement = fulfill;
  const reopened = createOpcpay(db, { commerce, secret, config, client });
  await reopened.recoverPending();
  const first = reopened.getIntent(args), again = await reopened.reconcile(args);
  assert.equal(first.status, 'fulfilled'); assert.equal(first.order.code, again.order.code);
  assert.deepEqual(first.order.quota, extraPackages.week.quota);
  assert.equal(clients.week.calls.consume.length, 1); assert.equal(quota.listCodes().length, 1);
});

test('legacy trial intents without profile IDs still query and deliver through their original merchant', async t => {
  const { db, pay, buyer, intent, clients, client } = multiSetup(t);
  const args = input(buyer, intent('trial'));
  const saved = JSON.parse(db.prepare('SELECT provider_json FROM opcpay_intents WHERE id=?').get(args.id).provider_json);
  delete saved.profileId;
  db.prepare('UPDATE opcpay_intents SET provider_json=? WHERE id=?').run(JSON.stringify(saved), args.id);
  const result = await pay.reconcile(args);
  assert.equal(result.status, 'fulfilled'); assert.deepEqual(result.order.quota, allocation);
  assert.equal(client.calls.consume.length, 1); assert.equal(clients.week.calls.consume.length, 0); assert.equal(clients.month.calls.consume.length, 0);
});

test('weekly purchase response recovery uses the original package client and request after reopening', async t => {
  const { db, pay, buyer, intent, clients, client, commerce, multiConfig, quota } = multiSetup(t);
  const args = input(buyer, intent('week'));
  const purchase = clients.week.purchase.bind(clients.week);
  clients.week.purchase = async value => { await purchase(value); throw new Error('purchase response lost'); };
  assert.equal((await pay.purchase(args)).status, 'purchase_unknown');
  const reopened = createOpcpay(db, { commerce, secret, config: multiConfig, client, clients });
  const result = await reopened.purchase(args);
  assert.equal(result.status, 'awaiting_payment'); assert.equal(result.purchaseUrl, 'https://cashier.example.test/week');
  assert.equal(clients.week.calls.purchase.length, 1); assert.equal(client.calls.purchase.length, 0);
  assert.equal(quota.listCodes().length, 0);
});

test('each new merchant must expose its single exact-priced COUNT one package before purchase or consumption', async t => {
  for (const id of ['week', 'month']) for (const change of ['price', 'quota', 'second-sku']) {
    const { pay, buyer, intent, clients, quota } = multiSetup(t);
    const original = await clients[id].product();
    if (change === 'price') original.charging_options[0].price = '9.90';
    if (change === 'quota') original.charging_options[0].quota_amount = id === 'week' ? 3 : 10;
    if (change === 'second-sku') original.charging_options.push({ ...original.charging_options[0], sku_id: 'other-sku' });
    clients[id].product = async () => original;
    const args = input(buyer, intent(id));
    await assert.rejects(() => pay.purchase(args), { status: 409 });
    await assert.rejects(() => pay.reconcile(args), { status: 409 });
    assert.equal(clients[id].calls.consume.length, 0); assert.equal(clients[id].calls.purchase.length, 0);
    assert.equal(quota.listCodes().length, 0);
  }
});

test('cancelling a weekly intent while access is pending does not spend either package balance', async t => {
  const { pay, buyer, intent, clients, client, quota } = multiSetup(t);
  let enter, release;
  const entered = new Promise(resolve => { enter = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  clients.week.access = async () => { enter(); await gate; return { access_granted: true, requires_consumption: true, quota_unit: 'COUNT', remaining: 1 }; };
  const args = input(buyer, intent('week')), work = pay.reconcile(args);
  await entered; assert.equal(pay.cancel(args).status, 'cancelled'); release();
  assert.equal((await work).status, 'cancelled');
  assert.equal(clients.week.calls.consume.length, 0); assert.equal(client.calls.consume.length, 0);
  assert.equal(quota.listCodes().length, 0);
});

test('persistent buyer credentials recover the same owner without storing plaintext secrets', t => {
  const { db, pay, buyer, commerce } = setup(t);
  assert.equal(pay.authenticate(buyer.sessionToken), buyer.buyerId);
  assert.equal(pay.authenticate(buyer.buyerId), null);
  assert.equal(pay.authenticate('forged'), null);
  const stored = JSON.stringify(db.prepare('SELECT * FROM opcpay_buyers').all());
  assert.ok(!stored.includes(buyer.sessionToken)); assert.ok(!stored.includes(buyer.recoveryCode));
  const reopened = createOpcpay(db, { commerce, secret, config, client: provider() });
  const recovered = reopened.recoverBuyer(buyer.recoveryCode);
  assert.equal(recovered.buyerId, buyer.buyerId);
  assert.equal(reopened.authenticate(recovered.sessionToken), buyer.buyerId);
  assert.throws(() => reopened.recoverBuyer('forged'), { status: 403 });
});

test('logout and server-side session expiration invalidate copied cookies while recovery preserves ownership', t => {
  const { pay, buyer, db, intent } = setup(t); const original = intent();
  pay.revokeSession(buyer.sessionToken);
  assert.equal(pay.authenticate(buyer.sessionToken), null);
  const recovered = pay.recoverBuyer(buyer.recoveryCode);
  assert.equal(pay.authenticate(recovered.sessionToken), buyer.buyerId);
  assert.equal(pay.getIntent(input(recovered, original)).id, original.id);
  db.prepare('UPDATE opcpay_buyers SET session_expires_at=? WHERE id=?').run('2000-01-01T00:00:00.000Z', buyer.buyerId);
  assert.equal(pay.authenticate(recovered.sessionToken), null);
  assert.equal(pay.recoverBuyer(buyer.recoveryCode).buyerId, buyer.buyerId);
});

test('server snapshots and owner checks defeat client amount/user spoofing and duplicate tabs', t => {
  const { pay, buyer, intent } = setup(t);
  const first = intent();
  assert.equal(intent('other-tab').id, first.id);
  const tampered = pay.createIntent({ buyerId: buyer.buyerId, requestId: 'spoof', userId: 'other-user', quota: { text: 999 }, priceCents: 1 });
  assert.deepEqual(tampered.snapshot.quota, allocation); assert.equal(tampered.snapshot.priceCents, 990);
  assert.throws(() => pay.getIntent({ buyerId: pay.createBuyer().buyerId, id: first.id }), { status: 404 });
  assert.throws(() => pay.createIntent({ buyerId: 'forged', requestId: 'x' }), { status: 403 });
});

test('concurrent reconcile calls consume once, fulfill once, and activate exactly text10 image15 video2', async t => {
  const { pay, buyer, intent, commerce, quota, client } = setup(t);
  const args = input(buyer, intent());
  const results = await Promise.all(Array.from({ length: 8 }, () => pay.reconcile(args)));
  assert.ok(results.every(row => row.status === 'fulfilled'));
  assert.equal(new Set(results.map(row => row.order.code)).size, 1);
  assert.equal(client.calls.consume.length, 1); assert.equal(commerce.listOrders().length, 1);
  const order = results[0].order;
  assert.equal(order.settlementKind, 'entitlement'); assert.equal(order.paidAt, null); assert.equal(order.approvedAt, null);
  assert.equal(commerce.stats().revenueCents, 0); assert.match(order.verifiedReference, /^ENTITLEMENT:/u);
  assert.throws(() => commerce.approveOrder({ id: order.id, confirmed: true, verifiedReference: 'fake-payment' }), { status: 409 });
  const result = quota.redeem({ projectId: 'dingxiaosui', userId: 'buyer', code: order.code });
  assert.deepEqual(result.quota, allocation); assert.equal(result.balance.available, 27);
  assert.throws(() => quota.redeem({ projectId: 'dingxiaosui', userId: 'another', code: order.code }), { status: 409 });
  assert.equal(commerce.listInventory().length, 1);
});

test('no entitlement never calls consume or issues a card', async t => {
  const client = provider({ async access() { return { access_granted: false, decision: 'PURCHASE_REQUIRED', quota_unit: 'COUNT', remaining: 0 }; } });
  const { pay, buyer, intent, quota } = setup(t, { client });
  const result = await pay.reconcile(input(buyer, intent()));
  assert.equal(result.status, 'awaiting_payment'); assert.equal(client.calls.consume.length, 0); assert.equal(quota.listCodes().length, 0);
});

for (const receipt of [
  { status: 'FAILED', confirmed: false }, { status: 'UNKNOWN', confirmed: false }, { status: 'PROCESSING', confirmed: false },
  { status: 'SUCCEEDED', confirmed: false }, { status: 'SUCCEEDED', confirmed: true, consumed: 2 },
  { status: 'SUCCEEDED', confirmed: true, quota_unit: 'POINT' }, { status: 'SUCCEEDED', confirmed: true, idempotency_key: 'other' },
  { status: 'SUCCEEDED', confirmed: true, user_id: 'other' }, { status: 'SUCCEEDED', confirmed: true, sku_id: 'other' },
]) test(`unconfirmed/mismatched receipt cannot issue: ${JSON.stringify(receipt)}`, async t => {
  const client = provider({ async consume(value) { return { idempotency_key: value.idempotencyKey, consumed: 1, quota_unit: 'COUNT', ...receipt }; } });
  const { pay, buyer, intent, quota } = setup(t, { client });
  const result = await pay.reconcile(input(buyer, intent()));
  assert.notEqual(result.status, 'fulfilled'); assert.equal(quota.listCodes().length, 0);
});

test('consume timeout is reconciled by the original key and never sends a second debit', async t => {
  const client = provider(); const original = client.consume;
  client.consume = async value => { await original(value); throw new Error('response lost'); };
  const { pay, buyer, intent, quota } = setup(t, { client }); const args = input(buyer, intent());
  assert.equal((await pay.reconcile(args)).status, 'unknown'); assert.equal(quota.listCodes().length, 0);
  assert.throws(() => pay.cancel(args), { status: 409 });
  assert.equal((await pay.reconcile(args)).status, 'fulfilled');
  assert.equal(client.calls.consume.length, 1); assert.equal(client.calls.lookup[0].key, client.calls.consume[0].idempotencyKey);
});

test('confirmed debit survives close/reopen and product edits; only delivery is retried', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'opcpay-restart-'));
  let db = new DatabaseSync(join(directory, 'ledger.sqlite'));
  t.after(() => { if (db.isOpen) db.close(); rmSync(directory, { recursive: true, force: true }); });
  const { pay, buyer, intent, commerce, client } = setup(t, { db }); const args = input(buyer, intent());
  const realFulfill = commerce.fulfillEntitlement; commerce.fulfillEntitlement = () => { throw new Error('power lost after durable confirmation'); };
  assert.equal((await pay.reconcile(args)).status, 'consumed');
  commerce.fulfillEntitlement = realFulfill;
  commerce.saveProduct({ ...product, priceCents: 1990, packageOptions: [{ id: 'trial', label: 'changed', quota: { text: 1, image: 1, video: 1 }, priceCents: 1990 }] });
  db.close(); db = new DatabaseSync(join(directory, 'ledger.sqlite'));
  const quota = createQuota(db); const reopenedCommerce = createCommerce(db, { quota, secret });
  const reopened = createOpcpay(db, { commerce: reopenedCommerce, secret, config, client });
  await reopened.recoverPending();
  const final = reopened.getIntent(args);
  assert.equal(final.status, 'fulfilled'); assert.deepEqual(final.order.quota, allocation); assert.equal(final.order.priceCents, 990);
  assert.equal(client.calls.consume.length, 1); assert.equal(quota.listCodes().length, 1);
  assert.equal(reopened.recoverBuyer(buyer.recoveryCode).buyerId, buyer.buyerId);
});

test('cancel during access cannot race into a debit; expired idle intents do not spend', async t => {
  let release; const entered = new Promise(resolve => { release = resolve; });
  let continueAccess; const gate = new Promise(resolve => { continueAccess = resolve; });
  const client = provider({ async access() { release(); await gate; return { access_granted: true, requires_consumption: true, quota_unit: 'COUNT', remaining: 1 }; } });
  const { pay, buyer, intent, db, quota } = setup(t, { client }); const args = input(buyer, intent());
  const work = pay.reconcile(args); await entered; assert.equal(pay.cancel(args).status, 'cancelled'); continueAccess();
  assert.equal((await work).status, 'cancelled'); assert.equal(client.calls.consume.length, 0);
  const second = intent('next'); db.prepare('UPDATE opcpay_intents SET expires_at=? WHERE id=?').run('2000-01-01T00:00:00.000Z', second.id);
  assert.equal((await pay.reconcile(input(buyer, second))).status, 'expired'); assert.equal(quota.listCodes().length, 0);
});

test('missing configuration and mismatched merchant price/capabilities block upstream spending', async t => {
  let called = false; const client = provider({ async capabilities() { called = true; throw new Error('must not run'); } });
  const disabled = setup(t, { client, config: { apiKey: '' } });
  assert.equal(disabled.pay.publicInfo().ready, false); assert.ok(disabled.pay.publicInfo().reason);
  assert.throws(() => disabled.intent(), { status: 503 }); assert.equal(called, false);
  for (const wrong of [{ ...option, price: '0.01' }, { ...option, quota_amount: 2 }, { ...option, billing_mode: 'ONE_TIME' }]) {
    const c = provider({ async product() { return { product_name: config.merchantProjectName, capability_status: 'ENABLED', billing_mode: 'QUANTITY', quota_unit: 'COUNT', charging_options: [wrong] }; } });
    const setupWrong = setup(t, { client: c });
    await assert.rejects(() => setupWrong.pay.reconcile(input(setupWrong.buyer, setupWrong.intent())), { status: 409 });
    assert.equal(setupWrong.quota.listCodes().length, 0); assert.equal(c.calls.consume.length, 0);
  }
});

test('purchase is a reusable entry, never payment proof or fulfillment', async t => {
  const { pay, buyer, intent, client, quota } = setup(t); const args = input(buyer, intent());
  const first = await pay.purchase(args); const next = await pay.purchase(args);
  assert.equal(first.purchaseUrl, 'https://cashier.example.test/pay'); assert.equal(first.status, 'awaiting_payment');
  assert.equal(next.id, first.id); assert.equal(client.calls.purchase.length, 1); assert.equal(quota.listCodes().length, 0);
  assert.equal(first.order, undefined); assert.ok(!JSON.stringify(first).includes('isolated-test-key'));
});

test('only an explicit local sandbox client can return loopback HTTP checkout URLs', async t => {
  for (const sandbox of [false, true]) {
    const client = provider({ async purchase(value) { return { status: 'READY', idempotency_key: value.idempotencyKey, purchase_url: 'http://127.0.0.1:4455/checkout/opaque', charging_option: option }; } });
    const { pay, buyer, intent } = setup(t, { client, config: { sandbox } });
    const result = await pay.purchase(input(buyer, intent()));
    assert.equal(result.purchaseUrl, sandbox ? 'http://127.0.0.1:4455/checkout/opaque' : undefined);
    assert.equal(result.status, sandbox ? 'awaiting_payment' : 'purchase_unknown');
  }
});

test('a second upstream SKU cannot fund the dedicated fixed-card exchange', async t => {
  const client = provider({ async product() { return { product_name: config.merchantProjectName, capability_status: 'ENABLED', billing_mode: 'QUANTITY', quota_unit: 'COUNT', charging_options: [option, { ...option, sku_id: 'other' }] }; } });
  const { pay, buyer, intent, quota } = setup(t, { client });
  await assert.rejects(() => pay.reconcile(input(buyer, intent())), { status: 409 });
  assert.equal(client.calls.consume.length, 0); assert.equal(quota.listCodes().length, 0);
});

test('crash before send retries only explicit NOT_FOUND with the original persisted debit arguments', async t => {
  const client = provider({ async consumption() { throw Object.assign(new Error('not found'), { status: 404, code: 'NOT_FOUND' }); } });
  const { pay, buyer, intent, db } = setup(t, { client }); const args = input(buyer, intent());
  db.prepare("UPDATE opcpay_intents SET status='consuming',consume_started_at=? WHERE id=?").run(new Date().toISOString(), args.id);
  const stored = db.prepare('SELECT consume_key,reason FROM opcpay_intents WHERE id=?').get(args.id);
  assert.equal((await pay.reconcile(args)).status, 'fulfilled');
  assert.equal(client.calls.consume.length, 1);
  assert.equal(client.calls.consume[0].idempotencyKey, stored.consume_key);
  assert.equal(client.calls.consume[0].amount, 1); assert.equal(client.calls.consume[0].reason, stored.reason);
});

test('purchase NOT_FOUND recovery restores the same original intent; other lookup errors never resend', async t => {
  for (const code of ['NOT_FOUND', 'UPSTREAM_UNKNOWN']) {
    const client = provider({ async purchaseQuery() { throw Object.assign(new Error('lookup'), { status: code === 'NOT_FOUND' ? 404 : 502, code }); } });
    const { pay, buyer, intent, db } = setup(t, { client }); const args = input(buyer, intent());
    db.prepare("UPDATE opcpay_intents SET status='purchase_unknown',purchase_started_at=? WHERE id=?").run(new Date().toISOString(), args.id);
    const stored = db.prepare('SELECT purchase_key FROM opcpay_intents WHERE id=?').get(args.id);
    const result = await pay.purchase(args);
    assert.equal(result.status, code === 'NOT_FOUND' ? 'awaiting_payment' : 'purchase_unknown');
    assert.equal(client.calls.purchase.length, code === 'NOT_FOUND' ? 1 : 0);
    if (code === 'NOT_FOUND') assert.equal(client.calls.purchase[0].idempotencyKey, stored.purchase_key);
  }
});

test('generic consumption lookup 404, network error and unknown result never authorize a retry debit', async t => {
  for (const error of [Object.assign(new Error(), { status: 404 }), Object.assign(new Error(), { status: 502, code: 'NOT_FOUND' }), new Error('timeout')]) {
    const client = provider({ async consumption() { throw error; } });
    const { pay, buyer, intent, db, quota } = setup(t, { client }); const args = input(buyer, intent());
    db.prepare("UPDATE opcpay_intents SET status='unknown',consume_started_at=? WHERE id=?").run(new Date().toISOString(), args.id);
    assert.equal((await pay.reconcile(args)).status, 'unknown');
    assert.equal(client.calls.consume.length, 0); assert.equal(quota.listCodes().length, 0);
  }
});

test('entitlement issuance rollback retains confirmed debit without partial inventory or cash markers', async t => {
  const { pay, buyer, intent, db, commerce, quota, client } = setup(t); const args = input(buyer, intent());
  db.exec("CREATE TRIGGER refuse_entitlement_delivery BEFORE UPDATE OF code_ciphertext ON shop_orders BEGIN SELECT RAISE(ABORT,'simulated write failure'); END");
  assert.equal((await pay.reconcile(args)).status, 'consumed');
  assert.equal(quota.listCodes().length, 0); assert.equal(commerce.listInventory().length, 0); assert.equal(commerce.listOrders().length, 0);
  db.exec('DROP TRIGGER refuse_entitlement_delivery');
  assert.equal((await pay.reconcile(args)).status, 'fulfilled'); assert.equal(client.calls.consume.length, 1);
  assert.equal(commerce.listOrders()[0].paidAt, null); assert.equal(commerce.stats().revenueCents, 0);
});

test('sandbox and live ledgers cannot be silently reused across operating modes', t => {
  const { db, commerce } = setup(t);
  assert.throws(() => createOpcpay(db, { commerce, secret, config: { ...config, sandbox: true }, client: provider() }), { status: 409 });
});

test('consumed deliveries recover locally even with disabled or replaced provider configuration', async t => {
  const { pay, buyer, intent, commerce, db, client } = setup(t); const args = input(buyer, intent());
  const fulfill = commerce.fulfillEntitlement; commerce.fulfillEntitlement = () => { throw new Error('delivery interruption'); };
  assert.equal((await pay.reconcile(args)).status, 'consumed'); commerce.fulfillEntitlement = fulfill;
  const recovery = createOpcpay(db, { commerce, secret, config: { ...config, enabled: false, apiKey: 'replaced' }, client });
  await recovery.recoverPending(); assert.equal(recovery.getIntent(args).status, 'fulfilled'); assert.equal(client.calls.consume.length, 1);
});

test('official Alipay deep link remains usable while unrelated protocols are rejected', async t => {
  for (const purchase_url of ['alipays://platformapi/startapp?appId=20000067&url=https%3A%2F%2Fexample.test',
    'javascript:alert(1)', 'alipays://other/startapp', 'alipays://platformapi/elsewhere', 'alipays://user:pass@platformapi/startapp']) {
    const client = provider({ async purchase(value) { return { status: 'READY', idempotency_key: value.idempotencyKey, purchase_url, purchase_qr_code: 'https://qr.example.test/code.png', charging_option: option }; } });
    const { pay, buyer, intent } = setup(t, { client }); const result = await pay.purchase(input(buyer, intent()));
    assert.equal(result.purchaseUrl, purchase_url.startsWith('alipays://platformapi/startapp?') ? purchase_url : undefined);
    assert.equal(result.purchaseQrCode, 'https://qr.example.test/code.png');
  }
});

test('a rotated key can query an existing debit but cannot restore a missing debit in another merchant', async t => {
  for (const found of [true, false]) {
    const client = provider();
    const { db, pay, buyer, intent, commerce } = setup(t, { client }); const args = input(buyer, intent());
    db.prepare("UPDATE opcpay_intents SET status='unknown',consume_started_at=? WHERE id=?").run(new Date().toISOString(), args.id);
    const key = db.prepare('SELECT consume_key FROM opcpay_intents WHERE id=?').get(args.id).consume_key;
    if (found) client.receipts.set(key, { status: 'SUCCEEDED', confirmed: true, idempotency_key: key, consumed: 1, quota_unit: 'COUNT' });
    else client.consumption = async () => { throw Object.assign(new Error('not found'), { status: 404, code: 'NOT_FOUND' }); };
    const rotated = createOpcpay(db, { commerce, secret, config: { ...config, apiKey: 'rotated-server-key' }, client });
    assert.equal((await rotated.reconcile(args)).status, found ? 'fulfilled' : 'unknown');
    assert.equal(client.calls.consume.length, 0);
  }
});

test('merchant stopping sales blocks new purchase but preserves redemption of already granted rights', async t => {
  let stopped = false;
  const client = provider({ async product() { return { product_name: config.merchantProjectName, capability_status: stopped ? 'DISABLED' : 'ENABLED', billing_mode: 'QUANTITY', quota_unit: 'COUNT', charging_options: [option] }; } });
  const { pay, buyer, intent } = setup(t, { client }); const args = input(buyer, intent());
  assert.equal((await pay.purchase(args)).status, 'awaiting_payment'); stopped = true;
  assert.equal((await pay.reconcile(args)).status, 'fulfilled');
  await assert.rejects(() => pay.purchase(input(buyer, intent('next-purchase'))), { status: 409 });
});
