import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpsRequest } from 'node:https';

const reject = message => Object.assign(new Error(message), { safeRejection: true });
const RESOLVER_HOST = 'cloudflare-dns.com';
// Official standard resolver address: https://developers.cloudflare.com/1.1.1.1/ip-addresses/
const RESOLVER_ADDRESS = '1.1.1.1';
const MAX_DOH_BYTES = 65536;
const MAX_CACHE_ENTRIES = 128;
const MAX_CACHE_SECONDS = 60;
const DOH_TIMEOUT_MS = 15000;
const DOH_ATTEMPTS = 2;

export function publicAddress(address) {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return a !== 0 && a !== 10 && a !== 127 && a !== 169 && !(a === 172 && b >= 16 && b <= 31)
      && !(a === 192 && (b === 168 || b === 0)) && !(a === 100 && b >= 64 && b <= 127)
      && !(a === 198 && (b === 18 || b === 19 || b === 51)) && !(a === 203 && b === 0) && a < 224;
  }
  if (isIP(address) === 6) {
    const value = address.toLowerCase();
    return /^[23]/u.test(value) && !value.startsWith('2001:db8:') && !value.startsWith('2001:0:') && !value.startsWith('2002:');
  }
  return false;
}

const canonical = value => typeof value === 'string' ? value.toLowerCase().replace(/\.$/u, '') : '';
function ordinaryDomain(value) {
  const name = canonical(value);
  return name.length <= 253 && name.includes('.') && !isIP(name)
    && !/(^|\.)(localhost|local|internal|invalid|onion)$/u.test(name) && !/(^|\.)home\.arpa$/u.test(name)
    && name.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label));
}
function fakeAddress(address) {
  if (isIP(address) !== 4) return false;
  const [a, b] = address.split('.').map(Number);
  return a === 198 && (b === 18 || b === 19);
}

/** Fixed public endpoint and pinned resolver IP. TLS verifies cloudflare-dns.com. */
export function queryOfficialDoh(hostname, type, { signal } = {}) {
  if (!ordinaryDomain(hostname) || ![1, 28].includes(type)) throw reject('无法安全查询上游域名');
  const url = new URL(`https://${RESOLVER_HOST}/dns-query`);
  url.search = new URLSearchParams({ name: canonical(hostname), type: String(type) }).toString();
  const timeout = AbortSignal.timeout(DOH_TIMEOUT_MS);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  return queryOnce(url, requestSignal);
}

function queryOnce(url, requestSignal) {
  return new Promise((resolve, fail) => {
    const request = httpsRequest(url, { method: 'GET', headers: { Accept: 'application/dns-json' },
      servername: RESOLVER_HOST, rejectUnauthorized: true, agent: false, signal: requestSignal,
      lookup: (_hostname, options, callback) => options.all
        ? callback(null, [{ address: RESOLVER_ADDRESS, family: 4 }]) : callback(null, RESOLVER_ADDRESS, 4) }, response => {
      // Do not follow redirects, even if the resolver recommends another endpoint.
      if (response.statusCode !== 200 || Number(response.headers['content-length']) > MAX_DOH_BYTES) {
        response.destroy(); fail(reject('安全 DNS 查询失败')); return;
      }
      let size = 0;
      const chunks = [];
      response.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_DOH_BYTES) { response.destroy(); fail(reject('安全 DNS 响应超过限制')); }
        else chunks.push(chunk);
      });
      response.on('error', () => fail(reject('安全 DNS 查询失败')));
      response.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { fail(reject('安全 DNS 响应格式无效')); }
      });
    });
    request.on('error', () => fail(reject('安全 DNS 连接失败')));
    request.end();
  });
}

