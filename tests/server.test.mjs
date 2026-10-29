import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createQuota } from '../sidecar/quota.mjs';
import { epaySign } from '../sidecar/payments.mjs';
import { imageMime } from '../sidecar/image.mjs';
import { startCenter } from '../sidecar/server.mjs';

async function unusedPort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });
  const port = listener.address().port;
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function setup(t) {
  const temporaryParent = path.resolve(tmpdir());
  const root = await mkdtemp(path.join(temporaryParent, 'quota-server-test-'));
  let center;
  t.after(async () => {
    if (center) await center.close();
    // Verify the computed target before recursively deleting this test's root.
    const absoluteRoot = path.resolve(root);
    assert.equal(path.dirname(absoluteRoot), temporaryParent);
    assert.match(path.basename(absoluteRoot), /^quota-server-test-[a-zA-Z0-9]+$/u);
    await rm(absoluteRoot, { recursive: true, force: true });
  });
  await mkdir(path.join(root, 'local'));
  await mkdir(path.join(root, 'public'));
  await writeFile(path.join(root, 'public/index.html'), '<!doctype html><title>Test fixture</title><p>HTTP test fixture</p>');
  const dbPath = path.join(root, 'local/center.sqlite');
  const seedDb = new DatabaseSync(dbPath);
  try {
    const quota = createQuota(seedDb);
    quota.createProject({ id: 'demo', name: 'Demo' });
    quota.createProject({ id: 'writing', name: 'Writing' });
  } finally { seedDb.close(); }
  const projectKeys = { demo: 'test-only-demo-project-key', writing: 'test-only-writing-project-key' };
  await writeFile(path.join(root, 'local/project-keys.json'), JSON.stringify(projectKeys));
  const port = await unusedPort();
  const config = {
    port,
    storePort: 18080,
    adminPassword: 'test-only-admin-password',
    merchantId: 'test-merchant-id',
    merchantKey: 'test-only-merchant-key',
  };
  center = await startCenter({ root, config, port, dbPath });

  function request(route, { method = 'GET', headers = {}, json, body } = {}) {
    const payload = json === undefined ? body : JSON.stringify(json);
    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1', port, path: route, method,
        headers: {
          ...(json === undefined ? {} : { 'content-type': 'application/json' }),
          ...(payload === undefined ? {} : { 'content-length': Buffer.byteLength(payload) }),
          ...headers,
        },
      }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('error', reject);
        res.on('end', () => {
          const bytes = Buffer.concat(chunks);
          const text = bytes.toString();
          let data;
          try { data = JSON.parse(text); } catch { data = undefined; }
          resolve({ status: res.statusCode, headers: res.headers, bytes, text, data });
        });
      });
      req.on('error', reject);
      req.end(payload);
    });
  }

  async function login() {
    const result = await request('/api/admin/login', { method: 'POST', json: { password: config.adminPassword } });
    assert.equal(result.status, 200, result.text);
    const cookie = result.headers['set-cookie']?.[0];
    assert.ok(cookie);
    return cookie.split(';')[0];
  }

  return { center, config, port, projectKeys, request, login, root };
}

test('concurrent platform setup persists all credentials and HTTPS sessions use Secure cookies', async t => {
  const { root, request, login, config } = await setup(t);
  const cookie = await login();
  const platforms = Array.from({ length: 6 }, (_, i) => ({ id: `platform-${i}`, name: `平台${i}`, bindings: [] }));
  const results = await Promise.all(platforms.map(platform => request('/api/admin/platforms', { method: 'POST', headers: { cookie }, json: platform })));
  for (const result of results) assert.equal(result.status, 200, result.text);
  const persisted = JSON.parse(await readFile(path.join(root, 'local/project-keys.json'), 'utf8'));
  for (const platform of platforms) {
    const credential = await request(`/api/admin/platforms/${platform.id}/credential`, { method: 'POST', headers: { cookie }, json: {} });
    assert.equal(credential.status, 200, credential.text);
    assert.equal(credential.data.apiKey, persisted[platform.id]);
  }
  assert.equal((await request('/api/admin/payment-settings', { method: 'POST', headers: { cookie }, json: { publicBaseUrl: 'https://store.example' } })).status, 200);
  const secureLogin = await request('/api/admin/login', { method: 'POST', headers: { host: 'store.example', origin: 'https://store.example' }, json: { password: config.adminPassword } });
  assert.equal(secureLogin.status, 200, secureLogin.text);
  assert.match(secureLogin.headers['set-cookie'][0], /; Secure/);
});

