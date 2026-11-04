import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const source = path.resolve(process.argv[2] || 'local/center.sqlite');
const folder = path.resolve(process.argv[3] || 'local/backups');
await mkdir(folder, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = path.join(folder, `${path.basename(source, '.sqlite')}-${stamp}.sqlite`);
if (target.includes("'")) throw new Error('备份路径不能包含单引号');
const db = new DatabaseSync(source);
try {
  db.exec('PRAGMA busy_timeout=15000;');
  if (typeof db.backup === 'function') await db.backup(target);
  else db.exec(`VACUUM INTO '${target}'`);
  console.log(`已备份 ${source} → ${target}`);
  console.log('请同时保管 local/config.json 里的加密主密钥。只复制数据库、不复制密钥，备份无法解密渠道密钥和卡密。');
} finally { db.close(); }
