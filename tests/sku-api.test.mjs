import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createQuota } from '../sidecar/quota.mjs';
import { createCommerce } from '../sidecar/commerce.mjs';
import { createChannels } from '../sidecar/channels.mjs';

const secret = 'test-only-sku-api-config-secret';
const base = { id: 'creator', projectId: 'creator', name: '创作工具', units: 100, priceCents: 1990,
  customPricing: { enabled: true, minUnits: 1, maxUnits: 1000, unitPriceMicros: 199000 } };
const sku = (patch = {}) => ({ id: 'standard', label: '文字与视频', units: 100, priceCents: 1990,
  capabilities: ['text', 'video'], apiBindings: [
    { capability: 'text', channelId: 'relay-a', model: 'text-a' },
    { capability: 'video', channelId: 'relay-b', model: 'video-b' },
  ], ...patch });
const hasStatus = expected => error => error?.status === expected;

function setup(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const quota = createQuota(db);
  quota.createProject({ id: 'creator', name: '创作工具' });
  quota.createProject({ id: 'other', name: '其他工具' });
  const channels = createChannels(db, { secret });
  const channelA = { id: 'relay-a', name: '中转站 A', baseUrl: 'https://relay-a.example/v1', enabled: true,
    apiKey: 'test-only-upstream-key-a', models: [{ id: 'text-a', capability: 'text' }, { id: 'image-a', capability: 'image' }] };
  const channelB = { id: 'relay-b', name: '中转站 B', baseUrl: 'https://relay-b.example/api', enabled: true,
    apiKey: 'test-only-upstream-key-b', models: [{ id: 'video-b', capability: 'video' }] };
  channels.saveChannel(channelA);
  channels.saveChannel(channelB);
  const commerce = createCommerce(db, { quota, secret, channels });
  return { db, quota, channels, commerce, channelA, channelB };
}

test('SKU combinations bind each capability independently and hide routes from customers', t => {
  const { commerce } = setup(t);
  const configured = sku();
  commerce.saveProduct({ ...base, packageOptions: [configured, sku({ id: 'all', label: '全能创作', capabilities: ['video', 'image', 'text'],
    apiBindings: [...configured.apiBindings, { capability: 'image', channelId: 'relay-a', model: 'image-a' }] })] });
  const admin = commerce.listProducts({ admin: true })[0];
  assert.deepEqual(admin.packageOptions[0].apiBindings, configured.apiBindings);
  assert.deepEqual(admin.packageOptions[1].capabilities, ['text', 'image', 'video']);
  const publicProducts = commerce.listProducts();
  assert.deepEqual(publicProducts[0].packageOptions[0].capabilities, ['text', 'video']);
  assert.ok(!JSON.stringify(publicProducts).includes('relay-a'));
  assert.ok(!JSON.stringify(publicProducts).includes('text-a'));
  assert.ok(!JSON.stringify(commerce.listProducts({ admin: 'true' })).includes('apiBindings'));
  commerce.generateInventory({ productId: base.id, packageId: 'all', quantity: 1 });
  const order = commerce.createOrder({ productId: base.id, email: 'buyer@example.com', packageId: 'all',
    capabilities: ['image'], apiBindings: [{ capability: 'image', channelId: 'evil', model: 'evil' }] });
  assert.deepEqual(order.capabilities, ['text', 'image', 'video']);
  assert.equal(order.units, 100);
  assert.ok(!JSON.stringify(order).includes('apiBindings'));
  assert.ok(!JSON.stringify(commerce.getOrder(order)).includes('relay-'));
  assert.ok(!JSON.stringify(commerce.listOrders()).includes('relay-'));
});

test('SKU binding validation rejects invalid capability combinations and model mismatches', t => {
  const { commerce } = setup(t);
  for (const capabilities of [null, 'text', ['audio'], ['text', 'text'], ['text', 'image', 'video', 'text']]) {
    assert.throws(() => commerce.saveProduct({ ...base, packageOptions: [sku({ capabilities })] }), hasStatus(400));
  }
  for (const apiBindings of [null, {}, [null], [sku().apiBindings[0], sku().apiBindings[0]],
    [{ capability: 'image', channelId: 'relay-a', model: 'image-a' }],
    [{ capability: 'text', channelId: 'relay-a', model: 'image-a' }],
    [{ capability: 'text', channelId: 'relay-b', model: 'text-a' }]]) {
    assert.throws(() => commerce.saveProduct({ ...base, packageOptions: [sku({ apiBindings })] }));
  }
  assert.throws(() => commerce.saveProduct({ ...base, packageOptions: [sku({ apiBindings: [{ capability: 'text', channelId: 'missing', model: 'text-a' }] })] }));
  // A capability can be named before an operator has configured its upstream.
  assert.doesNotThrow(() => commerce.saveProduct({ ...base, packageOptions: [sku({ capabilities: ['image'], apiBindings: [] })] }));
});

