import fs from 'node:fs/promises';
import path from 'node:path';
import {lookup} from 'node:dns/promises';
import {request as httpsRequest} from 'node:https';
import {isIP} from 'node:net';
import {randomUUID} from 'node:crypto';

// Official API contracts checked 2026-10-24. No ChatCut calls or credentials.
// https://docs.volcengine.com/docs/ark/create-video-generation-task-api?lang=zh
// https://docs.volcengine.com/docs/ark/get-video-generation-task-api?lang=zh
// https://docs.volcengine.com/docs/DoubaoVoice/HTTPChunkedSSEUnidirectionalStreaming-V3?lang=en
// https://docs.volcengine.com/docs/DoubaoVoice/old-version-console-authentication-reference-example?lang=zh
// https://docs.volcengine.com/docs/DoubaoVoice/Tonelist-1?lang=zh
const VIDEO_ENDPOINT = 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks';
const SPEECH_ENDPOINT = 'https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse';
const DEFAULT_VOICE = 'zh_female_zhixingnv_uranus_bigtts';
const REQUEST_TIMEOUT_MS = 120_000;
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_SPEECH_BYTES = 20 * 1024 * 1024;
const MAX_VIDEO_BYTES = 160 * 1024 * 1024;
const ASSET_DOMAINS = ['volces.com', 'volccdn.com', 'byteimg.com', 'volcengine.com'];
const TASK_ID = /^[A-Za-z0-9_-]{1,160}$/;
// Fixed HTTPS resolver, used only when a local proxy supplies benchmark-range
// Fake-IP answers. No signed media URL, path, query or credentials reach DoH.
// https://developers.cloudflare.com/1.1.1.1/encryption/dns-over-https/make-api-requests/dns-json/
// https://nodejs.org/api/https.html#httpsrequesturl-options-callback
const PUBLIC_DNS_ENDPOINT = 'https://cloudflare-dns.com/dns-query';

function fail(message, {uncertain = false, code = 'PROVIDER_ERROR', status} = {}) {
  const error = new Error(message);
  error.code = code;
  error.uncertain = uncertain;
  if (status !== undefined) error.status = status;
  return error;
}

function checkedString(value, name, max, pattern) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\r\n\u0000]/.test(value) || (pattern && !pattern.test(value))) {
    throw fail(`${name}尚未填写或格式不正确`, {code: 'INVALID_CONFIGURATION'});
  }
  return value.trim();
}

function checkedText(value, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /\u0000/.test(value)) {
    throw fail('创作文本为空或超出长度限制', {code: 'INVALID_TEXT'});
  }
  return value.trim();
}

function httpFailure(service, status, post = false) {
  const detail = status === 401 || status === 403 ? '密钥、模型或音色权限未通过验证'
    : status === 429 ? '额度不足或请求过于频繁'
      : status === 400 || status === 422 ? '请求参数与所选模型不匹配'
        : status === 404 ? '接口、模型或任务不存在'
          : status >= 300 && status < 400 ? '接口返回了不允许的跳转'
            : '上游服务暂时无法完成请求';
  return fail(`${service}：${detail}（HTTP ${status}）`, {
    uncertain: post && status >= 500, code: 'PROVIDER_HTTP_ERROR', status,
  });
}

async function cancelBody(response) {
  try { await response?.body?.cancel(); } catch { /* Already closed or locked. */ }
}

