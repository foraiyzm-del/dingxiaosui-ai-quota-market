import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:http';
import { createQuota } from '../sidecar/quota.mjs';
import { createChannels } from '../sidecar/channels.mjs';
import { createPlatforms } from '../sidecar/platforms.mjs';
import { createGeneration } from '../sidecar/generation.mjs';

const secret = 'test-only-upstream-channel-secret';
const apiKey = 'test-only-not-a-real-api-key';
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const status = code => error => error.status === code;
function setup(t, fetchImpl, channelOverrides = {}) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const quota = createQuota(db);
  const channels = createChannels(db, { secret });
  const channel = { id: 'relay', name: '测试中转', baseUrl: 'https://relay.example/v1', apiKey,
    models: [{ id: 'copy-model', capability: 'text', pricing: { inputPerMillionCents: 100, outputPerMillionCents: 200, perRequestCents: 1 } },
      { id: 'image-model', capability: 'image' }, { id: 'video-model', capability: 'video', pricing: { perRequestCents: 8 } }], ...channelOverrides };
  channels.saveChannel(channel);
  const platforms = createPlatforms(db, { quota, channels });
  const platform = { id: 'design', name: '包装设计', unitsPerUse: 2, bindings: channel.models.map(model => ({ capability: model.capability, channelId: 'relay', model: model.id })) };
  platforms.savePlatform(platform);
  platforms.savePlatform({ id: 'copy', name: '文案平台', bindings: [platform.bindings[0]] });
  const code = quota.generateCodes({ projectId: 'design', quantity: 1, units: 20 }).codes[0];
  quota.redeem({ projectId: 'design', userId: 'user-one', code });
  const generation = createGeneration(db, { quota, channels, platforms, fetchImpl });
  const input = { projectId: 'design', userId: 'user-one', requestId: 'request-one', capability: 'text', prompt: '写一段包装文案' };
  return { db, quota, channels, channel, platforms, platform, generation, input };
}

test('structured business messages preserve context, validate JSON and are part of idempotency', async t => {
  let calls = 0;
  const { generation, input, quota } = setup(t, async (_url, init) => {
    calls++;
    const payload = JSON.parse(init.body);
    assert.equal(payload.messages[0].role, 'system');
    assert.equal(payload.messages[1].content, '品牌知识库内容');
    assert.equal(payload.response_format.type, 'json_object');
    assert.equal(payload.max_tokens, 4096);
    return json({ choices: [{ message: { content: calls === 1 ? '{"content":"农品文案"}' : 'not JSON' } }] });
  });
  const request = { ...input, messages: [{ role: 'system', content: '输出JSON' }, { role: 'user', content: '品牌知识库内容' }], responseFormat: 'json_object', maxTokens: 4096 };
  const result = await generation.execute(request);
  assert.equal(result.status, 'succeeded');
  assert.equal((await generation.execute(request)).id, result.id);
  await assert.rejects(generation.execute({ ...request, maxTokens: 4097 }), status(409));
  const invalid = await generation.execute({ ...request, requestId: 'bad-json' });
  assert.equal(invalid.status, 'failed');
  assert.equal(quota.balance(input).consumed, 2);
  assert.equal(quota.balance(input).reserved, 0);
  assert.equal(calls, 2);
  await assert.rejects(generation.execute({ ...request, requestId: 'bad-type', maxTokens: 50000 }), status(400));
});

test('registered platforms expose safe readiness while preserving separate quota projects', t => {
  const { quota, channels, channel, platforms, platform } = setup(t, async () => json({}));
  quota.createProject({ id: 'legacy', name: '旧余额账户' });
  assert.equal(platforms.listPlatforms().length, 2);
  assert.equal(platforms.getPlatform('design').readiness, 'ready');
  const publicPlatform = platforms.getPlatform('design', { public: true });
  assert.equal('bindings' in publicPlatform, false);
  assert.equal(JSON.stringify(publicPlatform).includes('relay'), false);
  channels.saveChannel({ ...channel, enabled: false });
  assert.equal(platforms.getPlatform('design').readiness, 'channel-unavailable');
  platforms.savePlatform({ ...platform, enabled: false });
  assert.equal(platforms.getPlatform('design').readiness, 'disabled');
  platforms.savePlatform({ id: 'legacy', name: '原平台', bindings: [] });
  assert.equal(platforms.listPlatforms().length, 3);
  assert.equal(platforms.getPlatform('legacy').readiness, 'unconfigured');
  assert.throws(() => channels.saveChannel({ ...channel, models: channel.models.filter(model => model.capability !== 'image') }), status(409));
});

