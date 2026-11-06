import { LEADER_MODEL_IDS } from './model-tiers.mjs';
import { withApimartRelayAuth } from './apimart-relay-auth.mjs';

const labels = {
  'claude-sonnet-5-5': '文案 claude-sonnet-5-5',
  'gpt-image-2.5-flare': '图片 gpt-image-2.5-flare',
  'seedance-2.5': '视频 seedance-2.5',
  'seedance-2.0': '视频降级 seedance-2.0',
  'seedance-2.0-mini': '视频保底 seedance-2.0-mini',
  'deepseek-v4.1-flash': '文案保底 deepseek-v4.1-flash',
};

export function modelIds(body) {
  const rows = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];
  return new Set(rows.map(item => (typeof item === 'string' ? item : item?.id || item?.name)).filter(id => typeof id === 'string' && id));
}

export function missingLeaderModels(available) {
  return LEADER_MODEL_IDS.filter(id => !available.has(id));
}

export function describeMissingModels(missing) {
  if (!missing.length) return '领导卡要用的模型，这把密钥都有权限。';
  const names = missing.map(id => labels[id] || id).join('、');
  const safety = !missing.includes('deepseek-v4.1-flash') && !missing.includes('seedance-2.0-mini')
    ? '生成时会自动改用已开通的 deepseek-v4.1-flash 和 seedance-2.0-mini，用户仍能出结果，不会多扣次数。'
    : '保底模型也没有权限，用户可能暂时做不了对应的内容。';
  return `这把密钥还没有这些模型的权限：${names}。${safety}`;
}

export async function listAccessibleModels({ baseUrl, apiKey, fetchImpl = fetch } = {}) {
  const root = String(baseUrl || '').replace(/\/$/, '');
  const response = await fetchImpl(`${root}/models`, withApimartRelayAuth(`${root}/models`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15000) }));
  if (!response.ok) {
    const error = new Error(`模型列表接口返回 HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return modelIds(await response.json());
}