test('omitted API fields preserve configuration; explicit empty arrays remove it', t => {
  const { commerce } = setup(t);
  commerce.saveProduct({ ...base, packageOptions: [sku()] });
  const retained = commerce.saveProduct({ ...base, packageOptions: [{ id: 'standard', label: '改名', units: 100, priceCents: 1990 }] });
  assert.deepEqual(retained.packageOptions[0].apiBindings, sku().apiBindings);
  assert.deepEqual(retained.packageOptions[0].capabilities, ['text', 'video']);
  const cleared = commerce.saveProduct({ ...base, packageOptions: [sku({ capabilities: [], apiBindings: [] })] });
  assert.deepEqual(cleared.packageOptions[0].apiBindings, []);
  assert.deepEqual(cleared.packageOptions[0].capabilities, []);
});

test('orders retain private routing snapshots while channel changes gate only new orders', t => {
  const { db, commerce, channels, channelA } = setup(t);
  commerce.saveProduct({ ...base, packageOptions: [sku()] });
  commerce.generateInventory({ productId: base.id, packageId: 'standard', quantity: 2 });
  const order = commerce.createOrder({ productId: base.id, email: 'buyer@example.com', packageId: 'standard' });
  const storedBefore = db.prepare('SELECT capabilities,api_bindings FROM shop_orders WHERE id=?').get(order.id);
  assert.deepEqual(JSON.parse(storedBefore.api_bindings), sku().apiBindings);
  assert.ok(!JSON.stringify(storedBefore).includes('test-only-upstream-key'));
  channels.saveChannel({ ...channelA, apiKey: '', enabled: false });
  // Disabled channel configuration remains editable and visible to the owner.
  assert.doesNotThrow(() => commerce.saveProduct({ ...base, packageOptions: [sku()] }));
  assert.throws(() => commerce.createOrder({ productId: base.id, email: order.email, packageId: 'standard' }), hasStatus(409));
  commerce.saveProduct({ ...base, packageOptions: [sku({ capabilities: ['image'], apiBindings: [{ capability: 'image', channelId: 'relay-a', model: 'image-a' }] })] });
  const storedAfter = db.prepare('SELECT capabilities,api_bindings FROM shop_orders WHERE id=?').get(order.id);
  assert.deepEqual(storedAfter, storedBefore);
  assert.deepEqual(commerce.getOrder(order).capabilities, ['text', 'video']);
});

test('custom counts inherit platform routing and cross-platform SKU edits are rejected', t => {
  const { db, commerce } = setup(t);
  const foreign = sku({ id: 'standard', projectId: 'other' });
  const matching = sku({ id: 'images', label: '图片生成', capabilities: ['image'], apiBindings: [{ capability: 'image', channelId: 'relay-a', model: 'image-a' }] });
  assert.throws(() => commerce.saveProduct({ ...base, packageOptions: [foreign, matching] }), hasStatus(400));
  commerce.saveProduct({ ...base, packageOptions: [matching] });
  commerce.generateInventory({ productId: base.id, units: 7, quantity: 3 });
  const custom = commerce.createOrder({ productId: base.id, email: 'buyer@example.com', customUnits: 7 });
  assert.equal(custom.projectId, base.projectId);
  assert.deepEqual(custom.capabilities, ['image']);
  assert.equal(custom.priceCents, 140);
  assert.equal(custom.units, 7);
  assert.deepEqual(JSON.parse(db.prepare('SELECT api_bindings FROM shop_orders WHERE id=?').get(custom.id).api_bindings), matching.apiBindings);
  commerce.saveProduct({ ...base, packageOptions: [sku({ capabilities: [], apiBindings: [] })] });
  const noDefault = commerce.createOrder({ productId: base.id, email: custom.email, customUnits: 7 });
  assert.deepEqual(noDefault.capabilities, []);
  assert.equal(db.prepare('SELECT api_bindings FROM shop_orders WHERE id=?').get(noDefault.id).api_bindings, '[]');
  commerce.saveProduct({ ...base, packageOptions: [matching, sku({ projectId: base.projectId })] });
  const defaultStandard = commerce.createOrder({ productId: base.id, email: custom.email, customUnits: 7 });
  assert.deepEqual(defaultStandard.capabilities, ['text', 'video']);
});

test('legacy orders upgrade with empty routing metadata without changing price or identity', t => {
  const { db, commerce, quota, channels } = setup(t);
  commerce.saveProduct(base);
  commerce.generateInventory({ productId: base.id, packageId: 'standard', quantity: 1 });
  const original = commerce.createOrder({ productId: base.id, email: 'legacy@example.com' });
  db.exec('ALTER TABLE shop_orders DROP COLUMN capabilities; ALTER TABLE shop_orders DROP COLUMN api_bindings;');
  const upgraded = createCommerce(db, { quota, secret, channels });
  const { token, ...publicOriginal } = original;
  assert.deepEqual(upgraded.getOrder(original), { ...publicOriginal, capabilities: [] });
});
