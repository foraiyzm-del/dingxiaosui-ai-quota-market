import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMockOpcpay } from '../scripts/opcpay-mock.mjs';

async function fixture(t) {
  const folder = mkdtempSync(join(tmpdir(), 'opcpay-mock-'));
  const dbPath = join(folder, 'provider.sqlite');
  let mock = await createMockOpcpay({ dbPath });
  t.after(async () => { await mock.close(); rmSync(folder, { recursive: true, force: true }); });
  return { get mock() { return mock; }, async restart() { await mock.close(); mock = await createMockOpcpay({ dbPath }); } };
}
const purchase = (mock, userId = 'buyer-private-id', idempotencyKey = 'purchase-1') => mock.client.purchase({ userId, idempotencyKey, skuId: 'opcpay-trial-sku' });
async function confirm(entry, mode = 'success', origin = new URL(entry.purchase_url).origin) {
  return fetch(entry.purchase_url, { method: 'POST', headers: { origin, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ mode }) });
}
const debit = (mock, idempotencyKey = 'consume-1', userId = 'buyer-private-id') => mock.client.consume({ userId, idempotencyKey, amount: 1, reason: 'fixed-package-fixture' });
const extraPackages = [
  { packageId: 'week', name: '丁小穗周卡', priceCents: 2990 },
  { packageId: 'month', name: '丁小穗月卡', priceCents: 9900 },
];

test('week and month mock projects have separate COUNT 1 pools and matching checkout prices', async t => {
  const folder = mkdtempSync(join(tmpdir(), 'opcpay-packages-mock-')), mocks = [];
  t.after(async () => { await Promise.all(mocks.map(mock => mock.close())); rmSync(folder, { recursive: true, force: true }); });
  for (const definition of extraPackages) {
    mocks.push(await createMockOpcpay({ dbPath: join(folder, definition.packageId + '.sqlite'), package: definition }));
  }
  const entries = [];
  for (const [index, mock] of mocks.entries()) {
    const definition = extraPackages[index], product = await mock.client.product(), option = product.charging_options[0];
    assert.equal(product.product_name, definition.name + '（本地模拟）');
    assert.equal(option.price, (definition.priceCents / 100).toFixed(2));
    assert.equal(option.quota_unit, 'COUNT'); assert.equal(option.quota_amount, 1);
    assert.equal(option.sku_id, `opcpay-${definition.packageId}-sku`);
    entries.push(await mock.client.purchase({ userId: 'same-buyer', idempotencyKey: 'same-purchase', skuId: option.sku_id }));
    const html = await (await fetch(entries[index].purchase_url)).text();
    assert.ok(html.includes(definition.name)); assert.ok(html.includes('¥' + option.price));
    await assert.rejects(() => mock.client.access('same-buyer', 3), { status: 400 });
  }
  const confirmations = await Promise.all(Array.from({ length: 3 }, () => confirm(entries[0])));
  assert.ok(confirmations.every(response => response.status === 200));
  assert.equal((await mocks[0].client.access('same-buyer')).remaining, 1);
  assert.equal((await mocks[1].client.access('same-buyer')).remaining, 0, 'week purchase cannot fund a month redemption');
  const request = { userId: 'same-buyer', idempotencyKey: 'same-consume', amount: 1, reason: 'package-pool-fixture' };
  const weekReceipt = await mocks[0].client.consume(request);
  assert.equal(weekReceipt.consumed, 1); assert.deepEqual(await mocks[0].client.consume(request), weekReceipt);
  assert.equal((await mocks[1].client.consumption(request.userId, request.idempotencyKey)).status, 'UNKNOWN');
  await confirm(entries[1]);
  const monthReceipt = await mocks[1].client.consume(request);
  assert.equal(monthReceipt.consumed, 1); assert.notEqual(monthReceipt.consume_order_id, weekReceipt.consume_order_id);
  assert.deepEqual(mocks.map(mock => mock.stats().consumeCount), [1, 1]);
  assert.deepEqual(mocks.map(mock => mock.stats().remaining), [0, 0]);
});

test('mock database retains its package binding across restart and rejects rebinding to a cheaper or dearer package', async t => {
  const folder = mkdtempSync(join(tmpdir(), 'opcpay-mock-binding-')), dbPath = join(folder, 'provider.sqlite');
  let mock = await createMockOpcpay({ dbPath, package: extraPackages[0] });
  t.after(async () => { await mock.close(); rmSync(folder, { recursive: true, force: true }); });
  const entry = await mock.client.purchase({ userId: 'buyer', idempotencyKey: 'purchase', skuId: 'opcpay-week-sku' });
  await confirm(entry); await mock.close();
  await assert.rejects(() => createMockOpcpay({ dbPath, package: extraPackages[1] }), /模拟数据库已绑定其他套餐/);
  mock = await createMockOpcpay({ dbPath, package: extraPackages[0] });
  assert.equal((await mock.client.access('buyer')).remaining, 1);
});

