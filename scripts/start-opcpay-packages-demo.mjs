// Independent, persistent, loopback-only payment demo. No Ding app or real
// payment/model configuration is loaded. Importing this module starts nothing.
import path from 'node:path';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir, realpath, lstat, symlink, cp } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { startCenter } from '../sidecar/server.mjs';
import { FIXED_PACKAGES } from '../sidecar/opcpay.mjs';
import { createMockOpcpay } from './opcpay-mock.mjs';
import { fetchOpcpayDemoModel as fetchImpl } from './opcpay-demo-model.mjs';

const root = path.resolve(import.meta.dirname, '..');
const mode = 'opcpay-three-package-offline-v1';
const packageIds = ['trial', 'week', 'month'];
const models = ['text', 'image', 'video'].map(capability => ({ id: `mock-${capability}`, capability }));

async function unusedPort(port) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('演示端口必须是 0–65535 的整数');
  const probe = net.createServer();
  try {
    await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', resolve); });
    return probe.address().port;
  } catch (error) {
    if (error.code === 'EADDRINUSE') throw new Error(`端口 ${port} 已占用；未连接或停止已有服务，请另设 OPCPAY_PACKAGES_DEMO_PORT。`);
    throw error;
  } finally {
    if (probe.listening) await new Promise(resolve => probe.close(resolve));
  }
}

