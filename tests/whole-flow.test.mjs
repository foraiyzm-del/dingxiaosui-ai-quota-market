import assert from 'node:assert/strict';
import net from 'node:net';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { test } from 'node:test';
import { startCenter } from '../sidecar/server.mjs';
import { epaySign } from '../sidecar/payments.mjs';
import { createUsageClient } from '../sdk/client.mjs';

test('complete HTTP flow: platform/channel → stocked SKU → signed payment → redemption → text/image/video quota', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'quota-whole-flow-'));
  await mkdir(path.join(root, 'local'));
  const probe = net.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  let calls = 0;
  const mockFetch = async (address, init) => {
    calls++;
    assert.equal(init.headers.Authorization, 'Bearer simulated-relay-key');
    if (address.endsWith('/chat/completions')) return Response.json({ choices: [{ message: { content: '本地测试营销文案结果' } }], usage: { prompt_tokens: 20, completion_tokens: 10 } });
    if (address.endsWith('/images/generations')) return Response.json({ data: [{ b64_json: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' }] });
    if (address.endsWith('/videos')) return Response.json({ id: 'test-video-job', status: 'queued' });
    if (address.endsWith('/videos/test-video-job/content')) return new Response(Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0, 105, 115, 111, 109]), { headers: { 'content-type': 'video/mp4' } });
    if (address.endsWith('/videos/test-video-job')) return Response.json({ id: 'test-video-job', status: 'completed', url: 'https://cdn.example/video.mp4' });
    throw new Error('Unexpected mock endpoint');
  };
  const center = await startCenter({ root, port, config: { port, adminPassword: 'test-admin-password', merchantKey: 'test-merchant-encryption' }, generationOptions: { fetchImpl: mockFetch } });
  t.after(async () => {
    await center.close(); assert.equal(path.dirname(root), path.resolve(tmpdir())); assert.match(path.basename(root), /^quota-whole-flow-/);
    await rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  async function request(route, data, cookie) {
    const res = await fetch(base + route, { method: data === undefined ? 'GET' : 'POST', headers: { ...(data === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    const body = await res.text(); let json; try { json = JSON.parse(body); } catch { /* plain notify acknowledgement */ }
    return { status: res.status, body, data: json, cookie: res.headers.get('set-cookie')?.split(';')[0] };
  }
  const admin = (await request('/api/admin/login', { password: 'test-admin-password' })).cookie;
  assert.ok(admin);
  assert.equal((await request('/api/admin/channels', { id: 'test-relay', name: '隔离模拟中转站', baseUrl: 'https://relay.example/v1', apiKey: 'simulated-relay-key', videoRequestFormat: 'json', models: ['text', 'image', 'video'].map(capability => ({ id: `test-${capability}`, capability, pricing: { perRequestCents: 1 } })) }, admin)).status, 200);
  const platform = { id: 'business', name: '测试业务平台', bindings: ['text', 'image', 'video'].map(capability => ({ channelId: 'test-relay', model: `test-${capability}`, capability })) };
  assert.equal((await request('/api/admin/platforms', platform, admin)).status, 200);
  const publicPlatform = await request('/api/platforms/business');
  assert.equal(publicPlatform.data.ready, true); assert.ok(!publicPlatform.body.includes('test-relay'));
  const portalCookie = publicPlatform.cookie;
  assert.equal((await request('/api/admin/products', { id: 'business-10', projectId: 'business', name: '业务10次', units: 10, priceCents: 990, packageOptions: [{ id: 'ten', label: '10次', units: 10, priceCents: 990 }] }, admin)).status, 200);
  const stock = await request('/api/admin/inventory/generate', { productId: 'business-10', packageId: 'ten', quantity: 2 }, admin);
  assert.equal(stock.status, 201, stock.body);
  assert.ok(!stock.body.includes('QTA-'));
  assert.equal((await request('/api/admin/payment-settings', { mode: 'epay', gatewayUrl: 'https://pay.example', publicBaseUrl: 'https://store.example', merchantId: 'merchant-test', apiKey: 'payment-test-key', enabledMethods: ['wxpay'] }, admin)).status, 200);
  const placed = await request('/api/shop/orders', { productId: 'business-10', packageId: 'ten', email: 'buyer@example.com', priceCents: 1 });
  assert.equal(placed.status, 201, placed.body); const order = placed.data;
  assert.equal(order.priceCents, 990);
  assert.equal((await request(`/api/shop/orders/${order.id}/pay?token=${order.token}`, {})).status, 200);
  const payment = { pid: 'merchant-test', out_trade_no: order.orderNo, trade_no: 'simulated-trade-no-real-money', type: 'wxpay', money: '9.90', trade_status: 'TRADE_SUCCESS' };
  payment.sign = epaySign(payment, 'payment-test-key'); payment.sign_type = 'MD5';
  const callback = await request(`/api/payment/notify?${new URLSearchParams(payment)}`);
  assert.equal(callback.status, 200, callback.body); assert.equal(callback.body, 'success');
  const delivered = (await request(`/api/shop/orders/${order.id}?token=${order.token}`)).data;
  assert.equal(delivered.status, 'fulfilled'); assert.ok(delivered.code);
  const credentials = (await request('/api/admin/platforms/business/credential', {}, admin)).data;
  const client = createUsageClient({ baseUrl: base, apiKey: credentials.apiKey });
  const userId = 'authenticated-real-platform-user';
  await client.redeem({ userId, code: delivered.code });
  assert.equal((await client.balance(userId)).available, 10);
  await assert.rejects(client.redeem({ userId, code: delivered.code }), { status: 409 });
  const text = await client.generate({ userId, requestId: 'first-text', capability: 'text', prompt: '测试营销文案' });
  assert.equal(text.status, 'succeeded'); assert.equal(text.output.text, '本地测试营销文案结果');
  assert.equal((await client.generate({ userId, requestId: 'first-text', capability: 'text', prompt: '测试营销文案' })).id, text.id);
  assert.equal(calls, 1);
  await assert.rejects(client.generate({ userId, requestId: 'first-text', capability: 'text', prompt: '变化后的请求' }), { status: 409 });
  const image = await client.generate({ userId, requestId: 'first-image', capability: 'image', prompt: '测试包装' });
  assert.equal(image.status, 'succeeded'); assert.match(image.output.images[0].dataUrl, /^data:image\/png;base64,/);
  const video = await client.generate({ userId, requestId: 'first-video', capability: 'video', prompt: '测试视频' });
  assert.equal(video.status, 'running'); assert.equal((await client.balance(userId)).reserved, 1);
  const completed = await client.job({ id: video.id, userId }); assert.equal(completed.status, 'ready');
  assert.equal((await client.deliver({ id: video.id, userId, action: 'accept' })).status, 'succeeded');
  const balance = await client.balance(userId);
  assert.equal(balance.available, 7); assert.equal(balance.consumed, 3); assert.equal(balance.reserved, 0);
  // The public portal has its own anonymous identity and cannot inspect another user's jobs.
  assert.equal((await request(`/api/platforms/business/jobs/${text.id}`, undefined, portalCookie)).status, 404);
  const portalBalance = await request('/api/platforms/business/balance', undefined, portalCookie);
  assert.equal(portalBalance.data.available, 0);
  const state = await request('/api/admin/state', undefined, admin);
  assert.ok(!state.body.includes('simulated-relay-key')); assert.ok(!state.body.includes('payment-test-key')); assert.ok(!state.body.includes(delivered.code));
  assert.equal(state.data.generationStats.succeededCount, 3);
  assert.equal(state.data.generationStats.estimatedCostCents, 3);
  assert.equal(state.data.commerceStats.revenueCents, 990);
});
