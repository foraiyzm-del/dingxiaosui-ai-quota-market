import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { recentJobsOk } from '../scripts/health-status.mjs';

const app = path.resolve('apps/dingxiaosui');

test('a clean static build leaves the published dialogue and event scripts unchanged', () => {
  const out = mkdtempSync(path.join(tmpdir(), 'zdx-public-'));
  const result = spawnSync(process.execPath, ['scripts/sync-public.mjs', out], { cwd: app, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  for (const name of ['dialogue-ui.js', 'event-access.js']) {
    assert.equal(readFileSync(path.join(out, name), 'utf8'), readFileSync(path.join(app, 'public', name), 'utf8'), name);
  }
  const dialogue = readFileSync(path.join(out, 'dialogue-ui.js'), 'utf8');
  assert.match(dialogue, /Array\.isArray\(retry\?\.history\)/);
  assert.match(dialogue, /history \}\)/);
  assert.doesNotMatch(dialogue, /history:thread\.messages\.slice/);
  assert.match(dialogue, /重试本次，不重复扣次/);
  assert.match(dialogue, /高清视频可能要 2–8 分钟/);
  assert.match(readFileSync(path.join(out, 'event-access.js'), 'utf8'), /maxlength="120"/);
});

test('health check is not ok when any recent job is uncertain', () => {
  assert.equal(recentJobsOk(0, 0), true);
  assert.equal(recentJobsOk(0, 1), false);
  assert.equal(recentJobsOk(2, 0), false);
});
