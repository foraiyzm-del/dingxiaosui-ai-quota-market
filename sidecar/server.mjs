import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, rename, access } from 'node:fs/promises';
import path from 'node:path';
import { createQuota } from './quota.mjs';
import { createPayments } from './payments.mjs';
import { createCommerce } from './commerce.mjs';
import { imageMime } from './image.mjs';
import { createChannels } from './channels.mjs';
import { createPlatforms } from './platforms.mjs';
import { createGeneration } from './generation.mjs';
import { createPaymentProvider } from './payment-provider.mjs';
import { configurePlatformCatalog } from './sample-platforms.mjs';

const sha = s => createHash('sha256').update(s).digest('hex');
const equal = (a, b) => {
  const x = Buffer.from(sha(String(a ?? ''))), y = Buffer.from(sha(String(b ?? '')));
  return timingSafeEqual(x, y);
};
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
export async function startCenter({ root, config, port = config.port, dbPath = path.join(root, 'local/center.sqlite'), generationOptions = {}, paymentOptions = {} }) {
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS web_sessions (hash TEXT PRIMARY KEY, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS center_audit (id INTEGER PRIMARY KEY, action TEXT, detail TEXT, created_at TEXT);
    CREATE TABLE IF NOT EXISTS demo_claims (user_id TEXT PRIMARY KEY, claimed_at TEXT NOT NULL);`);
  const quota = createQuota(db), payments = createPayments(db, config);
  const channels = createChannels(db, { secret: config.merchantKey });
  const platforms = createPlatforms(db, { quota, channels });
  const commerce = createCommerce(db, { quota, channels, platforms, secret: config.merchantKey });
  configurePlatformCatalog(db, quota, commerce, platforms);
  const generation = createGeneration(db, { quota, channels, platforms, ...generationOptions });
  const paymentProvider = createPaymentProvider(db, { commerce, secret: config.merchantKey, ...paymentOptions });
  const keyFile = path.join(root, 'local/project-keys.json');
  let projectKeys;
  try { projectKeys = JSON.parse(await readFile(keyFile, 'utf8')); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    projectKeys = {};
  }
  let keysChanged = false;
  for (const p of quota.listProjects()) if (!projectKeys[p.id]) { projectKeys[p.id] = randomBytes(32).toString('hex'); keysChanged = true; }
  let keyWrite = Promise.resolve();
  const persistKeys = () => {
    keyWrite = keyWrite.catch(() => {}).then(async () => {
      const temporary = `${keyFile}.${randomBytes(8).toString('hex')}.tmp`;
      await writeFile(temporary, JSON.stringify(projectKeys, null, 2), { mode: 0o600 });
      await rename(temporary, keyFile);
    });
    return keyWrite;
  };
  if (keysChanged) await persistKeys();
  const qrPath = path.join(root, 'local/payment-qr.bin');
  const qrMetaPath = path.join(root, 'local/payment-qr.json');
  const audit = (action, detail) => db.prepare('INSERT INTO center_audit(action,detail,created_at) VALUES(?,?,?)').run(action, JSON.stringify(detail), new Date().toISOString());
  const qrReady = async () => { try { await access(qrPath); return true; } catch { return false; } };
  const paymentInfo = async () => paymentProvider.publicSettings(await qrReady());
  const publicPlatform = id => {
    const result = platforms.listPlatforms({ public: true }).find(p => p.id === id);
    if (!result || !result.enabled) fail(404, '平台不存在或已停用');
    return result;
  };
  const storeInfo = () => ({ needsCompliance: false, demoProductUrl: `http://127.0.0.1:${config.port}/demo` });
  const limits = new Map();
  function rate(key, max = 60, window = 60000) {
    const t = Date.now(), old = limits.get(key);
    const entry = old && old.until > t ? old : { count: 0, until: t + window };
    if (++entry.count > max) fail(429, '操作过于频繁，请稍后重试');
    limits.set(key, entry);
    if (limits.size > 5000) for (const [k, v] of limits) if (v.until < t) limits.delete(k);
  }
  const server = http.createServer(async (req, res) => {
    const json = (data, status = 200) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
    const cookieMap = Object.fromEntries((req.headers.cookie ?? '').split(';').filter(Boolean).map(v => { const i = v.indexOf('='); return [v.slice(0, i).trim(), v.slice(i + 1).trim()]; }));
    const setCookie = (name, value, age) => {
      const publicOrigin = paymentProvider.safeSettings().publicBaseUrl;
      const secure = publicOrigin?.startsWith('https:') && new URL(publicOrigin).host === req.headers.host;
      res.setHeader('set-cookie', `${name}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${secure ? '; Secure' : ''}`);
    };
    let body;
    async function raw(max = 65536) {
      if (body) return body;
      const chunks = []; let n = 0;
      for await (const chunk of req) { n += chunk.length; if (n > max) fail(413, '提交内容过大'); chunks.push(chunk); }
      body = Buffer.concat(chunks); return body;
    }
    async function input(max) { try { return JSON.parse((await raw(max)).toString() || '{}'); } catch (error) { if (error.status) throw error; fail(400, 'JSON 格式无效'); } }
    const admin = () => {
      const session = cookieMap.center_session;
      if (!session || !db.prepare('SELECT hash FROM web_sessions WHERE hash=? AND expires>?').get(sha(session), Date.now())) fail(401, '请登录核账中心');
    };
    const project = () => {
      const value = req.headers.authorization?.replace(/^Bearer /, '');
      const found = Object.entries(projectKeys).find(([, key]) => value && equal(key, value));
      if (!found) fail(401, '项目接入凭证无效');
      return found[0];
    };
    const demoUser = () => {
      let id = cookieMap.demo_user;
      if (!id || !/^[a-f0-9]{48}$/.test(id)) { id = randomBytes(24).toString('hex'); setCookie('demo_user', id, 30 * 86400); }
      return `demo:${id}`;
    };
    const platformUser = () => {
      let id = cookieMap.platform_user;
      if (!id || !/^[a-f0-9]{48}$/.test(id)) { id = randomBytes(24).toString('hex'); setCookie('platform_user', id, 365 * 86400); }
      return `portal:${id}`;
    };
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('x-frame-options', 'DENY');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('cache-control', 'no-store');
    res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; media-src 'self' https: blob:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try {
      const requestHost = req.headers.host;
      const configuredOrigin = paymentProvider.safeSettings().publicBaseUrl;
      const allowedOrigins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`, ...(configuredOrigin ? [configuredOrigin] : [])];
      if (!allowedOrigins.some(origin => new URL(origin).host === requestHost)) fail(403, '请求域名未配置');
      const url = new URL(req.url, `http://127.0.0.1:${port}`), route = url.pathname;
      if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin && !allowedOrigins.includes(req.headers.origin)) fail(403, '请求来源无效');
      const generationPoll = req.method === 'GET' && (route === '/api/health' || /^\/api\/v1\/(?:generation\/[^/]+(?:\/content)?|balance)$/.test(route) || /^\/api\/platforms\/[^/]+\/(?:jobs\/[^/]+(?:\/content)?|balance)$/.test(route));
      const userScopedGeneration = req.method === 'POST' && (route === '/api/v1/generate' || /^\/api\/platforms\/[^/]+\/generate$/.test(route));
      // Health checks and task polling do not spend a user's generation budget.
      // Generation itself is counted per platform credential and user, so one shared network does not throttle everyone.
      if (!generationPoll && !userScopedGeneration) rate(req.socket.remoteAddress ?? 'local', 300);
      if (route === '/api/health') return json({ ok: true, service: 'quota-center', qrConfigured: await qrReady(), modelCallsEnabled: platforms.listPlatforms({ public: true }).some(p => p.enabled && (p.availableCapabilities ? p.availableCapabilities.length > 0 : p.ready)), payment: await paymentInfo() });
      if (route === '/api/admin/login' && req.method === 'POST') {
        rate('admin-login', 10, 15 * 60000);
        if (!equal((await input()).password, config.adminPassword)) fail(401, '密码不正确');
        const token = randomBytes(32).toString('hex');
        db.prepare('DELETE FROM web_sessions WHERE expires<?').run(Date.now());
        db.prepare('INSERT INTO web_sessions(hash,expires) VALUES(?,?)').run(sha(token), Date.now() + 8 * 3600000);
        setCookie('center_session', token, 8 * 3600); return json({ ok: true });
      }
      if (route.startsWith('/api/admin/')) {
        admin();
        if (route === '/api/admin/logout' && req.method === 'POST') {
          db.prepare('DELETE FROM web_sessions WHERE hash=?').run(sha(cookieMap.center_session)); setCookie('center_session', '', 0); return json({ ok: true });
        }
        if (route === '/api/admin/state' && req.method === 'GET') return json({ payments: commerce.listOrders(), products: commerce.listProducts({ admin: true }), channels: channels.listChannels(), commerceStats: commerce.stats(), projects: quota.listProjects(), codes: quota.listCodes(), usage: quota.listUsage(), stats: quota.stats(), qrConfigured: await qrReady(), storeUrl: `http://127.0.0.1:${config.port}`, gatewayPrepared: true, gatewayRunning: false,
          platforms: platforms.listPlatforms(), inventory: commerce.listInventory(), batches: commerce.listBatches(), generationJobs: generation.listJobs(), generationStats: generation.stats(), paymentSettings: paymentProvider.safeSettings(), paymentIssues: paymentProvider.listIssues(),
          audit: db.prepare('SELECT action,detail,created_at AS createdAt FROM center_audit ORDER BY id DESC LIMIT 100').all(), ...storeInfo() });
        if (route === '/api/admin/platforms' && req.method === 'POST') {
          const result = platforms.savePlatform(await input());
          if (!projectKeys[result.id]) projectKeys[result.id] = randomBytes(32).toString('hex');
          await persistKeys();
          audit('platform.saved', { id: result.id, enabled: result.enabled }); return json(result);
        }
        const credential = route.match(/^\/api\/admin\/platforms\/([^/]+)\/credential$/);
        if (credential && req.method === 'POST') {
          const id = credential[1]; if (!projectKeys[id]) fail(404, '平台不存在');
          await keyWrite;
          audit('platform.credential_viewed', { id }); return json({ projectId: id, apiKey: projectKeys[id], baseUrl: `${configuredOrigin || `http://127.0.0.1:${port}`}/api/v1` });
        }
        if (route === '/api/admin/inventory/generate' && req.method === 'POST') {
          const result = commerce.generateInventory(await input()); audit('inventory.generated', result); return json(result, 201);
        }
        if (route === '/api/admin/inventory/export' && req.method === 'GET') {
          const result = commerce.exportBatch({ batchId: url.searchParams.get('batchId') }); audit('inventory.exported', { batchId: result.batch?.id ?? url.searchParams.get('batchId') }); return json(result);
        }
        const resolveJob = route.match(/^\/api\/admin\/generation\/([^/]+)\/resolve$/);
        if (resolveJob && req.method === 'POST') { const result = await generation.resolveJob({ ...(await input()), id: resolveJob[1] }); audit('generation.resolved', { id: result.id, status: result.status }); return json(result); }
        if (route === '/api/admin/payment-settings' && req.method === 'GET') return json(paymentProvider.safeSettings());
        if (route === '/api/admin/payment-settings' && req.method === 'POST') { const result = paymentProvider.saveSettings(await input()); audit('payment.settings_saved', { mode: result.mode }); return json(result); }
        const paymentRecovery = route.match(/^\/api\/admin\/payment-issues\/([^/]+)\/recover$/);
        if (paymentRecovery && req.method === 'POST') { const result = paymentProvider.recover({ ...(await input()), orderId: paymentRecovery[1] }); audit('payment.recovered', { id: result.id }); return json(result); }
        if (route === '/api/admin/channels' && req.method === 'GET') return json({ channels: channels.listChannels() });
        if (route === '/api/admin/channels' && req.method === 'POST') {
          const result = channels.saveChannel(await input());
          audit('channel.saved', { id: result.id, enabled: result.enabled, modelCount: result.models.length });
          return json(result);
        }
        if (route === '/api/admin/projects' && req.method === 'POST') {
          const result = quota.createProject(await input());
          projectKeys[result.id] = randomBytes(32).toString('hex');
          await persistKeys();
          audit('project.created', { id: result.id }); return json(result, 201);
        }
        if (route === '/api/admin/products' && req.method === 'POST') {
          const result = commerce.saveProduct(await input()); audit('product.saved', { id: result.id }); return json(result);
        }
        const shopApproval = route.match(/^\/api\/admin\/shop-orders\/([^/]+)\/approve$/);
        if (shopApproval && req.method === 'POST') {
          const result = commerce.approveOrder({ ...(await input()), id: shopApproval[1] });
          audit('order.approved', { id: result.id, status: result.status }); return json(result);
        }
        if (route === '/api/admin/codes' && req.method === 'POST') {
          const data = await input(); const result = quota.generateCodes(data);
          audit('codes.generated', { projectId: data.projectId, quantity: data.quantity, units: data.units }); return json(result, 201);
        }
        if (route === '/api/admin/payment-qr' && req.method === 'POST') {
          const bytes = await raw(2 * 1024 * 1024);
          const mime = imageMime(bytes);
          await writeFile(qrPath, bytes); await writeFile(qrMetaPath, JSON.stringify({ mime })); audit('payment.qr_updated', { mime }); return json({ ok: true });
        }
        const paymentAction = route.match(/^\/api\/admin\/payments\/([a-f0-9]+)\/(approve|retry)$/);
        if (paymentAction && req.method === 'POST') {
          const [, id, action] = paymentAction;
          const result = action === 'approve' ? await payments.approve(id, await input()) : await payments.deliver(id);
          audit(`payment.${action}`, { id, state: result.state }); return json(result);
        }
        fail(404, '管理接口不存在');
      }
      if (route === '/api/shop/products' && req.method === 'GET') return json({ products: commerce.listProducts(), platforms: platforms.listPlatforms({ public: true }), qrConfigured: await qrReady(), payment: await paymentInfo() });
      if (route === '/api/shop/orders' && req.method === 'POST') {
        rate('shop-orders:' + req.socket.remoteAddress, 30, 60000);
        const body = await input();
        return json({ ...commerce.createOrder({ productId: body.productId, email: body.email, packageId: body.packageId, customUnits: body.customUnits, customQuota: body.customQuota }), qrConfigured: await qrReady(), payment: await paymentInfo() }, 201);
      }
      const shopOrder = route.match(/^\/api\/shop\/orders\/([^/]+)(\/proof|\/cancel|\/pay)?$/);
      if (shopOrder) {
        const [, id, proof] = shopOrder, token = url.searchParams.get('token');
        if (proof === '/cancel' && req.method === 'POST') return json(commerce.cancelOrder({ id, token }));
        if (proof === '/pay' && req.method === 'POST') {
          if (!(await paymentInfo()).configured) fail(409, '商家尚未配置收款方式，请勿付款');
          return json(paymentProvider.begin({ ...(await input()), id, token }));
        }
        if (proof === '/proof' && req.method === 'POST') {
          if (paymentProvider.safeSettings().mode !== 'manual') fail(409, '自动支付订单请等待支付平台通知');
          if (!await qrReady()) fail(409, '商家尚未配置收款码，请勿付款');
          const data = await input();
          return json(commerce.submitProof({ id, token, reference: data.reference, payer: data.payer, paidAt: data.paidAt }));
        }
        if (!proof && req.method === 'GET') return json({ ...commerce.getOrder({ id, token }), qrConfigured: await qrReady(), payment: await paymentInfo() });
      }
      if (route === '/api/payment/notify' && ['GET', 'POST'].includes(req.method)) {
        const params = req.method === 'GET' ? url.searchParams : new URLSearchParams((await raw()).toString());
        for (const key of new Set(params.keys())) if (params.getAll(key).length !== 1) fail(400, '支付参数重复');
        const result = paymentProvider.notify(Object.fromEntries(params)); audit('payment.notification', result);
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('success');
      }
      const paymentReturn = route.match(/^\/payment-return\/([a-f0-9]{64})$/);
      if (paymentReturn && req.method === 'GET') { res.writeHead(303, { location: paymentProvider.returnLocation(paymentReturn[1]) }); return res.end(); }
      const portal = route.match(/^\/api\/platforms\/([a-zA-Z0-9._-]+)(?:\/(balance|redeem|generate|jobs)(?:\/([a-zA-Z0-9_-]+))?(\/content)?)?$/);
      if (portal) {
        const [, projectId, action, id, content] = portal; const platform = publicPlatform(projectId), userId = platformUser();
        if (!action && req.method === 'GET') return json(platform);
        if (action === 'balance' && req.method === 'GET') return json(quota.balance({ projectId, userId }));
        if (action === 'redeem' && req.method === 'POST') { rate(`redeem:${userId}`, 12); return json(quota.redeem({ projectId, userId, code: (await input()).code })); }
        if (action === 'generate' && req.method === 'POST') { rate(`generate:${userId}`, 20); return json(await generation.execute({ ...(await input()), projectId, userId })); }
        if (action === 'jobs' && id && req.method === 'GET') {
          if (content) { const result = await generation.getContent({ projectId, userId, id }); res.writeHead(200, { 'content-type': result.contentType }); return res.end(result.body); }
          return json(await generation.getJob({ projectId, userId, id, refresh: true }));
        }
        fail(404, '平台接口不存在');
      }
      if (route === '/submit.php' && ['GET', 'POST'].includes(req.method)) {
        const params = req.method === 'GET' ? url.searchParams : new URLSearchParams((await raw()).toString());
        for (const k of new Set(params.keys())) if (params.getAll(k).length !== 1) fail(400, '支付参数重复');
        const order = payments.create(Object.fromEntries(params));
        res.writeHead(303, { location: `/pay/${order.id}?token=${order.token}` }); return res.end();
      }
      const paymentRoute = route.match(/^\/api\/payments\/([a-f0-9]+)(\/submit)?$/);
      if (paymentRoute) {
        const [, id, submit] = paymentRoute;
        if (submit && req.method === 'POST') {
          if (!await qrReady()) fail(409, '商家尚未配置收款码，请勿付款');
          return json(payments.submit(id, url.searchParams.get('token'), await input()));
        }
        if (!submit && req.method === 'GET') return json({ ...payments.read(id, url.searchParams.get('token')), qrConfigured: await qrReady() });
      }
      if (route === '/payment-qr' && req.method === 'GET') {
        if (!await qrReady()) fail(404, '尚未配置收款码');
        const meta = JSON.parse(await readFile(qrMetaPath, 'utf8'));
        res.writeHead(200, { 'content-type': meta.mime }); return res.end(await readFile(qrPath));
      }
      if (route.startsWith('/api/demo/')) {
        const userId = demoUser(), projectId = 'demo';
        if (route === '/api/demo/info' && req.method === 'GET') return json(await storeInfo());
        if (route === '/api/demo/claim' && req.method === 'POST') {
          if (db.prepare('SELECT user_id FROM demo_claims WHERE user_id=?').get(userId)) fail(409, '当前浏览器已领取过体验码，可由管理员生成新的测试卡密');
          const result = quota.generateCodes({ projectId, quantity: 1, units: 3 });
          db.prepare('INSERT INTO demo_claims(user_id,claimed_at) VALUES(?,?)').run(userId, new Date().toISOString());
          return json({ code: result.codes[0], units: 3, scope: 'local-demo' }, 201);
        }
        if (route === '/api/demo/balance' && req.method === 'GET') return json(quota.balance({ projectId, userId }));
        if (route === '/api/demo/redeem' && req.method === 'POST') return json(quota.redeem({ projectId, userId, code: (await input()).code }));
        if (route === '/api/demo/use' && req.method === 'POST') {
          const data = await input();
          if (!['commit', 'cancel'].includes(data.action)) fail(400, '请选择成功结算或失败退回');
          const reserved = quota.reserve({ projectId, userId, requestId: String(data.requestId ?? ''), units: 1 });
          const settled = quota.settle({ projectId, usageId: reserved.usage.id, action: data.action });
          return json({ ...settled, message: data.action === 'commit' ? '本地演示成功，已扣除 1 次。没有调用真实模型。' : '本地演示失败，已退回预扣的 1 次。' });
        }
        fail(404, '体验接口不存在');
      }
      if (route.startsWith('/api/v1/')) {
        const projectId = project();
        if (route === '/api/v1/generate' && req.method === 'POST') {
          const data = await input(9 * 1024 * 1024);
          rate(`generate:${projectId}:${typeof data.userId === 'string' ? data.userId.slice(0, 200) : ''}`, 60);
          return json(await generation.execute({ ...data, projectId }));
        }
        const delivery = route.match(/^\/api\/v1\/generation\/([^/]+)\/delivery$/);
        if (delivery && req.method === 'POST') {
          const data = await input();
          if (data.action === 'accept') return json(await generation.acceptDelivery({ projectId, id: delivery[1], userId: data.userId }));
          if (data.action === 'reject') {
            const result = generation.rejectDelivery({ projectId, id: delivery[1], userId: data.userId, reason: data.reason });
            audit('generation.refunded', { id: result.id, status: result.status });
            return json(result);
          }
          fail(400, '请选择确认交付或退回次数');
        }
        const job = route.match(/^\/api\/v1\/generation\/([^/]+)(\/content)?$/);
        if (job && req.method === 'GET') {
          if (job[2]) { const result = await generation.getContent({ projectId, id: job[1], userId: url.searchParams.get('userId') ?? undefined, index: url.searchParams.get('index') ?? 0 }); res.writeHead(200, { 'content-type': result.contentType }); return res.end(result.body); }
          return json(await generation.getJob({ projectId, id: job[1], userId: url.searchParams.get('userId') ?? undefined, refresh: true }));
        }
        if (route === '/api/v1/redeem' && req.method === 'POST') { const data = await input(); return json(quota.redeem({ ...data, projectId })); }
        if (route === '/api/v1/balance' && req.method === 'GET') return json(quota.balance({ projectId, userId: url.searchParams.get('userId') }));
        if (route === '/api/v1/usage/reserve' && req.method === 'POST') return json(quota.reserve({ ...(await input()), projectId }));
        const settle = route.match(/^\/api\/v1\/usage\/([^/]+)\/(commit|cancel)$/);
        if (settle && req.method === 'POST') return json(quota.settle({ projectId, usageId: settle[1], action: settle[2] }));
        fail(404, '接入接口不存在');
      }
      const files = { '/': 'index.html', '/admin': 'index.html', '/demo': 'index.html', '/app.js': 'app.js', '/admin-extensions.js': 'admin-extensions.js', '/combination-editor.js': 'combination-editor.js', '/platform.js': 'platform.js', '/platform.css': 'platform.css', '/style.css': 'style.css', '/shop.js': 'shop.js', '/shop.css': 'shop.css', '/assets/writing-cover.png': 'assets/writing-cover.png' };
      const filename = /^\/(?:pay|checkout|platform)\/[a-zA-Z0-9._-]+$/.test(route) ? 'index.html' : files[route];
      if (filename && req.method === 'GET') {
        const mime = filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : filename.endsWith('.png') ? 'image/png' : 'text/html';
        res.writeHead(200, { 'content-type': `${mime}; charset=utf-8` }); return res.end(await readFile(path.join(root, 'public', filename)));
      }
      fail(404, '页面不存在');
    } catch (error) {
      if (res.headersSent) { res.end(); return; }
      json({ error: error.status ? error.message : '服务内部错误，请查看本机日志' }, error.status ?? 500);
      if (!error.status) console.error(error.message);
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const expiryTimer = setInterval(() => { try { commerce.expireOrders(); } catch (error) { console.error('订单释放失败：', error.message); } }, 60000);
  expiryTimer.unref();
  let generationPoll;
  const generationTimer = setInterval(() => {
    if (generationPoll) return;
    generationPoll = generation.pollPending({ limit: 10 }).catch(() => console.error('生成任务轮询暂时失败，下次继续')).finally(() => { generationPoll = null; });
  }, 10000);
  generationTimer.unref();
  return { server, db, quota, payments, commerce, channels, platforms, generation, paymentProvider, async close() { clearInterval(expiryTimer); clearInterval(generationTimer); if (generationPoll) await generationPoll; await new Promise(resolve => server.close(resolve)); db.close(); } };
}
