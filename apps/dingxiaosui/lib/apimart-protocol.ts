// APIMart's image endpoint accepts OpenAI-like inputs but returns asynchronous tasks.
// Keep this module free of credentials, storage and network access.
export const APIMART_IMAGE_ENDPOINT = 'https://api.apimart.ai/v1/images/generations';
export const APIMART_TEXT_ENDPOINT = 'https://api.apimart.ai/v1/chat/completions';
export const APIMART_IMAGE_MODEL = 'gpt-image-2.5-flare';
export const APIMART_VIDEO_ENDPOINT = 'https://api.apimart.ai/v1/videos/generations';
export const APIMART_VIDEO_MODEL = 'seedance-2.0-mini';
// The event offers one 15-second 720p clip per video credit. These settings are
// server-owned so a modified client cannot request a more expensive variant.
export const apimartVideoProfile = Object.freeze({model:APIMART_VIDEO_MODEL,duration:15,resolution:'720p',generate_audio:true});
export const APIMART_TEXT_MODEL = 'deepseek-v4.1-flash';
export type ApimartImageProfile = 'standard' | 'quality';
export const apimartImageProfiles = Object.freeze({
  standard: Object.freeze({model: APIMART_IMAGE_MODEL, resolution: '2k', quality: 'medium', n: 1}),
  quality: Object.freeze({model: APIMART_IMAGE_MODEL, resolution: '2k', quality: 'high', n: 1}),
});
export const apimartRatios = ['1:1', '3:4', '4:3', '16:9', '9:16'] as const;
export type ApimartRatio = typeof apimartRatios[number];
export class ApimartProtocolError extends Error {}
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function apimartImagePayload(model: string, prompt: string, ratio: string = '3:4', profile: ApimartImageProfile = 'standard') {
  if (!Object.hasOwn(apimartImageProfiles, profile)) throw new ApimartProtocolError('图片服务档位未配置');
  const configured = apimartImageProfiles[profile];
  if (model !== configured.model) throw new ApimartProtocolError('图片模型与当前服务档位不匹配，请联系管理员');
  if (!apimartRatios.includes(ratio as ApimartRatio)) throw new ApimartProtocolError('图片比例不支持');
  return {...configured, prompt, size: ratio, output_format: 'png', moderation: 'auto'};
}
export function apimartVideoPayload(model:string,prompt:string,ratio:string='16:9',duration:number|null=15){
  if(model!==APIMART_VIDEO_MODEL)throw new ApimartProtocolError('视频模型与当前体验档位不匹配，请联系管理员');
  if(prompt.length>4000)throw new ApimartProtocolError('视频创作要求过长，请精简描述后再提交');
  if(duration!==null&&duration!==15)throw new ApimartProtocolError('当前视频体验每次生成 15 秒，请勿更改时长');
  if(!['16:9','9:16','1:1'].includes(ratio))throw new ApimartProtocolError('视频比例不支持');
  return {...apimartVideoProfile,prompt,size:ratio};
}
export function apimartTaskUrl(id: string) {
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(id)) throw new ApimartProtocolError('媒体服务返回的任务标识不正确');
  return `https://api.apimart.ai/v1/tasks/${encodeURIComponent(id)}?language=zh`;
}
export function apimartSubmission(value: unknown): string {
  const envelope = object(value), rows = envelope.data;
  const id = Array.isArray(rows) && rows.length === 1 ? object(rows[0]).task_id : null;
  if (envelope.code !== 200 || typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(id)) throw new ApimartProtocolError('媒体提交结果未确认，请先核对已有任务，勿重复生成');
  return id;
}
export type ApimartImageOutput = {url: string; expiresAt?: string};
export type ApimartTask = {status: 'queued' | 'running' | 'saving' | 'failed'; images: ApimartImageOutput[]; cost?: number};
export function apimartTask(value: unknown, expectedId: string): ApimartTask {
  const envelope = object(value), data = object(envelope.data);
  if (envelope.code !== 200 || data.id !== expectedId) throw new ApimartProtocolError('图片任务查询结果不匹配，请稍后刷新');
  const statuses = {submitted: 'queued', pending: 'queued', processing: 'running', completed: 'saving', failed: 'failed', cancelled: 'failed'} as const;
  if (typeof data.status !== 'string' || !Object.hasOwn(statuses, data.status)) throw new ApimartProtocolError('图片服务返回未知状态，已保留任务，请稍后刷新');
  const status = statuses[data.status as keyof typeof statuses];
  const images: ApimartImageOutput[] = [];
  if (status === 'saving') {
    const rows = object(data.result).images;
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > 4) throw new ApimartProtocolError('图片任务已完成，但结果暂不可读取，请稍后刷新');
    for (const item of rows) {
      const row = object(item);
      if (!Array.isArray(row.url) || row.url.length !== 1 || typeof row.url[0] !== 'string') throw new ApimartProtocolError('图片结果地址格式不兼容，请稍后刷新');
      const expires = typeof row.expires_at === 'number' && Number.isFinite(row.expires_at) && row.expires_at > 0 && row.expires_at < 8.64e12 ? new Date(row.expires_at * 1000).toISOString() : undefined;
      images.push({url: row.url[0], ...(expires ? {expiresAt: expires} : {})});
    }
  }
  return {status, images, ...(typeof data.cost === 'number' && Number.isFinite(data.cost) && data.cost >= 0 ? {cost: data.cost} : {})};
}

export type ApimartVideoTask = {status:ApimartTask['status'];videos:ApimartImageOutput[];cost?:number};
export function apimartVideoTask(value:unknown,expectedId:string):ApimartVideoTask{
  const envelope=object(value),data=object(envelope.data);
  if(envelope.code!==200||data.id!==expectedId)throw new ApimartProtocolError('视频任务查询结果不匹配，请稍后刷新');
  const statuses={submitted:'queued',pending:'queued',processing:'running',completed:'saving',failed:'failed',cancelled:'failed'} as const;
  if(typeof data.status!=='string'||!Object.hasOwn(statuses,data.status))throw new ApimartProtocolError('视频服务返回未知状态，已保留任务，请稍后刷新');
  const status=statuses[data.status as keyof typeof statuses],videos:ApimartImageOutput[]=[];
  if(status==='saving'){
    const rows=object(data.result).videos;
    if(!Array.isArray(rows)||rows.length!==1)throw new ApimartProtocolError('视频已生成，但结果暂不可读取；请刷新原任务');
    const row=object(rows[0]);
    if(!Array.isArray(row.url)||row.url.length!==1||typeof row.url[0]!=='string')throw new ApimartProtocolError('视频结果地址格式不兼容；请刷新原任务');
    const expires=typeof row.expires_at==='number'&&Number.isFinite(row.expires_at)&&row.expires_at>0&&row.expires_at<8.64e12?new Date(row.expires_at*1000).toISOString():undefined;
    videos.push({url:row.url[0],...(expires?{expiresAt:expires}:{})});
  }
  return {status,videos,...(typeof data.cost==='number'&&Number.isFinite(data.cost)&&data.cost>=0?{cost:data.cost}:{})};
}
