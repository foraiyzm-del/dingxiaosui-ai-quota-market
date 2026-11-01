import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { Worker } from 'node:worker_threads';
import { createChannelBudgets } from '../sidecar/channel-budgets.mjs';
import { createChannels } from '../sidecar/channels.mjs';
import { createCommerce } from '../sidecar/commerce.mjs';
import { createPlatforms } from '../sidecar/platforms.mjs';
import { createQuota } from '../sidecar/quota.mjs';

const secret = 'isolated-channel-budget-test-secret';
const projectId = 'budget-studio';
const channelId = 'budget-relay';
const productId = 'budget-trial';
const packageId = 'trial';
const allocation = { text: 10, image: 15, video: 2 };
const zero = { text: 0, image: 0, video: 0 };
const twice = { text: 20, image: 30, video: 4 };
const channelInput = {
  id: channelId, name: '隔离预算测试渠道', baseUrl: 'https://budget-test.invalid/v1',
  apiKey: 'isolated-test-key-never-used',
  models: ['text', 'image', 'video'].map(capability => ({ id: `test-${capability}`, capability })),
};

function setup(t, { filename = ':memory:', fulfillment = 'on_payment' } = {}) {
  const db = new DatabaseSync(filename);
  t.after(() => db.close());
  const quota = createQuota(db);
  const channels = createChannels(db, { secret });
  channels.saveChannel(channelInput);
  const platforms = createPlatforms(db, { quota, channels });
  platforms.savePlatform({ id: projectId, name: '隔离创作平台', bindings: channelInput.models.map(model => ({
    channelId, capability: model.capability, model: model.id,
  })) });
  const commerce = createCommerce(db, { quota, channels, platforms, secret });
  commerce.saveProduct({ id: productId, projectId, name: '创作次数', units: 27, priceCents: 990, fulfillment,
    packageOptions: [{ id: packageId, label: '尝鲜卡', quota: allocation, priceCents: 990 }] });
  const budgets = createChannelBudgets(db);
  return { db, quota, channels, platforms, commerce, budgets };
}

const direct = (commerce, quantity = 1, extra = {}) => commerce.generateInventory({
  productId, packageId, quantity, delivery: 'direct', ...extra,
});
const budget = (budgets, total = allocation, id = channelId) => budgets.saveBudget({ channelId: id, total });
const snapshot = (budgets, id = channelId) => {
  const result = budgets.getBudget(id);
  return result && { channelId: result.channelId, total: result.total, allocated: result.allocated, remaining: result.remaining };
};
const expectedBudget = (total, allocated, remaining, id = channelId) => ({ channelId: id, total, allocated, remaining });
const approved = id => ({ id, confirmed: true, verifiedReference: `isolated-budget-reference-${id}` });

test('channel budgets validate totals, persist and survive ordinary channel edits', t => {
  const { db, channels, budgets } = setup(t);
  assert.equal(budgets.getBudget(channelId), null);
  assert.throws(() => budget(budgets, allocation, 'missing-channel'), { status: 404 });
  for (const total of [null, [], { ...allocation, text: -1 }, { ...allocation, image: 1.5 },
    { ...allocation, video: '2' }, { ...allocation, text: Infinity }, { ...allocation, text: NaN },
    { ...allocation, video: Number.MAX_SAFE_INTEGER + 1 }, { ...allocation, audio: 1 }]) {
    assert.throws(() => budget(budgets, total), { status: 400 });
    assert.equal(budgets.getBudget(channelId), null);
  }
  budget(budgets, zero);
  assert.deepEqual(snapshot(budgets), expectedBudget(zero, zero, zero));
  budget(budgets, twice);
  const saved = expectedBudget(twice, zero, twice);
  assert.deepEqual(snapshot(budgets), saved);
  channels.saveChannel({ ...channelInput, apiKey: '', name: '仅修改名称' });
  assert.deepEqual(snapshot(budgets), saved);
  assert.deepEqual(snapshot(createChannelBudgets(db)), saved);
});

