import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setup, root } from './setup.mjs';
import { startCenter } from '../sidecar/server.mjs';
import { fetchOpcpayDemoModel } from './opcpay-demo-model.mjs';

let center, shutdownPromise, pidWritten = false;
const pidFile = path.join(root, 'local/pids.json');

function shutdown() {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    if (center) {
      const forceClose = setTimeout(() => center.server.closeAllConnections(), 3000);
      forceClose.unref();
      try { await center.close(); } finally { clearTimeout(forceClose); }
    }
    if (pidWritten) {
      await writeFile(pidFile, JSON.stringify({ pid: process.pid, stoppedAt: new Date().toISOString() }, null, 2));
    }
  })();
  return shutdownPromise;
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => shutdown().then(() => { process.exitCode = 0; }).catch(error => {
    console.error(`停止本机服务失败：${error.message}`);
    process.exitCode = 1;
  }));
}

try {
  const config = await setup();
  let opcpayConfig = {};
  try { opcpayConfig = JSON.parse(await readFile(path.join(root, 'local/opcpay.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('一人付私有配置格式错误，请检查 local/opcpay.json'); }
  if (opcpayConfig.sandbox) throw new Error('普通启动不接受模拟一人付配置，请使用专用演示脚本');
  center = await startCenter({ root, config,
    generationOptions: config.localModelMock === true ? { fetchImpl: fetchOpcpayDemoModel } : {},
    opcpayOptions: { config: opcpayConfig } });
  await writeFile(pidFile, JSON.stringify({
    pid: process.pid, host: '127.0.0.1', port: config.port, startedAt: new Date().toISOString(),
  }, null, 2));
  pidWritten = true;
  console.log(`商城：http://127.0.0.1:${config.port}`);
  console.log(`管理后台：http://127.0.0.1:${config.port}/admin`);
  console.log(`兑换体验：http://127.0.0.1:${config.port}/demo`);
  console.log('访问资料：local/ACCESS.md。请在后台配置渠道、平台、套餐、卡密库存与收款方式；业务平台接入说明见 docs/integration.md。');
} catch (error) {
  console.error(error.code === 'EADDRINUSE'
    ? '本机服务端口已被占用；若本项目已启动，请直接打开本机地址。'
    : `启动失败：${error.message}`);
  await shutdown().catch(() => {});
  process.exitCode = 1;
}
