// In-memory migration regression only: never reads env files or opens an existing DB.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

const root=path.resolve(import.meta.dirname,'..');
const database=new DatabaseSync(':memory:');
const migration='0013_apimart_media.sql';
const migrationSql=fs.readFileSync(path.join(root,'drizzle',migration),'utf8');
const tables=['users','user_models','user_model_preferences','user_media_preferences','platform_media_settings','media_jobs'];
const snapshot=()=>Object.fromEntries(tables.map(table=>[table,database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
try {
 database.exec('PRAGMA foreign_keys=ON');
 for(const name of fs.readdirSync(path.join(root,'drizzle')).filter(name=>/^\d+.*\.sql$/.test(name)&&name<migration).sort()){
  database.exec('BEGIN IMMEDIATE');
  try{database.exec(fs.readFileSync(path.join(root,'drizzle',name),'utf8'));database.exec('COMMIT');}
  catch(error){database.exec('ROLLBACK');throw error;}
 }
 const time='2026-10-28T02:00:00.000Z';
 database.prepare("INSERT INTO users(id,display_name,status,created_at) VALUES ('owner','Migration fixture','active',?)").run(time);
 for(const [id,capability] of [['old-text','text'],['old-image','image'],['old-video','video']]){
  database.prepare('INSERT INTO user_models(id,user_id,name,kind,endpoint,model,key_cipher,capability,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
   .run(id,'owner',id,'openai-compatible','https://example.invalid/v1',id,'fixture-cipher-'+id,capability,time);
 }
 database.exec("INSERT INTO user_model_preferences VALUES ('owner','old-text'); INSERT INTO user_media_preferences VALUES ('owner','image','old-image'),('owner','video','old-video')");
 for(const capability of ['image','video'])database.prepare('INSERT INTO platform_media_settings VALUES (?,?,?,?,?,?,?,?,?)')
  .run(capability,'ark','https://example.invalid/v3',capability,'fixture-platform-cipher',1,7,time,'owner');
 const statuses=['submitting','queued','running','succeeded','failed','unknown'];
 for(const [index,status] of statuses.entries())database.prepare('INSERT INTO media_jobs VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
  .run('job-'+status,'owner',index%2?'video':'image','request-'+status,'hash-'+status,'existing prompt '+status,
   'Existing model','ark','https://example.invalid/v3','existing-model','fixture-job-cipher',status,
   'upstream-'+status,JSON.stringify([{url:'/api/media/assets/job-'+status,persisted:true}]),status==='failed'?'fixture error':null,time,time,12345+index);
 const before=snapshot();
 assert.throws(()=>database.exec("UPDATE platform_media_settings SET kind='apimart' WHERE capability='image'"),/CHECK constraint/);
 assert.throws(()=>database.exec("UPDATE media_jobs SET status='saving' WHERE id='job-running'"),/CHECK constraint/);

 // A stopped/failed migration must roll back both replacement tables and all rows.
 database.exec('BEGIN IMMEDIATE');
 database.exec(migrationSql);
 database.exec('ROLLBACK');
 assert.deepEqual(snapshot(),before);
 assert.equal(database.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name IN ('platform_media_settings_apimart','media_jobs_apimart')").get().n,0);

 database.exec('BEGIN IMMEDIATE');
 database.exec(migrationSql);
 assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(),[]);
 database.exec('COMMIT');
 assert.deepEqual(snapshot(),before,'Every original row, cipher, preference and job value must survive');
 assert.equal(database.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE type='index' AND name='media_jobs_owner'").get().n,1);
 database.exec("UPDATE platform_media_settings SET kind='apimart' WHERE capability='image'; UPDATE media_jobs SET provider_kind='apimart',status='saving' WHERE id='job-running'");
 assert.equal(database.prepare("SELECT status FROM media_jobs WHERE id='job-running'").get().status,'saving');
 assert.throws(()=>database.exec("UPDATE platform_media_settings SET kind='unsupported' WHERE capability='image'"),/CHECK constraint/);
 assert.throws(()=>database.exec("UPDATE media_jobs SET status='unsupported' WHERE id='job-running'"),/CHECK constraint/);
 assert.throws(()=>database.exec("UPDATE media_jobs SET user_id='missing' WHERE id='job-running'"),/FOREIGN KEY constraint/);
 assert.throws(()=>database.exec("UPDATE platform_media_settings SET updated_by='missing' WHERE capability='image'"),/FOREIGN KEY constraint/);
 assert.throws(()=>database.exec("UPDATE media_jobs SET idempotency_key='request-queued' WHERE id='job-running'"),/UNIQUE constraint/);
 database.exec("DELETE FROM user_models WHERE id='old-image'");
 assert.equal(database.prepare("SELECT model_id FROM user_media_preferences WHERE capability='image'").get().model_id,null);
 assert.equal(database.prepare('SELECT model_id FROM user_model_preferences').get().model_id,'old-text');
 assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(),[]);
 console.log('PASS: APIMart migration preserves all existing media/settings/model preferences; transaction rollback, new kind/status, uniqueness and foreign keys verified in memory. No existing database opened.');
} finally {database.close();}
