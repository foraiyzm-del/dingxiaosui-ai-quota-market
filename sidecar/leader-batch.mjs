import { LEADER_CARD_COUNT, LEADER_PROFILE, LEADER_QUOTA, LEADER_SPARE_COUNT, LEADER_VALID_DAYS, batchUpstreamCost, modelPricing } from './model-tiers.mjs';

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const PROJECT_ID = 'dingxiaosui';
const PRODUCT_ID = 'leader-experience';

function ensureModel(channels, channelId, capability, model) {
  const current = channels.listChannels().find(channel => channel.id === channelId);
  if (!current) fail(404, '渠道不存在');
  if (current.models.some(item => item.capability === capability && item.id === model)) return false;
  const pricing = modelPricing(model);
  channels.saveChannel({ ...current, apiKey: '', models: [...current.models, { id: model, capability, ...(pricing ? { pricing } : {}) }] });
  return true;
}

export function leaderQuote(quantity = LEADER_CARD_COUNT + LEADER_SPARE_COUNT) {
  return { ...batchUpstreamCost(quantity, LEADER_QUOTA), validDays: LEADER_VALID_DAYS, profile: LEADER_PROFILE, productId: PRODUCT_ID };
}

/**
 * Creates the inactive「领导体验卡」product and one gift batch.
 * Does not change platform bindings or any other product's model.
 */
export function issueLeaderBatch({ quota, channels, platforms, commerce, budgets, siteSettings, quantity = LEADER_CARD_COUNT + LEADER_SPARE_COUNT, validDays = LEADER_VALID_DAYS, origin, topUp = false, force = false } = {}) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000) fail(400, '制卡数量须为 1 至 1000');
  if (!quota.listProjects().some(project => project.id === PROJECT_ID)) quota.createProject({ id: PROJECT_ID, name: '丁小穗' });
  let platform;
  try { platform = platforms.getPlatform(PROJECT_ID); }
  catch { fail(409, '请先在后台创建 dingxiaosui 业务平台并绑定文案、图片、视频渠道，再生成领导体验卡'); }
  const needed = ['text', 'image', 'video'];
  for (const capability of needed) if (!platform.bindings.some(binding => binding.capability === capability)) fail(409, `丁小穗平台还没有绑定${capability === 'text' ? '文案' : capability === 'image' ? '图片' : '视频'}渠道`);
  const added = [];
  for (const capability of needed) {
    const binding = platform.bindings.find(item => item.capability === capability);
    const model = LEADER_PROFILE.models[capability];
    if (ensureModel(channels, binding.channelId, capability, model)) added.push(model);
    const fallback = LEADER_PROFILE.fallbacks[capability];
    if (fallback && ensureModel(channels, binding.channelId, capability, fallback)) added.push(fallback);
  }
  const bindingsAfter = platforms.getPlatform(PROJECT_ID).bindings.map(binding => ({ capability: binding.capability, model: binding.model, channelId: binding.channelId }));
  const quote = leaderQuote(quantity);
  const budgetReport = [];
  for (const capability of needed) {
    const binding = platform.bindings.find(item => item.capability === capability);
    const budget = budgets?.getBudget(binding.channelId);
    const count = quote.counts[capability];
    if (!budget) { budgetReport.push({ capability, channelId: binding.channelId, enforced: false, required: count }); continue; }
    let remaining = budget.remaining[capability];
    if (remaining < count) {
      if (!topUp) fail(409, `${capability === 'text' ? '文案' : capability === 'image' ? '图片' : '视频'}渠道额度只剩 ${remaining} 次，这批卡需要 ${count} 次。可在后台调高额度，或加 --top-up`);
      const total = { ...budget.total, [capability]: budget.total[capability] + (count - remaining) };
      budgets.saveBudget({ channelId: binding.channelId, total });
      remaining = count;
    }
    budgetReport.push({ capability, channelId: binding.channelId, enforced: true, required: count, remainingBeforeIssue: remaining });
  }
  const existing = commerce.listProducts({ admin: true }).find(product => product.id === PRODUCT_ID);
  const packageOption = { id: 'leader', label: '领导体验', description: '文案 10 次、图片 15 张、视频 2 条。仅这批卡使用高配模型。', projectId: PROJECT_ID, units: LEADER_QUOTA.text + LEADER_QUOTA.image + LEADER_QUOTA.video, priceCents: 1, quota: { ...LEADER_QUOTA } };
  if (!existing) {
    commerce.saveProduct({ id: PRODUCT_ID, projectId: PROJECT_ID, name: '领导体验卡', description: '发给领导的实体体验卡。不在商城销售。文案、图片、视频次数不能互相挪用。', units: packageOption.units, priceCents: 1, active: false, fulfillment: 'stock', packageOptions: [packageOption], mediaSpec: LEADER_PROFILE });
  } else if (JSON.stringify(existing.packageOptions?.[0]?.quota) !== JSON.stringify(LEADER_QUOTA)) {
    fail(409, '已有「领导体验卡」商品，但次数与 10 文案 / 15 图片 / 2 视频不一致，请先核对后再生成');
  } else if (existing.mediaSpec?.tier !== 'leader') {
    commerce.saveProduct({ id: existing.id, projectId: existing.projectId, name: existing.name, description: existing.description,
      units: existing.units, priceCents: existing.priceCents, active: false, fulfillment: existing.fulfillment,
      packageOptions: existing.packageOptions.map(({ stockAvailable, ...option }) => option), mediaSpec: LEADER_PROFILE });
  }
  if (!force && commerce.listBatches().some(batch => batch.productId === PRODUCT_ID && batch.tier === 'leader')) {
    fail(409, '已经有一批领导体验卡。确认还要再制一批时，请加上 --force');
  }
  if (origin && siteSettings) siteSettings.save({ dingxiaosuiOrigin: origin });
  const batch = commerce.generateInventory({ productId: PRODUCT_ID, packageId: 'leader', quantity, delivery: 'gift', validDays });
  return { batch, quote, addedModels: added, bindings: bindingsAfter, budgetReport, origin: siteSettings?.get().dingxiaosuiOrigin || origin || '' };
}
