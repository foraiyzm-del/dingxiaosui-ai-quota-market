import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createInventory } from './inventory.mjs';
import { CAPABILITIES, normalizeQuota, quotaTotal, quotaKey, readQuota } from './quota-values.mjs';
import { mediaSpec } from './media-spec.mjs';

const MAX_UNITS = 1_000_000;
const MAX_PRICE_CENTS = 100_000_000;
const MAX_UNIT_PRICE_MICROS = 1_000_000_000_000;
const now = () => new Date().toISOString();
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };

function text(value, field, maximum = 200, { optional = false, multiline = false } = {}) {
  if (optional && (value === undefined || value === null)) return '';
  const forbidden = multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u : /[\u0000-\u001f\u007f]/u;
  if (typeof value !== 'string' || value.trim().length > maximum || forbidden.test(value) || (!optional && !value.trim())) {
    fail(400, `${field}格式无效或超过${maximum}字符`);
  }
  return value.trim();
}

function identifier(value, field) {
  const id = text(value, field, 64);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(id)) fail(400, `${field}只允许字母、数字、点、下划线和短横线`);
  return id;
}

function positiveInteger(value, field, maximum) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) fail(400, `${field}必须是1至${maximum}之间的整数`);
  return value;
}

function capabilities(value = []) {
  if (!Array.isArray(value) || value.length > 3 || value.some(item => !['text', 'image', 'video'].includes(item)) || new Set(value).size !== value.length) {
    fail(400, 'SKU能力仅支持文字、图片、视频，且不能重复');
  }
  return ['text', 'image', 'video'].filter(item => value.includes(item));
}

function apiBindings(value = [], selectedCapabilities = []) {
  if (!Array.isArray(value) || value.length > 3) fail(400, 'SKU渠道绑定格式无效');
  const used = new Set();
  return value.map(binding => {
    if (!binding || typeof binding !== 'object' || Array.isArray(binding) || !selectedCapabilities.includes(binding.capability) || used.has(binding.capability)) {
      fail(400, '渠道绑定必须对应已选择的SKU能力，每种能力只能绑定一次');
    }
    used.add(binding.capability);
    return { capability: binding.capability, channelId: identifier(binding.channelId, '渠道ID'), model: text(binding.model, '模型ID', 160) };
  });
}

function packageOptions(value, units, priceCents) {
  if (value === undefined) return [{ id: 'standard', label: '标准套餐', units, priceCents }];
  if (!Array.isArray(value) || value.length < 1 || value.length > 12) fail(400, '套餐选项需要1至12个');
  const used = new Set();
  return value.map((option) => {
    if (!option || typeof option !== 'object' || Array.isArray(option)) fail(400, '套餐选项格式无效');
    const id = identifier(option.id, '套餐ID');
    if (used.has(id)) fail(400, '套餐ID不能重复');
    used.add(id);
    const allocation = normalizeQuota(option.quota);
    const result = { id, label: text(option.label, '套餐名称', 80),
      units: allocation ? quotaTotal(allocation) : positiveInteger(option.units, '套餐次数', MAX_UNITS),
      priceCents: positiveInteger(option.priceCents, '套餐价格（分）', MAX_PRICE_CENTS) };
    if (allocation) result.quota = allocation;
    if (option.projectId !== undefined) result.projectId = identifier(option.projectId, 'SKU项目ID');
    if (option.description !== undefined) result.description = text(option.description, 'SKU说明', 500, { optional: true, multiline: true });
    const selectedCapabilities = allocation ? CAPABILITIES.filter(capability => allocation[capability] > 0) : capabilities(option.capabilities);
    if (option.capabilities !== undefined || allocation) result.capabilities = selectedCapabilities;
    if (option.apiBindings !== undefined) result.apiBindings = apiBindings(option.apiBindings, selectedCapabilities);
    return result;
  });
}

function customPricing(value, units, priceCents) {
  const defaults = { enabled: false, minUnits: 1, maxUnits: MAX_UNITS,
    unitPriceMicros: Math.max(1, Math.round(priceCents * 10000 / units)) };
  if (value === undefined) return defaults;
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, '自定义次数定价格式无效');
  const result = { ...defaults, ...value };
  if (typeof result.enabled !== 'boolean') fail(400, '自定义次数开关必须是布尔值');
  result.minUnits = positiveInteger(result.minUnits, '自定义最低次数', MAX_UNITS);
  result.maxUnits = positiveInteger(result.maxUnits, '自定义最高次数', MAX_UNITS);
  result.unitPriceMicros = positiveInteger(result.unitPriceMicros, '每次价格（微元）', MAX_UNIT_PRICE_MICROS);
  if (result.minUnits > result.maxUnits) fail(400, '自定义最低次数不能大于最高次数');
  return { enabled: result.enabled, minUnits: result.minUnits, maxUnits: result.maxUnits,
    unitPriceMicros: result.unitPriceMicros };
}

