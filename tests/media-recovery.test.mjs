import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { downloadVerdict, nextDeliveryState, quotaJobUpdateSql, quotaSweepWhere } from '../apps/dingxiaosui/lib/quota-media-recovery.ts';

function jobs() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE media_jobs (
    id TEXT PRIMARY KEY, provider_kind TEXT, capability TEXT, status TEXT, error TEXT,
    updated_at TEXT, outputs_json TEXT, upstream_id TEXT, key_cipher TEXT,
    delivery_state TEXT NOT NULL DEFAULT 'none', save_attempts INTEGER NOT NULL DEFAULT 0, poll_after INTEGER
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
  const due = db.prepare(`SELECT id FROM media_jobs WHERE ${quotaSweepWhere} ORDER BY id`).all(now + 1).map(row => row.id);
  assert.deepEqual(due, ['saved']);
  const jobsSource = readFileSync(new URL('../apps/dingxiaosui/lib/media-jobs.ts', import.meta.url), 'utf8');
  assert.match(jobsSource, /downloadVerdict/);
  assert.match(jobsSource, /quotaSweepWhere/);
  assert.match(jobsSource, /deliverSavedQuota/);
});