async function attachPublic(folder) {
  const source = path.join(root, 'public'), target = path.join(folder, 'public');
  try {
    if (await realpath(source) !== await realpath(target)) {
      if ((await lstat(target)).isSymbolicLink()) throw new Error('模拟 public 指向其他目录，拒绝加载');
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

async function loadDemoSettings(dataDir) {
  const target = path.join(dataDir, 'config.json');
  let settings;
  try { settings = JSON.parse(await readFile(target, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw new Error('模拟配置损坏，请检查独立演示目录');
    let existing;
    try { existing = await readdir(dataDir); } catch (readError) { if (readError.code !== 'ENOENT') throw readError; existing = []; }
    if (existing.length) throw new Error('目录已有未标记的数据，拒绝作为新模拟库使用');
    await mkdir(dataDir, { recursive: true });
    settings = { mode, merchantKey: randomBytes(32).toString('hex'), adminPassword: randomBytes(24).toString('hex') };
    await writeFile(target, JSON.stringify(settings, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  }
  if (settings.mode !== mode || [settings.merchantKey, settings.adminPassword].some(value => typeof value !== 'string' || value.length < 24)) {
    throw new Error('此目录不属于三套餐本地模拟，拒绝读取其他环境数据');
  }
  return settings;
}

function profile(definition) {
  return { enabled: true, sandbox: true, apiKey: `local-${definition.packageId}-mock-only-no-real-key`,
    skuId: `opcpay-${definition.packageId}-sku`, merchantProjectName: definition.name + '（本地模拟）',
    projectId: definition.projectId, productId: definition.productId, packageId: definition.packageId,
    termsConfirmed: true, verifiedPackage: { priceCents: definition.priceCents, quotaUnit: 'COUNT', amount: 1 } };
}

export async function startOpcpayPackagesDemo({ dataDir = path.join(root, 'local', 'opcpay-packages-demo'),
  port = Number(process.env.OPCPAY_PACKAGES_DEMO_PORT || 0) } = {}) {
  const chosenPort = await unusedPort(port);
  dataDir = path.resolve(dataDir);
  if (dataDir === root || dataDir === path.join(root, 'local')) throw new Error('必须使用独立模拟数据目录');
  const settings = await loadDemoSettings(dataDir), baseUrl = `http://127.0.0.1:${chosenPort}`;
  const centerRoot = path.join(dataDir, 'center');
  await mkdir(path.join(centerRoot, 'local'), { recursive: true });
  await attachPublic(centerRoot);
  const mocks = {}; let center, closing;
  const close = () => closing ??= (async () => {
    try { if (center) await center.close(); }
    finally { await Promise.all(Object.values(mocks).map(mock => mock.close())); }
  })();
  try {
    for (const packageId of packageIds) mocks[packageId] = await createMockOpcpay({
      dbPath: path.join(dataDir, `provider-${packageId}.sqlite`), package: FIXED_PACKAGES[packageId],
      port: settings.providerPorts?.[packageId] ?? 0,
    });
    // Purchase URLs are persisted by the centre. Keep each fixture's original
    // port across restart so those URLs still reach the same provider database.
    settings.providerPorts = Object.fromEntries(Object.entries(mocks).map(([id, mock]) => [id, Number(new URL(mock.baseUrl).port)]));
    await writeFile(path.join(dataDir, 'config.json'), JSON.stringify(settings, null, 2) + '\n', { mode: 0o600 });
    const paymentConfig = { ...profile(FIXED_PACKAGES.trial), packages: {
      week: profile(FIXED_PACKAGES.week), month: profile(FIXED_PACKAGES.month),
    } };
    center = await startCenter({ root: centerRoot, port: chosenPort,
      config: { ...settings, host: '127.0.0.1', port: chosenPort, publicOrigin: baseUrl, localSimulation: true },
      generationOptions: { fetchImpl }, paymentOptions: { allowLocal: true },
      opcpayOptions: { config: paymentConfig, client: mocks.trial.client, clients: { week: mocks.week.client, month: mocks.month.client } },
    });
    // Even a local administrator cannot replace the mock cashier with a real
    // gateway from this isolated demo's settings page.
    const savePayment = center.paymentProvider.saveSettings;
    center.paymentProvider.saveSettings = value => {
      if ((value.mode && value.mode !== 'manual') || value.gatewayUrl || value.apiKey
        || (value.publicBaseUrl && value.publicBaseUrl !== baseUrl)) throw Object.assign(new Error('此演示仅允许本地模拟付款'), { status: 403 });
      return savePayment(value);
    };
    center.paymentProvider.saveSettings({ mode: 'manual', publicBaseUrl: baseUrl });
    center.channels.saveChannel({ id: 'opcpay-demo-model', name: '隔离模拟模型（不联网）',
      baseUrl: 'https://mock-model.invalid/v1', apiKey: 'mock-model-only', enabled: true, models });
    center.platforms.savePlatform({ id: 'dingxiaosui', name: '丁小穗', enabled: true, unitsPerUse: 1,
      url: `${baseUrl}/platform/dingxiaosui`, description: '本地套餐支付与额度激活模拟，不调用真实模型。',
      bindings: models.map(model => ({ capability: model.capability, model: model.id, channelId: 'opcpay-demo-model' })) });
    for (const packageId of packageIds) {
      const definition = FIXED_PACKAGES[packageId];
      center.commerce.saveProduct({ id: definition.productId, projectId: definition.projectId, name: definition.name,
        description: '独立本地模拟：核销 1 次对应套餐权益发 1 张卡；不会真实付款或调用收费模型。',
        units: Object.values(definition.quota).reduce((sum, units) => sum + units, 0), priceCents: definition.priceCents,
        active: true, fulfillment: 'on_payment', packageOptions: [{ id: packageId, label: definition.name,
          quota: definition.quota, priceCents: definition.priceCents }] });
    }
    await writeFile(path.join(dataDir, 'ACCESS.md'), [
      '# 三套餐独立模拟（本机私密）', '', '无真实支付，无真实模型调用。不要分享或提交此文件。',
      `商城：${baseUrl}/`, `本地激活：${baseUrl}/platform/dingxiaosui`, `后台：${baseUrl}/admin`,
      `管理员密码：${settings.adminPassword}`, '',
      '尝鲜卡、周卡、月卡各有独立模拟数据库。创建兑换意向后，在本地模拟收银台确认，再返回商城核销领取。',
      '关闭后使用同一目录重启，会保留购买账户、核销编号、卡密和额度；原模拟购买页使用已保存端口。', '',
    ].join('\n'), { mode: 0o600 });
    await writeFile(path.join(dataDir, 'runtime.json'), JSON.stringify({ mode, pid: process.pid, port: chosenPort,
      providerPorts: settings.providerPorts,
      startedAt: new Date().toISOString() }, null, 2) + '\n', { mode: 0o600 });
    return { baseUrl, dataDir, center, mocks, close };
  } catch (error) { await close(); throw error; }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  let runtime;
  try {
    if (process.argv.length > 2) throw new Error('此脚本仅支持本地模拟；端口使用 OPCPAY_PACKAGES_DEMO_PORT 配置');
    runtime = await startOpcpayPackagesDemo();
    console.log('三套餐独立模拟：无真实付款，无真实模型调用。');
    console.log(`商城：${runtime.baseUrl}/`);
    console.log(`本地激活与分项额度：${runtime.baseUrl}/platform/dingxiaosui`);
    console.log('私密访问资料在 local/opcpay-packages-demo/ACCESS.md。Ctrl+C 只停止本脚本服务。');
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => runtime.close().then(() => { process.exitCode = 0; }).catch(() => { process.exitCode = 1; }));
  } catch (error) { if (runtime) await runtime.close(); console.error(error.message); process.exitCode = 1; }
}
