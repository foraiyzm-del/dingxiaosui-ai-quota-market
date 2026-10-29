import {APIMART_IMAGE_MODEL, APIMART_TEXT_MODEL, apimartImageProfiles, apimartVideoProfile} from './apimart-protocol';

// Server-side definitions only. This file issues no codes and grants no rights.
// The independent Zidingxiang event ledger is the redemption/billing authority.
// Future paid profiles may choose other model definitions. They must be explicitly
// priced and enabled server-side; this event never falls through to another profile.
export const eventServiceProfiles = Object.freeze({
  standard: Object.freeze({
    id: 'standard',
    image: Object.freeze({...apimartImageProfiles.standard, provider: 'apimart'}),
    text: Object.freeze({provider: 'apimart', model: APIMART_TEXT_MODEL}),
    video: Object.freeze({...apimartVideoProfile, provider: 'apimart'}),
    paidEnabled: false,
    price: null,
  }),
  premium: Object.freeze({
    id: 'premium',
    image: Object.freeze({...apimartImageProfiles.quality, provider: 'apimart'}),
    text: Object.freeze({provider: 'apimart', model: null, candidateModel: 'deepseek-v4-pro'}),
    paidEnabled: false,
    price: null,
  }),
});

export type EventCapability = 'image.generate.standard' | 'text.generate.standard' | 'video.generate.standard';
export type EventGrant = Readonly<{
  capabilityId: EventCapability;
  serviceProfileId: 'standard';
  unit: 'image' | 'text' | 'video';
  units: number;
}>;
export type EventPlan = Readonly<{
  schemaVersion: 1;
  id: string;
  appId: 'zidingxiang';
  label: string;
  administrativeIssuanceOnly: true;
  activationAuthority: 'zidingxiang';
  cardCount: number;
  validityDays: number;
  validityStartsAt: 'redemption';
  maxRedemptionsPerCode: 1;
  grants: readonly EventGrant[];
}>;

export const launchEventPlan: EventPlan = Object.freeze({
  schemaVersion: 1,
  id: 'zdx-launch-50-v2',
  appId: 'zidingxiang',
  label: '紫丁香现场体验 · 标准版',
  administrativeIssuanceOnly: true,
  activationAuthority: 'zidingxiang',
  cardCount: 50,
  validityDays: 7,
  validityStartsAt: 'redemption',
  maxRedemptionsPerCode: 1,
  grants: Object.freeze([
    Object.freeze({capabilityId: 'image.generate.standard', serviceProfileId: 'standard', unit: 'image', units: 5}),
    Object.freeze({capabilityId: 'text.generate.standard', serviceProfileId: 'standard', unit: 'text', units: 10}),
    Object.freeze({capabilityId: 'video.generate.standard', serviceProfileId: 'standard', unit: 'video', units: 2}),
  ]),
});

export class EventPlanError extends Error {}
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new EventPlanError('体验方案格式不正确');
  return value as Record<string, unknown>;
};
const integer = (value: unknown, maximum: number) => Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= maximum;
const exactKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every(key => keys.includes(key)) && keys.every(key => Object.hasOwn(value, key));

