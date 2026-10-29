/** Upgrade the untouched sample catalog only; historical order snapshots stay intact. */
export function configureGenerationCatalog(db, quota, commerce) {
  const migrationId = 'sample-generation-capabilities-v1';
  db.exec('CREATE TABLE IF NOT EXISTS app_feature_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  if (db.prepare('SELECT id FROM app_feature_migrations WHERE id=?').get(migrationId)) return;
  const products = commerce.listProducts({ admin: true });
  const assistant = products.find(p => p.id === 'writing-100' && p.name === 'AI 智能助手');
  const creator = products.find(p => p.id === 'report-10' && p.name === 'AI 创作工具');
  const untouched = product => product && product.packageOptions.every(sku => !sku.capabilities?.length && !sku.apiBindings?.length);
  if (untouched(assistant) && assistant.packageOptions.map(s => s.label).join('|') === '通用问答|文档解读|数据分析') {
    commerce.saveProduct({ ...assistant, packageOptions: assistant.packageOptions.map(sku => ({ ...sku, capabilities: ['text'], apiBindings: [] })) });
  }
  if (untouched(creator) && creator.packageOptions.map(s => s.label).join('|') === '文案创作|图片生成|语音合成') {
    const projects = new Set(quota.listProjects().map(p => p.id));
    for (const [id, name] of [['video', '视频生成'], ['generation', '文字图片视频组合']]) {
      if (!projects.has(id)) quota.createProject({ id, name });
    }
    const [writing, images, previousSpeech] = creator.packageOptions;
    commerce.saveProduct({ ...creator, description: '文字、图片、视频生成及其组合，按所选规格兑换使用。', packageOptions: [
      { ...writing, label: '文字生成', capabilities: ['text'], apiBindings: [] },
      { ...images, capabilities: ['image'], apiBindings: [] },
      { ...previousSpeech, id: 'videos', label: '视频生成', projectId: 'video', description: '短片创作、产品展示与视频素材生成', capabilities: ['video'], apiBindings: [] },
      { id: 'all-generation', label: '文字 + 图片 + 视频', projectId: 'generation', description: '三种生成能力组合，共享套餐次数', units: creator.units, priceCents: creator.priceCents, capabilities: ['text', 'image', 'video'], apiBindings: [] },
    ] });
  }
  db.prepare('INSERT INTO app_feature_migrations(id,applied_at) VALUES(?,?)').run(migrationId, new Date().toISOString());
}