test('API channel HTTP management protects keys and binds SKU generation capabilities', async t => {
  const { center, request, login } = await setup(t);
  const apiKey = 'test-only-relay-secret-PRIVATE-9847';
  const channel = { id: 'relay-one', name: '测试中转站', baseUrl: 'https://relay.example/api/v1/', enabled: true,
    apiKey, models: [{ id: 'text-model', capability: 'text' }, { id: 'video-model', capability: 'video' }] };
  assert.equal((await request('/api/admin/channels')).status, 401);
  assert.equal((await request('/api/admin/channels', { method: 'POST', json: channel })).status, 401);
  const cookie = await login(), headers = { cookie };
  assert.equal((await request('/api/admin/channels', { method: 'POST', headers: { ...headers, origin: 'https://attacker.example' }, json: channel })).status, 403);
  const created = await request('/api/admin/channels', { method: 'POST', headers, json: channel });
  assert.equal(created.status, 200, created.text);
  assert.equal(created.data.baseUrl, 'https://relay.example/api/v1');
  assert.equal(created.data.hasKey, true);
  assert.ok(!created.text.includes(apiKey));
  const encrypted = center.db.prepare('SELECT key_ciphertext FROM api_channels WHERE id=?').get(channel.id).key_ciphertext;
  const changed = await request('/api/admin/channels', { method: 'POST', headers, json: { ...channel, apiKey: '', name: '已更新的中转站' } });
  assert.equal(changed.status, 200, changed.text);
  assert.equal(center.db.prepare('SELECT key_ciphertext FROM api_channels WHERE id=?').get(channel.id).key_ciphertext, encrypted);
  const bindings = [{ capability: 'text', channelId: channel.id, model: 'text-model' }, { capability: 'video', channelId: channel.id, model: 'video-model' }];
  const product = { id: 'combo-product', name: '组合生成', projectId: 'writing', units: 20, priceCents: 1990,
    packageOptions: [{ id: 'standard', label: '文字 + 视频', units: 20, priceCents: 1990, capabilities: ['text', 'video'], apiBindings: bindings }] };
  const saved = await request('/api/admin/products', { method: 'POST', headers, json: product });
  assert.equal(saved.status, 200, saved.text);
  assert.deepEqual(saved.data.packageOptions[0].apiBindings, bindings);
  const publicCatalog = await request('/api/shop/products');
  assert.ok(!publicCatalog.text.includes('apiBindings'));
  assert.ok(!publicCatalog.text.includes('relay-one'));
  center.commerce.generateInventory({ productId: product.id, packageId: 'standard', quantity: 2 });
  const order = await request('/api/shop/orders', { method: 'POST', json: { productId: product.id, packageId: 'standard', email: 'test@example.com' } });
  assert.equal(order.status, 201, order.text);
  assert.deepEqual(order.data.capabilities, ['text', 'video']);
  assert.ok(!order.text.includes('relay-one'));
  const snapshot = center.db.prepare('SELECT api_bindings FROM shop_orders WHERE id=?').get(order.data.id).api_bindings;
  assert.deepEqual(JSON.parse(snapshot), bindings);
  const disabled = await request('/api/admin/channels', { method: 'POST', headers, json: { ...channel, apiKey: undefined, enabled: false } });
  assert.equal(disabled.status, 200, disabled.text);
  assert.equal((await request('/api/shop/orders', { method: 'POST', json: { productId: product.id, packageId: 'standard', email: 'test@example.com' } })).status, 409);
  const existing = await request(`/api/shop/orders/${order.data.id}?token=${order.data.token}`);
  assert.equal(existing.status, 200, existing.text);
  assert.deepEqual(existing.data.capabilities, ['text', 'video']);
  const adminState = await request('/api/admin/state', { headers });
  assert.equal(adminState.data.channels.length, 1);
  assert.ok(!adminState.text.includes(apiKey));
  assert.ok(!JSON.stringify(center.db.prepare('SELECT * FROM center_audit').all()).includes(apiKey));
  assert.equal((await request('/api/health')).data.modelCallsEnabled, false);
});

