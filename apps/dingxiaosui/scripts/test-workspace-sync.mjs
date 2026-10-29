import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const context = { window: {}, AbortSignal, setTimeout: () => 1, clearTimeout() {} };
vm.runInNewContext(fs.readFileSync(new URL('../workspace-sync.js', import.meta.url), 'utf8'), context);
const create = context.window.createZdxWorkspaceSync;
const keys = ['zidingxiang-workspace-v1', 'zidingxiang-opc-profile-v1', 'zidingxiang-opc-leads-v1'];
const empty = () => Object.fromEntries(keys.map(key => [key, null]));
const fixture = label => ({ ...empty(), [keys[0]]: JSON.stringify({ products: [{ id: label }], campaigns: [], drafts: [], plans: [] }) });
const prefix = 'zdx-workspace-v2:account%3Atest:';
const store = () => { const data = new Map(); return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) }; };
function backend() {
  return { revision: 0, entries: empty(), offline: false, loseAck: false, rejectOwner: false, pause: null, calls: [],
    async request(_url, options) {
      this.calls.push(options.method);
      assert.equal(options.headers['x-zdx-workspace-owner'], 'test');
      if (this.offline) throw Error('offline');
      if (this.rejectOwner) return Response.json({ error: '账号已改变' }, { status: 403 });
      if (options.method === 'GET') return Response.json({ revision: this.revision, entries: this.entries });
      const body = JSON.parse(options.body);
      if (this.pause) await this.pause;
      if (body.revision !== this.revision && JSON.stringify(body.entries) !== JSON.stringify(this.entries)) return Response.json({ error: '版本冲突，保留两份资料' }, { status: 409 });
      if (body.revision === this.revision) { this.revision++; this.entries = body.entries; }
      if (this.loseAck) { this.loseAck = false; throw Error('lost acknowledgement'); }
      return Response.json({ revision: this.revision, entries: this.entries });
    },
  };
}
function device(server, local = store()) {
  const statuses = [];
  const sync = create({ storage: local, prefix, ownerId: 'test', request: server.request.bind(server), onStatus: value => statuses.push(value) });
  return { sync, local, statuses, change(value, key = keys[0]) { sync.beforeChange(key); local.setItem(prefix + key, value); sync.afterChange(key); } };
}
const checks = [];
const check = name => checks.push(name);

const server = backend(), a = device(server);
await a.sync.hydrate(); a.change(fixture('first')[keys[0]]); await a.sync.flush();
assert.equal(a.sync.state().dirty, false); assert.equal(server.revision, 1);
const second = device(server); await second.sync.hydrate();
assert.equal(second.local.getItem(prefix + keys[0]), fixture('first')[keys[0]]);
check('a fresh device reads account data from the server');

a.change(fixture('device-a')[keys[0]]); second.change(fixture('device-b')[keys[0]]);
await a.sync.flush(); await second.sync.flush();
assert.equal(second.sync.state().phase, 'conflict'); assert.equal(server.entries[keys[0]], fixture('device-a')[keys[0]]);
assert.equal(second.sync.localEntries()[keys[0]], fixture('device-b')[keys[0]]);
await second.sync.acceptRemote(); assert.equal(second.local.getItem(prefix + keys[0]), server.entries[keys[0]]);
check('concurrent devices preserve both versions until explicit resolution');

server.offline = true; a.change(fixture('offline-edit')[keys[0]]); await a.sync.flush();
assert.equal(a.sync.state().dirty, true); assert.equal(a.sync.state().phase, 'offline');
const reopened = device(server, a.local); await reopened.sync.hydrate();
assert.equal(reopened.sync.state().dirty, true);
server.offline = false; await reopened.sync.retry();
assert.equal(reopened.sync.state().dirty, false); assert.equal(server.entries[keys[0]], fixture('offline-edit')[keys[0]]);
check('offline changes survive a reload and upload when connection returns');

let release; server.pause = new Promise(resolve => { release = resolve; });
reopened.change(fixture('in-flight')[keys[0]]); const sending = reopened.sync.flush();
reopened.change(fixture('newer-edit')[keys[0]]); release(); await sending; server.pause = null;
assert.equal(reopened.sync.state().dirty, true); await reopened.sync.flush();
assert.equal(server.entries[keys[0]], fixture('newer-edit')[keys[0]]); assert.equal(reopened.sync.state().dirty, false);
check('edits made during upload are saved in a subsequent revision');

server.loseAck = true; reopened.change(fixture('ack-lost')[keys[0]]); await reopened.sync.flush();
assert.equal(reopened.sync.state().dirty, true); await reopened.sync.retry(); assert.equal(reopened.sync.state().dirty, false);
check('a lost save acknowledgement can be retried safely');

const stale = device(server); await stale.sync.hydrate(); stale.local.setItem(prefix + keys[0], fixture('other-tab')[keys[0]]);
assert.throws(() => stale.change(fixture('stale-overwrite')[keys[0]]), /标签页/);
assert.equal(stale.local.getItem(prefix + keys[0]), fixture('other-tab')[keys[0]]);
check('a stale browser tab cannot overwrite a newer local cache');

const legacyServer = backend(), legacy = device(legacyServer);
legacy.local.setItem(prefix + keys[0], fixture('existing-local')[keys[0]]);
const migration = device(legacyServer, legacy.local); await migration.sync.hydrate(); await migration.sync.flush();
assert.equal(legacyServer.entries[keys[0]], fixture('existing-local')[keys[0]]);
const unknown = device(legacyServer); unknown.local.setItem(prefix + keys[0], fixture('other-local')[keys[0]]);
const conflict = device(legacyServer, unknown.local); await conflict.sync.hydrate(); await conflict.sync.flush();
assert.equal(conflict.sync.state().phase, 'conflict'); assert.equal(legacyServer.revision, 1);
check('legacy cache migrates only into an empty server workspace');

const watcher = device(server); await watcher.sync.hydrate();
server.entries = fixture('remote-update'); server.revision++;
await watcher.sync.refresh(); assert.equal(watcher.sync.state().phase, 'remote');
assert.notEqual(watcher.local.getItem(prefix + keys[0]), server.entries[keys[0]]);
check('remote changes prompt before replacing the open page');

const switched = device(server); await switched.sync.hydrate(); switched.change(fixture('must-not-cross-accounts')[keys[0]]);
server.rejectOwner = true; await switched.sync.flush();
assert.equal(switched.sync.state().phase, 'auth'); assert.equal(switched.sync.state().dirty, true);
assert.equal(server.entries[keys[0]], fixture('remote-update')[keys[0]]);
check('account changes stop queued writes and preserve the cache');

const quota = device(backend()); await quota.sync.hydrate();
quota.local.setItem = () => { throw Error('QuotaExceededError'); };
assert.throws(() => quota.change(fixture('not-persisted')[keys[0]]), /QuotaExceeded/);
assert.equal(quota.local.getItem(prefix + keys[0]), null);
check('cache quota failures do not masquerade as successful writes');
console.log('PASS:', checks.length, 'workspace sync scenarios\n' + checks.map(name => '- ' + name).join('\n'));