test('two direct package cards allocate 20/30/4, redeem 10/15/2 and block a third card', t => {
  const { quota, commerce, budgets } = setup(t);
  budget(budgets, twice);
  const issued = direct(commerce, 2, { quota: { text: 1 }, channelId: 'untrusted-client-channel' });
  assert.equal(issued.quantity, 2);
  assert.equal(issued.codes.length, 2);
  assert.equal(new Set(issued.codes).size, 2);
  assert.deepEqual(issued.quota, allocation);
  assert.equal(issued.packageLabel, '尝鲜卡');
  assert.equal(issued.productName, '创作次数');
  assert.equal(commerce.listInventory().length, 0);
  assert.equal(commerce.listOrders().length, 0);
  assert.equal(quota.listCodes().length, 2);
  assert.deepEqual(snapshot(budgets), expectedBudget(twice, twice, zero));
  assert.throws(() => direct(commerce), { status: 409 });
  assert.equal(quota.listCodes().length, 2);
  assert.deepEqual(snapshot(budgets), expectedBudget(twice, twice, zero));
  const receipt = quota.redeem({ projectId, userId: 'budget-demo-user', code: issued.codes[0] });
  assert.deepEqual(receipt.quota, allocation);
  for (const capability of Object.keys(allocation)) {
    assert.equal(receipt.balance.byCapability[capability].available, allocation[capability]);
  }
  assert.equal(receipt.balance.reserved, 0);
  assert.equal(receipt.balance.consumed, 0);
  assert.deepEqual(snapshot(budgets), expectedBudget(twice, twice, zero));
  assert.throws(() => quota.redeem({ projectId, userId: 'another-user', code: issued.codes[0] }), { status: 409 });
  assert.equal(quota.listUsage().length, 0);
});

test('one insufficient capability rejects the entire batch without issuing partial cards', t => {
  const { quota, commerce, budgets } = setup(t);
  const total = { text: 20, image: 30, video: 3 };
  budget(budgets, total);
  assert.throws(() => direct(commerce, 2), { status: 409 });
  assert.equal(quota.listCodes().length, 0);
  assert.equal(commerce.listBatches().length, 0);
  assert.deepEqual(snapshot(budgets), expectedBudget(total, zero, total));
});

test('budget edits cannot erase allocations or reduce total below already issued quota', t => {
  const { channels, commerce, budgets } = setup(t);
  budget(budgets, twice);
  direct(commerce);
  const before = expectedBudget(twice, allocation, allocation);
  for (const total of [{ ...twice, text: 9 }, { ...twice, image: 14 }, { ...twice, video: 1 }]) {
    assert.throws(() => budget(budgets, total), { status: 409 });
    assert.deepEqual(snapshot(budgets), before);
  }
  channels.saveChannel({ ...channelInput, apiKey: '', name: '已发卡后编辑渠道' });
  assert.deepEqual(snapshot(budgets), before);
  budget(budgets, allocation);
  assert.deepEqual(snapshot(budgets), expectedBudget(allocation, allocation, zero));
  budget(budgets, twice);
  assert.deepEqual(snapshot(budgets), before);
});

test('stock issuance spends the same budget; sale, approval retries and redemption do not spend it again', t => {
  const { quota, commerce, budgets } = setup(t, { fulfillment: 'stock' });
  budget(budgets);
  const batch = commerce.generateInventory({ productId, packageId, quantity: 1 });
  assert.deepEqual(snapshot(budgets), expectedBudget(allocation, allocation, zero));
  const exported = commerce.exportBatch({ batchId: batch.batchId });
  assert.throws(() => quota.redeem({ projectId, userId: 'stock-buyer', code: exported.codes[0].code }), { status: 409 });
  assert.throws(() => commerce.generateInventory({ productId, packageId, quantity: 1 }), { status: 409 });
  const order = commerce.createOrder({ productId, packageId, email: 'stock-budget@example.invalid' });
  commerce.approveOrder(approved(order.id));
  commerce.approveOrder(approved(order.id));
  const delivered = commerce.getOrder(order);
  assert.equal(delivered.status, 'fulfilled');
  assert.equal(quota.listCodes().length, 1);
  const receipt = quota.redeem({ projectId, userId: 'stock-buyer', code: delivered.code });
  assert.deepEqual(receipt.quota, allocation);
  assert.deepEqual(snapshot(budgets), expectedBudget(allocation, allocation, zero));
});

