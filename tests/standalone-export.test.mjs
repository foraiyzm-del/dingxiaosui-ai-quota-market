import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync, existsSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { exportStandalone } from '../scripts/export-standalone.mjs';

const repository = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
function temporary(t) {
  const folder = mkdtempSync(path.join(tmpdir(), 'standalone-export-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  return folder;
}
function files(folder, prefix = '') {
  return readdirSync(path.join(folder, prefix), { withFileTypes: true }).flatMap(entry => {
    const relative = [prefix, entry.name].filter(Boolean).join('/');
    assert.equal(lstatSync(path.join(folder, relative)).isSymbolicLink(), false);
    return entry.isDirectory() ? files(folder, relative) : [relative];
  });
}
async function sourceFixture(t) {
  const folder = temporary(t), sourceDir = path.join(folder, 'source');
  await exportStandalone({ sourceDir: repository, destination: sourceDir });
  return { folder, sourceDir, destination: path.join(folder, 'exported') };
}

test('standalone export preserves packages, licenses, runnable references, and explicit test omissions without any app source', async t => {
  const folder = temporary(t), destination = path.join(folder, 'standalone');
  const result = await exportStandalone({ sourceDir: repository, destination });
  for (const name of ['package.json', 'package-lock.json', 'LICENSE']) {
    assert.deepEqual(readFileSync(path.join(destination, name)), readFileSync(path.join(repository, name)));
  }
  assert.deepEqual(readFileSync(path.join(destination, 'README.md')), readFileSync(path.join(repository, 'docs/standalone-README.md')));
  for (const name of ['sidecar/server.mjs', 'sidecar/opcpay.mjs', 'public/index.html', 'public/opcpay.html', 'sdk/client.mjs',
    'scripts/start.mjs', 'scripts/setup.mjs', 'scripts/start-multiproject-demo.mjs', 'scripts/setup-opcpay.mjs',
    'docs/integration.md', 'docs/standalone-integration.md', 'docs/opcpay-provider-contract.md',
    'tests/opcpay-core.test.mjs', 'tests/multiproject-flow.test.mjs', 'tests/project-export.test.mjs', 'tests/shop-projects.test.mjs']) {
    assert.ok(existsSync(path.join(destination, name)), name);
  }
  const inventory = files(destination);
  assert.ok(!inventory.some(name => /(^|\/)(apps|local|node_modules|\.git|artifacts)(\/|$)|\.(sqlite|db|key|pem)$|(^|\/)\.env/.test(name)));
  const manifest = JSON.parse(readFileSync(path.join(destination, 'docs/standalone-export-manifest.json'), 'utf8'));
  assert.equal(manifest.files.length, result.fileCount);
  const omitted = manifest.omittedTests.map(row => row.path).sort();
  assert.deepEqual(omitted, ['tests/demo-guards.test.mjs', 'tests/dingxiaosui-attached.test.mjs', 'tests/media-recovery.test.mjs', 'tests/static-build.test.mjs',
    'tests/studio-reference-selection.test.mjs', 'tests/upstream-body.test.mjs'].sort());
  assert.ok(manifest.omittedTests.every(row => row.reason.length > 15));
  const pkg = JSON.parse(readFileSync(path.join(destination, 'package.json'), 'utf8'));
  for (const command of ['start', 'setup', 'check']) {
    assert.ok(existsSync(path.join(destination, pkg.scripts[command].replace(/^node /, ''))));
  }
  const checked = spawnSync(process.execPath, ['scripts/check.mjs'], { cwd: destination, encoding: 'utf8' });
  assert.equal(checked.status, 0, checked.stderr || checked.stdout);
});

test('standalone allowlist ignores private files and unlisted links even when they look like source or assets', async t => {
  const { folder, sourceDir, destination } = await sourceFixture(t);
  const sentinel = `PRIVATE_${randomUUID()}`;
  const privateFiles = ['.env', 'local/customer.sqlite', 'node_modules/private.js', 'apps/private.mjs', 'artifacts/orders.json',
    '.git/private-config', 'sidecar/private-backup.mjs', 'public/assets/private.png', 'sdk/customer.key'];
  for (const relative of privateFiles) {
    mkdirSync(path.dirname(path.join(sourceDir, relative)), { recursive: true });
    writeFileSync(path.join(sourceDir, relative), sentinel);
  }
  const outside = path.join(folder, 'private-outside'); mkdirSync(outside);
  writeFileSync(path.join(outside, 'secret.txt'), sentinel);
  symlinkSync(outside, path.join(sourceDir, 'public/unreviewed-link'), process.platform === 'win32' ? 'junction' : 'dir');
  await exportStandalone({ sourceDir, destination });
  for (const relative of privateFiles) assert.equal(existsSync(path.join(destination, relative)), false, relative);
  for (const relative of files(destination)) assert.equal(readFileSync(path.join(destination, relative)).includes(Buffer.from(sentinel)), false, relative);
});

test('standalone export refuses existing destinations and reviewed symlink paths before writing anything', async t => {
  const { folder, sourceDir, destination } = await sourceFixture(t);
  mkdirSync(destination); writeFileSync(path.join(destination, 'keep.txt'), 'preserve existing destination');
  await assert.rejects(() => exportStandalone({ sourceDir, destination }), /目标目录已存在/);
  assert.equal(readFileSync(path.join(destination, 'keep.txt'), 'utf8'), 'preserve existing destination');
  const outside = path.join(folder, 'outside-sdk'); mkdirSync(outside); writeFileSync(path.join(outside, 'client.mjs'), 'PRIVATE_SENTINEL');
  rmSync(path.join(sourceDir, 'sdk'), { recursive: true });
  symlinkSync(outside, path.join(sourceDir, 'sdk'), process.platform === 'win32' ? 'junction' : 'dir');
  const fresh = path.join(folder, 'must-not-exist');
  await assert.rejects(() => exportStandalone({ sourceDir, destination: fresh }), /符号链接|联接/);
  assert.equal(existsSync(fresh), false);
});

test('standalone export fails visibly for new unreviewed tests, app coupling, and missing module dependencies', async t => {
  const { folder, sourceDir } = await sourceFixture(t);
  const unknown = path.join(sourceDir, 'tests/unreviewed.test.mjs'); writeFileSync(unknown, "import 'node:test';");
  await assert.rejects(() => exportStandalone({ sourceDir, destination: path.join(folder, 'unknown-test') }), /未分类测试/);
  rmSync(unknown);
  const target = path.join(sourceDir, 'tests/quota.test.mjs'), original = readFileSync(target, 'utf8');
  writeFileSync(target, original + "\nimport '../apps/dingxiaosui/private.mjs';\n");
  await assert.rejects(() => exportStandalone({ sourceDir, destination: path.join(folder, 'coupled') }), /丁小穗源码|apps/);
  writeFileSync(target, original + "\nimport '../sidecar/missing-reviewed-module.mjs';\n");
  await assert.rejects(() => exportStandalone({ sourceDir, destination: path.join(folder, 'missing-module') }), /引用未包含/);
});