test('custom package HTTP orders use server pricing and retain the selected units through fulfilment', async (t) => {
  const { center, request, login, projectKeys } = await setup(t);
  const cookie = await login();
  const saved = await request('/api/admin/products', { method: 'POST', headers: { cookie }, json: {
    id: 'custom-package-test', projectId: 'writing', name: '自选次数测试', description: '隔离测试', units: 100, priceCents: 1990, active: true,
    packageOptions: [{ id: 'standard', label: '标准包', units: 100, priceCents: 1990 }, { id: 'large', label: '大额次数包', description: '同一平台的500次套餐', projectId: 'writing', units: 500, priceCents: 9000 }],
    customPricing: { enabled: true, minUnits: 10, maxUnits: 500, unitPriceMicros: 199000 },
  } });
  assert.equal(saved.status, 200, saved.text);
  const products = await request('/api/shop/products');
  const product = products.data.products.find(p => p.id === 'custom-package-test');
  assert.equal(product.packageOptions.length, 2);
  assert.equal(product.customPricing.unitPriceMicros, 199000);
  center.commerce.generateInventory({ productId: product.id, packageId: 'large', quantity: 1 });
  center.commerce.generateInventory({ productId: product.id, units: 137, quantity: 1 });
  const fixed = await request('/api/shop/orders', { method: 'POST', json: { productId: product.id, email: 'package@example.invalid', packageId: 'large', priceCents: 1, units: 1 } });
  assert.equal(fixed.status, 201, fixed.text);
  assert.equal(fixed.data.units, 500);
  assert.equal(fixed.data.priceCents, 9000);
  assert.equal(fixed.data.projectId, 'writing');
  assert.equal(fixed.data.skuId, 'large');
  assert.equal(fixed.data.description, '同一平台的500次套餐');
  const custom = await request('/api/shop/orders', { method: 'POST', json: { productId: product.id, email: 'custom@example.invalid', customUnits: 137, priceCents: 1 } });
  assert.equal(custom.status, 201, custom.text);
  assert.equal(custom.data.units, 137);
  assert.equal(custom.data.priceCents, 2727);
  assert.equal(custom.data.selectionType, 'custom');
  for (const data of [{customUnits:9},{customUnits:501},{customUnits:10.5},{packageId:'nonexistent'},{packageId:'large',customUnits:137}]) {
    const invalid = await request('/api/shop/orders', { method:'POST', json:{productId:product.id,email:'invalid@example.invalid',...data} });
    assert.ok(invalid.status >= 400 && invalid.status < 500, invalid.text);
  }
  const approved = await request(`/api/admin/shop-orders/${custom.data.id}/approve`, { method:'POST',headers:{cookie},json:{verifiedReference:'TEST-ONLY-CUSTOM-PACKAGE-NO-MONEY',confirmed:true} });
  assert.equal(approved.status,200,approved.text);
  assert.equal(approved.data.status,'fulfilled');
  const delivered = await request(`/api/shop/orders/${custom.data.id}?token=${custom.data.token}`);
  assert.equal(delivered.status,200,delivered.text);
  assert.equal(delivered.data.units,137);
  const redeemed = await request('/api/v1/redeem',{method:'POST',headers:{authorization:`Bearer ${projectKeys.writing}`},json:{userId:'custom-package-test-user',code:delivered.data.code}});
  assert.equal(redeemed.status,200,redeemed.text);
  assert.equal(redeemed.data.balance.available,137);
  assert.equal(center.commerce.listOrders().filter(order=>order.status==='fulfilled').length,1);
  const fixedApproved = await request(`/api/admin/shop-orders/${fixed.data.id}/approve`, { method:'POST',headers:{cookie},json:{verifiedReference:'TEST-ONLY-SKU-PROJECT-NO-MONEY',confirmed:true} });
  assert.equal(fixedApproved.status,200,fixedApproved.text);
  assert.equal(fixedApproved.data.status,'fulfilled');
  const fixedDelivered = await request(`/api/shop/orders/${fixed.data.id}?token=${fixed.data.token}`);
  const wrongService = await request('/api/v1/redeem',{method:'POST',headers:{authorization:`Bearer ${projectKeys.demo}`},json:{userId:'sku-project-test-user',code:fixedDelivered.data.code}});
  assert.equal(wrongService.status,404,wrongService.text);
  const correctService = await request('/api/v1/redeem',{method:'POST',headers:{authorization:`Bearer ${projectKeys.writing}`},json:{userId:'sku-project-test-user',code:fixedDelivered.data.code}});
  assert.equal(correctService.status,200,correctService.text);
  assert.equal(correctService.data.balance.available,500);
});

