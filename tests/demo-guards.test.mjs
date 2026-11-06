import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startCenter } from '../sidecar/server.mjs';
import { createQuota } from '../sidecar/quota.mjs';
import { createChannels } from '../sidecar/channels.mjs';
import { createPlatforms } from '../sidecar/platforms.mjs';
import { createGeneration } from '../sidecar/generation.mjs';
import { createCommerce } from '../sidecar/commerce.mjs';
import { quotaPricingFor, selectionFor } from '../public/shop.js';
import { centerReady, dingReady } from '../scripts/service-identity.mjs';
import { apimartVideoPayload, APIMART_VIDEO_MODEL } from '../apps/dingxiaosui/lib/apimart-protocol.ts';

const secret = 'demo-guard-channel-secret';
const apiKey = 'demo-guard-not-a-real-key';
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

function setup(t, fetchImpl, { spec = null } = {}) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const quota = createQuota(db);
  const channels = createChannels(db, { secret });
  channels.saveChannel({ id: 'relay', name: '测试', protocol: 'apimart', baseUrl: 'https://api.apimart.ai/v1', apiKey,
    models: [{ id: 'deepseek-v4.1-flash', capability: 'text' }, { id: 'gpt-image-2.5-flare', capability: 'image' }, { id: 'seedance-2.0-mini', capability: 'video' }] });
  const platforms = createPlatforms(db, { quota, channels });
  platforms.savePlatform({ id: 'dingxiaosui', name: '丁小穗', bindings: [
    { capability: 'text', channelId: 'relay', model: 'deepseek-v4.1-flash' },
    { capability: 'image', channelId: 'relay', model: 'gpt-image-2.5-flare' },
    { capability: 'video', channelId: 'relay', model: 'seedance-2.0-mini' },
  ] });
  const code = quota.generateCodes({ projectId: 'dingxiaosui', quantity: 1, units: 5, ...(spec ? { mediaSpec: spec } : {}) }).codes[0];
  quota.redeem({ projectId: 'dingxiaosui', userId: 'buyer', code });
  const generation = createGeneration(db, { quota, channels, platforms, fetchImpl });
  return { db, quota, channels, platforms, generation, input: { projectId: 'dingxiaosui', userId: 'buyer', requestId: 'request', prompt: '测试' } };
}

test('valid JSON without a usable answer is not charged until accepted, and rejection refunds once', async t => {
  let calls = 0;
  const { db, generation, quota, input } = setup(t, async () => { calls += 1; return json({ choices: [{ message: { content: '{"title":"只有标题"}' } }] }); });
  const request = { ...input, capability: 'text', responseFormat: 'json_object', messages: [{ role: 'user', content: '写文案' }] };
  const ready = await generation.execute(request);
  assert.equal(ready.status, 'ready');
  assert.equal(ready.output.text, '{"title":"只有标题"}');
  assert.equal(quota.balance(input).consumed, 0);
  assert.equal(quota.balance(input).reserved, 1);
  const refunded = generation.rejectDelivery({ ...input, id: ready.id, reason: '文案结果缺少可用字段，预留次数退回' });
  assert.equal(refunded.status, 'failed');
  assert.equal(quota.balance(input).available, 5);
  assert.equal(quota.balance(input).reserved, 0);
  assert.deepEqual(generation.rejectDelivery({ ...input, id: ready.id, reason: '重复退回' }).status, 'failed');
  assert.equal(quota.balance(input).available, 5);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM generation_audit WHERE job_id=? AND action='generation.refunded'").get(ready.id).n, 1);
  assert.equal(calls, 1);
  const again = await generation.execute(request);
  assert.equal(again.id, ready.id);
  assert.equal(calls, 1);
});

test('accepting a delivered JSON result charges once and a repeated accept does not charge again', async t => {
  const { generation, quota, input } = setup(t, async () => json({ choices: [{ message: { content: '{"answer":"可用文案"}' } }] }));
  const request = { ...input, capability: 'text', responseFormat: 'json_object' };
  const ready = await generation.execute(request);
  const accepted = await generation.acceptDelivery({ ...input, id: ready.id });
  assert.equal(accepted.status, 'succeeded');
  assert.equal(quota.balance(input).consumed, 1);
  assert.deepEqual(await generation.acceptDelivery({ ...input, id: ready.id }), accepted);
  assert.equal(quota.balance(input).consumed, 1);
  assert.throws(() => generation.rejectDelivery({ ...input, id: ready.id, reason: '已经交付不能再退' }), error => error.status === 409);
});

