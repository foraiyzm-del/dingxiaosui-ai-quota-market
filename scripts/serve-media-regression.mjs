// Manual browser regression fixture: real Next + real quota center, disposable
// databases and synthetic media. No .env files, customer state or paid APIs.
// First build apps/dingxiaosui, then run this script with Node 25.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { startCenter } from '../sidecar/server.mjs';

const root = path.resolve(import.meta.dirname, '..');
const ding = path.join(root, 'apps', 'dingxiaosui');
const app = path.join(ding, '.next', 'standalone');
assert.ok(fs.existsSync(path.join(app, 'server.js')), '先在 apps/dingxiaosui 完成 npm run build');
const delayArgument = process.argv.find(value => value.startsWith('--me-delay-ms='));
let meDelayMs = delayArgument ? Number(delayArgument.split('=')[1]) : 1500;
assert.ok(Number.isInteger(meDelayMs) && meDelayMs >= 0 && meDelayMs <= 30000, '--me-delay-ms 必须为 0–30000');
fs.mkdirSync(path.join(root, 'local'), { recursive: true });
const folder = fs.mkdtempSync(path.join(root, 'local', 'media-regression-'));
const centerRoot = path.join(folder, 'center');
const mediaFolder = path.join(folder, 'synthetic-media');
fs.mkdirSync(path.join(centerRoot, 'local'), { recursive: true });
fs.mkdirSync(mediaFolder);
async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
const centerPort = await freePort(), dingPort = await freePort(), proxyPort = await freePort();
const shop = `http://127.0.0.1:${centerPort}`;
const nextOrigin = `http://127.0.0.1:${dingPort}`;
const origin = `http://127.0.0.1:${proxyPort}`;
const ffmpeg = '/opt/homebrew/bin/ffmpeg';
assert.ok(fs.existsSync(ffmpeg), '本地 fixture 需要 /opt/homebrew/bin/ffmpeg 生成合成素材');
function render(args) {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || '合成测试素材失败');
}
const pngPath = path.join(mediaFolder, 'synthetic-reference-640x480.png');
const jpegPath = path.join(mediaFolder, 'synthetic-reference-3200x2400.jpg');
render(['-f', 'lavfi', '-i', 'testsrc2=size=640x480:rate=1', '-frames:v', '1', pngPath]);
render(['-f', 'lavfi', '-i', 'testsrc2=size=3200x2400:rate=1', '-frames:v', '1', '-q:v', '3', jpegPath]);
const png = fs.readFileSync(pngPath);
const videos = new Map();
for (const seconds of [5, 10, 15]) {
  const filename = path.join(mediaFolder, `synthetic-${seconds}s.mp4`);
  render(['-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=12', '-t', String(seconds), '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', filename]);
  videos.set(seconds, fs.readFileSync(filename));
}

