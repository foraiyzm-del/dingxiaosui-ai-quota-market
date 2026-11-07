import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startCenter } from '../sidecar/server.mjs';

test('OPC buyer identity is cookie bound, recoverable and never chosen by browser', async t => {
  const parent = path.resolve(tmpdir());
  const root = await mkdtemp(path.join(parent, 'opcpay-http-'));
  await mkdir(path.join(root, 'local'));
  const center = await startCenter({ root, port: 0, config: { port: 0, adminPassword: 'test-admin', merchantKey: 'test-only-opcpay-http-secret' } });
  t.after(async () => {
    await center.close();
    assert.equal(path.dirname(path.resolve(root)), parent);
    assert.match(path.basename(root), /^opcpay-http-/);
    await rm(root, { recursive: true, force: true });
  });
  const origin = `http://127.0.0.1:${center.server.address().port}`;
  async function request(route, body, cookie, extra = {}) {
    const res = await fetch(origin + route, { method: body === undefined ? 'GET' : 'POST', headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, headers: res.headers, data: await res.json(), cookie: res.headers.get('set-cookie')?.split(';')[0] };
  }
  const info = await request('/api/opcpay/info');
  assert.equal(info.status, 200);
  assert.equal(info.data.ready, false);
  assert.equal((await request('/api/opcpay/intents')).status, 401);
  assert.equal((await request('/api/opcpay/buyer', { userId: 'victim' })).status, 400);
  const first = await request('/api/opcpay/buyer', {});
  assert.equal(first.status, 201);
  assert.match(first.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  assert.ok(first.data.recoveryCode);
  assert.equal(first.data.sessionToken, undefined);
  const me = await request('/api/opcpay/buyer', undefined, first.cookie);
  assert.equal(me.data.authenticated, true);
  assert.equal(me.data.recoveryCode, undefined);
  const restored = await request('/api/opcpay/buyer/recover', { recoveryCode: first.data.recoveryCode });
  assert.equal(restored.status, 200);
  assert.equal(restored.data.buyerId, first.data.buyerId);
  assert.equal((await request('/api/opcpay/buyer/recover', { recoveryCode: 'wrong' })).status, 403);
  assert.equal((await request('/api/opcpay/intents', { requestId: 'test-request-001', userId: 'victim', priceCents: 1 }, restored.cookie)).status, 400);
  assert.equal((await request('/api/opcpay/intents', { requestId: 'test-request-002' }, restored.cookie, { origin: 'https://attacker.example' })).status, 403);
  const noOrigin = await fetch(origin + '/api/opcpay/buyer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(noOrigin.status, 403);
  const text = JSON.stringify(info.data) + JSON.stringify(me.data);
  assert.ok(!text.includes('test-only-opcpay-http-secret'));
  assert.equal((await request('/api/opcpay/buyer/logout', {}, restored.cookie)).status, 200);
  assert.equal((await request('/api/opcpay/buyer', undefined, restored.cookie)).data.authenticated, false);
  assert.equal((await request('/api/opcpay/intents', undefined, restored.cookie)).status, 401);
});

test('storefront packages expose fixed quotas but unconfigured weekly and monthly exchanges stay closed', async t => {
  const parent = path.resolve(tmpdir());
  const root = await mkdtemp(path.join(parent, 'opcpay-http-'));
  await mkdir(path.join(root, 'local'));
  const center = await startCenter({ root, port: 0,
    config: { port: 0, adminPassword: 'catalog-private-admin', merchantKey: 'catalog-private-encryption-secret' },
    opcpayOptions: { config: { enabled: false, apiKey: 'catalog-private-provider-key' } } });
  t.after(async () => {
    await center.close();
    assert.equal(path.dirname(path.resolve(root)), parent);
    assert.match(path.basename(root), /^opcpay-http-/);
    await rm(root, { recursive: true, force: true });
  });
  const origin = `http://127.0.0.1:${center.server.address().port}`;
  const response = await fetch(origin + '/api/shop/products');
  assert.equal(response.status, 200);
  const catalog = await response.json();
  assert.deepEqual(catalog.storefront?.dingxiaosui, { packages: [
    { id: 'trial', label: '尝鲜卡', priceCents: 990, quota: { text: 10, image: 15, video: 2 } },
    { id: 'week', label: '周卡', priceCents: 2990, quota: { text: 30, image: 45, video: 6 } },
    { id: 'month', label: '月卡', recommended: true, priceCents: 9900, quota: { text: 100, image: 150, video: 20 } },
    { id: 'season', label: '旺季卡', priceCents: 29900, quota: { text: 300, image: 450, video: 70 } },
    { id: 'custom', label: '自由组合', priceCents: null, quota: null },
  ], customPricing: null });
  assert.doesNotMatch(JSON.stringify(catalog), /catalog-private-|apiKey|merchantKey|adminPassword/);
  assert.equal(catalog.products.length, 0);
  const created = await fetch(origin + '/api/opcpay/buyer', { method: 'POST',
    headers: { origin, 'content-type': 'application/json' }, body: '{}' });
  const cookie = created.headers.get('set-cookie')?.split(';')[0];
  assert.equal(created.status, 201);
  for (const packageId of ['week', 'month', 'season', 'custom']) {
    const blocked = await fetch(origin + '/api/opcpay/intents', { method: 'POST',
      headers: { origin, cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: 'preview-' + packageId, packageId }) });
    assert.equal(blocked.status, ['week', 'month'].includes(packageId) ? 503 : 400);
  }
  assert.equal(center.db.prepare('SELECT COUNT(*) AS count FROM opcpay_intents').get().count, 0);
  assert.equal(center.db.prepare('SELECT COUNT(*) AS count FROM shop_orders').get().count, 0);
  assert.equal(center.db.prepare('SELECT COUNT(*) AS count FROM quota_codes').get().count, 0);
});

test('package-specific HTTP info and intents accept only server-defined selections and exclude cash checkout', async t => {
  const parent = path.resolve(tmpdir()), root = await mkdtemp(path.join(parent, 'opcpay-http-'));
  await mkdir(path.join(root, 'local'));
  const center = await startCenter({ root, port: 0,
    config: { port: 0, adminPassword: 'http-multi-private-admin', merchantKey: 'http-multi-private-encryption-secret' } });
  t.after(async () => { await center.close(); assert.equal(path.dirname(path.resolve(root)), parent); assert.match(path.basename(root), /^opcpay-http-/); await rm(root, { recursive: true, force: true }); });
  const origin = `http://127.0.0.1:${center.server.address().port}`;
  let cookie;
  async function request(route, body) {
    const response = await fetch(origin + route, { method: body === undefined ? 'GET' : 'POST',
      headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const value = { status: response.status, data: await response.json() };
    cookie ??= response.headers.get('set-cookie')?.split(';')[0]; return value;
  }
  await request('/api/opcpay/buyer', {});
  for (const [packageId, priceCents, quota] of [['week', 2990, {text:30,image:45,video:6}], ['month',9900,{text:100,image:150,video:20}]]) {
    const info = await request('/api/opcpay/info?package=' + packageId);
    assert.equal(info.status, 200); assert.equal(info.data.package.packageId, packageId);
    assert.equal(info.data.package.priceCents, priceCents); assert.deepEqual(info.data.package.quota, quota);
    assert.equal(info.data.ready, false);
    assert.equal((await request('/api/opcpay/intents', { requestId: 'unconfigured-' + packageId, packageId })).status, 503);
    assert.equal((await request('/api/shop/orders', { productId: 'dingxiaosui-opcpay-' + packageId, email: 'test@example.test' })).status, 409);
    for (const extra of [{priceCents:1}, {quota:{text:999}}, {userId:'victim'}, {skuId:'other'}, {profileId:'trial'}]) {
      assert.equal((await request('/api/opcpay/intents', { requestId: 'tampered-' + packageId, packageId, ...extra })).status, 400);
    }
  }
  assert.equal((await request('/api/opcpay/info?package=season')).status, 400);
  assert.equal((await request('/api/opcpay/info')).data.package.packageId, 'trial');
  assert.equal(center.db.prepare('SELECT COUNT(*) AS count FROM opcpay_intents').get().count, 0);
  assert.equal(center.db.prepare('SELECT COUNT(*) AS count FROM shop_orders').get().count, 0);
});
