import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startCenter } from '../sidecar/server.mjs';

async function setup(t) {
  const parent = path.resolve(tmpdir());
  const root = await mkdtemp(path.join(parent, 'project-export-'));
  await mkdir(path.join(root, 'local'));
  const center = await startCenter({ root, port: 0,
    config: { port: 0, adminPassword: 'isolated-export-admin', merchantKey: 'isolated-project-export-secret' } });
  t.after(async () => {
    await center.close();
    assert.equal(path.dirname(path.resolve(root)), parent);
    assert.match(path.basename(root), /^project-export-/u);
    await rm(root, { recursive: true, force: true });
  });
  const origin = `http://127.0.0.1:${center.server.address().port}`;
  let cookie;
  async function request(route, data) {
    const response = await fetch(origin + route, { method: data === undefined ? 'GET' : 'POST',
      headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    return { status: response.status, contentType: response.headers.get('content-type'), body: Buffer.from(await response.arrayBuffer()) };
  }
  assert.equal((await request('/api/admin/login', { password: 'isolated-export-admin' })).status, 200);
  assert.equal((await request('/api/admin/site-settings', { dingxiaosuiOrigin: 'https://ding.example/workbench.html' })).status, 200);
  const batches = {};
  for (const projectId of ['dingxiaosui', 'other-project']) {
    assert.equal((await request('/api/admin/platforms', { id: projectId, name: projectId, enabled: true, bindings: [] })).status, 200);
    assert.equal((await request('/api/admin/products', { id: `${projectId}-card`, projectId, name: `${projectId} card`, units: 3, priceCents: 990 })).status, 200);
    const issued = await request('/api/admin/inventory/generate', { productId: `${projectId}-card`, quantity: 1 });
    assert.equal(issued.status, 201); batches[projectId] = JSON.parse(issued.body).batchId;
  }
  const exportBatch = (projectId, format, target) => request('/api/admin/inventory/export?' + new URLSearchParams({
    batchId: batches[projectId], format, ...(target === undefined ? {} : { origin: target }),
  }));
  return { exportBatch, request, batches };
}

test('HTTP batch exports retain Ding origin only for Ding cards and leave other projects unbound', async t => {
  const { exportBatch, request, batches } = await setup(t);
  const dingCsv = await exportBatch('dingxiaosui', 'csv');
  assert.equal(dingCsv.status, 200); assert.match(dingCsv.body.toString(), /https:\/\/ding\.example\/redeem\?code=QTA/u);
  const otherCsv = await exportBatch('other-project', 'csv');
  assert.equal(otherCsv.status, 200); assert.ok(!otherCsv.body.toString().includes('ding.example'));
  assert.ok(otherCsv.body.toString().split('\r\n')[1].endsWith(',"",""'), 'A project without its own origin must have an empty redeem-link column');
  const dingQr = await exportBatch('dingxiaosui', 'qrzip');
  assert.equal(dingQr.status, 200); assert.equal(dingQr.contentType, 'application/zip'); assert.equal(dingQr.body.readUInt32LE(0), 0x04034b50);
  const otherQr = await exportBatch('other-project', 'qrzip');
  assert.equal(otherQr.status, 409); assert.match(JSON.parse(otherQr.body).error, /项目.*兑换|兑换.*项目/u);
  assert.equal((await request(`/api/admin/inventory/export?batchId=${batches['other-project']}`)).status, 200);
});

test('HTTP exports accept an explicit project site and never borrow the legacy Ding address', async t => {
  const { exportBatch } = await setup(t);
  for (const target of ['https://other.example', 'https://other.example/redeem', 'http://127.0.0.1:8848']) {
    const csv = await exportBatch('other-project', 'csv', target);
    assert.equal(csv.status, 200, csv.body.toString());
    assert.ok(csv.body.toString().includes(`${new URL(target).origin}/redeem?code=QTA`));
    assert.ok(!csv.body.toString().includes('ding.example'));
  }
  const zip = await exportBatch('other-project', 'qrzip', 'https://other.example');
  assert.equal(zip.status, 200); assert.equal(zip.body.readUInt32LE(0), 0x04034b50);
  const legacy = await exportBatch('dingxiaosui', 'csv', 'https://ding-override.example/workbench.html');
  assert.equal(legacy.status, 200); assert.ok(legacy.body.toString().includes('https://ding-override.example/redeem?code='));
});

test('HTTP CSV and QR export reject unsafe or misleading explicit destinations', async t => {
  const { exportBatch } = await setup(t);
  for (const target of ['javascript:alert(1)', 'file:///tmp/cards', 'ftp://other.example', '//other.example',
    'https://user:password@other.example', 'https://other.example?forward=elsewhere', 'https://other.example/#fragment',
    'https://other.example/not-the-redeem-route', 'https://other.example/workbench.html', 'https://other.example\\@evil.example']) {
    for (const format of ['csv', 'qrzip']) {
      const result = await exportBatch('other-project', format, target);
      assert.equal(result.status, 400, `${format} should reject ${target}`);
      assert.ok(!result.body.toString().includes('password'));
    }
  }
});
