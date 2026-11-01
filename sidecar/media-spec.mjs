const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };

/** Sold video shape. 5s/480p/silent is the new card; 15s/720p can still be sold separately. */
export function mediaSpec(value) {
  if (value === undefined || value === null || value === '') return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, '商品媒体规格格式无效');
  if (value.video === undefined || value.video === null) {
    if (Object.keys(value).length) fail(400, '商品媒体规格格式无效');
    return null;
  }
  const video = value.video;
  if (!video || typeof video !== 'object' || Array.isArray(video)) fail(400, '视频规格格式无效');
  if (video.seconds !== 5 && video.seconds !== 15) fail(400, '视频售卖时长只允许 5 秒或 15 秒');
  if (video.resolution !== '480p' && video.resolution !== '720p') fail(400, '视频分辨率只允许 480p 或 720p');
  if (typeof video.audio !== 'boolean') fail(400, '请明确视频是否包含音频');
  return { video: { seconds: video.seconds, resolution: video.resolution, audio: video.audio } };
}

export const NEW_CARD_VIDEO_SPEC = Object.freeze({ video: Object.freeze({ seconds: 5, resolution: '480p', audio: false }) });
