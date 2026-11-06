import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { syncBuiltinESMExports } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { createQuota } from '../sidecar/quota.mjs';
import { createChannels } from '../sidecar/channels.mjs';
import { createPlatforms } from '../sidecar/platforms.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const mp4 = Buffer.from([0,0,0,20,102,116,121,112,105,115,111,109,0,0,0,0]);
const addresses = [{ address: '1.1.1.1', family: 4 }, { address: '2606:4700::1111', family: 6 }];

test('real shared transport gives every route the 2s family window, pins checked DNS, and does not retry unknown POSTs', async t => {
  const originals = { dns: dns.lookup, http: http.request, https: https.request };
  const calls = [], queries = [];
  let mode = 'success', hungUploads = 0, hungDns = 0;
  dns.lookup = async (hostname, options) => {
    queries.push(hostname); assert.deepEqual(options, { all: true });
    if (mode === 'dns-hung-once' && hungDns++ === 0) return new Promise(resolve => setTimeout(() => resolve(addresses), 1400));
    return addresses;
  };
  const request = (url, options, receive) => {
    const parsed = new URL(url);
    assert.equal(options.autoSelectFamily, true);
    assert.equal(options.autoSelectFamilyAttemptTimeout, 2000);
    assert.ok(options.signal instanceof AbortSignal);
    if (parsed.protocol === 'https:') { assert.equal(options.servername, parsed.hostname); assert.equal(options.rejectUnauthorized, true); }
    // The socket must reuse exactly the already-checked address list, not resolve again.
    options.lookup(parsed.hostname, { all: true }, (error, actual) => { assert.equal(error, null); assert.deepEqual(actual, addresses); });
    options.lookup(parsed.hostname, {}, (error, address, family) => { assert.equal(error, null); assert.equal(address, addresses[0].address); assert.equal(family, 4); });
    const call = { protocol: parsed.protocol, route: parsed.pathname, method: options.method, headers: options.headers, body: [] };
    calls.push(call);
    const pending = new EventEmitter();
    pending.write = body => call.body.push(Buffer.from(body));
    pending.end = () => queueMicrotask(() => {
      const socket = new EventEmitter(); socket.readyState = 'opening'; pending.emit('socket', socket);
      if (mode === 'upload-preconnect') { pending.emit('error', Object.assign(new Error('connection timed out'), { code: 'ETIMEDOUT' })); return; }
      socket.emit(parsed.protocol === 'https:' ? 'secureConnect' : 'connect');
      pending.emit('finish');
      if (['upload-hung-once', 'response-body-hung-once'].includes(mode) && call.route === '/v1/uploads/images' && hungUploads++ === 0) {
        const response = mode === 'response-body-hung-once' ? new PassThrough() : null;
        if (response) { response.statusCode = 200; response.headers = { 'content-type': 'application/json' }; receive(response); }
        const keepAlive = setTimeout(() => { throw new Error('isolated transport failed to abort'); }, 3000);
        options.signal.addEventListener('abort', () => {
          clearTimeout(keepAlive);
          (response || pending).emit('error', Object.assign(new Error('upload deadline'), { code: 'ABORT_ERR', cause: options.signal.reason }));
        }, { once: true });
        return;
      }
      if (mode === 'unknown-post') { pending.emit('error', Object.assign(new Error('connection lost after write'), { code: 'ECONNRESET' })); return; }
      let value, contentType = 'application/json';
      if (call.route === '/v1/uploads/images') {
        assert.ok(Buffer.concat(call.body).includes(png));
        value = { url: 'https://getapib.org/image/reference.png' };
      } else if (call.route === '/v1/chat/completions') value = { choices: [{ message: { content: 'isolated response' } }] };
      else if (call.route === '/v1/images/generations') value = { code: 200, data: [{ task_id: 'image-task', status: 'submitted' }] };
      else if (call.route === '/v1/videos/generations') value = { code: 200, data: [{ task_id: 'video-task', status: 'submitted' }] };
      else if (call.route === '/v1/tasks/image-task') value = { code: 200, data: { id: 'image-task', status: 'completed', result: { images: [{ url: ['https://getapib.org/image/result.png'] }] } } };
      else if (call.route === '/v1/tasks/video-task') value = { code: 200, data: { id: 'video-task', status: 'completed', result: { videos: [{ url: ['https://getapib.org/video/result.mp4'] }] } } };
      else if (call.route === '/image/result.png') { value = png; contentType = 'image/png'; assert.deepEqual(options.headers, {}); }
      else if (call.route === '/video/result.mp4') { value = mp4; contentType = 'video/mp4'; assert.deepEqual(options.headers, {}); }
      else throw new Error('Unexpected isolated route: '+call.route);
      const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value));
      const response = new PassThrough(); response.statusCode = 200; response.headers = { 'content-type': contentType, 'content-length': String(bytes.length) };
      receive(response); response.end(bytes);
    });
    return pending;
  };
  http.request = request; https.request = request; syncBuiltinESMExports();
  t.after(() => { dns.lookup = originals.dns; http.request = originals.http; https.request = originals.https; syncBuiltinESMExports(); });
  // Import after replacing DNS because the resolver captures its default dependency.
  const { createGeneration } = await import('../sidecar/generation.mjs');

  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const quota = createQuota(db), channels = createChannels(db, { secret: 'isolated-transport-storage' });
  const models = [{ capability: 'text', id: 'copy-fixture' }, { capability: 'image', id: 'gpt-image-2.5-flare' }, { capability: 'video', id: 'seedance-2.5' }];
  channels.saveChannel({ id: 'fixture', name: 'Offline only', protocol: 'apimart', baseUrl: 'https://api.apimart.ai/v1', apiKey: 'isolated-provider-key', models });
  const platforms = createPlatforms(db, { quota, channels });
  platforms.savePlatform({ id: 'fixture', name: 'Offline only', bindings: models.map(model => ({ capability: model.capability, channelId: 'fixture', model: model.id })) });
  const code = quota.generateCodes({ projectId: 'fixture', quantity: 1, quota: { text: 5, image: 5, video: 5 } }).codes[0];
  quota.redeem({ projectId: 'fixture', userId: 'owner', code });
  const generation = createGeneration(db, { quota, channels, platforms }); // No fetchImpl bypass.
  const base = { projectId: 'fixture', userId: 'owner', prompt: 'Isolated test' };
  for (const capability of ['text', 'image', 'video']) {
    const input = { ...base, capability, requestId: capability, ...(capability === 'image' ? { referenceImage: 'data:image/png;base64,'+png.toString('base64') } : {}) };
    const job = await generation.execute(input);
    if (capability !== 'text') {
      assert.equal((await generation.getJob({ ...base, id: job.id, refresh: true })).status, 'ready');
      assert.ok((await generation.getContent({ ...base, id: job.id })).body.length > 0);
      assert.equal((await generation.acceptDelivery({ ...base, id: job.id })).status, 'succeeded');
    } else assert.equal(job.status, 'succeeded', JSON.stringify({ error: job.error, routes: calls.map(call => call.route), queries }));
    const count = calls.length; assert.equal((await generation.execute(input)).id, job.id); assert.equal(calls.length, count);
  }
  assert.deepEqual(calls.map(call => call.method+' '+call.route), [
    'POST /v1/chat/completions', 'POST /v1/uploads/images', 'POST /v1/images/generations', 'GET /v1/tasks/image-task', 'GET /image/result.png',
    'POST /v1/videos/generations', 'GET /v1/tasks/video-task', 'GET /video/result.mp4',
  ]);
  assert.equal(queries.length, calls.length);

  channels.saveChannel({ id: 'http-fixture', name: 'Offline HTTP', baseUrl: 'http://api.fixture.test/v1', apiKey: 'isolated-key', models: [models[0]] });
  platforms.savePlatform({ id: 'http-fixture', name: 'Offline HTTP', bindings: [{ capability: 'text', channelId: 'http-fixture', model: models[0].id }] });
  const httpCode = quota.generateCodes({ projectId: 'http-fixture', quantity: 1, units: 1 }).codes[0];
  quota.redeem({ projectId: 'http-fixture', userId: 'owner', code: httpCode });
  assert.equal((await generation.execute({ ...base, projectId: 'http-fixture', capability: 'text', requestId: 'http-request' })).status, 'succeeded');
  assert.equal(calls.at(-1).protocol, 'http:');

  mode = 'upload-preconnect';
  const beforeUpload = calls.length, beforeBalance = quota.balance(base).available;
  const failedInput = { ...base, capability: 'image', requestId: 'failed-upload', referenceImage: 'data:image/png;base64,'+png.toString('base64') };
  const failed = await generation.execute(failedInput); assert.equal(failed.status, 'failed');
  assert.equal((await generation.execute(failedInput)).id, failed.id); assert.equal(calls.length, beforeUpload+2);
  assert.equal(calls.at(-1).route, '/v1/uploads/images'); assert.equal(quota.balance(base).available, beforeBalance);
  mode = 'unknown-post';
  const beforeUnknown = calls.length, unknownInput = { ...base, capability: 'image', requestId: 'unknown-generation' };
  const unknown = await generation.execute(unknownInput); assert.equal(unknown.status, 'uncertain');
  assert.equal((await generation.execute(unknownInput)).id, unknown.id); assert.equal(calls.length, beforeUnknown+1);
  assert.equal(quota.balance(base).reserved, 1);

  channels.saveChannel({ id: 'fixture', name: 'Offline only', protocol: 'apimart', baseUrl: 'https://api.apimart.ai/v1', models, timeoutMs: 1000 });
  for (const scenario of ['upload-hung-once', 'response-body-hung-once', 'dns-hung-once']) {
    mode = scenario; hungUploads = 0; hungDns = 0;
    const start = calls.length;
    const input = { ...base, capability: 'image', requestId: scenario, referenceImage: 'data:image/png;base64,'+png.toString('base64') };
    const job = await generation.execute(input); assert.equal(job.status, 'running');
    const detail = JSON.parse(db.prepare("SELECT detail FROM generation_audit WHERE job_id=? AND action='reference.upload_retry'").get(job.id).detail);
    assert.equal(detail.category, 'timeout'); assert.equal(detail.attempts, 1);
    assert.equal(detail.transport.phase, scenario === 'dns-hung-once' ? 'dns' : scenario === 'response-body-hung-once' ? 'response_headers' : 'body_sent');
    if (scenario === 'dns-hung-once') {
      assert.equal(detail.preconnect, true);
      // The expired first lookup must not create a late upload socket.
      assert.equal(calls.length - start, 2);
    } else {
      assert.equal(detail.preconnect, undefined); assert.equal(typeof detail.transport.tlsMs, 'number');
      assert.equal(typeof detail.transport.bodySentMs, 'number'); assert.equal(detail.transport.reusedSocket, false);
      assert.equal(calls.length - start, 3);
      if (scenario === 'response-body-hung-once') { assert.equal(detail.httpStatus, 200); assert.equal(typeof detail.transport.responseHeadersMs, 'number'); }
    }
    const beforeReplay = calls.length; await generation.execute(input); assert.equal(calls.length, beforeReplay);
  }
});