test('mock checkout GET does not grant credit; concurrent confirmations and debit retries persist only one unit', async t => {
  const state = await fixture(t); const first = await purchase(state.mock);
  assert.equal((await purchase(state.mock)).purchase_url, first.purchase_url);
  assert.ok(!first.purchase_url.includes('buyer-private-id'));
  assert.ok(!first.purchase_url.includes('purchase-1'));
  assert.equal(new URL(first.purchase_url).hostname, '127.0.0.1');
  assert.equal(new URL(first.purchase_url).search, '');
  const page = await fetch(first.purchase_url); assert.equal(page.status, 200);
  assert.equal(page.headers.get('referrer-policy'), 'same-origin', 'browser form posts must retain their same-origin Origin');
  assert.ok(!(await page.text()).includes('buyer-private-id'));
  assert.equal((await state.mock.client.access('buyer-private-id', 1)).access_granted, false);
  const confirmed = await Promise.all(Array.from({ length: 4 }, () => confirm(first)));
  assert.ok(confirmed.every(row => row.status === 200));
  assert.equal((await state.mock.client.access('buyer-private-id', 1)).remaining, 1);
  const receipt = await debit(state.mock);
  assert.equal(receipt.status, 'SUCCEEDED'); assert.equal(receipt.confirmed, true); assert.equal(receipt.consumed, 1);
  assert.deepEqual(await debit(state.mock), receipt);
  await state.restart();
  assert.deepEqual(await state.mock.client.consumption('buyer-private-id', 'consume-1'), receipt);
  assert.equal((await state.mock.client.access('buyer-private-id', 1)).remaining, 0);
  const stats = state.mock.stats(); assert.equal(stats.purchaseCount, 1); assert.equal(stats.consumeCount, 1); assert.equal(stats.consumeRequestCount, 2);
  assert.ok(!JSON.stringify(stats).includes('buyer-private-id'));
});

test('mock commits a lost consume response before throwing and recovers it after restart without a second request', async t => {
  const state = await fixture(t); const entry = await purchase(state.mock);
  assert.equal((await confirm(entry, 'lost')).status, 200);
  await assert.rejects(() => debit(state.mock), error => error.code === 'MOCK_RESPONSE_LOST' && error.retryable === true);
  await state.restart();
  const recovered = await state.mock.client.consumption('buyer-private-id', 'consume-1');
  assert.equal(recovered.status, 'SUCCEEDED'); assert.equal(recovered.confirmed, true); assert.equal(recovered.consumed, 1);
  assert.equal(state.mock.stats().consumeCount, 1); assert.equal(state.mock.stats().consumeRequestCount, 1); assert.equal(state.mock.stats().remaining, 0);
});

test('mock purchase rejection grants no credit and consume rejection never debits a confirmed balance', async t => {
  const state = await fixture(t); const rejected = await purchase(state.mock);
  assert.equal((await confirm(rejected, 'purchase-denied')).status, 200);
  assert.equal((await state.mock.client.access('buyer-private-id')).remaining, 0);
  assert.equal((await state.mock.client.purchaseQuery('buyer-private-id', 'purchase-1')).response.status, 'FAILED');
  await confirm(rejected, 'success');
  assert.equal(state.mock.stats().remaining, 0, 'a rejected purchase cannot later be silently approved');
  const accepted = await purchase(state.mock, 'buyer-private-id', 'purchase-2'); await confirm(accepted, 'deny');
  const denied = await debit(state.mock);
  assert.equal(denied.status, 'FAILED'); assert.equal(denied.confirmed, true); assert.equal(denied.consumed, 0);
  assert.deepEqual(await debit(state.mock), denied);
  assert.equal(state.mock.stats().remaining, 1); assert.equal(state.mock.stats().consumeCount, 0);
});

test('mock fixed SKU contract and ownership checks reject forged amount, SKU, lookup, and cross-origin confirmation', async t => {
  const { mock } = await fixture(t);
  const product = await mock.client.product(); const capability = await mock.client.capabilities();
  assert.equal(product.product_name, '丁小穗尝鲜卡（本地模拟）');
  assert.equal(product.charging_options.length, 1);
  assert.deepEqual(Object.fromEntries(['sku_id', 'price', 'currency', 'billing_mode', 'quota_unit', 'quota_amount'].map(key => [key, product.charging_options[0][key]])),
    { sku_id: 'opcpay-trial-sku', price: '9.90', currency: 'CNY', billing_mode: 'QUANTITY', quota_unit: 'COUNT', quota_amount: 1 });
  assert.equal(capability.capabilities.consumption, true); assert.equal(capability.capabilities.transaction_query, false);
  await assert.rejects(() => mock.client.purchase({ userId: 'buyer-private-id', idempotencyKey: 'forged', skuId: 'other' }), { status: 400 });
  await assert.rejects(() => mock.client.consume({ userId: 'buyer-private-id', idempotencyKey: 'forged', reason: 'forged', amount: 999 }), { status: 400 });
  const entry = await purchase(mock);
  assert.equal((await confirm(entry, 'success', 'https://untrusted.example')).status, 403);
  assert.equal((await confirm(entry, 'success', 'null')).status, 403);
  assert.equal(mock.stats().remaining, 0);
  await assert.rejects(() => mock.client.purchaseQuery('other-buyer', 'purchase-1'), { status: 404 });
  assert.equal((await mock.client.consumption('other-buyer', 'consume-1')).status, 'UNKNOWN');
  await confirm(entry); const receipt = await debit(mock);
  assert.equal(receipt.status, 'SUCCEEDED');
  await assert.rejects(() => mock.client.consume({ userId: 'buyer-private-id', idempotencyKey: 'consume-1', reason: 'changed', amount: 1 }), { status: 409 });
  assert.equal((await mock.client.access('other-buyer')).remaining, 0);
});
