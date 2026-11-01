import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createQuota } from '../sidecar/quota.mjs';
import { createChannels } from '../sidecar/channels.mjs';
import { createPlatforms } from '../sidecar/platforms.mjs';
import { createGeneration } from '../sidecar/generation.mjs';

const secret = 'apimart-test-only-storage-secret';
const apiKey = 'apimart-test-only-api-key';
const json = data => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
const task = (status, result = {}, extra = {}) => json({ code: 200, data: { id: 'task_test', status, result, ...extra } });

function setup(t, fetchImpl) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const quota = createQuota(db);
  const channels = createChannels(db, { secret });
  const channel = { id: 'apimart', name: 'APIMart测试', protocol: 'apimart', baseUrl: 'https://api.apimart.ai/v1', apiKey,
    models: [{ capability: 'text', id: 'deepseek-v4.1-flash' }, { capability: 'image', id: 'gpt-image-2.5-flare' }, { capability: 'video', id: 'seedance-2.0-mini' }] };
  channels.saveChannel(channel);
  const platforms = createPlatforms(db, { quota, channels });
  platforms.savePlatform({ id: 'dingxiaosui', name: '丁小穗测试', bindings: channel.models.map(model => ({ capability: model.capability, channelId: channel.id, model: model.id })) });
  const code = quota.generateCodes({ projectId: 'dingxiaosui', quantity: 1, units: 5 }).codes[0];
  quota.redeem({ projectId: 'dingxiaosui', userId: 'buyer', code });
  const generation = createGeneration(db, { quota, channels, platforms, fetchImpl });
  const input = { projectId: 'dingxiaosui', userId: 'buyer', requestId: 'request', prompt: '简洁环保包装测试' };
  return { db, quota, channels, channel, platforms, generation, input };
}

test('reference image upload, aspect ratio and protected image content keep credentials server-side', async t => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  let uploads = 0, generations = 0;
  const { generation, input, quota } = setup(t, async (url, init) => {
    if (url.endsWith('/uploads/images')) {
      uploads++;
      assert.equal(init.headers.Authorization, `Bearer ${apiKey}`);
      assert.ok(Buffer.isBuffer(init.body));
      assert.ok(init.body.includes(png));
      return json({ url: 'https://upload.apimart.ai/f/image/reference.png' });
    }
    if (url.endsWith('/images/generations')) {
      generations++;
      const body = JSON.parse(init.body);
      assert.deepEqual(body.image_urls, ['https://upload.apimart.ai/f/image/reference.png']);
      assert.equal(body.size, '3:4');
      assert.equal(body.referenceImage, undefined);
      return json({ code: 200, data: [{ task_id: 'task_test', status: 'submitted' }] });
    }
    if (url.includes('/tasks/')) return task('completed', { images: [{ url: ['https://upload.apimart.ai/f/image/result.png'] }] });
    assert.deepEqual(init.headers, {});
    return new Response(png, { headers: { 'content-type': 'image/png' } });
  });
  const request = { ...input, capability: 'image', aspectRatio: '3:4', referenceImage: `data:image/png;base64,${png.toString('base64')}` };
  const initial = await generation.execute(request);
  await generation.getJob({ ...input, id: initial.id, refresh: true });
  const content = await generation.getContent({ ...input, id: initial.id });
  assert.deepEqual(content.body, png);
  assert.equal(content.contentType, 'image/png');
  assert.equal((await generation.acceptDelivery({ ...input, id: initial.id })).status, 'succeeded');
  assert.equal((await generation.execute(request)).id, initial.id);
  await assert.rejects(generation.getContent({ ...input, id: initial.id, userId: 'other' }), error => error.status === 404);
  await assert.rejects(generation.getContent({ ...input, id: initial.id, index: 1 }), error => error.status === 400);
  assert.equal(quota.balance(input).consumed, 1);
  assert.equal(uploads, 1);
  assert.equal(generations, 1);
});

