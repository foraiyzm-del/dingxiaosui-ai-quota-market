import assert from 'node:assert/strict';
import { createDecipheriv, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createChannels } from '../sidecar/channels.mjs';
import { createCommerce } from '../sidecar/commerce.mjs';
import { createQuota } from '../sidecar/quota.mjs';

const secret = 'test-only-channel-encryption-secret';
const apiKey = 'sk-TEST-ONLY-super-secret-1234';
const channel = {
  id: 'relay-one', name: '测试中转站', baseUrl: 'https://relay.example/v1/', apiKey,
  models: [{ id: 'text-model', capability: 'text' }, { id: 'image-model', capability: 'image' }, { id: 'video-model', capability: 'video' }],
};
const status = code => error => error instanceof Error && error.status === code;

function setup(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  return { db, channels: createChannels(db, { secret }) };
}

function decrypt(row, id = row.id) {
  const key = createHash('sha256').update(`api-channel-key-encryption:${secret}`).digest();
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(row.key_iv, 'base64'));
  decipher.setAAD(Buffer.from(`api-channel:${id}`));
  decipher.setAuthTag(Buffer.from(row.key_tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(row.key_ciphertext, 'base64')), decipher.final()]).toString('utf8');
}

test('channels encrypt keys at rest and return only safe configuration records', t => {
  const { db, channels } = setup(t);
  const result = channels.saveChannel(channel);
  assert.equal(result.baseUrl, 'https://relay.example/v1');
  assert.equal(result.hasKey, true);
  assert.equal(result.keyHint, '••••1234');
  assert.deepEqual(result.models, channel.models);
  assert.equal(JSON.stringify(result).includes(apiKey), false);
  assert.equal('apiKey' in result, false);
  assert.deepEqual(channels.listChannels(), [result]);
  const stored = db.prepare('SELECT * FROM api_channels').get();
  assert.equal(JSON.stringify(stored).includes(apiKey), false);
  assert.equal(decrypt(stored), apiKey);
  assert.throws(() => decrypt(stored, 'different-channel'));
  assert.deepEqual(createChannels(db, { secret }).listChannels(), [result]);
});

test('editing preserves a blank or omitted key and replacing the key rotates ciphertext', t => {
  const { db, channels } = setup(t);
  const original = channels.saveChannel(channel);
  const row = () => db.prepare('SELECT * FROM api_channels').get();
  const ciphertext = row().key_ciphertext;
  const { apiKey: ignored, ...editable } = channel;
  channels.saveChannel({ ...editable, name: '改名' });
  assert.equal(row().key_ciphertext, ciphertext);
  channels.saveChannel({ ...editable, apiKey: '   ', enabled: false });
  assert.equal(row().key_ciphertext, ciphertext);
  assert.equal(channels.listChannels()[0].enabled, false);
  const replacement = channels.saveChannel({ ...editable, apiKey: 'sk-TEST-ONLY-new-key-5678' });
  assert.equal(replacement.createdAt, original.createdAt);
  assert.equal(replacement.keyHint, '••••5678');
  assert.notEqual(row().key_ciphertext, ciphertext);
  assert.equal(decrypt(row()), 'sk-TEST-ONLY-new-key-5678');
  channels.saveChannel({ ...editable, apiKey: 'tiny' });
  assert.equal(channels.listChannels()[0].keyHint, '••••');
});

test('channels validate URLs, keys, model capabilities and duplicate models without network access', t => {
  const { channels } = setup(t);
  const { apiKey: ignored, ...withoutKey } = channel;
  assert.throws(() => channels.saveChannel(withoutKey), status(400));
  for (const baseUrl of ['not-a-url', 'ftp://relay.example', 'https://user:pass@relay.example/v1', 'https://relay.example/v1?api_key=secret', 'https://relay.example/#key', 'https://relay.example/?', 'https://relay.example/#']) {
    assert.throws(() => channels.saveChannel({ ...channel, baseUrl }), status(400));
  }
  for (const apiKey of [null, 3, 'bad key', 'key\nforged', 'a'.repeat(4097)]) assert.throws(() => channels.saveChannel({ ...channel, apiKey }), status(400));
  for (const models of [[], Array(101).fill(channel.models[0]), [{ id: 'speech', capability: 'speech' }], [channel.models[0], channel.models[0]], [{ id: '', capability: 'text' }]]) {
    assert.throws(() => channels.saveChannel({ ...channel, models }), status(400));
  }
  assert.throws(() => channels.saveChannel({ ...channel, enabled: 'false' }), status(400));
  assert.throws(() => channels.saveChannel({ ...channel, id: 'bad/id' }), status(400));
  const local = channels.saveChannel({ ...channel, baseUrl: 'http://127.0.0.1:9000/provider/api///' });
  assert.equal(local.baseUrl, 'http://127.0.0.1:9000/provider/api');
  const modelAcrossCapabilities = [{ id: 'multimodal', capability: 'text' }, { id: 'multimodal', capability: 'image' }];
  assert.deepEqual(channels.saveChannel({ ...channel, models: modelAcrossCapabilities }).models, modelAcrossCapabilities);
});

