import assert from 'node:assert/strict';
import net from 'node:net';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { test } from 'node:test';
import { startCenter } from '../sidecar/server.mjs';
import { epaySign } from '../sidecar/payments.mjs';
import { createUsageClient } from '../sdk/client.mjs';

test('HTTP combination purchase → signed payment → one code → APIMart image, three texts and video exhaust only their own quotas', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'quota-combination-flow-'));
  await mkdir(path.join(root, 'local'));
  const probe = net.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const counts = { text: 0, image: 0, video: 0, polls: 0 };
  const fetchImpl = async (address, init) => {
    assert.equal(init.headers.Authorization, 'Bearer simulated-apimart-secret');
    if (address.endsWith('/chat/completions')) {
      counts.text++; return Response.json({ choices: [{ message: { content: `模拟丁小穗文案 ${counts.text}` } }] });
    }
    if (address.endsWith('/images/generations')) {
      counts.image++; return Response.json({ code: 200, data: [{ task_id: 'image-task', status: 'submitted' }] });
    }
    if (address.endsWith('/videos/generations')) {
      counts.video++; return Response.json({ code: 200, data: [{ task_id: 'video-task', status: 'submitted' }] });
    }
    counts.polls++;
    if (address.endsWith('/tasks/image-task')) return Response.json({ code: 200, data: { id: 'image-task', status: 'completed', result: { images: [{ url: ['https://upload.apimart.ai/isolated-image.png'] }] } } });
    if (address.endsWith('/tasks/video-task')) return Response.json({ code: 200, data: { id: 'video-task', status: 'completed', result: { videos: [{ url: ['https://upload.apimart.ai/isolated-video.mp4'] }] } } });
    throw new Error('Unexpected isolated upstream request');
  };
  const center = await startCenter({ root, port, config: { port, adminPassword: 'isolated-test-admin', merchantKey: 'isolated-combination-storage-key' }, generationOptions: { fetchImpl } });
  t.after(async () => {
    await center.close();
    assert.equal(path.dirname(root), path.resolve(tmpdir())); assert.match(path.basename(root), /^quota-combination-flow-/);
    await rm(root, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  async function request(route, data, cookie) {
    const response = await fetch(baseUrl + route, { method: data === undefined ? 'GET' : 'POST',
      headers: { ...(data === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    const body = await response.text(); let result; try { result = JSON.parse(body); } catch { /* Notify is plain text. */ }
    return { status: response.status, data: result, body, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  const admin = (await request('/api/admin/login', { password: 'isolated-test-admin' })).cookie;
  const models = [{ capability: 'text', id: 'deepseek-v4.1-flash' }, { capability: 'image', id: 'gpt-image-2.5-flare' }, { capability: 'video', id: 'seedance-2.0-mini' }];
  assert.equal((await request('/api/admin/channels', { id: 'apimart', name: '隔离模拟 APIMart', protocol: 'apimart', baseUrl: 'https://api.apimart.ai/v1', apiKey: 'simulated-apimart-secret', models }, admin)).status, 200);
  assert.equal((await request('/api/admin/platforms', { id: 'dingxiaosui', name: '丁小穗隔离测试', bindings: models.map(model => ({ capability: model.capability, channelId: 'apimart', model: model.id })) }, admin)).status, 200);
  const allocation = { text: 3, image: 1, video: 1 };
  const saved = await request('/api/admin/products', { id: 'dings-combo', projectId: 'dingxiaosui', name: '创作组合', units: 5, priceCents: 1290,
    fulfillment: 'on_payment', packageOptions: [{ id: 'combo', label: '图片1 文案3 视频1', quota: allocation, priceCents: 1290 }],
    quotaPricing: { enabled: true, unitPriceMicros: { text: 100000, image: 200000, video: 500000 }, maxCounts: { text: 100, image: 100, video: 100 } } }, admin);
  assert.equal(saved.status, 200, saved.body);
  assert.equal((await request('/api/admin/payment-settings', { mode: 'epay', gatewayUrl: 'https://pay.example', publicBaseUrl: 'https://store.example', merchantId: 'isolated-merchant', apiKey: 'isolated-payment-key', enabledMethods: ['wxpay'] }, admin)).status, 200);
  const created = await request('/api/shop/orders', { productId: 'dings-combo', customQuota: allocation, email: 'isolated@example.com', priceCents: 1 });
  assert.equal(created.status, 201, created.body); const order = created.data;
  assert.equal(order.priceCents, 100); assert.equal(order.inventoryId, null); assert.deepEqual(order.quota, allocation);
  assert.equal((await request('/api/admin/state', undefined, admin)).data.codes.filter(code => code.projectId === 'dingxiaosui').length, 0);
  assert.equal((await request(`/api/shop/orders/${order.id}/pay?token=${order.token}`, {})).status, 200);
  const notification = { pid: 'isolated-merchant', out_trade_no: order.orderNo, trade_no: 'SIMULATED-NO-REAL-PAYMENT', type: 'wxpay', money: '1.00', trade_status: 'TRADE_SUCCESS' };
  notification.sign = epaySign(notification, 'isolated-payment-key'); notification.sign_type = 'MD5';
  const notifyRoute = `/api/payment/notify?${new URLSearchParams(notification)}`;
  assert.equal((await request(notifyRoute)).body, 'success');
  assert.equal((await request(notifyRoute)).body, 'success');
  const delivered = (await request(`/api/shop/orders/${order.id}?token=${order.token}`)).data;
  assert.equal(delivered.status, 'fulfilled'); assert.ok(delivered.code);
  assert.equal((await request(`/api/shop/orders/${order.id}?token=${order.token}`)).data.code, delivered.code);
  const credential = (await request('/api/admin/platforms/dingxiaosui/credential', {}, admin)).data;
  const client = createUsageClient({ baseUrl, apiKey: credential.apiKey });
  const userId = 'authenticated-isolated-customer';
  const redeemed = await client.redeem({ userId, code: delivered.code });
  assert.deepEqual(redeemed.quota, allocation); assert.equal(redeemed.balance.byCapability.text.available, 3);
  await assert.rejects(client.redeem({ userId, code: delivered.code }), { status: 409 });
  const inputs = new Map();
  for (const [capability, quantity] of Object.entries(allocation)) {
    for (let index = 0; index < quantity; index++) {
      const input = { userId, capability, requestId: `${capability}-${index}`, prompt: `隔离测试 ${capability} ${index}` };
      inputs.set(input.requestId, input);
      const job = await client.generate(input);
      if (capability === 'text') assert.equal(job.status, 'succeeded');
      else {
        assert.equal(job.status, 'running');
        assert.equal((await client.balance(userId)).byCapability[capability].reserved, 1);
        assert.equal((await client.job({ id: job.id, userId })).status, 'succeeded');
      }
      assert.equal((await client.generate(input)).id, job.id);
    }
    await assert.rejects(client.generate({ userId, capability, requestId: `excess-${capability}`, prompt: '超量请求不得调用模型' }), { status: 402 });
  }
  const final = await client.balance(userId);
  assert.equal(final.available, 0); assert.equal(final.reserved, 0); assert.equal(final.consumed, 5);
  for (const capability of ['text', 'image', 'video']) {
    assert.equal(final.byCapability[capability].available, 0);
    assert.equal(final.byCapability[capability].consumed, allocation[capability]);
  }
  assert.deepEqual(counts, { text: 3, image: 1, video: 1, polls: 2 });
  const state = await request('/api/admin/state', undefined, admin);
  assert.equal(state.data.codes.filter(code => code.projectId === 'dingxiaosui').length, 1);
  assert.equal(state.data.generationStats.succeededCount, 5);
  assert.equal(state.body.includes(delivered.code), false);
  assert.equal(state.body.includes('simulated-apimart-secret'), false);
});
