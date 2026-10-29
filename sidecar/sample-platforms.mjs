import { createHash } from 'node:crypto';
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
// Exact original fixtures from sample-catalog + sample-generation, including prices,
// descriptions, all SKU fields and custom pricing. Any operator edit opts out.
const fixtureHashes = {
  'writing-100': '1ac37099f7e454a593d732a65db3b15a98a00052cd88c7eba1801145e03b20a3',
  'report-10': '1f8ac5ed30cb4c62abdff56daa294402bcb49504144ac7d2360448531c035084',
};
function fixtureHash(product) {
  const fields = Object.fromEntries(['projectId', 'name', 'description', 'units', 'priceCents', 'active', 'customPricing'].map(key => [key, product[key]]));
  fields.packageOptions = product.packageOptions.map(({ stockAvailable, ...sku }) => sku);
  return createHash('sha256').update(JSON.stringify(stable(fields))).digest('hex');
}
/** Only migrate identified, unconfigured sample goods. Existing orders keep snapshots. */
export function configurePlatformCatalog(db, quota, commerce, platforms) {
  db.exec('CREATE TABLE IF NOT EXISTS app_feature_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const migrationId = 'platform-business-catalog';
  if (db.prepare('SELECT id FROM app_feature_migrations WHERE id=?').get(migrationId)) return;
  const goods = commerce.listProducts({ admin: true });
  const examples = [
    { oldId: 'writing-100', id: 'marketing-copy', name: '营销文案平台', description: '营销文案、活动方案与内容策划。购买次数包后，在本平台兑换使用。', oldNames: ['AI 写作次数包', 'AI 智能助手'], prices: [390, 1490, 2490] },
    { oldId: 'report-10', id: 'packaging-design', name: '包装设计平台', description: '产品包装创意、商品视觉与设计图生成。次数仅在包装设计平台使用。', oldNames: ['报告分析次数包', 'AI 创作工具'], prices: [1990, 8990, 15990] },
  ];
  for (const example of examples) {
    const old = goods.find(g => g.id === example.oldId);
    const untouched = old && fixtureHash(old) === fixtureHashes[old.id]
      && !db.prepare('SELECT 1 FROM shop_orders WHERE product_id=? AND status IN (\'approved\',\'fulfilled\')').get(old.id)
      && !db.prepare('SELECT 1 FROM shop_inventory WHERE product_id=?').get(old.id);
    if (goods.length && !untouched) continue;
    if (db.prepare('SELECT 1 FROM service_platforms WHERE id=?').get(example.id)) continue;
    if (!quota.listProjects().some(p => p.id === example.id)) quota.createProject({ id: example.id, name: example.name });
    platforms.savePlatform({ id: example.id, name: example.name, description: example.description, enabled: true, unitsPerUse: 1, bindings: [] });
    commerce.saveProduct({ id: old?.id ?? example.id, projectId: example.id, name: example.name,
      description: example.description, units: 10, priceCents: example.prices[0], active: true,
      packageOptions: [10, 50, 100].map((units, i) => ({ id: i === 0 ? 'standard' : `uses-${units}`, label: `${units} 次套餐`, units, priceCents: example.prices[i], projectId: example.id, capabilities: [], apiBindings: [] })),
      customPricing: { enabled: true, minUnits: 1, maxUnits: 10000, unitPriceMicros: example.prices[0] * 1000 } });
  }
  db.prepare('INSERT INTO app_feature_migrations(id,applied_at) VALUES(?,?)').run(migrationId, new Date().toISOString());
}