test('payment-time cards share the budget and rejected approval leaves no payment markers or orphan stock', t => {
  const { quota, commerce, budgets } = setup(t);
  budget(budgets);
  const order = commerce.createOrder({ productId, packageId, email: 'automatic-budget@example.invalid' });
  assert.deepEqual(snapshot(budgets), expectedBudget(allocation, zero, allocation));
  commerce.approveOrder(approved(order.id));
  commerce.approveOrder(approved(order.id));
  assert.deepEqual(snapshot(budgets), expectedBudget(allocation, allocation, zero));
  assert.equal(quota.listCodes().length, 1);
  const next = commerce.createOrder({ productId, packageId, email: 'automatic-budget-2@example.invalid' });
  assert.throws(() => commerce.approveOrder(approved(next.id)), { status: 409 });
  assert.equal(commerce.getOrder(next).status, 'pending');
  assert.equal(commerce.getOrder(next).verifiedReference, null);
  assert.equal(quota.listCodes().length, 1);
  assert.equal(commerce.listInventory().length, 1);
  assert.deepEqual(snapshot(budgets), expectedBudget(allocation, allocation, zero));
});

test('a later fulfillment failure rolls back both issued quota and channel budget', t => {
  const { db, quota, commerce, budgets } = setup(t);
  budget(budgets);
  const order = commerce.createOrder({ productId, packageId, email: 'rollback-budget@example.invalid' });
  db.exec("CREATE TRIGGER fail_budget_order BEFORE UPDATE OF status ON shop_orders WHEN NEW.status='fulfilled' BEGIN SELECT RAISE(ABORT,'isolated budget rollback failure'); END");
  assert.throws(() => commerce.approveOrder(approved(order.id)), /isolated budget rollback failure/);
  assert.equal(quota.listCodes().length, 0);
  assert.equal(commerce.listInventory().length, 0);
  assert.equal(commerce.listBatches().length, 0);
  assert.deepEqual(snapshot(budgets), expectedBudget(allocation, zero, allocation));
  db.exec('DROP TRIGGER fail_budget_order');
  commerce.approveOrder(approved(order.id));
  assert.deepEqual(snapshot(budgets), expectedBudget(allocation, allocation, zero));
});

test('a code insert failure rolls back the whole direct batch and its allocation', t => {
  const { db, quota, commerce, budgets } = setup(t);
  budget(budgets, twice);
  db.exec("CREATE TRIGGER fail_second_budget_code BEFORE INSERT ON quota_codes WHEN (SELECT COUNT(*) FROM quota_codes)>=1 BEGIN SELECT RAISE(ABORT,'isolated second code failure'); END");
  assert.throws(() => direct(commerce, 2), /isolated second code failure/);
  assert.equal(quota.listCodes().length, 0);
  assert.deepEqual(snapshot(budgets), expectedBudget(twice, zero, twice));
});

test('old direct issuance obeys budgets and shared quota or client routing cannot bypass a configured limit', t => {
  const { quota, budgets } = setup(t);
  budget(budgets);
  assert.throws(() => quota.generateCodes({ projectId, quantity: 1, units: 27 }), { status: 409 });
  assert.equal(quota.listCodes().length, 0);
  assert.deepEqual(snapshot(budgets), expectedBudget(allocation, zero, allocation));
  quota.generateCodes({ projectId, quantity: 1, quota: allocation, apiBindings: [], channelId: 'ignored-client-channel' });
  assert.deepEqual(snapshot(budgets), expectedBudget(allocation, allocation, zero));
  assert.throws(() => quota.generateCodes({ projectId, quantity: 1, quota: allocation, apiBindings: [] }), { status: 409 });
  assert.throws(() => quota.generateCodes({ projectId, quantity: 1, units: 1, apiBindings: [] }), { status: 409 });
  assert.equal(quota.listCodes().length, 1);
});

