import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createCommerce } from '../sidecar/commerce.mjs';
import { createQuota } from '../sidecar/quota.mjs';

const secret = 'test-only-commerce-secret-at-least-16-characters';
const product = { id: 'writing-three', projectId: 'writing', name: '营销文案平台', description: '文案平台独立使用次数', units: 3, priceCents: 1990 };
const status = expected => error => error?.status === expected;
const approve = (id, verifiedReference = 'actual-wechat-1') => ({ id, verifiedReference, confirmed: true, note: '测试核账' });
const buyer = { productId: product.id, email: 'buyer@example.com' };
const configurable = {
  packageOptions: [
    { id: 'standard', label: '三次体验', units: 3, priceCents: 1990 },
    { id: 'ten', label: '十次包', units: 10, priceCents: 3990 },
  ],
  customPricing: { enabled: true, minUnits: 5, maxUnits: 500, unitPriceMicros: 199000 },
};

function setup(t, quantity = 3) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const quota = createQuota(db);
  quota.createProject({ id: 'writing', name: '营销文案平台' });
  quota.createProject({ id: 'images', name: '包装设计平台' });
  const commerce = createCommerce(db, { quota, secret });
  commerce.saveProduct(product);
  if (quantity) commerce.generateInventory({ productId: product.id, quantity });
  return { db, quota, commerce };
}

test('products validate independent platform packages, prices, and visibility', t => {
  const { commerce } = setup(t);
  assert.equal(commerce.listProducts().length, 1);
  assert.throws(() => commerce.saveProduct({ ...product, projectId: 'missing' }), status(404));
  for (const units of [0, -1, 1.5, 1_000_001, '3']) assert.throws(() => commerce.saveProduct({ ...product, units }), status(400));
  for (const priceCents of [0, -1, 19.9, 100_000_001, '1990']) assert.throws(() => commerce.saveProduct({ ...product, priceCents }), status(400));
  assert.throws(() => commerce.saveProduct({ ...product, packageOptions: [{ id: 'image', label: '其他平台', units: 3, priceCents: 1, projectId: 'images' }] }), status(400));
  assert.throws(() => commerce.saveProduct({ ...product, active: 'false' }), status(400));
  commerce.saveProduct({ ...product, active: false });
  assert.equal(commerce.listProducts().length, 0);
  assert.equal(commerce.listProducts({ admin: true })[0].active, false);
  assert.throws(() => commerce.createOrder(buyer), status(409));
});

test('preissued inventory is encrypted, counted by exact SKU, and unusable before delivery', t => {
  const { commerce, db, quota } = setup(t, 0);
  assert.throws(() => commerce.createOrder(buyer), status(409));
  assert.equal(commerce.listOrders().length, 0);
  const batch = commerce.generateInventory({ productId: product.id, quantity: 2 });
  assert.equal(batch.quantity, 2);
  assert.equal(batch.available, 2);
  assert.equal(commerce.listProducts()[0].packageOptions[0].stockAvailable, 2);
  const exported = commerce.exportBatch({ batchId: batch.batchId });
  assert.equal(exported.codes.length, 2);
  const code = exported.codes[0].code;
  assert.match(code, /^QTA(?:-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}){4}$/u);
  assert.throws(() => quota.redeem({ projectId: 'writing', userId: 'buyer', code }), status(409));
  assert.ok(!JSON.stringify(commerce.listInventory()).includes(code));
  assert.ok(!JSON.stringify(db.prepare('SELECT * FROM shop_inventory').all()).includes(code));
  assert.ok(!JSON.stringify(db.prepare('SELECT * FROM quota_codes').all()).includes(code));
  assert.throws(() => commerce.generateInventory({ productId: product.id, quantity: 1001 }), status(400));
  assert.throws(() => commerce.generateInventory({ productId: product.id, quantity: 1, packageId: 'standard', units: 3 }), status(400));
});