// This bounds headers AND body reads, including a stalled streaming response.
// No upstream body, URL query, request headers, or caught error message is exposed.
async function request(url, init, {fetchImpl, post = false, service, consume}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await (fetchImpl || globalThis.fetch)(url, {...init, redirect: 'manual', signal: controller.signal});
    if (!response.ok || response.redirected) {
      await cancelBody(response);
      throw httpFailure(service, response.redirected ? 302 : response.status, post);
    }
    return await consume(response);
  } catch (error) {
    if (error?.code && ['PROVIDER_HTTP_ERROR', 'PROVIDER_INVALID_RESPONSE', 'PROVIDER_TOO_LARGE', 'PROVIDER_STREAM_ERROR', 'INVALID_MEDIA', 'UNSAFE_ASSET_URL'].includes(error.code)) {
      // A successful POST may have spent credits even if its result was unreadable.
      if (post && error.code !== 'PROVIDER_HTTP_ERROR') error.uncertain = true;
      throw error;
    }
    throw fail(`${service}连接中断或等待超时${post ? '，结果和费用待核对，请勿自动重复提交' : '，请稍后再查询'}`, {
      uncertain: post, code: 'PROVIDER_NETWORK_ERROR',
    });
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

async function boundedBytes(response, maximum) {
  const reported = Number(response.headers.get('content-length') || 0);
  if (reported > maximum) {
    await cancelBody(response);
    throw fail('上游返回的文件超过保存上限', {code: 'PROVIDER_TOO_LARGE'});
  }
  const reader = response.body?.getReader();
  if (!reader) throw fail('上游响应没有内容', {code: 'PROVIDER_INVALID_RESPONSE'});
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) throw fail('上游返回的文件超过保存上限', {code: 'PROVIDER_TOO_LARGE'});
      chunks.push(Buffer.from(value));
    }
  } finally {
    try { await reader.cancel(); } catch { /* Network may already be closed. */ }
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}

async function responseObject(response) {
  const bytes = await boundedBytes(response, MAX_JSON_BYTES);
  try {
    const value = JSON.parse(bytes.toString('utf8'));
    if (!value || Array.isArray(value) || typeof value !== 'object') throw Error();
    return value;
  } catch {
    throw fail('上游返回格式不正确，请核对服务商任务记录', {code: 'PROVIDER_INVALID_RESPONSE'});
  }
}

export async function submitVideo({apiKey, model, prompt, fetchImpl} = {}) {
  const key = checkedString(apiKey, '视频 API Key', 4096);
  const modelId = checkedString(model, '视频模型 ID', 160, /^[A-Za-z0-9._:-]+$/);
  const text = checkedText(prompt, 4000);
  const payload = {
    model: modelId, content: [{type: 'text', text}], duration: 10,
    ratio: '9:16', resolution: '720p', watermark: true,
  };
  // 1.0 is silent-only and does not accept generate_audio. 2.x supports false.
  // An ep-* deployment must point to an audio-capable Seedance 2.x model.
  if (!/^doubao-seedance-1-0(?:-|$)/i.test(modelId)) payload.generate_audio = false;
  const result = await request(VIDEO_ENDPOINT, {
    method: 'POST', headers: {authorization: `Bearer ${key}`, 'content-type': 'application/json'},
    body: JSON.stringify(payload),
  }, {fetchImpl, post: true, service: '视频生成', consume: responseObject});
  if (typeof result.id !== 'string' || !TASK_ID.test(result.id)) {
    throw fail('视频提交未返回有效任务 ID，结果和费用待核对，请勿自动重复提交', {
      uncertain: true, code: 'PROVIDER_INVALID_RESPONSE',
    });
  }
  return {id: result.id};
}

export async function pollVideo({apiKey, id, fetchImpl} = {}) {
  const key = checkedString(apiKey, '视频 API Key', 4096);
  const taskId = checkedString(id, '视频任务 ID', 160, TASK_ID);
  const result = await request(`${VIDEO_ENDPOINT}/${encodeURIComponent(taskId)}`, {
    method: 'GET', headers: {authorization: `Bearer ${key}`, 'content-type': 'application/json'},
  }, {fetchImpl, service: '视频状态查询', consume: responseObject});
  if (!['queued', 'running', 'succeeded', 'failed', 'cancelled', 'expired'].includes(result.status)) {
    throw fail('视频服务返回未知状态，请稍后查询或核对服务商任务记录', {code: 'PROVIDER_INVALID_RESPONSE'});
  }
  if (result.status === 'succeeded') {
    return {status: result.status, url: checkedAssetUrl(result.content?.video_url).href};
  }
  if (['failed', 'cancelled', 'expired'].includes(result.status)) {
    const detail = result.status === 'cancelled' ? '视频任务已取消'
      : result.status === 'expired' ? '视频任务已过期'
        : '视频生成失败，请检查模型权限、内容审核和额度';
    return {status: result.status, error: detail};
  }
  return {status: result.status};
}