test('HTTP admin authentication, session logout, Host and Origin boundaries', async (t) => {
  const { center, config, port, request, login } = await setup(t);
  assert.equal((await request('/api/admin/state')).status, 401);
  assert.equal((await request('/api/admin/state', { headers: { cookie: 'center_session=forged' } })).status, 401);
  assert.equal((await request('/api/admin/login', { method: 'POST', json: { password: 'wrong' } })).status, 401);
  assert.equal((await request('/api/admin/login', {
    method: 'POST', headers: { origin: 'https://attacker.example' }, json: { password: config.adminPassword },
  })).status, 403);
  assert.equal(center.db.prepare('SELECT COUNT(*) AS count FROM web_sessions').get().count, 0);
  assert.equal((await request('/api/health', { headers: { host: 'attacker.example' } })).status, 403);
  assert.equal((await request('/api/health', { headers: { host: `localhost:${port}` } })).status, 200);
  const cookie = await login();
  const state = await request('/api/admin/state', { headers: { cookie } });
  assert.equal(state.status, 200, state.text);
  assert.equal(state.headers['x-content-type-options'], 'nosniff');
  assert.equal(state.headers['x-frame-options'], 'DENY');
  assert.equal(state.headers['cache-control'], 'no-store');
  assert.equal((await request('/api/admin/codes', {
    method: 'POST', headers: { cookie, origin: 'https://attacker.example' },
    json: { projectId: 'writing', quantity: 1, units: 1 },
  })).status, 403);
  assert.equal(center.quota.listCodes().length, 0);
  assert.equal((await request('/api/admin/logout', { method: 'POST', headers: { cookie }, json: {} })).status, 200);
  assert.equal((await request('/api/admin/state', { headers: { cookie } })).status, 401);
});

test('project credentials bind redemption and settlement to their own project', async (t) => {
  const { center, projectKeys, request } = await setup(t);
  const { codes: [demoCode] } = center.quota.generateCodes({ projectId: 'demo', quantity: 1, units: 2 });
  const { codes: [writingCode] } = center.quota.generateCodes({ projectId: 'writing', quantity: 1, units: 2 });
  assert.equal((await request('/api/v1/balance?userId=alice')).status, 401);
  assert.equal((await request('/api/v1/balance?userId=alice', { headers: { authorization: 'Bearer invalid' } })).status, 401);
  const writingHeaders = { authorization: `Bearer ${projectKeys.writing}` };
  const demoHeaders = { authorization: `Bearer ${projectKeys.demo}` };
  const crossProject = await request('/api/v1/redeem', {
    method: 'POST', headers: writingHeaders, json: { projectId: 'demo', userId: 'alice', code: demoCode },
  });
  assert.equal(crossProject.status, 404, crossProject.text);
  assert.equal(center.quota.balance({ projectId: 'demo', userId: 'alice' }).available, 0);
  const redeemed = await request('/api/v1/redeem', {
    method: 'POST', headers: writingHeaders, json: { projectId: 'demo', userId: 'alice', code: writingCode },
  });
  assert.equal(redeemed.status, 200, redeemed.text);
  assert.equal(redeemed.data.projectId, 'writing');
  const reserved = await request('/api/v1/usage/reserve', {
    method: 'POST', headers: writingHeaders, json: { userId: 'alice', requestId: 'cross-settle', units: 1 },
  });
  assert.equal(reserved.status, 200, reserved.text);
  assert.equal((await request(`/api/v1/usage/${reserved.data.usage.id}/commit`, {
    method: 'POST', headers: demoHeaders, json: {},
  })).status, 404);
  assert.equal(center.quota.balance({ projectId: 'writing', userId: 'alice' }).reserved, 1);
});

