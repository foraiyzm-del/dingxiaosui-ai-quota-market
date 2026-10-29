/** Extend only unchanged sample products once; preserve the operator's own pricing. */
export function configureSamplePackages(db, commerce) {
  db.exec('CREATE TABLE IF NOT EXISTS app_feature_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const migrationId = 'sample-custom-packages-v1';
  if (db.prepare('SELECT id FROM app_feature_migrations WHERE id=?').get(migrationId)) return;
  const samples = [
    {
      id: 'writing-100', units: 100, priceCents: 1990,
      description: '适用于写作类智能体与网站，按需要选择次数包或自定义使用次数。',
      packageOptions: [
        { id: 'small', label: '轻量包', units: 10, priceCents: 199 },
        { id: 'standard', label: '标准包', units: 100, priceCents: 1990 },
        { id: 'large', label: '大份包', units: 500, priceCents: 9950 },
      ],
      customPricing: { enabled: true, minUnits: 1, maxUnits: 10000, unitPriceMicros: 199000 },
    },
    {
      id: 'report-10', units: 10, priceCents: 2990,
      description: '适用于报告分析类智能体与网站，按需要选择次数包或自定义使用次数。',
      packageOptions: [
        { id: 'standard', label: '标准包', units: 10, priceCents: 2990 },
        { id: 'medium', label: '进阶包', units: 50, priceCents: 14950 },
        { id: 'large', label: '大份包', units: 100, priceCents: 29900 },
      ],
      customPricing: { enabled: true, minUnits: 1, maxUnits: 1000, unitPriceMicros: 2990000 },
    },
  ];
  const products = commerce.listProducts({ admin: true });
  for (const sample of samples) {
    const product = products.find(p => p.id === sample.id);
    const untouchedOption = !product?.packageOptions || (product.packageOptions.length === 1 && product.packageOptions[0].id === 'standard' && product.packageOptions[0].units === sample.units && product.packageOptions[0].priceCents === sample.priceCents);
    if (product && product.units === sample.units && product.priceCents === sample.priceCents && untouchedOption && !product.customPricing?.enabled) {
      commerce.saveProduct({ ...product, ...sample });
    }
  }
  db.prepare('INSERT INTO app_feature_migrations(id,applied_at) VALUES(?,?)').run(migrationId, new Date().toISOString());
}
