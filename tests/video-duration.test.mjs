import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createChannels } from '../sidecar/channels.mjs';
import { createGeneration } from '../sidecar/generation.mjs';
import { mediaSpec } from '../sidecar/media-spec.mjs';
import { LEADER_PROFILE } from '../sidecar/model-tiers.mjs';
import { createPlatforms } from '../sidecar/platforms.mjs';
import { createQuota } from '../sidecar/quota.mjs';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const submitted = id => json({ code: 200, data: [{ task_id: id, status: 'submitted' }] });
const input = { projectId: 'dingxiaosui', userId: 'buyer', requestId: 'video', capability: 'video', prompt: '拍摄农产品外观' };

function setup(t, fetchImpl, { profile = LEADER_PROFILE, model = 'seedance-2.0-mini', protocol = 'apimart' } = {}) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const quota = createQuota(db);
  const channels = createChannels(db, { secret: 'video-duration-test-storage-secret' });
  const channel = { id: 'relay', name: '测试渠道', protocol, baseUrl: 'https://api.apimart.ai/v1', apiKey: 'video-duration-test-key',
    models: [...new Set(['seedance-2.5', 'seedance-2.0', 'seedance-2.0-mini', model])].map(id => ({ id, capability: 'video' })) };
  channels.saveChannel(channel);
  const platforms = createPlatforms(db, { quota, channels });
  platforms.savePlatform({ id: input.projectId, name: '测试平台', bindings: [{ capability: 'video', channelId: 'relay', model }] });
  const code = quota.generateCodes({ projectId: input.projectId, quantity: 1, quota: { text: 0, image: 0, video: 6 }, ...(profile ? { mediaSpec: profile } : {}) }).codes[0];
  quota.redeem({ projectId: input.projectId, userId: input.userId, code });
  const generation = createGeneration(db, { quota, channels, platforms, fetchImpl });
  return { db, quota, channels, channel, platforms, generation };
}

test('video media specs accept 10 seconds and reject durations outside the three choices', () => {
  assert.equal(mediaSpec({ video: { seconds: 10, resolution: '720p', audio: false } }).video.seconds, 10);
  for (const seconds of [4, 7, 30, 120]) assert.throws(() => mediaSpec({ video: { seconds, resolution: '720p', audio: false } }), error => error.status === 400);
});

test('existing leader and standard cards advertise supported choices without exposing credentials or changing saved defaults', t => {
  const leader = setup(t, () => { throw new Error('options must not call the provider'); });
  assert.deepEqual(leader.generation.mediaOptions(input), { video: { available: true, durationSeconds: 5, durationOptions: [5, 10, 15], resolution: '720p' } });
  const standard = setup(t, undefined, { profile: { video: { seconds: 15, resolution: '480p', audio: false } } });
  assert.deepEqual(standard.generation.mediaOptions(input), { video: { available: true, durationSeconds: 15, durationOptions: [5, 10, 15], resolution: '480p' } });
  assert.equal(JSON.parse(leader.db.prepare('SELECT media_spec_json FROM quota_codes').get().media_spec_json).video.seconds, 5);
  leader.channels.saveChannel({ ...leader.channel, enabled: false });
  assert.deepEqual(leader.generation.mediaOptions(input).video.durationOptions, []);
  assert.equal(leader.generation.mediaOptions(input).video.available, false);
  assert.equal(leader.generation.mediaOptions({ ...input, projectId: 'missing' }).video.available, false);
});

test('other configured video channels remain available with only their saved default and no inferred resolution', t => {
  for (const protocol of ['apimart', 'openai-compatible']) {
    const fallback = setup(t, () => { throw new Error('options must not call the provider'); }, { profile: null, model: 'other-video-model', protocol });
    assert.deepEqual(fallback.generation.mediaOptions(input), { video: { available: true, durationSeconds: 5, durationOptions: [5], resolution: null } });
    const saved = setup(t, undefined, { profile: { video: { seconds: 15, resolution: '720p', audio: false } }, model: 'other-video-model', protocol });
    assert.deepEqual(saved.generation.mediaOptions(input), { video: { available: true, durationSeconds: 15, durationOptions: [15], resolution: '720p' } });
    saved.platforms.savePlatform({ id: input.projectId, name: '测试平台', bindings: [] });
    assert.equal(saved.generation.mediaOptions(input).video.available, false);
  }
  const known = setup(t, undefined, { profile: null });
  assert.deepEqual(known.generation.mediaOptions(input), { video: { available: true, durationSeconds: 5, durationOptions: [5, 10, 15], resolution: null } });
});

