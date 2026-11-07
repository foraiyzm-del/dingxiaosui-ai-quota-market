import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createOpcpayClient } from '../sidecar/opcpay-client.mjs';

test('OPC adapter sends server authentication, exact COUNT payloads and refuses redirects', async () => {
  const calls = [];
  const client = createOpcpayClient({ apiKey: 'test-service-secret', fetchImpl: async (url, options) => {
    calls.push({ url, options }); return new Response(JSON.stringify({ status: 'UNKNOWN' }), { status: 200 });
  } });
  await client.capabilities(); await client.product();
  await client.purchase({ userId: 'server-buyer', idempotencyKey: 'original-purchase', skuId: 'fixed-sku' });
  await client.access('server-buyer', 1);
  await client.consume({ userId: 'server-buyer', idempotencyKey: 'original-consume', amount: 1, reason: 'fixed reason' });
  await client.consumption('server-buyer', 'original-consume');
  await client.purchaseQuery('server-buyer', 'original-purchase');
  assert.equal(calls[0].url, 'https://ai6666.com/opcpay/api/pay/v1/capabilities');
  assert.ok(calls.every(call => call.options.redirect === 'error' && call.options.headers.Authorization === 'Bearer test-service-secret'));
  assert.deepEqual(JSON.parse(calls[2].options.body), { user_id: 'server-buyer', idempotency_key: 'original-purchase', sku_id: 'fixed-sku' });
  assert.deepEqual(JSON.parse(calls[4].options.body), { user_id: 'server-buyer', idempotency_key: 'original-consume', amount: 1, reason: 'fixed reason' });
  assert.deepEqual(JSON.parse(calls[5].options.body), { user_id: 'server-buyer', idempotency_key: 'original-consume' });
  assert.ok(calls.every(call => !call.url.includes('test-service-secret')));
});

test('transport errors are sanitized while authoritative NOT_FOUND remains distinguishable', async () => {
  for (const [response, status, code] of [
    [new Response(JSON.stringify({ error: 'secret upstream trace', error_code: 'NOT_FOUND' }), { status: 404 }), 404, 'NOT_FOUND'],
    [new Response('not-json secret upstream trace', { status: 200 }), 502, 'INVALID_RESPONSE'],
  ]) {
    const client = createOpcpayClient({ apiKey: 'secret', fetchImpl: async () => response });
    await assert.rejects(() => client.consumption('buyer', 'key'), error => error.status === status && error.code === code && !error.message.includes('secret'));
  }
  const timeout = createOpcpayClient({ apiKey: 'secret', fetchImpl: async () => { throw new Error('secret trace'); } });
  await assert.rejects(() => timeout.consume({ userId: 'buyer', idempotencyKey: 'key', reason: 'card' }), { status: 502, code: 'UPSTREAM_UNKNOWN' });
  for (const baseURL of ['http://localhost', 'https://user:secret@example.test', 'https://example.test?key=secret']) {
    assert.throws(() => createOpcpayClient({ apiKey: 'secret', baseURL }));
  }
});