function checkedAssetUrl(value) {
  if (typeof value !== 'string' || value.length > 16_384 || /[\u0000-\u0020\u007f]/.test(value)) {
    throw fail('视频下载地址格式不正确', {code: 'UNSAFE_ASSET_URL'});
  }
  let url;
  try { url = new URL(value); } catch { throw fail('视频下载地址格式不正确', {code: 'UNSAFE_ASSET_URL'}); }
  const authority = value.match(/^https:\/\/([^/?#]+)/i)?.[1] || '';
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.port || authority.includes(':') || url.hash
    || isIP(host) || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]+$/.test(host)
    || !ASSET_DOMAINS.some(domain => host === domain || host.endsWith(`.${domain}`))) {
    throw fail('视频下载地址不在已允许的官方媒体域名中', {code: 'UNSAFE_ASSET_URL'});
  }
  return url;
}

function publicAddress(address) {
  if (typeof address !== 'string') return false;
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99)))
      || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
      || (a === 203 && b === 0 && c === 113));
  }
  const lower = address.toLowerCase();
  // Only globally routed IPv6 unicast; excludes loopback, mapped IPv4 and ULA.
  return isIP(address) === 6 && /^[23][0-9a-f]{3}:/.test(lower) && !lower.startsWith('2001:db8:');
}

function proxyFakeAddress(address) {
  return isIP(address) === 4 && /^198\.(18|19)\./.test(address);
}

async function resolveThroughPublicHttps(host) {
  const url = new URL(PUBLIC_DNS_ENDPOINT);
  url.searchParams.set('name', host);
  url.searchParams.set('type', 'A');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  let response;
  try {
    response = await globalThis.fetch(url.href, {
      method: 'GET', headers: {accept: 'application/dns-json'},
      redirect: 'manual', signal: controller.signal,
    });
    if (!response.ok || response.redirected) throw Error();
    const value = JSON.parse((await boundedBytes(response, 64 * 1024)).toString('utf8'));
    const dnsName = name => typeof name === 'string' ? name.toLowerCase().replace(/\.$/, '') : '';
    if (value.Status !== 0 || value.TC === true || !Array.isArray(value.Question)
      || value.Question.length !== 1 || dnsName(value.Question[0].name) !== host
      || value.Question[0].type !== 1 || !Array.isArray(value.Answer)
      || !value.Answer.length || value.Answer.length > 64) throw Error();
    // A response may contain a CNAME chain. Accept A records only for names
    // linked to this question, never unrelated records or non-public addresses.
    const names = new Set([host]);
    for (let depth = 0; depth < 16; depth++) {
      const before = names.size;
      for (const answer of value.Answer) {
        if (answer.type === 5 && names.has(dnsName(answer.name))) {
          const target = dnsName(answer.data);
          if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]+$/.test(target)) throw Error();
          names.add(target);
        }
      }
      if (names.size === before) break;
    }
    const answers = value.Answer.filter(answer => answer.type === 1);
    if (!answers.length || answers.some(answer => !names.has(dnsName(answer.name))
      || isIP(answer.data) !== 4 || !publicAddress(answer.data))) throw Error();
    return {address: answers[0].data, family: 4};
  } catch {
    throw fail('本机代理返回虚拟地址，公开 DNS 验证未通过，请检查网络后重试下载', {code: 'UNSAFE_ASSET_URL'});
  } finally {
    clearTimeout(timer);
    controller.abort();
    await cancelBody(response);
  }
}

