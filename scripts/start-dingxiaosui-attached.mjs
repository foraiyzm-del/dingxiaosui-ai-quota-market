// Starts the existing local Dingxiaosui application against the independent
// centre. It never initialises, imports or writes a centre database.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const readJSON = (file, label) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { throw new Error(`${label}不存在或格式无效；不会创建新凭证或数据库`); }
};
const fileExists = file => { try { return fs.statSync(file).isFile(); } catch { return false; } };
const credential = value => typeof value === 'string' && value.length >= 16;

export function assertRuntimeNotMigrated(folder) {
  if (fs.existsSync(path.join(folder, 'MIGRATED.json'))) {
    throw new Error('真实付款联调已迁至独立商城，旧中心禁止再次启动；请在独立商城执行 npm start，丁小穗使用 scripts/start-dingxiaosui-attached.mjs');
  }
}

export function loadAttachedConfiguration({ root = repositoryRoot } = {}) {
  const folder = path.join(path.resolve(root), 'local/opcpay-live-test');
  const settings = readJSON(path.join(folder, 'attached-center.json'), '独立中心连接配置');
  let url;
  try { url = new URL(settings.centerUrl); } catch { throw new Error('中心地址无效'); }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password
    || url.pathname !== '/' || url.search || url.hash || !url.port) throw new Error('中心地址必须是本机独立商城的完整 HTTP 端口地址');
  if (!Number.isInteger(settings.dingPort) || settings.dingPort < 1 || settings.dingPort > 65535 || Number(url.port) === settings.dingPort) {
    throw new Error('丁小穗端口无效或与中心冲突');
  }
  if (typeof settings.centerRoot !== 'string' || !path.isAbsolute(settings.centerRoot)) throw new Error('独立中心目录必须是绝对路径');
  const centerRoot = path.resolve(settings.centerRoot);
  if (centerRoot === path.resolve(root) || centerRoot === folder || centerRoot === path.join(folder, 'center')) throw new Error('中心目录必须指向迁移后的独立商城');
  const centerConfig = readJSON(path.join(centerRoot, 'local/config.json'), '独立中心私有配置');
  if (centerConfig.port !== Number(url.port)) throw new Error('中心地址端口与独立商城配置不一致');
  const keys = readJSON(path.join(centerRoot, 'local/project-keys.json'), '独立中心项目凭证');
  const previous = readJSON(path.join(folder, 'config.json'), '原丁小穗加密配置');
  if (!credential(previous.dingKey) || !credential(keys.dingxiaosui)) throw new Error('原丁小穗加密密钥或独立中心项目凭证缺失');
  const dataDir = path.join(folder, 'ding-data');
  if (!fileExists(path.join(dataDir, 'zdx.sqlite'))) throw new Error('原丁小穗数据不存在；拒绝初始化空账户库');
  const validBuildId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/u.test(value);
  let buildId = settings.buildId;
  if (buildId === undefined) {
    let candidates;
    try { candidates = fs.readdirSync(path.join(folder, 'apps'), { withFileTypes: true }).filter(entry => entry.isDirectory()
      && validBuildId(entry.name) && fileExists(path.join(folder, 'apps', entry.name, 'ready.json'))).map(entry => entry.name); }
    catch { throw new Error('原丁小穗应用快照不存在'); }
    if (candidates.length !== 1) throw new Error('原丁小穗应用快照不唯一；请在连接配置中明确 buildId');
    [buildId] = candidates;
  }
  if (!validBuildId(buildId)) throw new Error('丁小穗快照标识无效');
  const appDir = path.join(folder, 'apps', buildId);
  const ready = readJSON(path.join(appDir, 'ready.json'), '原丁小穗应用快照');
  if (ready.buildId !== buildId || !fileExists(path.join(appDir, 'server.js'))) throw new Error('原丁小穗应用快照不完整');
  return { folder, centerRoot, centerUrl: url.origin, dingPort: settings.dingPort,
    origin: `http://127.0.0.1:${settings.dingPort}`, dataDir, appDir, buildId,
    dingKey: previous.dingKey, platformKey: keys.dingxiaosui };
}