test('failed reference upload refunds without sending a billable generation', async t => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  let calls = 0;
  const { generation, input, quota } = setup(t, async url => {
    calls++;
    assert.ok(url.endsWith('/uploads/images'));
    throw new Error('upload network interrupted');
  });
  const request = { ...input, capability: 'image', referenceImage: `data:image/png;base64,${png}` };
  const failed = await generation.execute(request);
  assert.equal(failed.status, 'failed');
  assert.equal(quota.balance(input).available, 5);
  assert.equal(calls, 1);
  await assert.rejects(generation.execute({ ...request, requestId: 'invalid-image', referenceImage: 'data:image/png;base64,ZmFrZQ==' }), error => error.status === 400);
  assert.equal(calls, 1);
});

test('APIMart image submission survives restart, polls wrapped results and debits once', async t => {
  let posts = 0, gets = 0;
  const fetchImpl = async (url, init) => {
    assert.equal(init.headers.Authorization, `Bearer ${apiKey}`);
    if (init.method === 'POST') {
      posts++;
      assert.equal(url, 'https://api.apimart.ai/v1/images/generations');
      assert.deepEqual(JSON.parse(init.body), { model: 'gpt-image-2.5-flare', prompt: '简洁环保包装测试', n: 1, size: '1:1', resolution: '1k', quality: 'low' });
      return json({ code: 200, data: [{ task_id: 'task_test', status: 'submitted' }] });
    }
    gets++;
    assert.equal(url, 'https://api.apimart.ai/v1/tasks/task_test');
    return task('completed', { images: [{ url: ['https://upload.apimart.ai/example.png'] }] }, { usage: { input_tokens: 10, output_tokens: 196, total_tokens: 206 } });
  };
  const state = setup(t, fetchImpl);
  const { db, quota, channels, platforms, generation, input } = state;
  const initial = await generation.execute({ ...input, capability: 'image' });
  assert.equal(initial.status, 'running');
  assert.equal(quota.balance(input).reserved, 1);
  assert.equal((await generation.execute({ ...input, capability: 'image' })).id, initial.id);
  assert.equal(posts, 1);
  const restarted = createGeneration(db, { quota, channels, platforms, fetchImpl });
  assert.deepEqual(await restarted.pollPending(), { checked: 1, settled: 0 });
  const done = await restarted.getJob({ ...input, id: initial.id, refresh: true });
  assert.equal(done.status, 'ready');
  assert.deepEqual(done.output, { images: [{ url: 'https://upload.apimart.ai/example.png' }] });
  assert.equal(done.tokenUsage.totalTokens, 206);
  assert.equal(quota.balance(input).consumed, 0);
  assert.equal(quota.balance(input).reserved, 1);
  assert.equal(posts, 1);
  assert.equal(gets, 1);
});

test('APIMart pending image routes cannot change and failed tasks refund their reservation', async t => {
  const { channels, channel, generation, input, quota } = setup(t, async (_url, init) => init.method === 'POST'
    ? json({ code: 200, data: [{ task_id: 'task_test', status: 'submitted' }] }) : task('failed', {}, { error: { message: apiKey } }));
  const initial = await generation.execute({ ...input, capability: 'image' });
  assert.throws(() => channels.saveChannel({ ...channel, protocol: 'openai-compatible' }), error => error.status === 409);
  assert.throws(() => channels.saveChannel({ ...channel, baseUrl: 'https://another.example/v1' }), error => error.status === 409);
  const done = await generation.getJob({ ...input, id: initial.id, refresh: true });
  assert.equal(done.status, 'failed');
  assert.equal(JSON.stringify(done).includes(apiKey), false);
  assert.equal(quota.balance(input).available, 5);
  assert.equal(quota.balance(input).reserved, 0);
});

