// Leader cards carry this profile. Other products keep the platform's own models.
export const LEADER_QUOTA = Object.freeze({ text: 10, image: 15, video: 2 });
export const LEADER_VALID_DAYS = 90;
export const LEADER_CARD_COUNT = 100;
export const LEADER_SPARE_COUNT = 20;
export const FX_CNY_PER_USD = 7.2;

// Published APIMart gold-style reference prices used only to reserve budget.
// Text assumes a typical brief: 2000 input tokens and 1500 output tokens.
export const UNIT_COST_USD = Object.freeze({
  // Reasoning tokens are billed as output. With thinking disabled the reference is 0;
  // a real response that still reports them is added in the per-job estimate.
  text: Object.freeze({ inputPerMillion: 1.6, outputPerMillion: 8, referenceInputTokens: 2000, referenceOutputTokens: 1500, referenceReasoningTokens: 0 }),
  image: Object.freeze({ perRequest: 0.01 }),
  video: Object.freeze({ perRequest: 1.08 }),
});

// DeepSeek V4 enables high-effort thinking unless the request turns it off.
// Claude extended thinking stays off unless the request sends a thinking block
// or a "-thinking" model id. Both are explicit so a gateway default cannot add a long chain of thought.
export const TEXT_REASONING = Object.freeze({
  'deepseek-v4.1-flash': Object.freeze({ reasoning_effort: 'none', thinking: Object.freeze({ type: 'disabled' }) }),
  'deepseek-v4-flash': Object.freeze({ reasoning_effort: 'none', thinking: Object.freeze({ type: 'disabled' }) }),
  'claude-sonnet-5-5': Object.freeze({ reasoning_effort: 'none' }),
});

export function reasoningControls(model) {
  return TEXT_REASONING[model] || null;
}

export const LEADER_PROFILE = Object.freeze({
  tier: 'leader',
  video: Object.freeze({ seconds: 5, resolution: '720p', audio: false }),
  models: Object.freeze({ text: 'claude-sonnet-5-5', image: 'gpt-image-2.5-flare', video: 'seedance-2.5' }),
  image: Object.freeze({ resolution: '1k', quality: 'low', size: '1:1' }),
  fallbacks: Object.freeze({ text: 'deepseek-v4.1-flash', video: 'seedance-2.0' }),
});

export const STANDARD_PROFILE = Object.freeze({
  tier: 'standard',
  video: Object.freeze({ seconds: 5, resolution: '480p', audio: false }),
  models: Object.freeze({ text: 'deepseek-v4.1-flash', image: 'gpt-image-2.5-flare', video: 'seedance-2.0-mini' }),
});

export function textCallUsd(cost = UNIT_COST_USD.text) {
  const outputTokens = (cost.referenceOutputTokens || 0) + (cost.referenceReasoningTokens || 0);
  return (cost.referenceInputTokens * cost.inputPerMillion + outputTokens * cost.outputPerMillion) / 1_000_000;
}

/** Models a leader card may call, including the degradation chain. */
export const LEADER_MODEL_IDS = Object.freeze([
  'claude-sonnet-5-5', 'gpt-image-2.5-flare', 'seedance-2.5', 'seedance-2.0', 'seedance-2.0-mini', 'deepseek-v4.1-flash',
]);

const STANDARD_TEXT = new Set(['deepseek-v4.1-flash', 'deepseek-v4-flash']);
const STANDARD_VIDEO = new Set(['seedance-2.0-mini']);
// Live seedance-2.5 720p clips return in about three minutes. Wait past five minutes.
export const VIDEO_WAIT_MS = 8 * 60 * 1000;

export function fallbackChain(capability, primary, configured, tier = 'standard') {
  const configuredModel = typeof configured === 'string' ? configured : configured?.model;
  const leader = tier === 'leader';
  const steps = [];
  const allowed = capability === 'text' ? (leader ? null : STANDARD_TEXT) : capability === 'video' ? (leader ? null : STANDARD_VIDEO) : null;
  const push = step => {
    if (!step.model || step.model === primary || steps.some(item => item.model === step.model)) return;
    if (allowed && !allowed.has(step.model)) return;
    steps.push(step);
  };
  if (capability === 'text') {
    if (!leader && !configuredModel) return steps;
    push({ model: configuredModel || 'deepseek-v4.1-flash' });
    if (leader) push({ model: 'deepseek-v4.1-flash' });
  } else if (capability === 'video' && leader) {
    push({ model: configuredModel || 'seedance-2.0', resolution: '720p' });
    push({ model: 'seedance-2.0', resolution: '720p' });
    // Mini is the last model this key is known to allow. Try the sold 720p first.
    push({ model: 'seedance-2.0-mini', resolution: '720p', resolutionFallback: '480p' });
  } else if (capability === 'video' && configuredModel) {
    push({ model: configuredModel, resolution: '480p' });
  }
  return steps;
}

export function batchUpstreamCost(cards, quota = LEADER_QUOTA) {
  const textEach = textCallUsd();
  const usd = cards * (quota.text * textEach + quota.image * UNIT_COST_USD.image.perRequest + quota.video * UNIT_COST_USD.video.perRequest);
  return {
    cards,
    quota: { ...quota },
    usd: Math.round(usd * 100) / 100,
    cny: Math.round(usd * FX_CNY_PER_USD * 100) / 100,
    counts: { text: quota.text * cards, image: quota.image * cards, video: quota.video * cards },
    assumptions: {
      textTokens: { input: UNIT_COST_USD.text.referenceInputTokens, output: UNIT_COST_USD.text.referenceOutputTokens, reasoning: UNIT_COST_USD.text.referenceReasoningTokens },
      imageUsd: UNIT_COST_USD.image.perRequest,
      videoUsd: UNIT_COST_USD.video.perRequest,
      fx: FX_CNY_PER_USD,
    },
  };
}

export function modelPricing(model) {
  if (model === 'claude-sonnet-5-5') return { inputPerMillionCents: 160, outputPerMillionCents: 800 };
  if (model === 'deepseek-v4.1-flash') return { inputPerMillionCents: 22.86, outputPerMillionCents: 91.43 };
  if (model === 'seedance-2.5') return { perRequestCents: 108, referenceSeconds: 5 };
  if (model === 'gpt-image-2.5-flare') return { perRequestCents: 1 };
  return null;
}

export function modelTimeoutMs(model, configured = 120000) {
  const video = model === 'seedance-2.5' || model === 'seedance-2.0';
  const floor = model === 'claude-sonnet-5-5' ? 240000 : video ? VIDEO_WAIT_MS : configured;
  return Math.min(video ? VIDEO_WAIT_MS : 300000, Math.max(configured, floor));
}