export function parseDohAnswer(hostname, type, response) {
  const name = canonical(hostname);
  if (!ordinaryDomain(name) || ![1, 28].includes(type) || response?.Status !== 0 || response.TC === true || response.CD === true
    || !Array.isArray(response.Question) || response.Question.length !== 1
    || canonical(response.Question[0]?.name) !== name || response.Question[0]?.type !== type
    || (response.Answer !== undefined && !Array.isArray(response.Answer))) throw reject('安全 DNS 响应无法确认');
  const answers = response.Answer ?? [];
  if (answers.length > 100) throw reject('安全 DNS 响应记录过多');
  const names = new Set([name]);
  let ttl = MAX_CACHE_SECONDS;
  for (let pass = 0; pass < answers.length; pass++) {
    let added = false;
    for (const answer of answers) {
      if (answer.type !== 5 || !names.has(canonical(answer.name))) continue;
      const target = canonical(answer.data);
      if (!ordinaryDomain(target)) throw reject('上游域名别名不安全');
      if (!names.has(target)) { names.add(target); added = true; }
    }
    if (!added) break;
  }
  const addresses = [];
  for (const answer of answers) {
    if (![1, 5, 28].includes(answer.type)) continue;
    if (!Number.isInteger(answer.TTL) || answer.TTL < 0 || !names.has(canonical(answer.name))) throw reject('安全 DNS 记录无效');
    ttl = Math.min(ttl, answer.TTL);
    if (answer.type === 5) continue;
    const family = isIP(answer.data);
    if ((answer.type === 1 && family !== 4) || (answer.type === 28 && family !== 6) || !publicAddress(answer.data)) {
      throw reject('上游地址不能指向本机、内网或保留网段');
    }
    addresses.push({ address: answer.data, family });
  }
  return { addresses, ttl };
}

/**
 * A fake-IP is never used for the outgoing request. Only an exclusively
 * 198.18.0.0/15 system answer enables the authenticated public-DNS fallback.
 * Mixed, private and reserved answers fail closed. Dependencies are injectable
 * only for isolated tests; production uses the fixed DoH transport above.
 */
export function createUpstreamResolver({ lookupImpl = lookup, queryImpl = queryOfficialDoh, clock = Date.now } = {}) {
  const cache = new Map();
  const inflight = new Map();
  async function queryRetry(name, type, signal) {
    let last;
    for (let attempt = 0; attempt < DOH_ATTEMPTS; attempt += 1) {
      try { return await queryImpl(name, type, { signal }); }
      catch (error) {
        last = error;
        if (signal?.aborted || error?.safeRejection) break;
      }
    }
    throw last;
  }
  async function resolvePublic(name, signal) {
    const cached = cache.get(name);
    if (cached && cached.expiresAt > clock()) return cached.addresses.map(entry => ({ ...entry }));
    cache.delete(name);
    const pending = inflight.get(name);
    if (pending) return pending.then(addresses => addresses.map(entry => ({ ...entry })));
    const work = (async () => {
      let responses;
      try { responses = await Promise.all([1, 28].map(type => queryRetry(name, type, signal))); }
      catch { throw reject('上游使用虚拟 DNS，但安全 DNS 查询失败'); }
      const parsed = responses.map((response, index) => parseDohAnswer(name, [1, 28][index], response));
      const addresses = [...new Map(parsed.flatMap(result => result.addresses).map(entry => [entry.address, entry])).values()];
      if (!addresses.length) throw reject('安全 DNS 未返回可用公网地址');
      const ttl = Math.min(MAX_CACHE_SECONDS, ...parsed.map(result => result.ttl));
      if (ttl > 0) {
        if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
        cache.set(name, { addresses: addresses.map(entry => ({ ...entry })), expiresAt: clock() + ttl * 1000 });
      }
      if (signal?.aborted) throw reject('上游请求超时');
      return addresses;
    })().finally(() => inflight.delete(name));
    inflight.set(name, work);
    return work;
  }
  return async function resolve(hostname, { signal, allowPrivateUpstreams = false } = {}) {
    if (signal?.aborted) throw reject('上游请求超时');
    let addresses;
    try { addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await lookupImpl(hostname, { all: true }); }
    catch { throw reject('无法解析上游地址'); }
    if (!Array.isArray(addresses) || !addresses.length || addresses.some(entry => !isIP(entry.address) || entry.family !== isIP(entry.address))) throw reject('无法解析上游地址');
    if (allowPrivateUpstreams || addresses.every(entry => publicAddress(entry.address))) return addresses;
    if (!ordinaryDomain(hostname) || !addresses.every(entry => fakeAddress(entry.address))) throw reject('上游地址不能指向本机、内网或保留网段');
    return resolvePublic(canonical(hostname), signal);
  };
}

export const resolveUpstreamAddresses = createUpstreamResolver();
