import { cp, mkdir, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const result = spawnSync(process.execPath, [join(root, 'build-static.mjs')], { cwd: root, stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status || 1);
const source = join(root, 'dist');
const target = process.argv[2] ? resolve(process.argv[2]) : join(root, 'public');
await mkdir(target, { recursive: true });
for (const item of await readdir(source)) await cp(join(source, item), join(target, item), { force: true, recursive: true });
console.log('已同步官网静态页面到 public/');