test('orders reserve one stock card and snapshot server prices and project', t => {
  const { commerce, quota } = setup(t);
  const order = commerce.createOrder({ ...buyer, priceCents: 1, units: 999999 });
  assert.equal(order.priceCents, 1990);
  assert.equal(order.units, 3);
  assert.equal(order.skuId, 'standard');
  assert.match(order.orderNo, /^AI\d{8}[A-F0-9]{12}$/u);
  assert.match(order.token, /^[a-f0-9]{64}$/u);
  assert.ok(Date.parse(order.expiresAt) > Date.parse(order.createdAt));
  assert.equal(commerce.stats().reservedCardCount, 1);
  assert.equal(commerce.listProducts()[0].packageOptions[0].stockAvailable, 2);
  commerce.saveProduct({ ...product, name: '更新套餐', units: 10, priceCents: 4990, projectId: 'images' });
  const original = commerce.getOrder(order);
  assert.equal(original.productName, product.name);
  assert.equal(original.projectId, 'writing');
  assert.equal(original.units, 3);
  commerce.approveOrder(approve(order.id));
  const code = commerce.getOrder(order).code;
  assert.equal(quota.redeem({ projectId: 'writing', userId: 'buyer', code }).balance.available, 3);
  assert.throws(() => commerce.createOrder(buyer), status(409));
  commerce.generateInventory({ productId: product.id, quantity: 1 });
  assert.equal(commerce.createOrder(buyer).projectId, 'images');
  for (const email of ['', 'invalid', 'buyer@example', 'a@b.example\nforged']) assert.throws(() => commerce.createOrder({ ...buyer, email }), status(400));
});

test('email does not authorize fetching, submitting proof, or cancelling another order', t => {
  const { commerce, db } = setup(t);
  const first = commerce.createOrder(buyer), second = commerce.createOrder(buyer);
  for (const token of [undefined, '', first.email, first.token.slice(0, -1), second.token]) {
    assert.throws(() => commerce.getOrder({ id: first.id, token }), status(403));
    assert.throws(() => commerce.cancelOrder({ id: first.id, token }), status(403));
    assert.throws(() => commerce.submitProof({ id: first.id, token, reference: 'reported', paidAt: '2026-10-28T20:00:00+08:00' }), status(403));
  }
  assert.ok(!JSON.stringify(db.prepare('SELECT * FROM shop_orders').all()).includes(first.token));
  assert.ok(!JSON.stringify(commerce.listOrders()).includes(first.token));
});

test('proof only requests review and first submission extends stock reservation without issuing a card', t => {
  const { commerce, quota } = setup(t);
  const order = commerce.createOrder(buyer);
  const proof = { ...order, reference: 'customer-reported', payer: '客户', paidAt: '2026-10-28T20:00:00+08:00' };
  assert.throws(() => commerce.submitProof({ ...proof, paidAt: 'invalid' }), status(400));
  const submitted = commerce.submitProof(proof);
  assert.equal(submitted.status, 'submitted');
  assert.equal(Date.parse(submitted.expiresAt) - Date.parse(submitted.submittedAt), 86_400_000);
  assert.equal(commerce.submitProof(proof).expiresAt, submitted.expiresAt);
  assert.equal('code' in submitted, false);
  assert.equal(quota.listCodes().length, 3);
  assert.throws(() => commerce.cancelOrder(order), status(409));
  for (const confirmed of [undefined, false, 'true', 1]) assert.throws(() => commerce.approveOrder({ ...approve(order.id), confirmed }), status(400));
  assert.throws(() => commerce.approveOrder({ ...approve(order.id), verifiedReference: '' }), status(400));
  assert.equal(commerce.getOrder(order).status, 'submitted');
});

