import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { apimartUploadUrl } from '../sidecar/apimart-upload-url.mjs';
import { createQuota } from '../sidecar/quota.mjs';
import { createChannels } from '../sidecar/channels.mjs';
import { createPlatforms } from '../sidecar/platforms.mjs';
import { createGeneration } from '../sidecar/generation.mjs';

const key = 'isolated-provider-secret-1234';
const relayKey = 'isolated-relay-secret-5678';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const reference = 'data:image/png;base64,' + png.toString('base64');
const legacyUrl = 'https://upload.apimart.ai/f/image/reference.png';
const currentUrl = 'https://getapib.org/image/1793960000000-12345678-1234-1234-1234-123456789012-reference.png';
const signedUrl = currentUrl + '?signature=private%2Bsignature%2Fvalue&response-content-disposition=inline%3B%20filename%3Dreference.png';

function fixture(t, fetchImpl) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const quota = createQuota(db), channels = createChannels(db, { secret: 'isolated-storage-secret' });
  channels.saveChannel({ id: 'fixture', name: 'Offline only', protocol: 'apimart', baseUrl: 'https://api.apimart.ai/v1',
    apiKey: key, models: [{ capability: 'image', id: 'gpt-image-2.5-flare' }] });
  const platforms = createPlatforms(db, { quota, channels });
  platforms.savePlatform({ id: 'fixture', name: 'Offline only', bindings: [{ capability: 'image', channelId: 'fixture', model: 'gpt-image-2.5-flare' }] });
  const code = quota.generateCodes({ projectId: 'fixture', quantity: 1, quota: { image: 3 } }).codes[0];
  quota.redeem({ projectId: 'fixture', userId: 'owner', code });
  return { db, quota, generation: createGeneration(db, { quota, channels, platforms, fetchImpl }),
    input: { projectId: 'fixture', userId: 'owner', requestId: 'fixture-request', capability: 'image', prompt: 'Offline test', referenceImage: reference } };
}

test('upload URL validator accepts only the two exact HTTPS upload paths and preserves signed queries', () => {
  for (const value of [legacyUrl, currentUrl, signedUrl, currentUrl.replace('getapib.org', 'GETAPIB.ORG:443')]) {
    assert.equal(apimartUploadUrl(value, { secrets: [key, relayKey] }), new URL(value).href);
  }
  for (const value of [null, {}, '', ' '+currentUrl, currentUrl+'\n', currentUrl+'#', currentUrl+'#fragment',
    currentUrl.replace('https:', 'http:'), currentUrl.replace('getapib.org', 'getapib.org:8443'),
    currentUrl.replace('getapib.org', 'user@getapib.org'), currentUrl.replace('getapib.org', 'user:password@getapib.org'),
    currentUrl.replace('getapib.org', 'getapib.org.attacker.invalid'), currentUrl.replace('getapib.org', 'sub.getapib.org'),
    currentUrl.replace('getapib.org', 'getapib.org.'), currentUrl.replace('getapib.org', 'get%61pib.org'),
    currentUrl.replace('getapib.org', '127.0.0.1'), currentUrl.replace('getapib.org', '[::1]'),
    'https://getapib.org/image/', 'https://getapib.org/images/reference.png', 'https://getapib.org/f/image/reference.png',
    'https://upload.apimart.ai/image/reference.png', 'https://getapib.org/image/../private.png',
    'https://getapib.org/image/../image/reference.png',
    'https://getapib.org/image/%2e%2e/private.png', 'https://getapib.org/image/%2fprivate.png',
    'https://getapib.org/image/%255cprivate.png', currentUrl+'?value=%0d%0aheader',
    currentUrl+'?value=%00', currentUrl+'?value=\\bad', currentUrl+'?value=%zz',
    currentUrl+'?key='+key, currentUrl+'?key='+relayKey, currentUrl+'?key='+key.replace('isolated', '%69solated'),
    currentUrl+'?value='+'x'.repeat(8000)]) {
    assert.equal(apimartUploadUrl(value, { secrets: [key, relayKey] }), null);
  }
});

