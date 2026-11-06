import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createQuota } from '../sidecar/quota.mjs';
import { createChannels } from '../sidecar/channels.mjs';
import { createPlatforms } from '../sidecar/platforms.mjs';
import { createGeneration } from '../sidecar/generation.mjs';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const uploadedUrl = 'https://getapib.org/image/offline-reference.png';
function fixture(t, fetchImpl, timeoutMs = 1000) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const quota = createQuota(db), channels = createChannels(db, { secret: 'offline-storage-key' });
  channels.saveChannel({ id: 'fixture', name: 'Offline only', protocol: 'apimart', baseUrl: 'https://api.apimart.ai/v1', timeoutMs,
    apiKey: 'offline-provider-key', models: [{ capability: 'image', id: 'gpt-image-2.5-flare' }] });
  const platforms = createPlatforms(db, { quota, channels });
  platforms.savePlatform({ id: 'fixture', name: 'Offline only', bindings: [{ capability: 'image', channelId: 'fixture', model: 'gpt-image-2.5-flare' }] });
  const code = quota.generateCodes({ projectId: 'fixture', quantity: 1, quota: { image: 2 } }).codes[0];
  quota.redeem({ projectId: 'fixture', userId: 'owner', code });
  return { db, quota, generation: createGeneration(db, { quota, channels, platforms, fetchImpl }),
    input: { projectId: 'fixture', userId: 'owner', requestId: 'offline-request', capability: 'image', prompt: 'Offline test', referenceImage: 'data:image/png;base64,'+png } };
}
function abortableHang(init) {
  return new Promise((resolve, reject) => {
    // An actual socket keeps the process alive while AbortSignal.timeout is unref'ed.
    const keepAlive = setTimeout(() => reject(new Error('test deadline exceeded')), 3000);
    init.signal.addEventListener('abort', () => { clearTimeout(keepAlive); reject(Object.assign(new Error('upload deadline'), {
      code: 'ABORT_ERR', cause: init.signal.reason,
      transport: { phase: 'body_sent', dnsMs: 2, tlsMs: 7, bodySentMs: 8, reusedSocket: false, url: 'must-not-be-logged', headers: { Authorization: 'must-not-be-logged' } },
    })); }, { once: true });
  });
}

test('an upload hanging after TLS gets a fresh deadline and one recovery, followed by one generation', async t => {
  const signals = [], bodies = []; let generations = 0;
  const { db, quota, generation, input } = fixture(t, async (url, init) => {
    if (url.endsWith('/uploads/images')) {
      signals.push(init.signal); bodies.push(init.body);
      assert.equal(init.headers['Content-Length'], String(Buffer.byteLength(init.body)));
      if (signals.length === 1) return abortableHang(init);
      assert.equal(init.signal.aborted, false); return Response.json({ url: uploadedUrl });
    }
    if (init.method === 'GET') return new Response(Buffer.from(png, 'base64'), { headers: { 'Content-Type': 'image/png' } });
    generations++; return Response.json({ code: 200, data: { id: 'offline-task', status: 'completed', result: { images: [{ url: ['https://getapib.org/image/result.png'] }] } } });
  });
  const inFlight = generation.execute(input);
  await new Promise(resolve => setTimeout(resolve, 0));
  const replay = await generation.execute(input);
  assert.equal(replay.status, 'running'); assert.equal(signals.length, 1); assert.equal(generations, 0);
  const job = await inFlight; assert.equal(replay.id, job.id);
  assert.equal(job.status, 'ready'); assert.equal(signals.length, 2); assert.equal(generations, 1);
  assert.notEqual(signals[0], signals[1]); assert.equal(signals[0].aborted, true);
  assert.deepEqual(bodies[0], bodies[1]);
  const audits = db.prepare("SELECT action,detail FROM generation_audit WHERE action LIKE 'reference.%' ORDER BY id").all();
  assert.deepEqual(audits.map(row => row.action), ['reference.upload_retry', 'reference.upload_succeeded']);
  const retry = JSON.parse(audits[0].detail), succeeded = JSON.parse(audits[1].detail);
  assert.equal(retry.category, 'timeout'); assert.equal(retry.attempts, 1);
  assert.equal(retry.transport.phase, 'body_sent'); assert.equal(retry.transport.tlsMs, 7);
  assert.equal(succeeded.attempts, 2);
  assert.equal(JSON.stringify(audits).includes('must-not-be-logged'), false);
  await generation.getContent({ ...input, id: job.id });
  assert.equal((await generation.acceptDelivery({ ...input, id: job.id })).status, 'succeeded');
  assert.equal(quota.balance(input).consumed, 1); assert.equal(quota.balance(input).reserved, 0);
  assert.equal((await generation.execute(input)).id, job.id); assert.equal(generations, 1); assert.equal(signals.length, 2);
});

