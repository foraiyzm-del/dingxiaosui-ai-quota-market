import { createHash, randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { apimartPayload, normalizeApimartResponse } from './apimart.mjs';
import { publicAddress, resolveUpstreamAddresses } from './upstream-dns.mjs';
import { generationOptions, referenceImage, textPayload } from './generation-options.mjs';
import { imageMime } from './image.mjs';

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const now = () => new Date().toISOString();
const MAX_JSON_BYTES = 24 * 1024 * 1024;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
function validText(value, field, max) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) fail(400, `${field}格式无效`);
  return value.trim();
}

/** DNS is checked and pinned to the HTTP connection, and redirects are never followed. */
async function networkRequest(address, init, { allowPrivateUpstreams = false, maxBytes = MAX_JSON_BYTES } = {}) {
  const url = new URL(address);
  const hostname = url.hostname.replace(/^\[|\]$/gu, '');
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw Object.assign(new Error('无效上游地址'), { safeRejection: true });
  const addresses = await resolveUpstreamAddresses(hostname, { signal: init.signal, allowPrivateUpstreams });
  if (init.signal?.aborted) throw Object.assign(new Error('上游请求超时'), { safeRejection: true });
  return new Promise((resolve, reject) => {
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const request = send(url, { method: init.method ?? 'GET', headers: init.headers, signal: init.signal,
      ...(url.protocol === 'https:' ? { servername: isIP(hostname) ? undefined : hostname, rejectUnauthorized: true } : {}),
      lookup: (_name, options, callback) => options.all ? callback(null, addresses) : callback(null, addresses[0].address, addresses[0].family) }, response => {
      const declared = Number(response.headers['content-length']);
      if (declared > maxBytes) { response.destroy(); reject(new Error('上游响应超过大小限制')); return; }
      const chunks = [];
      let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > maxBytes) { response.destroy(); reject(new Error('上游响应超过大小限制')); }
        else chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => {
        const body = Buffer.concat(chunks);
        const status = response.statusCode || 502;
        resolve(new Response([204, 205, 304].includes(status) ? null : body, { status, headers: { 'content-type': response.headers['content-type'] || 'application/octet-stream' } }));
      });
    });
    request.on('error', reject);
    if (init.body) request.write(init.body);
    request.end();
  });
}

function endpoint(config, capability, upstreamId) {
  const path = config.endpoints[capability].replace('{id}', encodeURIComponent(upstreamId || ''));
  return `${config.baseUrl}/${path}`;
}
function safeAssetUrl(value, secret) {
  if (typeof value !== 'string' || value.length > 8000) return null;
  if (secret && (value.includes(secret) || value.includes(encodeURIComponent(secret)))) return null;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    const hostname = url.hostname.replace(/^\[|\]$/gu, '');
    if (hostname === 'localhost' || hostname.endsWith('.localhost') || (isIP(hostname) && !publicAddress(hostname))) return null;
    return url.toString();
  } catch { return null; }
}
function usage(data) {
  const raw = data?.usage;
  if (!raw || typeof raw !== 'object') return null;
  const integer = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
  const inputTokens = integer(raw.prompt_tokens ?? raw.input_tokens);
  const outputTokens = integer(raw.completion_tokens ?? raw.output_tokens);
  return { inputTokens, outputTokens, totalTokens: integer(raw.total_tokens) || inputTokens + outputTokens };
}
function estimate(pricing, tokenUsage) {
  if (!pricing || !Object.keys(pricing).length) return null;
  if (!tokenUsage && pricing.perRequestCents === undefined) return null;
  const value = (pricing.perRequestCents || 0) + (tokenUsage?.inputTokens || 0) * (pricing.inputPerMillionCents || 0) / 1000000
    + (tokenUsage?.outputTokens || 0) * (pricing.outputPerMillionCents || 0) / 1000000;
  return Math.round(value * 1000000) / 1000000;
}

