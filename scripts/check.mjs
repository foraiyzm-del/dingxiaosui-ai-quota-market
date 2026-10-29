import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
let count = 0;
for (const folder of ['sidecar', 'scripts', 'sdk', 'public']) {
  for (const file of readdirSync(path.join(root, folder))) {
    if (!/\.(mjs|js)$/.test(file)) continue;
    const result = spawnSync(process.execPath, ['--check', path.join(root, folder, file)], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status || 1);
    count++;
  }
}
console.log(`${count} 个 JavaScript 文件语法检查通过。`);