test('5, 10 and 15 second selections reach the leader model, retain server settings, and scale the estimate', async t => {
  const sent = [];
  const state = setup(t, async (_url, init) => { sent.push(JSON.parse(init.body)); return submitted(`video-${sent.length}`); });
  for (const seconds of [5, 10, 15]) {
    const result = await state.generation.execute({ ...input, requestId: `duration-${seconds}`, seconds,
      model: 'attacker-model', resolution: '1080p', audio: true });
    assert.equal(result.status, 'running');
    assert.deepEqual({ model: sent.at(-1).model, duration: sent.at(-1).duration, resolution: sent.at(-1).resolution, audio: sent.at(-1).generate_audio },
      { model: 'seedance-2.5', duration: seconds, resolution: '720p', audio: false });
    const row = state.db.prepare('SELECT request_json,pricing_json FROM generation_jobs WHERE id=?').get(result.id);
    assert.equal(JSON.parse(row.request_json).videoSpec.seconds, seconds);
    assert.equal(JSON.parse(row.pricing_json).perRequestCents, 108 * seconds / 5);
  }
  assert.equal(JSON.parse(state.db.prepare('SELECT media_spec_json FROM quota_codes').get().media_spec_json).video.seconds, 5);
  assert.equal(state.quota.balance(input).byCapability.video.reserved, 3);
});

test('omitting duration preserves an issued card default and standard cards keep their own model and resolution', async t => {
  const sent = [];
  const state = setup(t, async (_url, init) => { sent.push(JSON.parse(init.body)); return submitted(`standard-${sent.length}`); },
    { profile: { video: { seconds: 15, resolution: '480p', audio: false } } });
  await state.generation.execute(input);
  await state.generation.execute({ ...input, requestId: 'shorter', seconds: 10 });
  assert.deepEqual(sent.map(body => [body.model, body.duration, body.resolution]), [
    ['seedance-2.0-mini', 15, '480p'], ['seedance-2.0-mini', 10, '480p'],
  ]);
});

test('custom per-request prices retain their original default and changed durations are unpriced', async t => {
  const state = setup(t, async () => submitted('priced'));
  state.channels.saveChannel({ ...state.channel, models: state.channel.models.map(model => ({ ...model, pricing: { perRequestCents: 77 } })) });
  const original = await state.generation.execute(input);
  const changed = await state.generation.execute({ ...input, requestId: 'longer', seconds: 15 });
  const row = id => state.db.prepare('SELECT request_json,pricing_json FROM generation_jobs WHERE id=?').get(id);
  assert.equal(JSON.parse(row(original.id).pricing_json).perRequestCents, 77);
  assert.equal(row(changed.id).pricing_json, null);
  assert.equal(JSON.parse(row(changed.id).request_json).defaultVideoSeconds, 5);
  const restarted = createGeneration(state.db, { ...state, fetchImpl: async (_url, init) => init.method === 'POST'
    ? submitted('priced-fallback') : json({ code: 200, data: { id: 'priced', status: 'failed' } }) });
  await restarted.getJob({ ...input, id: changed.id, refresh: true });
  assert.equal(row(changed.id).pricing_json, null);

  const legacy = setup(t, async () => submitted('legacy'), { profile: { video: { seconds: 15, resolution: '480p', audio: false } } });
  legacy.channels.saveChannel({ ...legacy.channel, models: legacy.channel.models.map(model => ({ ...model, pricing: { perRequestCents: 66 } })) });
  const legacyJob = await legacy.generation.execute(input);
  assert.equal(JSON.parse(legacy.db.prepare('SELECT pricing_json FROM generation_jobs WHERE id=?').get(legacyJob.id).pricing_json).perRequestCents, 66);
});

