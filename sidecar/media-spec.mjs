const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/u;
export const VIDEO_DURATION_OPTIONS = Object.freeze([5, 10, 15]);

function videoSpec(video) {
  if (!video || typeof video !== 'object' || Array.isArray(video)) fail(400, '视频规格格式无效');
  if (!VIDEO_DURATION_OPTIONS.includes(video.seconds)) fail(400, '视频默认时长只允许 5 秒、10 秒或 15 秒');
  if (video.resolution !== '480p' && video.resolution !== '720p') fail(400, '视频分辨率只允许 480p 或 720p');
  if (typeof video.audio !== 'boolean') fail(400, '请明确视频是否包含音频');
  return { seconds: video.seconds, resolution: video.resolution, audio: video.audio };
}

function modelMap(value, label) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, `${label}格式无效`);
  const result = {};
  for (const key of ['text', 'image', 'video']) {
    if (value[key] === undefined || value[key] === '') continue;
    if (typeof value[key] !== 'string' || !MODEL.test(value[key])) fail(400, `${label}里的模型名称无效`);
    result[key] = value[key];
  }
  if (Object.keys(value).some(key => !['text', 'image', 'video'].includes(key))) fail(400, `${label}格式无效`);
  return Object.keys(result).length ? result : null;
}

function imageSpec(value) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, '图片规格格式无效');
  if (value.resolution !== '1k') fail(400, '图片规格目前只允许 1k');
  if (value.quality !== undefined && value.quality !== 'low') fail(400, '图片质量规格无效');
  if (value.size !== undefined && value.size !== '1:1') fail(400, '图片比例规格无效');
  return { resolution: '1k', quality: value.quality || 'low', size: value.size || '1:1' };
}

/** Sold media shape. Models are optional and apply only to cards that store them. */
export function mediaSpec(value) {
  if (value === undefined || value === null || value === '') return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, '商品媒体规格格式无效');
  const allowed = new Set(['video', 'models', 'image', 'fallbacks', 'tier']);
  if (Object.keys(value).some(key => !allowed.has(key))) fail(400, '商品媒体规格格式无效');
  const hasVideo = value.video !== undefined && value.video !== null;
  if (!hasVideo && Object.keys(value).length) fail(400, '商品媒体规格格式无效');
  if (!hasVideo) return null;
  const result = { video: videoSpec(value.video) };
  if (value.tier !== undefined && value.tier !== null && value.tier !== '') {
    if (value.tier !== 'standard' && value.tier !== 'leader') fail(400, '模型档位只允许标准档或领导体验档');
    result.tier = value.tier;
  }
  const models = modelMap(value.models, '模型绑定');
  const fallbacks = modelMap(value.fallbacks, '备用模型');
  const image = imageSpec(value.image);
  if (models) result.models = models;
  if (fallbacks) result.fallbacks = fallbacks;
  if (image) result.image = image;
  return result;
}

export const NEW_CARD_VIDEO_SPEC = Object.freeze({ video: Object.freeze({ seconds: 5, resolution: '480p', audio: false }) });