test('APIMart video maps duration and downloads completed CDN content without forwarding API key', async t => {
  const { generation, input, quota } = setup(t, async (url, init) => {
    if (init.method === 'POST') {
      assert.equal(url, 'https://api.apimart.ai/v1/videos/generations');
      assert.equal(init.headers['Content-Type'], 'application/json');
      const body = JSON.parse(init.body);
      assert.equal(body.duration, 5);
      assert.equal(body.resolution, '480p');
      assert.equal(body.generate_audio, false);
      assert.equal('seconds' in body, false);
      return json({ code: 200, data: [{ task_id: 'task_test', status: 'submitted' }] });
    }
    if (url === 'https://api.apimart.ai/v1/tasks/task_test') return task('completed', { videos: [{ url: ['https://upload.apimart.ai/example.mp4?signature=test'] }] });
    assert.equal(url, 'https://upload.apimart.ai/example.mp4?signature=test');
    assert.deepEqual(init.headers, {});
    return new Response('test-video', { headers: { 'content-type': 'video/mp4' } });
  });
  const initial = await generation.execute({ ...input, capability: 'video' });
  const done = await generation.getJob({ ...input, id: initial.id, refresh: true });
  assert.equal(done.status, 'ready');
  assert.equal(done.output.contentAvailable, true);
  assert.equal(quota.balance(input).consumed, 0);
  const content = await generation.getContent({ ...input, id: initial.id });
  assert.equal((await generation.acceptDelivery({ ...input, id: initial.id })).status, 'succeeded');
  assert.equal(quota.balance(input).consumed, 1);
  assert.equal(content.body.toString(), 'test-video');
});

test('APIMart missing or unsafe completed media remains uncertain instead of charging success', async t => {
  const { generation, input, quota } = setup(t, async () => task('completed', { videos: [{ url: [`https://cdn.example/video?key=${apiKey}`] }] }));
  const done = await generation.execute({ ...input, capability: 'video' });
  assert.equal(done.status, 'uncertain');
  assert.equal(quota.balance(input).consumed, 0);
  assert.equal(quota.balance(input).reserved, 1);
  assert.equal(done.output, null);
});

test('APIMart text uses compatible chat with a bounded output budget and protocol switching resets defaults', async t => {
  const { channels, channel, generation, input } = setup(t, async (url, init) => {
    assert.equal(url, 'https://api.apimart.ai/v1/chat/completions');
    const body = JSON.parse(init.body);
    assert.equal(body.model, 'deepseek-v4.1-flash');
    assert.equal(body.max_tokens, 1024);
    assert.equal(body.stream, false);
    return json({ choices: [{ message: { content: '测试文案' } }], usage: { prompt_tokens: 10, completion_tokens: 4 } });
  });
  assert.equal((await generation.execute({ ...input, capability: 'text' })).output.text, '测试文案');
  const generic = channels.saveChannel({ ...channel, protocol: 'openai-compatible' });
  assert.equal(generic.endpoints.video, 'videos');
  assert.equal(generic.videoRequestFormat, 'multipart');
  const restored = channels.saveChannel({ ...channel });
  assert.equal(restored.endpoints.video, 'videos/generations');
  assert.equal(restored.endpoints.videoStatus, 'tasks/{id}');
  assert.equal(restored.videoRequestFormat, 'json');
});

test('APIMart text unwraps only a documented successful chat envelope', async t => {
  const response = { code: 200, data: { choices: [{ message: { content: '已解包文案' } }], usage: { prompt_tokens: 8, completion_tokens: 6, total_tokens: 14 } } };
  const { generation, input, quota } = setup(t, async () => json(response));
  const result = await generation.execute({ ...input, capability: 'text' });
  assert.equal(result.status, 'succeeded');
  assert.equal(result.output.text, '已解包文案');
  assert.equal(result.tokenUsage.totalTokens, 14);
  assert.equal(quota.balance(input).consumed, 1);
  response.code = 500;
  const rejected = await generation.execute({ ...input, requestId: 'failed-envelope', capability: 'text' });
  assert.equal(rejected.status, 'uncertain');
  assert.equal(rejected.output, null);
  assert.equal(quota.balance(input).consumed, 1);
});
