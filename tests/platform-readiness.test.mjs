import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createQuota } from '../sidecar/quota.mjs';
import { createChannels } from '../sidecar/channels.mjs';
import { createPlatforms } from '../sidecar/platforms.mjs';
import { createGeneration } from '../sidecar/generation.mjs';

test('a disabled video route keeps the healthy text capability usable without exposing routing', async t => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const quota = createQuota(db), channels = createChannels(db, { secret: 'platform-readiness-test-secret' });
  const textChannel = { id: 'text-relay', name: '文案渠道', baseUrl: 'https://text.example/v1', apiKey: 'test-only-text-key', models: [{ id: 'text-model', capability: 'text' }] };
  const videoChannel = { id: 'video-relay', name: '视频渠道', baseUrl: 'https://video.example/v1', apiKey: 'test-only-video-key', models: [{ id: 'video-model', capability: 'video' }] };
  channels.saveChannel(textChannel); channels.saveChannel(videoChannel);
  const platforms = createPlatforms(db, { quota, channels });
  platforms.savePlatform({ id: 'studio', name: '创作平台', bindings: [
    { capability: 'text', channelId: textChannel.id, model: 'text-model' },
    { capability: 'video', channelId: videoChannel.id, model: 'video-model' },
  ] });
  channels.saveChannel({ ...videoChannel, enabled: false });
  const publicPlatform = platforms.getPlatform('studio', { public: true });
  assert.equal(publicPlatform.ready, false);
  assert.equal(publicPlatform.readiness, 'channel-unavailable');
  assert.deepEqual(publicPlatform.availableCapabilities, ['text']);
  assert.deepEqual(publicPlatform.capabilities, ['text', 'video']);
  assert.equal('bindings' in publicPlatform, false);
  assert.doesNotMatch(JSON.stringify(publicPlatform), /text-relay|video-relay|text-model|video-model|test-only/);

  const code = quota.generateCodes({ projectId: 'studio', quantity: 1, units: 1, quota: { text: 1, image: 0, video: 0 } }).codes[0];
  quota.redeem({ projectId: 'studio', userId: 'test-user', code });
  let calls = 0;
  const generation = createGeneration(db, { quota, channels, platforms, fetchImpl: async () => {
    calls++;
    return new Response(JSON.stringify({ choices: [{ message: { content: '文案正常生成' } }] }), { headers: { 'content-type': 'application/json' } });
  } });
  const result = await generation.execute({ projectId: 'studio', userId: 'test-user', requestId: 'text-request', capability: 'text', prompt: '生成文案' });
  assert.equal(result.status, 'succeeded');
  assert.equal(calls, 1);
  assert.equal(quota.balance({ projectId: 'studio', userId: 'test-user' }).byCapability.text.consumed, 1);

  platforms.savePlatform({ id: 'studio', enabled: false });
  assert.deepEqual(platforms.getPlatform('studio', { public: true }).availableCapabilities, []);
  assert.equal(platforms.getPlatform('studio').ready, false);
});
