import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createQuota } from '../sidecar/quota.mjs';

test('original ten-character SHA256 cards redeem once and retain their media profile and consumed balance', t => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const quota = createQuota(db), projectId = 'dingxiaosui', userId = 'existing-card-owner';
  quota.createProject({ id: projectId, name: 'Isolated legacy-card test' });
  quota.createProject({ id: 'other', name: 'Other project' });
  const spec = {
    video: { seconds: 5, resolution: '720p', audio: false }, tier: 'leader',
    models: { text: 'claude-sonnet-5-5', image: 'gpt-image-2.5-flare', video: 'seedance-2.5' },
  };
  quota.generateCodes({ projectId, quantity: 1, quota: { text: 10, image: 15, video: 2 }, mediaSpec: spec, numbered: true });
  const row = db.prepare('SELECT * FROM quota_codes').get();
  const shortCode = 'AB23CD45EF';
  // Production's original issuer stored SHA256 of the bare uppercase code.
  // Seed that format directly instead of relying on today's code generator.
  db.prepare('UPDATE quota_codes SET code_hash=?, code_suffix=? WHERE id=?')
    .run(createHash('sha256').update(shortCode).digest('hex'), shortCode.slice(-4), row.id);
  assert.throws(() => quota.redeem({ projectId: 'other', code: shortCode, userId }), { status: 404 });
  const first = quota.redeem({ projectId, code: ' ab23-cd45 ef ', userId, idempotent: true });
  assert.equal(first.codeId, row.id);
  assert.deepEqual(first.quota, { text: 10, image: 15, video: 2 });
  const reserved = quota.reserve({ projectId, userId, requestId: 'one-text', capability: 'text' });
  quota.settle({ projectId, usageId: reserved.usage.id, action: 'commit' });
  const replay = quota.redeem({ projectId, code: shortCode, userId, idempotent: true });
  assert.equal(replay.codeId, row.id);
  assert.equal(replay.replayed, true);
  assert.equal(replay.balance.byCapability.text.available, 9);
  assert.equal(replay.balance.byCapability.text.consumed, 1);
  assert.equal(replay.balance.byCapability.image.available, 15);
  assert.equal(replay.balance.byCapability.video.available, 2);
  assert.throws(() => quota.redeem({ projectId, code: shortCode, userId: 'different-owner', idempotent: true }), { status: 409 });
  assert.equal(db.prepare('SELECT media_spec_json FROM quota_codes WHERE id=?').get(row.id).media_spec_json, row.media_spec_json);
  assert.deepEqual(quota.findByCardNumber(row.card_number).mediaSpec, spec);
  assert.equal(quota.stats().redeemedCodeCount, 1);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});
