const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const now = () => new Date().toISOString();
function text(value, field, maximum, optional = false) {
  if (optional && value === undefined) return '';
  if (typeof value !== 'string' || (!optional && !value.trim()) || value.trim().length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) fail(400, `${field}格式无效`);
  return value.trim();
}
function publicUrl(value) {
  const address = text(value, '平台网址', 2000, true);
  if (!address) return '';
  let url;
  try { url = new URL(address); } catch { fail(400, '平台网址必须是完整 HTTP/HTTPS 地址'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) fail(400, '平台网址格式无效');
  return url.toString();
}

/** A platform is an existing quota project, with its own server-side model routing. */
export function createPlatforms(db, { quota, channels }) {
  db.exec(`CREATE TABLE IF NOT EXISTS service_platforms (
    id TEXT PRIMARY KEY REFERENCES quota_projects(id),
    url TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
    units_per_use INTEGER NOT NULL DEFAULT 1 CHECK(units_per_use BETWEEN 1 AND 1000000),
    bindings_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`);

  function record(row, { public: isPublic = false } = {}) {
    let bindings;
    try { bindings = JSON.parse(row.bindings_json || '[]'); } catch { fail(500, '平台配置损坏，请联系管理员'); }
    const availableCapabilities = row.enabled === 0 ? [] : bindings.filter(binding => {
      try { channels.validateBindings([binding], [binding.capability]); return true; } catch { return false; }
    }).map(binding => binding.capability);
    const ready = bindings.length > 0 && availableCapabilities.length === bindings.length;
    return { id: row.id, name: row.name, url: row.url || '', description: row.description || '',
      enabled: row.enabled !== 0, unitsPerUse: row.units_per_use ?? 1,
      capabilities: bindings.map(binding => binding.capability), availableCapabilities, ready,
      readiness: row.enabled === 0 ? 'disabled' : !bindings.length ? 'unconfigured' : ready ? 'ready' : 'channel-unavailable',
      ...(!isPublic ? { bindings } : {}),
      createdAt: row.created_at, updatedAt: row.updated_at || row.created_at };
  }
  const query = `SELECT q.id,q.name,p.url,p.description,p.enabled,p.units_per_use,p.bindings_json,
    q.created_at,p.updated_at FROM quota_projects q JOIN service_platforms p ON p.id=q.id`;
  function getPlatform(id, options) {
    const row = db.prepare(`${query} WHERE q.id=?`).get(id);
    if (!row) fail(404, '业务平台不存在');
    return record(row, options);
  }
  return {
    getPlatform,
    listPlatforms(options = {}) {
      return db.prepare(`${query} ORDER BY q.created_at,q.id`).all().map(row => record(row, options));
    },
    savePlatform(input = {}) {
      const id = text(input.id, '平台标识', 64);
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(id)) fail(400, '平台标识只允许字母、数字、点、下划线和短横线');
      const previous = db.prepare(`${query} WHERE q.id=?`).get(id);
      const existingProject = db.prepare('SELECT * FROM quota_projects WHERE id=?').get(id);
      const name = text(input.name ?? previous?.name ?? existingProject?.name, '平台名称', 160);
      const url = publicUrl(input.url ?? previous?.url ?? '');
      const description = text(input.description ?? previous?.description ?? '', '平台说明', 2000, true);
      const enabled = input.enabled ?? (previous?.enabled !== 0);
      if (typeof enabled !== 'boolean') fail(400, '平台启用状态必须是布尔值');
      const unitsPerUse = input.unitsPerUse ?? previous?.units_per_use ?? 1;
      if (!Number.isSafeInteger(unitsPerUse) || unitsPerUse < 1 || unitsPerUse > 1000000) fail(400, '每次服务扣除次数必须为 1 至 1000000 之间的整数');
      let bindings = input.bindings;
      if (bindings === undefined) {
        try { bindings = JSON.parse(previous?.bindings_json || '[]'); } catch { fail(500, '平台路由配置损坏'); }
      }
      if (!Array.isArray(bindings)) fail(400, '平台 API 绑定格式无效');
      bindings = channels.validateBindings(bindings, bindings.map(binding => binding?.capability), { allowDisabled: true });
      db.exec('BEGIN IMMEDIATE');
      try {
        if (!existingProject) quota.createProject({ id, name });
        const timestamp = now();
        db.prepare('UPDATE quota_projects SET name=? WHERE id=?').run(name, id);
        db.prepare(`INSERT INTO service_platforms(id,url,description,enabled,units_per_use,bindings_json,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET url=excluded.url,description=excluded.description,
          enabled=excluded.enabled,units_per_use=excluded.units_per_use,bindings_json=excluded.bindings_json,updated_at=excluded.updated_at`)
          .run(id, url, description, enabled ? 1 : 0, unitsPerUse, JSON.stringify(bindings), previous?.created_at ?? timestamp, timestamp);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return getPlatform(id);
    },
  };
}
