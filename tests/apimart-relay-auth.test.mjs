import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { withApimartRelayAuth } from '../sidecar/apimart-relay-auth.mjs';
import { createQuota } from '../sidecar/quota.mjs';
import { createChannels } from '../sidecar/channels.mjs';
import { createPlatforms } from '../sidecar/platforms.mjs';
import { createGeneration } from '../sidecar/generation.mjs';

const origin = 'https://relay.aiglink.cn', secret = 'offline-relay-secret-not-production-1234567890';
const env = { APIMART_RELAY_ORIGIN: origin, APIMART_RELAY_SECRET: secret };
const safe = error => error.safeRejection === true && !error.message.includes(secret);
const routes = [['GET', '/v1/models'], ['POST', '/v1/chat/completions'], ['POST', '/v1/images/generations'],
  ['POST', '/v1/videos/generations'], ['GET', '/v1/tasks/task_123-abc'], ['POST', '/v1/uploads/images'],
  ['GET', '/v1/videos/video_123-abc/content']];
const fixtureKey = 'offline-provider-key';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

function useEnv(t, values) {
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  for (const key of Object.keys(env)) {
    if (values[key] === undefined) delete process.env[key]; else process.env[key] = values[key];
  }
  t.after(() => { for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } });
}
function fixture(t, fetchImpl, baseUrl = origin + '/v1') {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const quota = createQuota(db), channels = createChannels(db, { secret: 'isolated-storage-key' });
  const models = ['text', 'image', 'video'].map(capability => ({ capability, id: capability === 'video' ? 'seedance-2.5' : capability + '-fixture' }));
  channels.saveChannel({ id: 'relay-fixture', name: 'Offline only', baseUrl, protocol: 'apimart', apiKey: fixtureKey, models });
  const platforms = createPlatforms(db, { quota, channels });
  platforms.savePlatform({ id: 'fixture', name: 'Offline', bindings: models.map(model => ({ capability: model.capability, model: model.id, channelId: 'relay-fixture' })) });
  const code = quota.generateCodes({ projectId: 'fixture', quantity: 1, quota: { text: 5, image: 5, video: 5 } }).codes[0];
  quota.redeem({ projectId: 'fixture', userId: 'user-one', code });
  const generation = createGeneration(db, { quota, channels, platforms, fetchImpl });
  return { db, quota, generation, input: { projectId: 'fixture', userId: 'user-one', requestId: 'fixture-request', capability: 'text', prompt: 'Offline fixture' } };
}

test('only the configured exact HTTPS relay and supported routes receive its credential', () => {
  for (const [method, path] of routes) {
    const init = { method, headers: { Authorization: 'Bearer provider', 'Content-Type': 'application/json', 'Idempotency-Key': 'original-id' }, body: 'unchanged', redirect: 'follow' };
    const result = withApimartRelayAuth(origin + path, init, env);
    assert.equal(result.headers['X-Quota-Relay-Key'], secret);
    assert.equal(result.headers.Authorization, init.headers.Authorization);
    assert.equal(result.headers['Idempotency-Key'], 'original-id');
    assert.equal(result.body, init.body); assert.equal(result.redirect, 'manual');
    assert.equal('X-Quota-Relay-Key' in init.headers, false);
  }
  assert.equal(withApimartRelayAuth('https://RELAY.AIGLINK.CN/v1/models', {}, env).headers['X-Quota-Relay-Key'], secret);
});

test('direct APIMart and external media never receive relay headers in any supported header representation', () => {
  const variants = [{ Authorization: 'Bearer provider', 'X-QUOTA-RELAY-KEY': secret, 'x-quota-relay-key': 'forged' },
    new Headers({ authorization: 'Bearer provider', 'x-quota-relay-key': secret }),
    [['Authorization', 'Bearer provider'], ['X-Quota-Relay-Key', secret], ['x-QUOTA-relay-key', 'forged']]];
  for (const target of ['https://api.apimart.ai/v1/chat/completions', 'https://upload.apimart.ai/f/image/a.png',
    'https://cdn.example/video.mp4?signature=fixture', 'https://relay.aiglink.cn.attacker.invalid/v1/models',
    'https://relay.aiglink.cn@attacker.invalid/v1/models', 'https://relay.aiglink.cn./v1/models']) {
    for (const headers of variants) {
      const result = withApimartRelayAuth(target, { method: 'GET', headers }, env);
      assert.ok(!Object.keys(result.headers).some(name => name.toLowerCase() === 'x-quota-relay-key'));
      assert.equal(JSON.stringify(result).includes(secret), false);
      assert.equal(new Headers(result.headers).get('authorization'), 'Bearer provider');
    }
  }
});

test('missing or invalid relay settings fail closed only for the relay, without exposing values', () => {
  for (const config of [{}, { APIMART_RELAY_ORIGIN: origin }, { ...env, APIMART_RELAY_ORIGIN: 'https://attacker.invalid' },
    { ...env, APIMART_RELAY_ORIGIN: origin + '/' }, { ...env, APIMART_RELAY_SECRET: 'short' },
    { ...env, APIMART_RELAY_SECRET: 'x'.repeat(257) }, { ...env, APIMART_RELAY_SECRET: secret + '\n' }]) {
    assert.throws(() => withApimartRelayAuth(origin + '/v1/models', {}, config), safe);
    assert.doesNotThrow(() => withApimartRelayAuth('https://api.apimart.ai/v1/models', {}, config));
  }
});

