import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { parseUpstreamBody as parseSidecar } from '../sidecar/upstream-body.mjs';
import { assembleServerSentEvents as assembleDing, parseUpstreamBody as parseDing } from '../apps/dingxiaosui/lib/upstream-body.ts';
import { apimartPayload } from '../sidecar/apimart.mjs';
import { textPayload } from '../sidecar/generation-options.mjs';
import { apimartImagePayload, apimartVideoPayload, APIMART_IMAGE_MODEL, APIMART_VIDEO_MODEL } from '../apps/dingxiaosui/lib/apimart-protocol.ts';
import { createChannels } from '../sidecar/channels.mjs';
import { createGeneration } from '../sidecar/generation.mjs';
import { createPlatforms } from '../sidecar/platforms.mjs';
import { createQuota } from '../sidecar/quota.mjs';
import { createSiteSettings, redeemLink } from '../sidecar/site-settings.mjs';

const sse = [
  'data: {"choices":[{"index":0,"delta":{"content":"{\\"copy\\":"}}]}',
  '',
  'data: {"choices":[{"index":0,"delta":{"content":"\\"山西小米\\"}"}}]}',
  '',
  'data: {"id":"chatcmpl-test","usage":{"prompt_tokens":4,"completion_tokens":6}}',
  'data: [DONE]',
  '',
].join('\n');

test('JSON and SSE chat bodies both become one completion', () => {
  const jsonBody = '{"choices":[{"message":{"content":"直接 JSON"}}]}';
  for (const parse of [parseSidecar, parseDing]) {
    assert.equal(parse(jsonBody).choices[0].message.content, '直接 JSON');
    const streamed = parse(sse);
    assert.equal(streamed.choices[0].message.content, '{"copy":"山西小米"}');
    assert.equal(streamed.usage.completion_tokens, 6);
    assert.equal(streamed.id, 'chatcmpl-test');
  }
  assert.equal(assembleDing(sse).choices[0].message.content, '{"copy":"山西小米"}');
});

test('every APIMart generation payload explicitly disables streaming', () => {
  const text = textPayload({ prompt: '写一句', capability: 'text' }, 'deepseek-v4.1-flash', 1024);
  assert.equal(text.stream, false);
  const image = apimartPayload({ capability: 'image', prompt: '一张梨' }, 'gpt-image-2.5-flare');
  assert.equal(image.stream, false);
  const video = apimartPayload({ capability: 'video', prompt: '一段梨园' }, 'seedance-2.0-mini');
  assert.equal(video.stream, false);
  assert.equal(apimartImagePayload(APIMART_IMAGE_MODEL, '一张梨', '1:1').stream, false);
  assert.equal(apimartVideoPayload(APIMART_VIDEO_MODEL, '一段梨园', '16:9', 15).stream, false);
});

test('a streamed APIMart copy is accepted when stream:false was sent', async t => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const quota = createQuota(db);
  const channels = createChannels(db, { secret: 'stream-parse-test-secret' });
  channels.saveChannel({ id: 'relay', name: '测试', protocol: 'apimart', baseUrl: 'https://api.apimart.ai/v1', apiKey: 'not-real',
    models: [{ id: 'deepseek-v4.1-flash', capability: 'text' }] });
  const platforms = createPlatforms(db, { quota, channels });
  platforms.savePlatform({ id: 'dingxiaosui', name: '丁小穗', bindings: [{ capability: 'text', channelId: 'relay', model: 'deepseek-v4.1-flash' }] });
  let sentStream;
  const generation = createGeneration(db, { quota, channels, platforms, fetchImpl: async (_url, init) => {
    sentStream = JSON.parse(init.body).stream;
    return new Response(sse, { headers: { 'content-type': 'text/event-stream' } });
  } });
  const code = quota.generateCodes({ projectId: 'dingxiaosui', quantity: 1, units: 1 }).codes[0];
  quota.redeem({ projectId: 'dingxiaosui', userId: 'writer', code });
  const result = await generation.execute({ projectId: 'dingxiaosui', userId: 'writer', requestId: 'sse-copy', capability: 'text', prompt: '写', responseFormat: 'json_object' });
  assert.equal(sentStream, false);
  assert.equal(result.status, 'ready');
  assert.equal(result.output.text, '{"copy":"山西小米"}');
});

test('leader card redeem links use the production origin, not the workbench path', () => {
  const db = new DatabaseSync(':memory:');
  const settings = createSiteSettings(db);
  assert.equal(settings.save({ dingxiaosuiOrigin: 'https://zdx.aiglink.cn/workbench.html' }).dingxiaosuiOrigin, 'https://zdx.aiglink.cn');
  const code = 'QTA-ABCD-EFGH-JKMN-PQRS';
  assert.equal(redeemLink(settings.get().dingxiaosuiOrigin, code), `https://zdx.aiglink.cn/redeem?code=${encodeURIComponent(code)}`);
  db.close();
});
