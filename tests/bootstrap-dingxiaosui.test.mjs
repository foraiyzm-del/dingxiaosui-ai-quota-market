import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import net from 'node:net';
import { startCenter } from '../sidecar/server.mjs';
import { bootstrapDingxiaosui } from '../scripts/bootstrap-dingxiaosui.mjs';

async function unusedPort() {
  const probe = net.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  return port;
}

for (const platformMode of ['entry', 'missing']) test(`${platformMode === 'entry' ? 'four-entry clone connects its pristine Ding entry' : 'bootstrap creates a missing Ding platform'} without provider calls, cards or revenue`, async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'quota-bootstrap-test-'));
  await mkdir(path.join(root, 'local'));
  const port = await unusedPort();
  let providerCalls = 0;
  const center = await startCenter({
    root, port, config: { port, adminPassword: 'fixture-admin-password', merchantKey: 'fixture-storage-key' },
    generationOptions: { fetchImpl: async () => { providerCalls++; throw new Error('Provider traffic must not occur in bootstrap'); } },
  });
  t.after(async () => {
    await center.close();
    const absolute = path.resolve(root);
    assert.equal(path.dirname(absolute), path.resolve(tmpdir()));
    assert.match(path.basename(absolute), /^quota-bootstrap-test-/);
    await rm(absolute, { recursive: true, force: true });
  });
  const options = { baseUrl: `http://127.0.0.1:${port}`, adminPassword: 'fixture-admin-password' };
  if (platformMode === 'missing') center.db.prepare('DELETE FROM service_platforms WHERE id=?').run('dingxiaosui');
  const first = await bootstrapDingxiaosui(options);
  assert.equal(first.createdPlatform, platformMode === 'missing');
  assert.equal(first.createdProduct, true);
  assert.equal(center.platforms.getPlatform('dingxiaosui').url,'http://127.0.0.1:8845/workbench.html');
  assert.match(first.apiKey, /^[a-f0-9]{64}$/);
  const stored = JSON.parse(await readFile(path.join(root, 'local/project-keys.json'), 'utf8'));
  assert.equal(first.apiKey, stored.dingxiaosui);
  assert.deepEqual(center.platforms.getPlatform('dingxiaosui').bindings, []);
  const product = center.commerce.listProducts({ admin: true }).find(row => row.id === 'dingxiaosui-creator');
  assert.equal(product.active, false);
  assert.equal(product.fulfillment, 'on_payment');
  assert.deepEqual(product.packageOptions[0].quota, { text: 3, image: 1, video: 1 });
  assert.equal(product.quotaPricing.enabled, true);
  assert.equal(center.quota.stats().codeCount, 0);
  assert.equal(center.commerce.stats().orderCount, 0);
  assert.equal(center.commerce.stats().revenueCents, 0);
  assert.equal(providerCalls, 0);

  center.platforms.savePlatform({ ...center.platforms.getPlatform('dingxiaosui'), name: 'Developer custom name', url: 'https://example.test/workbench.html', enabled: false });
  center.commerce.saveProduct({ ...product, name: 'Developer custom product', priceCents: 900, active: false });
  const second = await bootstrapDingxiaosui(options);
  assert.equal(second.apiKey, first.apiKey);
  assert.equal(second.createdPlatform, false);
  assert.equal(second.createdProduct, false);
  assert.equal(center.platforms.getPlatform('dingxiaosui').name, 'Developer custom name');
  assert.equal(center.platforms.getPlatform('dingxiaosui').enabled, false);
  assert.equal(center.commerce.listProducts({ admin: true }).find(row => row.id === product.id).priceCents, 900);
  assert.equal(center.db.prepare('SELECT COUNT(*) AS count FROM web_sessions').get().count, 0);
  assert.equal(providerCalls, 0);
});

test('local bootstrap refuses remote endpoints before transmitting administrator credentials', async () => {
  let calls = 0;
  for (const baseUrl of ['https://example.com', 'http://user:pass@127.0.0.1:3199', 'http://127.0.0.1:3199/path', 'http://127.0.0.1:3199/?key=x']) {
    await assert.rejects(bootstrapDingxiaosui({ baseUrl, adminPassword: 'fixture-password', fetchImpl: async () => { calls++; throw Error(); } }));
  }
  assert.equal(calls, 0);
});
