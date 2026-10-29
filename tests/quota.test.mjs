import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { Worker } from 'node:worker_threads';
import { createQuota } from '../sidecar/quota.mjs';

function setup(t, filename = ':memory:') {
  const db = new DatabaseSync(filename);
  t.after(() => db.close());
  const quota = createQuota(db);
  quota.createProject({ id: 'writing', name: '写作' });
  quota.createProject({ id: 'images', name: '图片' });
  return { quota, db };
}

function grant(quota, units = 3, projectId = 'writing', userId = 'alice') {
  const { codes: [code] } = quota.generateCodes({ projectId, quantity: 1, units });
  quota.redeem({ projectId, userId, code });
  return code;
}

function status(expected) {
  return (error) => error instanceof Error && error.status === expected;
}

test('explicit same-user redemption replay recovers receipt without minting new quota', t => {
  const { quota } = setup(t);
  const code = quota.generateCodes({ projectId: 'writing', quantity: 1, quota: { text: 3, image: 1, video: 1 } }).codes[0];
  const input = { projectId: 'writing', userId: 'buyer', code, idempotent: true };
  const first = quota.redeem(input);
  const hold = quota.reserve({ projectId: 'writing', userId: 'buyer', requestId: 'text-1', capability: 'text' });
  quota.settle({ projectId: 'writing', usageId: hold.usage.id, action: 'commit' });
  const replay = quota.redeem(input);
  assert.equal(replay.codeId, first.codeId);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.quota, { text: 3, image: 1, video: 1 });
  assert.equal(replay.balance.granted, 5);
  assert.equal(replay.balance.consumed, 1);
  assert.throws(() => quota.redeem({ ...input, userId: 'someone-else' }), status(409));
  assert.throws(() => quota.redeem({ ...input, idempotent: false }), status(409));
  assert.equal(quota.stats().redeemedCodeCount, 1);
});

test('activation codes are project-bound, one-use, random and stored as hashes only', (t) => {
  const { quota, db } = setup(t);
  const generated = quota.generateCodes({ projectId: 'writing', quantity: 2, units: 7 });
  assert.equal(new Set(generated.codes).size, 2);
  const code = generated.codes[0];
  assert.match(code, /^QTA-[0-9A-F]{36}$/u);
  assert.throws(() => quota.redeem({ projectId: 'images', code, userId: 'alice' }), status(404));
  assert.equal(quota.balance({ projectId: 'images', userId: 'alice' }).available, 0);
  const redeemed = quota.redeem({ projectId: 'writing', code: ` ${code.toLowerCase()} `, userId: 'alice' });
  assert.equal(redeemed.balance.available, 7);
  assert.throws(() => quota.redeem({ projectId: 'writing', code, userId: 'alice' }), status(409));
  assert.throws(() => quota.redeem({ projectId: 'writing', code, userId: 'bob' }), status(409));
  assert.equal(quota.balance({ projectId: 'writing', userId: 'bob' }).available, 0);
  const stored = db.prepare('SELECT * FROM quota_codes').all();
  assert.equal(JSON.stringify(stored).includes(code), false);
  assert.equal(JSON.stringify(quota.listCodes()).includes(code), false);
  assert.equal(stored.every((row) => /^[a-f0-9]{64}$/u.test(row.code_hash)), true);
  assert.equal(quota.stats().redeemedCodeCount, 1);
});

test('reservation retries do not debit twice and mismatching units conflict', (t) => {
  const { quota } = setup(t);
  grant(quota, 2);
  const first = quota.reserve({ projectId: 'writing', userId: 'alice', requestId: 'request-1' });
  const retry = quota.reserve({ projectId: 'writing', userId: 'alice', requestId: 'request-1' });
  assert.equal(retry.usage.id, first.usage.id);
  assert.deepEqual(retry.balance, { projectId: 'writing', userId: 'alice', granted: 2, available: 1, reserved: 1, consumed: 0 });
  assert.throws(() => quota.reserve({ projectId: 'writing', userId: 'alice', requestId: 'request-1', units: 2 }), status(409));
  assert.throws(() => quota.reserve({ projectId: 'writing', userId: 'alice', requestId: 'request-2', units: 2 }), status(402));
  assert.equal(quota.listUsage().length, 1);
});

test('failed work returns quota exactly once and successful work consumes it exactly once', (t) => {
  const { quota } = setup(t);
  grant(quota, 2);
  const { usage: failed } = quota.reserve({ projectId: 'writing', userId: 'alice', requestId: 'failed' });
  const cancelled = quota.settle({ projectId: 'writing', usageId: failed.id, action: 'cancel' });
  assert.deepEqual(cancelled.balance, { projectId: 'writing', userId: 'alice', granted: 2, available: 2, reserved: 0, consumed: 0 });
  assert.deepEqual(quota.settle({ projectId: 'writing', usageId: failed.id, action: 'cancel' }), cancelled);
  assert.throws(() => quota.settle({ projectId: 'writing', usageId: failed.id, action: 'commit' }), status(409));
  assert.equal(quota.reserve({ projectId: 'writing', userId: 'alice', requestId: 'failed' }).usage.status, 'cancelled');
  assert.equal(quota.balance({ projectId: 'writing', userId: 'alice' }).reserved, 0);
  const { usage: success } = quota.reserve({ projectId: 'writing', userId: 'alice', requestId: 'success', units: 2 });
  assert.throws(() => quota.settle({ projectId: 'images', usageId: success.id, action: 'commit' }), status(404));
  const committed = quota.settle({ projectId: 'writing', usageId: success.id, action: 'commit' });
  assert.deepEqual(quota.settle({ projectId: 'writing', usageId: success.id, action: 'commit' }), committed);
  assert.throws(() => quota.settle({ projectId: 'writing', usageId: success.id, action: 'cancel' }), status(409));
  assert.deepEqual(committed.balance, { projectId: 'writing', userId: 'alice', granted: 2, available: 0, reserved: 0, consumed: 2 });
  assert.equal(quota.stats().committedUnits, 2);
});

