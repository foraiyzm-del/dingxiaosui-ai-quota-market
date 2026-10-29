// A missing vector is the legacy shared balance. A present vector is always
// canonical and cannot silently turn one generation capability into another.
export const CAPABILITIES = ['text', 'image', 'video'];
export const MAX_QUOTA_UNITS = 1_000_000;
export function normalizeQuota(value) {
  if (value === undefined || value === null) return null;
  const invalid = () => { throw Object.assign(new Error('分项次数须为文字、图片、视频的非负整数，合计为 1 至 1000000'), { status: 400 }); };
  if (typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !CAPABILITIES.includes(key))) invalid();
  const result = Object.fromEntries(CAPABILITIES.map(capability => [capability, value[capability] ?? 0]));
  if (Object.values(result).some(count => !Number.isSafeInteger(count) || count < 0 || count > MAX_QUOTA_UNITS)) invalid();
  const total = quotaTotal(result);
  if (total < 1 || total > MAX_QUOTA_UNITS) invalid();
  return result;
}
export const quotaTotal = value => CAPABILITIES.reduce((total, capability) => total + (value?.[capability] ?? 0), 0);
export const quotaKey = value => value ? JSON.stringify(normalizeQuota(value)) : '';
export const readQuota = value => value ? normalizeQuota(JSON.parse(value)) : null;
