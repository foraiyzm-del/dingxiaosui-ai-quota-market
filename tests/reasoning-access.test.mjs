import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { textPayload } from '../sidecar/generation-options.mjs';
import { createChannels } from '../sidecar/channels.mjs';
import { createGeneration } from '../sidecar/generation.mjs';
import { LEADER_PROFILE } from '../sidecar/model-tiers.mjs';
import { describeMissingModels, missingLeaderModels, modelIds } from '../sidecar/model-access.mjs';
import { createPlatforms } from '../sidecar/platforms.mjs';
import { createQuota } from '../sidecar/quota.mjs';

const denied = model => new Response(JSON.stringify({ error: { message: `This API key does not have access to model ${model}` } }), { status: 403, headers: { 'content-type': 'application/json' } });
const json = data => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });

function setup(t, fetchImpl) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const quota = createQuota(db);
  const channels = createChannels(db, { secret: 'reasoning-access-test-secret' });
  channels.saveChannel({ id: 'relay', name: '测试', protocol: 'apimart', baseUrl: 'https://api.apimart.ai/v1', apiKey: 'not-a-real-key',
    models: ['claude-sonnet-5-5', 'deepseek-v4.1-flash'].map(id => ({ id, capability: 'text', pricing: id.startsWith('deepseek') ? { inputPerMillionCents: 22.86, outputPerMillionCents: 91.43 } : { inputPerMillionCents: 160, outputPerMillionCents: 800 } }))
      .concat([{ id: 'gpt-image-2.5-flare', capability: 'image' }, { id: 'seedance-2.5', capability: 'video' }, { id: 'seedance-2.0', capability: 'video' }, { id: 'seedance-2.0-mini', capability: 'video' }]) });
  const platforms = createPlatforms(db, { quota, channels });
  platforms.savePlatform({ id: 'dingxiaosui', name: '丁小穗', bindings: [
    { capability: 'text', channelId: 'relay', model: 'deepseek-v4.1-flash' },
    { capability: 'image', channelId: 'relay', model: 'gpt-image-2.5-flare' },
    { capability: 'video', channelId: 'relay', model: 'seedance-2.0-mini' },
  ] });
  const generation = createGeneration(db, { quota, channels, platforms, fetchImpl });
  return { db, quota, generation };
}

test('deepseek thinking is disabled and claude does not request extended thinking', () => {
  const deepseek = textPayload({ prompt: '写一句', capability: 'text' }, 'deepseek-v4.1-flash', 1024);
  assert.equal(deepseek.reasoning_effort, 'none');
  assert.deepEqual(deepseek.thinking, { type: 'disabled' });
  const claude = textPayload({ prompt: '写一句', capability: 'text' }, 'claude-sonnet-5-5', 1024);
  assert.equal(claude.reasoning_effort, 'none');
  assert.equal(claude.thinking, undefined);
  assert.equal(claude.model, 'claude-sonnet-5-5');
});

test('reasoning tokens are billed as output when the gateway reports them separately', async t => {
  const { generation, quota } = setup(t, async () => json({ choices: [{ message: { content: '{"copy":"短"}' } }], usage: { prompt_tokens: 10, completion_tokens: 8, completion_tokens_details: { reasoning_tokens: 92 } } }));
  const code = quota.generateCodes({ projectId: 'dingxiaosui', quantity: 1, units: 5 }).codes[0];
  quota.redeem({ projectId: 'dingxiaosui', userId: 'writer', code });
  const result = await generation.execute({ projectId: 'dingxiaosui', userId: 'writer', requestId: 'reason', capability: 'text', prompt: '写', responseFormat: 'json_object' });
  assert.equal(result.status, 'ready');
  assert.equal(result.tokenUsage.reasoningTokens, 92);
  assert.equal(result.tokenUsage.outputTokens, 100);
  assert.equal(result.tokenUsage.totalTokens, 110);
});