test('text calls use server routing, commit platform units once and estimate configured model costs', async t => {
  let calls = 0;
  const { quota, generation, input } = setup(t, async (url, init) => {
    calls += 1;
    assert.equal(url, 'https://relay.example/v1/chat/completions');
    assert.equal(init.headers.Authorization, `Bearer ${apiKey}`);
    const body = JSON.parse(init.body);
    assert.equal(body.model, 'copy-model');
    assert.equal(body.stream, false);
    assert.equal(body.messages[0].content, input.prompt);
    return json({ choices: [{ message: { content: '真实适配器测试输出' } }], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } });
  });
  const result = await generation.execute({ ...input, baseUrl: 'http://127.0.0.1', model: 'forged' });
  assert.equal(result.status, 'succeeded');
  assert.equal(result.output.text, '真实适配器测试输出');
  assert.equal(result.estimatedCostCents, 1.02);
  assert.equal(result.units, 2);
  assert.equal(quota.balance(input).available, 18);
  assert.equal(quota.balance(input).consumed, 2);
  assert.equal(JSON.stringify(result).includes(apiKey), false);
  assert.equal(JSON.stringify(result).includes('relay.example'), false);
  assert.deepEqual(await generation.execute(input), result);
  assert.equal(calls, 1);
  await assert.rejects(generation.execute({ ...input, prompt: '另一个请求' }), status(409));
  await assert.rejects(generation.getJob({ id: result.id, projectId: 'copy', userId: input.userId }), status(404));
  await assert.rejects(generation.getJob({ id: result.id, projectId: input.projectId, userId: 'another-user' }), status(404));
  assert.equal(generation.stats().succeededCount, 1);
});

test('concurrent duplicate requests do not send another upstream POST', async t => {
  let release;
  let calls = 0;
  const { generation, input, quota } = setup(t, async () => {
    calls += 1;
    await new Promise(resolve => { release = resolve; });
    return json({ choices: [{ message: { content: '完成' } }] });
  });
  const first = generation.execute(input);
  const second = await generation.execute(input);
  assert.equal(second.status, 'running');
  assert.equal(calls, 1);
  assert.equal(quota.balance(input).reserved, 2);
  release();
  const done = await first;
  assert.equal(done.id, second.id);
  assert.equal(quota.balance(input).consumed, 2);
});

test('explicit upstream rejection refunds once and does not expose upstream secrets', async t => {
  const { generation, quota, input } = setup(t, async () => json({ error: { message: apiKey } }, 401));
  const rejected = await generation.execute(input);
  assert.equal(rejected.status, 'failed');
  assert.equal(quota.balance(input).available, 20);
  assert.equal(quota.balance(input).reserved, 0);
  assert.equal(JSON.stringify(rejected).includes(apiKey), false);
  assert.deepEqual(await generation.execute(input), rejected);
  assert.equal(quota.listUsage().length, 1);
});

test('timeouts and ambiguous responses keep reserved units until administrator resolves them', async t => {
  const { generation, quota, input } = setup(t, async () => { throw new Error(`socket ${apiKey}`); });
  const unknown = await generation.execute(input);
  assert.equal(unknown.status, 'uncertain');
  assert.equal(quota.balance(input).available, 18);
  assert.equal(quota.balance(input).reserved, 2);
  assert.equal(JSON.stringify(unknown).includes(apiKey), false);
  assert.throws(() => generation.resolveJob({ id: unknown.id, action: 'cancel', note: '' }), status(400));
  const refunded = generation.resolveJob({ id: unknown.id, action: 'cancel', note: '已向中转站核对，该请求未执行' });
  assert.equal(refunded.status, 'failed');
  assert.equal(quota.balance(input).available, 20);
  assert.deepEqual(generation.resolveJob({ id: unknown.id, action: 'cancel', note: '重复确认' }), refunded);
  assert.throws(() => generation.resolveJob({ id: unknown.id, action: 'commit', note: '冲突确认' }), status(409));
});

