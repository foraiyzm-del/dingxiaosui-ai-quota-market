import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { createQuota } from '../sidecar/quota.mjs';
import { createChannels } from '../sidecar/channels.mjs';
import { createPlatforms } from '../sidecar/platforms.mjs';
import { createGeneration } from '../sidecar/generation.mjs';
import { fetchOpcpayDemoModel } from '../scripts/opcpay-demo-model.mjs';

test('OPC demo video downloads the local MP4 and confirms delivery exactly once', async t => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const quota = createQuota(db);
  const channels = createChannels(db, { secret: 'opcpay-demo-model-test-secret' });
  channels.saveChannel({ id: 'opcpay-demo-model', name: '模拟模型', baseUrl: 'https://mock-model.invalid/v1',
    apiKey: 'mock-model-only', enabled: true, models: [{ id: 'mock-video', capability: 'video' }] });
  const platforms = createPlatforms(db, { quota, channels });
  platforms.savePlatform({ id: 'dingxiaosui', name: '丁小穗', enabled: true,
    bindings: [{ capability: 'video', model: 'mock-video', channelId: 'opcpay-demo-model' }] });
  const identity = { projectId: 'dingxiaosui', userId: 'local-video-buyer' };
  const issued = quota.generateCodes({ projectId: identity.projectId, quantity: 1, quota: { text: 10, image: 15, video: 2 } });
  quota.redeem({ ...identity, code: issued.codes[0] });
  const generation = createGeneration(db, { quota, channels, platforms, fetchImpl: fetchOpcpayDemoModel });
  const job = await generation.execute({ ...identity, requestId: 'demo-video-delivery', capability: 'video', prompt: '本地视频交付验收' });
  assert.equal(job.status, 'ready');
  const content = await generation.getContent({ ...identity, id: job.id });
  assert.equal(content.contentType, 'video/mp4');
  assert.deepEqual(content.body, await readFile(new URL('../public/assets/mock-video.mp4', import.meta.url)));
  assert.ok(content.body.length > 1000, 'must return the complete sample, not an MP4 header placeholder');
  assert.equal(quota.balance(identity).byCapability.video.reserved, 1);
  assert.equal((await generation.acceptDelivery({ ...identity, id: job.id })).status, 'succeeded');
  assert.equal((await generation.acceptDelivery({ ...identity, id: job.id })).status, 'succeeded');
  const balance = quota.balance(identity).byCapability;
  assert.equal(balance.video.available, 1);
  assert.equal(balance.video.consumed, 1);
  assert.equal(balance.video.reserved, 0);
  assert.equal(balance.text.available, 10);
  assert.equal(balance.image.available, 15);
});

test('OPC demo transport rejects external and undefined model URLs', async () => {
  for (const url of ['https://example.com/v1/videos', 'http://127.0.0.1/v1/videos',
    'https://mock-model.invalid.evil.example/v1/videos', 'https://mock-model.invalid/v1/unknown']) {
    await assert.rejects(fetchOpcpayDemoModel(url, { method: 'GET' }), /禁止外部模型网络|未定义的本地模拟模型响应/);
  }
});