test('alternate schemes, ports, userinfo, queries, encoded paths and unsupported methods are rejected', () => {
  for (const target of ['http://relay.aiglink.cn/v1/models', 'ftp://relay.aiglink.cn/v1/models',
    'https://relay.aiglink.cn:8443/v1/models', 'https://relay.aiglink.cn:443/v1/models', 'https://user@relay.aiglink.cn/v1/models',
    'https://user:pass@relay.aiglink.cn/v1/models', origin + '/v1/models?target=https://attacker.invalid',
    origin + '/v1/models#fragment', origin + '/v1/%6dodels', origin + '/v1/tasks/a/b', origin + '/health']) {
    assert.throws(() => withApimartRelayAuth(target, {}, env), safe);
  }
  for (const method of ['POST', 'HEAD', 'OPTIONS', 'DELETE']) {
    assert.throws(() => withApimartRelayAuth(origin + '/v1/models', { method }, env), safe);
  }
});

test('generation, upload and polling use relay auth while image/video CDN fetches receive no credentials', async t => {
  useEnv(t, env);
  const calls = [];
  const { generation, input, quota, db } = fixture(t, async (address, init) => {
    calls.push([address, init.method]); assert.equal(init.redirect, 'manual');
    if (address.startsWith('https://assets.fixture.invalid/')) {
      assert.deepEqual(init.headers, {});
      return new Response(address.endsWith('.png') ? png : Buffer.from([0,0,0,24,102,116,121,112,105,115,111,109,0,0,0,0,105,115,111,109]), { headers: { 'content-type': address.endsWith('.png') ? 'image/png' : 'video/mp4' } });
    }
    assert.ok(address.startsWith(origin + '/v1/'));
    assert.equal(init.headers['X-Quota-Relay-Key'], secret); assert.equal(init.headers.Authorization, 'Bearer ' + fixtureKey);
    if (address.endsWith('/uploads/images')) return Response.json({ url: 'https://upload.apimart.ai/f/image/reference.png' });
    if (address.endsWith('/chat/completions')) return Response.json({ choices: [{ message: { content: '{"answer":"offline"}' } }] });
    if (address.endsWith('/videos/generations')) assert.equal(JSON.parse(init.body).duration,15);
    if (init.method === 'POST') return Response.json({ code: 200, data: [{ task_id: address.endsWith('/images/generations') ? 'image-task' : 'video-task', status: 'submitted' }] });
    const image = address.endsWith('/tasks/image-task');
    assert.ok(image || address.endsWith('/tasks/video-task'));
    return Response.json({ code: 200, data: { id: image ? 'image-task' : 'video-task', status: 'completed', result: image
      ? { images: [{ url: ['https://assets.fixture.invalid/result.png'] }] }
      : { videos: [{ url: ['https://assets.fixture.invalid/result.mp4'] }] } } });
  });
  for (const capability of ['text', 'image', 'video']) {
    const request = { ...input, capability, requestId: 'fixture-' + capability,
      ...(capability === 'text' ? { responseFormat: 'json_object' } : capability === 'image' ? { referenceImage: 'data:image/png;base64,' + png.toString('base64') } : { seconds:15 }) };
    let job = await generation.execute(request);
    if (capability !== 'text') job = await generation.getJob({ ...input, id: job.id, refresh: true });
    assert.equal(job.status, 'ready');
    const done = await generation.acceptDelivery({ ...input, id: job.id }); assert.equal(done.status, 'succeeded');
    const posts = calls.filter(([, method]) => method === 'POST').length;
    assert.equal((await generation.execute(request)).id, job.id);
    assert.equal(calls.filter(([, method]) => method === 'POST').length, posts);
    assert.equal(JSON.stringify(done).includes(secret), false);
  }
  assert.equal(quota.balance(input).consumed, 3);
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM generation_jobs').all()).includes(secret), false);
  assert.equal(calls.filter(([address]) => address.startsWith('https://assets.fixture.invalid/')).length, 2);
});

test('a relay redirect or transport error never causes another request or exposes the secret', async t => {
  useEnv(t, env);
  for (const fail of ['redirect', 'error']) {
    let calls = 0;
    const { generation, input } = fixture(t, async (_address, init) => {
      calls++; assert.equal(init.redirect, 'manual'); assert.equal(init.headers['X-Quota-Relay-Key'], secret);
      if (fail === 'error') throw new Error('transport ' + secret);
      return new Response(null, { status: 307, headers: { location: 'https://attacker.invalid/collect' } });
    });
    const job = await generation.execute(input); assert.equal(job.status, 'uncertain'); assert.equal(calls, 1);
    assert.equal(JSON.stringify(job).includes(secret), false);
  }
});

test('missing relay secret prevents network and refunds reservation, while original direct API still works', async t => {
  useEnv(t, {});
  let relayCalls = 0;
  const relay = fixture(t, async () => { relayCalls++; throw new Error('must not call'); });
  const blocked = await relay.generation.execute(relay.input);
  assert.equal(blocked.status, 'failed'); assert.equal(relayCalls, 0); assert.equal(relay.quota.balance(relay.input).reserved, 0);
  assert.equal(relay.quota.balance(relay.input).consumed, 0);
  let directCalls = 0;
  const direct = fixture(t, async (_address, init) => {
    directCalls++; assert.equal(new Headers(init.headers).get('x-quota-relay-key'), null);
    assert.equal(init.headers.Authorization, 'Bearer ' + fixtureKey);
    return Response.json({ choices: [{ message: { content: 'offline direct fixture' } }] });
  }, 'https://api.apimart.ai/v1');
  assert.equal((await direct.generation.execute(direct.input)).status, 'succeeded'); assert.equal(directCalls, 1);
});
