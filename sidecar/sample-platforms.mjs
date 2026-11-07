import { createHash } from 'node:crypto';

const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const same = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));
const businessProjects = [
  { id: 'dingxiaosui', name: '丁小穗', description: '文案、图片与视频创作。' },
  { id: 'second-project', name: '一二大模型', description: '项目入口已保留，业务应用待接入；暂不开放购买。' },
  { id: 'jiuqing', name: '酒擎', description: '项目入口已保留，业务应用待接入；暂不开放购买。' },
  { id: 'hongfan-party', name: '红帆党建', description: '项目入口已保留，业务应用待接入；暂不开放购买。' },
];
const formerSamples = [
  { oldId: 'writing-100', id: 'marketing-copy', name: '营销文案平台', description: '营销文案、活动方案与内容策划。购买次数包后，在本平台兑换使用。', prices: [390, 1490, 2490] },
  { oldId: 'report-10', id: 'packaging-design', name: '包装设计平台', description: '产品包装创意、商品视觉与设计图生成。次数仅在包装设计平台使用。', prices: [1990, 8990, 15990] },
];
// Original sample-catalog + sample-generation fixtures, before platform migration.
const legacyHashes = {
  'writing-100': '1ac37099f7e454a593d732a65db3b15a98a00052cd88c7eba1801145e03b20a3',
  'report-10': '1f8ac5ed30cb4c62abdff56daa294402bcb49504144ac7d2360448531c035084',
};
const defaultQuotaPricing = { enabled: false, unitPriceMicros: { text: 0, image: 0, video: 0 },
  maxCounts: { text: 1000000, image: 1000000, video: 1000000 } };
function fixtureFields(product) {
  const fields = Object.fromEntries(['projectId', 'name', 'description', 'units', 'priceCents', 'active', 'customPricing'].map(key => [key, product[key]]));
  fields.packageOptions = product.packageOptions.map(({ stockAvailable, ...sku }) => sku);
  return fields;
}
function unchangedProduct(product, sample) {
  if (!product || product.fulfillment !== 'stock' || product.mediaSpec || !same(product.quotaPricing, defaultQuotaPricing)) return false;
  const fields = fixtureFields(product);
  if (product.id === sample.oldId && createHash('sha256').update(JSON.stringify(stable(fields))).digest('hex') === legacyHashes[product.id]) return true;
  if (![sample.id, sample.oldId].includes(product.id)) return false;
  return same(fields, { projectId: sample.id, name: sample.name, description: sample.description,
    units: 10, priceCents: sample.prices[0], active: true,
    customPricing: { enabled: true, minUnits: 1, maxUnits: 10000, unitPriceMicros: sample.prices[0] * 1000 },
    packageOptions: [10, 50, 100].map((units, index) => ({ id: index === 0 ? 'standard' : `uses-${units}`,
      label: `${units} 次套餐`, units, priceCents: sample.prices[index], projectId: sample.id, capabilities: [], apiBindings: [] })) });
}
const quoted = value => `"${value.replaceAll('"', '""')}"`;
function referenced(db, column, value) {
  // Inspect all existing tables, including newer ledgers. Catalog rows are
  // checked separately so any business reference prevents fixture removal.
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  for (const { name } of tables) {
    if (['shop_products', 'service_platforms'].includes(name)) continue;
    if (!db.prepare(`PRAGMA table_info(${quoted(name)})`).all().some(field => field.name === column)) continue;
    if (db.prepare(`SELECT 1 FROM ${quoted(name)} WHERE ${quoted(column)}=? LIMIT 1`).get(value)) return true;
  }
  if (column === 'project_id' && tables.some(table => table.name === 'opcpay_intents')) {
    for (const row of db.prepare('SELECT snapshot_json FROM opcpay_intents').all()) {
      try { if (JSON.parse(row.snapshot_json)?.projectId === value) return true; }
      catch { return true; }
    }
  }
  return false;
}
function unusedSamplePlatform(db, sample, goods, platforms) {
  const platform = platforms.find(item => item.id === sample.id);
  if (!platform || platform.name !== sample.name || platform.description !== sample.description || platform.url
    || !platform.enabled || platform.unitsPerUse !== 1 || platform.bindings.length) return false;
  const products = goods.filter(product => product.projectId === sample.id);
  if (!products.length || !products.every(product => unchangedProduct(product, sample))) return false;
  if (goods.some(product => product.projectId !== sample.id && product.packageOptions.some(sku => sku.projectId === sample.id))) return false;
  return !referenced(db, 'project_id', sample.id) && products.every(product => !referenced(db, 'product_id', product.id));
}

/** Replace only verified unused demo entries. Real or edited catalogs retain
 * every product and ledger reference; this migration never creates paid goods. */
export function configurePlatformCatalog(db, quota, commerce, platforms) {
  db.exec('CREATE TABLE IF NOT EXISTS app_feature_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const migrationId = 'four-project-storefront-v1';
  if (db.prepare('SELECT id FROM app_feature_migrations WHERE id=?').get(migrationId)) return;
  const goods = commerce.listProducts({ admin: true }), existing = platforms.listPlatforms();
  const known = new Set([...businessProjects, ...formerSamples].map(item => item.id));
  const hadFormerCatalog = !!db.prepare("SELECT id FROM app_feature_migrations WHERE id='platform-business-catalog'").get();
  const onlyOriginalGoods = goods.length > 0 && goods.every(product => formerSamples.some(sample => unchangedProduct(product, sample)));
  const addBusinessEntries = (!goods.length && !existing.length) || onlyOriginalGoods
    || (hadFormerCatalog && existing.length > 0 && existing.every(platform => known.has(platform.id)));

  db.exec('BEGIN IMMEDIATE');
  try {
    for (const sample of formerSamples) {
      if (unusedSamplePlatform(db, sample, goods, existing)) {
        db.prepare('DELETE FROM shop_products WHERE project_id=?').run(sample.id);
        db.prepare('DELETE FROM service_platforms WHERE id=?').run(sample.id);
        db.prepare('DELETE FROM quota_projects WHERE id=?').run(sample.id);
      }
      // Legacy SKUs could span generic quota projects; never remove those
      // shared projects when retiring an exact unused original product.
      const legacy = goods.find(product => product.id === sample.oldId && product.projectId !== sample.id);
      if (legacy && unchangedProduct(legacy, sample) && !referenced(db, 'product_id', legacy.id)
        && !referenced(db, 'project_id', legacy.projectId)) db.prepare('DELETE FROM shop_products WHERE id=?').run(legacy.id);
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }

  if (addBusinessEntries) {
    const configured = new Set(platforms.listPlatforms().map(platform => platform.id));
    for (const project of businessProjects) if (!configured.has(project.id)) {
      platforms.savePlatform({ ...project, enabled: true, url: '', unitsPerUse: 1, bindings: [] });
    }
  }
  db.prepare('INSERT INTO app_feature_migrations(id,applied_at) VALUES(?,?)').run(migrationId, new Date().toISOString());
}
