import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {synthesizeSpeech} from '../runtime/film-providers.mjs';

// No real credentials or provider calls. Each run uses a fresh temporary folder.
const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'zdx-film-auth-'));
const audio = Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 4, 1, 2, 3, 4]);
let requests = 0;
const response = () => new Response([
  `data: ${JSON.stringify({code: 0, data: audio.toString('base64')})}\n\n`,
  `data: ${JSON.stringify({code: 0, sentence: {text: '岚县。', words: [{word: '岚县。', startTime: 0.1, endTime: 1.2}]}})}\n\n`,
  'data: {"code":20000000,"data":null}\n\n',
].join(''), {headers: {'content-type': 'text/event-stream'}});
function inspect(expected) {
  return async (url, init) => {
    requests++;
    assert.equal(url, 'https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse');
    assert.equal(init.redirect, 'manual');
    assert.equal(init.headers['X-Api-Resource-Id'], 'seed-tts-2.0');
    assert.equal(init.headers['X-Api-Request-Id'], 'test-request');
    for (const key of ['X-Api-Key', 'X-Api-App-Id', 'X-Api-Access-Key', 'X-Api-App-Key']) {
      assert.equal(init.headers[key], expected[key]);
    }
    const payload = JSON.parse(init.body);
    assert.equal(payload.req_params.speaker, 'zh_female_zhixingnv_uranus_bigtts');
    assert.equal(payload.req_params.audio_params.enable_subtitle, true);
    assert.equal(payload.req_params.text, '岚县。');
    assert.equal(JSON.parse(payload.req_params.additions).cache_config, undefined);
    return response();
  };
}
const base = {text: '岚县。', requestId: 'test-request'};
const legacy = await synthesizeSpeech({...base, appId: '123456789', accessToken: 'legacy-test-token', destination: path.join(folder, 'legacy.mp3'), fetchImpl: inspect({'X-Api-App-Id': '123456789', 'X-Api-Access-Key': 'legacy-test-token'})});
assert.deepEqual(await fs.readFile(legacy.path), audio);
assert.deepEqual(legacy.subtitles, [{text: '岚县。', start: 0.1, end: 1.2}]);
await synthesizeSpeech({...base, apiKey: '', appId: '123456789', accessToken: 'legacy-test-token', destination: path.join(folder, 'legacy-empty-key.mp3'), fetchImpl: inspect({'X-Api-App-Id': '123456789', 'X-Api-Access-Key': 'legacy-test-token'})});
await synthesizeSpeech({...base, apiKey: 'new-test-key', destination: path.join(folder, 'new-key.mp3'), fetchImpl: inspect({'X-Api-Key': 'new-test-key'})});
await synthesizeSpeech({...base, apiKey: 'new-test-key', appId: 'ignored-app', accessToken: 'ignored-token', destination: path.join(folder, 'new-key-precedence.mp3'), fetchImpl: inspect({'X-Api-Key': 'new-test-key'})});

for (const credentials of [
  {}, {appId: '123456789'}, {accessToken: 'legacy-test-token'},
  {appId: '123\r\nX-Injected: bad', accessToken: 'legacy-test-token'},
  {appId: '123456789', accessToken: 'bad\r\nX-Injected: bad'},
  {apiKey: ' ', appId: '123456789', accessToken: 'legacy-test-token'},
]) {
  await assert.rejects(synthesizeSpeech({...base, ...credentials, destination: path.join(folder, 'must-not-exist.mp3'), fetchImpl: async () => { throw Error('Must not call the provider'); }}), error => error.code === 'INVALID_CONFIGURATION' && error.uncertain === false && !error.message.includes('legacy-test-token'));
}
await assert.rejects(fs.access(path.join(folder, 'must-not-exist.mp3')));
await assert.rejects(synthesizeSpeech({...base, appId: '123456789', accessToken: 'legacy-test-token', destination: path.join(folder, 'network-failure.mp3'), fetchImpl: async () => { throw Error('legacy-test-token'); }}), error => error.uncertain === true && !error.message.includes('legacy-test-token'));
assert.equal(requests, 4);
console.log(JSON.stringify({ok: true, scenarios: 11, realProviderCalls: 0, temporaryArtifacts: folder}));
