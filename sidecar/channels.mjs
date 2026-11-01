import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { APIMART_ENDPOINTS } from './apimart.mjs';
import { createChannelBudgets } from './channel-budgets.mjs';

const CAPABILITIES = new Set(['text', 'image', 'video']);
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };

function text(value, label, maximum) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum || /[\u0000-\u001f\u007f]/u.test(value)) {
    fail(400, `${label}格式无效或超过${maximum}字符`);
  }
  return value.trim();
}

function identifier(value, label) {
  const id = text(value, label, 64);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(id)) fail(400, `${label}只允许字母、数字、点、下划线和短横线`);
  return id;
}

function capability(value) {
  if (!CAPABILITIES.has(value)) fail(400, '能力类型必须是文字、图片或视频');
  return value;
}

function baseUrl(value) {
  const raw = text(value, '接口地址', 2000);
  let url;
  try { url = new URL(raw); } catch { fail(400, '接口地址必须是完整的 HTTP 或 HTTPS 地址'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash || raw.includes('?') || raw.includes('#')) {
    fail(400, '接口地址仅支持 HTTP/HTTPS，不能包含账号、密码、查询参数或锚点');
  }
  // Keep provider-specific paths, including /v1 or /api; do not invent an endpoint.
  return url.toString().replace(/\/+$/u, '');
}

function models(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) fail(400, '每个渠道需要配置1至100个模型');
  const seen = new Set();
  return value.map(model => {
    if (!model || typeof model !== 'object' || Array.isArray(model)) fail(400, '模型配置格式无效');
    const result = { id: text(model.id, '模型名称', 160), capability: capability(model.capability) };
    if (model.pricing !== undefined) {
      if (!model.pricing || typeof model.pricing !== 'object' || Array.isArray(model.pricing)) fail(400, '模型计价格式无效');
      result.pricing = {};
      for (const field of ['inputPerMillionCents', 'outputPerMillionCents', 'perRequestCents']) {
        if (model.pricing[field] !== undefined) {
          const amount = model.pricing[field];
          if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount > 1e9) fail(400, '模型估算成本必须是有效非负数字');
          result.pricing[field] = amount;
        }
      }
    }
    const key = JSON.stringify([result.capability, result.id]);
    if (seen.has(key)) fail(400, '同一能力下的模型名称不能重复');
    seen.add(key);
    return result;
  });
}

function storedModels(value) {
  try { return models(JSON.parse(value)); }
  catch { fail(500, '渠道模型配置损坏，请联系管理员修复'); }
}

const DEFAULT_ENDPOINTS = { text: 'chat/completions', image: 'images/generations', video: 'videos', videoStatus: 'videos/{id}', videoContent: 'videos/{id}/content' };
function connectionOptions(input, previous = {}) {
  const protocol = input.protocol ?? previous.protocol ?? 'openai-compatible';
  if (!['openai-compatible', 'apimart'].includes(protocol)) fail(400, '请选择 OpenAI 兼容或 APIMart 协议');
  const sameProtocol = !previous.protocol || protocol === previous.protocol;
  const endpoints = { ...(protocol === 'apimart' ? APIMART_ENDPOINTS : DEFAULT_ENDPOINTS), ...(sameProtocol ? previous.endpoints : {}), ...input.endpoints };
  if (input.endpoints !== undefined && (!input.endpoints || typeof input.endpoints !== 'object' || Array.isArray(input.endpoints))) fail(400, '接口路径配置无效');
  for (const field of Object.keys(DEFAULT_ENDPOINTS)) {
    const path = endpoints[field];
    if (typeof path !== 'string' || path.length > 500 || !/^[a-zA-Z0-9][a-zA-Z0-9_\-/.{}]*$/u.test(path) || path.split('/').some(part => part === '.' || part === '..') || path.includes('//')) fail(400, '接口路径必须是相对路径且不能包含查询参数或上级目录');
    if (field.startsWith('video') && field !== 'video' && !path.includes('{id}')) fail(400, '视频查询和下载路径必须包含 {id}');
    if (/[{}]/u.test(path.replace('{id}', '')) || (!field.startsWith('video') && path.includes('{id}'))) fail(400, '接口路径占位符无效');
  }
  const videoRequestFormat = protocol === 'apimart' ? 'json' : input.videoRequestFormat ?? (sameProtocol ? previous.videoRequestFormat : undefined) ?? 'multipart';
  if (!['multipart', 'json'].includes(videoRequestFormat)) fail(400, '视频请求格式仅支持 multipart 或 json');
  const timeoutMs = input.timeoutMs ?? previous.timeoutMs ?? 120000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300000) fail(400, '请求超时必须在 1000 至 300000 毫秒之间');
  return { protocol, endpoints, videoRequestFormat, timeoutMs };
}

/**
 * API configuration only: saving or validating never contacts an upstream.
 * listChannels/saveChannel return safe records; encrypted keys never leave this module.
 * An omitted or blank apiKey on update preserves the stored key.
 */
