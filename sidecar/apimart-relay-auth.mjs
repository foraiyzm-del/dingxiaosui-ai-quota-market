// This is a single-purpose credential boundary, not a configurable forward proxy.
const RELAY_ORIGIN = 'https://relay.aiglink.cn';
const RELAY_HOST = 'relay.aiglink.cn';
const RELAY_HEADER = 'x-quota-relay-key';
const ROUTES = [
  ['GET', /^\/v1\/models$/u],
  ['POST', /^\/v1\/chat\/completions$/u],
  ['POST', /^\/v1\/images\/generations$/u],
  ['POST', /^\/v1\/videos\/generations$/u],
  ['GET', /^\/v1\/tasks\/[A-Za-z0-9_-]{1,200}$/u],
  ['POST', /^\/v1\/uploads\/images$/u],
  ['GET', /^\/v1\/videos\/[A-Za-z0-9_-]{1,200}\/content$/u],
];
const reject = message => Object.assign(new Error(message), { safeRejection: true });

export function withApimartRelayAuth(address, init = {}, env = process.env) {
  const entries = init.headers instanceof Headers || Array.isArray(init.headers)
    ? [...init.headers] : Object.entries(init.headers || {});
  // Always strip caller-supplied copies, including alternate casing and duplicates.
  const headers = Object.fromEntries(entries.filter(([name]) => String(name).toLowerCase() !== RELAY_HEADER));
  let url;
  try { url = new URL(address); } catch { throw reject('上游地址格式无效'); }
  const result = { ...init, headers, redirect: 'manual' };
  if (url.hostname !== RELAY_HOST) return result;
  const authority = String(address).match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/iu)?.[1];
  if (authority?.toLowerCase() !== RELAY_HOST || url.origin !== RELAY_ORIGIN || url.username || url.password
    || url.search || url.hash || url.pathname.includes('%')) {
    throw reject('专用中转地址或路径不符合配置');
  }
  if (env.APIMART_RELAY_ORIGIN !== RELAY_ORIGIN) throw reject('专用中转尚未启用，请核对服务端配置');
  const secret = env.APIMART_RELAY_SECRET;
  if (typeof secret !== 'string' || !/^[A-Za-z0-9_-]{32,256}$/u.test(secret)) {
    throw reject('专用中转认证尚未配置，请联系管理员');
  }
  const method = (init.method || 'GET').toUpperCase();
  if (!ROUTES.some(([allowed, pattern]) => allowed === method && pattern.test(url.pathname))) {
    throw reject('专用中转不支持此请求路径或方法');
  }
  headers['X-Quota-Relay-Key'] = secret;
  return result;
}
