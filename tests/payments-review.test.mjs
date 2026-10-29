import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createQuota } from '../sidecar/quota.mjs';
import { createCommerce } from '../sidecar/commerce.mjs';
import { createPaymentProvider } from '../sidecar/payment-provider.mjs';
import { epaySign } from '../sidecar/payments.mjs';

const secret = 'payment-recovery-review-test-secret';
const upstreamKey = 'upstream-payment-secret-test-only';
function setup(t) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const quota = createQuota(db); quota.createProject({ id: 'packaging', name: '包装设计' });
  const commerce = createCommerce(db, { quota, secret });
  commerce.saveProduct({ id: 'package', projectId: 'packaging', name: '包装设计', units: 50, priceCents: 2990 });
  commerce.generateInventory({ productId: 'package', quantity: 1 });
  const provider = createPaymentProvider(db, { commerce, secret });
  provider.saveSettings({ mode: 'epay', gatewayUrl: 'https://gateway.example', merchantId: '1001', apiKey: upstreamKey, publicBaseUrl: 'https://store.example' });
  const order = commerce.createOrder({ productId: 'package', email: 'buyer@example.com' });
  provider.begin(order);
  const payload = patch => {
    const params = { pid: '1001', out_trade_no: order.orderNo, trade_no: 'verified-unique-trade', type: 'wxpay', money: '29.90', trade_status: 'TRADE_SUCCESS', ...patch };
    return { ...params, sign: epaySign(params, upstreamKey), sign_type: 'MD5' };
  };
  return { db, quota, commerce, provider, order, payload };
}

test('authenticated payment survives delivery persistence failure and service reconstruction without issuing twice', t => {
  const { db, quota, commerce, provider, order, payload } = setup(t);
  db.exec(`CREATE TRIGGER fail_card_delivery BEFORE UPDATE OF code_ciphertext ON shop_orders
    WHEN NEW.code_ciphertext IS NOT NULL BEGIN SELECT RAISE(FAIL,'simulated persistence interruption'); END;`);
  const result = provider.notify(payload());
  assert.equal(result.status, 'needs_review');
  assert.equal(provider.listIssues().length, 1);
  assert.equal(provider.listIssues()[0].tradeNo, 'verified-unique-trade');
  assert.equal(commerce.getOrder(order).status, 'pending');
  assert.equal(commerce.stats().soldCardCount, 0);
  assert.equal(commerce.stats().reservedCardCount, 1);
  assert.equal(db.prepare('SELECT issuance_state FROM quota_codes').get().issuance_state, 'stock');
  assert.ok(!JSON.stringify(provider.listIssues()).includes(upstreamKey));
  db.exec('DROP TRIGGER fail_card_delivery');
  const restarted = createPaymentProvider(db, { commerce, secret });
  assert.equal(restarted.notify(payload()).status, 'paid');
  const code = commerce.getOrder(order).code;
  assert.equal(restarted.notify(payload()).status, 'paid');
  assert.equal(commerce.getOrder(order).code, code);
  assert.equal(quota.listCodes().length, 1);
  assert.equal(commerce.stats().soldCardCount, 1);
  assert.equal(restarted.listIssues().length, 0);
});

test('late paid stock shortage is preserved for manual recovery without taking another buyer reservation', t => {
  const { commerce, provider, order, payload } = setup(t);
  commerce.cancelOrder(order);
  const competing = commerce.createOrder({ productId: 'package', email: 'another@example.com' });
  const competingCard = competing.inventoryId;
  assert.equal(provider.notify(payload()).status, 'needs_review');
  assert.throws(() => provider.recover({ orderId: order.id, confirmed: true, note: '已核实到账' }), { status: 409 });
  assert.equal(commerce.getOrder(order).status, 'cancelled');
  assert.equal(commerce.getOrder(competing).inventoryId, competingCard);
  assert.equal(commerce.stats().reservedCardCount, 1);
  assert.equal(provider.listIssues().length, 1);
  commerce.generateInventory({ productId: 'package', quantity: 1 });
  assert.equal(provider.recover({ orderId: order.id, confirmed: true, note: '已补货，核实交易发卡' }).status, 'fulfilled');
  assert.notEqual(commerce.getOrder(order).inventoryId, competingCard);
  assert.equal(commerce.getOrder(competing).status, 'pending');
  assert.equal(provider.notify(payload()).status, 'paid');
  assert.equal(commerce.stats().soldCardCount, 1);
});

test('signed malformed money and conflicting duplicate trade cannot change a paid order', t => {
  const { commerce, provider, order, payload } = setup(t);
  for (const money of ['29.900', '2.99e1', '-29.90', '29.899', 'NaN', '2990', '0.00']) {
    assert.throws(() => provider.notify(payload({ money })), { status: 400 });
  }
  assert.equal(commerce.getOrder(order).status, 'pending');
  assert.equal(provider.notify(payload({ money: '29.9' })).status, 'paid');
  const code = commerce.getOrder(order).code;
  assert.throws(() => provider.notify(payload({ trade_no: 'another-transaction' })), { status: 409 });
  assert.equal(commerce.getOrder(order).code, code);
  assert.equal(commerce.stats().revenueCents, 2990);
  assert.equal(provider.listIssues().length, 0);
});