async function resolvePublicAddress(host) {
  let answers;
  try {
    let timer;
    try {
      answers = await Promise.race([
        lookup(host, {all: true, verbatim: true}),
        new Promise((_, reject) => { timer = setTimeout(() => reject(Error()), 10_000); }),
      ]);
    } finally { clearTimeout(timer); }
  } catch { throw fail('视频文件域名暂时无法解析', {code: 'UNSAFE_ASSET_URL'}); }
  if (!Array.isArray(answers) || !answers.length
    || answers.some(answer => !publicAddress(answer.address) && !proxyFakeAddress(answer.address))) {
    throw fail('视频下载地址解析到非公开网络，已阻止下载', {code: 'UNSAFE_ASSET_URL'});
  }
  if (answers.some(answer => proxyFakeAddress(answer.address))) return resolveThroughPublicHttps(host);
  // Prefer IPv4 for CDN reachability, while still supporting public IPv6.
  const selected = answers.find(answer => isIP(answer.address) === 4) || answers[0];
  return {address: selected.address, family: isIP(selected.address)};
}

function downloadFromPinnedAddress(url, pinned) {
  return new Promise((resolve, reject) => {
    let request, response, settled = false;
    const chunks = [];
    let size = 0;
    const finish = (error, bytes) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        response?.destroy();
        request?.destroy();
        reject(error);
      } else resolve(bytes);
    };
    const networkFailure = () => finish(fail('视频文件下载连接中断或等待超时，请稍后重试下载', {code: 'PROVIDER_NETWORK_ERROR'}));
    const timer = setTimeout(networkFailure, REQUEST_TIMEOUT_MS);
    try {
      request = httpsRequest(url, {
        method: 'GET', agent: false, family: pinned.family, autoSelectFamily: false,
        servername: url.hostname, rejectUnauthorized: true,
        headers: {accept: 'video/mp4'},
        // Pin the actual socket, not merely a preflight DNS check. The original
        // hostname remains the HTTP Host and TLS certificate/SNI identity.
        lookup(host, options, callback) {
          if (typeof options === 'function') { callback = options; options = {}; }
          if (host !== url.hostname) return callback(fail('下载连接域名不匹配', {code: 'UNSAFE_ASSET_URL'}));
          if (options?.all) callback(null, [pinned]);
          else callback(null, pinned.address, pinned.family);
        },
      }, incoming => {
        response = incoming;
        if (settled) { incoming.destroy(); return; }
        if (incoming.statusCode !== 200) {
          finish(httpFailure('视频文件下载', incoming.statusCode || 502));
          return;
        }
        const lengthHeader = incoming.headers['content-length'];
        const expectedSize = lengthHeader === undefined ? undefined : Number(lengthHeader);
        if (expectedSize !== undefined && (!Number.isSafeInteger(expectedSize) || expectedSize < 0)) {
          finish(fail('视频下载返回无效文件长度', {code: 'PROVIDER_INVALID_RESPONSE'}));
          return;
        }
        if (expectedSize > MAX_VIDEO_BYTES) {
          finish(fail('上游返回的文件超过保存上限', {code: 'PROVIDER_TOO_LARGE'}));
          return;
        }
        incoming.on('data', chunk => {
          if (settled) return;
          size += chunk.length;
          if (size > MAX_VIDEO_BYTES) {
            finish(fail('上游返回的文件超过保存上限', {code: 'PROVIDER_TOO_LARGE'}));
            return;
          }
          chunks.push(Buffer.from(chunk));
        });
        incoming.on('end', () => {
          if (!incoming.complete || (expectedSize !== undefined && expectedSize !== size)) { networkFailure(); return; }
          finish(null, Buffer.concat(chunks, size));
        });
        incoming.on('error', networkFailure);
        incoming.on('aborted', networkFailure);
        incoming.on('close', () => { if (!incoming.complete) networkFailure(); });
      });
      request.on('error', networkFailure);
      request.end();
    } catch { networkFailure(); }
  });
}

