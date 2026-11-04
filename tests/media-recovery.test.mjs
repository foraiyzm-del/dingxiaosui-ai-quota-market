import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { REFUND_CONFIRMED_MESSAGE, REFUND_PENDING_MESSAGE, SAVE_ATTEMPT_CAP, downloadVerdict, nextDeliveryState, nextSaveAttempts, quotaDeliveredSql, quotaJobUpdateSql, quotaRefundSql, quotaSaveCommitSql, quotaSweepWhere } from '../apps/dingxiaosui/lib/quota-media-recovery.ts';

function jobs() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE media_jobs (
    id TEXT PRIMARY KEY, provider_kind TEXT, capability TEXT, status TEXT, error TEXT,
    updated_at TEXT, outputs_json TEXT, upstream_id TEXT, key_cipher TEXT,
    delivery_state TEXT NOT NULL DEFAULT 'none', save_attempts INTEGER NOT NULL DEFAULT 0,
    refund_state TEXT NOT NULL DEFAULT 'none', poll_after INTEGER
  )`);
  return db;
}

test('a permanent 404 leaves saving and tells the user the quota was returned', () => {
  const verdict = downloadVerdict(404, 1, 'failed');
  assert.equal(verdict.terminal, true);
  assert.equal(verdict.refund, false);
  assert.match(verdict.message, /退回/);
  assert.match(verdict.message, /重新生成/);
  const db = jobs();
  db.prepare("INSERT INTO media_jobs(id,provider_kind,capability,status,key_cipher,poll_after) VALUES ('job','quota-center','image','saving','',0)").run();
  db.prepare(quotaJobUpdateSql).run('failed', verdict.message, 'now', null, null, null, 'failed', 'job', 'failed', 'failed');
  const row = db.prepare('SELECT status,error FROM media_jobs WHERE id=?').get('job');
  assert.equal(row.status, 'failed');
  assert.match(row.error, /重新生成/);
  db.prepare("INSERT INTO media_jobs(id,provider_kind,capability,status,delivery_state,key_cipher,poll_after) VALUES ('done','quota-center','image','succeeded','delivered','',0)").run();
  db.prepare(quotaJobUpdateSql).run('failed', 'no', 'now', null, null, null, 'failed', 'done', 'failed', 'failed');
  assert.equal(db.prepare('SELECT status FROM media_jobs WHERE id=?').get('done').status, 'succeeded');
});

test('the first download failure keeps saving so only the download is retried', () => {
  const first = downloadVerdict(502, 1, 'ready');
  assert.equal(first.terminal, false);
  const db = jobs();
  db.prepare("INSERT INTO media_jobs(id,provider_kind,capability,status,key_cipher,poll_after) VALUES ('job','quota-center','image','saving','',0)").run();
  if (first.terminal) db.prepare(quotaJobUpdateSql).run('failed', first.message, 'now', null, null, null, 'failed', 'job', 'failed', 'failed');
  assert.equal(db.prepare('SELECT status FROM media_jobs WHERE id=?').get('job').status, 'saving');
  const again = downloadVerdict(200, 2, 'ready');
  assert.equal(again.terminal, false);
  db.prepare(quotaJobUpdateSql).run('succeeded', null, 'now', null, 'center-job', 'center-job', 'succeeded', 'job', 'succeeded', 'succeeded');
  assert.equal(db.prepare('SELECT status FROM media_jobs WHERE id=?').get('job').status, 'succeeded');
  assert.equal(downloadVerdict(502, 4, 'ready').terminal, true);
});

test('a dropped delivery stays pending and the next accept settles the same job', () => {
  assert.equal(nextDeliveryState('pending', false), 'pending');
  assert.equal(nextDeliveryState('pending', true), 'delivered');
  assert.equal(nextDeliveryState('delivered', false), 'delivered');
  const db = jobs();
  const now = Date.now();
  db.prepare("INSERT INTO media_jobs(id,provider_kind,capability,status,delivery_state,key_cipher,poll_after) VALUES ('saved','quota-center','image','succeeded','pending','',?)").run(now);
  db.prepare("INSERT INTO media_jobs(id,provider_kind,capability,status,delivery_state,key_cipher,poll_after) VALUES ('done','quota-center','image','succeeded','delivered','',?)").run(now);
  db.prepare("INSERT INTO media_jobs(id,provider_kind,capability,status,delivery_state,key_cipher,poll_after) VALUES ('orphan','quota-center','image','succeeded','none','',?)").run(now);
  const due = db.prepare(`SELECT id FROM media_jobs WHERE ${quotaSweepWhere} ORDER BY id`).all(now + 1).map(row => row.id);
  assert.deepEqual(due, ['orphan', 'saved']);
  const jobsSource = readFileSync(new URL('../apps/dingxiaosui/lib/media-jobs.ts', import.meta.url), 'utf8');
  assert.match(jobsSource, /delivery_state:string/);
  assert.match(jobsSource, /save_attempts:number/);
  assert.match(jobsSource, /refund_state:string/);
  assert.match(jobsSource, /downloadVerdict/);
  assert.match(jobsSource, /quotaSweepWhere/);
  assert.match(jobsSource, /deliverSavedQuota/);
});

test('succeeded and pending delivery are written in one transaction', () => {
  const db = jobs();
  db.prepare("INSERT INTO media_jobs(id,provider_kind,capability,status,delivery_state,key_cipher,poll_after) VALUES ('job','quota-center','image','saving','none','',0)").run();
  db.exec('BEGIN');
  db.prepare("UPDATE media_jobs SET status='succeeded' WHERE id='job'").run();
  db.exec('ROLLBACK');
  assert.equal(db.prepare('SELECT status,delivery_state FROM media_jobs WHERE id=?').get('job').status, 'saving');
  db.prepare(quotaSaveCommitSql).run(new Date().toISOString(), '[]', 'pending', Date.now(), 'job');
  const row = db.prepare('SELECT status,delivery_state,error FROM media_jobs WHERE id=?').get('job');
  assert.equal(row.status, 'succeeded');
  assert.equal(row.delivery_state, 'pending');
  assert.equal(row.error, null);
  const source = readFileSync(new URL('../apps/dingxiaosui/lib/media-jobs.ts', import.meta.url), 'utf8');
  assert.match(source, /db\(\)\.batch\(\[db\(\)\.prepare\(quotaSaveCommitSql\)/);
});

test('a 503 thrown before the download branch still counts toward the save cap', () => {
  let attempts = 0;
  let verdict = downloadVerdict(503, attempts, 'ready');
  assert.equal(verdict.terminal, false);
  for (let i = 0; i < 8; i += 1) {
    attempts = nextSaveAttempts(attempts);
    verdict = downloadVerdict(503, attempts, 'ready');
    if (verdict.terminal) break;
  }
  assert.equal(attempts, SAVE_ATTEMPT_CAP);
  assert.equal(verdict.terminal, true);
  assert.equal(verdict.refund, true);
  const source = readFileSync(new URL('../apps/dingxiaosui/lib/media-jobs.ts', import.meta.url), 'utf8');
  const save = source.slice(source.indexOf('async function saveQuotaOutput'), source.indexOf('async function settleReadyQuota'));
  assert.ok(save.indexOf('quotaCenterContent') < save.indexOf('noteSaveAttempt'));
  assert.match(save, /catch\(error\)/);
});

test('a dropped refund stays pending and only says returned after the center confirms', () => {
  const db = jobs();
  const now = Date.now();
  db.prepare("INSERT INTO media_jobs(id,provider_kind,capability,status,key_cipher,poll_after) VALUES ('job','quota-center','image','saving','',?)").run(now);
  db.prepare(quotaRefundSql).run(REFUND_PENDING_MESSAGE, 'now', 'pending', now, 'job');
  const pending = db.prepare('SELECT status,error,refund_state FROM media_jobs WHERE id=?').get('job');
  assert.equal(pending.status, 'failed');
  assert.equal(pending.refund_state, 'pending');
  assert.doesNotMatch(pending.error, /已退回/);
  assert.deepEqual(db.prepare(`SELECT id FROM media_jobs WHERE ${quotaSweepWhere} ORDER BY id`).all(now + 1).map(row => row.id), ['job']);
  db.prepare(quotaRefundSql).run(REFUND_CONFIRMED_MESSAGE, 'later', 'refunded', now, 'job');
  const confirmed = db.prepare('SELECT error,refund_state FROM media_jobs WHERE id=?').get('job');
  assert.equal(confirmed.refund_state, 'refunded');
  assert.match(confirmed.error, /已退回/);
  assert.deepEqual(db.prepare(`SELECT id FROM media_jobs WHERE ${quotaSweepWhere}`).all(now + 1), []);
});

test('successful settlement recovery clears the previous error', () => {
  const db = jobs();
  db.prepare("INSERT INTO media_jobs(id,provider_kind,capability,status,delivery_state,error,key_cipher,poll_after) VALUES ('job','quota-center','image','succeeded','pending','作品已保存，次数确认还没完成。请稍后刷新，不会重新生成。','',0)").run();
  db.prepare(quotaDeliveredSql).run('now', Date.now() + 86400000, 'job');
  const row = db.prepare('SELECT delivery_state,error FROM media_jobs WHERE id=?').get('job');
  assert.equal(row.delivery_state, 'delivered');
  assert.equal(row.error, null);
});