const observations = { uploads: [], generations: [], identityChecks: 0 };
const upstreamJobs = new Map();
const fakeProviderKey = 'isolated-browser-fixture-only';
function imageDimensions(bytes) {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    return { format: 'png', width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 4 < bytes.length) {
      if (bytes[offset++] !== 0xff) continue;
      let marker = bytes[offset++];
      while (marker === 0xff) marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { format: 'jpeg', width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) };
      }
      offset += length;
    }
  }
  return { format: 'unknown', width: null, height: null };
}
function persistObservations() {
  fs.writeFileSync(path.join(folder, 'observations.json'), JSON.stringify({ ...observations, meDelayMs, realProviderCalls: false }, null, 2));
}
const fetchImpl = async (input, init = {}) => {
  const url = new URL(String(input));
  const headers = new Headers(init.headers);
  if (url.origin === 'https://upload.apimart.ai' && url.pathname.startsWith('/f/')) {
    assert.equal(headers.has('authorization'), false, '不得把供应商凭证发往素材 URL');
    if (url.pathname.startsWith('/f/image/')) return new Response(png, { headers: { 'content-type': 'image/png' } });
    const id = path.basename(url.pathname, '.mp4');
    const job = upstreamJobs.get(id);
    assert.ok(job?.capability === 'video', '未知合成视频');
    return new Response(videos.get(job.seconds), { headers: { 'content-type': 'video/mp4' } });
  }
  assert.equal(url.origin, 'https://api.apimart.ai', '外部网络请求已被 fixture 阻止');
  assert.equal(headers.get('authorization'), `Bearer ${fakeProviderKey}`);
  if (url.pathname.endsWith('/uploads/images')) {
    const body = Buffer.from(init.body);
    const boundary = headers.get('content-type')?.match(/boundary=([^;]+)/)?.[1];
    assert.ok(boundary, '缺少 multipart boundary');
    const start = body.indexOf('\r\n\r\n') + 4;
    const end = body.indexOf(`\r\n--${boundary}`, start);
    assert.ok(start >= 4 && end > start, '图片 multipart 数据不完整');
    const bytes = body.subarray(start, end);
    observations.uploads.push({ at: new Date().toISOString(), bytes: bytes.length, ...imageDimensions(bytes) });
    persistObservations();
    return Response.json({ url: `https://upload.apimart.ai/f/image/reference-${observations.uploads.length}.png` });
  }
  if (url.pathname.endsWith('/images/generations') || url.pathname.endsWith('/videos/generations')) {
    const payload = JSON.parse(init.body);
    const capability = url.pathname.endsWith('/images/generations') ? 'image' : 'video';
    const seconds = capability === 'video' ? Number(payload.duration) : null;
    if (capability === 'video') assert.ok(videos.has(seconds), `fixture 未定义 ${seconds} 秒合成视频`);
    const id = `fixture-${capability}-${randomUUID()}`;
    upstreamJobs.set(id, { capability, seconds });
    observations.generations.push({ at: new Date().toISOString(), capability, model: payload.model, duration: seconds, resolution: payload.resolution ?? null, aspectRatio: payload.aspect_ratio ?? payload.size ?? null, audio: payload.generate_audio ?? payload.audio ?? null, referenceImages: Array.isArray(payload.image_urls) ? payload.image_urls.length : 0 });
    persistObservations();
    return Response.json({ code: 200, data: [{ task_id: id, status: 'submitted' }] });
  }
  const taskId = url.pathname.match(/\/tasks\/([^/]+)$/)?.[1];
  if (taskId && upstreamJobs.has(taskId)) {
    const { capability } = upstreamJobs.get(taskId);
    return Response.json({ code: 200, data: { id: taskId, status: 'completed', result: capability === 'image' ? { images: [{ url: [`https://upload.apimart.ai/f/image/${taskId}.png`] }] } : { videos: [{ url: [`https://upload.apimart.ai/f/video/${taskId}.mp4`] }] } } });
  }
  if (url.pathname.endsWith('/chat/completions')) {
    return Response.json({ code: 200, data: { choices: [{ message: { content: JSON.stringify({ answer: '【本地合成测试】此文案没有调用真实模型。', title: '本地验证' }) } }] } });
  }
  throw new Error(`Blocked unexpected fixture path: ${url.pathname}`);
};