async function saveExclusive(destination, bytes) {
  if (typeof destination !== 'string' || !path.isAbsolute(destination) || destination.includes('\0')) {
    throw fail('媒体保存位置不正确', {code: 'INVALID_DESTINATION'});
  }
  await fs.mkdir(path.dirname(destination), {recursive: true, mode: 0o700});
  let handle;
  try {
    handle = await fs.open(destination, 'wx', 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
  } catch (error) {
    // Only remove the incomplete file created exclusively by THIS call.
    if (handle) {
      try { await handle.close(); } catch { /* Preserve original save error. */ }
      handle = null;
      try { await fs.unlink(destination); } catch { /* No directory cleanup. */ }
    }
    throw fail(error?.code === 'EEXIST' ? '目标媒体文件已存在，未覆盖已有作品' : '媒体文件保存失败，请检查磁盘空间和写入权限', {code: 'MEDIA_SAVE_FAILED'});
  } finally { if (handle) await handle.close(); }
  return destination;
}

export async function downloadVideo({url, destination, fetchImpl} = {}) {
  const safe = checkedAssetUrl(url);
  // Explicit test adapters never perform DNS/network I/O. Production sockets
  // always use a verified public address; HTTPS redirects are never followed.
  const bytes = fetchImpl && fetchImpl !== globalThis.fetch
    ? await request(safe.href, {method: 'GET'}, {
      fetchImpl, service: '视频文件下载', consume: response => boundedBytes(response, MAX_VIDEO_BYTES),
    })
    : await downloadFromPinnedAddress(safe, await resolvePublicAddress(safe.hostname));
  if (bytes.length < 12 || bytes.toString('ascii', 4, 8) !== 'ftyp') {
    throw fail('视频服务没有返回有效 MP4 文件', {code: 'INVALID_MEDIA'});
  }
  return {path: await saveExclusive(destination, bytes)};
}

function speechFailure(code) {
  const message = code === 45000000 || code === 45000001 ? '语音合成参数、音色权限或额度未通过验证'
    : code === 40402003 ? '配音文本超出服务限制'
      : '语音合成未成功结束，请核对语音服务状态和额度';
  return fail(message, {code: 'PROVIDER_STREAM_ERROR', uncertain: true});
}

function sentenceSubtitle(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.words)) return null;
  const words = value.words.filter(word => word && typeof word.word === 'string'
    && Number.isFinite(word.startTime) && Number.isFinite(word.endTime)
    && word.startTime >= 0 && word.endTime > word.startTime && word.endTime <= 3600);
  if (!words.length) return null;
  const text = typeof value.text === 'string' && value.text.trim() ? value.text.trim() : words.map(word => word.word).join('');
  if (!text || text.length > 10_000) return null;
  return {text, start: Math.min(...words.map(word => word.startTime)), end: Math.max(...words.map(word => word.endTime))};
}

async function readSpeechSse(response) {
  const reader = response.body?.getReader();
  if (!reader) throw fail('配音服务没有返回音频', {code: 'PROVIDER_INVALID_RESPONSE'});
  const decoder = new TextDecoder('utf-8', {fatal: true});
  const audio = [], subtitles = [], seen = new Set();
  let buffer = '', dataLines = [], received = 0, audioSize = 0, completed = false;

  function dispatch() {
    if (!dataLines.length) return;
    const source = dataLines.join('\n');
    dataLines = [];
    let value;
    try { value = JSON.parse(source); } catch { throw fail('配音服务流式响应格式不正确', {code: 'PROVIDER_INVALID_RESPONSE'}); }
    if (!value || typeof value !== 'object' || !Number.isInteger(value.code)) throw fail('配音服务缺少有效状态码', {code: 'PROVIDER_INVALID_RESPONSE'});
    if (value.code === 20000000) { completed = true; return; }
    if (value.code !== 0) throw speechFailure(value.code);
    if (typeof value.data === 'string' && value.data.length) {
      if (value.data.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value.data)) throw fail('配音服务返回无效音频编码', {code: 'PROVIDER_INVALID_RESPONSE'});
      const bytes = Buffer.from(value.data, 'base64');
      audioSize += bytes.length;
      if (audioSize > MAX_SPEECH_BYTES) throw fail('配音文件超过保存上限', {code: 'PROVIDER_TOO_LARGE'});
      audio.push(bytes);
    }
    const subtitle = sentenceSubtitle(value.sentence);
    if (subtitle) {
      const key = JSON.stringify(subtitle);
      if (!seen.has(key)) { seen.add(key); subtitles.push(subtitle); }
    }
  }

  function line(value) {
    const clean = value.endsWith('\r') ? value.slice(0, -1) : value;
    if (!clean) { dispatch(); return; }
    if (clean.startsWith('data:')) dataLines.push(clean.slice(5).replace(/^ /, ''));
  }

  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) {
        buffer += decoder.decode();
        if (buffer) line(buffer);
        dispatch();
        break;
      }
      received += value.byteLength;
      if (received > MAX_SPEECH_BYTES) throw fail('配音响应超过保存上限', {code: 'PROVIDER_TOO_LARGE'});
      buffer += decoder.decode(value, {stream: true});
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) { line(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1); }
      if (completed) break;
    }
  } finally {
    try { await reader.cancel(); } catch { /* Stream may already be closed. */ }
    reader.releaseLock();
  }
  if (!completed) throw fail('配音连接在完成标记前中断，结果和费用待核对，请勿自动重复提交', {code: 'PROVIDER_STREAM_ERROR', uncertain: true});
  const bytes = Buffer.concat(audio, audioSize);
  if (bytes.length < 8 || !(bytes.toString('ascii', 0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0))) {
    throw fail('配音服务未返回有效 MP3 音频', {code: 'INVALID_MEDIA', uncertain: true});
  }
  subtitles.sort((a, b) => a.start - b.start || a.end - b.end);
  return {bytes, subtitles};
}