function readJson(value) {
  if (value === null || value === undefined) return undefined;
  try { return JSON.parse(value); } catch { fail(500, '商品套餐配置损坏，请联系管理员'); }
}

function quotaPricing(value) {
  if (value === undefined || value === null) return { enabled: false,
    unitPriceMicros: { text: 0, image: 0, video: 0 }, maxCounts: { text: MAX_UNITS, image: MAX_UNITS, video: MAX_UNITS } };
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.enabled !== 'boolean') fail(400, '组合次数定价格式无效');
  const result = { enabled: value.enabled, unitPriceMicros: {}, maxCounts: {} };
  for (const capability of CAPABILITIES) {
    const maximum = value.maxCounts?.[capability] ?? MAX_UNITS;
    if (!Number.isSafeInteger(maximum) || maximum < 0 || maximum > MAX_UNITS) fail(400, '组合次数上限必须为0至1000000之间的整数');
    const price = value.unitPriceMicros?.[capability] ?? 0;
    if (!Number.isSafeInteger(price) || price < 0 || price > MAX_UNIT_PRICE_MICROS || (value.enabled && maximum > 0 && price === 0)) fail(400, '请为开放的每种能力设置大于0的单次价格（微元）');
    result.unitPriceMicros[capability] = price;
    result.maxCounts[capability] = maximum;
  }
  if (value.enabled && !Object.values(result.maxCounts).some(count => count > 0)) fail(400, '组合商品至少开放一种能力');
  return result;
}

function fulfillment(value = 'stock') {
  if (!['stock', 'on_payment'].includes(value)) fail(400, '发卡方式必须为库存发卡或付款后生成');
  return value;
}

function quotaLabel(value) {
  return [['image', '图片'], ['text', '文案'], ['video', '视频']].filter(([key]) => value[key] > 0).map(([key, name]) => `${name} ${value[key]} 次`).join(' + ');
}

/**
 * One-process synchronous commerce ledger backed by the same DatabaseSync as quota.
 * Product = {id,projectId,name,description,units,priceCents,active,createdAt,updatedAt,
 *   packageOptions:[{id,label,units,priceCents,projectId?,description?,capabilities?,apiBindings?}],
 *   customPricing:{enabled,minUnits,maxUnits,unitPriceMicros}}.
 * One yuan = 1,000,000 micros; custom totals round UP to whole cents with BigInt.
 * Order = {id,orderNo,productId,projectId,productName,description,units,priceCents,email,
 *   status:'pending'|'submitted'|'approved'|'fulfilled',createdAt,submittedAt,approvedAt,
 *   fulfilledAt,reference,payer,paidAt,verifiedReference,note,fulfillmentError,codeSuffix,
 *   selectionType:'standard'|'package'|'custom',packageLabel,skuId:string|null,capabilities}.
 * API bindings are administrator-only product metadata. Orders snapshot them in
 * private columns; public product/order responses never reveal channel routing.
 * Missing quota vectors retain the legacy shared balance. A SKU quota vector
 * fixes independently usable text/image/video counts; units is its sum only.
 * Typed orders validate selected platform routes and snapshot their allocation.
 * createOrder accepts optional packageId OR customUnits OR customQuota. Omitting these preserves
 * the baseline package API. Price and granted units always come from stored rules.
 * createOrder returns {...Order,token}; getOrder/submitProof require that token and
 * add code only when fulfilled. approveOrder/listOrders never include code/token.
 * stats = {productCount,activeProductCount,orderCount,pendingOrderCount,
 *   submittedOrderCount,approvedOrderCount,fulfilledOrderCount,revenueCents}.
 * Email is contact/display data and is never an order access credential.
 *
 * Stock products reserve one matching encrypted inventory card. on_payment
 * products issue a new card from the immutable order vector only after verified
 * payment. Approval, issuance and delivery share a transaction; a retry returns
 * the original card and failure rolls back payment markers and card state.
 */
