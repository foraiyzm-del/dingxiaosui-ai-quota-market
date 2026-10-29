import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createQuota } from '../sidecar/quota.mjs';

export const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const rand = () => randomBytes(32).toString('hex');

export async function loadConfig() {
  return JSON.parse(await readFile(path.join(root, 'local/config.json'), 'utf8'));
}

export async function setup() {
  await mkdir(path.join(root, 'local'), { recursive: true });
  let config, isNew = false;
  try { config = await loadConfig(); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    config = {};
    isNew = true;
  }
  if (!config || Array.isArray(config) || typeof config !== 'object') {
    throw new Error('本机配置格式无效，请检查 local/config.json。');
  }
  const defaults = {
    host: () => '127.0.0.1', port: () => 3199, gatewayPort: () => 3000,
    merchantId: () => '10001', merchantKey: rand,
    adminPassword: () => randomBytes(15).toString('base64url'),
  };
  let configChanged = isNew;
  for (const [key, makeValue] of Object.entries(defaults)) {
    if (config[key] === undefined) { config[key] = makeValue(); configChanged = true; }
  }
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    throw new Error('本机配置中的 port 必须是 1–65535 的整数。');
  }
  if (typeof config.adminPassword !== 'string' || !config.adminPassword
      || typeof config.merchantKey !== 'string' || !config.merchantKey) {
    throw new Error('本机管理员或商户凭证为空，请检查私有配置；初始化不会覆盖现有凭证。');
  }
  if (configChanged) await writeFile(path.join(root, 'local/config.json'), JSON.stringify(config, null, 2), {
    ...(isNew ? { flag: 'wx' } : {}), mode: 0o600,
  });

  const db = new DatabaseSync(path.join(root, 'local/center.sqlite'));
  try {
    db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
    const quota = createQuota(db);
    const knownProjects = new Set(quota.listProjects().map(project => project.id));
    for (const [id, name] of [['writing', 'AI 写作'], ['report', 'AI 报告'], ['demo', '额度体验']]) {
      if (!knownProjects.has(id)) quota.createProject({ id, name });
    }
  } finally { db.close(); }

  const baseURL = `http://127.0.0.1:${config.port}`;
  await writeFile(path.join(root, 'local/ACCESS.md'), `# 本机访问\n\n仅本机预览，尚未上线。请勿公开、截图分享或提交此文件。\n\n- 商城：${baseURL}/\n- 管理后台：${baseURL}/admin\n- 兑换体验：${baseURL}/demo\n\n管理后台密码：${config.adminPassword}\n\n项目接入凭证位于 local/project-keys.json，仅给你自己的网站后端使用；首次启动服务时生成。\n\n初始化不配置真实上游密钥、不签发卡密、不模拟收款。\n`, { mode: 0o600 });
  return config;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await setup();
  console.log('本机配置已准备；访问资料保存在 local/ACCESS.md。');
}
