import assert from 'node:assert/strict';
import { test } from 'node:test';
import net from 'node:net';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { startMultiprojectDemo } from '../scripts/start-multiproject-demo.mjs';
import { createUsageClient } from '../sdk/client.mjs';
import { epaySign } from '../sidecar/payments.mjs';

async function fixture(t) {
  const parent = path.resolve(tmpdir());
  const dataDir = await mkdtemp(path.join(parent, 'quota-multiproject-'));
  let runtime;
  t.after(async () => {
    if (runtime) await runtime.close();
    assert.equal(path.dirname(path.resolve(dataDir)), parent);
    assert.match(path.basename(dataDir), /^quota-multiproject-/);
    await rm(dataDir, { recursive: true, force: true });
  });
  runtime = await startMultiprojectDemo({ dataDir, port: 0 });
  async function request(route, data, { cookie, apiKey } = {}) {
    const response = await fetch(runtime.baseUrl + route, {
      method: data === undefined ? 'GET' : 'POST',
      headers: { origin: runtime.baseUrl, ...(data === undefined ? {} : { 'content-type': 'application/json' }),
        ...(cookie ? { cookie } : {}), ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    const body = await response.text(); let result;
    try { result = JSON.parse(body); } catch { /* Signed notification returns plain text. */ }
    return { status: response.status, body, data: result, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  const login = await request('/api/admin/login', { password: runtime.adminPassword });
  assert.equal(login.status, 200);
  return { get runtime() { return runtime; }, request, admin: { cookie: login.cookie }, dataDir,
    async restart() { await runtime.close(); runtime = await startMultiprojectDemo({ dataDir, port: 0 }); return runtime; } };
}

test('two independent SDK projects: signed HTTP checkout, scoped cards, idempotent typed usage and refunds', async t => {
  const { runtime, request, admin } = await fixture(t);
  const catalog = await request('/api/shop/products');
  assert.equal(catalog.data.payment.simulation, true);
  assert.deepEqual(catalog.data.products.map(item => item.projectId).sort(), ['dingxiaosui', 'second-project']);
  assert.equal((await fetch(runtime.baseUrl + '/shop.js')).status, 200);
  assert.equal((await fetch(runtime.baseUrl + '/platform/second-project')).status, 200);
  for (const projectId of ['dingxiaosui', 'second-project']) {
    const platform = await request(`/api/platforms/${projectId}`);
    assert.equal(platform.data.ready, true);
    assert.deepEqual(platform.data.availableCapabilities, ['text', 'image', 'video']);
    assert.match(platform.data.description, /模拟/);
  }
  const payment = await request('/api/admin/payment-settings', {
    mode: 'epay', gatewayUrl: runtime.baseUrl + '/local-simulated-gateway', publicBaseUrl: runtime.baseUrl,
    merchantId: runtime.payment.merchantId, apiKey: runtime.payment.apiKey, enabledMethods: ['alipay'],
  }, admin);
  assert.equal(payment.status, 200, payment.body);
  const cards = {};
  for (const projectId of ['dingxiaosui', 'second-project']) {
    const placed = await request('/api/shop/orders', { productId: `${projectId}-demo-27`, packageId: 'trial', email: 'local@example.test', priceCents: 1 });
    assert.equal(placed.status, 201, placed.body);
    const order = placed.data;
    assert.equal(order.priceCents, 990);
    assert.deepEqual(order.quota, { text: 10, image: 15, video: 2 });
    const opened = await request(`/api/shop/orders/${order.id}/pay?token=${order.token}`, { method: 'alipay' });
    assert.equal(opened.status, 200, opened.body);
    assert.equal(new URL(opened.data.redirectUrl).origin, runtime.baseUrl);
    const params = { pid: runtime.payment.merchantId, out_trade_no: order.orderNo, trade_no: `LOCAL-SIMULATION-${projectId}`,
      type: 'alipay', money: '9.90', trade_status: 'TRADE_SUCCESS' };
    params.sign = epaySign(params, runtime.payment.apiKey); params.sign_type = 'MD5';
    assert.equal((await request(`/api/payment/notify?${new URLSearchParams({ ...params, sign: '0'.repeat(32) })}`)).status, 403);
    assert.equal((await request(`/api/shop/orders/${order.id}?token=${order.token}`)).data.code, undefined);
    const notify = `/api/payment/notify?${new URLSearchParams(params)}`;
    assert.equal((await request(notify)).body, 'success');
    assert.equal((await request(notify)).body, 'success');
    const delivered = (await request(`/api/shop/orders/${order.id}?token=${order.token}`)).data;
    assert.equal(delivered.status, 'fulfilled'); assert.ok(delivered.code);
    assert.equal(delivered.projectId, projectId);
    cards[projectId] = delivered.code;
  }
  const first = createUsageClient({ baseUrl: runtime.baseUrl, apiKey: runtime.credentials.dingxiaosui.apiKey });
  const second = createUsageClient({ baseUrl: runtime.baseUrl, apiKey: runtime.credentials['second-project'].apiKey });
  const userId = 'same-authenticated-user-in-two-projects';
  assert.notEqual(runtime.credentials.dingxiaosui.apiKey, runtime.credentials['second-project'].apiKey);
  await assert.rejects(second.redeem({ userId, code: cards.dingxiaosui }), { status: 404 });
  assert.equal((await second.balance(userId)).available, 0);
  const redeemed = await first.redeem({ userId, code: cards.dingxiaosui });
  assert.equal(redeemed.balance.available, 27);
  await assert.rejects(first.redeem({ userId, code: cards.dingxiaosui }), { status: 409 });
  assert.equal((await first.redeem({ userId, code: cards.dingxiaosui, idempotent: true })).replayed, true);
  assert.equal((await first.balance(userId)).granted, 27);
  assert.equal((await second.balance(userId)).granted, 0);
  // A signed project credential, not the forged body field, owns the request.
  const forged = await request('/api/v1/redeem', { projectId: 'dingxiaosui', userId, code: cards['second-project'] }, { apiKey: runtime.credentials['second-project'].apiKey });
  assert.equal(forged.status, 200, forged.body);
  assert.equal(forged.data.projectId, 'second-project');
  assert.equal((await second.balance(userId)).available, 27);
  assert.equal((await first.balance(userId)).available, 27);

  for (const [projectId, client] of [['dingxiaosui', first], ['second-project', second]]) {
    for (const capability of ['text', 'image', 'video']) {
      const input = { userId, requestId: `shared-request-${capability}`, capability, prompt: `本地模拟 ${capability}` };
      const simultaneous = await Promise.all([client.generate(input), client.generate(input)]);
      const job = simultaneous[0];
      assert.equal(simultaneous[1].id, job.id);
      let completed = await client.job({ id: job.id, userId });
      if (completed.status === 'ready') completed = await client.deliver({ id: job.id, userId, action: 'accept' });
      assert.equal(completed.status, 'succeeded');
      assert.equal((await client.generate(input)).id, job.id);
      assert.equal((await client.balance(userId)).byCapability[capability].consumed, 1);
      await assert.rejects((projectId === 'dingxiaosui' ? second : first).job({ id: job.id, userId }), { status: 404 });
    }
    const balance = await client.balance(userId);
    assert.equal(balance.available, 24); assert.equal(balance.consumed, 3); assert.equal(balance.reserved, 0);
    assert.equal(balance.byCapability.text.available, 9);
    assert.equal(balance.byCapability.image.available, 14);
    assert.equal(balance.byCapability.video.available, 1);
  }
  const spoofedUse = await request('/api/v1/generate', { projectId: 'dingxiaosui', userId, requestId: 'forged-project', capability: 'text', prompt: '本地模拟项目隔离' }, { apiKey: runtime.credentials['second-project'].apiKey });
  assert.equal(spoofedUse.status, 200); assert.equal(spoofedUse.data.projectId, 'second-project');
  assert.equal((await second.balance(userId)).byCapability.text.consumed, 2);
  assert.equal((await first.balance(userId)).byCapability.text.consumed, 1);
  for (const capability of ['text', 'image', 'video']) {
    const before = await first.balance(userId);
    const input = { userId, requestId: `failure-${capability}`, capability, prompt: '[[FAIL]] 本地明确失败' };
    const failed = await first.generate(input);
    assert.equal(failed.status, 'failed');
    assert.equal((await first.generate(input)).id, failed.id);
    const after = await first.balance(userId);
    assert.equal(after.available, before.available); assert.equal(after.reserved, 0);
    assert.deepEqual(after.byCapability, before.byCapability);
  }
  const state = await request('/api/admin/state', undefined, admin);
  assert.equal(state.data.codes.length, 2);
  assert.equal(state.data.inventory.filter(card => card.status === 'sold').length, 2);
  assert.equal(state.data.commerceStats.revenueCents, 1980); // Local simulation ledger only.
  for (const secret of [runtime.payment.apiKey, ...Object.values(runtime.credentials).map(item => item.apiKey), ...Object.values(cards)]) {
    assert.ok(!state.body.includes(secret)); assert.ok(!catalog.body.includes(secret));
  }
});

test('manual demonstration can approve an order without enabling external payment or model traffic', async t => {
  const { runtime, request, admin, dataDir } = await fixture(t);
  const catalog = await request('/api/shop/products');
  assert.equal(catalog.data.payment.mode, 'manual'); assert.equal(catalog.data.qrConfigured, true);
  const placed = await request('/api/shop/orders', { productId: 'second-project-demo-27', packageId: 'trial', email: 'local@example.test' });
  const order = placed.data;
  const proof = await request(`/api/shop/orders/${order.id}/proof?token=${order.token}`, { reference: 'LOCAL-MANUAL-NO-MONEY', payer: '本地演示', paidAt: new Date().toISOString() });
  assert.equal(proof.status, 200, proof.body);
  const approved = await request(`/api/admin/shop-orders/${order.id}/approve`, { confirmed: true, verifiedReference: 'LOCAL-MANUAL-NO-MONEY', note: '纯模拟核账，没有真实资金' }, admin);
  assert.equal(approved.status, 200, approved.body);
  assert.equal(approved.data.status, 'fulfilled');
  assert.ok((await request(`/api/shop/orders/${order.id}?token=${order.token}`)).data.code);
  const escaped = await request('/api/admin/payment-settings', { mode: 'epay', gatewayUrl: 'https://real-pay.example', publicBaseUrl: 'https://public.example', merchantId: 'x', apiKey: 'x' }, admin);
  assert.equal(escaped.status, 403);
  await assert.rejects(runtime.mock.fetchImpl('https://real-model.example/v1/chat/completions', { method: 'POST' }), /禁止/);
  const privateAccess = await readFile(path.join(dataDir, 'ACCESS.md'), 'utf8');
  assert.ok(privateAccess.includes(runtime.adminPassword));
  assert.equal((await request('/ACCESS.md')).status, 404);
  assert.equal((await request('/local/config.json')).status, 404);
});

test('the isolated demo preserves issued cards and project credentials when restarted', async t => {
  const context = await fixture(t);
  const { runtime, request, admin } = context;
  const order = (await request('/api/shop/orders', { productId: 'dingxiaosui-demo-27', packageId: 'trial', email: 'local@example.test' })).data;
  assert.equal((await request(`/api/admin/shop-orders/${order.id}/approve`, { confirmed: true, verifiedReference: 'LOCAL-RESTART-ONLY', note: '本地模拟核账' }, admin)).status, 200);
  const delivered = (await request(`/api/shop/orders/${order.id}?token=${order.token}`)).data;
  const client = createUsageClient({ baseUrl: runtime.baseUrl, apiKey: runtime.credentials.dingxiaosui.apiKey });
  await client.redeem({ userId: 'persistent-user', code: delivered.code });
  const restored = await context.restart();
  assert.equal(restored.credentials.dingxiaosui.apiKey, runtime.credentials.dingxiaosui.apiKey);
  assert.equal((await request(`/api/shop/orders/${order.id}?token=${order.token}`)).data.code, delivered.code);
  const resumedClient = createUsageClient({ baseUrl: restored.baseUrl, apiKey: restored.credentials.dingxiaosui.apiKey });
  assert.equal((await resumedClient.balance('persistent-user')).available, 27);
  assert.equal((await request('/api/shop/products')).data.products.length, 2);
});

test('an occupied demo port is refused before data writes and its existing listener remains untouched', async t => {
  const parent = path.resolve(tmpdir()); const directory = await mkdtemp(path.join(parent, 'quota-multiproject-port-'));
  const dataDir = path.join(directory, 'must-not-exist');
  const listener = net.createServer(); let connections = 0;
  listener.on('connection', socket => { connections++; socket.end(); });
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => listener.close(resolve));
    assert.equal(path.dirname(path.resolve(directory)), parent); assert.match(path.basename(directory), /^quota-multiproject-port-/);
    await rm(directory, { recursive: true, force: true });
  });
  await assert.rejects(startMultiprojectDemo({ dataDir, port: listener.address().port }), /已占用/);
  await assert.rejects(stat(dataDir), { code: 'ENOENT' });
  assert.equal(listener.listening, true); assert.equal(connections, 0);
});
