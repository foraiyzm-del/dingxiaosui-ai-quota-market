import test from 'node:test';
import assert from 'node:assert/strict';
import { listAccessibleModels } from '../sidecar/model-access.mjs';

test('model discovery authenticates the production relay and disables redirects', async () => {
  const names = ['APIMART_RELAY_ORIGIN', 'APIMART_RELAY_SECRET'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  const secret = 'test-relay-secret-for-model-list-0001';
  process.env.APIMART_RELAY_ORIGIN = 'https://relay.aiglink.cn';
  process.env.APIMART_RELAY_SECRET = secret;
  try {
    let calls = 0;
    const models = await listAccessibleModels({
      baseUrl: 'https://relay.aiglink.cn/v1/',
      apiKey: 'test-provider-key',
      fetchImpl: async (url, init) => {
        calls++;
        assert.equal(url, 'https://relay.aiglink.cn/v1/models');
        assert.equal(init.headers.Authorization, 'Bearer test-provider-key');
        assert.equal(init.headers['X-Quota-Relay-Key'], secret);
        assert.equal(init.redirect, 'manual');
        assert.ok(init.signal instanceof AbortSignal);
        return Response.json({ data: [{ id: 'seedance-2.5' }] });
      },
    });
    assert.equal(calls, 1);
    assert.deepEqual([...models], ['seedance-2.5']);
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});
