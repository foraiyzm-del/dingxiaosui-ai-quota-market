// Independent, loopback-only demonstration. No business app, live payment or
// external model client is loaded. Importing this module starts nothing.
import path from 'node:path';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, readFile, writeFile, symlink, realpath, lstat, cp } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import QRCode from 'qrcode';
import { startCenter } from '../sidecar/server.mjs';
import { createQuota } from '../sidecar/quota.mjs';
import { createChannels } from '../sidecar/channels.mjs';
import { createPlatforms } from '../sidecar/platforms.mjs';
import { createCommerce } from '../sidecar/commerce.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const mode = 'multiproject-local-simulation-v1';
const modelOrigin = 'https://multiproject-model.invalid';
const projectDefinitions = [
  { id: 'dingxiaosui', name: '丁小穗（模拟接入示例）' },
  { id: 'second-project', name: '一二大模型（接入示例）' },
];
const allocation = { text: 10, image: 15, video: 2 };
const models = ['text', 'image', 'video'].map(capability => ({ id: `local-${capability}`, capability }));
// Procedural colour-test fixtures, generated locally with FFmpeg, not AI output.
const fixture = name => readFile(path.join(repositoryRoot, 'public', 'assets', name));
const forbidden = message => { throw Object.assign(new Error(message), { status: 403 }); };

/** The adapter never calls fetch. Even an administrator's changed model URL
 * cannot escape into a real upstream network request. */
export function createMultiprojectModelMock() {
  return { async fetchImpl(address, init = {}) {
    const url = new URL(String(address));
    if (url.origin !== modelOrigin || !url.pathname.startsWith('/v1/')) forbidden('独立模拟演示禁止外部模型网络');
    const payload = init.body ? JSON.parse(String(init.body)) : {};
    const prompt = payload.prompt ?? payload.messages?.map(message => message.content).join('\n') ?? '';
    if (String(prompt).includes('[[FAIL]]')) return Response.json({ error: { message: '本地模拟明确拒绝，没有调用模型' } }, { status: 400 });
    if (url.pathname === '/v1/chat/completions' && init.method === 'POST') {
      return Response.json({ choices: [{ message: { content: '【本地模拟】这是独立项目的计次演示文案，没有调用真实模型。' } }], usage: { prompt_tokens: 12, completion_tokens: 18 } });
    }
    if (url.pathname === '/v1/images/generations' && init.method === 'POST') return Response.json({ data: [{ b64_json: (await fixture('mock-image.png')).toString('base64') }] });
    if (url.pathname === '/v1/videos' && init.method === 'POST') return Response.json({ id: `local-video-${randomBytes(8).toString('hex')}`, status: 'queued' });
    if (/^\/v1\/videos\/local-video-[a-f0-9]{16}\/content$/u.test(url.pathname)) return new Response(await fixture('mock-video.mp4'), { headers: { 'content-type': 'video/mp4' } });
    if (/^\/v1\/videos\/local-video-[a-f0-9]{16}$/u.test(url.pathname)) return Response.json({ id: url.pathname.split('/').pop(), status: 'completed' });
    forbidden('独立模拟演示禁止未定义的模型请求');
  } };
}

async function unusedPort(requestedPort) {
  if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) throw new Error('演示端口必须是 0–65535 的整数');
  const probe = net.createServer();
  try {
    await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(requestedPort, '127.0.0.1', resolve); });
    return probe.address().port;
  } catch (error) {
    if (error.code === 'EADDRINUSE') throw new Error(`端口 ${requestedPort} 已占用；未连接或停止已有服务，请设置 MULTIPROJECT_DEMO_PORT。`);
    throw error;
  } finally {
    if (probe.listening) await new Promise(resolve => probe.close(resolve));
  }
}

