import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createQuota } from '../sidecar/quota.mjs';
import { createCommerce } from '../sidecar/commerce.mjs';
import { createChannels } from '../sidecar/channels.mjs';
import { createPlatforms } from '../sidecar/platforms.mjs';

const combination = { text: 3, image: 1, video: 1 };
function setup(t) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const quota = createQuota(db); quota.createProject({ id: 'dingxiaosui', name: '丁小穗' });
  const commerce = createCommerce(db, { quota, secret: 'typed-quota-isolated-test-secret' });
  return { db, quota, commerce };
}
function product(overrides = {}) {
  return { id: 'dingxiaosui-combo', projectId: 'dingxiaosui', name: '丁小穗创作次数', units: 5, priceCents: 1290,
    fulfillment: 'on_payment', packageOptions: [{ id: 'combo', label: '图片1＋文案3＋视频1', quota: combination, priceCents: 1290 }], ...overrides };
}
function grant(quota, allocation = combination, units) {
  const issued = quota.generateCodes({ projectId: 'dingxiaosui', quantity: 1, quota: allocation, units });
  return quota.redeem({ projectId: 'dingxiaosui', userId: 'alice', code: issued.codes[0] });
}
const reserve = (quota, requestId, capability, units = 1) => quota.reserve({ projectId: 'dingxiaosui', userId: 'alice', requestId, capability, units });
const balance = quota => quota.balance({ projectId: 'dingxiaosui', userId: 'alice' });
const settle = (quota, usage, action) => quota.settle({ projectId: 'dingxiaosui', usageId: usage.id, action });

test('one combination code grants independent image/text/video quotas; omitted capability cannot bypass them', t => {
  const { quota } = setup(t);
  const redeemed = grant(quota);
  assert.equal(redeemed.units, 5); assert.deepEqual(redeemed.quota, combination);
  assert.equal(balance(quota).available, 5); assert.equal(balance(quota).shared.available, 0);
  assert.throws(() => reserve(quota, 'unspecified'), { status: 402 });
  const image = reserve(quota, 'image', 'image'); settle(quota, image.usage, 'commit');
  assert.throws(() => reserve(quota, 'second-image', 'image'), { status: 402 });
  const text = reserve(quota, 'text', 'text', 3); settle(quota, text.usage, 'commit');
  assert.throws(() => reserve(quota, 'fourth-text', 'text'), { status: 402 });
  const video = reserve(quota, 'video', 'video'); settle(quota, video.usage, 'cancel');
  const final = balance(quota);
  assert.equal(final.available, 1); assert.equal(final.consumed, 4);
  assert.equal(final.byCapability.video.available, 1);
  assert.equal(final.byCapability.image.consumed, 1); assert.equal(final.byCapability.text.consumed, 3);
});

test('typed reservation retries bind capability and refund their exact mixed shared allocation', t => {
  const { quota } = setup(t);
  grant(quota, { image: 1 }); grant(quota, null, 3);
  const usage = reserve(quota, 'mixed', 'image', 3).usage;
  assert.equal(balance(quota).shared.available, 1);
  assert.equal(balance(quota).byCapability.image.reserved, 1);
  assert.equal(reserve(quota, 'mixed', 'image', 3).usage.id, usage.id);
  assert.throws(() => reserve(quota, 'mixed', 'video', 3), { status: 409 });
  assert.throws(() => reserve(quota, 'mixed', undefined, 3), { status: 409 });
  settle(quota, usage, 'cancel'); settle(quota, usage, 'cancel');
  assert.equal(balance(quota).shared.available, 3);
  assert.equal(balance(quota).byCapability.image.available, 1);
  assert.equal(balance(quota).available, 4);
});

