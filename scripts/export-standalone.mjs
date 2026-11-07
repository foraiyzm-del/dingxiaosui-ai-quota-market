// Reviewed-file export only. Never recurse through a source tree or copy runtime state.
import { lstat, realpath, readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const inFolder = (folder, names) => names.trim().split(/\s+/u).map(name => `${folder}/${name}`);
const sourceFiles = [
  'package.json', 'package-lock.json', 'LICENSE', 'SECURITY.md', 'THIRD_PARTY_NOTICES.md', '.gitignore',
  ...inFolder('sidecar', `activation-codes.mjs apimart-relay-auth.mjs apimart-upload-url.d.mts apimart-upload-url.mjs
    apimart.mjs channel-budgets.mjs channels.mjs commerce.mjs generation-options.mjs generation.mjs image.mjs
    inventory.mjs leader-batch.mjs media-spec.mjs model-access.mjs model-tiers.mjs opcpay-client.mjs opcpay.mjs
    payment-provider.mjs payments.mjs platforms.mjs quota-values.mjs quota.mjs sample-catalog.mjs storefront-catalog.mjs
    sample-generation.mjs sample-packages.mjs sample-platforms.mjs server.mjs site-settings.mjs
    upstream-body.mjs upstream-dns.mjs zip-store.mjs`),
  ...inFolder('public', `admin-extensions.js app.js combination-editor.js index.html opcpay.css opcpay.html
    opcpay.js opcpay-state.js platform.css platform.js shop.css shop.js style.css assets/writing-cover.png assets/mock-image.png assets/mock-video.mp4`),
  'sdk/client.mjs',
  ...inFolder('scripts', `backup-sqlite.mjs bootstrap-dingxiaosui.mjs check.mjs export-standalone.mjs
    opcpay-demo-model.mjs opcpay-mock.mjs probe-opcpay.mjs setup-opcpay.mjs setup.mjs start.mjs start-multiproject-demo.mjs start-opcpay-packages-demo.mjs`),
  ...inFolder('tests', `apimart-reference-upload.test.mjs apimart-relay-auth.test.mjs apimart.test.mjs
    bootstrap-dingxiaosui.test.mjs channel-budget-http.test.mjs channel-budgets.test.mjs channels.test.mjs
    combination-flow.test.mjs commerce.test.mjs generation-transport.test.mjs generation.test.mjs
    inventory.test.mjs leader-experience.test.mjs leader-load.test.mjs legacy-shortcode-compatibility.test.mjs
    model-access-relay.test.mjs multiproject-flow.test.mjs opcpay-client.test.mjs opcpay-core.test.mjs
    opcpay-demo-model.test.mjs opcpay-http.test.mjs opcpay-mock.test.mjs opcpay-page.test.mjs payment-provider.test.mjs payments-review.test.mjs payments.test.mjs
    platform-readiness.test.mjs portal-delivery.test.mjs project-export.test.mjs quota.test.mjs reasoning-access.test.mjs
    reference-upload-retry.test.mjs server.test.mjs shop-projects.test.mjs sku-api.test.mjs
    standalone-export.test.mjs typed-quota.test.mjs upstream-dns.test.mjs video-duration.test.mjs whole-flow.test.mjs`),
  ...inFolder('docs', `integration.md apimart-integration.md opcpay-provider-contract.md opcpay-live-acceptance-20261107.md standalone-payment-connected-20261107.md standalone-integration.md standalone-README.md`),
];
const optionalFiles = ['docs/standalone-acceptance-20261107.md'];
export const omittedTests = Object.freeze([
  { path: 'tests/dingxiaosui-attached.test.mjs', reason: '验证独立丁小穗应用的快照、私有数据与子进程启动；完整仓库提供该应用启动器。' },
  { path: 'tests/demo-guards.test.mjs', reason: '混合中心和丁小穗测试，直接导入 apps/dingxiaosui/lib/apimart-protocol.ts；保留在完整仓库运行。' },
  { path: 'tests/media-recovery.test.mjs', reason: '验证丁小穗媒体持久化与恢复，直接导入并读取 apps/dingxiaosui/lib 源码。' },
  { path: 'tests/static-build.test.mjs', reason: '运行丁小穗静态站点构建；同文件含一个健康检查小测试，完整文件保留在原仓库而不拆改。' },
  { path: 'tests/studio-reference-selection.test.mjs', reason: '读取丁小穗 Studio React 页面和参考图片实现，属于业务应用前端回归。' },
  { path: 'tests/upstream-body.test.mjs', reason: '比较中心与丁小穗的 SSE/APIMart 协议实现，直接导入 apps 源码；中心生成协议另有独立回归。' },
]);
const omissions = [
  { path: 'apps/**', reason: '业务应用独立部署；本包只发布发卡与额度中心。' },
  { path: '**/local/**, **/data/**, **/.env*, **/*.sqlite*, **/*.db*, **/*.key, **/*.pem', reason: '运行数据、凭证、卡密和数据库不属于源码交付。' },
  { path: 'node_modules/**, .git/**, artifacts/**, runtime/**, vendor/**', reason: '安装依赖、仓库元数据、验收输出与下载缓存不进入源码包。' },
  { path: 'scripts/start-dingxiaosui.mjs, scripts/start-dingxiaosui-attached.mjs, scripts/start-opcpay-demo.mjs, scripts/test-dingxiaosui-integration.mjs, scripts/serve-media-regression.mjs', reason: '业务应用启动、联合启动、跨系统验收与媒体回归需要 apps/dingxiaosui。' },
  { path: 'scripts/accept-apimart-live.mjs, scripts/issue-leader-cards.mjs, scripts/prod-healthcheck.mjs', reason: '特定部署的真实上游验收、领导卡运维或双服务健康检查，不是通用独立中心入口。' },
  { path: 'scripts/health-status.mjs, scripts/service-identity.mjs', reason: '仅被未导出的双服务脚本或混合测试使用。' },
  { path: 'README.md, CONTRIBUTING.md, docs/DEPLOY.md, docs/opcpay-integration.md, docs/opcpay-acceptance-20261107.md, docs/superpowers/**', reason: '原文面向合并仓库或历史验收；独立 README 与接入说明替代其安装指引，协议文档保留。' },
  { path: '其他未列入逐文件 allowlist 的文件', reason: '新增文件需主动审查后加入，不能因扩展名像源码就自动发布。' },
];

async function noLinks(absolute) {
  const parsedRoot = path.parse(absolute).root;
  let current = parsedRoot;
  for (const component of path.relative(parsedRoot, absolute).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw new Error('导出拒绝符号链接或目录联接');
  }
}
async function reviewedFile(sourceDir, relative, optional = false) {
  const absolute = path.join(sourceDir, relative);
  try { await noLinks(absolute); }
  catch (error) { if (optional && error.code === 'ENOENT') return null; throw error; }
  const info = await lstat(absolute);
  if (!info.isFile()) throw new Error(`allowlist 项不是普通文件：${relative}`);
  const resolved = await realpath(absolute), relativeReal = path.relative(sourceDir, resolved);
  if (relativeReal.startsWith('..' + path.sep) || path.isAbsolute(relativeReal)) throw new Error('allowlist 文件超出源目录');
  return { path: relative, source: relative, bytes: await readFile(absolute) };
}
function auditReferences(entries) {
  const included = new Set(entries.map(entry => entry.path));
  for (const entry of entries) {
    if (!/\.(?:mjs|js)$/u.test(entry.path)) continue;
    const text = entry.bytes.toString('utf8');
    // The exporter and its own boundary tests deliberately mention excluded paths.
    if (['scripts/export-standalone.mjs', 'tests/standalone-export.test.mjs'].includes(entry.path)) continue;
    if (/['"`](?:\.\.?[\\/])*apps[\\/]|\b(?:join|resolve)\([^\n]*['"]apps['"]/u.test(text)) {
      throw new Error(`独立代码仍引用 apps 丁小穗源码：${entry.path}`);
    }
    for (const match of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.[^'"]+)\1/gu)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(entry.path), match[2]));
      if (!included.has(target)) throw new Error(`相对模块引用未包含在 allowlist：${entry.path} -> ${target}`);
    }
  }
  const pkg = JSON.parse(entries.find(entry => entry.path === 'package.json').bytes.toString('utf8'));
  for (const name of ['setup', 'start', 'check']) {
    const command = pkg.scripts?.[name];
    if (!/^node scripts\/[A-Za-z0-9.-]+\.mjs$/u.test(command ?? '') || !included.has(command.slice(5))) {
      throw new Error(`独立包 npm ${name} 入口未包含或已变化，请审查 allowlist`);
    }
  }
  if (pkg.scripts?.test !== 'node --test tests/*.test.mjs') throw new Error('npm test 入口已变化，请审查独立测试清单');
}

export async function exportStandalone({ sourceDir = root, destination } = {}) {
  if (typeof destination !== 'string' || !destination.trim()) throw new Error('必须指定不存在的目标目录：--dest <directory>');
  sourceDir = path.resolve(sourceDir); destination = path.resolve(destination);
  try { await lstat(destination); throw new Error('目标目录已存在；导出不会覆盖或合并任何目录'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await noLinks(sourceDir); await noLinks(path.dirname(destination));
  sourceDir = await realpath(sourceDir);
  await noLinks(path.join(sourceDir, 'tests'));
  const reviewedTests = new Set([...sourceFiles.filter(name => name.startsWith('tests/')), ...omittedTests.map(row => row.path)]);
  for (const entry of await readdir(path.join(sourceDir, 'tests'), { withFileTypes: true })) {
    if (entry.name.endsWith('.test.mjs') && !reviewedTests.has(`tests/${entry.name}`)) {
      throw new Error(`发现未分类测试：tests/${entry.name}；请决定纳入或明确记录剔除原因`);
    }
  }
  const entries = [];
  for (const relative of sourceFiles) entries.push(await reviewedFile(sourceDir, relative));
  const optionalFilesMissing = [];
  for (const relative of optionalFiles) {
    const entry = await reviewedFile(sourceDir, relative, true);
    if (entry) entries.push(entry); else optionalFilesMissing.push(relative);
  }
  const readme = entries.find(entry => entry.path === 'docs/standalone-README.md');
  entries.push({ ...readme, path: 'README.md' });
  auditReferences(entries);
  // Finish every source/link/dependency check before the first destination write.
  await mkdir(destination);
  for (const entry of entries) {
    const target = path.join(destination, entry.path);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, entry.bytes, { flag: 'wx' });
  }
  const manifest = { format: 1, packageVersion: JSON.parse(entries.find(entry => entry.path === 'package.json').bytes).version,
    files: entries.map(entry => ({ path: entry.path, source: entry.source, bytes: entry.bytes.length,
      sha256: createHash('sha256').update(entry.bytes).digest('hex') })).sort((a, b) => a.path.localeCompare(b.path)),
    omittedTests, omittedPaths: omissions, optionalFilesMissing,
    notes: ['逐文件 allowlist；不扫描或读取排除的私有目录。', '业务应用耦合测试保留在完整仓库，不代表独立包中执行或通过。',
      '独立 README 替代合并仓库 README；package.json 与 package-lock.json 原字节复制。'] };
  await writeFile(path.join(destination, 'docs/standalone-export-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  return { destination, fileCount: entries.length, testFileCount: entries.filter(entry => entry.path.startsWith('tests/')).length,
    omittedTestCount: omittedTests.length, optionalFilesMissing };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 2 || args[0] !== '--dest') throw new Error('用法：node scripts/export-standalone.mjs --dest <不存在的目录>');
    const result = await exportStandalone({ destination: args[1] });
    console.log(`独立中心已导出：${result.destination}`);
    console.log(`${result.fileCount} 个文件，${result.testFileCount} 个独立测试文件；明确剔除 ${result.omittedTestCount} 个应用耦合测试。`);
    if (result.optionalFilesMissing.length) console.log('可选文档不存在，已在 manifest 记录：' + result.optionalFilesMissing.join(', '));
    console.log('下一步在目标目录运行 npm ci、npm test、npm run check；启动使用 npm start。');
  } catch (error) { console.error('导出失败：' + error.message); process.exitCode = 1; }
}
