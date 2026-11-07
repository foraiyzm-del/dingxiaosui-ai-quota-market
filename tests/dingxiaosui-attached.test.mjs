import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import http from 'node:http';
import net from 'node:net';
import { loadAttachedConfiguration, attachedEnvironment, networkBoundarySource, assertRuntimeNotMigrated, startAttachedDingxiaosui } from '../scripts/start-dingxiaosui-attached.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ding-attached-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const folder = path.join(root, 'local/opcpay-live-test'), centerRoot = path.join(root, 'independent-center');
  for (const dir of ['apps/saved-build', 'ding-data']) fs.mkdirSync(path.join(folder, dir), { recursive: true });
  fs.mkdirSync(path.join(centerRoot, 'local'), { recursive: true });
  const json = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
  json(path.join(folder, 'config.json'), { dingKey: 'existing-ding-key-do-not-rotate' });
  json(path.join(folder, 'attached-center.json'), { centerRoot, centerUrl: 'http://127.0.0.1:3399', dingPort: 8945 });
  json(path.join(folder, 'apps/saved-build/ready.json'), { buildId: 'saved-build' });
  fs.writeFileSync(path.join(folder, 'apps/saved-build/server.js'), '');
  fs.writeFileSync(path.join(folder, 'ding-data/zdx.sqlite'), 'existing-data');
  json(path.join(centerRoot, 'local/config.json'), { port: 3399 });
  json(path.join(centerRoot, 'local/project-keys.json'), { dingxiaosui: 'existing-ding-platform-credential' });
  return { root, folder, centerRoot, json };
}

test('attached application keeps original data/key and uses the independent centre credential', t => {
  const { root, folder, centerRoot } = fixture(t);
  const settings = loadAttachedConfiguration({ root });
  const env = attachedEnvironment(settings, { PATH: 'keep', OPENAI_API_KEY: 'discard', APIMART_API_KEY: 'discard',
    ARK_KEY: 'discard', LOCAL_API_KEY: 'discard', PLATFORM_ADMIN_TOKEN: 'discard', NODE_OPTIONS: '--import unsafe.mjs',
    QUOTA_CENTER_URL: 'https://wrong.invalid', AI_CONFIG_ENCRYPTION_KEY: 'wrong' });
  assert.equal(settings.appDir, path.join(folder, 'apps/saved-build'));
  assert.equal(settings.centerRoot, centerRoot);
  assert.equal(env.ZDX_DATA_DIR, path.join(folder, 'ding-data'));
  assert.equal(env.AI_CONFIG_ENCRYPTION_KEY, 'existing-ding-key-do-not-rotate');
  assert.equal(env.QUOTA_PLATFORM_KEY, 'existing-ding-platform-credential');
  assert.equal(env.QUOTA_CENTER_URL, 'http://127.0.0.1:3399');
  assert.equal(env.SHOP_PRODUCT_URL, 'http://127.0.0.1:3399/?project=dingxiaosui');
  assert.equal(env.PORT, '8945');
  assert.equal(env.PATH, 'keep');
  for (const key of ['OPENAI_API_KEY', 'APIMART_API_KEY', 'ARK_KEY', 'LOCAL_API_KEY', 'PLATFORM_ADMIN_TOKEN', 'NODE_OPTIONS']) assert.equal(env[key], undefined);
  assert.equal(fs.readFileSync(path.join(folder, 'ding-data/zdx.sqlite'), 'utf8'), 'existing-data');
});

test('attached startup rejects mismatched addresses, missing original data and ambiguous snapshots', t => {
  const { root, folder, centerRoot, json } = fixture(t);
  const file = path.join(folder, 'attached-center.json');
  for (const centerUrl of ['https://example.com', 'http://127.0.0.1:3399/private', 'http://127.0.0.1:3499', 'http://user:pass@127.0.0.1:3399']) {
    json(file, { centerRoot, centerUrl, dingPort: 8945 });
    assert.throws(() => loadAttachedConfiguration({ root }), /中心地址|端口/);
  }
  json(file, { centerRoot, centerUrl: 'http://127.0.0.1:3399', dingPort: 8945 });
  fs.mkdirSync(path.join(folder, 'apps/other-build'));
  json(path.join(folder, 'apps/other-build/ready.json'), { buildId: 'other-build' });
  assert.throws(() => loadAttachedConfiguration({ root }), /快照/);
  json(file, { centerRoot, centerUrl: 'http://127.0.0.1:3399', dingPort: 8945, buildId: 'saved-build' });
  fs.unlinkSync(path.join(folder, 'ding-data/zdx.sqlite'));
  assert.throws(() => loadAttachedConfiguration({ root }), /原丁小穗数据/);
});

