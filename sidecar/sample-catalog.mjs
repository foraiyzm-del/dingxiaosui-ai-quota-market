/** Replace only the original demonstration goods; keep IDs and historical orders. */
export function configureSampleCatalog(db, quota, commerce) {
  const migrationId = 'sample-service-skus-v1';
  db.exec('CREATE TABLE IF NOT EXISTS app_feature_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  if (db.prepare('SELECT id FROM app_feature_migrations WHERE id=?').get(migrationId)) return;
  const products = commerce.listProducts({ admin: true });
  const examples = [
    {
      id: 'writing-100', oldName: 'AI 写作次数包', projectId: 'assistant', name: 'AI 智能助手',
      description: '问答、文档解读与数据分析，选择具体服务规格后兑换使用。',
      units: 100, priceCents: 1990,
      packageOptions: [
        { id: 'standard', label: '通用问答', description: '日常咨询、知识问答与思路整理', projectId: 'assistant', units: 100, priceCents: 1990 },
        { id: 'document', label: '文档解读', description: '提炼资料要点、长文摘要与内容理解', projectId: 'documents', units: 50, priceCents: 1990 },
        { id: 'analysis', label: '数据分析', description: '表格分析、指标解读与结论整理', projectId: 'analysis', units: 20, priceCents: 2990 },
      ],
      customPricing: { enabled: true, minUnits: 1, maxUnits: 10000, unitPriceMicros: 199000 },
    },
    {
      id: 'report-10', oldName: '报告分析次数包', projectId: 'writing', name: 'AI 创作工具',
      description: '覆盖文案、图像和语音创作，按所选服务规格兑换使用。',
      units: 100, priceCents: 1990,
      packageOptions: [
        { id: 'standard', label: '文案创作', description: '文章、短视频脚本与营销文案', projectId: 'writing', units: 100, priceCents: 1990 },
        { id: 'images', label: '图片生成', description: '创意配图、海报与商品视觉素材', projectId: 'images', units: 50, priceCents: 2990 },
        { id: 'speech', label: '语音合成', description: '口播配音、有声内容与语音播报', projectId: 'speech', units: 100, priceCents: 2990 },
      ],
      customPricing: { enabled: true, minUnits: 1, maxUnits: 10000, unitPriceMicros: 199000 },
    },
  ];
  const names = { assistant: '通用问答', documents: '文档解读', analysis: '数据分析', writing: '文案创作', images: '图片生成', speech: '语音合成' };
  // This migration is for the complete demo catalog, not an operator's isolated product.
  if (!examples.every(example => products.some(p => p.id === example.id))) return;
  const projects = new Set(quota.listProjects().map(p => p.id));
  for (const example of examples) {
    const original = products.find(p => p.id === example.id);
    if (!original || original.name !== example.oldName) continue;
    for (const id of new Set([example.projectId, ...example.packageOptions.map(sku => sku.projectId)])) {
      if (!projects.has(id)) { quota.createProject({ id, name: names[id] }); projects.add(id); }
    }
    const { oldName, ...product } = example;
    commerce.saveProduct({ ...original, ...product });
  }
  db.prepare('INSERT INTO app_feature_migrations(id,applied_at) VALUES(?,?)').run(migrationId, new Date().toISOString());
}