export function createCommerce(db, { quota, secret, channels, platforms } = {}) {
  if (!quota || typeof quota.generateCodes !== 'function' || typeof quota.listProjects !== 'function') fail(400, '缺少额度服务');
  if (typeof secret !== 'string' || secret.length < 16) fail(400, '商店密钥至少需要16个字符');
  const encryptionKey = createHash('sha256').update(`shop-code-encryption:${secret}`).digest();
  db.exec(`
    CREATE TABLE IF NOT EXISTS shop_products (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES quota_projects(id),
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      units INTEGER NOT NULL CHECK (units BETWEEN 1 AND ${MAX_UNITS}),
      price_cents INTEGER NOT NULL CHECK (price_cents BETWEEN 1 AND ${MAX_PRICE_CENTS}),
      active INTEGER NOT NULL CHECK (active IN (0,1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS shop_orders (
      id TEXT PRIMARY KEY,
      order_no TEXT UNIQUE NOT NULL,
      product_id TEXT NOT NULL REFERENCES shop_products(id),
      project_id TEXT NOT NULL REFERENCES quota_projects(id),
      product_name TEXT NOT NULL,
      description TEXT NOT NULL,
      units INTEGER NOT NULL CHECK (units BETWEEN 1 AND ${MAX_UNITS}),
      price_cents INTEGER NOT NULL CHECK (price_cents BETWEEN 1 AND ${MAX_PRICE_CENTS}),
      email TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending','submitted','approved','fulfilled')),
      created_at TEXT NOT NULL,
      submitted_at TEXT,
      approved_at TEXT,
      fulfilled_at TEXT,
      reference TEXT,
      payer TEXT,
      paid_at TEXT,
      verified_reference TEXT UNIQUE,
      note TEXT,
      fulfillment_error TEXT,
      code_ciphertext TEXT,
      code_iv TEXT,
      code_tag TEXT,
      code_suffix TEXT,
      CHECK (status <> 'fulfilled' OR (code_ciphertext IS NOT NULL AND code_iv IS NOT NULL
        AND code_tag IS NOT NULL AND fulfilled_at IS NOT NULL AND verified_reference IS NOT NULL))
    );
    CREATE INDEX IF NOT EXISTS shop_orders_created ON shop_orders(created_at);
    CREATE INDEX IF NOT EXISTS shop_orders_product ON shop_orders(product_id);
  `);
  // Upgrade old databases in place; order prices, balances and codes stay intact.
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const [table, columns] of [
      ['shop_products', [['package_options', 'TEXT'], ['custom_pricing', 'TEXT'], ['quota_pricing', 'TEXT'], ['fulfillment', "TEXT NOT NULL DEFAULT 'stock'"], ['media_spec_json', 'TEXT']]],
      ['shop_orders', [['selection_type', "TEXT NOT NULL DEFAULT 'standard'"], ['package_label', "TEXT NOT NULL DEFAULT '标准套餐'"], ['sku_id', 'TEXT'], ['capabilities', "TEXT NOT NULL DEFAULT '[]'"], ['api_bindings', "TEXT NOT NULL DEFAULT '[]'"], ['inventory_id', 'TEXT'], ['expires_at', 'TEXT'], ['closed_at', 'TEXT'], ['closed_reason', 'TEXT'], ['quota_json', 'TEXT'], ['fulfillment', "TEXT NOT NULL DEFAULT 'stock'"]]],
    ]) {
      const existing = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name));
      for (const [name, type] of columns) if (!existing.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  const inventory = createInventory(db, { quota, secret });

  function transaction(work) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  const tokenFor = (id) => createHmac('sha256', secret).update(`shop-order:${id}`).digest('hex');
  function checkToken(id, token) {
    const expected = Buffer.from(tokenFor(id));
    const supplied = Buffer.from(typeof token === 'string' ? token : '');
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) fail(403, '订单访问凭证无效');
  }

  function productRecord(row, { admin = true } = {}) {
    return {
      id: row.id, projectId: row.project_id, name: row.name, description: row.description,
      units: row.units, priceCents: row.price_cents, active: row.active === 1,
      createdAt: row.created_at, updatedAt: row.updated_at,
      fulfillment: fulfillment(row.fulfillment), quotaPricing: quotaPricing(readJson(row.quota_pricing)),
      mediaSpec: mediaSpec(readJson(row.media_spec_json)),
      packageOptions: packageOptions(readJson(row.package_options), row.units, row.price_cents).map(option => {
        const stockAvailable = inventory.available({ productId: row.id, projectId: option.projectId ?? row.project_id, skuId: option.id, units: option.units, quota: option.quota });
        if (admin === true) return { ...option, stockAvailable };
        const { apiBindings: privateBindings, ...publicOption } = option;
        return { ...publicOption, stockAvailable };
      }),
      customPricing: customPricing(readJson(row.custom_pricing), row.units, row.price_cents),
      customStock: inventory.customStock({ productId: row.id, projectId: row.project_id }),
    };
  }

  function orderRecord(row) {
    return {
      id: row.id, orderNo: row.order_no, productId: row.product_id, projectId: row.project_id,
      productName: row.product_name, description: row.description, units: row.units,
      priceCents: row.price_cents, email: row.email, status: row.closed_at ? row.closed_reason : row.status,
      createdAt: row.created_at, submittedAt: row.submitted_at, approvedAt: row.approved_at,
      fulfilledAt: row.fulfilled_at, reference: row.reference, payer: row.payer, paidAt: row.paid_at,
      verifiedReference: row.verified_reference, note: row.note,
      fulfillmentError: row.fulfillment_error, codeSuffix: row.code_suffix,
      selectionType: row.selection_type, packageLabel: row.package_label, skuId: row.sku_id,
      capabilities: capabilities(readJson(row.capabilities)),
      quota: readQuota(row.quota_json), fulfillment: fulfillment(row.fulfillment),
      expiresAt: row.expires_at, closedAt: row.closed_at, closedReason: row.closed_reason, inventoryId: row.inventory_id,
    };
  }

  function requireOrder(id) {
    const row = db.prepare('SELECT * FROM shop_orders WHERE id = ?').get(id);
    if (!row) fail(404, '订单不存在');
    return row;
  }

  function validateRouting(option, { allowDisabled = false } = {}) {
    const selectedCapabilities = capabilities(option?.capabilities);
    const bindings = apiBindings(option?.apiBindings, selectedCapabilities);
    if (bindings.length) {
      if (!channels || typeof channels.validateBindings !== 'function') fail(409, 'API渠道管理尚未配置');
      channels.validateBindings(bindings, selectedCapabilities, { allowDisabled });
    }
    return { capabilities: selectedCapabilities, apiBindings: bindings };
  }

  function allocationRouting(projectId, allocation, legacyOption) {
    const selected = CAPABILITIES.filter(capability => allocation[capability] > 0);
    if (platforms) {
      const platform = platforms.getPlatform(projectId);
      if (!platform.enabled) fail(409, '该平台已停用');
      const bindings = platform.bindings.filter(binding => selected.includes(binding.capability));
      if (selected.some(capability => !bindings.some(binding => binding.capability === capability))) fail(409, '此平台尚未配置所选能力的 API 渠道');
      return { capabilities: selected, apiBindings: channels.validateBindings(bindings, selected) };
    }
    // The ledger module also works standalone in older integrations. Its
    // optional legacy SKU routing still validates only the purchased abilities.
    return validateRouting({ capabilities: selected,
      apiBindings: (legacyOption?.apiBindings ?? []).filter(binding => selected.includes(binding.capability)) });
  }

  function encryptCode(code, id, projectId) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
    cipher.setAAD(Buffer.from(`${id}:${projectId}`));
    const ciphertext = Buffer.concat([cipher.update(code, 'utf8'), cipher.final()]);
    return { ciphertext: ciphertext.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
  }

  function decryptCode(row) {
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(row.code_iv, 'base64'));
    decipher.setAAD(Buffer.from(`${row.id}:${row.project_id}`));
    decipher.setAuthTag(Buffer.from(row.code_tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(row.code_ciphertext, 'base64')), decipher.final()]).toString('utf8');
  }

  function getOrder({ id, token } = {}) {
    id = identifier(id, '订单ID');
    checkToken(id, token);
    expireOrders();
    const row = requireOrder(id);
    const result = orderRecord(row);
    if (row.status === 'fulfilled') result.code = decryptCode(row);
    return result;
  }

  function expireOrders() {
    return transaction(() => {
      const timestamp = now();
      const expired = db.prepare("SELECT id FROM shop_orders WHERE status IN ('pending','submitted') AND closed_at IS NULL AND expires_at IS NOT NULL AND expires_at<=?").all(timestamp);
      for (const order of expired) {
        inventory.release({ orderId: order.id });
        db.prepare("UPDATE shop_orders SET closed_at=?,closed_reason='expired',inventory_id=NULL WHERE id=?").run(timestamp, order.id);
      }
      return { expiredCount: expired.length };
    });
  }

  return {
    listProducts({ admin = false } = {}) {
      expireOrders();
      const rows = db.prepare(`SELECT * FROM shop_products ${admin === true ? '' : 'WHERE active = 1'} ORDER BY created_at, id`).all();
      return rows.map(row => productRecord(row, { admin }));
    },

    saveProduct({ id, projectId, name, description = '', units, priceCents, active = true,
      packageOptions: requestedOptions, customPricing: requestedCustomPricing,
      quotaPricing: requestedQuotaPricing, fulfillment: requestedFulfillment, mediaSpec: requestedMediaSpec } = {}) {
      id = identifier(id, '商品ID');
      projectId = identifier(projectId, '项目ID');
      name = text(name, '商品名称', 160);
      description = text(description, '商品描述', 4000, { optional: true, multiline: true });
      units = requestedOptions?.[0]?.quota ? quotaTotal(normalizeQuota(requestedOptions[0].quota)) : positiveInteger(units, '使用次数', MAX_UNITS);
      priceCents = positiveInteger(priceCents, '价格（分）', MAX_PRICE_CENTS);
      if (typeof active !== 'boolean') fail(400, '上架状态必须是布尔值');
      return transaction(() => {
        const projectIds = new Set(quota.listProjects().map(project => project.id));
        if (!projectIds.has(projectId)) fail(404, '商品关联项目不存在');
        const old = db.prepare('SELECT * FROM shop_products WHERE id=?').get(id);
        let options = requestedOptions;
        if (options === undefined && old) {
          options = productRecord(old).packageOptions.map(option => option.id === 'standard'
            ? { ...option, units, priceCents } : option);
        } else if (Array.isArray(options) && old) {
          const priorOptions = productRecord(old).packageOptions;
          options = options.map(option => {
            if (!option || typeof option !== 'object' || Array.isArray(option)) return option;
            const prior = priorOptions.find(item => item.id === option.id);
            if (!prior) return option;
            return { ...option,
              ...(option.projectId === undefined && prior.projectId !== undefined ? { projectId: prior.projectId } : {}),
              ...(option.description === undefined && prior.description !== undefined ? { description: prior.description } : {}),
              ...(option.capabilities === undefined && prior.capabilities !== undefined ? { capabilities: prior.capabilities } : {}),
              ...(option.quota === undefined && prior.quota !== undefined ? { quota: prior.quota } : {}),
              ...(option.apiBindings === undefined && prior.apiBindings !== undefined ? { apiBindings: prior.apiBindings } : {}) };
          });
        }
        options = packageOptions(options, units, priceCents);
        if (options[0].quota) units = options[0].units;
        if (options.some(option => option.projectId !== undefined && !projectIds.has(option.projectId))) fail(404, 'SKU关联项目不存在');
        if (options.some(option => option.projectId !== undefined && option.projectId !== projectId)) fail(400, '同一商品的套餐必须属于同一个平台，请将其他平台单独建立商品');
        for (const option of options) validateRouting(option, { allowDisabled: true });
        const pricing = customPricing(requestedCustomPricing === undefined && old
          ? readJson(old.custom_pricing) : requestedCustomPricing, units, priceCents);
        const allocationPricing = quotaPricing(requestedQuotaPricing === undefined && old ? readJson(old.quota_pricing) : requestedQuotaPricing);
        const spec = mediaSpec(requestedMediaSpec === undefined && old ? readJson(old.media_spec_json) : requestedMediaSpec);
        const delivery = fulfillment(requestedFulfillment ?? old?.fulfillment ?? 'stock');
        if (allocationPricing.enabled && delivery !== 'on_payment') fail(400, '自定义组合请使用付款后自动生成卡密');
        const timestamp = now();
        db.prepare(`INSERT INTO shop_products (id,project_id,name,description,units,price_cents,active,created_at,updated_at,package_options,custom_pricing,quota_pricing,fulfillment,media_spec_json)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id,
          name=excluded.name,description=excluded.description,units=excluded.units,price_cents=excluded.price_cents,
          active=excluded.active,updated_at=excluded.updated_at,package_options=excluded.package_options,custom_pricing=excluded.custom_pricing,
          quota_pricing=excluded.quota_pricing,fulfillment=excluded.fulfillment,media_spec_json=excluded.media_spec_json`)
          .run(id, projectId, name, description, units, priceCents, active ? 1 : 0, timestamp, timestamp,
            JSON.stringify(options), JSON.stringify(pricing), JSON.stringify(allocationPricing), delivery, spec ? JSON.stringify(spec) : null);
        return productRecord(db.prepare('SELECT * FROM shop_products WHERE id=?').get(id));
      });
    },

    createOrder({ productId, email, packageId, customUnits, customQuota } = {}) {
      productId = identifier(productId, '商品ID');
      email = text(email, '邮箱', 254);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) fail(400, '邮箱格式无效');
      if ([packageId, customUnits, customQuota].filter(value => value !== undefined).length > 1) fail(400, '套餐、自定义次数和自定义组合不能同时选择');
      expireOrders();
      return transaction(() => {
        const product = db.prepare('SELECT * FROM shop_products WHERE id=?').get(productId);
        if (!product) fail(404, '商品不存在');
        if (product.active !== 1) fail(409, '商品暂未上架');
        const settings = productRecord(product);
        let units = product.units, priceCents = product.price_cents;
        let orderProjectId = product.project_id, orderDescription = product.description;
        let selectionType = 'standard', packageLabel = '标准套餐', skuId = null;
        let allocation = null;
        const sameProject = option => (option.projectId ?? product.project_id) === product.project_id;
        let routingOption = settings.packageOptions.find(option => option.id === 'standard' && sameProject(option))
          ?? settings.packageOptions.find(sameProject);
        if (routingOption?.quota) { units = routingOption.units; priceCents = routingOption.priceCents; }
        if (routingOption && routingOption.units === units && routingOption.priceCents === priceCents) {
          skuId = routingOption.id; packageLabel = routingOption.label;
          allocation = routingOption.quota ?? null;
        }
        if (packageId !== undefined) {
          const selectedId = identifier(packageId, '套餐ID');
          const option = settings.packageOptions.find(item => item.id === selectedId);
          if (!option) fail(400, '所选套餐不存在');
          units = option.units; priceCents = option.priceCents;
          selectionType = 'package'; packageLabel = option.label;
          orderProjectId = option.projectId ?? product.project_id;
          orderDescription = option.description ?? product.description;
          skuId = option.id;
          routingOption = option;
          allocation = option.quota ?? null;
        } else if (customUnits !== undefined) {
          if (settings.packageOptions.some(option => option.quota)) fail(400, '此商品按能力分别计次，请选择次数组合');
          const pricing = settings.customPricing;
          if (!pricing.enabled) fail(400, '此商品未开放自定义次数');
          units = positiveInteger(customUnits, '自定义次数', MAX_UNITS);
          if (units < pricing.minUnits || units > pricing.maxUnits) fail(400, `自定义次数应为${pricing.minUnits}至${pricing.maxUnits}次`);
          const cents = (BigInt(units) * BigInt(pricing.unitPriceMicros) + 9999n) / 10000n;
          if (cents < 1n || cents > BigInt(MAX_PRICE_CENTS)) fail(400, '自定义次数总价超出支持范围');
          priceCents = Number(cents);
          selectionType = 'custom'; packageLabel = `自定义 ${units} 次`;
          skuId = null;
          allocation = null;
        } else if (customQuota !== undefined) {
          allocation = normalizeQuota(customQuota);
          if (!allocation) fail(400, '请设置要购买的分项次数');
          if (!settings.quotaPricing.enabled || settings.fulfillment !== 'on_payment') fail(400, '此商品未开放自定义组合');
          for (const capability of CAPABILITIES) if (allocation[capability] > settings.quotaPricing.maxCounts[capability]) fail(400, '选择的分项次数超过此商品上限');
          units = quotaTotal(allocation);
          const micros = CAPABILITIES.reduce((total, capability) => total + BigInt(allocation[capability]) * BigInt(settings.quotaPricing.unitPriceMicros[capability]), 0n);
          const cents = (micros + 9999n) / 10000n;
          if (cents < 1n || cents > BigInt(MAX_PRICE_CENTS)) fail(400, '组合次数总价超出支持范围');
          priceCents = Number(cents);
          selectionType = 'custom'; packageLabel = quotaLabel(allocation); skuId = null;
        }
        const routing = allocation ? allocationRouting(orderProjectId, allocation, routingOption) : validateRouting(routingOption);
        const id = randomBytes(16).toString('hex');
        const timestamp = now();
        const orderNo = `AI${timestamp.slice(0, 10).replaceAll('-', '')}${randomBytes(6).toString('hex').toUpperCase()}`;
        db.prepare(`INSERT INTO shop_orders
          (id,order_no,product_id,project_id,product_name,description,units,price_cents,email,status,created_at,selection_type,package_label,sku_id,capabilities,api_bindings,quota_json,fulfillment)
          VALUES (?,?,?,?,?,?,?,?,?,'pending',?,?,?,?,?,?,?,?)`).run(id, orderNo, productId, orderProjectId,
          product.name, orderDescription, units, priceCents, email, timestamp, selectionType, packageLabel, skuId,
          JSON.stringify(routing.capabilities), JSON.stringify(routing.apiBindings), allocation ? quotaKey(allocation) : null, settings.fulfillment);
        const reserved = settings.fulfillment === 'stock' ? inventory.reserve({ productId, projectId: orderProjectId, skuId, units, orderId: id, quota: allocation }) : null;
        db.prepare('UPDATE shop_orders SET inventory_id=?,expires_at=? WHERE id=?')
          .run(reserved?.id ?? null, new Date(Date.parse(timestamp) + 30 * 60 * 1000).toISOString(), id);
        return { ...orderRecord(requireOrder(id)), token: tokenFor(id) };
      });
    },

    getOrder,

    submitProof({ id, token, reference, payer, paidAt } = {}) {
      id = identifier(id, '订单ID');
      checkToken(id, token);
      reference = text(reference, '付款交易单号', 120);
      payer = text(payer, '付款人', 80, { optional: true });
      paidAt = text(paidAt, '付款时间', 60);
      if (!Number.isFinite(Date.parse(paidAt))) fail(400, '付款时间格式无效');
      expireOrders();
      transaction(() => {
        const row = requireOrder(id);
        if (row.closed_at) fail(409, '订单已关闭，请联系管理员核实到账情况');
        if (row.status === 'approved' || row.status === 'fulfilled') return;
        const submittedAt = row.submitted_at ?? now();
        db.prepare("UPDATE shop_orders SET status='submitted',reference=?,payer=?,paid_at=?,submitted_at=?,expires_at=? WHERE id=?")
          .run(reference, payer, paidAt, submittedAt, new Date(Date.parse(submittedAt) + 24 * 60 * 60 * 1000).toISOString(), id);
      });
      return getOrder({ id, token });
    },

    approveOrder({ id, verifiedReference, confirmed, note, recovery = false } = {}) {
      id = identifier(id, '订单ID');
      if (confirmed !== true) fail(400, '请先核对实际到账并明确确认');
      verifiedReference = text(verifiedReference, '核验交易单号', 120);
      note = text(note, '核验备注', 1000, { optional: true, multiline: true });
      if (typeof recovery !== 'boolean') fail(400, '异常订单恢复标志必须是布尔值');
      expireOrders();
      return transaction(() => {
        const row = requireOrder(id);
        if (row.closed_at && !recovery) fail(409, '订单已关闭，如已核实到账请使用异常订单恢复发货');
        if (row.verified_reference && row.verified_reference !== verifiedReference) fail(409, '此订单已有不同的核验交易记录');
        if (db.prepare('SELECT id FROM shop_orders WHERE verified_reference=? AND id<>?').get(verifiedReference, id)) {
          fail(409, '此实际交易单号已核验其他订单');
        }
        if (row.status === 'fulfilled') return orderRecord(row);
        let skuId = row.sku_id;
        // Orders created before inventory had no standard SKU snapshot. Match a
        // current SKU only when its immutable units and platform still agree.
        if (!skuId && row.selection_type === 'standard') {
          const product = db.prepare('SELECT * FROM shop_products WHERE id=?').get(row.product_id);
          const options = packageOptions(readJson(product.package_options), product.units, product.price_cents);
          skuId = (options.find(item => item.id === 'standard' && item.units === row.units && (item.projectId ?? product.project_id) === row.project_id)
            ?? options.find(item => item.units === row.units && (item.projectId ?? product.project_id) === row.project_id))?.id ?? null;
        }
        const allocation = readQuota(row.quota_json);
        let generatedBatchId;
        if (row.fulfillment === 'on_payment' && !db.prepare('SELECT id FROM shop_inventory WHERE order_id=?').get(id)) {
          const soldSpec = mediaSpec(readJson(db.prepare('SELECT media_spec_json FROM shop_products WHERE id=?').get(row.product_id)?.media_spec_json));
          generatedBatchId = inventory.generate({ productId: row.product_id, projectId: row.project_id, skuId, productName: row.product_name,
            packageLabel: row.package_label, units: row.units, quantity: 1, quota: allocation, mediaSpec: soldSpec }).batchId;
        }
        const reserved = inventory.reserve({ productId: row.product_id, projectId: row.project_id, skuId, units: row.units, orderId: id, quota: allocation, batchId: generatedBatchId });
        const { code } = inventory.fulfill({ orderId: id });
        const encrypted = encryptCode(code, row.id, row.project_id);
        const timestamp = now();
        const result = db.prepare(`UPDATE shop_orders SET status='fulfilled',code_ciphertext=?,code_iv=?,code_tag=?,
          code_suffix=?,fulfilled_at=?,fulfillment_error=NULL,verified_reference=?,note=?,approved_at=COALESCE(approved_at,?),
          inventory_id=?,closed_at=NULL,closed_reason=NULL WHERE id=? AND status<>'fulfilled'`)
          .run(encrypted.ciphertext, encrypted.iv, encrypted.tag, code.slice(-4), timestamp,
            verifiedReference, note, timestamp, reserved.id, id);
        if (result.changes !== 1) fail(409, '订单发卡状态已变化，请刷新查看');
        return orderRecord(requireOrder(id));
      });
    },

    cancelOrder({ id, token } = {}) {
      id = identifier(id, '订单ID');
      checkToken(id, token);
      expireOrders();
      return transaction(() => {
        const row = requireOrder(id);
        if (row.closed_at) return orderRecord(row);
        if (row.status !== 'pending') fail(409, '已提交付款凭证或已付款的订单不能自行取消');
        inventory.release({ orderId: id });
        db.prepare("UPDATE shop_orders SET closed_at=?,closed_reason='cancelled',inventory_id=NULL WHERE id=?").run(now(), id);
        return orderRecord(requireOrder(id));
      });
    },

    expireOrders,

    generateInventory({ productId, packageId, units, quantity } = {}) {
      productId = identifier(productId, '商品ID');
      quantity = positiveInteger(quantity, '制卡张数', 1000);
      if (packageId !== undefined && units !== undefined) fail(400, '固定套餐与自定义每卡次数不能同时指定');
      return transaction(() => {
        const row = db.prepare('SELECT * FROM shop_products WHERE id=?').get(productId);
        if (!row) fail(404, '商品不存在');
        const product = productRecord(row);
        let skuId, label, projectId = row.project_id, allocation = null;
        if (units !== undefined) {
          units = positiveInteger(units, '每卡次数', MAX_UNITS);
          const pricing = product.customPricing;
          if (!pricing.enabled || units < pricing.minUnits || units > pricing.maxUnits) fail(400, '自定义库存次数不在商品开放的范围内');
          skuId = null; label = `自定义 ${units} 次`;
        } else {
          const selected = packageId === undefined
            ? product.packageOptions.find(option => option.id === 'standard') ?? product.packageOptions[0]
            : product.packageOptions.find(option => option.id === identifier(packageId, '套餐ID'));
          if (!selected) fail(400, '所选套餐不存在');
          skuId = selected.id; units = selected.units; label = selected.label;
          allocation = selected.quota ?? null;
          projectId = selected.projectId ?? row.project_id;
        }
        return inventory.generate({ productId, projectId, skuId, productName: product.name, packageLabel: label, units, quantity, quota: allocation, mediaSpec: product.mediaSpec });
      });
    },

    listInventory() { expireOrders(); return inventory.list(); },
    listBatches() { expireOrders(); return inventory.listBatches(); },
    exportBatch({ batchId } = {}) { return inventory.exportBatch({ batchId: identifier(batchId, '批次ID') }); },

    listOrders() {
      expireOrders();
      return db.prepare('SELECT * FROM shop_orders ORDER BY created_at DESC, id').all().map(orderRecord);
    },

    stats() {
      expireOrders();
      return { ...inventory.stats(), ...db.prepare(`SELECT
        (SELECT COUNT(*) FROM shop_products) AS productCount,
        (SELECT COUNT(*) FROM shop_products WHERE active=1) AS activeProductCount,
        (SELECT COUNT(*) FROM shop_orders) AS orderCount,
        (SELECT COUNT(*) FROM shop_orders WHERE status='pending' AND closed_at IS NULL) AS pendingOrderCount,
        (SELECT COUNT(*) FROM shop_orders WHERE status='submitted' AND closed_at IS NULL) AS submittedOrderCount,
        (SELECT COUNT(*) FROM shop_orders WHERE closed_at IS NOT NULL) AS closedOrderCount,
        (SELECT COUNT(*) FROM shop_orders WHERE status='approved') AS approvedOrderCount,
        (SELECT COUNT(*) FROM shop_orders WHERE status='fulfilled') AS fulfilledOrderCount,
        (SELECT COALESCE(SUM(price_cents),0) FROM shop_orders WHERE status IN ('approved','fulfilled')) AS revenueCents`).get() };
    },
  };
}
