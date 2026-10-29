/** Server-side only. Never expose this client or its apiKey to browser bundles. */
export function createUsageClient({ baseUrl, apiKey, fetchImpl = fetch, timeoutMs = 130000 }) {
  if (!baseUrl || !apiKey) throw new Error('需要本发卡中心的服务地址和平台接入凭证');
  const endpoint = baseUrl.replace(/\/$/, '').replace(/\/api\/v1$/, '') + '/api/v1';
  async function request(path, { method = 'POST', data } = {}) {
    const response = await fetchImpl(endpoint + path, { method, redirect: 'error',
      headers: { authorization: `Bearer ${apiKey}`, ...(data === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }), signal: AbortSignal.timeout(timeoutMs) });
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.error || '发卡中心请求失败'), { status: response.status });
    return result;
  }
  return {
    redeem: ({ userId, code, idempotent }) => request('/redeem', { data: { userId, code, idempotent } }),
    balance: userId => request(`/balance?userId=${encodeURIComponent(userId)}`, { method: 'GET' }),
    generate: ({ userId, requestId, capability, prompt, size, seconds, messages, responseFormat, maxTokens, aspectRatio, referenceImage }) => request('/generate', { data: { userId, requestId, capability, prompt, size, seconds, messages, responseFormat, maxTokens, aspectRatio, referenceImage } }),
    job: ({ id, userId }) => request(`/generation/${encodeURIComponent(id)}?userId=${encodeURIComponent(userId)}`, { method: 'GET' }),
    reserve: ({ userId, requestId, units = 1, capability }) => request('/usage/reserve', { data: { userId, requestId, units, capability } }),
    commit: usageId => request(`/usage/${encodeURIComponent(usageId)}/commit`, { data: {} }),
    cancel: usageId => request(`/usage/${encodeURIComponent(usageId)}/cancel`, { data: {} }),
  };
}