test('verified payment delivers exactly the reserved card and retries never reissue', t => {
  const { commerce, quota, db } = setup(t);
  const order = commerce.createOrder(buyer);
  const card = commerce.listInventory().find(item => item.orderId === order.id);
  const reservedCode = commerce.exportBatch({ batchId: card.batchId }).codes.find(item => item.id === card.id).code;
  assert.throws(() => quota.redeem({ projectId: 'writing', userId: 'buyer', code: reservedCode }), status(409));
  const result = commerce.approveOrder(approve(order.id));
  assert.equal(result.status, 'fulfilled');
  assert.equal('code' in result, false);
  assert.equal('token' in result, false);
  const delivered = commerce.getOrder(order);
  assert.equal(delivered.code, reservedCode);
  assert.equal(commerce.stats().soldCardCount, 1);
  assert.equal(commerce.stats().revenueCents, 1990);
  assert.equal(quota.listCodes().length, 3);
  assert.deepEqual(commerce.approveOrder(approve(order.id)), result);
  assert.throws(() => commerce.approveOrder(approve(order.id, 'different-transaction')), status(409));
  assert.ok(!JSON.stringify(db.prepare('SELECT * FROM shop_orders').all()).includes(delivered.code));
  assert.ok(!JSON.stringify(commerce.listOrders()).includes(delivered.code));
  assert.throws(() => quota.redeem({ projectId: 'images', userId: 'buyer', code: delivered.code }), status(404));
  assert.equal(quota.redeem({ projectId: 'writing', userId: 'buyer', code: delivered.code }).balance.available, 3);
  assert.ok(commerce.listInventory().find(item => item.id === card.id).redeemedAt);
  assert.throws(() => quota.redeem({ projectId: 'writing', userId: 'buyer', code: delivered.code }), status(409));
});

test('one verified payment cannot fund two orders', t => {
  const { commerce } = setup(t);
  const first = commerce.createOrder(buyer), second = commerce.createOrder(buyer);
  commerce.approveOrder(approve(first.id, 'one-transaction'));
  assert.throws(() => commerce.approveOrder(approve(second.id, 'one-transaction')), status(409));
  assert.equal(commerce.getOrder(second).status, 'pending');
  assert.equal(commerce.stats().soldCardCount, 1);
  commerce.approveOrder(approve(second.id, 'another-transaction'));
  assert.equal(commerce.stats().soldCardCount, 2);
});

test('delivery persistence failure rolls back activation, sale, and payment atomically', t => {
  const { commerce, quota, db } = setup(t);
  const order = commerce.createOrder(buyer);
  const card = commerce.listInventory().find(item => item.orderId === order.id);
  const code = commerce.exportBatch({ batchId: card.batchId }).codes.find(item => item.id === card.id).code;
  db.exec(`CREATE TRIGGER fail_shop_delivery BEFORE UPDATE OF code_ciphertext ON shop_orders
    WHEN NEW.code_ciphertext IS NOT NULL BEGIN SELECT RAISE(FAIL,'simulated delivery persistence failure'); END;`);
  assert.throws(() => commerce.approveOrder(approve(order.id)), /simulated delivery persistence failure/u);
  assert.equal(commerce.getOrder(order).status, 'pending');
  assert.equal(commerce.getOrder(order).verifiedReference, null);
  assert.equal(commerce.stats().soldCardCount, 0);
  assert.equal(commerce.stats().reservedCardCount, 1);
  assert.equal(quota.listCodes().length, 3);
  assert.throws(() => quota.redeem({ projectId: 'writing', userId: 'buyer', code }), status(409));
  db.exec('DROP TRIGGER fail_shop_delivery');
  commerce.approveOrder(approve(order.id));
  assert.equal(commerce.getOrder(order).code, code);
  assert.equal(quota.listCodes().length, 3);
});

