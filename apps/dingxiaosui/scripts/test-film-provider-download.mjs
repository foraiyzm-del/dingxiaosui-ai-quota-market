import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import dns from 'node:dns/promises';
import https from 'node:https';
import {EventEmitter} from 'node:events';
import {syncBuiltinESMExports} from 'node:module';
import {downloadVideo} from '../runtime/film-providers.mjs';

// Every transport is replaced before execution. This never invokes a provider,
// public resolver, real TLS socket, or a metered API.
const originals = {lookup: dns.lookup, request: https.request, fetch: globalThis.fetch};
const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'zdx-film-download-'));
const host = 'ark-acg-cn-beijing.tos-cn-beijing.volces.com';
const signedUrl = `https://${host}/private-media.mp4?signature=DO-NOT-LOG`;
const mp4 = Buffer.from([0, 0, 0, 20, ...Buffer.from('ftypisom'), 0, 0, 0, 0]);
let state;
let scenarios = 0;

function reset(extra = {}) {
  state = {
    answers: [{address: '220.181.116.113', family: 4}],
    lookupCalls: 0, dohCalls: 0, socketCalls: 0, destroyed: false,
    status: 200, bytes: mp4, complete: true,
    ...extra,
  };
}
function dnsResponse() {
  return {
    Status: 0, Question: [{name: `${host}.`, type: 1}],
    Answer: [
      {name: `${host}.`, type: 5, data: 'ark-content-sd.cn-beijing.tos.volces.com.'},
      {name: 'ark-content-sd.cn-beijing.tos.volces.com.', type: 5, data: 'tos46-cp-public.cn-beijing.tos.volces.com.'},
      {name: 'tos46-cp-public.cn-beijing.tos.volces.com.', type: 1, data: '220.181.116.113'},
    ],
  };
}
dns.lookup = async (name, options) => {
  assert.equal(name, host);
  assert.deepEqual(options, {all: true, verbatim: true});
  state.lookupCalls++;
  // A second lookup would be a DNS-rebinding bug.
  assert.equal(state.lookupCalls, 1);
  return state.answers;
};
globalThis.fetch = async (url, options) => {
  state.dohCalls++;
  const parsed = new URL(url);
  assert.equal(parsed.origin + parsed.pathname, 'https://cloudflare-dns.com/dns-query');
  assert.equal(parsed.searchParams.get('name'), host);
  assert.equal(parsed.searchParams.get('type'), 'A');
  assert.equal([...parsed.searchParams].length, 2);
  assert.equal(url.includes('DO-NOT-LOG'), false);
  assert.equal(options.redirect, 'manual');
  assert.equal(options.headers.accept, 'application/dns-json');
  return new Response(JSON.stringify(state.doh || dnsResponse()), {status: state.dohStatus || 200});
};
https.request = (url, options, receive) => {
  state.socketCalls++;
  assert.equal(url.href, signedUrl);
  assert.equal(options.agent, false);
  assert.equal(options.servername, host);
  assert.equal(options.rejectUnauthorized, true);
  assert.equal(options.autoSelectFamily, false);
  assert.equal(options.checkServerIdentity, undefined);
  const expected = state.expectedPinned || {address: '220.181.116.113', family: 4};
  options.lookup(host, {}, (error, address, family) => {
    assert.equal(error, null);
    assert.equal(address, expected.address);
    assert.equal(family, expected.family);
  });
  options.lookup(host, {all: true}, (error, addresses) => {
    assert.equal(error, null);
    assert.deepEqual(addresses, [expected]);
  });
  options.lookup('localhost', {}, error => assert.equal(error.code, 'UNSAFE_ASSET_URL'));
  const request = new EventEmitter();
  request.destroy = () => { state.destroyed = true; };
  request.end = () => queueMicrotask(() => {
    if (state.networkError) { request.emit('error', new Error('DO-NOT-LOG secret network diagnostic')); return; }
    const response = new EventEmitter();
    response.statusCode = state.status;
    response.headers = state.headers || {'content-length': String(state.bytes.length)};
    response.complete = state.complete;
    response.destroy = () => { state.destroyed = true; };
    receive(response);
    if (state.destroyed) return;
    response.emit('data', state.hugeChunk ? {length: 160 * 1024 * 1024 + 1} : state.bytes);
    if (!state.destroyed) response.emit('end');
  });
  return request;
};
syncBuiltinESMExports();

