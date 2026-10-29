// APIMart's media APIs return asynchronous task envelopes, unlike OpenAI Images.
// Contract: https://docs.apimart.ai/en/api-reference/tasks/status.md
import { textPayload } from './generation-options.mjs';
export const APIMART_ENDPOINTS = Object.freeze({
  text: 'chat/completions', image: 'images/generations', video: 'videos/generations',
  videoStatus: 'tasks/{id}', videoContent: 'videos/{id}/content',
});

export function apimartPayload(fields, model) {
  if (fields.capability === 'text') return textPayload(fields, model, 1024);
  const payload = { model, prompt: fields.prompt };
  if (fields.capability === 'image') {
    payload.n = 1;
    if (/^gpt-image-2\.5-(flare|sunburst)$/u.test(model)) Object.assign(payload, { size: '1:1', resolution: '1k', quality: 'low' });
    if (fields.size) payload.size = fields.size;
    if (fields.aspectRatio) payload.size = fields.aspectRatio;
  } else {
    if (/^seedance-2\.0(?:-mini|-fast)?$/u.test(model)) Object.assign(payload, { duration: 5, resolution: '480p', size: '16:9', generate_audio: false });
    if (fields.seconds) payload.duration = Number(fields.seconds);
    if (fields.size) payload.size = fields.size;
    if (fields.aspectRatio) payload.size = fields.aspectRatio;
  }
  return payload;
}

function urls(items) {
  if (!Array.isArray(items)) return [];
  return items.flatMap(item => {
    const value = typeof item === 'string' ? item : item?.url;
    return (Array.isArray(value) ? value : [value]).filter(url => typeof url === 'string');
  });
}

/** Normalize only known response fields. URL safety and quota settlement stay in generation. */
export function normalizeApimartResponse(capability, response) {
  if (capability === 'text') {
    if (response?.code !== undefined && response.code !== 200) return {};
    if (Array.isArray(response?.choices)) return response;
    // Both native Chat Completions and APIMart's documented success envelope occur.
    return response?.code === 200 && Array.isArray(response.data?.choices) ? response.data : {};
  }
  if (response?.code !== undefined && response.code !== 200) return {};
  const task = Array.isArray(response?.data) ? response.data[0] : response?.data;
  if (!task || typeof task !== 'object') return {};
  const result = task.result;
  const status = task.status === 'submitted' ? 'queued' : task.status;
  const id = task.task_id ?? task.id;
  return {
    id, status, usage: task.usage,
    ...(capability === 'image' ? { data: urls(result?.images).slice(0, 1).map(url => ({ url })) }
      : { url: urls(result?.videos)[0] }),
  };
}