export function validateEventPlan(value: unknown): asserts value is EventPlan {
  const plan = record(value);
  if (!exactKeys(plan, ['schemaVersion', 'id', 'appId', 'label', 'administrativeIssuanceOnly', 'activationAuthority', 'cardCount', 'validityDays', 'validityStartsAt', 'maxRedemptionsPerCode', 'grants']) ||
      plan.schemaVersion !== 1 || typeof plan.id !== 'string' || !/^[a-z0-9][a-z0-9-]{2,79}$/.test(plan.id) ||
      plan.appId !== 'zidingxiang' || typeof plan.label !== 'string' || !plan.label.trim() || plan.label.length > 80 ||
      plan.administrativeIssuanceOnly !== true || plan.activationAuthority !== 'zidingxiang' ||
      !integer(plan.cardCount, 10000) || !integer(plan.validityDays, 3650) ||
      plan.validityStartsAt !== 'redemption' || plan.maxRedemptionsPerCode !== 1 ||
      !Array.isArray(plan.grants) || ![2,3].includes(plan.grants.length)) throw new EventPlanError('体验方案字段不完整或超出允许范围');
  const capabilities = new Set<string>();
  for (const value of plan.grants) {
    const grant = record(value);
    if (!exactKeys(grant, ['capabilityId', 'serviceProfileId', 'unit', 'units']) ||
        grant.serviceProfileId !== 'standard' || !integer(grant.units, 100000) ||
        !((grant.capabilityId === 'image.generate.standard' && grant.unit === 'image') ||
          (grant.capabilityId === 'text.generate.standard' && grant.unit === 'text') ||
          (grant.capabilityId === 'video.generate.standard' && grant.unit === 'video' && grant.units === 2)) ||
        capabilities.has(String(grant.capabilityId))) throw new EventPlanError('图片、文案与视频须使用各自独立的标准版次数；视频每卡 2 次');
    capabilities.add(String(grant.capabilityId));
  }
  if (!capabilities.has('image.generate.standard') || !capabilities.has('text.generate.standard') ||
      (plan.id !== 'zdx-launch-50-v1' && !capabilities.has('video.generate.standard'))) throw new EventPlanError('体验方案缺少所需创作额度');
  if (eventServiceProfiles.standard.image.model !== APIMART_IMAGE_MODEL ||
      eventServiceProfiles.standard.image.resolution !== '2k' || eventServiceProfiles.standard.image.quality !== 'medium' ||
      eventServiceProfiles.premium.paidEnabled || eventServiceProfiles.premium.price !== null ||
      eventServiceProfiles.premium.text.model !== null) throw new EventPlanError('模型档位与已确认的体验方案不一致');
}

// No substitution between standard/premium, image/text or different capabilities.
export function eventGrant(capabilityId: string, plan: EventPlan = launchEventPlan): EventGrant {
  validateEventPlan(plan);
  const grant = plan.grants.find(row => row.capabilityId === capabilityId);
  if (!grant) throw new EventPlanError('本体验卡不包含此服务档位');
  return grant;
}

// Existing issued v1 snapshots remain immutable; this additive upgrade also applies
// to their unredeemed cards. Other unknown plans never inherit video implicitly.
export function eventVideoUnits(plan: EventPlan = launchEventPlan): number {
  validateEventPlan(plan);
  const grant = plan.grants.find(row => row.capabilityId === 'video.generate.standard');
  if (grant) return grant.units;
  if (plan.id === 'zdx-launch-50-v1') return 2;
  throw new EventPlanError('本体验卡不包含视频服务');
}

// Seven 24-hour periods from successful redemption, never from code preparation.
export function eventExpiry(redeemedAt: string, plan: EventPlan = launchEventPlan): string {
  validateEventPlan(plan);
  if (typeof redeemedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(redeemedAt)) throw new EventPlanError('兑换时间须包含完整日期、时间和时区');
  const start = Date.parse(redeemedAt), end = start + plan.validityDays * 86400000;
  if (!Number.isFinite(start) || !Number.isFinite(end) || Math.abs(end) > 8.64e15) throw new EventPlanError('兑换时间不正确');
  return new Date(end).toISOString();
}

export function eventPreparationSummary(plan: EventPlan = launchEventPlan) {
  validateEventPlan(plan);
  return {
    status: 'prepared_not_issued' as const,
    activationAuthority: plan.activationAuthority,
    issued: false,
    planId: plan.id,
    cardCount: plan.cardCount,
    validityDays: plan.validityDays,
    validityStartsAt: plan.validityStartsAt,
    totalImageUnits: eventGrant('image.generate.standard', plan).units * plan.cardCount,
    totalTextUnits: eventGrant('text.generate.standard', plan).units * plan.cardCount,
    totalVideoUnits: eventVideoUnits(plan) * plan.cardCount,
    paidEnabled: false,
    notice: '仅为发行准备。只有管理员在目标紫丁香数据库完成发卡后，激活码才能在该环境兑换。',
  };
}