test('HTTP reservation retries and settlement retries debit one usage only', async (t) => {
  const { center, projectKeys, request } = await setup(t);
  const { codes: [code] } = center.quota.generateCodes({ projectId: 'writing', quantity: 1, units: 3 });
  center.quota.redeem({ projectId: 'writing', userId: 'alice', code });
  const headers = { authorization: `Bearer ${projectKeys.writing}` };
  const options = { method: 'POST', headers, json: { userId: 'alice', requestId: 'same-http-request', units: 1 } };
  const first = await request('/api/v1/usage/reserve', options);
  const retry = await request('/api/v1/usage/reserve', options);
  assert.equal(first.status, 200, first.text);
  assert.equal(retry.status, 200, retry.text);
  assert.equal(first.data.usage.id, retry.data.usage.id);
  assert.equal(retry.data.balance.available, 2);
  assert.equal(retry.data.balance.reserved, 1);
  assert.equal((await request('/api/v1/usage/reserve', { ...options, json: { ...options.json, units: 2 } })).status, 409);
  const committed = await request(`/api/v1/usage/${first.data.usage.id}/commit`, { method: 'POST', headers, json: {} });
  const committedAgain = await request(`/api/v1/usage/${first.data.usage.id}/commit`, { method: 'POST', headers, json: {} });
  assert.equal(committed.status, 200, committed.text);
  assert.deepEqual(committedAgain.data, committed.data);
  assert.equal(committed.data.balance.consumed, 1);
  assert.equal(committed.data.balance.reserved, 0);
  const after = await request('/api/v1/usage/reserve', options);
  assert.equal(after.data.usage.status, 'committed');
  assert.equal(after.data.balance.available, 2);
  assert.equal(center.quota.listUsage().length, 1);
});

test('demo cookies isolate users and success/cancel settle the expected number of units', async (t) => {
  const { center, request } = await setup(t);
  const initial = await request('/api/demo/balance');
  assert.equal(initial.status, 200, initial.text);
  assert.equal(initial.data.available, 0);
  const cookie = initial.headers['set-cookie'][0].split(';')[0];
  const { codes: [code] } = center.quota.generateCodes({ projectId: 'demo', quantity: 1, units: 2 });
  const redeemed = await request('/api/demo/redeem', { method: 'POST', headers: { cookie }, json: { code } });
  assert.equal(redeemed.status, 200, redeemed.text);
  assert.equal(redeemed.data.balance.available, 2);
  const successOptions = { method: 'POST', headers: { cookie }, json: { action: 'commit', requestId: 'demo-success' } };
  const success = await request('/api/demo/use', successOptions);
  assert.equal(success.status, 200, success.text);
  assert.equal(success.data.balance.available, 1);
  assert.equal(success.data.balance.consumed, 1);
  assert.match(success.data.message, /没有调用真实模型/u);
  const successAgain = await request('/api/demo/use', successOptions);
  assert.equal(successAgain.data.usage.id, success.data.usage.id);
  assert.equal(successAgain.data.balance.consumed, 1);
  const failureOptions = { method: 'POST', headers: { cookie }, json: { action: 'cancel', requestId: 'demo-failure' } };
  const failure = await request('/api/demo/use', failureOptions);
  assert.equal(failure.status, 200, failure.text);
  assert.equal(failure.data.usage.status, 'cancelled');
  assert.equal(failure.data.balance.available, 1);
  assert.equal(failure.data.balance.reserved, 0);
  assert.equal(failure.data.balance.consumed, 1);
  assert.equal((await request('/api/demo/use', failureOptions)).data.balance.available, 1);
  assert.equal((await request('/api/demo/balance')).data.available, 0);
  assert.equal((await request('/api/health')).data.modelCallsEnabled, false);
});