test('attached network guard permits only the chosen centre and rejects redirect escape', async () => {
  const calls = [];
  const context = vm.createContext({ URL, Request, Error, fetch: async (...args) => { calls.push(args); return 'ok'; } });
  vm.runInContext(networkBoundarySource('http://127.0.0.1:3399'), context);
  assert.equal(await context.fetch('http://127.0.0.1:3399/api/v1/balance', { redirect: 'follow' }), 'ok');
  assert.equal(calls[0][1].redirect, 'error');
  assert.throws(() => context.fetch('https://api.openai.com/v1/responses'), /External network blocked/);
  assert.throws(() => context.fetch('http://127.0.0.1:3499/api/v1/balance'), /External network blocked/);
  assert.equal(await context.fetch(new Request('http://127.0.0.1:3399/api/v1/balance')), 'ok');
  assert.equal(calls.length, 2);
});

test('migration marker refuses the old live runtime without inspecting marker contents', t => {
  const { folder } = fixture(t);
  assert.doesNotThrow(() => assertRuntimeNotMigrated(folder));
  fs.writeFileSync(path.join(folder, 'MIGRATED.json'), 'private-marker-not-even-json');
  assert.throws(() => assertRuntimeNotMigrated(folder), /已迁至独立商城/);
});

test('attached launcher starts and stops only the fixture application without writing a centre database', async t => {
  const { root, folder, centerRoot, json } = fixture(t);
  const portProbe = net.createServer();
  await new Promise(resolve => portProbe.listen(0, '127.0.0.1', resolve));
  const dingPort = portProbe.address().port;
  await new Promise(resolve => portProbe.close(resolve));
  const centre = http.createServer((req, res) => {
    assert.equal(req.method, 'GET');
    assert.equal(req.url, '/api/opcpay/info');
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ready: true, sandbox: false, package: { projectId: 'dingxiaosui' }, workbenchUrl: `http://127.0.0.1:${dingPort}/workbench.html` }));
  });
  await new Promise(resolve => centre.listen(0, '127.0.0.1', resolve));
  const centerPort = centre.address().port, centerUrl = `http://127.0.0.1:${centerPort}`;
  json(path.join(centerRoot, 'local/config.json'), { port: centerPort });
  json(path.join(folder, 'attached-center.json'), { centerRoot, centerUrl, dingPort });
  fs.writeFileSync(path.join(folder, 'apps/saved-build/server.js'), `import http from 'node:http';http.createServer((req,res)=>{res.end(req.url==='/api/event/session'?'{}':'fixture workbench')}).listen(Number(process.env.PORT),process.env.HOSTNAME);`);
  let runtime;
  try {
    runtime = await startAttachedDingxiaosui({ root });
    assert.equal(runtime.centerUrl, centerUrl);
    assert.equal(await (await fetch(runtime.origin + '/workbench.html')).text(), 'fixture workbench');
    const metadata = JSON.parse(fs.readFileSync(path.join(folder, 'attached-runtime.json'), 'utf8'));
    assert.equal(metadata.dingPid, runtime.child.pid);
    assert.equal(metadata.centerRoot, centerRoot);
    assert.equal(metadata.mode, 'attached-independent-center');
    assert.equal(Object.hasOwn(metadata, 'dingKey'), false);
    assert.equal(Object.hasOwn(metadata, 'platformKey'), false);
    assert.equal(fs.existsSync(path.join(centerRoot, 'local/center.sqlite')), false);
    assert.equal(fs.readFileSync(path.join(folder, 'ding-data/zdx.sqlite'), 'utf8'), 'existing-data');
  } finally {
    if (runtime) await runtime.close();
    await new Promise(resolve => centre.close(resolve));
  }
  assert.ok(JSON.parse(fs.readFileSync(path.join(folder, 'attached-runtime.json'), 'utf8')).stoppedAt);
});
