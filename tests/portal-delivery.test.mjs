import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startCenter } from '../sidecar/server.mjs';

test('portal video delivery is scoped to the cookie and project, and owner confirmation settles once', async t => {
  const parent = path.resolve(tmpdir());
  const root = await mkdtemp(path.join(parent, 'portal-delivery-'));
  await mkdir(path.join(root, 'local'));
  let generationRequests = 0;
  const center = await startCenter({ root, port: 0,
    config: { port: 0, adminPassword: 'isolated-portal-admin', merchantKey: 'isolated-portal-delivery-secret' },
    generationOptions: { fetchImpl: async (address, init) => {
      if (String(address).endsWith('/videos') && init.method === 'POST') {
        generationRequests++;
        return Response.json({ id: `video-${generationRequests}`, status: 'completed', video_url: 'https://media.example/clip.mp4' });
      }
      assert.match(String(address), /^https:\/\/provider\.example\/v1\/videos\/video-\d+\/content$/u);
      return new Response(Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0, 105, 115, 111, 109]), { headers: { 'content-type': 'video/mp4' } });
    } },
  });
  t.after(async () => {
    await center.close();
    assert.equal(path.dirname(path.resolve(root)), parent); assert.match(path.basename(root), /^portal-delivery-/u);
    await rm(root, { recursive: true, force: true });
  });
  center.channels.saveChannel({ id: 'video', name: '模拟视频', baseUrl: 'https://provider.example/v1', apiKey: 'not-real',
    videoRequestFormat: 'json', models: [{ id: 'isolated-video', capability: 'video' }] });
  for (const id of ['project-a', 'project-b']) center.platforms.savePlatform({ id, name: id,
    bindings: [{ capability: 'video', channelId: 'video', model: 'isolated-video' }] });
  const origin = `http://127.0.0.1:${center.server.address().port}`;
  async function request(route, body, cookie, requestOrigin = origin) {
    const response = await fetch(origin + route, { method: body === undefined ? 'GET' : 'POST',
      headers: { origin: requestOrigin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  const owner = (await request('/api/platforms/project-a/balance')).cookie;
  const stranger = (await request('/api/platforms/project-a/balance')).cookie;
  assert.notEqual(owner, stranger);
  const code = center.quota.generateCodes({ projectId: 'project-a', quantity: 1, quota: { video: 3 } }).codes[0];
  assert.equal((await request('/api/platforms/project-a/redeem', { code }, owner)).status, 200);
  const first = await request('/api/platforms/project-a/generate', { requestId: 'video-1', capability: 'video', prompt: 'isolated video' }, owner);
  assert.equal(first.status, 200); assert.equal(first.data.status, 'ready');
  const route = `/api/platforms/project-a/jobs/${first.data.id}/delivery`;
  assert.equal((await request(route, { action: 'accept', userId: first.data.userId, projectId: 'project-a' }, stranger)).status, 404);
  assert.equal((await request(`/api/platforms/project-b/jobs/${first.data.id}/delivery`, { action: 'accept', userId: first.data.userId, projectId: 'project-a' }, owner)).status, 404);
  assert.equal((await request(route, { action: 'accept' }, owner, 'https://attacker.example')).status, 403);
  assert.equal((await request(route, { action: 'invalid' }, owner)).status, 400);
  let balance = (await request('/api/platforms/project-a/balance', undefined, owner)).data;
  assert.equal(balance.consumed, 0); assert.equal(balance.reserved, 1);
  const deliveries = await Promise.all(Array.from({ length: 3 }, () => request(route,
    { action: 'accept', userId: 'forged-user', projectId: 'project-b' }, owner)));
  assert.ok(deliveries.every(result => result.status === 200 && result.data.status === 'succeeded'), JSON.stringify(deliveries));
  balance = (await request('/api/platforms/project-a/balance', undefined, owner)).data;
  assert.equal(balance.consumed, 1); assert.equal(balance.reserved, 0); assert.equal(balance.available, 2);
  assert.equal((await request(route, { action: 'reject' }, owner)).status, 400);
  assert.equal(generationRequests, 1);

  const second = await request('/api/platforms/project-a/generate', { requestId: 'video-2', capability: 'video', prompt: 'another isolated video' }, owner);
  assert.equal(second.data.status, 'ready');
  const rejectRoute = `/api/platforms/project-a/jobs/${second.data.id}/delivery`;
  assert.equal((await request(rejectRoute, { action: 'reject', reason: '结果不可用' }, owner)).status, 400);
  assert.equal((await request(rejectRoute, { action: 'reject' }, owner)).status, 400);
  balance = (await request('/api/platforms/project-a/balance', undefined, owner)).data;
  assert.equal(balance.consumed, 1); assert.equal(balance.reserved, 1); assert.equal(balance.available, 1);
  assert.equal((await request(rejectRoute, { action: 'accept' }, owner)).data.status, 'succeeded');
  balance = (await request('/api/platforms/project-a/balance', undefined, owner)).data;
  assert.equal(balance.consumed, 2); assert.equal(balance.reserved, 0); assert.equal(balance.available, 1);
  assert.equal(generationRequests, 2);
});