test('a model-permission 403 walks the whole chain without failing the user or charging twice', async t => {
  const calls = [];
  const { db, quota, generation } = setup(t, async (_url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ model: body.model, resolution: body.resolution, reasoning: body.reasoning_effort, thinking: body.thinking?.type });
    if (body.model === 'claude-sonnet-5-5' || body.model === 'seedance-2.5' || body.model === 'seedance-2.0') return denied(body.model);
    if (body.model === 'seedance-2.0-mini' && body.resolution === '720p') return new Response(JSON.stringify({ error: { message: 'unsupported resolution 720p' } }), { status: 400, headers: { 'content-type': 'application/json' } });
    if (body.model === 'seedance-2.0-mini') return json({ code: 200, data: [{ task_id: 'mini-ok', status: 'submitted' }] });
    if (body.model === 'deepseek-v4.1-flash') return json({ choices: [{ message: { content: '{"copy":"降级后的文案"}' } }], usage: { prompt_tokens: 4, completion_tokens: 6 } });
    return json({ error: 'unexpected' }, 500);
  });
  const code = quota.generateCodes({ projectId: 'dingxiaosui', quantity: 1, quota: { text: 2, image: 1, video: 2 }, mediaSpec: LEADER_PROFILE }).codes[0];
  quota.redeem({ projectId: 'dingxiaosui', userId: 'boss', code });
  const text = await generation.execute({ projectId: 'dingxiaosui', userId: 'boss', requestId: 'text', capability: 'text', prompt: '领导文案', responseFormat: 'json_object' });
  assert.equal(text.status, 'ready');
  assert.match(text.output.text, /降级后的文案/);
  assert.equal(calls.filter(call => call.model === 'claude-sonnet-5-5').length, 1);
  assert.equal(calls.filter(call => call.model === 'deepseek-v4.1-flash').length, 1);
  assert.equal(calls.find(call => call.model === 'claude-sonnet-5-5').reasoning, 'none');
  assert.equal(calls.find(call => call.model === 'claude-sonnet-5-5').thinking, undefined);
  assert.equal(calls.find(call => call.model === 'deepseek-v4.1-flash').thinking, 'disabled');
  const video = await generation.execute({ projectId: 'dingxiaosui', userId: 'boss', requestId: 'video', capability: 'video', prompt: '领导视频' });
  assert.equal(video.status, 'running');
  assert.deepEqual(calls.filter(call => call.model?.startsWith('seedance')).map(call => `${call.model}:${call.resolution}`), ['seedance-2.5:720p', 'seedance-2.0:720p', 'seedance-2.0-mini:720p', 'seedance-2.0-mini:480p']);
  const audits = db.prepare("SELECT detail FROM generation_audit WHERE action='generation.fallback'").all().map(row => JSON.parse(row.detail));
  assert.ok(audits.some(item => item.reason === 'model_access_denied' && item.to === 'deepseek-v4.1-flash'));
  assert.ok(audits.some(item => item.reason === 'model_access_denied' && item.to === 'seedance-2.0-mini'));
  assert.ok(audits.some(item => item.reason === 'resolution_unsupported' && item.resolution === '480p'));
  const balance = quota.balance({ projectId: 'dingxiaosui', userId: 'boss' });
  assert.equal(balance.byCapability.text.consumed, 0);
  assert.equal(balance.byCapability.text.reserved, 1);
  assert.equal(balance.byCapability.video.consumed, 0);
  assert.equal(balance.byCapability.video.reserved, 1);
  assert.equal(balance.byCapability.text.available, 1);
  assert.equal(balance.byCapability.video.available, 1);
});

test('model list check names the leader models this key cannot call', () => {
  const available = modelIds({ data: [{ id: 'deepseek-v4.1-flash' }, { id: 'gpt-image-2.5-flare' }, { id: 'seedance-2.0-mini' }] });
  const missing = missingLeaderModels(available);
  assert.deepEqual(missing, ['claude-sonnet-5-5', 'seedance-2.5', 'seedance-2.0']);
  const message = describeMissingModels(missing);
  assert.match(message, /claude-sonnet-5-5/);
  assert.match(message, /seedance-2\.5/);
  assert.match(message, /seedance-2\.0/);
  assert.match(message, /deepseek-v4\.1-flash/);
  assert.match(message, /不会多扣次数/);
});