test('unsupported durations and unknown APIMart models fail before reservation or provider calls', async t => {
  let calls = 0;
  const state = setup(t, async () => { calls++; return submitted('must-not-submit'); });
  for (const seconds of [4, 7, 16, 120]) {
    await assert.rejects(state.generation.execute({ ...input, requestId: `bad-${seconds}`, seconds }), error => error.status === 400);
  }
  assert.equal(state.db.prepare('SELECT COUNT(*) AS n FROM generation_jobs').get().n, 0);
  assert.equal(state.quota.balance(input).byCapability.video.available, 6);
  const unknown = setup(t, async () => { calls++; return submitted('must-not-submit'); }, { profile: null, model: 'other-video-model' });
  assert.equal(unknown.generation.mediaOptions(input).video.available, true);
  assert.deepEqual(unknown.generation.mediaOptions(input).video.durationOptions, [5]);
  await assert.rejects(unknown.generation.execute({ ...input, seconds: 15 }), error => error.status === 400);
  assert.equal(calls, 0);
});

test('duration participates in idempotency and a restarted fallback keeps all 15 seconds with one reservation', async t => {
  const sent = [];
  const fetchImpl = async (url, init) => {
    if (init.method === 'POST') {
      const body = JSON.parse(init.body); sent.push(body);
      return submitted(body.model === 'seedance-2.5' ? 'primary' : 'fallback');
    }
    assert.ok(url.endsWith('/tasks/primary'));
    return json({ code: 200, data: { id: 'primary', status: 'failed' } });
  };
  const state = setup(t, fetchImpl);
  const request = { ...input, seconds: 15 };
  const started = await state.generation.execute(request);
  assert.equal((await state.generation.execute(request)).id, started.id);
  await assert.rejects(state.generation.execute({ ...request, seconds: 10 }), error => error.status === 409);
  const restarted = createGeneration(state.db, { ...state, fetchImpl });
  const recovered = await restarted.getJob({ ...input, id: started.id, refresh: true });
  assert.equal(recovered.status, 'running');
  assert.deepEqual(sent.map(body => [body.model, body.duration, body.resolution]), [['seedance-2.5', 15, '720p'], ['seedance-2.0', 15, '720p']]);
  assert.equal(state.quota.balance(input).byCapability.video.reserved, 1);
  assert.equal(state.quota.balance(input).byCapability.video.available, 5);
  assert.equal((await restarted.execute(request)).id, started.id);
  assert.equal(sent.length, 2);
});

test('the access-denied chain and resolution fallback retain a selected 10 second clip', async t => {
  const sent = [];
  const state = setup(t, async (_url, init) => {
    const body = JSON.parse(init.body); sent.push(body);
    if (body.model !== 'seedance-2.0-mini') return json({ error: { message: 'This key has no access to model' } }, 403);
    if (body.resolution === '720p') return json({ error: { message: 'unsupported 720p resolution' } }, 400);
    return submitted('mini-fallback');
  });
  const result = await state.generation.execute({ ...input, seconds: 10 });
  assert.equal(result.status, 'running');
  assert.deepEqual(sent.map(body => [body.model, body.duration, body.resolution]), [
    ['seedance-2.5', 10, '720p'], ['seedance-2.0', 10, '720p'], ['seedance-2.0-mini', 10, '720p'], ['seedance-2.0-mini', 10, '480p'],
  ]);
  assert.equal(state.quota.balance(input).byCapability.video.reserved, 1);
});

test('a long clip skips an unknown configured fallback without submitting or reserving it', async t => {
  const sent = [];
  const state = setup(t, async (_url, init) => {
    const body = JSON.parse(init.body); sent.push(body);
    assert.notEqual(body.model, 'custom-video');
    if (body.model === 'seedance-2.5') return json({ error: { message: 'This key has no access to model' } }, 403);
    return submitted('known-fallback');
  }, { profile: { ...LEADER_PROFILE, fallbacks: { ...LEADER_PROFILE.fallbacks, video: 'custom-video' } }, model: 'custom-video' });
  const result = await state.generation.execute({ ...input, seconds: 15 });
  assert.equal(result.status, 'running');
  assert.deepEqual(sent.map(body => [body.model, body.duration]), [['seedance-2.5', 15], ['seedance-2.0', 15]]);
  const skipped = state.db.prepare("SELECT detail FROM generation_audit WHERE job_id=? AND action='generation.fallback'")
    .all(result.id).map(row => JSON.parse(row.detail)).find(row => row.to === 'custom-video');
  assert.equal(skipped.reason, 'duration_unsupported');
  assert.equal(skipped.skipped, true);
  assert.equal(state.quota.balance(input).byCapability.video.reserved, 1);
});
