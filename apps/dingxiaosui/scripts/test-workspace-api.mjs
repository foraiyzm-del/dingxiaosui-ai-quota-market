// Uses its own temporary DB. This script never calls a model; --openai enables manual UI verification.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { parseEnv } from 'node:util';

const root = path.resolve(import.meta.dirname, '..');
process.chdir(root);
const dataDir = path.join(root, '.ecs-test', 'workspace-' + Date.now() + '-' + randomBytes(4).toString('hex'));
const portArg=process.argv.indexOf('--port'),port=portArg<0?8827:Number(process.argv[portArg+1]);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid test port');
const origin = `http://127.0.0.1:${port}`;
const standalone = path.join(root, '.next', 'standalone');
if (!fs.existsSync(path.join(standalone, 'server.js'))) throw Error('Build first: node scripts/local-handoff.mjs build');
if (process.argv.includes('--ui')) {
  fs.cpSync(path.join(root, 'public'), path.join(standalone, 'public'), { recursive: true });
  fs.cpSync(path.join(root, '.next/static'), path.join(standalone, '.next/static'), { recursive: true });
}
await new Promise((resolve, reject) => { const probe = net.createServer(); probe.once('error', reject); probe.listen(port, '127.0.0.1', () => probe.close(resolve)); });
Object.assign(process.env, { ZDX_DATA_DIR: dataDir, APP_ENV: 'production', PASSWORD_AUTH_ENABLED: '1', APP_ORIGIN: origin, AI_CONFIG_ENCRYPTION_KEY: randomBytes(32).toString('hex'), NEXT_TELEMETRY_DISABLED: '1' });
if(process.argv.includes('--openai')){
 const config=parseEnv(fs.readFileSync(path.join(root,'.env.local'),'utf8'));if(!config.OPENAI_API_KEY)throw Error('Approved local OpenAI credential missing');
 Object.assign(process.env,{OPENAI_API_KEY:config.OPENAI_API_KEY,OPENAI_MODEL:config.OPENAI_MODEL||'gpt-6.1-sol',OPENAI_GENERATION_PAUSED_REASON:config.OPENAI_GENERATION_PAUSED_REASON||'',LOCAL_OPENAI_ENABLED:'1',AI_ALLOW_PAID_FALLBACK:'false'});
}
await import('./migrate-ecs.mjs');
const { sqlite } = await import('../runtime/node-env.mjs'); sqlite().close();
let server;
async function stop() { if (server && server.exitCode === null) { const ended = once(server, 'exit'); server.kill('SIGTERM'); await ended; } }
async function start() {
  server = spawn(process.execPath, [path.join(standalone, 'server.js')], { cwd: standalone, env: { ...process.env, PORT: String(port), HOSTNAME: '127.0.0.1' }, stdio: 'ignore' });
  for (let attempt = 0; attempt < 80; attempt++) {
    if (server.exitCode !== null) throw Error('Isolated test server stopped during startup');
    try { const response = await fetch(origin + '/api/me'); if (response.status === 401) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw Error('Isolated test server did not become ready');
}
const keys = ['zidingxiang-workspace-v1', 'zidingxiang-opc-profile-v1', 'zidingxiang-opc-leads-v1'];
const entries = label => ({
  [keys[0]]: JSON.stringify({ version: 1, demo: false, products: [{ id: label, name: '验收农品' }], campaigns: [], drafts: [{ id: 'draft', productId: label, title: label, body: '隔离验收文案', channel: '朋友圈', scene: '日常种草', engine: 'template', createdAt: '2026-10-21T00:00:00.000Z' }], plans: [], knowledge: [], stock: [], sales: [], office: [], agentRuns: [], mediaProfile: {}, manualHotTopics: [] }),
  [keys[1]]: JSON.stringify({ shopName: label }), [keys[2]]: JSON.stringify([{ id: label, note: '隔离验收咨询' }]),
});
let checks = 0;
async function request(route = '/api/workspace', { cookie = '', owner = '', method = 'GET', body, from = origin, contentType = 'application/json' } = {}) {
  const response = await fetch(origin + route, { method, headers: { ...(from ? { origin: from } : {}), ...(cookie ? { cookie } : {}), ...(owner ? { 'x-zdx-workspace-owner': owner } : {}), 'content-type': contentType }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
  return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
function expect(result, status) { assert.equal(result.status, status, JSON.stringify(result.data)); checks++; return result; }
async function account() {
  const suffix = randomBytes(8).toString('hex'), username = 'sync-' + suffix, password = randomBytes(24).toString('hex');
  const login = expect(await request('/api/auth', { method: 'POST', body: { action: 'register', username, password, displayName: '工作区隔离验收' } }), 200);
  const me = expect(await request('/api/me', { cookie: login.cookie }), 200);
  return { cookie: login.cookie, owner: me.data.user.id, username, password };
}
try {
  await start();
  expect(await request(), 401);
  expect(await request('/api/workspace', { method: 'PUT', body: {} }), 401);
  const a = await account(), b = await account();
  const initial = expect(await request('/api/workspace', a), 200); assert.equal(initial.data.revision, 0);
  assert(Object.values(initial.data.entries).every(value => value === null));
  const first = expect(await request('/api/workspace', { ...a, method: 'PUT', body: { revision: 0, entries: entries('a-first') } }), 200);
  assert.equal(first.data.revision, 1);
  expect(await request('/api/workspace', { ...a, method: 'PUT', body: { revision: 0, entries: entries('a-first') } }), 200);
  const isolated = expect(await request('/api/workspace', b), 200); assert.equal(isolated.data.revision, 0);
  expect(await request('/api/workspace', { ...b, owner: a.owner, method: 'PUT', body: { revision: 0, entries: entries('wrong-owner') } }), 403);
  expect(await request('/api/workspace', { ...b, owner: a.owner }), 403);
  expect(await request('/api/workspace', { cookie: a.cookie, method: 'PUT', body: { revision: 1, entries: entries('missing-owner') } }), 400);
  expect(await request('/api/workspace', { ...a, method: 'PUT', from: 'https://untrusted.invalid', body: { revision: 1, entries: entries('csrf') } }), 403);
  expect(await request('/api/workspace', { ...a, method: 'PUT', from: '', body: { revision: 1, entries: entries('no-origin') } }), 403);
  const concurrent = await Promise.all(['device-one', 'device-two'].map(label => request('/api/workspace', { ...a, method: 'PUT', body: { revision: 1, entries: entries(label) } })));
  assert.deepEqual(concurrent.map(item => item.status).sort(), [200, 409]); checks += 2;
  const winner = concurrent.find(item => item.status === 200).data;
  const current = expect(await request('/api/workspace', a), 200); assert.deepEqual(current.data, winner);
  expect(await request('/api/workspace', { ...a, method: 'PUT', body: { revision: 2, entries: entries('forged'), userId: b.owner } }), 400);
  expect(await request('/api/workspace', { ...a, method: 'PUT', body: { revision: 2, entries: { ...entries('extra'), unknown: '[]' } } }), 400);
  expect(await request('/api/workspace', { ...a, method: 'PUT', body: { revision: -1, entries: entries('negative') } }), 400);
  expect(await request('/api/workspace', { ...a, method: 'PUT', body: { revision: 2, entries: { ...entries('bad-json'), [keys[0]]: '{' } } }), 400);
  expect(await request('/api/workspace', { ...a, method: 'PUT', body: { revision: 2, entries: { ...entries('invalid-array'), [keys[0]]: JSON.stringify({ products: 'invalid', campaigns: [], drafts: [], plans: [] }) } } }), 400);
  expect(await request('/api/workspace', { ...a, method: 'PUT', body: '{' }), 400);
  expect(await request('/api/workspace', { ...a, method: 'PUT', contentType: 'text/plain', body: '{}' }), 415);
  expect(await request('/api/workspace', { ...a, method: 'PUT', body: ' '.repeat(6 * 1024 * 1024 + 1) }), 413);
  const bSave = expect(await request('/api/workspace', { ...b, method: 'PUT', body: { revision: 0, entries: entries('b-only') } }), 200);
  assert.deepEqual((await request('/api/workspace', a)).data, winner);
  await stop(); await start();
  assert.deepEqual(expect(await request('/api/workspace', a), 200).data, winner);
  assert.deepEqual(expect(await request('/api/workspace', b), 200).data, bSave.data);
  expect(await request('/api/auth', { cookie: a.cookie, method: 'POST', body: { action: 'logout' } }), 200);
  expect(await request('/api/workspace', { ...a, method: 'PUT', body: { revision: winner.revision, entries: entries('logged-out') } }), 401);
  if(process.argv.includes('--openai')&&process.env.OPENAI_GENERATION_PAUSED_REASON){
    const status=expect(await request('/api/dialogue',b),200);assert.equal(status.data.connected,false);assert.equal(status.data.reason,process.env.OPENAI_GENERATION_PAUSED_REASON);
    const blocked=expect(await request('/api/dialogue',{...b,method:'POST',body:{consent:true,message:'暂停状态不调用模型',taskId:'general',revision:bSave.data.revision}}),503);assert.equal(blocked.data.error,process.env.OPENAI_GENERATION_PAUSED_REASON);
    assert(!JSON.stringify(status.data).includes(process.env.OPENAI_API_KEY));
  }
  if (process.argv.includes('--ui')) {
    const credentials = path.join(dataDir, 'ui-credentials.json');
    fs.writeFileSync(credentials, JSON.stringify({ username: b.username, password: b.password }), { mode: 0o600 });
    console.log('HTTP checks passed. Isolated UI fixture ready at ' + origin + '; private credentials file: ' + credentials);
    await new Promise(resolve => { process.once('SIGTERM', resolve); process.once('SIGINT', resolve); });
  }
  await stop();
  const database = new DatabaseSync(path.join(dataDir, 'zdx.sqlite'), { readOnly: true });
  assert.equal(database.prepare('PRAGMA foreign_key_check').all().length, 0);
  assert.equal(database.prepare('SELECT count(*) AS n FROM account_workspaces').get().n, 2); database.close(); checks += 2;
  console.log('PASS:', checks, 'isolated HTTP/database checks: per-account persistence, restart, optimistic concurrency, lost acknowledgement retry, identity binding, logout, CSRF, bounded input and validation. No model calls.');
} finally {
  await stop();
  if (path.dirname(dataDir) === path.join(root, '.ecs-test') && path.basename(dataDir).startsWith('workspace-')) fs.rmSync(dataDir, { recursive: true, force: true });
}