test('a media URL is not charged until the file is downloaded, and CDN 404 refunds idempotently', async t => {
  let missing = true;
  const { db, generation, quota, input } = setup(t, async (url, init) => {
    if (init.method === 'POST') return json({ code: 200, data: [{ task_id: 'img-1', status: 'submitted' }] });
    if (String(url).includes('/tasks/')) return json({ code: 200, data: { id: 'img-1', status: 'completed', result: { images: [{ url: ['https://upload.apimart.ai/f/image/missing.png'] }] } } });
    assert.equal(init.headers.Authorization, undefined);
    return missing ? new Response('missing', { status: 404 }) : new Response(png, { headers: { 'content-type': 'image/png' } });
  });
  const started = await generation.execute({ ...input, capability: 'image' });
  const ready = await generation.getJob({ ...input, id: started.id, refresh: true });
  assert.equal(ready.status, 'ready');
  assert.equal(quota.balance(input).consumed, 0);
  await assert.rejects(generation.getContent({ ...input, id: started.id }), error => error.status === 502);
  const failed = await generation.getJob({ ...input, id: started.id });
  assert.equal(failed.status, 'failed');
  assert.equal(quota.balance(input).available, 5);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM generation_audit WHERE action='generation.refunded'").get().n, 1);
  await assert.rejects(generation.getContent({ ...input, id: started.id }), error => error.status === 409);
  assert.equal(quota.balance(input).available, 5);
  missing = false;
  const second = await generation.execute({ ...input, requestId: 'image-ok', capability: 'image' });
  await generation.getJob({ ...input, id: second.id, refresh: true });
  const file = await generation.getContent({ ...input, id: second.id });
  assert.equal(file.contentType, 'image/png');
  assert.equal(quota.balance(input).consumed, 0);
  assert.equal((await generation.acceptDelivery({ ...input, id: second.id })).status, 'succeeded');
  assert.equal(quota.balance(input).consumed, 1);
  assert.equal((await generation.acceptDelivery({ ...input, id: second.id })).status, 'succeeded');
  assert.equal(quota.balance(input).consumed, 1);
});

test('a polled task id that does not match the original is not settled', async t => {
  const { db, generation, quota, input } = setup(t, async (url, init) => {
    if (init.method === 'POST') return json({ code: 200, data: [{ task_id: 'task-original', status: 'submitted' }] });
    return json({ code: 200, data: { id: 'task-other', status: 'completed', result: { videos: [{ url: ['https://upload.apimart.ai/f/video/other.mp4'] }] } } });
  });
  const started = await generation.execute({ ...input, capability: 'video', seconds: 15 });
  const reviewed = await generation.getJob({ ...input, id: started.id, refresh: true });
  assert.equal(reviewed.status, 'uncertain');
  assert.equal(reviewed.output, null);
  assert.equal(quota.balance(input).consumed, 0);
  assert.equal(quota.balance(input).reserved, 1);
  assert.equal(db.prepare('SELECT upstream_id FROM generation_jobs WHERE id=?').get(started.id).upstream_id, 'task-original');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM generation_audit WHERE action='generation.task_mismatch'").get().n, 1);
});

test('a saved 5 second default permits an explicit supported duration while retaining silent 480p', async t => {
  const seen = [];
  const spec = { video: { seconds: 5, resolution: '480p', audio: false } };
  const bound = setup(t, async (_url, init) => { seen.push(JSON.parse(init.body)); return json({ code: 200, data: [{ task_id: 'video-spec', status: 'submitted' }] }); }, { spec });
  await bound.generation.execute({ ...bound.input, capability: 'video', seconds: 15 });
  assert.equal(seen.at(-1).duration, 15);
  assert.equal(seen.at(-1).resolution, '480p');
  assert.equal(seen.at(-1).generate_audio, false);
  assert.equal(bound.db.prepare("SELECT COUNT(*) AS n FROM generation_audit WHERE action='generation.spec_clipped'").get().n, 0);
  const open = setup(t, async (_url, init) => { seen.push(JSON.parse(init.body)); return json({ code: 200, data: [{ task_id: 'video-open', status: 'submitted' }] }); });
  await open.generation.execute({ ...open.input, capability: 'video', seconds: 15 });
  assert.equal(seen.at(-1).duration, 15);
});

test('the legacy experience profile defaults to 15 seconds with audio and permits supported shorter clips', () => {
  const legacy = apimartVideoPayload(APIMART_VIDEO_MODEL, '体验卡视频', '16:9');
  assert.equal(legacy.duration, 15);
  assert.equal(legacy.resolution, '720p');
  assert.equal(legacy.generate_audio, true);
  for (const seconds of [5, 10]) {
    const selected = apimartVideoPayload(APIMART_VIDEO_MODEL, '体验卡视频', '16:9', seconds);
    assert.equal(selected.duration, seconds);
    assert.equal(selected.resolution, '720p');
    assert.equal(selected.generate_audio, true);
  }
  assert.throws(() => apimartVideoPayload(APIMART_VIDEO_MODEL, '体验卡视频', '16:9', 30), /5 秒、10 秒或 15 秒/);
});