test('batch persistence failure creates neither orphan quota codes nor partial stock', t => {
  const { commerce, quota, db } = setup(t, 0);
  db.exec(`CREATE TRIGGER fail_inventory_insert BEFORE INSERT ON shop_inventory BEGIN SELECT RAISE(FAIL,'simulated stock persistence failure'); END;`);
  assert.throws(() => commerce.generateInventory({ productId: product.id, quantity: 3 }), /simulated stock persistence failure/u);
  assert.equal(quota.listCodes().length, 0);
  assert.equal(commerce.listBatches().length, 0);
  assert.equal(commerce.listInventory().length, 0);
  db.exec('DROP TRIGGER fail_inventory_insert');
  assert.equal(commerce.generateInventory({ productId: product.id, quantity: 3 }).quantity, 3);
});

test('expired and cancelled orders release inventory; late payment needs explicit recovery', t => {
  const { commerce, db } = setup(t, 1);
  const expired = commerce.createOrder(buyer);
  db.prepare('UPDATE shop_orders SET expires_at=? WHERE id=?').run('2000-01-01T00:00:00.000Z', expired.id);
  assert.equal(commerce.getOrder(expired).status, 'expired');
  assert.equal(commerce.stats().availableCardCount, 1);
  assert.throws(() => commerce.approveOrder(approve(expired.id)), status(409));
  assert.throws(() => commerce.submitProof({ ...expired, reference: 'late', paidAt: '2026-10-28T20:00:00+08:00' }), status(409));
  const second = commerce.createOrder(buyer);
  assert.throws(() => commerce.approveOrder({ ...approve(expired.id), recovery: true }), status(409));
  assert.equal(commerce.getOrder(expired).status, 'expired');
  assert.equal(commerce.cancelOrder(second).status, 'cancelled');
  assert.equal(commerce.cancelOrder(second).status, 'cancelled');
  assert.equal(commerce.approveOrder({ ...approve(expired.id), recovery: true }).status, 'fulfilled');
  assert.equal(commerce.stats().soldCardCount, 1);
  assert.equal(commerce.stats().closedOrderCount, 1);
});

test('custom counts require separately prepared exact stock and server-side pricing', t => {
  const { commerce, quota } = setup(t);
  assert.throws(() => commerce.createOrder({ ...buyer, customUnits: 5 }), status(400));
  commerce.saveProduct({ ...product, ...configurable });
  commerce.generateInventory({ productId: product.id, units: 7, quantity: 1 });
  assert.deepEqual(commerce.listProducts()[0].customStock, [{ units: 7, available: 1 }]);
  assert.throws(() => commerce.createOrder({ ...buyer, customUnits: 8 }), status(409));
  for (const customUnits of [null, 0, -1, 4, 501, 5.1, '5', 1_000_001]) assert.throws(() => commerce.createOrder({ ...buyer, customUnits }), status(400));
  const order = commerce.createOrder({ ...buyer, customUnits: 7, priceCents: 1, units: 9000 });
  assert.equal(order.priceCents, 140);
  assert.equal(order.units, 7);
  assert.equal(order.skuId, null);
  assert.equal(order.selectionType, 'custom');
  assert.deepEqual(commerce.listProducts()[0].customStock, []);
  commerce.approveOrder(approve(order.id));
  assert.equal(quota.redeem({ projectId: 'writing', userId: 'custom', code: commerce.getOrder(order).code }).balance.available, 7);
});

test('fixed package snapshots survive edits and prevent client manipulation', t => {
  const { commerce, quota } = setup(t);
  commerce.saveProduct({ ...product, ...configurable });
  commerce.generateInventory({ productId: product.id, packageId: 'ten', quantity: 1 });
  const order = commerce.createOrder({ ...buyer, packageId: 'ten', priceCents: 1, units: 9999 });
  assert.equal(order.priceCents, 3990);
  assert.equal(order.units, 10);
  assert.throws(() => commerce.createOrder({ ...buyer, packageId: 'missing' }), status(400));
  assert.throws(() => commerce.createOrder({ ...buyer, packageId: 'ten', customUnits: 10 }), status(400));
  commerce.saveProduct({ ...product, packageOptions: [{ id: 'ten', label: '已涨价', units: 20, priceCents: 5990 }] });
  assert.equal(commerce.getOrder(order).priceCents, 3990);
  assert.equal(commerce.getOrder(order).units, 10);
  commerce.approveOrder(approve(order.id));
  assert.equal(quota.redeem({ projectId: 'writing', userId: 'fixed', code: commerce.getOrder(order).code }).balance.available, 10);
});