test('accounts and idempotency keys are scoped by project and user', (t) => {
  const { quota } = setup(t);
  grant(quota, 1);
  grant(quota, 1, 'images');
  grant(quota, 1, 'writing', 'bob');
  const a = quota.reserve({ projectId: 'writing', userId: 'alice', requestId: 'same' });
  const b = quota.reserve({ projectId: 'images', userId: 'alice', requestId: 'same' });
  const c = quota.reserve({ projectId: 'writing', userId: 'bob', requestId: 'same' });
  assert.equal(new Set([a.usage.id, b.usage.id, c.usage.id]).size, 3);
  assert.throws(() => quota.reserve({ projectId: 'images', userId: 'bob', requestId: 'same' }), status(402));
});

test('validation rejects unknown projects, non-positive units and excessive batches', (t) => {
  const { quota } = setup(t);
  assert.throws(() => quota.createProject({ id: 'writing', name: 'duplicate' }), status(409));
  assert.throws(() => quota.createProject({ id: 'bad/id', name: 'bad' }), status(400));
  for (const units of [0, -1, 1.2, 1_000_001, Number.NaN, '1']) {
    assert.throws(() => quota.generateCodes({ projectId: 'writing', quantity: 1, units }), status(400));
    assert.throws(() => quota.reserve({ projectId: 'writing', userId: 'alice', requestId: 'bad', units }), status(400));
  }
  assert.throws(() => quota.generateCodes({ projectId: 'writing', quantity: 1001, units: 1 }), status(400));
  assert.throws(() => quota.balance({ projectId: 'missing', userId: 'alice' }), status(404));
  assert.throws(() => quota.generateCodes({ projectId: 'missing', quantity: 1, units: 1 }), status(404));
  assert.throws(() => quota.redeem({ projectId: 'missing', userId: 'alice', code: 'test' }), status(404));
  assert.throws(() => quota.reserve({ projectId: 'missing', userId: 'alice', requestId: 'test' }), status(404));
  assert.throws(() => quota.settle({ projectId: 'missing', usageId: 'test', action: 'commit' }), status(404));
  assert.throws(() => quota.settle({ projectId: 'writing', usageId: 'test', action: 'invalid' }), status(400));
});

async function concurrentReserve(filename, requestIds) {
  const moduleUrl = new URL('../sidecar/quota.mjs', import.meta.url).href;
  const workers = [];
  const ready = [];
  const results = [];
  for (const requestId of requestIds) {
    let resolveReady;
    let rejectReady;
    ready.push(new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; }));
    const worker = new Worker(`
      const { parentPort, workerData } = require('node:worker_threads');
      (async () => {
        const { DatabaseSync } = await import('node:sqlite');
        const { createQuota } = await import(workerData.moduleUrl);
        const db = new DatabaseSync(workerData.filename);
        const quota = createQuota(db);
        parentPort.postMessage({ type: 'ready' });
        parentPort.once('message', () => {
          let result;
          try {
            result = { ok: true, value: quota.reserve({ projectId: 'writing', userId: 'alice', requestId: workerData.requestId }) };
          } catch (error) {
            result = { ok: false, status: error.status, message: error.message };
          } finally { db.close(); }
          parentPort.postMessage({ type: 'result', result });
          parentPort.close();
        });
      })().catch((error) => { throw error; });
    `, { eval: true, workerData: { filename, moduleUrl, requestId } });
    workers.push(worker);
    results.push(new Promise((resolve, reject) => {
      worker.on('error', (error) => { rejectReady(error); reject(error); });
      worker.on('message', (message) => {
        if (message.type === 'ready') resolveReady();
        if (message.type === 'result') resolve(message.result);
      });
    }));
  }
  try {
    await Promise.all(ready);
    for (const worker of workers) worker.postMessage('go');
    return await Promise.all(results);
  } finally {
    await Promise.all(workers.map((worker) => worker.terminate()));
  }
}

test('independent SQLite connections serialize simultaneous reservations without overdraft', { timeout: 20000 }, async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'quota-test-'));
  const filename = join(directory, 'quota.sqlite');
  const db = new DatabaseSync(filename);
  const quota = createQuota(db);
  t.after(() => {
    db.close();
    for (const path of [filename, `${filename}-journal`, `${filename}-wal`, `${filename}-shm`]) rmSync(path, { force: true });
    rmdirSync(directory);
  });
  quota.createProject({ id: 'writing', name: 'writing' });
  grant(quota, 1);
  const duplicate = await concurrentReserve(filename, ['same', 'same', 'same', 'same']);
  assert.equal(duplicate.every((result) => result.ok), true, JSON.stringify(duplicate));
  assert.equal(new Set(duplicate.map((result) => result.value.usage.id)).size, 1);
  assert.equal(quota.balance({ projectId: 'writing', userId: 'alice' }).reserved, 1);
  quota.settle({ projectId: 'writing', usageId: duplicate[0].value.usage.id, action: 'cancel' });
  const competing = await concurrentReserve(filename, ['one', 'two', 'three', 'four']);
  assert.equal(competing.filter((result) => result.ok).length, 1, JSON.stringify(competing));
  assert.equal(competing.filter((result) => !result.ok && result.status === 402).length, 3);
  assert.deepEqual(quota.balance({ projectId: 'writing', userId: 'alice' }), {
    projectId: 'writing', userId: 'alice', granted: 1, available: 0, reserved: 1, consumed: 0,
  });
});