async function success(name) {
  const destination = path.join(folder, `${name}.mp4`);
  assert.deepEqual(await downloadVideo({url: signedUrl, destination}), {path: destination});
  assert.deepEqual(await fs.readFile(destination), mp4);
  assert.equal(state.socketCalls, 1);
  scenarios++;
}
async function rejected(name, code) {
  const destination = path.join(folder, `${name}.mp4`);
  await assert.rejects(downloadVideo({url: signedUrl, destination}), error => {
    assert.equal(error.code, code);
    assert.equal(error.message.includes('DO-NOT-LOG'), false);
    assert.equal(error.uncertain, false);
    return true;
  });
  await assert.rejects(fs.stat(destination), {code: 'ENOENT'});
  scenarios++;
}

try {
  reset();
  await success('public-ip-pinned');
  assert.equal(state.dohCalls, 0);

  reset({answers: [{address: '198.18.0.54', family: 4}]});
  await success('fake-ip-public-doh');
  assert.equal(state.dohCalls, 1);

  reset({answers: [{address: '198.19.1.1', family: 4}]});
  await success('fake-ip-second-range');

  const v6 = {address: '2408:8000:1::1', family: 6};
  reset({answers: [v6], expectedPinned: v6});
  await success('public-ipv6-pinned');

  for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '100.64.0.1', '192.168.1.1', '::1', '::ffff:127.0.0.1']) {
    reset({answers: [{address, family: address.includes(':') ? 6 : 4}]});
    await rejected(`private-${scenarios}`, 'UNSAFE_ASSET_URL');
    assert.equal(state.dohCalls + state.socketCalls, 0);
  }

  reset({answers: [{address: '198.18.0.54', family: 4}, {address: '10.0.0.1', family: 4}]});
  await rejected('fake-mixed-with-private', 'UNSAFE_ASSET_URL');
  assert.equal(state.dohCalls + state.socketCalls, 0);

  for (const corrupt of [
    value => { value.Question[0].name = 'another.example.'; },
    value => { value.Answer[2].data = '127.0.0.1'; },
    value => { value.Answer[2].data = '198.18.0.54'; },
    value => { value.Answer[2].name = 'unrelated.example.'; },
    value => { value.Status = 3; },
    value => { value.TC = true; },
  ]) {
    const doh = dnsResponse(); corrupt(doh);
    reset({answers: [{address: '198.18.0.54', family: 4}], doh});
    await rejected(`invalid-doh-${scenarios}`, 'UNSAFE_ASSET_URL');
    assert.equal(state.socketCalls, 0);
  }

  reset({answers: [{address: '198.18.0.54', family: 4}], dohStatus: 302});
  await rejected('doh-redirect', 'UNSAFE_ASSET_URL');
  assert.equal(state.socketCalls, 0);

  reset({status: 302});
  await rejected('media-redirect', 'PROVIDER_HTTP_ERROR');
  assert.equal(state.socketCalls, 1);
  assert.equal(state.destroyed, true);

  reset({headers: {'content-length': String(160 * 1024 * 1024 + 1)}});
  await rejected('too-large-header', 'PROVIDER_TOO_LARGE');

  reset({headers: {}, hugeChunk: true});
  await rejected('too-large-stream', 'PROVIDER_TOO_LARGE');

  reset({complete: false});
  await rejected('incomplete-stream', 'PROVIDER_NETWORK_ERROR');

  reset({headers: {'content-length': String(mp4.length + 1)}});
  await rejected('wrong-length', 'PROVIDER_NETWORK_ERROR');

  reset({networkError: true});
  await rejected('tls-network-error-redacted', 'PROVIDER_NETWORK_ERROR');

  reset({bytes: Buffer.from('not a real MP4 file')});
  await rejected('wrong-media', 'INVALID_MEDIA');

  console.log(JSON.stringify({ok: true, scenarios, realNetworkCalls: 0, temporaryArtifacts: folder}));
} finally {
  dns.lookup = originals.lookup;
  https.request = originals.request;
  globalThis.fetch = originals.fetch;
  syncBuiltinESMExports();
}