test('package and custom-price validation preserves omitted existing choices', t => {
  const { commerce } = setup(t);
  for (const packageOptions of [null, [], {}, [null], [configurable.packageOptions[0], configurable.packageOptions[0]],
    [{ id: 'bad id', label: '包', units: 1, priceCents: 1 }], [{ id: 'a', label: '', units: 1, priceCents: 1 }],
    [{ id: 'a', label: '包', units: 0, priceCents: 1 }]]) assert.throws(() => commerce.saveProduct({ ...product, packageOptions }), status(400));
  for (const customPricing of [null, [], { enabled: 'true' }, { enabled: true, minUnits: 6, maxUnits: 5 },
    { enabled: false, minUnits: 0 }, { enabled: true, unitPriceMicros: 0 }, { enabled: true, unitPriceMicros: 0.1 }]) {
    assert.throws(() => commerce.saveProduct({ ...product, customPricing }), status(400));
  }
  commerce.saveProduct({ ...product, ...configurable });
  const updated = commerce.saveProduct({ ...product, units: 4, priceCents: 2222 });
  assert.deepEqual(updated.packageOptions.map(({ stockAvailable, ...item }) => item), [
    { id: 'standard', label: '三次体验', units: 4, priceCents: 2222 }, configurable.packageOptions[1],
  ]);
  assert.deepEqual(updated.customPricing, configurable.customPricing);
});

test('custom price rounds upward at cents and rejects overflow', t => {
  const { commerce } = setup(t, 0);
  const pricing = { enabled: true, minUnits: 1, maxUnits: 1_000_000, unitPriceMicros: 333333 };
  commerce.saveProduct({ ...product, customPricing: pricing });
  commerce.generateInventory({ productId: product.id, units: 3, quantity: 1 });
  commerce.generateInventory({ productId: product.id, units: 4, quantity: 1 });
  assert.equal(commerce.createOrder({ ...buyer, customUnits: 3 }).priceCents, 100);
  assert.equal(commerce.createOrder({ ...buyer, customUnits: 4 }).priceCents, 134);
  commerce.saveProduct({ ...product, customPricing: { ...pricing, unitPriceMicros: 1_000_000_000_000 } });
  assert.throws(() => commerce.createOrder({ ...buyer, customUnits: 1_000_000 }), status(400));
});

test('schema upgrades retain delivered cards and legacy directly redeemable codes', t => {
  const { commerce, quota, db } = setup(t);
  const legacyCode = quota.generateCodes({ projectId: 'writing', units: 5, quantity: 1 }).codes[0];
  const order = commerce.createOrder(buyer);
  commerce.approveOrder(approve(order.id));
  const delivered = commerce.getOrder(order);
  db.exec(`ALTER TABLE shop_products DROP COLUMN package_options;
    ALTER TABLE shop_products DROP COLUMN custom_pricing;
    ALTER TABLE shop_orders DROP COLUMN selection_type;
    ALTER TABLE shop_orders DROP COLUMN package_label;
    ALTER TABLE shop_orders DROP COLUMN sku_id;`);
  const upgraded = createCommerce(db, { quota, secret });
  assert.equal(upgraded.getOrder(order).code, delivered.code);
  assert.equal(upgraded.getOrder(order).priceCents, 1990);
  assert.equal(upgraded.getOrder(order).units, 3);
  assert.equal(quota.redeem({ projectId: 'writing', userId: 'legacy-user', code: legacyCode }).balance.available, 5);
  assert.deepEqual(createCommerce(db, { quota, secret }).getOrder(order), upgraded.getOrder(order));
});
