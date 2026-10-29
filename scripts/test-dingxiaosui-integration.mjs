// Real Next HTTP + real quota center + disposable databases. All model traffic
// uses explicit fixtures. Payment notifications are simulated, never real revenue.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { startCenter } from '../sidecar/server.mjs';
import { epaySign } from '../sidecar/payments.mjs';

const root = path.resolve(import.meta.dirname, '..');
const ding = path.resolve(process.env.DINGXIAOSUI_DIR || path.join(root, 'apps', 'dingxiaosui'));
const app = path.join(ding, '.next', 'standalone');
assert.ok(fs.existsSync(path.join(app, 'server.js')), '先构建丁小穗');
fs.mkdirSync(path.join(root, 'local'), { recursive: true });
fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
const folder = fs.mkdtempSync(path.join(root, 'local', 'ding-integration-'));
const centerRoot = path.join(folder, 'center');
fs.mkdirSync(path.join(centerRoot, 'local'), { recursive: true });
async function freePort() { const server = net.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port; }
const centerPort = await freePort(), dingPort = await freePort();
const shop = `http://127.0.0.1:${centerPort}`, origin = `http://127.0.0.1:${dingPort}`;
const calls = { text: 0, image: 0, video: 0, uploads: 0 };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const mp4 = Buffer.from([0,0,0,24,102,116,121,112,105,115,111,109,0,0,0,0,105,115,111,109]);
const textRequests = [];
const fetchImpl = async (url, init) => {
  if (url.includes('/f/image/')) { assert.equal(init.headers.Authorization, undefined); return new Response(png, { headers: { 'content-type': 'image/png' } }); }
  if (url.includes('/f/video/')) { assert.equal(init.headers.Authorization, undefined); return new Response(mp4, { headers: { 'content-type': 'video/mp4' } }); }
  assert.equal(init.headers.Authorization, 'Bearer isolated-integration-provider');
  if (url.endsWith('/chat/completions')) {
    calls.text++; const payload = JSON.parse(init.body); textRequests.push(payload);
    assert.equal(payload.response_format.type, 'json_object');
    return Response.json({ code: 200, data: { choices: [{ message: { content: JSON.stringify({ answer: '【隔离模拟】这是一份农产品营销文案，用于验证接入与扣次。', title: '组合卡文案验收' }) } }] } });
  }
  if (url.endsWith('/uploads/images')) { calls.uploads++; return Response.json({ url: 'https://upload.apimart.ai/f/image/reference.png' }); }
  if (url.endsWith('/images/generations')) { calls.image++; assert.equal(JSON.parse(init.body).image_urls.length, 1); return Response.json({ code: 200, data: [{ task_id: 'image-task', status: 'submitted' }] }); }
  if (url.endsWith('/videos/generations')) { calls.video++; assert.equal(JSON.parse(init.body).duration, 5); return Response.json({ code: 200, data: [{ task_id: 'video-task', status: 'submitted' }] }); }
  if (url.endsWith('/tasks/image-task')) return Response.json({ code: 200, data: { id: 'image-task', status: 'completed', result: { images: [{ url: ['https://upload.apimart.ai/f/image/result.png'] }] } } });
  if (url.endsWith('/tasks/video-task')) return Response.json({ code: 200, data: { id: 'video-task', status: 'completed', result: { videos: [{ url: ['https://upload.apimart.ai/f/video/result.mp4'] }] } } });
  throw new Error('Blocked unexpected upstream fixture: ' + url);
};
let center, child, logs = '', checks = 0;
const report = [];
async function request(base, route, { body, cookie = '', method = body === undefined ? 'GET' : 'POST', headers = {} } = {}) {
  const response = await fetch(base + route, { method, headers: { origin: base, 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(150000) });
  const bytes = Buffer.from(await response.arrayBuffer()), text = bytes.toString(); let data;
  try { data = JSON.parse(text); } catch { /* bytes and payment acknowledgement */ }
  const jar = new Map(cookie.split(';').map(item => item.trim().split('=')));
  for (const value of response.headers.getSetCookie()) { const [key, content] = value.split(';')[0].split('='); if (content) jar.set(key, content); else jar.delete(key); }
  return { status: response.status, data, bytes, text, headers: response.headers, cookie: [...jar].filter(([k,v]) => k && v).map(([k,v]) => `${k}=${v}`).join('; ') };
}
function ok(response, status = 200) { assert.equal(response.status, status, response.text.slice(0, 2000)); checks++; return response.data; }
async function check(name, work) { await work(); report.push(name); console.log('PASS ' + name); }
const storeRequest = (route, options) => request(shop, route, options);
const dingRequest = (route, options) => request(origin, route, options);
async function stopDing() { if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; } }
try {
  center = await startCenter({ root: centerRoot, port: centerPort, config: { port: centerPort, adminPassword: 'isolated-admin', merchantKey: 'isolated-storage-key' }, generationOptions: { fetchImpl } });
  const admin = (await storeRequest('/api/admin/login', { body: { password: 'isolated-admin' } })).cookie;
  const models = [{ capability: 'text', id: 'deepseek-v4.1-flash' }, { capability: 'image', id: 'gpt-image-2.5-flare' }, { capability: 'video', id: 'seedance-2.0-mini' }];
  ok(await storeRequest('/api/admin/channels', { cookie: admin, body: { id: 'apimart', name: '隔离模拟', protocol: 'apimart', baseUrl: 'https://api.apimart.ai/v1', apiKey: 'isolated-integration-provider', models } }));
  ok(await storeRequest('/api/admin/platforms', { cookie: admin, body: { id: 'dingxiaosui', name: '丁小穗', url: origin + '/workbench.html', bindings: models.map(model => ({ ...model, model: model.id, channelId: 'apimart' })) } }));
  ok(await storeRequest('/api/admin/products', { cookie: admin, body: { id: 'dingxiaosui-creator', projectId: 'dingxiaosui', name: '丁小穗创作额度', units: 5, priceCents: 100, fulfillment: 'on_payment', packageOptions: [{ id: 'combo', label: '3文案1图片1视频', quota: { text: 3, image: 1, video: 1 }, priceCents: 100 }], quotaPricing: { enabled: true, unitPriceMicros: { text: 100000, image: 200000, video: 500000 }, maxCounts: { text: 100, image: 100, video: 100 } } } }));
  ok(await storeRequest('/api/admin/payment-settings', { cookie: admin, body: { mode: 'epay', gatewayUrl: 'https://pay.example', publicBaseUrl: 'https://store.example', merchantId: 'isolated-merchant', apiKey: 'isolated-payment-key', enabledMethods: ['wxpay'] } }));
  const credentials = ok(await storeRequest('/api/admin/platforms/dingxiaosui/credential', { cookie: admin, body: {} }));
  const environment = { ...process.env, ZDX_DATA_DIR: path.join(folder, 'ding-data'), AI_CONFIG_ENCRYPTION_KEY: randomBytes(32).toString('hex'), APP_ORIGIN: origin, APP_ENV: 'production', PASSWORD_AUTH_ENABLED: '1', EVENT_ACTIVATION_ENABLED: '1', ZLG_GATEWAY_REQUIRED: '0', MEDIA_BACKGROUND_ENABLED: '1', QUOTA_CENTER_URL: shop, QUOTA_PLATFORM_KEY: credentials.apiKey, SHOP_PRODUCT_URL: shop + '/?service=dingxiaosui-creator', NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', PORT: String(dingPort), HOSTNAME: '127.0.0.1' };
  for (const key of Object.keys(environment)) if (/^(OPENAI_|APIMART_|ARK_|DASHSCOPE_|DEEPSEEK_|LOCAL_|PLATFORM_ADMIN_)/.test(key)) delete environment[key];
  const migration = spawnSync(process.execPath, ['scripts/migrate-ecs.mjs'], { cwd: ding, env: environment, encoding: 'utf8' });
  assert.equal(migration.status, 0, migration.stderr);
  const preload = path.join(folder, 'network-boundary.mjs');
  fs.writeFileSync(preload, `const original=globalThis.fetch;globalThis.fetch=(url,init)=>{if(new URL(String(url)).origin!==${JSON.stringify(shop)})throw Error('External network blocked in integration fixture');return original(url,init)};`);
  async function startDing() {
    child = spawn(process.execPath, ['--import', pathToFileURL(preload).href, path.join(app, 'server.js')], { cwd: app, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', part => { logs = (logs + part).slice(-12000); }); child.stderr.on('data', part => { logs = (logs + part).slice(-12000); });
    for (let attempt = 0; attempt < 200; attempt++) { if (child.exitCode !== null) throw new Error(logs); try { if ((await dingRequest('/api/event/session')).status === 200) return; } catch {} await new Promise(resolve => setTimeout(resolve, 150)); }
    throw new Error('丁小穗未启动：' + logs);
  }
  await startDing();
  let code, customer, owner;
  await check('自选3文案1图片1视频，下单付款后只交付一张卡', async () => {
    const order = ok(await storeRequest('/api/shop/orders', { body: { productId: 'dingxiaosui-creator', customQuota: { text: 3, image: 1, video: 1 }, email: 'isolated@example.com', priceCents: 1 } }), 201);
    assert.equal(order.priceCents, 100); assert.equal(order.inventoryId, null);
    ok(await storeRequest(`/api/shop/orders/${order.id}/pay?token=${order.token}`, { body: {} }));
    const notify = { pid: 'isolated-merchant', out_trade_no: order.orderNo, trade_no: 'SIMULATED-NO-MONEY', type: 'wxpay', money: '1.00', trade_status: 'TRADE_SUCCESS' }; notify.sign = epaySign(notify, 'isolated-payment-key'); notify.sign_type = 'MD5';
    for (let n = 0; n < 2; n++) assert.equal((await storeRequest('/api/payment/notify?' + new URLSearchParams(notify))).text, 'success');
    const delivered = ok(await storeRequest(`/api/shop/orders/${order.id}?token=${order.token}`)); code = delivered.code;
    assert.equal(delivered.status, 'fulfilled'); assert.match(code, /^QTA-/);
  });
  await check('在真实丁小穗接口激活、三项余额独立、同码跨设备恢复', async () => {
    customer = await dingRequest('/api/event/session', { body: { code } }); const session = ok(customer); owner = session.user.id;
    assert.equal(session.creditSource, 'quota_center'); assert.match(customer.headers.get('set-cookie'), /HttpOnly/);
    const wallet = ok(await dingRequest('/api/account/event-credits', customer));
    for (const [capability, amount] of Object.entries({ text: 3, image: 1, video: 1 })) assert.equal(wallet.quotas.find(item => item.capability === capability).available, amount);
    const restored = ok(await dingRequest('/api/event/session', { body: { code } })); assert.equal(restored.user.id, owner);
    assert.equal(center.quota.stats().redeemedCodeCount, 1);
    ok(await dingRequest('/api/platform/event-codes', customer), 403);
  });
  await check('知识库进入文案上下文，3次成功后阻止第4次且不占图片视频', async () => {
    const workspace = ok(await dingRequest('/api/workspace', customer));
    workspace.entries['zidingxiang-workspace-v1'] = JSON.stringify({ products: [], campaigns: [], drafts: [], plans: [], knowledge: [{ id: 'fixture-pear', title: '青禾梨园玉露香梨', brand: '青禾梨园', productName: '玉露香梨', content: '青禾梨园六枚礼盒。INTEGRATION_PRIVATE_KNOWLEDGE', verified: true, autoReference: true }] });
    ok(await dingRequest('/api/workspace', { ...customer, method: 'PUT', headers: { 'x-zdx-workspace-owner': owner }, body: { revision: workspace.revision, entries: workspace.entries } }));
    const revision = ok(await dingRequest('/api/workspace', customer)).revision;
    for (let index = 0; index < 3; index++) {
      const body = { message: '给青禾梨园玉露香梨写品牌故事 ' + index, taskId: 'brand', requestId: randomUUID(), revision, consent: true };
      const options = { ...customer, headers: { 'x-zdx-workspace-owner': owner }, body };
      assert.ok(ok(await dingRequest('/api/dialogue', options)).answer.includes('隔离模拟'));
      ok(await dingRequest('/api/dialogue', options));
    }
    ok(await dingRequest('/api/dialogue', { ...customer, headers: { 'x-zdx-workspace-owner': owner }, body: { message: '再写一份', taskId: 'brand', requestId: randomUUID(), revision, consent: true } }), 402);
    assert.equal(calls.text, 3); assert.ok(JSON.stringify(textRequests).includes('INTEGRATION_PRIVATE_KNOWLEDGE'));
    const wallet = ok(await dingRequest('/api/account/event-credits', customer));
    assert.equal(wallet.quotas.find(q => q.capability === 'text').available, 0); assert.equal(wallet.quotas.find(q => q.capability === 'image').available, 1); assert.equal(wallet.quotas.find(q => q.capability === 'video').available, 1);
  });
  let imageId;
  await check('图生图和视频经过中心，结果保存到丁小穗且各扣1次', async () => {
    for (const capability of ['image', 'video']) {
      const body = { capability, modelId: null, prompt: '农产品包装宣传' + capability, ratio: capability === 'image' ? '3:4' : '16:9', consent: true, idempotencyKey: randomUUID(), ...(capability === 'image' ? { referenceImage: `data:image/png;base64,${png.toString('base64')}` } : {}) };
      const options = { ...customer, headers: { 'x-zdx-media-owner': owner }, body };
      let job = ok(await dingRequest('/api/media/jobs', options), 201).job;
      assert.equal(ok(await dingRequest('/api/media/jobs', options)).job.id, job.id);
      if (capability === 'video') {
        // Recreate the production Node process and make no media polling request.
        // Completion here therefore requires instrumentation's request-free worker.
        await stopDing(); await startDing();
        const inspection = new DatabaseSync(path.join(environment.ZDX_DATA_DIR, 'zdx.sqlite'), { readOnly: true });
        try {
          for (let attempt = 0; attempt < 120; attempt++) {
            const row = inspection.prepare('SELECT status,error FROM media_jobs WHERE id=?').get(job.id);
            if (row.status === 'succeeded') break;
            assert.ok(!['failed', 'unknown'].includes(row.status), JSON.stringify(row));
            await new Promise(resolve => setTimeout(resolve, 500));
          }
          assert.equal(inspection.prepare('SELECT status FROM media_jobs WHERE id=?').get(job.id).status, 'succeeded', '后台必须在无浏览器轮询时恢复并保存视频');
          assert.equal(calls.video, 1, '重启后台不能再次生成');
          report.push('视频提交后重启，无浏览器轮询也由后台恢复并保存');
        } finally { inspection.close(); }
      }
      for (let attempt = 0; attempt < 120 && job.status !== 'succeeded'; attempt++) { job = ok(await dingRequest('/api/media/jobs?id=' + job.id, customer)).job; if (job.status === 'failed' || job.status === 'unknown') throw new Error(JSON.stringify(job)); if (job.status !== 'succeeded') await new Promise(resolve => setTimeout(resolve, 500)); }
      assert.equal(job.status, 'succeeded', JSON.stringify(job));
      assert.equal(job.outputs.length, 1); assert.equal(job.outputs[0].persisted, true);
      assert.deepEqual((await dingRequest(job.outputs[0].url, customer)).bytes, capability === 'image' ? png : mp4);
      if (capability === 'image') imageId = job.id;
    }
    assert.deepEqual(calls, { text: 3, image: 1, video: 1, uploads: 1 });
    const wallet = ok(await dingRequest('/api/account/event-credits', customer));
    for (const row of wallet.quotas) { assert.equal(row.available, 0); assert.equal(row.reserved, 0); }
  });
  await check('重启恢复原账号和作品、其他卡不能读取原任务', async () => {
    await stopDing(); await startDing();
    const restored = await dingRequest('/api/event/session', { body: { code } }); assert.equal(ok(restored).user.id, owner);
    assert.equal(ok(await dingRequest('/api/media/jobs?id=' + imageId, restored)).job.status, 'succeeded');
    const otherCode = center.quota.generateCodes({ projectId: 'dingxiaosui', quantity: 1, quota: { text: 1, image: 0, video: 0 } }).codes[0];
    const other = await dingRequest('/api/event/session', { body: { code: otherCode } }); ok(other);
    ok(await dingRequest('/api/media/jobs?id=' + imageId, other), 404);
    assert.deepEqual(calls, { text: 3, image: 1, video: 1, uploads: 1 });
  });
  fs.writeFileSync(path.join(root, 'artifacts', 'dingxiaosui-integration-results.json'), JSON.stringify({ at: new Date().toISOString(), checks, scenarios: report, modelCalls: calls, realPayments: false, realProviderCalls: false, passed: true }, null, 2));
  console.log(`跨系统集成通过：${checks}项HTTP检查，${report.length}组场景。无真实付款或付费调用。`);
} catch (error) { console.error(logs.slice(-6000)); throw error; }
finally { await stopDing(); if (center) await center.close(); }
