// Leader cards carry this profile. Other products keep the platform's own models.
export const LEADER_QUOTA = Object.freeze({ text: 10, image: 15, video: 2 });
export const LEADER_VALID_DAYS = 90;
export const LEADER_CARD_COUNT = 100;
export const LEADER_SPARE_COUNT = 20;
export const FX_CNY_PER_USD = 7.2;

// Published APIMart gold-style reference prices used only to reserve budget.
// Text assumes a typical brief: 2000 input tokens and 1500 output tokens.
export const UNIT_COST_USD = Object.freeze({
  text: Object.freeze({ inputPerMillion: 1.6, outputPerMillion: 8, referenceInputTokens: 2000, referenceOutputTokens: 1500 }),
  image: Object.freeze({ perRequest: 0.01 }),
  video: Object.freeze({ perRequest: 1.08 }),
});

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
  return (cost.referenceInputTokens * cost.inputPerMillion + cost.referenceOutputTokens * cost.outputPerMillion) / 1_000_000;
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
      textTokens: { input: UNIT_COST_USD.text.referenceInputTokens, output: UNIT_COST_USD.text.referenceOutputTokens },
      imageUsd: UNIT_COST_USD.image.perRequest,
      videoUsd: UNIT_COST_USD.video.perRequest,
      fx: FX_CNY_PER_USD,
    },
  };
}

export function modelPricing(model) {
  if (model === 'claude-sonnet-5-5') return { inputPerMillionCents: 160, outputPerMillionCents: 800 };
  if (model === 'deepseek-v4.1-flash') return { inputPerMillionCents: 22.86, outputPerMillionCents: 91.43 };
  if (model === 'seedance-2.5') return { perRequestCents: 108 };
  if (model === 'gpt-image-2.5-flare') return { perRequestCents: 1 };
  return null;
}

export function modelTimeoutMs(model, configured = 120000) {
  const floor = model === 'claude-sonnet-5-5' ? 240000 : model === 'seedance-2.5' || model === 'seedance-2.0' ? 180000 : configured;
  return Math.min(300000, Math.max(configured, floor));
}