async function request(base, route, { body, cookie = '', requestOrigin = base } = {}) {
  const response = await fetch(base + route, { method: body === undefined ? 'GET' : 'POST', headers: { origin: requestOrigin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
  const text = await response.text();
  assert.ok(response.ok, `${route}: HTTP ${response.status}: ${text.slice(0, 500)}`);
  return { data: JSON.parse(text), cookies: response.headers.getSetCookie(), cookie: response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ') };
}
let center, child, proxy, loginCookies = [], logs = '', stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  persistObservations();
  if (proxy) await new Promise(resolve => { proxy.close(resolve); proxy.closeAllConnections(); });
  if (child && child.exitCode === null) {
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    const killTimer = setTimeout(() => child.kill('SIGKILL'), 5000);
    await exited;
    clearTimeout(killTimer);
  }
  if (center) await center.close();
}
process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());
try {
  center = await startCenter({ root: centerRoot, port: centerPort, config: { host: '127.0.0.1', port: centerPort, adminPassword: 'fixture-local-admin', merchantKey: 'fixture-local-storage-key' }, generationOptions: { fetchImpl } });
  const admin = await request(shop, '/api/admin/login', { body: { password: 'fixture-local-admin' } });
  const models = [{ capability: 'text', id: 'deepseek-v4.1-flash' }, { capability: 'text', id: 'claude-sonnet-5-5' }, { capability: 'image', id: 'gpt-image-2.5-flare' }, { capability: 'video', id: 'seedance-2.0-mini' }, { capability: 'video', id: 'seedance-2.0' }, { capability: 'video', id: 'seedance-2.5' }];
  await request(shop, '/api/admin/channels', { cookie: admin.cookie, body: { id: 'apimart', name: '本地合成测试', protocol: 'apimart', baseUrl: 'https://api.apimart.ai/v1', apiKey: fakeProviderKey, models } });
  await request(shop, '/api/admin/platforms', { cookie: admin.cookie, body: { id: 'dingxiaosui', name: '丁小穗本地测试', url: origin + '/workbench.html', bindings: [models[0], models[2], models[3]].map(model => ({ ...model, model: model.id, channelId: 'apimart' })) } });
  const credentials = (await request(shop, '/api/admin/platforms/dingxiaosui/credential', { cookie: admin.cookie, body: {} })).data;
  const oldLeaderProfile = { tier: 'leader', video: { seconds: 5, resolution: '720p', audio: false }, models: { text: 'claude-sonnet-5-5', image: 'gpt-image-2.5-flare', video: 'seedance-2.5' }, image: { resolution: '1k', quality: 'low', size: '1:1' }, fallbacks: { text: 'deepseek-v4.1-flash', video: 'seedance-2.0' } };
  const code = center.quota.generateCodes({ projectId: 'dingxiaosui', quantity: 1, quota: { text: 50, image: 50, video: 50 }, mediaSpec: oldLeaderProfile }).codes[0];
  const environment = { PATH: process.env.PATH || '/usr/bin:/bin:/opt/homebrew/bin', ZDX_DATA_DIR: path.join(folder, 'ding-data'), AI_CONFIG_ENCRYPTION_KEY: randomBytes(32).toString('hex'), APP_ORIGIN: origin, APP_ENV: 'production', PASSWORD_AUTH_ENABLED: '1', EVENT_ACTIVATION_ENABLED: '1', ZLG_GATEWAY_REQUIRED: '0', MEDIA_BACKGROUND_ENABLED: '1', QUOTA_CENTER_URL: shop, QUOTA_PLATFORM_KEY: credentials.apiKey, SHOP_PRODUCT_URL: shop + '/?service=dingxiaosui-creator', NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', PORT: String(dingPort), HOSTNAME: '127.0.0.1' };
  const migration = spawnSync(process.execPath, ['scripts/migrate-ecs.mjs'], { cwd: ding, env: environment, encoding: 'utf8' });
  assert.equal(migration.status, 0, migration.stderr);
  const preload = path.join(folder, 'network-boundary.mjs');
  fs.writeFileSync(preload, `const original=globalThis.fetch;globalThis.fetch=(input,init)=>{const url=input instanceof Request?input.url:String(input);if(new URL(url).origin!==${JSON.stringify(shop)})throw Error('External network blocked in browser fixture');return original(input,init)};`, { mode: 0o600 });
  fs.cpSync(path.join(ding, 'public'), path.join(app, 'public'), { recursive: true });
  fs.cpSync(path.join(ding, '.next', 'static'), path.join(app, '.next', 'static'), { recursive: true });
  child = spawn(process.execPath, ['--import', pathToFileURL(preload).href, path.join(app, 'server.js')], { cwd: app, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', part => { logs = (logs + part).slice(-12000); });
  child.stderr.on('data', part => { logs = (logs + part).slice(-12000); });
  let ready = false;
  for (let attempt = 0; attempt < 200; attempt++) {
    if (child.exitCode !== null) throw new Error('本地 Next 提前退出：' + logs);
    try { await request(nextOrigin, '/api/event/session', { requestOrigin: origin }); ready = true; break; } catch { /* startup */ }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  assert.ok(ready, '本地 Next 启动超时：' + logs);
  loginCookies = (await request(nextOrigin, '/api/event/session', { body: { code }, requestOrigin: origin })).cookies;
  proxy = http.createServer((req, res) => {
    if (req.headers.host !== `127.0.0.1:${proxyPort}`) { res.writeHead(403); res.end('Local fixture host only'); return; }
    const url = new URL(req.url, origin);
    if (url.pathname.startsWith('/__fixture/')) {
      res.setHeader('cache-control', 'no-store');
      if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
      if (url.pathname === '/__fixture/login') { res.writeHead(302, { 'set-cookie': loginCookies, location: '/account/studio?type=image&provider=platform' }); res.end(); return; }
      if (url.pathname === '/__fixture/config') {
        const value = Number(url.searchParams.get('meDelayMs'));
        if (!url.searchParams.has('meDelayMs') || !Number.isInteger(value) || value < 0 || value > 30000) { res.writeHead(400); res.end('meDelayMs must be 0–30000'); return; }
        meDelayMs = value; persistObservations();
      } else if (url.pathname !== '/__fixture/state') { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ...observations, meDelayMs, oldLeaderSeconds: 5, realProviderCalls: false }, null, 2));
      return;
    }
    const forward = () => {
      if (res.destroyed) return;
      const upstream = http.request({ hostname: '127.0.0.1', port: dingPort, method: req.method, path: req.url, headers: req.headers }, response => {
        res.writeHead(response.statusCode, response.headers); response.pipe(res);
      });
      upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('Local Next unavailable'); });
      req.on('aborted', () => upstream.destroy());
      req.pipe(upstream);
    };
    if (url.pathname === '/api/me') { observations.identityChecks++; persistObservations(); setTimeout(forward, meDelayMs); } else forward();
  });
  await new Promise(resolve => proxy.listen(proxyPort, '127.0.0.1', resolve));
  persistObservations();
  console.log(JSON.stringify({ mode: 'LOCAL SYNTHETIC ONLY', login: origin + '/__fixture/login', state: origin + '/__fixture/state', disableIdentityDelay: origin + '/__fixture/config?meDelayMs=0', identityDelayMs: meDelayMs, uploadSamples: [pngPath, jpegPath], artifacts: folder, oldLeaderVideoSeconds: 5, quota: { text: 50, image: 50, video: 50 }, realProviderCalls: false }, null, 2));
  console.log('保持此进程运行；Ctrl+C 仅停止本 fixture。合成素材和独立数据库保留在 local/。');
} catch (error) {
  await stop();
  throw error;
}
