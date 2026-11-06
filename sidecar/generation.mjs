import { createHash, randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { apimartPayload, normalizeApimartResponse } from './apimart.mjs';
import { parseUpstreamBody } from './upstream-body.mjs';
import { publicAddress, resolveUpstreamAddresses } from './upstream-dns.mjs';
import { generationOptions, referenceImage, textPayload } from './generation-options.mjs';
import { imageMime } from './image.mjs';
import { mediaSpec, VIDEO_DURATION_OPTIONS } from './media-spec.mjs';
import { fallbackChain, modelPricing, modelTimeoutMs } from './model-tiers.mjs';
import { withApimartRelayAuth } from './apimart-relay-auth.mjs';
import { apimartUploadUrl } from './apimart-upload-url.mjs';

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const now = () => new Date().toISOString();
const MAX_JSON_BYTES = 24 * 1024 * 1024;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const SELECTABLE_SEEDANCE = /^seedance-2\.(?:0(?:-mini|-fast)?|5)$/u;
const selectableVideo = config => config.protocol === 'apimart' && SELECTABLE_SEEDANCE.test(config.model.id);
function validText(value, field, max) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) fail(400, `${field}格式无效`);
  return value.trim();
}

/** DNS is checked and pinned to the HTTP connection, and redirects are never followed. */
async function networkRequest(address, init, { allowPrivateUpstreams = false, maxBytes = MAX_JSON_BYTES } = {}) {
  const startedAt = Date.now(), transport = { phase: 'dns' };
  const elapsed = () => Math.max(0, Date.now() - startedAt);
  const annotate = error => Object.assign(error, { transport: { ...transport, totalMs: elapsed() } });
  const url = new URL(address);
  const hostname = url.hostname.replace(/^\[|\]$/gu, '');
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw Object.assign(new Error('无效上游地址'), { safeRejection: true });
  let addresses;
  // System lookup itself is not abortable. Bound the caller's wait and never open
  // a socket if that lookup eventually finishes after the request deadline.
  try {
    addresses = await new Promise((resolve, reject) => {
      const abort = () => reject(Object.assign(new Error('上游请求超时'), { code: 'ABORT_ERR', cause: init.signal?.reason }));
      if (init.signal?.aborted) { abort(); return; }
      init.signal?.addEventListener('abort', abort, { once: true });
      resolveUpstreamAddresses(hostname, { signal: init.signal, allowPrivateUpstreams }).then(resolve, reject)
        .finally(() => init.signal?.removeEventListener('abort', abort));
    });
  } catch (error) { error.preconnect = true; throw annotate(error); }
  transport.dnsMs = elapsed();
  if (init.signal?.aborted) throw annotate(Object.assign(new Error('上游请求超时'), { code: 'ABORT_ERR', cause: init.signal.reason, preconnect: true }));
  return new Promise((resolve, reject) => {
    let connected = false;
    const rejectRequest = error => reject(annotate(error));
    transport.phase = 'connecting';
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const request = send(url, { method: init.method ?? 'GET', headers: init.headers, signal: init.signal,
      // Give each checked address enough time before trying the next address family.
      autoSelectFamily: true, autoSelectFamilyAttemptTimeout: 2000,
      ...(url.protocol === 'https:' ? { servername: isIP(hostname) ? undefined : hostname, rejectUnauthorized: true } : {}),
      lookup: (_name, options, callback) => options.all ? callback(null, addresses) : callback(null, addresses[0].address, addresses[0].family) }, response => {
      transport.phase = 'response_headers'; transport.responseHeadersMs = elapsed(); transport.httpStatus = response.statusCode || 502;
      const declared = Number(response.headers['content-length']);
      if (declared > maxBytes) { response.destroy(); rejectRequest(Object.assign(new Error('上游响应超过大小限制'), { code: 'UPSTREAM_RESPONSE_TOO_LARGE' })); return; }
      const chunks = [];
      let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > maxBytes) { response.destroy(); rejectRequest(Object.assign(new Error('上游响应超过大小限制'), { code: 'UPSTREAM_RESPONSE_TOO_LARGE' })); }
        else chunks.push(chunk);
      });
      response.on('error', rejectRequest);
      response.on('end', () => {
        const body = Buffer.concat(chunks);
        const status = response.statusCode || 502;
        transport.phase = 'response_complete'; transport.totalMs = elapsed();
        resolve(Object.assign(new Response([204, 205, 304].includes(status) ? null : body, { status, headers: { 'content-type': response.headers['content-type'] || 'application/octet-stream' } }), { transport: { ...transport } }));
      });
    });
    request.on('socket', socket => {
      const mark = () => { connected = true; };
      if (socket.readyState === 'open') mark();
      transport.reusedSocket = request.reusedSocket === true;
      socket.once(url.protocol === 'https:' ? 'secureConnect' : 'connect', () => {
        mark(); transport.phase = 'connected'; transport[url.protocol === 'https:' ? 'tlsMs' : 'connectMs'] = elapsed();
      });
    });
    request.once('finish', () => { transport.bodySentMs = elapsed(); if (transport.responseHeadersMs === undefined) transport.phase = 'body_sent'; });
    request.on('error', error => {
      if (!connected) error.preconnect = true;
      rejectRequest(error);
    });
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
  const details = raw.completion_tokens_details || raw.output_tokens_details || {};
  const inputTokens = integer(raw.prompt_tokens ?? raw.input_tokens);
  const completionTokens = integer(raw.completion_tokens ?? raw.output_tokens);
  const reasoningTokens = integer(details.reasoning_tokens ?? raw.reasoning_tokens);
  // Official DeepSeek usage already folds reasoning into completion_tokens.
  // When the gateway reports them separately, completion is smaller than reasoning.
  const outputTokens = completionTokens >= reasoningTokens ? completionTokens : completionTokens + reasoningTokens;
  return { inputTokens, outputTokens, reasoningTokens, totalTokens: Math.max(integer(raw.total_tokens), inputTokens + outputTokens) };
}
function modelAccessDenied(status, text) {
  return status === 403 && /does not have access to model|no access to (?:the )?model|model_not_allowed/i.test(text || '');
}
function resolutionRejected(status, text) {
  return (status === 400 || status === 422) && /resolution|720p|unsupported|not support|不支持/i.test(text || '');
}
async function errorText(response) {
  try {
    const text = typeof response.text === 'function' ? await response.text() : '';
    return String(text || '').slice(0, 2000);
  } catch { return ''; }
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
  const jobColumns = new Set(db.prepare('PRAGMA table_info(generation_jobs)').all().map(column => column.name));
  if (!jobColumns.has('response_format')) db.exec('ALTER TABLE generation_jobs ADD COLUMN response_format TEXT');
  if (!jobColumns.has('request_json')) db.exec('ALTER TABLE generation_jobs ADD COLUMN request_json TEXT');
  if (!jobColumns.has('upstream_response_json')) db.exec('ALTER TABLE generation_jobs ADD COLUMN upstream_response_json TEXT');
  if (!jobColumns.has('content_verified')) db.exec('ALTER TABLE generation_jobs ADD COLUMN content_verified INTEGER NOT NULL DEFAULT 0');
  if (!jobColumns.has('progress')) db.exec('ALTER TABLE generation_jobs ADD COLUMN progress INTEGER');
  db.exec(`CREATE TABLE IF NOT EXISTS generation_audit (
    id INTEGER PRIMARY KEY, job_id TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL
  ); CREATE INDEX IF NOT EXISTS generation_audit_job ON generation_audit(job_id,id);`);
  const pending = new Set();
  const polling = new Map();
  const fetcher = (url, init, maxBytes) => {
    const authenticated = withApimartRelayAuth(url, init);
    return fetchImpl ? fetchImpl(url, authenticated) : networkRequest(url, authenticated, { allowPrivateUpstreams, maxBytes });
  };
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
      ...(Number.isInteger(row.progress) ? { progress: row.progress } : {}),
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

  function audit(jobId, action, detail) {
    db.prepare('INSERT INTO generation_audit(job_id,action,detail,created_at) VALUES(?,?,?,?)').run(jobId, action, JSON.stringify(detail ?? {}), now());
  }
  function uploadDiagnostic({ startedAt, status, error, transport = error?.transport, attempts } = {}) {
    const knownCodes = ['ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'EPIPE', 'ETIMEDOUT', 'ABORT_ERR', 'ERR_STREAM_PREMATURE_CLOSE', 'UPSTREAM_RESPONSE_TOO_LARGE'];
    const code = [error?.code, error?.cause?.code].find(value => knownCodes.includes(value));
    const safeTransport = {};
    if (['dns', 'connecting', 'connected', 'body_sent', 'response_headers', 'response_complete'].includes(transport?.phase)) safeTransport.phase = transport.phase;
    for (const field of ['dnsMs', 'connectMs', 'tlsMs', 'bodySentMs', 'responseHeadersMs', 'totalMs']) {
      if (Number.isSafeInteger(transport?.[field]) && transport[field] >= 0) safeTransport[field] = transport[field];
    }
    if (typeof transport?.reusedSocket === 'boolean') safeTransport.reusedSocket = transport.reusedSocket;
    const httpStatus = status ?? transport?.httpStatus;
    return {
      ...(Number.isFinite(startedAt) ? { elapsedMs: Math.max(0, Date.now() - startedAt) } : {}),
      ...(Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599 ? { httpStatus } : {}),
      ...(Number.isInteger(attempts) ? { attempts } : {}),
      ...(code ? { networkCode: code } : {}),
      ...(error?.preconnect === true ? { preconnect: true } : {}),
      ...(Object.keys(safeTransport).length ? { transport: safeTransport } : {}),
    };
  }
  function uploadFailure(id, category, detail = {}) {
    const messages = {
      http: '参考图片上传失败，尚未开始生成，预留次数已退回',
      json: '参考图片上传响应无效，尚未开始生成，预留次数已退回',
      url: '参考图片上传结果无效，尚未开始生成，预留次数已退回',
      network: '参考图片上传连接失败，尚未开始生成，预留次数已退回',
      timeout: '参考图片上传超时，尚未开始生成，预留次数已退回',
      prepare: '参考图准备失败，尚未开始生成，预留次数已退回',
    };
    audit(id, 'reference.upload_failed', { category, ...uploadDiagnostic(detail) });
    return finish(id, 'failed', { error: messages[category] || messages.prepare });
  }
  async function uploadReference(id, config, photo, startedAt) {
    const boundary = `----QuotaReference${randomUUID().replaceAll('-', '')}`;
    const extension = photo.contentType === 'image/jpeg' ? 'jpg' : photo.contentType === 'image/webp' ? 'webp' : 'png';
    const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="reference.${extension}"\r\nContent-Type: ${photo.contentType}\r\n\r\n`), photo.bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    const deadline = startedAt + 65000;
    for (let attempts = 1; attempts <= 2; attempts++) {
      let phase = 'network', status, transport;
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw Object.assign(new Error('参考图片上传超时'), { uploadCategory: 'timeout', uploadDetail: { startedAt, attempts: attempts - 1 } });
      const signal = AbortSignal.timeout(Math.min(30000, config.timeoutMs, remaining));
      try {
        const response = await fetcher(`${config.baseUrl}/uploads/images`, { method: 'POST',
          headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': String(Buffer.byteLength(body)) },
          body, redirect: 'manual', signal }, 16384);
        status = response.status; transport = response.transport;
        if (!response.ok) throw Object.assign(new Error('参考图片上传失败'), { uploadCategory: 'http' });
        phase = 'json';
        const uploaded = await readJson(response);
        phase = 'url';
        const url = apimartUploadUrl(uploaded?.url, { secrets: [config.apiKey, process.env.APIMART_RELAY_SECRET] });
        if (!url) throw Object.assign(new Error('参考图片上传结果无效'), { uploadCategory: 'url' });
        audit(id, 'reference.upload_succeeded', uploadDiagnostic({ startedAt, status, transport, attempts }));
        return url;
      } catch (error) {
        const timeout = phase === 'network' && (signal.aborted || error?.name === 'TimeoutError' || error?.code === 'ETIMEDOUT' || error?.cause?.name === 'TimeoutError');
        const category = error.uploadCategory || (error?.code === 'UPSTREAM_RESPONSE_TOO_LARGE' ? 'json' : timeout ? 'timeout' : phase);
        const code = error?.code || error?.cause?.code;
        const transient = category === 'timeout' || (category === 'network' && !error.safeRejection &&
          ['ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'EPIPE', 'ERR_STREAM_PREMATURE_CLOSE'].includes(code)) ||
          (category === 'http' && [408, 429, 502, 503, 504].includes(status));
        const detail = { startedAt, status, transport: transport || error.transport, error, attempts };
        if (attempts === 2 || !transient || Date.now() + 500 >= deadline) {
          throw Object.assign(error, { uploadCategory: category, uploadDetail: { startedAt, status, transport: detail.transport, attempts } });
        }
        // Only file storage is repeated; no generation request exists at this point.
        audit(id, 'reference.upload_retry', { category, ...uploadDiagnostic(detail) });
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  }
  function rememberUpstream(id, data, secret) {
    let encoded = JSON.stringify(data);
    if (secret) encoded = encoded.split(secret).join('').split(encodeURIComponent(secret)).join('');
    db.prepare('UPDATE generation_jobs SET upstream_response_json=? WHERE id=?').run(encoded, id);
  }
  function cardProfile(projectId, userId) {
    if (!db.prepare('PRAGMA table_info(quota_codes)').all().some(column => column.name === 'media_spec_json')) return null;
    const specs = [];
    for (const row of db.prepare('SELECT media_spec_json FROM quota_codes WHERE project_id=? AND redeemed_by=? AND media_spec_json IS NOT NULL').all(projectId, userId)) {
      const spec = mediaSpec(JSON.parse(row.media_spec_json));
      if (spec) specs.push(spec);
    }
    if (specs.length) {
      const key = spec => JSON.stringify(spec);
      if (new Set(specs.map(key)).size > 1) fail(409, '账户里的模型或视频规格不一致，请联系管理员核对后再生成');
      return specs[0];
    }
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='shop_products'").get()
      || !db.prepare('PRAGMA table_info(shop_products)').all().some(column => column.name === 'media_spec_json')) return null;
    const videos = [];
    for (const row of db.prepare('SELECT media_spec_json FROM shop_products WHERE project_id=? AND media_spec_json IS NOT NULL').all(projectId)) {
      const spec = mediaSpec(JSON.parse(row.media_spec_json));
      // A leader batch must never become the default for cards that did not buy it.
      if (spec?.video && spec.tier !== 'leader') videos.push(spec.video);
    }
    if (!videos.length) return null;
    const key = item => `${item.seconds}|${item.resolution}|${item.audio}`;
    if (new Set(videos.map(key)).size > 1) fail(409, '账户里的视频售卖规格不一致，请联系管理员核对后再生成');
    return { video: videos[0] };
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
      return parseUpstreamBody(Buffer.concat(chunks).toString('utf8'));
    }
    const raw = await response.text();
    if (Buffer.byteLength(raw) > MAX_JSON_BYTES) throw new Error('响应超过限制');
    return parseUpstreamBody(raw);
  }
  function stageReady(id, output, tokenUsage) {
    db.prepare(`UPDATE generation_jobs SET status='ready',output_json=?,error=NULL,token_usage_json=?,updated_at=? WHERE id=?`)
      .run(JSON.stringify(output), tokenUsage ? JSON.stringify(tokenUsage) : null, now(), id);
    return record(rowById(id));
  }
  function releaseReady(id, reason) {
    const row = rowById(id);
    if (!row || row.status !== 'ready') return row ? record(reconcile(row)) : null;
    audit(id, 'generation.refunded', { reason });
    return finish(id, 'failed', { error: reason, note: '结果未能交付，预留次数已自动退回' });
  }
  function consume(id, data, apiKey, protocol = 'openai-compatible', options = {}) {
    let row = rowById(id);
    if (protocol === 'apimart') data = normalizeApimartResponse(row.capability, data);
    const tokenUsage = usage(data);
    const incomingId = typeof data?.id === 'string' && /^[A-Za-z0-9._:-]{1,200}$/u.test(data.id) ? data.id : null;
    if (row.upstream_id && incomingId && incomingId !== row.upstream_id) {
      audit(id, 'generation.task_mismatch', { expected: row.upstream_id, received: incomingId });
      return uncertain(id, '上游返回的任务标识与原任务不一致，未结算，已标记待人工核对');
    }
    if (!row.upstream_id && incomingId) {
      db.prepare('UPDATE generation_jobs SET upstream_id=? WHERE id=?').run(incomingId, id);
      row = rowById(id);
    }
    const upstreamId = row.upstream_id;
    if (row.capability === 'text') {
      const content = data?.choices?.[0]?.message?.content;
      const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map(part => part.type === 'text' ? part.text : '').join('') : '';
      if (!text) return uncertain(id, '上游未返回可识别的文字结果，请核对接口协议');
      if (row.response_format === 'json_object') {
        try {
          const value = JSON.parse(text);
          if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.keys(value).length) throw new Error('invalid object');
        } catch { return options.deferFailure ? { deferredFailure: '上游未返回有效的 JSON 对象，预留次数已退回' } : finish(id, 'failed', { error: '上游未返回有效的 JSON 对象，预留次数已退回' }); }
        // The caller must accept a usable object. A syntactically valid JSON
        // document is not itself a delivered answer.
        return stageReady(id, { text }, tokenUsage);
      }
      return finish(id, 'succeeded', { output: { text }, tokenUsage });
    }
    if (['failed', 'cancelled', 'canceled'].includes(data?.status)) return options.deferFailure ? { deferredFailure: '上游生成任务失败，预留次数已退回' } : finish(id, 'failed', { error: '上游生成任务失败，预留次数已退回' });
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
        db.prepare("UPDATE generation_jobs SET status='running',error=NULL,progress=COALESCE(?,progress),updated_at=? WHERE id=?").run(Number.isInteger(data?.progress) ? data.progress : null, now(), id);
        return record(rowById(id));
      }
      if (!images.length) return uncertain(id, '上游未返回可识别的图片结果，请核对接口协议');
      if (images.every(item => item.dataUrl)) return finish(id, 'succeeded', { output: { images }, tokenUsage });
      return stageReady(id, { images }, tokenUsage);
    }
    const videoUrl = safeAssetUrl(data?.url || data?.video_url || data?.output?.url, apiKey);
    if (['completed', 'succeeded'].includes(data?.status) || videoUrl) {
      if (!videoUrl && (!upstreamId || protocol === 'apimart')) return uncertain(id, '上游视频结果缺少下载信息，请管理员核对');
      return stageReady(id, { ...(videoUrl ? { videoUrl } : {}), contentAvailable: Boolean(upstreamId) }, tokenUsage);
    }
    if (upstreamId && ['queued', 'in_progress', 'processing', 'running', 'pending'].includes(data?.status)) {
      db.prepare("UPDATE generation_jobs SET status='running',error=NULL,progress=COALESCE(?,progress),updated_at=? WHERE id=?").run(Number.isInteger(data?.progress) ? data.progress : null, now(), id);
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
      if (capability !== 'video') fail(400, '时长仅用于视频生成');
      const seconds = Number(input.seconds);
      if (!Number.isInteger(seconds) || seconds < 1 || seconds > 120) fail(400, '视频时长必须为 1 至 120 秒');
      fields.seconds = String(seconds);
    }
    return { ...fields, ...generationOptions(input, capability) };
  }

  const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  async function fetchUpstream(url, init, maxBytes, { attempts = 1, idempotent = false } = {}) {
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const response = await fetcher(url, init, maxBytes);
        if (idempotent && [429, 502, 503, 504].includes(response.status) && attempt + 1 < attempts) {
          await wait(200 * (attempt + 1));
          continue;
        }
        return response;
      } catch (error) {
        lastError = error;
        if ((idempotent || error?.preconnect === true) && attempt + 1 < attempts) { await wait(200 * (attempt + 1)); continue; }
        throw error;
      }
    }
    throw lastError;
  }
  function priced(config, videoSeconds = 5, defaultVideoSeconds = 5) {
    const pricing = config.model.pricing || modelPricing(config.model.id) || null;
    if (selectableVideo(config) && pricing?.perRequestCents !== undefined) {
      // Only built-in reference prices declare a duration basis. An administrator's
      // existing per-request amount may describe another duration, so leave changed
      // durations unpriced instead of inventing a baseline or underestimating them.
      if (config.model.pricing) return videoSeconds === defaultVideoSeconds ? pricing : null;
      if (pricing.referenceSeconds) return { ...pricing, perRequestCents: pricing.perRequestCents * videoSeconds / pricing.referenceSeconds };
    }
    return pricing;
  }
  function buildPayload(fields, model, protocol, profile) {
    const payload = protocol === 'apimart' ? apimartPayload(fields, model) : fields.capability === 'text' ? textPayload(fields, model)
      : { model, prompt: fields.prompt, ...(fields.capability === 'image' ? { n: 1 } : {}),
        ...(fields.size ? { size: fields.size } : {}), ...(fields.capability === 'video' && fields.seconds ? { seconds: fields.seconds } : {}) };
    if (profile?.image?.resolution === '1k' && fields.capability === 'image' && protocol === 'apimart') {
      Object.assign(payload, { n: 1, size: profile.image.size || '1:1', resolution: '1k', quality: profile.image.quality || 'low' });
    }
    if (protocol === 'apimart') payload.stream = false;
    if (profile?.video && fields.capability === 'video') {
      if (protocol === 'apimart') Object.assign(payload, { duration: profile.video.seconds, resolution: profile.video.resolution, generate_audio: profile.video.audio });
      else payload.seconds = String(profile.video.seconds);
    }
    return payload;
  }
  function attemptedFallbacks(id) {
    return new Set(db.prepare("SELECT detail FROM generation_audit WHERE job_id=? AND action='generation.fallback'").all(id).map(row => {
      try { return JSON.parse(row.detail).to; } catch { return null; }
    }).filter(Boolean));
  }
  async function recover(id, message, { accessDenied = false } = {}) {
    const row = rowById(id);
    const snapshot = parse(row.request_json) || {};
    if (snapshot.hasReferenceImage) return finish(id, 'failed', { error: message });
    const primary = snapshot.primaryModel || row.model;
    const chain = fallbackChain(row.capability, primary, snapshot.fallbacks?.[row.capability], snapshot.tier === 'leader' ? 'leader' : 'standard');
    const hops = db.prepare("SELECT COUNT(*) AS n FROM generation_audit WHERE job_id=? AND action='generation.fallback'").get(id).n;
    if (!accessDenied && hops > 0) return finish(id, 'failed', { error: message });
    const tried = attemptedFallbacks(id);
    tried.add(row.model);
    const step = chain.find(item => !tried.has(item.model));
    if (!step) return finish(id, 'failed', { error: accessDenied ? '这把密钥开通的模型都试过了，预留次数已退回' : message });
    let config;
    try { config = channels.getForExecution({ channelId: row.channel_id, capability: row.capability, model: step.model }); }
    catch {
      audit(id, 'generation.fallback', { from: row.model, to: step.model, skipped: true, reason: 'model_not_configured' });
      return accessDenied ? recover(id, message, { accessDenied: true }) : finish(id, 'failed', { error: `${message.replace(/，预留次数已退回$/, '')}；备用模型未配置，预留次数已退回` });
    }
    if (row.capability === 'video' && config.protocol === 'apimart' && !selectableVideo(config)
      && (snapshot.videoSpec?.seconds || Number(snapshot.seconds) || 5) !== 5) {
      audit(id, 'generation.fallback', { from: row.model, to: step.model, skipped: true, reason: 'duration_unsupported' });
      return recover(id, message, { accessDenied: true });
    }
    if (row.capability === 'video' && config.videoRequestFormat === 'multipart') return finish(id, 'failed', { error: message });
    audit(id, 'generation.fallback', { from: row.model, to: step.model, reason: accessDenied ? 'model_access_denied' : 'primary_failed' });
    const pricing = priced(config, snapshot.videoSpec?.seconds || Number(snapshot.seconds) || 5,
      snapshot.defaultVideoSeconds || snapshot.videoSpec?.seconds || 5);
    db.prepare('UPDATE generation_jobs SET model=?,pricing_json=?,status=?,error=NULL,upstream_id=NULL,updated_at=? WHERE id=?')
      .run(step.model, pricing ? JSON.stringify(pricing) : null, 'running', now(), id);
    const fields = { capability: row.capability, prompt: snapshot.prompt, ...(snapshot.size ? { size: snapshot.size } : {}),
      ...(snapshot.seconds ? { seconds: snapshot.seconds } : {}), ...(snapshot.aspectRatio ? { aspectRatio: snapshot.aspectRatio } : {}),
      ...(snapshot.responseFormat ? { responseFormat: snapshot.responseFormat } : {}), ...(snapshot.maxTokens ? { maxTokens: snapshot.maxTokens } : {}),
      ...(snapshot.messages ? { messages: snapshot.messages } : {}) };
    const resolutions = [step.resolution, step.resolutionFallback].filter(Boolean);
    let lastDenied = false;
    try {
      for (const resolution of resolutions.length ? resolutions : [null]) {
        const video = snapshot.videoSpec ? { ...snapshot.videoSpec, ...(resolution ? { resolution } : {}) } : (resolution ? { seconds: Number(snapshot.seconds) || 5, resolution, audio: false } : null);
        const payload = buildPayload(fields, step.model, config.protocol, { video, image: snapshot.imageSpec || null });
        const response = await fetchUpstream(endpoint(config, row.capability), { method: 'POST', headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `${id}:fallback:${step.model}:${resolution || 'default'}` }, body: JSON.stringify(payload), redirect: 'manual', signal: AbortSignal.timeout(modelTimeoutMs(step.model, config.timeoutMs)) }, undefined, { attempts: 2 });
        if (!response.ok) {
          const detail = await errorText(response);
          console.error('upstream non-2xx', response.status, detail.slice(0, 300));
          if (modelAccessDenied(response.status, detail)) { lastDenied = true; break; }
          if (resolution && resolution !== step.resolutionFallback && resolutionRejected(response.status, detail) && step.resolutionFallback) {
            audit(id, 'generation.fallback', { from: step.model, to: step.model, resolution: step.resolutionFallback, reason: 'resolution_unsupported' });
            continue;
          }
          if (response.status >= 400 && response.status < 500 && ![408, 409].includes(response.status)) return finish(id, 'failed', { error: `备用模型也拒绝了请求（HTTP ${response.status}），预留次数已退回` });
          return uncertain(id, `备用模型返回 HTTP ${response.status}，结果未知，次数暂时预留`);
        }
        const data = await readJson(response);
        rememberUpstream(id, data, config.apiKey);
        const outcome = consume(id, data, config.apiKey, config.protocol, { deferFailure: true });
        if (outcome?.deferredFailure) return accessDenied ? recover(id, outcome.deferredFailure, { accessDenied: true }) : finish(id, 'failed', { error: outcome.deferredFailure });
        return outcome;
      }
    } catch (error) {
      if (error.safeRejection || error.preconnect) return finish(id, 'failed', { error: '备用模型未能连接，预留次数已退回' });
      return uncertain(id, '备用模型超时或响应无效；为避免重复调用，次数暂时预留，请管理员核对');
    }
    if (lastDenied) return recover(id, '这把密钥没有该模型权限，已改用下一个可用模型', { accessDenied: true });
    return finish(id, 'failed', { error: message });
  }
  async function applyResult(id, data, apiKey, protocol) {
    const outcome = consume(id, data, apiKey, protocol, { deferFailure: true });
    if (outcome?.deferredFailure) return recover(id, outcome.deferredFailure);
    return outcome;
  }

  const api = {
    mediaOptions({ projectId, userId } = {}) {
      const unavailable = { video: { available: false, durationSeconds: null, durationOptions: [], resolution: null } };
      projectId = validText(projectId, '平台标识', 64);
      userId = validText(userId, '用户标识', 200);
      try {
        const platform = platforms.getPlatform(projectId);
        if (!platform.enabled) return unavailable;
        const binding = platform.bindings.find(item => item.capability === 'video');
        if (!binding) return unavailable;
        const profile = cardProfile(projectId, userId);
        const model = profile?.models?.video || binding.model;
        const config = channels.getForExecution({ channelId: binding.channelId, capability: 'video', model });
        const durationSeconds = profile?.video?.seconds || 5;
        return { video: { available: true, durationSeconds,
          durationOptions: selectableVideo(config) ? [...VIDEO_DURATION_OPTIONS] : [durationSeconds],
          resolution: profile?.video?.resolution || null } };
      } catch { return unavailable; }
    },
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
      let profile = cardProfile(fields.projectId, fields.userId);
      const defaultVideoSeconds = profile?.video?.seconds || 5;
      const model = profile?.models?.[fields.capability] || binding.model;
      const config = channels.getForExecution({ channelId: binding.channelId, capability: fields.capability, model });
      if (fields.capability === 'video' && config.protocol === 'apimart') {
        const seconds = fields.seconds ? Number(fields.seconds) : defaultVideoSeconds;
        if (selectableVideo(config)) {
          if (!VIDEO_DURATION_OPTIONS.includes(seconds)) fail(400, '视频时长请选择 5 秒、10 秒或 15 秒');
          // Issued cards keep their saved default, model, resolution and audio settings.
          // Only the bounded duration selection applies to this one generation.
          profile = { ...(profile || {}), video: { seconds,
            resolution: profile?.video?.resolution || (['seedance-2.5', 'seedance-2.0'].includes(model) ? '720p' : '480p'),
            audio: profile?.video?.audio ?? false } };
        } else if (seconds !== defaultVideoSeconds) fail(400, '当前视频模型暂不支持选择其他时长');
      }
      if (fields.referenceImage && config.protocol !== 'apimart') fail(400, '该渠道尚未配置参考图上传协议，请使用支持图生图的 APIMart 渠道');
      const id = randomUUID();
      const timestamp = now();
      const pricing = priced(config, profile?.video?.seconds || Number(fields.seconds) || 5, defaultVideoSeconds);
      const snapshot = { capability: fields.capability, prompt: fields.prompt, size: fields.size ?? null, seconds: fields.seconds ?? null,
        aspectRatio: fields.aspectRatio ?? null, responseFormat: fields.responseFormat ?? null, maxTokens: fields.maxTokens ?? null,
        messages: fields.messages ?? null, hasReferenceImage: Boolean(fields.referenceImage),
        ...(fields.capability === 'video' ? { defaultVideoSeconds } : {}),
        ...(profile?.video ? { videoSpec: profile.video } : {}), ...(profile?.image ? { imageSpec: profile.image } : {}),
        ...(profile?.fallbacks ? { fallbacks: profile.fallbacks } : {}), ...(profile?.tier ? { tier: profile.tier } : {}), primaryModel: model };
      try {
        transaction(() => {
          db.prepare(`INSERT INTO generation_jobs(id,project_id,user_id,request_id,request_hash,capability,channel_id,model,units,status,pricing_json,request_json,created_at,updated_at)
            VALUES(?,?,?,?,?,?,?,?,?,'queued',?,?,?,?)`).run(id, fields.projectId, fields.userId, fields.requestId, fingerprint, fields.capability,
            binding.channelId, model, platform.unitsPerUse, pricing ? JSON.stringify(pricing) : null, JSON.stringify(snapshot), timestamp, timestamp);
          const reservation = quota.reserve({ projectId: fields.projectId, userId: fields.userId, requestId: `generation:${id}`, units: platform.unitsPerUse, capability: fields.capability });
          db.prepare("UPDATE generation_jobs SET usage_id=?,status='running',updated_at=? WHERE id=?").run(reservation.usage.id, now(), id);
          if (fields.responseFormat) db.prepare('UPDATE generation_jobs SET response_format=? WHERE id=?').run(fields.responseFormat, id);
        });
      } catch (error) {
        const winner = db.prepare('SELECT * FROM generation_jobs WHERE project_id=? AND user_id=? AND request_id=?').get(fields.projectId, fields.userId, fields.requestId);
        if (!winner) throw error;
        if (winner.request_hash !== fingerprint) fail(409, '同一请求标识不能用于不同内容，请使用新的请求标识');
        return record(reconcile(winner));
      }
      const payload = buildPayload(fields, model, config.protocol, profile);
      if (profile?.video && fields.capability === 'video' && fields.seconds && Number(fields.seconds) !== profile.video.seconds) audit(id, 'generation.spec_clipped', { requestedSeconds: fields.seconds, applied: profile.video });
      const headers = { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': id };
      pending.add(id);
      let generationSubmitted = false;
      let uploadStartedAt;
      try {
        if (fields.referenceImage) {
          uploadStartedAt = Date.now();
          const photo = referenceImage(fields.referenceImage);
          payload.image_urls = [await uploadReference(id, config, photo, uploadStartedAt)];
        }
        let body = JSON.stringify(payload);
        if (fields.capability === 'video' && config.videoRequestFormat === 'multipart') {
          const boundary = `----QuotaCenter${randomUUID().replaceAll('-', '')}`;
          headers['Content-Type'] = `multipart/form-data; boundary=${boundary}`;
          body = Object.entries(payload).map(([key, value]) => `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`).join('') + `--${boundary}--\r\n`;
        }
        generationSubmitted = true;
        const response = await fetchUpstream(endpoint(config, fields.capability), { method: 'POST', headers, body, redirect: 'manual', signal: AbortSignal.timeout(modelTimeoutMs(model, config.timeoutMs)) }, undefined, { attempts: 2 });
        if (!response.ok) {
          const detail = await errorText(response);
          console.error('upstream non-2xx', response.status, detail.slice(0, 300));
          if (response.status >= 400 && response.status < 500 && ![408, 409].includes(response.status)) return recover(id, `上游拒绝请求（HTTP ${response.status}），预留次数已退回`, { accessDenied: modelAccessDenied(response.status, detail) });
          return uncertain(id, `上游返回 HTTP ${response.status}，结果未知，次数暂时预留`);
        }
        const data = await readJson(response);
        rememberUpstream(id, data, config.apiKey);
        return applyResult(id, data, config.apiKey, config.protocol);
      } catch (error) {
        if (!generationSubmitted) {
          return uploadFailure(id, error.uploadCategory || 'prepare', { startedAt: uploadStartedAt, ...error.uploadDetail, error });
        }
        if (error.safeRejection) return finish(id, 'failed', { error: error.message });
        if (error.preconnect) return finish(id, 'failed', { error: '上游暂时无法连接，尚未开始生成，预留次数已退回' });
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
        const response = await fetchUpstream(endpoint(config, 'videoStatus', row.upstream_id), { method: 'GET', headers: { Authorization: `Bearer ${config.apiKey}` }, redirect: 'manual', signal: AbortSignal.timeout(Math.min(modelTimeoutMs(row.model, config.timeoutMs), 30000)) }, undefined, { attempts: 3, idempotent: true });
        if (!response.ok) return record(row);
        const data = await readJson(response);
        rememberUpstream(id, data, config.apiKey);
        return applyResult(id, data, config.apiKey, config.protocol);
      } catch { return record(row); }
      finally { pending.delete(id); }
    },

    async pollPending({ limit = 10 } = {}) {
      const count = Math.min(20, Math.max(1, Number.isInteger(limit) ? limit : 10));
      const rows = db.prepare("SELECT id,project_id,user_id FROM generation_jobs WHERE capability IN ('image','video') AND status='running' AND upstream_id IS NOT NULL ORDER BY updated_at LIMIT ?").all(count);
      const results = [];
      // Keep provider concurrency bounded while rotating through pending jobs on each timer tick.
      for (let offset = 0; offset < rows.length; offset += 5) {
        results.push(...await Promise.allSettled(rows.slice(offset, offset + 5).map(row => api.getJob({ id: row.id, projectId: row.project_id, userId: row.user_id, refresh: true }))));
      }
      return { checked: rows.length, settled: results.filter(result => result.status === 'fulfilled' && ['succeeded', 'failed'].includes(result.value.status)).length };
    },

    async getContent({ projectId, userId, id, index = 0 } = {}) {
      const row = rowById(validText(id, '任务标识', 64));
      if (!row || row.project_id !== projectId || (userId !== undefined && row.user_id !== userId)) fail(404, '任务不存在');
      if (!['image', 'video'].includes(row.capability) || !['succeeded', 'ready'].includes(row.status)) fail(409, '媒体尚未完成或没有可下载内容');
      const config = channels.getForExecution({ channelId: row.channel_id, capability: row.capability, model: row.model });
      const unusable = (reason, refundReason = reason) => { if (row.status === 'ready') releaseReady(row.id, refundReason); fail(502, row.status === 'ready' ? refundReason : reason); };
      if (row.capability === 'image') {
        if (!/^[0-9]+$/u.test(String(index)) || Number(index) !== 0) fail(400, '图片序号无效');
        const item = parse(row.output_json)?.images?.[Number(index)];
        if (!item) fail(404, '图片不存在');
        let body;
        if (item.dataUrl) {
          const match = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/u.exec(item.dataUrl);
          if (!match) unusable('图片内容格式无效', '图片内容格式无效，预留次数已退回');
          body = Buffer.from(match[1], 'base64');
        } else {
          const url = safeAssetUrl(item.url, config.apiKey);
          if (!url) unusable('上游图片下载地址无效', '上游图片下载地址无效，预留次数已退回');
          let response;
          try {
            response = await fetchUpstream(url, { method: 'GET', headers: {}, redirect: 'manual', signal: AbortSignal.timeout(config.timeoutMs) }, MAX_JSON_BYTES, { attempts: 3, idempotent: true });
          } catch { fail(502, '上游图片下载失败'); }
          if (!response.ok) {
            const detail = await errorText(response);
            console.error('upstream content non-2xx', response.status, detail.slice(0, 300));
            if (response.status === 404 || response.status === 410) unusable('上游图片暂时无法下载', '上游图片不存在或已失效，预留次数已退回');
            fail(502, '上游图片暂时无法下载');
          }
          body = Buffer.from(await response.arrayBuffer());
        }
        if (body.length > MAX_JSON_BYTES) unusable('图片超过下载大小限制', '图片超过下载大小限制，预留次数已退回');
        let contentType;
        try { contentType = imageMime(body); } catch { unusable('上游图片文件不完整或格式无效', '上游图片文件不完整或格式无效，预留次数已退回'); }
        if (row.status === 'ready') db.prepare('UPDATE generation_jobs SET content_verified=1,updated_at=? WHERE id=?').run(now(), row.id);
        return { body, contentType };
      }
      if (!row.upstream_id) fail(409, '视频没有可下载内容');
      let response;
      const assetUrl = config.protocol === 'apimart' ? safeAssetUrl(parse(row.output_json)?.videoUrl, config.apiKey) : null;
      if (config.protocol === 'apimart' && !assetUrl) unusable('上游视频下载地址无效', '上游视频下载地址无效，预留次数已退回');
      // A generated asset is on a separate host. Never forward the API credential to it.
      try { response = await fetchUpstream(assetUrl || endpoint(config, 'videoContent', row.upstream_id), { method: 'GET', headers: assetUrl ? {} : { Authorization: `Bearer ${config.apiKey}` }, redirect: 'manual', signal: AbortSignal.timeout(Math.max(config.timeoutMs, row.capability === 'video' ? 120000 : config.timeoutMs)) }, MAX_VIDEO_BYTES, { attempts: 3, idempotent: true }); }
      catch { fail(502, '上游视频下载失败'); }
      if (!response.ok) {
        const detail = await errorText(response);
        console.error('upstream content non-2xx', response.status, detail.slice(0, 300));
        if (response.status === 404 || response.status === 410) unusable('上游视频暂时无法下载', '上游视频不存在或已失效，预留次数已退回');
        fail(502, '上游视频暂时无法下载');
      }
      const contentType = response.headers.get('content-type')?.split(';')[0];
      if (!['video/mp4', 'video/webm', 'application/octet-stream'].includes(contentType)) unusable('上游返回的视频格式无效', '上游返回的视频格式无效，预留次数已退回');
      if (Number(response.headers.get('content-length')) > MAX_VIDEO_BYTES) unusable('视频超过下载大小限制', '视频超过下载大小限制，预留次数已退回');
      const body = Buffer.from(await response.arrayBuffer());
      if (body.length > MAX_VIDEO_BYTES) unusable('视频超过下载大小限制', '视频超过下载大小限制，预留次数已退回');
      if (row.status === 'ready') db.prepare('UPDATE generation_jobs SET content_verified=1,updated_at=? WHERE id=?').run(now(), row.id);
      return { body, contentType: contentType === 'application/octet-stream' ? 'video/mp4' : contentType };
    },

    async acceptDelivery({ projectId, userId, id } = {}) {
      let row = rowById(validText(id, '任务标识', 64));
      if (!row || row.project_id !== projectId || (userId !== undefined && row.user_id !== userId)) fail(404, '任务不存在');
      row = reconcile(row);
      if (row.status === 'succeeded') return record(row);
      if (row.status !== 'ready') fail(409, '结果尚未交付，不能确认扣次');
      if (['image', 'video'].includes(row.capability) && !row.content_verified) {
        try { await api.getContent({ projectId, userId, id }); }
        catch (error) {
          const current = rowById(id);
          if (current?.status === 'failed') return record(current);
          throw error;
        }
        row = rowById(id);
        if (row.status !== 'ready') return record(row);
      }
      audit(id, 'generation.delivered', { capability: row.capability });
      return finish(id, 'succeeded', { output: parse(row.output_json), tokenUsage: parse(row.token_usage_json), note: '调用方确认已拿到可用结果，结算扣次' });
    },

    rejectDelivery({ projectId, userId, id, reason } = {}) {
      let row = rowById(validText(id, '任务标识', 64));
      if (!row || row.project_id !== projectId || (userId !== undefined && row.user_id !== userId)) fail(404, '任务不存在');
      row = reconcile(row);
      if (row.status === 'failed') return record(row);
      if (row.status !== 'ready') fail(409, '只有尚未确认交付的结果可以退回次数');
      const detail = typeof reason === 'string' && reason.trim() ? validText(reason, '退回原因', 1000) : '结果不可用，预留次数已退回';
      audit(id, 'generation.refunded', { reason: detail });
      return finish(id, 'failed', { error: detail, note: '结果未交付，预留次数已自动退回' });
    },

    resolveJob({ id, action, note } = {}) {
      const row = rowById(validText(id, '任务标识', 64));
      if (!row) fail(404, '任务不存在');
      if (!['commit', 'cancel'].includes(action)) fail(400, '请选择确认扣次或退回次数');
      note = validText(note, '处理说明', 1000);
      if (pending.has(id)) fail(409, '请求正在执行，请稍后核对处理');
      if (!['uncertain', 'running', 'ready'].includes(row.status)) {
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
        COALESCE(SUM(status='uncertain'),0) AS uncertainCount, COALESCE(SUM(status='ready'),0) AS readyCount,
        COALESCE(SUM(estimated_cost_cents),0) AS estimatedCostCents,
        COALESCE(SUM(status='succeeded' AND estimated_cost_cents IS NULL),0) AS unpricedSuccessCount FROM generation_jobs`).get(), costIsEstimate: true };
    },
  };
  // Replay a stored upstream body after a crash. Never repeat the POST.
  for (let row of db.prepare('SELECT * FROM generation_jobs').all()) {
    row = reconcile(row);
    if (row.upstream_response_json && row.status === 'running') {
      try {
        const config = channels.getForExecution({ channelId: row.channel_id, capability: row.capability, model: row.model });
        consume(row.id, JSON.parse(row.upstream_response_json), config.apiKey, config.protocol);
      } catch {
        db.prepare("UPDATE generation_jobs SET status='uncertain',error=?,updated_at=? WHERE id=? AND status='running'")
          .run('已保存的上游响应无法完成结算，请管理员核对', now(), row.id);
      }
      continue;
    }
    if (row.status === 'queued' || (row.status === 'running' && !row.upstream_id)) {
      db.prepare('UPDATE generation_jobs SET status=?,error=?,updated_at=? WHERE id=?')
        .run(row.usage_id ? 'uncertain' : 'failed', row.usage_id ? '服务重启前的调用结果未知，请管理员核对后处理' : '请求在开始调用前中断，可重新提交新的请求', now(), row.id);
    }
  }
  return api;
}