test('image responses decode safe image data and charge one configured business use', async t => {
  const image = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]).toString('base64');
  const { generation, quota, input } = setup(t, async (url, init) => {
    assert.equal(url, 'https://relay.example/v1/images/generations');
    assert.equal(JSON.parse(init.body).n, 1);
    return json({ data: [{ b64_json: image }] });
  });
  const result = await generation.execute({ ...input, capability: 'image', size: '1024x1024' });
  assert.equal(result.status, 'succeeded');
  assert.equal(result.output.images[0].dataUrl, `data:image/png;base64,${image}`);
  assert.equal(result.estimatedCostCents, null);
  assert.equal(quota.balance(input).consumed, 2);
  assert.equal(generation.stats().unpricedSuccessCount, 1);
});

test('video jobs reserve through polling, use protected downloads and settle exactly once', async t => {
  let posts = 0;
  const { generation, quota, input } = setup(t, async (url, init) => {
    assert.equal(init.headers.Authorization, `Bearer ${apiKey}`);
    if (init.method === 'POST') {
      posts += 1;
      assert.equal(url, 'https://relay.example/v1/videos');
      assert.match(init.headers['Content-Type'], /^multipart\/form-data;/u);
      assert.match(init.body, /name="seconds"\r\n\r\n4/u);
      return json({ id: 'video-1', status: 'queued' });
    }
    if (url.endsWith('/content')) return new Response(Buffer.from('test-video-content'), { headers: { 'content-type': 'video/mp4' } });
    assert.equal(url, 'https://relay.example/v1/videos/video-1');
    return json({ id: 'video-1', status: 'completed' });
  });
  const videoInput = { ...input, capability: 'video', seconds: 4, size: '1280x720' };
  const started = await generation.execute(videoInput);
  assert.equal(started.status, 'running');
  assert.equal(quota.balance(input).reserved, 2);
  const completed = await generation.getJob({ id: started.id, projectId: input.projectId, userId: input.userId, refresh: true });
  assert.equal(completed.status, 'succeeded');
  assert.equal(completed.output.contentAvailable, true);
  assert.equal(completed.estimatedCostCents, 8);
  assert.equal(quota.balance(input).reserved, 0);
  assert.equal(quota.balance(input).consumed, 2);
  assert.equal((await generation.execute(videoInput)).status, 'succeeded');
  assert.equal(posts, 1);
  const downloaded = await generation.getContent({ id: started.id, projectId: input.projectId, userId: input.userId });
  assert.equal(downloaded.contentType, 'video/mp4');
  assert.equal(downloaded.body.toString(), 'test-video-content');
});

test('restart reconciles persisted ledger success without a second charge or request', async t => {
  const { generation, quota, channels, platforms, db, input } = setup(t, async () => json({ choices: [{ message: { content: '已完成' } }] }));
  const success = await generation.execute(input);
  db.prepare("UPDATE generation_jobs SET status='running',upstream_id=NULL WHERE id=?").run(success.id);
  // Recreate after a process crash; already-settled ledger state takes precedence.
  const recovered = createGeneration(db, { quota, channels, platforms, fetchImpl: () => { throw new Error('unexpected request'); } });
  const same = await recovered.execute(input);
  assert.equal(same.status, 'succeeded');
  assert.equal(quota.balance(input).consumed, 2);
  assert.equal(recovered.resolveJob({ id: same.id, action: 'commit', note: '已核对到账与结果' }).status, 'succeeded');
  assert.equal(quota.balance(input).consumed, 2);
});

