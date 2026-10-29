import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createUpstreamResolver, parseDohAnswer, queryOfficialDoh, publicAddress } from '../sidecar/upstream-dns.mjs';

const hostname = 'api.example.com';
const fake = [{ address: '198.18.0.113', family: 4 }];
const answer = (type, records = [], changes = {}) => ({ Status: 0, TC: false, CD: false,
  Question: [{ name: `${hostname}.`, type }], Answer: records, ...changes });
const record = (type, data, TTL = 300, name = hostname) => ({ name, type, TTL, data });
const rejected = error => error.safeRejection === true;

test('public system DNS preserves checked addresses without contacting DoH', async () => {
  const addresses = [{ address: '104.26.11.94', family: 4 }, { address: '2606:4700:20::681a:b5e', family: 6 }];
  const resolve = createUpstreamResolver({ lookupImpl: async () => addresses, queryImpl: () => { throw new Error('must not contact DoH'); } });
  assert.deepEqual(await resolve(hostname), addresses);
  assert.deepEqual(await resolve('8.8.8.8'), [{ address: '8.8.8.8', family: 4 }]);
});

test('only exclusively fake IPv4 DNS answers enable public A and AAAA fallback', async () => {
  const queries = [];
  const resolve = createUpstreamResolver({ lookupImpl: async () => fake, queryImpl: async (name, type) => {
    queries.push([name, type]);
    return answer(type, [type === 1 ? record(1, '104.26.11.94') : record(28, '2606:4700:20::681a:b5e')]);
  } });
  assert.deepEqual(await resolve(hostname), [{ address: '104.26.11.94', family: 4 }, { address: '2606:4700:20::681a:b5e', family: 6 }]);
  assert.deepEqual(queries, [[hostname, 1], [hostname, 28]]);
});

test('private, reserved, mixed and literal fake addresses never trigger fallback', async () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '192.168.1.1', '100.64.0.1', '198.51.100.1', '203.0.113.1', '::1', 'fd00::1', '2001:db8::1']) {
    let called = false;
    const resolve = createUpstreamResolver({ lookupImpl: async () => [{ address, family: address.includes(':') ? 6 : 4 }], queryImpl: async () => { called = true; } });
    await assert.rejects(resolve(hostname), rejected);
    assert.equal(called, false);
  }
  for (const addresses of [[...fake, { address: '8.8.8.8', family: 4 }], [...fake, { address: '127.0.0.1', family: 4 }]]) {
    const resolve = createUpstreamResolver({ lookupImpl: async () => addresses, queryImpl: () => { throw new Error('must not call DoH'); } });
    await assert.rejects(resolve(hostname), rejected);
  }
  const resolve = createUpstreamResolver({ lookupImpl: async () => fake, queryImpl: () => { throw new Error('must not call DoH'); } });
  for (const name of ['198.18.0.113', 'localhost', 'foo.localhost', 'router.local', 'router.home.arpa', 'internal']) await assert.rejects(resolve(name), rejected);
});

test('any unsafe DoH result fails closed, even alongside public records', async () => {
  for (const address of ['127.0.0.1', '198.18.0.1', '192.168.1.1', '169.254.169.254', '203.0.113.1']) {
    const resolve = createUpstreamResolver({ lookupImpl: async () => fake, queryImpl: async (_name, type) => answer(type,
      type === 1 ? [record(1, '8.8.8.8'), record(1, address)] : []) });
    await assert.rejects(resolve(hostname), rejected);
  }
  const resolve = createUpstreamResolver({ lookupImpl: async () => fake, queryImpl: async (_name, type) => type === 1
    ? answer(type, [record(1, '8.8.8.8')]) : answer(type, [record(28, 'fd00::123')]) });
  await assert.rejects(resolve(hostname), rejected);
});

test('DoH errors, truncation, mismatched questions and unrelated addresses are rejected', async () => {
  const valid = answer(1, [record(1, '8.8.8.8')]);
  for (const changes of [{ Status: 3 }, { TC: true }, { CD: true }, { Question: [] }, { Question: [{ name: 'attacker.example', type: 1 }] },
    { Question: [{ name: hostname, type: 28 }] }, { Answer: [record(1, '8.8.8.8', 10, 'unrelated.example')] },
    { Answer: [record(1, '::1')] }, { Answer: [record(1, '8.8.8.8', -1)] }]) {
    assert.throws(() => parseDohAnswer(hostname, 1, { ...valid, ...changes }), rejected);
  }
  const resolve = createUpstreamResolver({ lookupImpl: async () => fake, queryImpl: async (_name, type) => {
    if (type === 28) throw new Error('resolver unavailable');
    return valid;
  } });
  await assert.rejects(resolve(hostname), rejected);
});

test('valid CNAME chains resolve only reachable public addresses and use bounded minimum TTL', () => {
  const result = parseDohAnswer(hostname, 1, answer(1, [record(1, '8.8.8.8', 500, 'edge.example.com'), record(5, 'edge.example.com.', 12)]));
  assert.deepEqual(result, { addresses: [{ address: '8.8.8.8', family: 4 }], ttl: 12 });
  assert.throws(() => parseDohAnswer(hostname, 1, answer(1, [record(5, 'router.local', 12)])), rejected);
});

test('safe DNS cache expires, cannot be mutated by callers and never overrides a newly private system answer', async () => {
  let time = 1000, calls = 0, system = fake;
  const resolve = createUpstreamResolver({ clock: () => time, lookupImpl: async () => system, queryImpl: async (_name, type) => {
    calls++;
    return answer(type, type === 1 ? [record(1, '8.8.8.8', 1)] : []);
  } });
  const result = await resolve(hostname);
  result[0].address = '127.0.0.1';
  assert.equal((await resolve(hostname))[0].address, '8.8.8.8');
  assert.equal(calls, 2);
  time = 2001;
  await resolve(hostname);
  assert.equal(calls, 4);
  system = [{ address: '10.0.0.1', family: 4 }];
  await assert.rejects(resolve(hostname), rejected);
  assert.equal(calls, 4);
});

test('aborted lookups and invalid resolver queries do not make network requests', async () => {
  const controller = new AbortController(); controller.abort();
  const resolve = createUpstreamResolver({ lookupImpl: () => { throw new Error('must not resolve'); } });
  await assert.rejects(resolve(hostname, { signal: controller.signal }), rejected);
  assert.throws(() => queryOfficialDoh('localhost', 1), rejected);
  assert.throws(() => queryOfficialDoh(hostname, 255), rejected);
  assert.equal(publicAddress('198.18.0.113'), false);
});