for (const [label, uploadedUrl] of [['original', legacyUrl], ['current', currentUrl], ['signed', signedUrl]]) {
  test(`${label} upload response feeds one image generation without fetching the reference CDN`, async t => {
    let uploads = 0, generations = 0;
    const { db, quota, generation, input } = fixture(t, async (url, init) => {
      assert.equal(init.redirect, 'manual'); assert.equal(init.headers.Authorization, 'Bearer '+key);
      if (url.endsWith('/uploads/images')) {
        uploads++; assert.ok(Buffer.isBuffer(init.body)); assert.ok(init.body.includes(png));
        assert.match(init.headers['Content-Type'], /^multipart\/form-data; boundary=/u);
        return Response.json({ url: uploadedUrl });
      }
      assert.equal(url, 'https://api.apimart.ai/v1/images/generations'); generations++;
      assert.deepEqual(JSON.parse(init.body).image_urls, [uploadedUrl]);
      return Response.json({ code: 200, data: [{ task_id: 'one-task', status: 'submitted' }] });
    });
    const job = await generation.execute(input);
    assert.equal(job.status, 'running'); assert.equal((await generation.execute(input)).id, job.id);
    assert.equal(uploads, 1); assert.equal(generations, 1); assert.equal(quota.balance(input).reserved, 1);
    assert.equal(JSON.stringify(db.prepare('SELECT * FROM generation_audit').all()).includes(uploadedUrl), false);
  });
}

const failures = [
  ['http rejection', 'http', () => Response.json({ error: key+signedUrl }, { status: 403 })],
  ['http redirect', 'http', () => new Response(null, { status: 302, headers: { location: 'https://attacker.invalid' } })],
  ['empty response', 'json', () => new Response('')],
  ['non-JSON response', 'json', () => new Response('<html>'+key+signedUrl)],
  ['wrapped undocumented URL', 'url', () => Response.json({ data: { url: currentUrl } })],
  ['foreign upload URL', 'url', () => Response.json({ url: 'https://getapib.org.attacker.invalid/image/reference.png?secret='+key })],
  ['secret in URL', 'url', () => Response.json({ url: currentUrl+'?secret='+key })],
  ['network exception', 'network', () => { throw Object.assign(new Error(key+signedUrl), { code: 'ECONNRESET' }); }],
  ['preconnect exception', 'network', () => { throw Object.assign(new Error(key), { code: 'ENOTFOUND', preconnect: true }); }],
  ['timeout exception', 'timeout', () => { throw Object.assign(new Error(key), { name: 'TimeoutError' }); }],
  ['Node abort timeout cause', 'timeout', () => { throw Object.assign(new Error(key), { code: 'ABORT_ERR', cause: { name: 'TimeoutError' } }); }],
  ['oversized response', 'json', () => { throw Object.assign(new Error(key), { code: 'UPSTREAM_RESPONSE_TOO_LARGE' }); }],
];
for (const [label, category, response] of failures) {
  test(`${label} cancels its hold, never generates or retries, and writes only safe diagnostic fields`, async t => {
    let uploads = 0;
    const { db, quota, generation, input } = fixture(t, async url => {
      assert.equal(url, 'https://api.apimart.ai/v1/uploads/images'); uploads++; return response();
    });
    const job = await generation.execute(input);
    assert.equal(job.status, 'failed'); assert.match(job.error, /尚未开始生成，预留次数已退回/u);
    assert.equal((await generation.execute(input)).id, job.id); assert.equal(uploads, 1);
    assert.equal(quota.balance(input).available, 3); assert.equal(quota.balance(input).reserved, 0);
    assert.equal(quota.balance(input).consumed, 0);
    assert.equal(db.prepare('SELECT status FROM quota_usage').get().status, 'cancelled');
    assert.equal(db.prepare('SELECT upstream_id FROM generation_jobs').get().upstream_id, null);
    const audit = db.prepare('SELECT action,detail FROM generation_audit').all(); assert.equal(audit.length, 1);
    assert.equal(audit[0].action, 'reference.upload_failed');
    const detail = JSON.parse(audit[0].detail); assert.equal(detail.category, category);
    assert.equal(Number.isSafeInteger(detail.elapsedMs), true);
    for (const forbidden of [key, relayKey, signedUrl, 'private%2Bsignature', reference]) {
      assert.equal(JSON.stringify({ job, audit }).includes(forbidden), false);
    }
    assert.ok(Object.keys(detail).every(name => ['category', 'elapsedMs', 'httpStatus', 'networkCode', 'preconnect'].includes(name)));
  });
}

test('an unknown generation result after a valid upload remains reserved and is never automatically resubmitted', async t => {
  let uploads = 0, generations = 0;
  const { quota, generation, input } = fixture(t, async url => {
    if (url.endsWith('/uploads/images')) { uploads++; return Response.json({ url: currentUrl }); }
    generations++; throw new Error('lost generation response');
  });
  const job = await generation.execute(input); assert.equal(job.status, 'uncertain');
  assert.equal((await generation.execute(input)).id, job.id);
  assert.equal(uploads, 1); assert.equal(generations, 1);
  assert.equal(quota.balance(input).reserved, 1); assert.equal(quota.balance(input).consumed, 0);
});