test('two upload timeouts refund once and never create a model task or restart an existing request', async t => {
  let uploads = 0;
  const { db, quota, generation, input } = fixture(t, async (url, init) => {
    assert.ok(url.endsWith('/uploads/images')); uploads++; return abortableHang(init);
  });
  const job = await generation.execute(input);
  assert.equal(job.status, 'failed'); assert.equal(uploads, 2);
  assert.equal((await generation.execute(input)).id, job.id); assert.equal(uploads, 2);
  assert.equal(quota.balance(input).available, 2); assert.equal(quota.balance(input).reserved, 0);
  assert.equal(quota.balance(input).consumed, 0);
  assert.equal(db.prepare('SELECT status FROM quota_usage').get().status, 'cancelled');
  assert.equal(db.prepare('SELECT upstream_id FROM generation_jobs').get().upstream_id, null);
  const detail = JSON.parse(db.prepare("SELECT detail FROM generation_audit WHERE action='reference.upload_failed'").get().detail);
  assert.equal(detail.attempts, 2); assert.equal(detail.category, 'timeout');
});

for (const status of [408, 429, 502, 503, 504]) {
  test(`upload HTTP ${status} may recover once without repeating generation`, async t => {
    let uploads = 0, generations = 0;
    const { generation, input } = fixture(t, async url => {
      if (url.endsWith('/uploads/images')) return ++uploads === 1 ? new Response('', { status }) : Response.json({ url: uploadedUrl });
      generations++; return Response.json({ data: [{ task_id: 'offline-task', status: 'submitted' }] });
    });
    assert.equal((await generation.execute(input)).status, 'running'); assert.equal(uploads, 2); assert.equal(generations, 1);
  });
}
for (const status of [400, 401, 403, 413, 415]) {
  test(`upload HTTP ${status} is terminal without a retry`, async t => {
    let uploads = 0;
    const { generation, quota, input } = fixture(t, async url => {
      assert.ok(url.endsWith('/uploads/images')); uploads++; return new Response('', { status });
    });
    assert.equal((await generation.execute(input)).status, 'failed'); assert.equal(uploads, 1);
    assert.equal(quota.balance(input).available, 2);
  });
}

test('a recovered upload never retries an unknown generation result', async t => {
  let uploads = 0, generations = 0;
  const { generation, quota, input } = fixture(t, async url => {
    if (url.endsWith('/uploads/images')) {
      if (++uploads === 1) throw Object.assign(new Error('offline reset'), { code: 'ECONNRESET' });
      return Response.json({ url: uploadedUrl });
    }
    generations++; throw Object.assign(new Error('unknown model result'), { code: 'ECONNRESET' });
  });
  const job = await generation.execute(input);
  assert.equal(job.status, 'uncertain'); assert.equal(uploads, 2); assert.equal(generations, 1);
  assert.equal(quota.balance(input).reserved, 1); assert.equal(quota.balance(input).consumed, 0);
  await generation.execute(input); assert.equal(uploads, 2); assert.equal(generations, 1);
});

test('upload deadlines are capped at 30 seconds even when the channel permits longer requests', async t => {
  const original = AbortSignal.timeout, deadlines = [];
  AbortSignal.timeout = duration => { deadlines.push(duration); return original(duration); };
  t.after(() => { AbortSignal.timeout = original; });
  let uploads = 0;
  const { generation, input } = fixture(t, async url => {
    assert.ok(url.endsWith('/uploads/images')); uploads++; throw Object.assign(new Error('offline timeout'), { code: 'ETIMEDOUT' });
  }, 300000);
  assert.equal((await generation.execute(input)).status, 'failed');
  assert.equal(uploads, 2); assert.deepEqual(deadlines, [30000, 30000]);
});

test('a delayed backoff cannot start a new upload after the total 65 second deadline', async t => {
  const originalNow = Date.now, originalTimeout = globalThis.setTimeout;
  let clock = originalNow(), uploads = 0;
  Date.now = () => clock;
  globalThis.setTimeout = (callback, delay, ...args) => originalTimeout(() => {
    if (delay === 500) clock += 66000;
    callback(...args);
  }, delay === 500 ? 0 : delay);
  t.after(() => { Date.now = originalNow; globalThis.setTimeout = originalTimeout; });
  const { db, generation, quota, input } = fixture(t, async url => {
    assert.ok(url.endsWith('/uploads/images')); uploads++; return new Response('', { status: 503 });
  });
  assert.equal((await generation.execute(input)).status, 'failed'); assert.equal(uploads, 1);
  assert.equal(quota.balance(input).available, 2);
  const detail = JSON.parse(db.prepare("SELECT detail FROM generation_audit WHERE action='reference.upload_failed'").get().detail);
  assert.equal(detail.category, 'timeout'); assert.equal(detail.attempts, 1);
});
