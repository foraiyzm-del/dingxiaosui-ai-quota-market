import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createQuota } from '../sidecar/quota.mjs';
import { createChannels } from '../sidecar/channels.mjs';
import { createPlatforms } from '../sidecar/platforms.mjs';
import { createCommerce } from '../sidecar/commerce.mjs';
import { createChannelBudgets } from '../sidecar/channel-budgets.mjs';
import { createSiteSettings } from '../sidecar/site-settings.mjs';
import { issueLeaderBatch, leaderQuote } from '../sidecar/leader-batch.mjs';
import { root, loadConfig } from './setup.mjs';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const token = process.argv[index];
  if (!token.startsWith('--')) continue;
  const key = token.slice(2);
  const next = process.argv[index + 1];
  if (next && !next.startsWith('--')) { args.set(key, next); index += 1; }
  else args.set(key, 'true');
}
if (args.has('help')) {
  console.log(`用法：node scripts/issue-leader-cards.mjs [--quantity 120] [--days 90] [--origin https://丁小穗域名] [--top-up] [--force]

默认 120 张（100 张发放 + 20 张备用），每张 10 次文案、15 张图、2 条视频，90 天有效。
高配模型只写在这批卡上，不会改已有商品。激活码写入 local/leader-cards/，不要提交到 Git。`);
  process.exit(0);
}

const quantity = args.has('quantity') ? Number(args.get('quantity')) : 120;
const validDays = args.has('days') ? Number(args.get('days')) : 90;
const preview = leaderQuote(quantity);
console.log(`领导体验卡 ${quantity} 张，每张文案 ${preview.quota.text} 次、图片 ${preview.quota.image} 张、视频 ${preview.quota.video} 条，有效期 ${validDays} 天。`);
console.log(`按新模型单价估算满用上游费用约 $${preview.usd}（约 ¥${preview.cny}，汇率 ${preview.assumptions.fx} 仅供备款）。`);
console.log(`渠道次数至少要留：文案 ${preview.counts.text}、图片 ${preview.counts.image}、视频 ${preview.counts.video}。`);

const config = await loadConfig();
const db = new DatabaseSync(path.join(root, 'local/center.sqlite'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=15000;');
try {
  const quota = createQuota(db);
  const channels = createChannels(db, { secret: config.merchantKey });
  const platforms = createPlatforms(db, { quota, channels });
  const commerce = createCommerce(db, { quota, channels, platforms, secret: config.merchantKey });
  const budgets = createChannelBudgets(db);
  const siteSettings = createSiteSettings(db);
  const issued = issueLeaderBatch({ quota, channels, platforms, commerce, budgets, siteSettings, quantity, validDays, origin: args.get('origin') || '', topUp: args.get('top-up') === 'true', force: args.get('force') === 'true' });
  const folder = path.join(root, 'local/leader-cards');
  await mkdir(folder, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const csv = commerce.exportCsv({ batchId: issued.batch.batchId, origin: issued.origin });
  const csvPath = path.join(folder, `${stamp}-${csv.filename}`);
  await writeFile(csvPath, csv.body, { mode: 0o600 });
  let zipPath = '';
  if (issued.origin) {
    const zip = await commerce.exportQrZip({ batchId: issued.batch.batchId, origin: issued.origin });
    zipPath = path.join(folder, `${stamp}-${zip.filename}`);
    await writeFile(zipPath, zip.body, { mode: 0o600 });
  }
  console.log(`已生成批次 ${issued.batch.batchId}，共 ${issued.batch.quantity} 张。卡号和激活码在 CSV 里。`);
  console.log(`CSV：${csvPath}`);
  console.log(zipPath ? `二维码：${zipPath}` : '未填写 --origin，暂未导出二维码。配置丁小穗域名后可在后台再导出。');
  if (issued.addedModels.length) console.log(`已在原渠道补上模型：${issued.addedModels.join('、')}。平台默认绑定没有改。`);
  console.log('这些文件含激活码，只交给印刷和现场发放，不要发到群里或提交到 Git。');
} finally { db.close(); }