export function createChannels(db, { secret } = {}) {
  if (typeof secret !== 'string' || secret.length < 16) fail(400, '渠道加密密钥至少需要16个字符');
  const encryptionKey = createHash('sha256').update(`api-channel-key-encryption:${secret}`).digest();
  db.exec(`CREATE TABLE IF NOT EXISTS api_channels (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    enabled INTEGER NOT NULL CHECK (enabled IN (0,1)),
    models_json TEXT NOT NULL,
    key_ciphertext TEXT NOT NULL,
    key_iv TEXT NOT NULL,
    key_tag TEXT NOT NULL,
    key_hint TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
  if (!db.prepare('PRAGMA table_info(api_channels)').all().some(column => column.name === 'options_json')) db.exec("ALTER TABLE api_channels ADD COLUMN options_json TEXT NOT NULL DEFAULT '{}' ");
  const budgets = createChannelBudgets(db);

  function options(row) {
    try { return connectionOptions(JSON.parse(row.options_json || '{}')); }
    catch { fail(500, '渠道协议配置损坏，请联系管理员修复'); }
  }

  function record(row) {
    return {
      id: row.id, name: row.name, baseUrl: row.base_url, enabled: row.enabled === 1,
      models: storedModels(row.models_json), hasKey: true, keyHint: row.key_hint,
      issuanceBudget: budgets.getBudget(row.id),
      ...options(row),
      createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }

  function encryptedKey(key, id) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
    cipher.setAAD(Buffer.from(`api-channel:${id}`));
    const ciphertext = Buffer.concat([cipher.update(key, 'utf8'), cipher.final()]);
    return {
      ciphertext: ciphertext.toString('base64'), iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'), hint: key.length >= 8 ? `••••${key.slice(-4)}` : '••••',
    };
  }

  function protectBoundModels(id, previousModels, configuredModels) {
    const retained = new Set(configuredModels.map(model => JSON.stringify([model.capability, model.id])));
    const removed = new Set(previousModels.map(model => JSON.stringify([model.capability, model.id])).filter(key => !retained.has(key)));
    if (!removed.size) return;
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='generation_jobs'").get()) {
      for (const row of db.prepare("SELECT capability,model FROM generation_jobs WHERE channel_id=? AND capability IN ('image','video') AND status IN ('running','uncertain','ready')").all(id)) {
        if (removed.has(JSON.stringify([row.capability, row.model]))) fail(409, '该模型仍有待结算生成任务，请先完成或人工核对任务');
      }
    }
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='service_platforms'").get()) {
      for (const row of db.prepare('SELECT bindings_json FROM service_platforms').all()) {
        let bindings;
        try { bindings = JSON.parse(row.bindings_json); } catch { fail(500, '平台路由配置损坏，请先修复'); }
        if (!Array.isArray(bindings)) fail(500, '平台路由配置损坏，请先修复');
        if (bindings.some(binding => binding.channelId === id && removed.has(JSON.stringify([binding.capability, binding.model])))) fail(409, '待移除的模型仍被业务平台使用，请先替换平台 API 绑定');
      }
    }
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='shop_products'").get()) return;
    for (const row of db.prepare('SELECT package_options FROM shop_products').all()) {
      if (row.package_options === null) continue; // Legacy products have no API bindings.
      let options;
      try { options = JSON.parse(row.package_options); }
      catch { fail(500, '商品 SKU 配置损坏，请先修复后再修改渠道模型'); }
      if (!Array.isArray(options)) fail(500, '商品 SKU 配置损坏，请先修复后再修改渠道模型');
      for (const option of options) {
        if (!option || typeof option !== 'object' || Array.isArray(option)) fail(500, '商品 SKU 配置损坏，请先修复后再修改渠道模型');
        if (option.apiBindings === undefined) continue;
        if (!Array.isArray(option.apiBindings)) fail(500, '商品 SKU 配置损坏，请先修复后再修改渠道模型');
        for (const binding of option.apiBindings) {
          if (!binding || typeof binding !== 'object' || Array.isArray(binding) || typeof binding.channelId !== 'string' || typeof binding.model !== 'string' || !CAPABILITIES.has(binding.capability)) {
            fail(500, '商品 SKU 配置损坏，请先修复后再修改渠道模型');
          }
          if (binding.channelId === id && removed.has(JSON.stringify([binding.capability, binding.model]))) {
            fail(409, '待移除的模型仍被商品 SKU 使用，请先在商品中解除或替换 API 绑定');
          }
        }
      }
    }
  }

  return {
    listChannels() {
      return db.prepare('SELECT * FROM api_channels ORDER BY created_at, id').all().map(record);
    },

    saveChannel(input = {}) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, '渠道配置格式无效');
      const id = identifier(input.id, '渠道标识');
      const name = text(input.name, '渠道名称', 160);
      const address = baseUrl(input.baseUrl);
      const enabled = input.enabled === undefined ? true : input.enabled;
      if (typeof enabled !== 'boolean') fail(400, '渠道启用状态必须是布尔值');
      const configuredModels = models(input.models);
      if (input.apiKey !== undefined && typeof input.apiKey !== 'string') fail(400, 'API 密钥格式无效');
      const suppliedKey = input.apiKey?.trim();
      if (suppliedKey && (suppliedKey.length > 4096 || /\s|[\u0000-\u001f\u007f]/u.test(suppliedKey))) fail(400, 'API 密钥格式无效或超过4096字符');
      db.exec('BEGIN IMMEDIATE');
      try {
        const previous = db.prepare('SELECT * FROM api_channels WHERE id=?').get(id);
        const configuredOptions = connectionOptions(input, previous ? options(previous) : {});
        if (previous && (address !== previous.base_url || configuredOptions.protocol !== options(previous).protocol || JSON.stringify(configuredOptions.endpoints) !== JSON.stringify(options(previous).endpoints)) &&
            db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='generation_jobs'").get() &&
            db.prepare("SELECT 1 FROM generation_jobs WHERE channel_id=? AND capability IN ('image','video') AND status IN ('running','uncertain','ready') LIMIT 1").get(id)) {
          fail(409, '渠道仍有待结算生成任务，请先完成任务再修改协议、接口地址或路径');
        }
        if (!previous && !suppliedKey) fail(400, '新建渠道时请填写 API 密钥');
        if (previous) protectBoundModels(id, storedModels(previous.models_json), configuredModels);
        const key = suppliedKey ? encryptedKey(suppliedKey, id) : {
          ciphertext: previous.key_ciphertext, iv: previous.key_iv, tag: previous.key_tag, hint: previous.key_hint,
        };
        const now = new Date().toISOString();
        db.prepare(`INSERT INTO api_channels
          (id,name,base_url,enabled,models_json,key_ciphertext,key_iv,key_tag,key_hint,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
          name=excluded.name, base_url=excluded.base_url, enabled=excluded.enabled,
          models_json=excluded.models_json, key_ciphertext=excluded.key_ciphertext,
          key_iv=excluded.key_iv, key_tag=excluded.key_tag, key_hint=excluded.key_hint,
          updated_at=excluded.updated_at`).run(id, name, address, enabled ? 1 : 0, JSON.stringify(configuredModels),
            key.ciphertext, key.iv, key.tag, key.hint, previous?.created_at ?? now, now);
        db.prepare('UPDATE api_channels SET options_json=? WHERE id=?').run(JSON.stringify(configuredOptions), id);
        const result = record(db.prepare('SELECT * FROM api_channels WHERE id=?').get(id));
        db.exec('COMMIT');
        return result;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },

    // Server-internal only. Never serialize this record into an HTTP response or log.
    getForExecution({ channelId, capability: type, model }) {
      const row = db.prepare('SELECT * FROM api_channels WHERE id=?').get(identifier(channelId, '渠道标识'));
      if (!row) fail(404, 'API 渠道不存在');
      if (row.enabled !== 1) fail(409, 'API 渠道已停用');
      const selectedModel = storedModels(row.models_json).find(entry => entry.capability === capability(type) && entry.id === model);
      if (!selectedModel) fail(409, '渠道模型不可用');
      try {
        const decipher = createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(row.key_iv, 'base64'));
        decipher.setAAD(Buffer.from(`api-channel:${row.id}`));
        decipher.setAuthTag(Buffer.from(row.key_tag, 'base64'));
        const apiKey = Buffer.concat([decipher.update(Buffer.from(row.key_ciphertext, 'base64')), decipher.final()]).toString('utf8');
        return { id: row.id, baseUrl: row.base_url, apiKey, model: selectedModel, ...options(row) };
      } catch { fail(500, '渠道密钥无法解密，请重新保存密钥'); }
    },

    validateBindings(bindings, capabilities, { allowDisabled = false } = {}) {
      if (!Array.isArray(capabilities) || capabilities.length > 3) fail(400, 'SKU 能力配置格式无效');
      const selected = new Set(capabilities.map(capability));
      if (selected.size !== capabilities.length) fail(400, 'SKU 能力不能重复');
      if (!Array.isArray(bindings) || bindings.length > 3) fail(400, '每个 SKU 最多绑定三种 API 能力');
      const seen = new Set();
      return bindings.map(binding => {
        if (!binding || typeof binding !== 'object' || Array.isArray(binding)) fail(400, 'API 绑定格式无效');
        const type = capability(binding.capability);
        if (!selected.has(type)) fail(400, 'API 绑定必须属于当前 SKU 已选择的能力');
        if (seen.has(type)) fail(400, '每种能力只能绑定一个渠道和模型');
        seen.add(type);
        const channelId = identifier(binding.channelId, '渠道标识');
        const model = text(binding.model, '绑定模型', 160);
        const row = db.prepare('SELECT * FROM api_channels WHERE id=?').get(channelId);
        if (!row) fail(404, '绑定的 API 渠道不存在');
        if (!allowDisabled && row.enabled !== 1) fail(409, '绑定的 API 渠道已停用');
        if (!storedModels(row.models_json).some(entry => entry.capability === type && entry.id === model)) fail(400, '所选渠道未配置该能力的模型');
        return { capability: type, channelId, model };
      });
    },
  };
}
