import assert from 'node:assert/strict';
import net from 'node:net';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { test } from 'node:test';
import { startCenter } from '../sidecar/server.mjs';
import { createUsageClient } from '../sdk/client.mjs';

test('HTTP employee issuance enforces channel budgets, trusts stored packages and never calls upstream', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'quota-budget-http-'));
  await mkdir(path.join(root, 'local'));
  const probe = net.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  let upstreamCalls = 0;
  const center = await startCenter({ root, port,
    config: { port, adminPassword: 'budget-http-test-password', merchantKey: 'budget-http-test-encryption-secret' },
    generationOptions: { fetchImpl: async () => { upstreamCalls++; throw new Error('Issuance must not call an upstream'); } },
  });
  t.after(async () => { await center.close(); });
  const baseUrl = `http://127.0.0.1:${port}`;
  async function request(route, data, cookie, origin) {
    const response = await fetch(baseUrl + route, { method: data === undefined ? 'GET' : 'POST',
      headers: { ...(data === undefined ? {} : { 'content-type': 'application/json' }),
        ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    const body = await response.text();
    return { status: response.status, data: JSON.parse(body), body,
      cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  const channelId = 'budget-relay', projectId = 'budget-business', productId = 'budget-trial';
  const total = { text: 20, image: 30, video: 4 };
  const allocation = { text: 10, image: 15, video: 2 };
  const generateInput = { productId, packageId: 'trial', quantity: 2, delivery: 'direct' };
  assert.equal((await request('/api/admin/channel-budgets', { channelId, total })).status, 401);
  assert.equal((await request('/api/admin/inventory/generate', generateInput)).status, 401);
  const admin = (await request('/api/admin/login', { password: 'budget-http-test-password' })).cookie;
  assert.ok(admin);
  assert.equal((await request('/api/admin/channel-budgets', { channelId, total }, admin, 'https://untrusted.example')).status, 403);
  assert.equal((await request('/api/admin/inventory/generate', generateInput, admin, 'https://untrusted.example')).status, 403);
  const models = ['text', 'image', 'video'].map(capability => ({ capability, id: `isolated-${capability}` }));
  const channel = await request('/api/admin/channels', { id: channelId, name: '隔离测试渠道',
    baseUrl: 'https://never-call.example/v1', apiKey: 'isolated-budget-channel-key', models }, admin);
  assert.equal(channel.status, 200, channel.body);
  assert.equal(channel.data.issuanceBudget, null);
  const platform = await request('/api/admin/platforms', { id: projectId, name: '隔离测试平台',
    bindings: models.map(model => ({ capability: model.capability, model: model.id, channelId })) }, admin);
  assert.equal(platform.status, 200, platform.body);
  const product = await request('/api/admin/products', { id: productId, projectId, name: '隔离尝鲜卡',
    units: 27, priceCents: 990, fulfillment: 'on_payment',
    packageOptions: [{ id: 'trial', label: '尝鲜卡', quota: allocation, priceCents: 990 }] }, admin);
  assert.equal(product.status, 200, product.body);
  const saved = await request('/api/admin/channel-budgets', { channelId, total }, admin);
  assert.equal(saved.status, 200, saved.body);
  assert.deepEqual(saved.data.total, total);
  assert.deepEqual(saved.data.allocated, { text: 0, image: 0, video: 0 });
  assert.deepEqual(saved.data.remaining, total);
  const initialState = await request('/api/admin/state', undefined, admin);
  assert.deepEqual(initialState.data.channels.find(item => item.id === channelId).issuanceBudget, saved.data);

  // The selected server-side package controls the project and allocation;
  // client supplied routing and quota fields cannot reduce the budget charge.
  const issued = await request('/api/admin/inventory/generate', { ...generateInput,
    projectId: 'demo', quota: { text: 1, image: 0, video: 0 },
    apiBindings: [{ capability: 'text', channelId: 'unbudgeted', model: 'fake' }] }, admin);
  assert.equal(issued.status, 201, issued.body);
  assert.equal(issued.data.projectId, projectId);
  assert.deepEqual(issued.data.quota, allocation);
  assert.equal(issued.data.codes.length, 2);
  assert.equal(new Set(issued.data.codes).size, 2);
  const afterIssue = await request('/api/admin/state', undefined, admin);
  const issuedBudget = afterIssue.data.channels.find(item => item.id === channelId).issuanceBudget;
  assert.deepEqual(issuedBudget.allocated, total);
  assert.deepEqual(issuedBudget.remaining, { text: 0, image: 0, video: 0 });
  assert.equal(afterIssue.data.codes.length, initialState.data.codes.length + 2);
  assert.equal(afterIssue.data.inventory.length, initialState.data.inventory.length);
  assert.equal(afterIssue.data.payments.length, initialState.data.payments.length);
  for (const code of issued.data.codes) assert.equal(afterIssue.body.includes(code), false, 'State and audit must not contain complete activation codes');
  assert.equal(afterIssue.body.includes('isolated-budget-channel-key'), false);
  const audit = afterIssue.data.audit.find(item => item.action === 'inventory.generated');
  assert.ok(audit);
  assert.equal(Object.hasOwn(JSON.parse(audit.detail), 'codes'), false);

  const excess = await request('/api/admin/inventory/generate', { ...generateInput, quantity: 1 }, admin);
  assert.equal(excess.status, 409, excess.body);
  assert.match(excess.data.error, /剩余发码额度不足/);
  const directBypass = await request('/api/admin/codes', { projectId, quantity: 1, units: 27, apiBindings: [] }, admin);
  assert.equal(directBypass.status, 409, directBypass.body);
  const afterRejection = await request('/api/admin/state', undefined, admin);
  assert.equal(afterRejection.data.codes.length, afterIssue.data.codes.length);
  assert.deepEqual(afterRejection.data.channels.find(item => item.id === channelId).issuanceBudget, issuedBudget);

  const credential = await request(`/api/admin/platforms/${projectId}/credential`, {}, admin);
  assert.equal(credential.status, 200, credential.body);
  const client = createUsageClient({ baseUrl, apiKey: credential.data.apiKey });
  const redeemed = await client.redeem({ userId: 'isolated-employee-card-user', code: issued.data.codes[0] });
  assert.deepEqual(redeemed.quota, allocation);
  for (const capability of ['text', 'image', 'video']) {
    assert.equal(redeemed.balance.byCapability[capability].available, allocation[capability]);
    assert.equal(redeemed.balance.byCapability[capability].consumed, 0);
    assert.equal(redeemed.balance.byCapability[capability].reserved, 0);
  }
  const finalState = await request('/api/admin/state', undefined, admin);
  assert.deepEqual(finalState.data.channels.find(item => item.id === channelId).issuanceBudget, issuedBudget);
  assert.equal(finalState.data.generationStats.jobCount, 0);
  assert.equal(upstreamCalls, 0);
  for (const code of issued.data.codes) assert.equal(finalState.body.includes(code), false);
});
