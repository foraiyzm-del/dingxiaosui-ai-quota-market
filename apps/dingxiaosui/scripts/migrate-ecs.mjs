import fs from 'node:fs';
import path from 'node:path';
import {sqlite} from '../runtime/node-env.mjs';
const db=sqlite();
db.exec('CREATE TABLE IF NOT EXISTS _ecs_migrations(name TEXT PRIMARY KEY,applied_at TEXT NOT NULL)');
for(const name of fs.readdirSync('drizzle').filter(x=>/^\d+.*\.sql$/.test(x)).sort()){
 if(db.prepare('SELECT name FROM _ecs_migrations WHERE name=?').get(name))continue;
 db.exec('BEGIN IMMEDIATE');try{db.exec(fs.readFileSync(path.join('drizzle',name),'utf8'));db.prepare('INSERT INTO _ecs_migrations VALUES (?,?)').run(name,new Date().toISOString());db.exec('COMMIT');console.log('Applied',name);}catch(e){db.exec('ROLLBACK');throw e;}
}
if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Foreign key check failed');
console.log('Database migrations verified');