test('migration preserves legacy shared grants and in-flight settlement, and reruns do not duplicate grants', t => {
  const { db, quota } = setup(t);
  grant(quota, null, 5);
  const usage = reserve(quota, 'legacy', undefined, 2).usage;
  db.exec('DROP TABLE quota_account_buckets; UPDATE quota_usage SET allocations_json=NULL');
  const migrated = createQuota(db);
  settle(migrated, usage, 'commit');
  grant(migrated, { video: 1 });
  const reopened = createQuota(db), state = balance(reopened);
  assert.equal(state.granted, 6); assert.equal(state.consumed, 2); assert.equal(state.shared.available, 3);
  const video = reserve(reopened, 'new-video', 'video'); settle(reopened, video.usage, 'commit');
  assert.equal(balance(reopened).byCapability.video.available, 0);
  assert.equal(balance(reopened).shared.available, 3);
});

test('combination vector validation cannot turn invalid or unknown capabilities into shared quota', t => {
  const { quota } = setup(t);
  for (const allocation of [{}, { text: 0 }, { image: -1 }, { text: 1.2 }, { image: '1' }, { text: 1, audio: 1 }, { text: 1_000_000, video: 1 }, []]) {
    assert.throws(() => quota.generateCodes({ projectId: 'dingxiaosui', quantity: 1, units: 10, quota: allocation }), { status: 400 });
  }
  assert.equal(quota.listCodes().length, 0);
  assert.throws(() => reserve(quota, 'bad', 'audio'), { status: 400 });
});

test('payment-time generation uses immutable order vector and produces only one redeemable code on retries', t => {
  const { quota, commerce } = setup(t);
  commerce.saveProduct(product());
  const order = commerce.createOrder({ productId: 'dingxiaosui-combo', packageId: 'combo', email: 'buyer@example.com' });
  assert.deepEqual(order.quota, combination); assert.equal(order.units, 5); assert.equal(order.inventoryId, null);
  assert.equal(quota.listCodes().length, 0);
  // Changing both price and fulfillment after purchase must not change delivery.
  commerce.saveProduct(product({ fulfillment: 'stock', priceCents: 9999,
    packageOptions: [{ id: 'combo', label: '变更后的套餐', quota: { text: 1, image: 3, video: 1 }, priceCents: 9999 }] }));
  const approval = { id: order.id, confirmed: true, verifiedReference: 'isolated-not-real-payment' };
  commerce.approveOrder(approval); const delivered = commerce.getOrder(order);
  commerce.approveOrder(approval);
  assert.equal(commerce.getOrder(order).code, delivered.code);
  assert.equal(quota.listCodes().length, 1); assert.equal(commerce.stats().soldCardCount, 1);
  assert.equal(delivered.priceCents, 1290); assert.equal(delivered.fulfillment, 'on_payment');
  const redeemed = quota.redeem({ projectId: 'dingxiaosui', userId: 'alice', code: delivered.code });
  assert.deepEqual(redeemed.quota, combination); assert.equal(redeemed.balance.byCapability.image.available, 1);
});

test('payment-time issuance rollback leaves no orphan card, no consumed payment reference and no partial stock', t => {
  const { db, quota, commerce } = setup(t);
  commerce.saveProduct(product());
  const order = commerce.createOrder({ productId: 'dingxiaosui-combo', email: 'buyer@example.com' });
  db.exec("CREATE TRIGGER fail_fulfill BEFORE UPDATE OF status ON shop_orders WHEN NEW.status='fulfilled' BEGIN SELECT RAISE(ABORT,'simulated write failure'); END");
  const approval = { id: order.id, confirmed: true, verifiedReference: 'test-rollback' };
  assert.throws(() => commerce.approveOrder(approval), /simulated write failure/);
  assert.equal(quota.listCodes().length, 0); assert.equal(commerce.stats().inventoryCount, 0);
  assert.equal(commerce.getOrder(order).status, 'pending'); assert.equal(commerce.getOrder(order).verifiedReference, null);
  db.exec('DROP TRIGGER fail_fulfill'); commerce.approveOrder(approval);
  assert.equal(quota.listCodes().length, 1); assert.equal(commerce.getOrder(order).status, 'fulfilled');
});

