// Start both local services using the existing center credential. No provider
// keys are copied, no card is issued, and startup never submits model requests.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { root, setup } from './setup.mjs';
import { bootstrapDingxiaosui } from './bootstrap-dingxiaosui.mjs';

const ding = path.resolve(process.env.DINGXIAOSUI_DIR || path.join(root, 'apps', 'dingxiaosui'));
if (!fs.existsSync(path.join(ding, '.next', 'standalone', 'server.js'))) throw new Error('请先进入 apps/dingxiaosui 安装依赖并运行 npm run build');
const config = await setup();
const base = `http://127.0.0.1:${config.port}`;
const owned = new Set();
function start(args, cwd, env = process.env) {
  const child = spawn(process.execPath, args, { cwd, env, stdio: 'inherit', windowsHide: true });
  owned.add(child); child.on('exit', (code, signal) => { owned.delete(child); if (code) console.error(`服务进程退出（${path.basename(args[0])}，退出码 ${code}${signal ? '，信号 ' + signal : ''}）`); }); child.on('error', error => console.error(error.message)); return child;
}
async function health(url) { try { const response = await fetch(url, { signal: AbortSignal.timeout(2000) }); return response.ok; } catch { return false; } }
function stop() { for (const child of owned) child.kill(); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
if (!await health(base + '/api/health')) {
  const center = start(['scripts/start.mjs'], root);
  let ready = false;
  for (let n = 0; n < 80; n++) { if (center.exitCode !== null) throw new Error('发卡网启动失败'); if (await health(base + '/api/health')) { ready = true; break; } await new Promise(resolve => setTimeout(resolve, 250)); }
  if (!ready) { stop(); throw new Error('发卡网启动超时'); }
}
const port = 8845;
let credential;
try { credential = await bootstrapDingxiaosui({ baseUrl: base, adminPassword: config.adminPassword, workbenchUrl: `http://127.0.0.1:${port}/workbench.html` }); }
catch (error) { stop(); throw error; }
if (await health(`http://127.0.0.1:${port}/api/event/session`)) {
  console.log('丁小穗已运行：http://127.0.0.1:8845/workbench.html');
} else {
  const preview = start(['scripts/start-event-preview.mjs', '--port', String(port)], ding, {
    ...process.env, QUOTA_CENTER_URL: base, QUOTA_PLATFORM_KEY: credential.apiKey,
    SHOP_PRODUCT_URL: base + '/?service=dingxiaosui-creator',
  });
  let ready = false;
  for (let attempt = 0; attempt < 200; attempt++) {
    if (preview.exitCode !== null) { stop(); throw new Error(`丁小穗启动失败（退出码 ${preview.exitCode}），请检查上方启动信息`); }
    if (await health(`http://127.0.0.1:${port}/api/event/session`)) { ready = true; break; }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!ready) { stop(); throw new Error('丁小穗启动超时，请检查本地服务日志'); }
}
console.log('发卡网：' + base + '/?service=dingxiaosui-creator');
console.log('丁小穗：http://127.0.0.1:8845/workbench.html');
console.log('仅本机运行；关闭此启动进程前请等待正在生成的任务完成。');
console.log('首次初始化的丁小穗商品为草稿。请到发卡网后台配置 API 渠道、平台模型、价格与收款方式，再上架。');
