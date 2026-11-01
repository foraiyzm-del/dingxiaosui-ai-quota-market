import { CAPABILITIES } from './quota-values.mjs';

const MAX_BUDGET = 1_000_000_000_000;
const names = { text: '文案', image: '图片', video: '视频' };
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };

// Manually registered issuance capacity, not the provider's money balance.
// Existing cards are not charged retroactively when a budget is first enabled.
export function createChannelBudgets(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS channel_issuance_budgets (
    channel_id TEXT NOT NULL REFERENCES api_channels(id),
    capability TEXT NOT NULL CHECK(capability IN ('text','image','video')),
    total INTEGER NOT NULL CHECK(total BETWEEN 0 AND ${MAX_BUDGET}),
    allocated INTEGER NOT NULL DEFAULT 0 CHECK(allocated >= 0 AND allocated <= total),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    PRIMARY KEY(channel_id,capability)
  )`);

  function getBudget(channelId) {
    const rows = db.prepare('SELECT * FROM channel_issuance_budgets WHERE channel_id=?').all(channelId);
    if (!rows.length) return null;
    const values = field => Object.fromEntries(CAPABILITIES.map(capability => {
      const row = rows.find(item => item.capability === capability);
      return [capability, field === 'remaining' ? row.total - row.allocated : row[field]];
    }));
    return { channelId, total: values('total'), allocated: values('allocated'), remaining: values('remaining'),
      createdAt: rows[0].created_at, updatedAt: rows[0].updated_at };
  }

  return {
    getBudget,
    saveBudget({ channelId, total } = {}) {
      if (typeof channelId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/u.test(channelId)) fail(400, '渠道标识无效');
      if (!total || typeof total !== 'object' || Array.isArray(total) ||
          Object.keys(total).some(key => !CAPABILITIES.includes(key)) ||
          CAPABILITIES.some(key => !Number.isSafeInteger(total[key]) || total[key] < 0 || total[key] > MAX_BUDGET)) {
        fail(400, '渠道总额度须填写文案、图片、视频三项非负整数，单项不超过 1000000000000');
      }
      db.exec('BEGIN IMMEDIATE');
      try {
        if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='api_channels'").get() ||
            !db.prepare('SELECT 1 FROM api_channels WHERE id=?').get(channelId)) fail(404, '渠道不存在');
        const previous = getBudget(channelId);
        for (const capability of CAPABILITIES) {
          if (total[capability] < (previous?.allocated[capability] ?? 0)) fail(409, `${names[capability]}总额度不能小于已发额度`);
        }
        const now = new Date().toISOString();
        for (const capability of CAPABILITIES) {
          db.prepare(`INSERT INTO channel_issuance_budgets(channel_id,capability,total,created_at,updated_at)
            VALUES(?,?,?,?,?) ON CONFLICT(channel_id,capability) DO UPDATE SET total=excluded.total,updated_at=excluded.updated_at`)
            .run(channelId, capability, total[capability], now, now);
        }
        const result = getBudget(channelId);
        db.exec('COMMIT');
        return result;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },

    // Called only by the common code issuer, inside its write transaction.
    // Resolve routing from persisted platform configuration, never caller input.
    allocateForProject({ projectId, quota, quantity }) {
      if (!db.isTransaction) fail(500, '发码额度扣减必须与制卡在同一事务内');
      if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='service_platforms'").get()) return;
      const platform = db.prepare('SELECT bindings_json FROM service_platforms WHERE id=?').get(projectId);
      if (!platform) return;
      let bindings;
      try { bindings = JSON.parse(platform.bindings_json); } catch { fail(500, '平台路由配置损坏'); }
      if (!Array.isArray(bindings)) fail(500, '平台路由配置损坏');
      const controlled = bindings.filter(binding => getBudget(binding.channelId));
      if (!controlled.length) return;
      if (!quota) fail(409, '该平台已设置渠道发码额度，请按文案、图片、视频分项制卡，不能签发共享次数');
      if (CAPABILITIES.some(capability => quota[capability] > 0 && !bindings.some(binding => binding.capability === capability))) {
        fail(409, '所选次数缺少平台渠道绑定，不能制卡');
      }
      for (const binding of controlled) {
        const amount = quota[binding.capability] * quantity;
        if (!amount) continue;
        const result = db.prepare(`UPDATE channel_issuance_budgets SET allocated=allocated+?,updated_at=?
          WHERE channel_id=? AND capability=? AND total-allocated>=?`)
          .run(amount, new Date().toISOString(), binding.channelId, binding.capability, amount);
        if (result.changes !== 1) fail(409, `渠道 ${binding.channelId} 的${names[binding.capability]}剩余发码额度不足，本批未生成，请补充总额度`);
      }
    },
  };
}