test('claim issues one three-unit demo code per browser and supports the full redeem/use flow', async (t) => {
  const { center, request } = await setup(t);
  const claimed = await request('/api/demo/claim', { method: 'POST', json: {} });
  assert.equal(claimed.status, 201, claimed.text);
  assert.equal(claimed.data.units, 3);
  assert.equal(claimed.data.scope, 'local-demo');
  assert.match(claimed.data.code, /^QTA-[0-9A-F]{36}$/u);
  const cookie = claimed.headers['set-cookie'][0].split(';')[0];
  const claimedAgain = await request('/api/demo/claim', { method: 'POST', headers: { cookie }, json: {} });
  assert.equal(claimedAgain.status, 409, claimedAgain.text);
  assert.equal(center.quota.listCodes().length, 1);
  assert.equal((await request('/api/demo/balance', { headers: { cookie } })).data.available, 0);
  const redeemOptions = { method: 'POST', headers: { cookie }, json: { code: claimed.data.code } };
  const redeemed = await request('/api/demo/redeem', redeemOptions);
  assert.equal(redeemed.status, 200, redeemed.text);
  assert.equal(redeemed.data.balance.available, 3);
  const success = await request('/api/demo/use', {
    method: 'POST', headers: { cookie }, json: { action: 'commit', requestId: 'claimed-demo-success' },
  });
  assert.equal(success.status, 200, success.text);
  assert.equal(success.data.balance.available, 2);
  assert.equal(success.data.balance.consumed, 1);
  const failure = await request('/api/demo/use', {
    method: 'POST', headers: { cookie }, json: { action: 'cancel', requestId: 'claimed-demo-failure' },
  });
  assert.equal(failure.status, 200, failure.text);
  assert.equal(failure.data.balance.available, 2);
  assert.equal(failure.data.balance.reserved, 0);
  assert.equal(failure.data.balance.consumed, 1);
  assert.equal((await request('/api/demo/redeem', redeemOptions)).status, 409);
  assert.equal((await request('/api/demo/balance', { headers: { cookie } })).data.available, 2);
  assert.equal(center.quota.listUsage().length, 2);
});

test('a signed payment can be created but cannot be submitted before a merchant QR is configured', async (t) => {
  const { center, config, request } = await setup(t);
  const payment = {
    pid: config.merchantId, type: 'wxpay', out_trade_no: 'HTTP-ORDER-1', name: '测试套餐', money: '1.00',
    notify_url: 'http://127.0.0.1:18080/api/v1/payments/callback',
    return_url: 'http://127.0.0.1:18080/orders/HTTP-ORDER-1',
  };
  payment.sign = epaySign(payment, config.merchantKey);
  payment.sign_type = 'MD5';
  const created = await request(`/submit.php?${new URLSearchParams(payment)}`);
  assert.equal(created.status, 303, created.text);
  const redirect = new URL(created.headers.location, 'http://127.0.0.1');
  const id = redirect.pathname.split('/').at(-1);
  const token = redirect.searchParams.get('token');
  const info = await request(`/api/payments/${id}?token=${token}`);
  assert.equal(info.status, 200, info.text);
  assert.equal(info.data.qrConfigured, false);
  assert.equal(info.data.state, 'awaiting_payment');
  const submitted = await request(`/api/payments/${id}/submit?token=${token}`, {
    method: 'POST', json: { reference: 'reported-transaction', paidAt: '2026-10-28T19:30:00+08:00' },
  });
  assert.equal(submitted.status, 409, submitted.text);
  assert.equal(center.payments.list()[0].state, 'awaiting_payment');
  assert.equal(center.payments.list()[0].callbackAttempts, 0);
  assert.equal((await request('/payment-qr')).status, 404);
});