async function attachPublic(dataDir) {
  const source = path.join(repositoryRoot, 'public'), target = path.join(dataDir, 'public');
  try {
    const linked = await realpath(target);
    if (linked !== await realpath(source)) {
      if ((await lstat(target)).isSymbolicLink()) throw new Error('演示 public 入口不是当前仓库公共资源，请检查独立数据目录');
      // A previous run may have used the copy fallback without symlink rights.
      await cp(source, target, { recursive: true });
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    try { await symlink(source, target, process.platform === 'win32' ? 'junction' : 'dir'); }
    catch (linkError) {
      if (!['EPERM', 'EACCES'].includes(linkError.code)) throw linkError;
      await cp(source, target, { recursive: true, force: false, errorOnExist: true });
    }
  }
}

function seedLedger(dbPath, settings, baseUrl) {
  const db = new DatabaseSync(dbPath);
  try {
    const quota = createQuota(db), channels = createChannels(db, { secret: settings.merchantKey });
    channels.saveChannel({ id: 'multiproject-local', name: '本地模拟模型（不联网）', baseUrl: modelOrigin + '/v1',
      apiKey: 'local-simulation-not-a-provider-key', enabled: true, videoRequestFormat: 'json', models });
    const platforms = createPlatforms(db, { quota, channels });
    const commerce = createCommerce(db, { quota, channels, platforms, secret: settings.merchantKey });
    // Seeding actual business objects before startCenter also keeps its unrelated
    // empty-database sample catalogue out of this dedicated demonstration.
    for (const project of projectDefinitions) {
      platforms.savePlatform({ ...project, enabled: true, unitsPerUse: 1, url: '',
        description: `${project.id === 'second-project' ? '一二大模型待提供源码和服务配置，当前为通用接入模拟。' : '丁小穗仅作为通用模拟接入示例，未启动其业务应用。'}卡密只属于本项目；无真实付款、无真实模型。输入 [[FAIL]] 可演示失败返还。`,
        bindings: models.map(model => ({ capability: model.capability, model: model.id, channelId: 'multiproject-local' })) });
      commerce.saveProduct({ id: `${project.id}-demo-27`, projectId: project.id, name: `${project.name} · 模拟尝鲜卡`,
        description: '9.90 元仅为本地示例价格；文案 10、图片 15、视频 2，不发生真实付款。', units: 27, priceCents: 990,
        active: true, fulfillment: 'on_payment', packageOptions: [{ id: 'trial', label: '文案 10 / 图片 15 / 视频 2', quota: allocation, priceCents: 990 }] });
    }
  } finally { db.close(); }
}

/** Starts only this independent centre. Returned credentials are server-side
 * test/demo integration values and are never printed or placed in public files. */
export async function startMultiprojectDemo({ dataDir = path.join(repositoryRoot, 'local', 'multiproject-demo'),
  port = Number(process.env.MULTIPROJECT_DEMO_PORT || 3299) } = {}) {
  const chosenPort = await unusedPort(port); // Bind probe only; no existing service is contacted.
  dataDir = path.resolve(dataDir);
  if (dataDir === repositoryRoot || dataDir === path.join(repositoryRoot, 'local')) throw new Error('必须使用独立演示数据目录');
  const baseUrl = `http://127.0.0.1:${chosenPort}`;
  await mkdir(path.join(dataDir, 'local'), { recursive: true });
  const settingsPath = path.join(dataDir, 'config.json');
  let settings;
  try { settings = JSON.parse(await readFile(settingsPath, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw new Error('独立模拟配置损坏，请检查演示数据目录');
    settings = { mode, merchantKey: randomBytes(32).toString('hex'), adminPassword: randomBytes(24).toString('hex'), paymentKey: randomBytes(32).toString('hex') };
    await writeFile(settingsPath, JSON.stringify(settings, null, 2), { flag: 'wx', mode: 0o600 });
  }
  if (settings.mode !== mode || [settings.merchantKey, settings.adminPassword, settings.paymentKey].some(value => typeof value !== 'string' || value.length < 24)) {
    throw new Error('此目录不属于独立本地模拟，拒绝加载其他环境配置');
  }
  await attachPublic(dataDir);
  const dbPath = path.join(dataDir, 'local', 'center.sqlite');
  seedLedger(dbPath, settings, baseUrl);
  const mock = createMultiprojectModelMock();
  let center, closing;
  const close = () => closing ??= center ? center.close() : Promise.resolve();
  try {
    center = await startCenter({ root: dataDir, port: chosenPort, dbPath,
      config: { port: chosenPort, host: '127.0.0.1', publicOrigin: baseUrl, localSimulation: true, adminPassword: settings.adminPassword, merchantKey: settings.merchantKey },
      generationOptions: { fetchImpl: mock.fetchImpl }, paymentOptions: { allowLocal: true } });
    const merchantId = 'multiproject-local-demo';
    const savePayment = center.paymentProvider.saveSettings;
    center.paymentProvider.saveSettings = data => {
      if ((data.gatewayUrl && data.gatewayUrl !== baseUrl + '/local-simulated-gateway')
        || (data.publicBaseUrl && data.publicBaseUrl !== baseUrl)
        || (data.apiKey && data.apiKey !== settings.paymentKey)
        || (data.merchantId && data.merchantId !== merchantId)) forbidden('独立演示禁止真实支付配置，仅允许当前本地模拟');
      return savePayment(data);
    };
    center.paymentProvider.saveSettings({ mode: 'manual', publicBaseUrl: baseUrl });
    await writeFile(path.join(dataDir, 'local', 'payment-qr.bin'), await QRCode.toBuffer('LOCAL SIMULATION ONLY - NO PAYMENT - 请勿真实付款', { width: 320 }));
    await writeFile(path.join(dataDir, 'local', 'payment-qr.json'), JSON.stringify({ mime: 'image/png', simulation: true }));
    // Obtain the same stable project credentials that a real server integration
    // receives through the protected management API.
    const login = await fetch(baseUrl + '/api/admin/login', { method: 'POST', headers: { origin: baseUrl, 'content-type': 'application/json' }, body: JSON.stringify({ password: settings.adminPassword }), redirect: 'error' });
    if (!login.ok) throw new Error('独立演示管理账户初始化失败');
    const cookie = login.headers.get('set-cookie')?.split(';')[0];
    const credentials = {};
    for (const project of projectDefinitions) {
      const response = await fetch(`${baseUrl}/api/admin/platforms/${project.id}/credential`, { method: 'POST', headers: { origin: baseUrl, cookie, 'content-type': 'application/json' }, body: '{}', redirect: 'error' });
      if (!response.ok) throw new Error('独立演示项目凭证初始化失败');
      credentials[project.id] = await response.json();
    }
    await fetch(baseUrl + '/api/admin/logout', { method: 'POST', headers: { origin: baseUrl, cookie, 'content-type': 'application/json' }, body: '{}', redirect: 'error' });
    await writeFile(path.join(dataDir, 'ACCESS.md'), [
      '# 独立多项目本地模拟（私密）', '', '无真实支付或模型调用。此文件不要分享或提交仓库。',
      `管理后台：${baseUrl}/admin`, `管理员密码：${settings.adminPassword}`, '',
      '手动核账：创建示例订单 → 填写模拟付款说明 → 后台确认模拟到账并发卡。二维码不含支付链接。',
      '模型明确失败演示：提示词包含 [[FAIL]]，预扣次数会返还。视频文件仅为模拟测试数据。', '',
      ...projectDefinitions.flatMap(project => [`## ${project.name}`, `商城：${baseUrl}/?project=${project.id}`, `本地接入页：${baseUrl}/platform/${project.id}`,
        `SDK Base URL：${baseUrl}`, `服务端项目凭证：${credentials[project.id].apiKey}`, '']),
    ].join('\n'), { mode: 0o600 });
    await writeFile(path.join(dataDir, 'runtime.json'), JSON.stringify({ mode, pid: process.pid, port: chosenPort, startedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
    return { baseUrl, dataDir, center, mock, credentials, adminPassword: settings.adminPassword,
      payment: { merchantId, apiKey: settings.paymentKey }, close };
  } catch (error) { await close(); throw error; }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  let runtime;
  try {
    if (process.argv.length > 2) throw new Error('此脚本仅支持本地模拟；端口使用 MULTIPROJECT_DEMO_PORT 配置');
    runtime = await startMultiprojectDemo();
    console.log('独立双项目本地模拟：无真实付款，无真实模型调用。');
    console.log(`商城：${runtime.baseUrl}/`);
    for (const project of projectDefinitions) console.log(`${project.name}：${runtime.baseUrl}/platform/${project.id}`);
    console.log('管理访问资料保存在独立数据目录的私密 ACCESS.md，不在终端输出。Ctrl+C 只停止本脚本服务。');
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => runtime.close().then(() => { process.exitCode = 0; }).catch(() => { process.exitCode = 1; }));
  } catch (error) { if (runtime) await runtime.close(); console.error(error.message); process.exitCode = 1; }
}