test('restart marks interrupted in-flight POST uncertain and does not resend it', async t => {
  const { generation, quota, channels, platforms, db, input } = setup(t, async () => { throw new Error('connection lost'); });
  const first = await generation.execute(input);
  db.prepare("UPDATE generation_jobs SET status='running',error=NULL WHERE id=?").run(first.id);
  const recovered = createGeneration(db, { quota, channels, platforms, fetchImpl: () => { throw new Error('must not resend'); } });
  assert.equal((await recovered.execute(input)).status, 'uncertain');
  assert.equal(quota.balance(input).reserved, 2);
  recovered.resolveJob({ id: first.id, action: 'cancel', note: '确认上游未处理' });
  assert.equal(quota.balance(input).available, 20);
});

test('background polling settles videos after the user leaves and protects their channel configuration', async t => {
  const { generation, channels, channel, platforms, input, quota } = setup(t, async (_url, init) =>
    json({ id: 'video-background', status: init.method === 'POST' ? 'queued' : 'completed' }));
  const job = await generation.execute({ ...input, capability: 'video' });
  platforms.savePlatform({ id: 'design', bindings: [] });
  assert.throws(() => channels.saveChannel({ ...channel, models: channel.models.filter(model => model.capability !== 'video') }), status(409));
  assert.throws(() => channels.saveChannel({ ...channel, baseUrl: 'https://another.example/v1' }), status(409));
  assert.deepEqual(await generation.pollPending(), { checked: 1, settled: 1 });
  assert.equal((await generation.getJob({ ...input, id: job.id })).status, 'succeeded');
  assert.equal(quota.balance(input).consumed, 2);
  assert.doesNotThrow(() => channels.saveChannel({ ...channel, models: channel.models.filter(model => model.capability !== 'video') }));
});

test('asset URLs may contain signed CDN parameters but cannot expose the configured API key', async t => {
  let exposeKey = true;
  const { generation, input } = setup(t, async () => json({ data: [{ url: `https://cdn.example/output.png?token=${exposeKey ? apiKey : 'signed-download-token'}` }] }));
  const blocked = await generation.execute({ ...input, capability: 'image' });
  assert.equal(blocked.status, 'uncertain');
  assert.equal(JSON.stringify(blocked).includes(apiKey), false);
  exposeKey = false;
  const allowed = await generation.execute({ ...input, requestId: 'signed-image', capability: 'image' });
  assert.equal(allowed.status, 'succeeded');
  assert.match(allowed.output.images[0].url, /signed-download-token/u);
});

test('missing configuration and insufficient balance never reach an upstream', async t => {
  let calls = 0;
  const { generation, platforms, input, db } = setup(t, async () => { calls += 1; return json({}); });
  await assert.rejects(generation.execute({ ...input, projectId: 'copy' }), status(402));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM generation_jobs').get().n, 0);
  platforms.savePlatform({ id: 'unconfigured', name: '待配置', bindings: [] });
  await assert.rejects(generation.execute({ ...input, projectId: 'unconfigured' }), status(409));
  await assert.rejects(generation.execute({ ...input, prompt: '' }), status(400));
  assert.equal(calls, 0);
});

test('default transport rejects private upstream addresses before sending and releases reserved units', async t => {
  const { generation, input, quota } = setup(t, undefined, { baseUrl: 'http://127.0.0.1:9/v1' });
  const result = await generation.execute(input);
  assert.equal(result.status, 'failed');
  assert.match(result.error, /内网/u);
  assert.equal(quota.balance(input).available, 20);
});

test('channel paths and pricing validate, persist and preserve existing configuration on edits', t => {
  const { channels, channel } = setup(t, async () => json({}));
  const saved = channels.saveChannel({ ...channel, endpoints: { video: 'api/video/create', videoStatus: 'api/video/{id}' }, videoRequestFormat: 'json', timeoutMs: 30000 });
  assert.equal(saved.endpoints.text, 'chat/completions');
  assert.equal(saved.endpoints.video, 'api/video/create');
  assert.equal(channels.saveChannel(channel).videoRequestFormat, 'json');
  for (const path of ['https://evil.example/path', '../admin', 'path?key=test', '/absolute', 'nested/../path']) {
    assert.throws(() => channels.saveChannel({ ...channel, endpoints: { text: path } }), status(400));
  }
  assert.throws(() => channels.saveChannel({ ...channel, endpoints: { videoStatus: 'videos/query' } }), status(400));
  assert.throws(() => channels.saveChannel({ ...channel, models: [{ id: 'negative', capability: 'text', pricing: { perRequestCents: -1 } }] }), status(400));
});

