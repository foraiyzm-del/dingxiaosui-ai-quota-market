// Minimal service-only adapter for the published OPCPay v1 contract.
// No SDK dependency and no credential is exposed to browser code.
export function createOpcpayClient({ apiKey, baseURL = 'https://ai6666.com/opcpay/api/pay/v1', fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
  const base = new URL(baseURL);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new Error('OPCPay API 地址必须为 HTTPS');
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw new Error('OPCPay Key 未配置');
  async function request(path, body) {
    let response;
    try {
      response = await fetchImpl(base.href.replace(/\/$/u, '') + path, {
        method: body === undefined ? 'GET' : 'POST', redirect: 'error',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
      });
    } catch { throw Object.assign(new Error('OPCPay 请求结果未知，请查询原记录'), { status: 502, code: 'UPSTREAM_UNKNOWN' }); }
    let result;
    try { result = await response.json(); if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error(); }
    catch { throw Object.assign(new Error('OPCPay 响应无效，请查询原记录'), { status: 502, code: 'INVALID_RESPONSE' }); }
    if (!response.ok) throw Object.assign(new Error('OPCPay 请求未完成，请查询原记录'), {
      status: response.status, code: typeof result.error_code === 'string' ? result.error_code : 'UPSTREAM_ERROR', retryable: result.retryable === true,
    });
    return result;
  }
  return {
    capabilities: () => request('/capabilities'), product: () => request('/product'),
    access: (userId, amount = 1) => request('/access', { user_id: userId, amount }),
    purchase: ({ userId, idempotencyKey, skuId, callbackURL }) => request('/purchase', {
      user_id: userId, idempotency_key: idempotencyKey, sku_id: skuId, ...(callbackURL ? { callback_url: callbackURL } : {}),
    }),
    purchaseQuery: (userId, idempotencyKey) => request('/purchase/query', { user_id: userId, idempotency_key: idempotencyKey }),
    consume: ({ userId, idempotencyKey, amount = 1, reason }) => request('/consume', { user_id: userId, idempotency_key: idempotencyKey, amount, reason }),
    consumption: (userId, idempotencyKey) => request('/consumption', { user_id: userId, idempotency_key: idempotencyKey }),
  };
}