test('closing one capability at price 0 keeps the free combination for the others', t => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const quota = createQuota(db);
  quota.createProject({ id: 'dingxiaosui', name: '丁小穗' });
  const commerce = createCommerce(db, { quota, secret: 'shop-secret-at-least-16' });
  const saved = commerce.saveProduct({ id: 'creator', projectId: 'dingxiaosui', name: '创作', units: 2, priceCents: 100, active: true, fulfillment: 'on_payment',
    packageOptions: [{ id: 'combo', label: '组合', quota: { text: 1, image: 1, video: 0 }, priceCents: 100 }],
    quotaPricing: { enabled: true, unitPriceMicros: { text: 100000, image: 200000, video: 0 }, maxCounts: { text: 10, image: 10, video: 0 } } });
  const pricing = quotaPricingFor(saved);
  assert.ok(pricing);
  assert.equal(pricing.unitPriceMicros.video, 0);
  assert.equal(pricing.maxCounts.video, 0);
  const selected = selectionFor(saved, { type: 'custom_quota', customQuota: { text: '2', image: '1' } });
  assert.equal(selected.valid, true);
  assert.deepEqual(selected.quota, { text: 2, image: 1, video: 0 });
  assert.equal(quotaPricingFor({ ...saved, quotaPricing: { ...saved.quotaPricing, maxCounts: { text: 0, image: 0, video: 0 } } }), null);
  commerce.saveProduct({ ...saved, active: true });
  const order = commerce.createOrder({ productId: 'creator', email: 'buyer@example.com', customQuota: { text: 2, image: 1, video: 0 } });
  assert.equal(order.quota.video, 0);
  assert.ok(order.priceCents > 0);
});

test('generation budget is per credential user, while health checks and task polls are free', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'quota-rate-guard-'));
  await mkdir(path.join(root, 'local'));
  const probe = net.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const center = await startCenter({ root, port, config: { port, adminPassword: 'rate-admin', merchantKey: 'rate-guard-storage-key' } });
  t.after(async () => { await center.close(); await rm(root, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${port}`;
  for (let index = 0; index < 300; index += 1) {
    const health = await fetch(base + '/api/health');
    assert.equal(health.status, 200);
    assert.equal((await health.json()).service, 'quota-center');
  }
  const keys = JSON.parse(await readFile(path.join(root, 'local/project-keys.json'), 'utf8'));
  const projectId = Object.keys(keys)[0];
  async function generate(userId) {
    const response = await fetch(base + '/api/v1/generate', { method: 'POST', headers: { authorization: `Bearer ${keys[projectId]}`, 'content-type': 'application/json' }, body: JSON.stringify({ userId, requestId: `${userId}-${Math.random()}`, capability: 'text', prompt: '限流测试' }) });
    return response.status;
  }
  const firstStatuses = [];
  for (let index = 0; index < 60; index += 1) firstStatuses.push(await generate('alice'));
  assert.equal(firstStatuses.includes(429), false);
  assert.equal(await generate('alice'), 429);
  assert.notEqual(await generate('bob'), 429);
  const polls = [];
  for (let index = 0; index < 300; index += 1) {
    const response = await fetch(base + '/api/v1/generation/missing-task?userId=alice', { headers: { authorization: `Bearer ${keys[projectId]}` } });
    polls.push(response.status);
  }
  assert.equal(polls.includes(429), false);
  assert.ok(polls.every(status => status === 404));
});

test('launcher identity requires the quota center and the matching Ding build', () => {
  assert.equal(centerReady({ ok: true }), false);
  assert.equal(centerReady({ ok: true, service: 'quota-center' }), true);
  assert.equal(dingReady({ service: 'dingxiaosui', quotaCenterEnabled: false, buildId: 'build-a' }, 'build-a'), false);
  assert.equal(dingReady({ service: 'dingxiaosui', quotaCenterEnabled: true, buildId: 'old' }, 'build-a'), false);
  assert.equal(dingReady({ service: 'dingxiaosui', quotaCenterEnabled: true, buildId: 'build-a' }, 'build-a'), true);
});

test('a stored upstream response is replayed after restart without a second provider call', async t => {
  let calls = 0;
  const state = setup(t, async () => { calls += 1; return json({ choices: [{ message: { content: '可恢复文案' } }] }); });
  const done = await state.generation.execute({ ...state.input, capability: 'text' });
  assert.equal(done.status, 'succeeded');
  assert.equal(calls, 1);
  const row = state.db.prepare('SELECT * FROM generation_jobs WHERE id=?').get(done.id);
  state.db.prepare("UPDATE generation_jobs SET status='running',output_json=NULL WHERE id=?").run(row.id);
  state.db.prepare("UPDATE quota_usage SET status='reserved',settled_at=NULL WHERE id=?").run(row.usage_id);
  state.db.prepare('UPDATE quota_accounts SET reserved_units=reserved_units+1,consumed_units=consumed_units-1 WHERE project_id=? AND user_id=?').run(state.input.projectId, state.input.userId);
  state.db.prepare("UPDATE quota_account_buckets SET reserved_units=reserved_units+1,consumed_units=consumed_units-1 WHERE project_id=? AND user_id=? AND capability='shared'").run(state.input.projectId, state.input.userId);
  const recovered = createGeneration(state.db, { quota: state.quota, channels: state.channels, platforms: state.platforms, fetchImpl: async () => { calls += 1; throw new Error('must not call upstream again'); } });
  assert.equal(state.db.prepare('SELECT status FROM generation_jobs WHERE id=?').get(done.id).status, 'succeeded');
  assert.equal(state.quota.balance(state.input).consumed, 1);
  assert.equal(calls, 1);
  assert.equal((await recovered.execute({ ...state.input, capability: 'text' })).output.text, '可恢复文案');
});