test('admin QR upload rejects invalid images and accepts a complete PNG without losing it on invalid replacement', async (t) => {
  const { request, login } = await setup(t);
  const cookie = await login();
  for (const body of [Buffer.alloc(0), Buffer.from('not an image'), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')]) {
    const response = await request('/api/admin/payment-qr', { method: 'POST', headers: { cookie, 'content-type': 'image/png' }, body });
    assert.equal(response.status, 400, response.text);
  }
  for (const [name, body] of [
    ['PNG', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])],
    ['JPEG', Buffer.from([255, 216, 255])],
    ['WebP', Buffer.from([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80])],
  ]) {
    const truncated = await request('/api/admin/payment-qr', {
      method: 'POST', headers: { cookie, 'content-type': 'image/png' }, body,
    });
    assert.equal(truncated.status, 400, `${name} headers without image data must not become a configured merchant QR`);
  }
  assert.equal((await request('/api/health')).data.qrConfigured, false);
  // Complete one-pixel PNG with valid chunk CRCs and compressed pixel data.
  // It is an image fixture, not a real payment QR or a payment verification.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  assert.equal(imageMime(png), 'image/png');
  const uploaded = await request('/api/admin/payment-qr', {
    method: 'POST', headers: { cookie, 'content-type': 'image/png' }, body: png,
  });
  assert.equal(uploaded.status, 200, uploaded.text);
  assert.equal(uploaded.data.ok, true);
  assert.equal((await request('/api/health')).data.qrConfigured, true);
  const displayed = await request('/payment-qr');
  assert.equal(displayed.status, 200);
  assert.equal(displayed.headers['content-type'], 'image/png');
  assert.deepEqual(displayed.bytes, png);
  const invalidReplacement = await request('/api/admin/payment-qr', {
    method: 'POST', headers: { cookie, 'content-type': 'image/png' }, body: png.subarray(0, 8),
  });
  assert.equal(invalidReplacement.status, 400, invalidReplacement.text);
  assert.equal((await request('/api/health')).data.qrConfigured, true);
  assert.deepEqual((await request('/payment-qr')).bytes, png);
});

