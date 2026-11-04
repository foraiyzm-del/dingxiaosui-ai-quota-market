import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createChannels } from '../sidecar/channels.mjs';
import { leaderQuote } from '../sidecar/leader-batch.mjs';

const centerUrl = (process.env.CENTER_URL || 'http://127.0.0.1:3199').replace(/\/$/, '');
const dingUrl = (process.env.DING_URL || 'http://127.0.0.1:8845').replace(/\/$/, '');
const dbPath = path.resolve(process.env.CENTER_DB || 'local/center.sqlite');
const configPath = path.resolve(process.env.CENTER_CONFIG || 'local/config.json');
const lines = [];
const problems = [];
const note = (label, ok, detail) => {
  lines.push(`${ok ? '正常' : '异常'}  ${label}：${detail}`);
  if (!ok) problems.push(label);
};

async function ping(url) {
  const started = Date.now();
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = null; }
  return { status: response.status, body, ms: Date.now() - started };
}

try {
  const center = await ping(`${centerUrl}/api/health`);
  note('发卡中心', center.status === 200 && center.body?.service === 'quota-center', center.status === 200 ? `在线，响应 ${center.ms} 毫秒` : `HTTP ${center.status}`);
} catch (error) { note('发卡中心', false, error.name === 'TimeoutError' ? '连接超时' : '连不上'); }

try {
  const ding = await ping(`${dingUrl}/api/health`);
  const linked = ding.body?.quotaCenter === 'ok';
  note('丁小穗', ding.status === 200 && ding.body?.service === 'dingxiaosui', ding.status === 200 ? `在线，响应 ${ding.ms} 毫秒` : `HTTP ${ding.status}`);
  note('丁小穗连接发卡中心', linked, ding.body?.quotaCenter === 'unconfigured' ? '还没配置发卡中心地址或凭证' : linked ? '已连通' : '发卡中心没有应答');
} catch (error) { note('丁小穗', false, error.name === 'TimeoutError' ? '连接超时' : '连不上'); }

let db;
try {
  db = new DatabaseSync(dbPath, { readOnly: true });
  db.exec('PRAGMA busy_timeout=5000;');
  const hourAgo = new Date(Date.now() - 3600000).toISOString();
  const failed = db.prepare("SELECT COUNT(*) AS n FROM generation_jobs WHERE status='failed' AND updated_at>=?").get(hourAgo).n;
  const uncertain = db.prepare("SELECT COUNT(*) AS n FROM generation_jobs WHERE status='uncertain' AND updated_at>=?").get(hourAgo).n;
  note('近一小时失败任务', failed === 0, `${failed} 笔失败，${uncertain} 笔结果待核对`);
  const names = { text: '文案', image: '图片', video: '视频' };
  const channels = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='api_channels'").get()
    ? db.prepare('SELECT id,name FROM api_channels').all() : [];
  if (!channels.length) note('渠道预算', false, '还没有 API 渠道');
  const hasBudget = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='channel_issuance_budgets'").get();
  for (const channel of channels) {
    const rows = hasBudget ? db.prepare('SELECT capability,total,allocated FROM channel_issuance_budgets WHERE channel_id=?').all(channel.id) : [];
    if (!rows.length) { lines.push(`提示  渠道「${channel.name}」未设置发码额度，发码不受次数上限约束。`); continue; }
    const text = rows.map(row => `${names[row.capability] || row.capability}剩 ${row.total - row.allocated}`).join('，');
    const empty = rows.some(row => row.total - row.allocated <= 0);
    note(`渠道「${channel.name}」剩余额度`, !empty, text);
  }
  const quote = leaderQuote(120);
  lines.push(`提示  120 张领导体验卡满用约需文案 ${quote.counts.text}、图片 ${quote.counts.image}、视频 ${quote.counts.video} 次，上游大约 ¥${quote.cny}。`);
} catch (error) { note('本地数据库', false, error.code === 'ENOENT' ? '找不到数据库文件' : '暂时读不了数据库'); }

try {
  const { readFile } = await import('node:fs/promises');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const writable = new DatabaseSync(dbPath);
  try {
    writable.exec('PRAGMA busy_timeout=5000;');
    const channels = createChannels(writable, { secret: config.merchantKey });
    const apimart = channels.listChannels().filter(channel => channel.protocol === 'apimart' && channel.enabled);
    if (!apimart.length) note('APIMart 密钥', false, '没有启用的 APIMart 渠道');
    for (const channel of apimart) {
      const secret = channels.getForExecution({ channelId: channel.id, capability: channel.models[0].capability, model: channel.models[0].id }).apiKey;
      const response = await fetch(`${channel.baseUrl.replace(/\/$/, '')}/balance`, { headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(8000) });
      const payload = await response.json().catch(() => ({}));
      const valid = response.ok && payload.success !== false && !payload.error;
      const balance = payload.unlimited_quota ? '不限额度' : payload.remain_balance != null ? `剩余 ${payload.remain_balance}（积分 ${payload.remain_credits ?? '未知'}）` : '接口没有返回余额';
      note(`APIMart「${channel.name}」`, valid, valid ? balance : `密钥或余额接口不可用（HTTP ${response.status}）`);
    }
  } finally { writable.close(); }
} catch (error) { note('APIMart 密钥', false, error.code === 'ENOENT' ? '找不到本机配置，跳过余额检查' : '余额检查没有完成'); }
finally { db?.close(); }

console.log(lines.join('\n'));
console.log(problems.length ? `\n有 ${problems.length} 项需要处理。` : '\n检查通过。');
process.exitCode = problems.length ? 1 : 0;
