import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createChannels } from '../sidecar/channels.mjs';
import { createGeneration } from '../sidecar/generation.mjs';
import { LEADER_PROFILE } from '../sidecar/model-tiers.mjs';
import { createPlatforms } from '../sidecar/platforms.mjs';
import { createQuota } from '../sidecar/quota.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

test('50 leader-card users can redeem and each receive a clear text, image and video outcome', async t => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const quota = createQuota(db);
  const channels = createChannels(db, { secret: 'load-test-channel-secret' });
  channels.saveChannel({ id: 'relay', name: '压测中转', protocol: 'apimart', baseUrl: 'https://api.apimart.ai/v1', apiKey: 'load-test-key', timeoutMs: 5000,
    models: [{ id: 'deepseek-v4.1-flash', capability: 'text' }, { id: 'claude-sonnet-5-5', capability: 'text' },
      { id: 'gpt-image-2.5-flare', capability: 'image' }, { id: 'seedance-2.0-mini', capability: 'video' },
      { id: 'seedance-2.5', capability: 'video' }, { id: 'seedance-2.0', capability: 'video' }] });
  const platforms = createPlatforms(db, { quota, channels });
  platforms.savePlatform({ id: 'dingxiaosui', name: '丁小穗', unitsPerUse: 1, bindings: [
    { capability: 'text', channelId: 'relay', model: 'deepseek-v4.1-flash' },
    { capability: 'image', channelId: 'relay', model: 'gpt-image-2.5-flare' },
    { capability: 'video', channelId: 'relay', model: 'seedance-2.0-mini' },
  ] });
  const calls = [];
  const generation = createGeneration(db, { quota, channels, platforms, fetchImpl: async (url, init) => {
    if (!init.body) {
      if (String(url).includes('/f/image/')) return new Response(png, { headers: { 'content-type': 'image/png' } });
      const id = String(url).split('/').pop();
      return json({ code: 200, data: { id, status: 'completed', progress: 100, result: { videos: [{ url: ['https://upload.apimart.ai/f/video/load.mp4'] }] } } });
    }
    const body = JSON.parse(init.body);
    const marker = body.prompt || (Array.isArray(body.messages) ? body.messages.map(message => message.content).join('\n') : '');
    calls.push({ url, model: body.model, method: init.method, marker: String(marker).slice(0, 40) });
    if (marker.startsWith('timeout')) throw Object.assign(new Error('upstream timed out'), { name: 'TimeoutError' });
    if (marker.startsWith('busy')) return json({ error: 'upstream' }, 503);
    if (marker.startsWith('image-fail')) return json({ error: 'rejected' }, 400);
    if (marker.startsWith('video-fail') && body.model === 'seedance-2.5') return json({ code: 200, data: [{ task_id: `fail-${marker}`, status: 'failed' }] });
    if (body.model === 'claude-sonnet-5-5' || body.model === 'deepseek-v4.1-flash') {
      await new Promise(resolve => setTimeout(resolve, 15));
      return json({ choices: [{ message: { content: '{"copy":"完成"}' } }] });
    }
    if (body.model === 'gpt-image-2.5-flare') return json({ code: 200, data: [{ task_id: `img-${marker}`, status: 'completed', result: { images: [{ url: ['https://upload.apimart.ai/f/image/load.png'] }] } }] });
    await new Promise(resolve => setTimeout(resolve, marker.startsWith('slow') ? 40 : 5));
    return json({ code: 200, data: [{ task_id: `vid-${marker}`, status: 'submitted' }] });
  } });
  const users = Array.from({ length: 50 }, (_, index) => `leader-${index}`);
  const codes = quota.generateCodes({ projectId: 'dingxiaosui', quantity: 50, quota: { text: 2, image: 2, video: 2 }, mediaSpec: LEADER_PROFILE }).codes;
  await Promise.all(users.map((userId, index) => Promise.resolve(quota.redeem({ projectId: 'dingxiaosui', userId, code: codes[index] }))));
  const mode = index => index < 40 ? 'ok' : index < 44 ? 'timeout' : index < 47 ? 'busy' : index < 49 ? 'image-fail' : 'video-fail';
  const results = await Promise.all(users.map(async (userId, index) => {
    const kind = mode(index);
    const text = await generation.execute({ projectId: 'dingxiaosui', userId, requestId: `${userId}-text`, capability: 'text', prompt: `${kind} 文案`, responseFormat: 'json_object' });
    const image = await generation.execute({ projectId: 'dingxiaosui', userId, requestId: `${userId}-image`, capability: 'image', prompt: `${kind === 'image-fail' ? 'image-fail' : kind} 图片` });
    const videoPrompt = kind === 'video-fail' ? 'video-fail 视频' : index % 7 === 0 ? 'slow 视频' : 'ok 视频';
    const video = await generation.execute({ projectId: 'dingxiaosui', userId, requestId: `${userId}-video`, capability: 'video', prompt: videoPrompt });
    let videoSettled = video;
    if (video.status === 'running') videoSettled = await generation.getJob({ projectId: 'dingxiaosui', userId, id: video.id, refresh: true });
    if (text.status === 'ready') await generation.acceptDelivery({ projectId: 'dingxiaosui', userId, id: text.id });
    if (image.status === 'ready') {
      try { await generation.getContent({ projectId: 'dingxiaosui', userId, id: image.id }); } catch { /* data URLs settle without a second host */ }
      await generation.acceptDelivery({ projectId: 'dingxiaosui', userId, id: image.id });
    }
    const balance = quota.balance({ projectId: 'dingxiaosui', userId });
    return { kind, text: text.status, image: image.status, video: videoSettled.status, balance };
  }));
  assert.equal(results.length, 50);
  for (const result of results) {
    assert.ok(['ready', 'succeeded', 'failed', 'uncertain', 'running'].includes(result.text));
    assert.ok(['succeeded', 'failed', 'uncertain', 'ready', 'running'].includes(result.image));
    assert.ok(['running', 'ready', 'succeeded', 'failed', 'uncertain'].includes(result.video));
    const spent = result.balance.byCapability.text.consumed + result.balance.byCapability.text.reserved
      + result.balance.byCapability.image.consumed + result.balance.byCapability.image.reserved
      + result.balance.byCapability.video.consumed + result.balance.byCapability.video.reserved;
    assert.ok(spent <= 6);
    if (result.kind === 'timeout' || result.kind === 'busy') assert.equal(result.text, 'uncertain');
    if (result.kind === 'image-fail') assert.equal(result.image, 'failed');
    if (result.kind === 'ok') {
      assert.equal(result.balance.byCapability.text.consumed, 1);
      assert.equal(result.balance.byCapability.image.available + result.balance.byCapability.image.consumed + result.balance.byCapability.image.reserved, 2);
    }
  }
  const fallbackPosts = calls.filter(call => call.model === 'seedance-2.0' && call.method !== 'GET');
  assert.deepEqual(fallbackPosts.map(call => call.marker), ['video-fail 视频']);
  assert.equal(results.filter(result => result.kind === 'image-fail').every(result => result.balance.byCapability.image.available === 2), true);
  assert.equal(calls.filter(call => call.model === 'seedance-2.0-mini').length, 0);
});