test('SKU bindings require supported capabilities, enabled channels and exact model matches', t => {
  const { channels } = setup(t);
  channels.saveChannel(channel);
  const text = { capability: 'text', channelId: channel.id, model: 'text-model' };
  const image = { capability: 'image', channelId: channel.id, model: 'image-model' };
  assert.deepEqual(channels.validateBindings([text, image], ['text', 'image']), [text, image]);
  assert.deepEqual(channels.validateBindings([], []), []);
  for (const [bindings, capabilities] of [
    [[text], ['image']], [[text, text], ['text']], [[{ ...text, model: 'image-model' }], ['text']],
    [[{ ...text, capability: 'speech' }], ['speech']], [[text], ['text', 'text']],
  ]) assert.throws(() => channels.validateBindings(bindings, capabilities), status(400));
  assert.throws(() => channels.validateBindings([{ ...text, channelId: 'missing' }], ['text']), status(404));
  channels.saveChannel({ ...channel, apiKey: '', enabled: false });
  assert.throws(() => channels.validateBindings([text], ['text']), status(409));
  assert.deepEqual(channels.validateBindings([text], ['text'], { allowDisabled: true }), [text]);
});

test('referenced channel models cannot be removed until SKU bindings are replaced or removed', t => {
  const { db, channels } = setup(t);
  channels.saveChannel(channel);
  const quota = createQuota(db);
  quota.createProject({ id: 'creator', name: '创作工具' });
  const commerce = createCommerce(db, { quota, channels, secret });
  const option = { id: 'standard', label: '文字生成', units: 100, priceCents: 1990, capabilities: ['text'],
    apiBindings: [{ capability: 'text', channelId: channel.id, model: 'text-model' }] };
  const product = { id: 'creator', projectId: 'creator', name: '创作工具', units: 100, priceCents: 1990, packageOptions: [option] };
  commerce.saveProduct(product);
  const withoutText = channel.models.filter(model => model.capability !== 'text');
  const before = db.prepare('SELECT * FROM api_channels').get();
  assert.throws(() => channels.saveChannel({ ...channel, models: withoutText, apiKey: 'test-only-replacement-key' }), status(409));
  assert.deepEqual(db.prepare('SELECT * FROM api_channels').get(), before);
  // Removing an unused model is safe; disabling does not remove models or bindings.
  assert.doesNotThrow(() => channels.saveChannel({ ...channel, models: channel.models.filter(model => model.capability !== 'video'), apiKey: '' }));
  assert.doesNotThrow(() => channels.saveChannel({ ...channel, enabled: false, apiKey: '' }));
  assert.doesNotThrow(() => commerce.saveProduct({ ...product, active: false }));
  assert.throws(() => channels.saveChannel({ ...channel, enabled: false, models: withoutText, apiKey: '' }), status(409));
  commerce.saveProduct({ ...product, packageOptions: [{ ...option, apiBindings: [] }] });
  const saved = channels.saveChannel({ ...channel, models: withoutText, apiKey: '' });
  assert.deepEqual(saved.models, withoutText);
  assert.doesNotThrow(() => commerce.saveProduct({ ...product, packageOptions: [{ ...option, apiBindings: [] }], active: false }));
});

test('model removal fails safely on corrupt stored SKU JSON and does not expose its contents', t => {
  const { db, channels } = setup(t);
  channels.saveChannel(channel);
  db.exec('CREATE TABLE shop_products (package_options TEXT)');
  db.prepare('INSERT INTO shop_products(package_options) VALUES(?)').run('test-only-private-corrupt-value');
  const models = channel.models.filter(model => model.capability !== 'text');
  assert.throws(() => channels.saveChannel({ ...channel, models, apiKey: '' }), error => {
    assert.equal(error.status, 500);
    assert.equal(error.message.includes('test-only-private-corrupt-value'), false);
    return true;
  });
  assert.deepEqual(channels.listChannels()[0].models, channel.models);
  // A model-preserving stop operation remains available during repair.
  assert.doesNotThrow(() => channels.saveChannel({ ...channel, enabled: false, apiKey: '' }));
});