export async function synthesizeSpeech({apiKey, appId, accessToken, resourceId = 'seed-tts-2.0', voice = DEFAULT_VOICE, text, destination, requestId = randomUUID(), fetchImpl} = {}) {
  // The new console uses one API key; the legacy console uses App ID + token.
  // Preserve existing API-key callers. Never mix the two authentication modes.
  // A legacy-mode caller must omit apiKey or pass an empty string.
  const hasApiKey = apiKey !== undefined && apiKey !== null && apiKey !== '';
  const authenticationHeaders = hasApiKey
    ? {'X-Api-Key': checkedString(apiKey, '语音 API Key', 4096)}
    : {
      'X-Api-App-Id': checkedString(appId, '语音 App ID', 128, /^[A-Za-z0-9_-]+$/),
      'X-Api-Access-Key': checkedString(accessToken, '语音 Access Token', 4096),
    };
  if (resourceId !== 'seed-tts-2.0') throw fail('本成片功能需要豆包语音合成 2.0 资源', {code: 'INVALID_CONFIGURATION'});
  const speaker = checkedString(voice, '配音音色 ID', 160, /^[A-Za-z0-9_-]+$/);
  const id = checkedString(requestId, '配音请求 ID', 160, /^[A-Za-z0-9_-]+$/);
  const script = checkedText(text, 10_000);
  const body = {
    user: {uid: 'zidingxiang-film-studio'},
    req_params: {
      text: script, speaker,
      audio_params: {format: 'mp3', sample_rate: 24000, speech_rate: 0, enable_subtitle: true},
      additions: JSON.stringify({explicit_language: 'zh-cn', context_texts: ['温和、清楚，像自然介绍地方美食与手艺，语速适中，不夸张。']}),
    },
  };
  let logId;
  const result = await request(SPEECH_ENDPOINT, {
    method: 'POST', headers: {'content-type': 'application/json', accept: 'text/event-stream', ...authenticationHeaders, 'X-Api-Resource-Id': resourceId, 'X-Api-Request-Id': id},
    body: JSON.stringify(body),
  }, {
    fetchImpl, post: true, service: '语音合成',
    consume: async response => {
      const candidate = response.headers.get('x-tt-logid');
      if (candidate && /^[A-Za-z0-9_-]{1,128}$/.test(candidate)) logId = candidate;
      return readSpeechSse(response);
    },
  });
  try {
    return {path: await saveExclusive(destination, result.bytes), subtitles: result.subtitles, ...(logId ? {logId} : {})};
  } catch (error) {
    // The provider already completed a paid synthesis. A disk failure must never
    // turn into an automatic second TTS request on resume.
    error.uncertain = true;
    throw error;
  }
}
