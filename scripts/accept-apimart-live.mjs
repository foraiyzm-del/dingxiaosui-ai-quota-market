#!/usr/bin/env node
// Live APIMart acceptance. This script is NOT part of npm test or CI.
// It spends the developer's own APIMart balance: one text, one image, and one
// 5-second silent 480p video. It refuses to run unless the key and a call
// budget are provided explicitly.
//
// Usage:
//   APIMART_API_KEY=... ACCEPTANCE_MAX_CALLS=3 node scripts/accept-apimart-live.mjs
//
// Optional center ledger check (the center must already be configured with the
// same provider; this script never writes the key into the repo or the center):
//   QUOTA_CENTER_URL=http://127.0.0.1:3199 QUOTA_PLATFORM_KEY=... ACCEPTANCE_USER_ID=demo-user
//
// ACCEPTANCE_MAX_CALLS is a hard cap. It must be an integer >= 3. The script
// stops at 3 billable submits and will not start if the cap is lower.
import { imageMime } from '../sidecar/image.mjs';

const key = process.env.APIMART_API_KEY || '';
const cap = Number(process.env.ACCEPTANCE_MAX_CALLS);
const base = (process.env.APIMART_BASE_URL || 'https://api.apimart.ai/v1').replace(/\/$/, '');
if (!key || !Number.isInteger(cap)) {
  console.error('未执行。需要同时设置 APIMART_API_KEY 和 ACCEPTANCE_MAX_CALLS（整数，至少 3）。');
  console.error('示例：APIMART_API_KEY=你的密钥 ACCEPTANCE_MAX_CALLS=3 node scripts/accept-apimart-live.mjs');
  process.exit(2);
}
if (cap < 3) {
  console.error(`ACCEPTANCE_MAX_CALLS=${cap} 低于 1 次文案 + 1 张图片 + 1 个视频，已拒绝执行。`);
  process.exit(2);
}

let calls = 0;
async function billable(path, body) {
  if (calls >= 3 || calls >= cap) throw new Error('已达到本次验收的调用上限，停止以免继续扣费');
  calls += 1;
  const response = await fetch(`${base}/${path}`, {
    method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(120000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path} HTTP ${response.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}
async function task(id) {
  const response = await fetch(`${base}/tasks/${encodeURIComponent(id)}`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`查询任务 ${id} 失败：HTTP ${response.status}`);
  return response.json();
}
function taskId(payload) {
  const id = payload?.data?.[0]?.task_id || payload?.data?.task_id || payload?.id;
  if (typeof id !== 'string' || !id) throw new Error('上游没有返回任务号');
  return id;
}
async function wait(id) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const body = await task(id);
    const status = body?.data?.status || body?.status;
    if (status === 'completed' || status === 'succeeded') return body;
    if (['failed', 'cancelled', 'canceled'].includes(status)) throw new Error(`任务 ${id} 失败：${status}`);
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  throw new Error(`任务 ${id} 在验收时限内没有完成`);
}
function urls(value) {
  if (!value) return [];
  return (Array.isArray(value) ? value : [value]).flatMap(item => Array.isArray(item?.url) ? item.url : [item?.url || item]).filter(item => typeof item === 'string');
}
async function download(url) {
  const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`下载失败 HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
function playableMp4(bytes) {
  if (bytes.length < 16 || bytes.subarray(4, 8).toString() !== 'ftyp') return false;
  let offset = 0;
  let samples = false;
  while (offset + 8 <= bytes.length) {
    const size = bytes.readUInt32BE(offset);
    if (size < 8 || offset + size > bytes.length) break;
    const type = bytes.subarray(offset + 4, offset + 8).toString();
    if (type === 'moov' || type === 'mdat') samples = true;
    offset += size;
  }
  return samples;
}

const report = { calls: 0, text: null, image: null, video: null };
const text = await billable('chat/completions', { model: 'deepseek-v4.1-flash', messages: [{ role: 'user', content: '用一句话介绍一种山西农产品，不要编造功效。' }], max_tokens: 128, stream: false });
const answer = text?.choices?.[0]?.message?.content;
if (typeof answer !== 'string' || !answer.trim()) throw new Error('文案没有返回可用内容');
report.text = { id: text.id || 'chat-completion', preview: answer.slice(0, 80) };

const imageTask = taskId(await billable('images/generations', { model: 'gpt-image-2.5-flare', prompt: '一张简洁的山西小米礼盒照片，不要文字', n: 1, size: '1:1', resolution: '1k', quality: 'low' }));
const imageDone = await wait(imageTask);
const imageUrl = urls(imageDone?.data?.result?.images)[0];
if (!imageUrl) throw new Error(`图片任务 ${imageTask} 没有下载地址`);
const imageBytes = await download(imageUrl);
report.image = { id: imageTask, contentType: imageMime(imageBytes), bytes: imageBytes.length };

const videoTask = taskId(await billable('videos/generations', { model: 'seedance-2.0-mini', prompt: '一碗山西小米粥的静止特写，无人物', duration: 5, resolution: '480p', size: '16:9', generate_audio: false }));
const videoDone = await wait(videoTask);
const videoUrl = urls(videoDone?.data?.result?.videos)[0];
if (!videoUrl) throw new Error(`视频任务 ${videoTask} 没有下载地址`);
const videoBytes = await download(videoUrl);
if (!playableMp4(videoBytes)) throw new Error(`视频任务 ${videoTask} 下载到的文件不是可播放的 MP4`);
report.video = { id: videoTask, bytes: videoBytes.length, playable: true };
report.billing = { submits: calls, textUsage: text.usage || null, imageCost: imageDone?.data?.cost ?? null, videoCost: videoDone?.data?.cost ?? null };
report.calls = calls;

if (process.env.QUOTA_CENTER_URL && process.env.QUOTA_PLATFORM_KEY && process.env.ACCEPTANCE_USER_ID) {
  const center = process.env.QUOTA_CENTER_URL.replace(/\/$/, '').replace(/\/api\/v1$/, '');
  const headers = { authorization: `Bearer ${process.env.QUOTA_PLATFORM_KEY}` };
  const balance = async () => {
    const response = await fetch(`${center}/api/v1/balance?userId=${encodeURIComponent(process.env.ACCEPTANCE_USER_ID)}`, { headers });
    if (!response.ok) throw new Error(`无法读取发卡中心余额：HTTP ${response.status}`);
    return response.json();
  };
  report.centerBalance = await balance();
  report.centerNote = '中心余额已读取。真实扣次以本次中心任务为准；本脚本的三次上游调用使用的是 APIMART_API_KEY，不会代替中心再扣一次。';
}
console.log(JSON.stringify(report, null, 2));
if (calls !== 3) throw new Error(`预期恰好 3 次付费提交，实际 ${calls} 次`);