export function createGeneration(db, { quota, channels, platforms, fetchImpl, allowPrivateUpstreams = false } = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS generation_jobs (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES quota_projects(id), user_id TEXT NOT NULL,
    request_id TEXT NOT NULL, request_hash TEXT NOT NULL, capability TEXT NOT NULL,
    channel_id TEXT NOT NULL, model TEXT NOT NULL, units INTEGER NOT NULL,
    usage_id TEXT, status TEXT NOT NULL, upstream_id TEXT, output_json TEXT, error TEXT,
    token_usage_json TEXT, pricing_json TEXT, estimated_cost_cents REAL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, resolved_note TEXT,
    UNIQUE(project_id,user_id,request_id)
  ); CREATE INDEX IF NOT EXISTS generation_jobs_project ON generation_jobs(project_id,created_at);`);
  if (!db.prepare('PRAGMA table_info(generation_jobs)').all().some(column => column.name === 'response_format')) {
    db.exec('ALTER TABLE generation_jobs ADD COLUMN response_format TEXT');
  }
  const pending = new Set();
  const polling = new Map();
  const fetcher = (url, init, maxBytes) => fetchImpl ? fetchImpl(url, init) : networkRequest(url, init, { allowPrivateUpstreams, maxBytes });
  const rowById = id => db.prepare('SELECT * FROM generation_jobs WHERE id=?').get(id);
  const parse = value => value ? JSON.parse(value) : null;
  function transaction(work) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = work(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }

  function record(row, { admin = false } = {}) {
    return { id: row.id, projectId: row.project_id, userId: row.user_id, requestId: row.request_id,
      capability: row.capability, status: row.status, units: row.units,
      output: parse(row.output_json), error: row.error, tokenUsage: parse(row.token_usage_json),
      estimatedCostCents: row.estimated_cost_cents, costIsEstimate: row.estimated_cost_cents !== null,
      createdAt: row.created_at, updatedAt: row.updated_at,
      ...(admin ? { channelId: row.channel_id, model: row.model, usageId: row.usage_id, resolvedNote: row.resolved_note } : {}) };
  }

  function reconcile(row) {
    if (!row.usage_id) {
      const reserved = db.prepare('SELECT id,status FROM quota_usage WHERE project_id=? AND user_id=? AND request_id=?')
        .get(row.project_id, row.user_id, `generation:${row.id}`);
      if (reserved) {
        db.prepare('UPDATE generation_jobs SET usage_id=? WHERE id=?').run(reserved.id, row.id);
        row = rowById(row.id);
      }
    }
    if (row.usage_id && ['succeeded', 'failed'].includes(row.status)) {
      quota.settle({ projectId: row.project_id, usageId: row.usage_id, action: row.status === 'succeeded' ? 'commit' : 'cancel' });
    }
    if (row.usage_id && !['succeeded', 'failed'].includes(row.status)) {
      const entry = db.prepare('SELECT status FROM quota_usage WHERE id=?').get(row.usage_id);
      if (entry && entry.status !== 'reserved') {
        db.prepare('UPDATE generation_jobs SET status=?,updated_at=? WHERE id=?').run(entry.status === 'committed' ? 'succeeded' : 'failed', now(), row.id);
        row = rowById(row.id);
      }
    }
    return row;
  }

  // Recover interrupted work without repeating a possibly billable POST.
  for (let row of db.prepare('SELECT * FROM generation_jobs').all()) {
    row = reconcile(row);
    if (row.status === 'queued' || (row.status === 'running' && !row.upstream_id)) {
      db.prepare('UPDATE generation_jobs SET status=?,error=?,updated_at=? WHERE id=?')
        .run(row.usage_id ? 'uncertain' : 'failed', row.usage_id ? '服务重启前的调用结果未知，请管理员核对后处理' : '请求在开始调用前中断，可重新提交新的请求', now(), row.id);
    }
  }

  function finish(id, status, { output = null, error = null, tokenUsage = null, note = null } = {}) {
    const row = rowById(id);
    if (row.usage_id) {
      const ledger = db.prepare('SELECT status FROM quota_usage WHERE id=?').get(row.usage_id);
      const expected = status === 'succeeded' ? 'committed' : 'cancelled';
      if (ledger && ledger.status !== 'reserved' && ledger.status !== expected) fail(409, '该任务的次数已按另一结果结算，不能更改');
    }
    const estimatedCostCents = status === 'succeeded' ? estimate(parse(row.pricing_json), tokenUsage) : null;
    // The result and its ledger settlement are a single commit; quota uses a nested savepoint.
    return transaction(() => {
      db.prepare(`UPDATE generation_jobs SET status=?,output_json=?,error=?,token_usage_json=?,estimated_cost_cents=?,updated_at=?,resolved_note=? WHERE id=?`)
        .run(status, output ? JSON.stringify(output) : null, error, tokenUsage ? JSON.stringify(tokenUsage) : null, estimatedCostCents, now(), note, id);
      return record(reconcile(rowById(id)));
    });
  }
  function uncertain(id, message) {
    db.prepare("UPDATE generation_jobs SET status='uncertain',error=?,updated_at=? WHERE id=?").run(message, now(), id);
    return record(rowById(id));
  }
  async function readJson(response) {
    const declared = Number(response.headers?.get('content-length'));
    if (declared > MAX_JSON_BYTES) throw new Error('响应超过限制');
    if (response.body?.getReader) {
      const reader = response.body.getReader();
      const chunks = [];
      let total = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          total += value.length;
          if (total > MAX_JSON_BYTES) { await reader.cancel(); throw new Error('响应超过限制'); }
          chunks.push(Buffer.from(value));
        }
      } finally { reader.releaseLock(); }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }
    const raw = await response.text();
    if (Buffer.byteLength(raw) > MAX_JSON_BYTES) throw new Error('响应超过限制');
    return JSON.parse(raw);
  }
  function consume(id, data, apiKey, protocol = 'openai-compatible') {
    const row = rowById(id);
    if (protocol === 'apimart') data = normalizeApimartResponse(row.capability, data);
    const tokenUsage = usage(data);
    if (row.capability === 'text') {
      const content = data?.choices?.[0]?.message?.content;
      const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map(part => part.type === 'text' ? part.text : '').join('') : '';
      if (!text) return uncertain(id, '上游未返回可识别的文字结果，请核对接口协议');
      if (row.response_format === 'json_object') {
        try {
          const value = JSON.parse(text);
          if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.keys(value).length) throw new Error('invalid object');
        } catch { return finish(id, 'failed', { error: '上游未返回有效的 JSON 对象，预留次数已退回' }); }
      }
      return finish(id, 'succeeded', { output: { text }, tokenUsage });
    }
    const upstreamId = typeof data?.id === 'string' && /^[A-Za-z0-9._:-]{1,200}$/u.test(data.id) ? data.id : row.upstream_id;
    if (upstreamId) db.prepare('UPDATE generation_jobs SET upstream_id=? WHERE id=?').run(upstreamId, id);
    if (['failed', 'cancelled', 'canceled'].includes(data?.status)) return finish(id, 'failed', { error: '上游生成任务失败，预留次数已退回' });
    if (row.capability === 'image') {
      const images = (Array.isArray(data?.data) ? data.data : []).slice(0, 1).map(item => {
        const url = safeAssetUrl(item.url, apiKey);
        if (typeof item.b64_json === 'string' && /^[A-Za-z0-9+/]+={0,2}$/u.test(item.b64_json) && item.b64_json.length < MAX_JSON_BYTES) {
          const prefix = Buffer.from(item.b64_json.slice(0, 24), 'base64');
          const mimeType = prefix.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png'
            : prefix[0] === 255 && prefix[1] === 216 ? 'image/jpeg'
              : prefix.subarray(0, 4).toString() === 'RIFF' && prefix.subarray(8, 12).toString() === 'WEBP' ? 'image/webp' : null;
          if (mimeType) return { dataUrl: `data:${mimeType};base64,${item.b64_json}` };
        }
        return url ? { url } : null;
      }).filter(Boolean);
      if (!images.length && protocol === 'apimart' && upstreamId && ['queued', 'in_progress', 'processing', 'running', 'pending'].includes(data?.status)) {
        db.prepare("UPDATE generation_jobs SET status='running',error=NULL,updated_at=? WHERE id=?").run(now(), id);
        return record(rowById(id));
      }
      if (!images.length) return uncertain(id, '上游未返回可识别的图片结果，请核对接口协议');
      return finish(id, 'succeeded', { output: { images }, tokenUsage });
    }
    const videoUrl = safeAssetUrl(data?.url || data?.video_url || data?.output?.url, apiKey);
    if (['completed', 'succeeded'].includes(data?.status) || videoUrl) {
      if (!videoUrl && (!upstreamId || protocol === 'apimart')) return uncertain(id, '上游视频结果缺少下载信息，请管理员核对');
      return finish(id, 'succeeded', { output: { ...(videoUrl ? { videoUrl } : {}), contentAvailable: Boolean(upstreamId) }, tokenUsage });
    }
    if (upstreamId && ['queued', 'in_progress', 'processing', 'running', 'pending'].includes(data?.status)) {
      db.prepare("UPDATE generation_jobs SET status='running',error=NULL,updated_at=? WHERE id=?").run(now(), id);
      return record(rowById(id));
    }
    return uncertain(id, '上游视频任务状态无法识别，请管理员核对');
  }

  function inputFields(input) {
    const projectId = validText(input.projectId, '平台标识', 64);
    const userId = validText(input.userId, '用户标识', 200);
    const requestId = validText(input.requestId, '请求标识', 160);
    const capability = input.capability;
    if (!['text', 'image', 'video'].includes(capability)) fail(400, '请选择文字、图片或视频能力');
    const prompt = validText(input.prompt, '提示词', 20000);
    const fields = { projectId, userId, requestId, capability, prompt };
    if (input.size !== undefined && input.size !== '') {
      if (typeof input.size !== 'string' || !/^(auto|[1-9][0-9]{1,4}x[1-9][0-9]{1,4})$/u.test(input.size)) fail(400, '尺寸格式应为宽x高');
      fields.size = input.size;
    }
    if (input.seconds !== undefined && input.seconds !== '') {
      const seconds = Number(input.seconds);
      if (!Number.isInteger(seconds) || seconds < 1 || seconds > 120) fail(400, '视频时长必须为 1 至 120 秒');
      fields.seconds = String(seconds);
    }
    return { ...fields, ...generationOptions(input, capability) };
  }

  const api = {
    async execute(input = {}) {
      const fields = inputFields(input);
      const fingerprint = createHash('sha256').update(JSON.stringify(fields)).digest('hex');
      const previous = db.prepare('SELECT * FROM generation_jobs WHERE project_id=? AND user_id=? AND request_id=?').get(fields.projectId, fields.userId, fields.requestId);
      if (previous) {
        if (previous.request_hash !== fingerprint) fail(409, '同一请求标识不能用于不同内容，请使用新的请求标识');
        return record(reconcile(previous));
      }
      const platform = platforms.getPlatform(fields.projectId);
      if (!platform.enabled) fail(409, '该平台已停用');
      const binding = platform.bindings.find(item => item.capability === fields.capability);
      if (!binding) fail(409, '该平台尚未配置此能力的 API 渠道');
      const config = channels.getForExecution(binding);
      if (fields.referenceImage && config.protocol !== 'apimart') fail(400, '该渠道尚未配置参考图上传协议，请使用支持图生图的 APIMart 渠道');
      const id = randomUUID();
      const timestamp = now();
      transaction(() => {
        db.prepare(`INSERT INTO generation_jobs(id,project_id,user_id,request_id,request_hash,capability,channel_id,model,units,status,pricing_json,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,'queued',?,?,?)`).run(id, fields.projectId, fields.userId, fields.requestId, fingerprint, fields.capability,
          binding.channelId, binding.model, platform.unitsPerUse, config.model.pricing ? JSON.stringify(config.model.pricing) : null, timestamp, timestamp);
        const reservation = quota.reserve({ projectId: fields.projectId, userId: fields.userId, requestId: `generation:${id}`, units: platform.unitsPerUse, capability: fields.capability });
        db.prepare("UPDATE generation_jobs SET usage_id=?,status='running',updated_at=? WHERE id=?").run(reservation.usage.id, now(), id);
        if (fields.responseFormat) db.prepare('UPDATE generation_jobs SET response_format=? WHERE id=?').run(fields.responseFormat, id);
      });
      const payload = config.protocol === 'apimart' ? apimartPayload(fields, binding.model) : fields.capability === 'text' ? textPayload(fields, binding.model)
        : { model: binding.model, prompt: fields.prompt, ...(fields.capability === 'image' ? { n: 1 } : {}),
          ...(fields.size ? { size: fields.size } : {}), ...(fields.capability === 'video' && fields.seconds ? { seconds: fields.seconds } : {}) };
      const headers = { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': id };
      pending.add(id);
      let generationSubmitted = false;
      try {
        if (fields.referenceImage) {
          const photo = referenceImage(fields.referenceImage);
          const boundary = `----QuotaReference${randomUUID().replaceAll('-', '')}`;
          const extension = photo.contentType === 'image/jpeg' ? 'jpg' : photo.contentType === 'image/webp' ? 'webp' : 'png';
          const uploadBody = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="reference.${extension}"\r\nContent-Type: ${photo.contentType}\r\n\r\n`), photo.bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]);
          const upload = await fetcher(`${config.baseUrl}/uploads/images`, { method: 'POST', headers: { Authorization: headers.Authorization, 'Content-Type': `multipart/form-data; boundary=${boundary}` }, body: uploadBody, redirect: 'manual', signal: AbortSignal.timeout(Math.min(30000, config.timeoutMs)) }, 16384);
          if (!upload.ok) return finish(id, 'failed', { error: '参考图片上传失败，尚未开始生成，预留次数已退回' });
          const url = safeAssetUrl((await readJson(upload))?.url, config.apiKey);
          if (!url || new URL(url).hostname !== 'upload.apimart.ai' || !new URL(url).pathname.startsWith('/f/image/')) return finish(id, 'failed', { error: '参考图片上传结果无效，预留次数已退回' });
          payload.image_urls = [url];
        }
        let body = JSON.stringify(payload);
        if (fields.capability === 'video' && config.videoRequestFormat === 'multipart') {
          const boundary = `----QuotaCenter${randomUUID().replaceAll('-', '')}`;
          headers['Content-Type'] = `multipart/form-data; boundary=${boundary}`;
          body = Object.entries(payload).map(([key, value]) => `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`).join('') + `--${boundary}--\r\n`;
        }
        generationSubmitted = true;
        const response = await fetcher(endpoint(config, fields.capability), { method: 'POST', headers, body, redirect: 'manual', signal: AbortSignal.timeout(config.timeoutMs) });
        if (!response.ok) {
          if (response.status >= 400 && response.status < 500 && ![408, 409].includes(response.status)) return finish(id, 'failed', { error: `上游拒绝请求（HTTP ${response.status}），预留次数已退回` });
          return uncertain(id, `上游返回 HTTP ${response.status}，结果未知，次数暂时预留`);
        }
        return consume(id, await readJson(response), config.apiKey, config.protocol);
      } catch (error) {
        if (!generationSubmitted) return finish(id, 'failed', { error: '参考图准备失败，尚未开始生成，预留次数已退回' });
        if (error.safeRejection) return finish(id, 'failed', { error: error.message });
        return uncertain(id, '上游超时、连接中断或响应无效；为避免重复调用，次数暂时预留，请管理员核对');
      } finally { pending.delete(id); }
    },

    async getJob({ projectId, userId, id, refresh = false } = {}) {
      let row = rowById(validText(id, '任务标识', 64));
      if (!row || row.project_id !== projectId || (userId !== undefined && row.user_id !== userId)) fail(404, '任务不存在');
      row = reconcile(row);
      if (!refresh || !['image', 'video'].includes(row.capability) || row.status !== 'running' || !row.upstream_id || pending.has(id) || (polling.get(id) || 0) > Date.now() - 2000) return record(row);
      polling.set(id, Date.now());
      pending.add(id);
      db.prepare('UPDATE generation_jobs SET updated_at=? WHERE id=?').run(now(), id);
      try {
        const config = channels.getForExecution({ channelId: row.channel_id, capability: row.capability, model: row.model });
        const response = await fetcher(endpoint(config, 'videoStatus', row.upstream_id), { method: 'GET', headers: { Authorization: `Bearer ${config.apiKey}` }, redirect: 'manual', signal: AbortSignal.timeout(Math.min(config.timeoutMs, 30000)) });
        if (!response.ok) return record(row);
        return consume(id, await readJson(response), config.apiKey, config.protocol);
      } catch { return record(row); }
      finally { pending.delete(id); }
    },

    async pollPending({ limit = 10 } = {}) {
      const count = Math.min(20, Math.max(1, Number.isInteger(limit) ? limit : 10));
      const rows = db.prepare("SELECT id,project_id,user_id FROM generation_jobs WHERE capability IN ('image','video') AND status='running' AND upstream_id IS NOT NULL ORDER BY updated_at LIMIT ?").all(count);
      const results = [];
      // Keep provider concurrency bounded while rotating through pending jobs on each timer tick.
      for (let offset = 0; offset < rows.length; offset += 3) {
        results.push(...await Promise.allSettled(rows.slice(offset, offset + 3).map(row => api.getJob({ id: row.id, projectId: row.project_id, userId: row.user_id, refresh: true }))));
      }
      return { checked: rows.length, settled: results.filter(result => result.status === 'fulfilled' && ['succeeded', 'failed'].includes(result.value.status)).length };
    },

    async getContent({ projectId, userId, id, index = 0 } = {}) {
      const row = rowById(validText(id, '任务标识', 64));
      if (!row || row.project_id !== projectId || (userId !== undefined && row.user_id !== userId)) fail(404, '任务不存在');
      if (!['image', 'video'].includes(row.capability) || row.status !== 'succeeded') fail(409, '媒体尚未完成或没有可下载内容');
      const config = channels.getForExecution({ channelId: row.channel_id, capability: row.capability, model: row.model });
      if (row.capability === 'image') {
        if (!/^[0-9]+$/u.test(String(index)) || Number(index) !== 0) fail(400, '图片序号无效');
        const item = parse(row.output_json)?.images?.[Number(index)];
        if (!item) fail(404, '图片不存在');
        let body;
        if (item.dataUrl) {
          const match = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/u.exec(item.dataUrl);
          if (!match) fail(502, '图片内容格式无效');
          body = Buffer.from(match[1], 'base64');
        } else {
          const url = safeAssetUrl(item.url, config.apiKey);
          if (!url) fail(502, '上游图片下载地址无效');
          try {
            const response = await fetcher(url, { method: 'GET', headers: {}, redirect: 'manual', signal: AbortSignal.timeout(config.timeoutMs) }, MAX_JSON_BYTES);
            if (!response.ok) fail(502, '上游图片暂时无法下载');
            body = Buffer.from(await response.arrayBuffer());
          } catch { fail(502, '上游图片下载失败'); }
        }
        if (body.length > MAX_JSON_BYTES) fail(502, '图片超过下载大小限制');
        let contentType;
        try { contentType = imageMime(body); } catch { fail(502, '上游图片文件不完整或格式无效'); }
        return { body, contentType };
      }
      if (!row.upstream_id) fail(409, '视频没有可下载内容');
      let response;
      const assetUrl = config.protocol === 'apimart' ? safeAssetUrl(parse(row.output_json)?.videoUrl, config.apiKey) : null;
      if (config.protocol === 'apimart' && !assetUrl) fail(502, '上游视频下载地址无效');
      // A generated asset is on a separate host. Never forward the API credential to it.
      try { response = await fetcher(assetUrl || endpoint(config, 'videoContent', row.upstream_id), { method: 'GET', headers: assetUrl ? {} : { Authorization: `Bearer ${config.apiKey}` }, redirect: 'manual', signal: AbortSignal.timeout(config.timeoutMs) }, MAX_VIDEO_BYTES); }
      catch { fail(502, '上游视频下载失败'); }
      if (!response.ok) fail(502, '上游视频暂时无法下载');
      const contentType = response.headers.get('content-type')?.split(';')[0];
      if (!['video/mp4', 'video/webm', 'application/octet-stream'].includes(contentType)) fail(502, '上游返回的视频格式无效');
      if (Number(response.headers.get('content-length')) > MAX_VIDEO_BYTES) fail(502, '视频超过下载大小限制');
      const body = Buffer.from(await response.arrayBuffer());
      if (body.length > MAX_VIDEO_BYTES) fail(502, '视频超过下载大小限制');
      return { body, contentType: contentType === 'application/octet-stream' ? 'video/mp4' : contentType };
    },

    resolveJob({ id, action, note } = {}) {
      const row = rowById(validText(id, '任务标识', 64));
      if (!row) fail(404, '任务不存在');
      if (!['commit', 'cancel'].includes(action)) fail(400, '请选择确认扣次或退回次数');
      note = validText(note, '处理说明', 1000);
      if (pending.has(id)) fail(409, '请求正在执行，请稍后核对处理');
      if (!['uncertain', 'running'].includes(row.status)) {
        if ((row.status === 'succeeded' && action === 'commit') || (row.status === 'failed' && action === 'cancel')) return record(reconcile(row));
        fail(409, '任务已经结算，不能改变处理结果');
      }
      return finish(id, action === 'commit' ? 'succeeded' : 'failed', {
        output: parse(row.output_json), tokenUsage: parse(row.token_usage_json), note,
        error: action === 'commit' ? '管理员核对后确认扣次' : '管理员核对后退回次数',
      });
    },

    listJobs() { return db.prepare('SELECT * FROM generation_jobs ORDER BY created_at DESC LIMIT 1000').all().map(row => record(row, { admin: true })); },
    stats() {
      return { ...db.prepare(`SELECT COUNT(*) AS jobCount, COALESCE(SUM(status='succeeded'),0) AS succeededCount,
        COALESCE(SUM(status='failed'),0) AS failedCount, COALESCE(SUM(status='running'),0) AS runningCount,
        COALESCE(SUM(status='uncertain'),0) AS uncertainCount, COALESCE(SUM(estimated_cost_cents),0) AS estimatedCostCents,
        COALESCE(SUM(status='succeeded' AND estimated_cost_cents IS NULL),0) AS unpricedSuccessCount FROM generation_jobs`).get(), costIsEstimate: true };
    },
  };
  return api;
}