test('same total count is insufficient to match a different typed stock card', t => {
  const { commerce } = setup(t);
  commerce.saveProduct(product({ fulfillment: 'stock' }));
  commerce.generateInventory({ productId: 'dingxiaosui-combo', packageId: 'combo', quantity: 1 });
  commerce.saveProduct(product({ fulfillment: 'stock', packageOptions: [{ id: 'combo', label: '新组合', quota: { text: 1, image: 3, video: 1 }, priceCents: 1290 }] }));
  assert.equal(commerce.listProducts()[0].packageOptions[0].stockAvailable, 0);
  assert.throws(() => commerce.createOrder({ productId: 'dingxiaosui-combo', packageId: 'combo', email: 'buyer@example.com' }), { status: 409 });
  commerce.saveProduct(product({ fulfillment: 'stock' }));
  const order = commerce.createOrder({ productId: 'dingxiaosui-combo', packageId: 'combo', email: 'buyer@example.com' });
  assert.ok(order.inventoryId); assert.deepEqual(order.quota, combination);
});

test('custom vectors are priced on the server with one final cent rounding and strict limits', t => {
  const { commerce } = setup(t);
  commerce.saveProduct(product({ quotaPricing: { enabled: true, unitPriceMicros: { text: 10001, image: 10001, video: 10001 }, maxCounts: { text: 3, image: 1, video: 1 } },
    customPricing: { enabled: true, minUnits: 1, maxUnits: 100, unitPriceMicros: 1 } }));
  const input = { productId: 'dingxiaosui-combo', customQuota: combination, email: 'buyer@example.com', priceCents: 1, units: 1 };
  const order = commerce.createOrder(input);
  assert.equal(order.priceCents, 6); assert.equal(order.units, 5); assert.deepEqual(order.quota, combination);
  assert.throws(() => commerce.createOrder({ ...input, customQuota: { text: 4 } }), { status: 400 });
  assert.throws(() => commerce.createOrder({ ...input, packageId: 'combo' }), { status: 400 });
  assert.throws(() => commerce.createOrder({ ...input, customUnits: 5, customQuota: undefined }), { status: 400 });
  assert.throws(() => commerce.saveProduct(product({ fulfillment: 'stock', quotaPricing: { enabled: true, unitPriceMicros: { text: 1, image: 1, video: 1 } } })), { status: 400 });
});

test('typed purchases validate only their selected platform routes and reject missing selected capabilities', t => {
  const { db, quota } = setup(t);
  const secret = 'isolated-platform-routing-secret', channels = createChannels(db, { secret });
  channels.saveChannel({ id: 'text-relay', name: '文字', baseUrl: 'https://text.example/v1', apiKey: 'test', models: [{ id: 'text-test', capability: 'text' }] });
  channels.saveChannel({ id: 'video-relay', name: '视频停用', enabled: false, baseUrl: 'https://video.example/v1', apiKey: 'test', models: [{ id: 'video-test', capability: 'video' }] });
  const platforms = createPlatforms(db, { quota, channels });
  platforms.savePlatform({ id: 'dingxiaosui', name: '丁小穗', bindings: [{ capability: 'text', channelId: 'text-relay', model: 'text-test' }, { capability: 'video', channelId: 'video-relay', model: 'video-test' }] });
  const commerce = createCommerce(db, { quota, channels, platforms, secret });
  commerce.saveProduct(product({ quotaPricing: { enabled: true, unitPriceMicros: { text: 10000, image: 10000, video: 10000 } } }));
  const input = { productId: 'dingxiaosui-combo', email: 'buyer@example.com' };
  assert.deepEqual(commerce.createOrder({ ...input, customQuota: { text: 1 } }).quota, { text: 1, image: 0, video: 0 });
  assert.throws(() => commerce.createOrder({ ...input, customQuota: { image: 1 } }), { status: 409 });
  assert.throws(() => commerce.createOrder({ ...input, customQuota: { video: 1 } }), { status: 409 });
  assert.throws(() => commerce.createOrder({ ...input, packageId: 'combo' }), { status: 409 });
});
