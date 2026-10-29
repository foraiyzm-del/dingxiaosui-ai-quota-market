import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createQuota } from '../sidecar/quota.mjs';
import { createCommerce } from '../sidecar/commerce.mjs';
import { createPaymentProvider } from '../sidecar/payment-provider.mjs';
import { epaySign } from '../sidecar/payments.mjs';

function setup(t) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const quota = createQuota(db); quota.createProject({ id: 'design', name: '包装设计' });
  const commerce = createCommerce(db, { quota, secret: 'unit-test-encryption' });
  commerce.saveProduct({ id: 'design-50', projectId: 'design', name: '设计50次', units: 50, priceCents: 1990, active: true });
  commerce.generateInventory({ productId: 'design-50', packageId: 'standard', quantity: 4 });
  const provider = createPaymentProvider(db, { commerce, secret: 'unit-test-encryption' });
  provider.saveSettings({ mode: 'epay', gatewayUrl: 'https://gateway.example', merchantId: '1001', apiKey: 'only-test-provider-secret', publicBaseUrl: 'https://store.example', enabledMethods: ['wxpay', 'alipay'] });
  function order() {
    const value = commerce.createOrder({ productId: 'design-50', packageId: 'standard', email: 'buyer@example.com' });
    provider.begin(value); return value;
  }
  function params(value, patch = {}, key = 'only-test-provider-secret') {
    const data = { pid: '1001', out_trade_no: value.orderNo, trade_no: `trade-${value.id}`, type: 'wxpay', name: '设计50次', money: '19.90', trade_status: 'TRADE_SUCCESS', ...patch };
    return { ...data, sign: epaySign(data, key), sign_type: 'MD5' };
  }
  return { db, quota, commerce, provider, order, params };
}

test('verified payment delivers exactly one stocked card; return navigation does not pay', t => {
  const { commerce, provider, order, params } = setup(t);
  const first = order(), redirect = new URL(provider.begin(first).redirectUrl);
  const returnToken = new URL(redirect.searchParams.get('return_url')).pathname.split('/').pop();
  assert.match(provider.returnLocation(returnToken), /^\/checkout\//);
  assert.equal(commerce.getOrder(first).status, 'pending');
  assert.equal(provider.notify(params(first)).status, 'paid');
  const delivered = commerce.getOrder(first);
  assert.ok(delivered.code);
  provider.notify(params(first));
  assert.equal(commerce.getOrder(first).code, delivered.code);
  assert.equal(commerce.listInventory().filter(c => c.status === 'sold').length, 1);
});

test('signature, amount, merchant, status and transaction uniqueness guard delivery', t => {
  const { provider, commerce, order, params } = setup(t); const first = order();
  for (const patch of [{ sign: '0'.repeat(32) }, params(first, { money: '0.01' }), params(first, { pid: 'other' }), params(first, { trade_status: 'WAIT_BUYER_PAY' })]) {
    assert.throws(() => provider.notify({ ...params(first), ...patch }));
  }
  assert.equal(commerce.getOrder(first).status, 'pending');
  provider.notify(params(first));
  const second = order();
  assert.throws(() => provider.notify(params(second, { trade_no: `trade-${first.id}` })), { status: 409 });
});

test('late paid orders enter a recovery queue and require explicit stock fulfillment', t => {
  const { provider, commerce, order, params } = setup(t); const first = order();
  commerce.cancelOrder(first);
  assert.equal(provider.notify(params(first)).status, 'needs_review');
  assert.equal(commerce.getOrder(first).status, 'cancelled');
  assert.equal(provider.listIssues().length, 1);
  assert.throws(() => provider.recover({ orderId: first.id, note: '核实到账' }), { status: 400 });
  const fulfilled = provider.recover({ orderId: first.id, confirmed: true, note: '已核实交易，补库存发货' });
  assert.equal(fulfilled.status, 'fulfilled');
  assert.equal(provider.listIssues().length, 0);
});

test('keys and checkout tokens are encrypted; pending payments retain their signing credentials', t => {
  const { db, provider, order, params } = setup(t); const first = order();
  provider.saveSettings({ apiKey: 'new-test-provider-secret' });
  assert.equal(provider.notify(params(first)).status, 'paid');
  assert.ok(!JSON.stringify(provider.safeSettings()).includes('new-test-provider-secret'));
  assert.ok(!JSON.stringify(db.prepare('SELECT * FROM payment_attempts').all()).includes(first.token));
  assert.ok(!JSON.stringify(db.prepare('SELECT * FROM payment_provider_settings').all()).includes('new-test-provider-secret'));
  assert.equal(provider.safeSettings().hasKey, true);
  provider.saveSettings({ apiKey: '' });
  assert.equal(provider.safeSettings().hasKey, true);
});