test('multi-channel allocations fail atomically when a later channel lacks one capability', t => {
  const { quota, channels, platforms, commerce, budgets } = setup(t);
  const otherId = 'second-budget-relay';
  channels.saveChannel({ ...channelInput, id: otherId });
  platforms.savePlatform({ id: projectId, bindings: channelInput.models.map(model => ({
    channelId: model.capability === 'text' ? channelId : otherId, capability: model.capability, model: model.id,
  })) });
  const firstTotal = { text: 10, image: 0, video: 0 };
  const secondTotal = { text: 0, image: 15, video: 1 };
  budget(budgets, firstTotal);
  budget(budgets, secondTotal, otherId);
  assert.throws(() => direct(commerce), { status: 409 });
  assert.equal(quota.listCodes().length, 0);
  assert.deepEqual(snapshot(budgets), expectedBudget(firstTotal, zero, firstTotal));
  assert.deepEqual(snapshot(budgets, otherId), expectedBudget(secondTotal, zero, secondTotal, otherId));
});

test('an unset channel budget preserves legacy issuance behavior', t => {
  const { quota, budgets } = setup(t);
  assert.doesNotThrow(() => quota.generateCodes({ projectId, quantity: 1, units: 27 }));
  assert.doesNotThrow(() => quota.generateCodes({ projectId, quantity: 2, quota: allocation }));
  assert.equal(quota.listCodes().length, 3);
  assert.equal(budgets.getBudget(channelId), null);
});

async function concurrentIssuance(filename, count) {
  const moduleUrls = Object.fromEntries(['quota', 'commerce', 'channels', 'platforms'].map(name => [
    name, new URL(`../sidecar/${name}.mjs`, import.meta.url).href,
  ]));
  const workers = [], ready = [], results = [];
  for (let index = 0; index < count; index++) {
    let resolveReady, rejectReady;
    ready.push(new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; }));
    const worker = new Worker(`
      const { parentPort, workerData } = require('node:worker_threads');
      (async () => {
        const { DatabaseSync } = await import('node:sqlite');
        const { createQuota } = await import(workerData.moduleUrls.quota);
        const { createCommerce } = await import(workerData.moduleUrls.commerce);
        const { createChannels } = await import(workerData.moduleUrls.channels);
        const { createPlatforms } = await import(workerData.moduleUrls.platforms);
        const db = new DatabaseSync(workerData.filename);
        const quota = createQuota(db), channels = createChannels(db, { secret: workerData.secret });
        const platforms = createPlatforms(db, { quota, channels });
        const commerce = createCommerce(db, { quota, channels, platforms, secret: workerData.secret });
        parentPort.postMessage({ type: 'ready' });
        parentPort.once('message', () => {
          let result;
          try {
            const generated = commerce.generateInventory(workerData.input);
            result = { ok: true, quantity: generated.quantity };
          } catch (error) { result = { ok: false, status: error.status }; }
          finally { db.close(); }
          parentPort.postMessage({ type: 'result', result }); parentPort.close();
        });
      })().catch(error => { throw error; });
    `, { eval: true, workerData: { filename, moduleUrls, secret,
      input: { productId, packageId, quantity: 1, delivery: 'direct' } } });
    workers.push(worker);
    results.push(new Promise((resolve, reject) => {
      worker.on('error', error => { rejectReady(error); reject(error); });
      worker.on('message', message => {
        if (message.type === 'ready') resolveReady();
        if (message.type === 'result') resolve(message.result);
      });
    }));
  }
  try {
    await Promise.all(ready);
    for (const worker of workers) worker.postMessage('go');
    return await Promise.all(results);
  } finally { await Promise.all(workers.map(worker => worker.terminate())); }
}

test('independent connections cannot issue beyond the final channel allocation', { timeout: 20000 }, async t => {
  const filename = join(tmpdir(), `channel-budget-${randomUUID()}.sqlite`);
  const { quota, commerce, budgets } = setup(t, { filename });
  t.after(() => unlinkSync(filename));
  budget(budgets);
  const results = await concurrentIssuance(filename, 4);
  assert.equal(results.filter(result => result.ok).length, 1);
  assert.equal(results.filter(result => !result.ok && result.status === 409).length, 3);
  assert.equal(quota.listCodes().length, 1);
  assert.equal(commerce.listInventory().length, 0);
  assert.deepEqual(snapshot(budgets), expectedBudget(allocation, allocation, zero));
});
