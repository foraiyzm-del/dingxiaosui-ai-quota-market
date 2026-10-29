import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { Worker } from 'node:worker_threads';
import { createCommerce } from '../sidecar/commerce.mjs';
import { createQuota } from '../sidecar/quota.mjs';

const secret = 'concurrent-inventory-test-secret';
async function concurrently(filename, operations) {
  const quotaUrl = new URL('../sidecar/quota.mjs', import.meta.url).href;
  const commerceUrl = new URL('../sidecar/commerce.mjs', import.meta.url).href;
  const workers = [], ready = [], results = [];
  for (const operation of operations) {
    let resolveReady, rejectReady;
    ready.push(new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; }));
    const worker = new Worker(`
      const { parentPort, workerData } = require('node:worker_threads');
      (async () => {
        const { DatabaseSync } = await import('node:sqlite');
        const { createQuota } = await import(workerData.quotaUrl);
        const { createCommerce } = await import(workerData.commerceUrl);
        const db = new DatabaseSync(workerData.filename);
        const quota = createQuota(db);
        const commerce = createCommerce(db, { quota, secret: workerData.secret });
        parentPort.postMessage({ type: 'ready' });
        parentPort.once('message', () => {
          let result;
          try { result = { ok: true, value: commerce[workerData.operation.method](workerData.operation.input) }; }
          catch (error) { result = { ok: false, status: error.status, message: error.message }; }
          finally { db.close(); }
          parentPort.postMessage({ type: 'result', result }); parentPort.close();
        });
      })().catch(error => { throw error; });
    `, { eval: true, workerData: { filename, quotaUrl, commerceUrl, secret, operation } });
    workers.push(worker);
    results.push(new Promise((resolve, reject) => {
      worker.on('error', error => { rejectReady(error); reject(error); });
      worker.on('message', message => {
        if (message.type === 'ready') resolveReady();
        if (message.type === 'result') resolve(message.result);
      });
    }));
  }
  try { await Promise.all(ready); for (const worker of workers) worker.postMessage('go'); return await Promise.all(results); }
  finally { await Promise.all(workers.map(worker => worker.terminate())); }
}

test('independent connections cannot oversell a final card or duplicate delivery', { timeout: 20000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'inventory-test-'));
  const filename = join(directory, 'stock.sqlite');
  const db = new DatabaseSync(filename);
  t.after(() => {
    db.close();
    for (const path of [filename, `${filename}-journal`, `${filename}-wal`, `${filename}-shm`]) rmSync(path, { force: true });
    rmdirSync(directory);
  });
  const quota = createQuota(db);
  quota.createProject({ id: 'packaging', name: '包装设计平台' });
  const commerce = createCommerce(db, { quota, secret });
  commerce.saveProduct({ id: 'packaging-50', projectId: 'packaging', name: '包装设计', units: 50, priceCents: 2990 });
  commerce.generateInventory({ productId: 'packaging-50', quantity: 1 });
  const input = { productId: 'packaging-50', email: 'buyer@example.com' };
  const orders = await concurrently(filename, Array.from({ length: 4 }, () => ({ method: 'createOrder', input })));
  assert.equal(orders.filter(item => item.ok).length, 1, JSON.stringify(orders));
  assert.equal(orders.filter(item => !item.ok && item.status === 409).length, 3, JSON.stringify(orders));
  const order = orders.find(item => item.ok).value;
  assert.equal(commerce.listOrders().length, 1);
  assert.equal(commerce.stats().reservedCardCount, 1);
  const approvals = await concurrently(filename, Array.from({ length: 4 }, () => ({ method: 'approveOrder',
    input: { id: order.id, verifiedReference: 'confirmed-only-once', confirmed: true } })));
  assert.equal(approvals.every(item => item.ok && item.value.status === 'fulfilled'), true, JSON.stringify(approvals));
  assert.equal(new Set(approvals.map(item => item.value.inventoryId)).size, 1);
  assert.equal(quota.listCodes().length, 1);
  assert.equal(commerce.stats().soldCardCount, 1);
  assert.equal(commerce.stats().revenueCents, 2990);
  const code = commerce.getOrder(order).code;
  assert.equal(quota.redeem({ projectId: 'packaging', userId: 'buyer', code }).balance.available, 50);
});

test('concurrent verified approvals generate exactly one payment-time combination card', { timeout: 20000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'inventory-test-'));
  const filename = join(directory, 'automatic.sqlite'), db = new DatabaseSync(filename);
  t.after(() => {
    db.close();
    for (const path of [filename, `${filename}-journal`, `${filename}-wal`, `${filename}-shm`]) rmSync(path, { force: true });
    rmdirSync(directory);
  });
  const quota = createQuota(db); quota.createProject({ id: 'dingxiaosui', name: '丁小穗' });
  const commerce = createCommerce(db, { quota, secret });
  const allocation = { text: 3, image: 1, video: 1 };
  commerce.saveProduct({ id: 'combo', projectId: 'dingxiaosui', name: '创作组合', units: 5, priceCents: 1290,
    fulfillment: 'on_payment', packageOptions: [{ id: 'combo', label: '组合', quota: allocation, priceCents: 1290 }] });
  const order = commerce.createOrder({ productId: 'combo', email: 'buyer@example.com' });
  assert.equal(quota.listCodes().length, 0);
  const approvals = await concurrently(filename, Array.from({ length: 4 }, () => ({ method: 'approveOrder', input: {
    id: order.id, confirmed: true, verifiedReference: 'simulated-concurrent-auto-issue',
  } })));
  assert.equal(approvals.every(item => item.ok && item.value.status === 'fulfilled'), true, JSON.stringify(approvals));
  assert.equal(new Set(approvals.map(item => item.value.inventoryId)).size, 1);
  assert.equal(quota.listCodes().length, 1); assert.equal(commerce.stats().inventoryCount, 1);
  assert.equal(commerce.stats().soldCardCount, 1);
  const delivered = commerce.getOrder(order);
  const result = quota.redeem({ projectId: 'dingxiaosui', userId: 'buyer', code: delivered.code });
  assert.deepEqual(result.quota, allocation);
});