test('isolated shop simulation completes order, manual approval, one-code delivery and quota settlement over HTTP', async (t) => {
  // setup() creates a fresh temporary database. The fixture PNG and reference
  // below simulate the workflow; no actual payment or model request occurs.
  const { center, projectKeys, request, login } = await setup(t);
  center.commerce.saveProduct({ id: 'test-writing', projectId: 'writing', name: '模拟业务平台', units: 100, priceCents: 1990 });
  center.commerce.generateInventory({ productId: 'test-writing', packageId: 'standard', quantity: 2 });
  const products = await request('/api/shop/products');
  assert.equal(products.status, 200, products.text);
  assert.equal(products.data.qrConfigured, false);
  const product = products.data.products.find((item) => item.projectId === 'writing');
  assert.ok(product);
  const codeCountBefore = center.quota.stats().codeCount;
  const created = await request('/api/shop/orders', {
    method: 'POST', json: { productId: product.id, email: 'isolated-buyer@example.com', priceCents: 1, units: 999999 },
  });
  assert.equal(created.status, 201, created.text);
  const order = created.data;
  assert.equal(order.status, 'pending');
  assert.equal(order.priceCents, product.priceCents);
  assert.equal(order.units, product.units);
  assert.equal(order.qrConfigured, false);
  assert.equal('code' in order, false);
  const orderPath = `/api/shop/orders/${order.id}?token=${order.token}`;
  const proofPath = `/api/shop/orders/${order.id}/proof?token=${order.token}`;
  const proof = { reference: 'TEST-ONLY-CUSTOMER-REPORT', payer: '隔离测试用户', paidAt: '2026-10-28T20:00:00+08:00' };
  assert.equal((await request(proofPath, { method: 'POST', json: proof })).status, 409);
  assert.equal((await request(orderPath)).data.status, 'pending');
  assert.equal(center.quota.stats().codeCount, codeCountBefore);
  assert.equal((await request(`/api/admin/shop-orders/${order.id}/approve`, {
    method: 'POST', json: { confirmed: true, verifiedReference: 'TEST-ONLY-NO-MONEY' },
  })).status, 401);

  const another = await request('/api/shop/orders', {
    method: 'POST', json: { productId: product.id, email: 'isolated-buyer@example.com' },
  });
  assert.equal(another.status, 201, another.text);
  assert.equal((await request(`/api/shop/orders/${order.id}?token=${another.data.token}`)).status, 403);
  const cookie = await login();
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  assert.equal(imageMime(png), 'image/png');
  const qrUploaded = await request('/api/admin/payment-qr', {
    method: 'POST', headers: { cookie, 'content-type': 'image/png' }, body: png,
  });
  assert.equal(qrUploaded.status, 200, qrUploaded.text);
  assert.equal((await request(`/api/shop/orders/${order.id}/proof?token=${another.data.token}`, {
    method: 'POST', json: proof,
  })).status, 403);
  const submitted = await request(proofPath, { method: 'POST', json: proof });
  assert.equal(submitted.status, 200, submitted.text);
  assert.equal(submitted.data.status, 'submitted');
  assert.equal('code' in submitted.data, false);
  assert.equal(center.quota.stats().codeCount, codeCountBefore);
  const approval = {
    method: 'POST', headers: { cookie },
    json: { confirmed: true, verifiedReference: 'TEST-ONLY-NO-MONEY', note: '仅隔离自动化模拟；未发生真实付款' },
  };
  const approved = await request(`/api/admin/shop-orders/${order.id}/approve`, approval);
  assert.equal(approved.status, 200, approved.text);
  assert.equal(approved.data.status, 'fulfilled');
  assert.equal('code' in approved.data, false);
  assert.equal('token' in approved.data, false);
  const delivered = await request(orderPath);
  assert.equal(delivered.status, 200, delivered.text);
  assert.equal(delivered.data.status, 'fulfilled');
  const code = delivered.data.code;
  assert.match(code, /^QTA-[0-9A-F]{36}$/u);
  assert.equal(center.quota.stats().codeCount, codeCountBefore);
  assert.equal((await request(`/api/admin/shop-orders/${order.id}/approve`, approval)).status, 200);
  assert.equal((await request(orderPath)).data.code, code);
  assert.equal(center.quota.stats().codeCount, codeCountBefore);
  const adminState = await request('/api/admin/state', { headers: { cookie } });
  assert.equal(adminState.status, 200, adminState.text);
  assert.equal(adminState.text.includes(code), false);
  assert.equal(adminState.text.includes(order.token), false);

  const headers = { authorization: `Bearer ${projectKeys.writing}` };
  const userId = 'isolated-commerce-buyer';
  const redeem = await request('/api/v1/redeem', { method: 'POST', headers, json: { code, userId } });
  assert.equal(redeem.status, 200, redeem.text);
  assert.equal(redeem.data.balance.available, product.units);
  assert.equal((await request('/api/v1/redeem', { method: 'POST', headers, json: { code, userId } })).status, 409);
  const reserve = await request('/api/v1/usage/reserve', {
    method: 'POST', headers, json: { userId, requestId: 'commerce-success', units: 1 },
  });
  assert.equal(reserve.status, 200, reserve.text);
  assert.equal(reserve.data.balance.available, product.units - 1);
  assert.equal(reserve.data.balance.reserved, 1);
  const commit = await request(`/api/v1/usage/${reserve.data.usage.id}/commit`, { method: 'POST', headers, json: {} });
  assert.equal(commit.status, 200, commit.text);
  assert.equal(commit.data.balance.available, product.units - 1);
  assert.equal(commit.data.balance.reserved, 0);
  assert.equal(commit.data.balance.consumed, 1);
  const reserveFailure = await request('/api/v1/usage/reserve', {
    method: 'POST', headers, json: { userId, requestId: 'commerce-failure', units: 2 },
  });
  assert.equal(reserveFailure.status, 200, reserveFailure.text);
  assert.equal(reserveFailure.data.balance.reserved, 2);
  const cancel = await request(`/api/v1/usage/${reserveFailure.data.usage.id}/cancel`, { method: 'POST', headers, json: {} });
  assert.equal(cancel.status, 200, cancel.text);
  assert.equal(cancel.data.balance.available, product.units - 1);
  assert.equal(cancel.data.balance.reserved, 0);
  assert.equal(cancel.data.balance.consumed, 1);
  const balance = await request(`/api/v1/balance?userId=${userId}`, { headers });
  assert.equal(balance.status, 200, balance.text);
  assert.deepEqual(balance.data, cancel.data.balance);
});
