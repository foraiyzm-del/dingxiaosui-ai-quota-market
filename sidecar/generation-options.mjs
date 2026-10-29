import { imageMime } from './image.mjs';

const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
export const MAX_REFERENCE_BYTES = 6 * 1024 * 1024;

export function referenceImage(value) {
  if (typeof value !== 'string' || value.length > MAX_REFERENCE_BYTES * 4 / 3 + 100) fail('参考图片不能超过 6 MiB');
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/u.exec(value);
  if (!match) fail('参考图片仅支持 PNG、JPG 或 WebP');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > MAX_REFERENCE_BYTES || bytes.toString('base64') !== match[2]) fail('参考图片编码无效或过大');
  const contentType = imageMime(bytes);
  if (match[1] !== contentType) fail('参考图片内容与格式不匹配');
  return { bytes, contentType };
}

// Only a documented subset is accepted. Neither models nor upstream endpoints
// can be selected through these generation options.
export function generationOptions(input, capability) {
  const options = {};
  if (input.messages !== undefined) {
    if (capability !== 'text' || !Array.isArray(input.messages) || !input.messages.length || input.messages.length > 64) fail('文字消息格式无效');
    let length = 0;
    options.messages = input.messages.map(message => {
      if (!message || !['system', 'user', 'assistant'].includes(message.role) || typeof message.content !== 'string' || !message.content.trim()) fail('文字消息内容无效');
      length += message.content.length;
      if (length > 131072 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(message.content)) fail('文字消息内容过长或格式无效');
      return { role: message.role, content: message.content };
    });
  }
  if (input.responseFormat !== undefined) {
    if (capability !== 'text' || input.responseFormat !== 'json_object') fail('文字输出格式无效');
    options.responseFormat = input.responseFormat;
  }
  if (input.maxTokens !== undefined) {
    if (capability !== 'text' || !Number.isInteger(input.maxTokens) || input.maxTokens < 1 || input.maxTokens > 32768) fail('输出长度必须为 1 至 32768');
    options.maxTokens = input.maxTokens;
  }
  if (input.aspectRatio !== undefined) {
    if (capability === 'text' || !['1:1', '3:4', '4:3', '16:9', '9:16'].includes(input.aspectRatio)) fail('图片或视频比例无效');
    options.aspectRatio = input.aspectRatio;
  }
  if (input.referenceImage !== undefined) {
    if (capability !== 'image') fail('参考图仅支持图片生成');
    referenceImage(input.referenceImage);
    options.referenceImage = input.referenceImage;
  }
  return options;
}

export function textPayload(fields, model, defaultMaxTokens) {
  return { model, messages: fields.messages ?? [{ role: 'user', content: fields.prompt }], stream: false,
    ...((fields.maxTokens ?? defaultMaxTokens) ? { max_tokens: fields.maxTokens ?? defaultMaxTokens } : {}),
    ...(fields.responseFormat ? { response_format: { type: fields.responseFormat } } : {}) };
}