export function attachedEnvironment(settings, inherited = process.env) {
  const env = { ...inherited, ZDX_DATA_DIR: settings.dataDir, AI_CONFIG_ENCRYPTION_KEY: settings.dingKey,
    APP_ENV: 'production', APP_ORIGIN: settings.origin, PASSWORD_AUTH_ENABLED: '1', EVENT_ACTIVATION_ENABLED: '1',
    ZLG_GATEWAY_REQUIRED: '0', MEDIA_BACKGROUND_ENABLED: '1', QUOTA_CENTER_URL: settings.centerUrl,
    QUOTA_PLATFORM_KEY: settings.platformKey, SHOP_PRODUCT_URL: settings.centerUrl + '/?project=dingxiaosui',
    NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', PORT: String(settings.dingPort), HOSTNAME: '127.0.0.1' };
  for (const key of Object.keys(env)) if (/^(OPENAI_|APIMART_|ARK_|DASHSCOPE_|DEEPSEEK_|LOCAL_|PLATFORM_ADMIN_)/u.test(key)
    || key === 'NODE_OPTIONS') delete env[key];
  return env;
}

export function networkBoundarySource(centerUrl) {
  return `const original=globalThis.fetch;globalThis.fetch=(url,init)=>{const address=url instanceof Request?url.url:String(url);if(new URL(address).origin!==${JSON.stringify(centerUrl)})throw Error('External network blocked in attached Dingxiaosui');return original(url,{...init,redirect:'error'})};`;
}

async function assertUnusedPort(port) {
  const probe = net.createServer();
  try { await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', resolve); }); }
  catch { throw new Error(`丁小穗端口 ${port} 已占用；未连接或停止已有服务`); }
  finally { if (probe.listening) await new Promise(resolve => probe.close(resolve)); }
}

export async function startAttachedDingxiaosui({ root = repositoryRoot } = {}) {
  const settings = loadAttachedConfiguration({ root });
  await assertUnusedPort(settings.dingPort);
  let info;
  try {
    const response = await fetch(settings.centerUrl + '/api/opcpay/info', { redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error();
    info = await response.json();
  } catch { throw new Error('独立商城未就绪，请先在独立商城目录执行 npm start'); }
  if (!info.ready || info.sandbox !== false || info.package?.projectId !== 'dingxiaosui'
    || info.workbenchUrl !== settings.origin + '/workbench.html') throw new Error('独立商城丁小穗平台或工作台地址不匹配');
  const preload = path.join(settings.folder, 'attached-network-boundary.mjs');
  fs.writeFileSync(preload, networkBoundarySource(settings.centerUrl), { mode: 0o600 });
  const log = fs.openSync(path.join(settings.folder, 'ding-attached-server.log'), 'a', 0o600);
  let child;
  try { child = spawn(process.execPath, ['--import', pathToFileURL(preload).href, path.join(settings.appDir, 'server.js')], {
    cwd: settings.appDir, env: attachedEnvironment(settings), windowsHide: true, stdio: ['ignore', log, log] }); }
  finally { fs.closeSync(log); }
  let spawnFailed = false, closing;
  child.once('error', () => { spawnFailed = true; });
  const runtimeFile = path.join(settings.folder, 'attached-runtime.json');
  const metadata = { pid: process.pid, dingPid: child.pid, centerRoot: settings.centerRoot, centerUrl: settings.centerUrl,
    dingPort: settings.dingPort, buildId: settings.buildId, mode: 'attached-independent-center', startedAt: new Date().toISOString() };
  const close = () => closing ??= (async () => {
    if (child.exitCode === null && child.signalCode === null && !spawnFailed) {
      const stopped = once(child, 'exit'); child.kill(); await stopped;
    }
    fs.writeFileSync(runtimeFile, JSON.stringify({ ...metadata, stoppedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
  })();
  try {
    let ready = false;
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (spawnFailed || child.exitCode !== null || child.signalCode !== null) throw new Error('丁小穗启动退出，请查看本机私有 ding-attached-server.log');
      try { ready = (await fetch(settings.origin + '/api/event/session', { signal: AbortSignal.timeout(1000) })).ok; } catch { /* Await startup. */ }
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    if (!ready || !(await fetch(settings.origin + '/workbench.html', { signal: AbortSignal.timeout(3000) })).ok) throw new Error('丁小穗启动超时或页面资源不完整');
    fs.writeFileSync(runtimeFile, JSON.stringify(metadata, null, 2), { mode: 0o600 });
    return { close, child, centerUrl: settings.centerUrl, origin: settings.origin };
  } catch (error) { await close(); throw error; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw new Error('本脚本不接受命令行密钥或覆盖参数；请使用本机 attached-center.json');
    const runtime = await startAttachedDingxiaosui();
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => runtime.close().then(() => { process.exitCode = 0; }));
    runtime.child.once('exit', () => runtime.close().catch(() => { process.exitCode = 1; }));
    console.log('丁小穗：' + runtime.origin + '/workbench.html');
    console.log('独立商城：' + runtime.centerUrl + '/?project=dingxiaosui');
    console.log('沿用原本机账户、卡密激活和作品数据；未启动旧中心，也未初始化新数据。');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