test('real HTTP adapter sends exact paths and multipart video requests, polls, downloads, and never follows redirects', async t => {
  const received = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString();
    received.push({ path: request.url, method: request.method, headers: request.headers, raw });
    const send = value => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(value)); };
    if (request.url === '/relay/v1/chat/completions') {
      const prompt = JSON.parse(raw).messages[0].content;
      if (prompt === 'redirect') { response.writeHead(302, { location: '/must-not-follow' }); response.end(); return; }
      if (prompt === 'timeout') {
        const timer = setTimeout(() => send({ choices: [{ message: { content: 'too late' } }] }), 2500);
        response.on('close', () => clearTimeout(timer));
        return;
      }
      send({ choices: [{ message: { content: 'HTTP 完成' } }], usage: { prompt_tokens: 3, completion_tokens: 4 } });
    } else if (request.url === '/relay/v1/videos' && request.method === 'POST') send({ id: 'http-video-id', status: 'queued' });
    else if (request.url === '/relay/v1/videos/http-video-id') send({ id: 'http-video-id', status: 'completed' });
    else if (request.url === '/relay/v1/videos/http-video-id/content') { response.writeHead(200, { 'content-type': 'video/mp4' }); response.end('local-mp4-test-bytes'); }
    else { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const address = `http://localhost:${server.address().port}/relay/v1`;
  const { db, quota, channels, platforms, input } = setup(t, undefined, { baseUrl: address, timeoutMs: 1000 });
  const generation = createGeneration(db, { quota, channels, platforms, allowPrivateUpstreams: true });
  const text = await generation.execute(input);
  assert.equal(text.status, 'succeeded');
  assert.equal(text.output.text, 'HTTP 完成');
  assert.equal(received[0].headers.authorization, `Bearer ${apiKey}`);
  assert.equal(JSON.parse(received[0].raw).model, 'copy-model');
  const video = await generation.execute({ ...input, requestId: 'http-video', capability: 'video', seconds: 8, size: '1280x720' });
  assert.equal(video.status, 'running');
  const sentVideo = received.find(entry => entry.path === '/relay/v1/videos');
  assert.match(sentVideo.headers['content-type'], /^multipart\/form-data; boundary=/u);
  assert.match(sentVideo.raw, /name="model"\r\n\r\nvideo-model/u);
  assert.match(sentVideo.raw, /name="seconds"\r\n\r\n8/u);
  assert.equal((await generation.pollPending()).settled, 1);
  const content = await generation.getContent({ ...input, id: video.id });
  assert.equal(content.body.toString(), 'local-mp4-test-bytes');
  const redirect = await generation.execute({ ...input, requestId: 'http-redirect', prompt: 'redirect' });
  assert.equal(redirect.status, 'uncertain');
  assert.equal(received.some(entry => entry.path === '/must-not-follow'), false);
  const started = Date.now();
  const timeout = await generation.execute({ ...input, requestId: 'http-timeout', prompt: 'timeout' });
  assert.equal(timeout.status, 'uncertain');
  assert.ok(Date.now() - started < 2000);
  assert.equal(quota.balance(input).consumed, 4);
  assert.equal(quota.balance(input).reserved, 4);
  assert.equal(received.filter(entry => entry.method === 'POST').length, 4);
});

test('database failure during reserve rolls back both task and quota account updates', async t => {
  let calls = 0;
  const { db, quota, generation, input } = setup(t, async () => { calls += 1; return json({}); });
  db.exec("CREATE TRIGGER test_reject_generation_usage BEFORE INSERT ON quota_usage BEGIN SELECT RAISE(ABORT, 'simulated storage failure'); END");
  await assert.rejects(generation.execute(input));
  assert.equal(quota.balance(input).available, 20);
  assert.equal(quota.balance(input).reserved, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM generation_jobs').get().n, 0);
  assert.equal(calls, 0);
});
