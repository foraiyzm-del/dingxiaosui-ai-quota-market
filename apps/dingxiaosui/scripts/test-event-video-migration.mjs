// In-memory legacy fixtures only. No real database, credentials, cards or network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

const root=path.resolve(import.meta.dirname,'..'),database=new DatabaseSync(':memory:');
database.exec('PRAGMA foreign_keys=ON');
const migrate=sql=>{database.exec('BEGIN IMMEDIATE');try{database.exec(sql);database.exec('COMMIT');}catch(error){database.exec('ROLLBACK');throw error;}};
const snapshot=table=>database.prepare('SELECT * FROM '+table+' ORDER BY id').all();
try{
 for(const name of fs.readdirSync(path.join(root,'drizzle')).filter(name=>/^00(?:0\d|1[0-5])_.*\.sql$/.test(name)).sort())migrate(fs.readFileSync(path.join(root,'drizzle',name),'utf8'));
 const oldPlan={schemaVersion:1,id:'zdx-launch-50-v1',appId:'zidingxiang',label:'Legacy fixture',administrativeIssuanceOnly:true,activationAuthority:'zidingxiang',cardCount:50,validityDays:7,validityStartsAt:'redemption',maxRedemptionsPerCode:1,grants:[{capabilityId:'image.generate.standard',serviceProfileId:'standard',unit:'image',units:5},{capabilityId:'text.generate.standard',serviceProfileId:'standard',unit:'text',units:10}]};
 const start='2026-10-28T00:00:00.000Z',end='2026-11-04T00:00:00.000Z';
 for(const id of ['admin','active','expired'])database.prepare("INSERT INTO users VALUES (?,?,'active',?)").run(id,id,start);
 database.prepare('INSERT INTO event_activation_batches VALUES (?,?,?,?,?,3,NULL,?,?)').run('batch','request','Legacy fixture',oldPlan.id,JSON.stringify(oldPlan),'admin',start);
 database.prepare('INSERT INTO event_activation_settings VALUES (1,?,?,?)').run('batch','admin',start);
 for(const who of ['active','expired']){
  const expires=who==='active'?end:'2000-01-08T00:00:00.000Z',redeemed=who==='active'?start:'2000-01-01T00:00:00.000Z';
  database.prepare("INSERT INTO event_activation_codes VALUES (?,? ,?,?,'redeemed',?,?,?,?)").run('code-'+who,'batch','hash-'+who,'hint',who,redeemed,expires,'receipt-'+who);
  for(const [capability,units] of [['image',5],['text',10]]){
   const lot=who+'-'+capability;database.prepare("INSERT INTO event_credit_lots VALUES (?,?,?,?,'standard',?,?,?)").run(lot,'code-'+who,who,capability,units,redeemed,expires);
   database.prepare("INSERT INTO event_credit_ledger VALUES (?,?,?,NULL,'grant',?,'legacy grant',?)").run('grant-'+lot,who,lot,units,redeemed);
  }
 }
 database.prepare("INSERT INTO event_activation_codes(id,batch_id,code_hash,code_hint) VALUES ('unredeemed','batch','hash-unredeemed','hint')").run();
 for(const status of ['succeeded','held','unknown','released'])database.prepare("INSERT INTO event_credit_usage VALUES (?,'active','active-image','image','standard',?,?,?,NULL,?,?)").run('usage-'+status,'request-'+status,'hash-'+status,status,start,start);
 database.prepare("INSERT INTO event_credit_ledger VALUES ('debit','active','active-image','usage-succeeded','usage',-1,'already delivered',?)").run(start);
 database.prepare("INSERT INTO event_credit_resolutions VALUES ('resolution','usage-released','admin','refunded','already reviewed',?)").run(start);
 const fixedTables=['users','event_activation_batches','event_activation_codes','event_credit_usage','event_credit_resolutions'];
 const prior=Object.fromEntries(fixedTables.map(table=>[table,snapshot(table)]));
 const oldLots=snapshot('event_credit_lots'),oldLedger=snapshot('event_credit_ledger');
 const sql=fs.readFileSync(path.join(root,'drizzle/0016_event_video_credits.sql'),'utf8');
 migrate(sql);
 for(const table of fixedTables)assert.deepEqual(snapshot(table),prior[table],table+' must be unchanged');
 assert.deepEqual(snapshot('event_credit_lots').filter(row=>row.capability!=='video'),oldLots);
 assert.deepEqual(snapshot('event_credit_ledger').filter(row=>!row.id.startsWith('event-video-grant-v1-')),oldLedger);
 const videos=database.prepare("SELECT * FROM event_credit_lots WHERE capability='video' ORDER BY user_id").all();assert.equal(videos.length,2);
 assert.equal(videos[0].units,2);assert.equal(videos[0].expires_at,end);assert.equal(videos[1].expires_at,'2000-01-08T00:00:00.000Z');
 assert.equal(database.prepare("SELECT count(*) n FROM event_credit_lots WHERE code_id='unredeemed'").get().n,0);
 assert.equal(database.prepare("SELECT count(*) n FROM event_credit_lots WHERE capability='video' AND expires_at>?").get(start).n,1,'Expired cards must not be revived');
 assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(),[]);
 const onceLots=snapshot('event_credit_lots'),onceLedger=snapshot('event_credit_ledger');migrate(sql);
 assert.deepEqual(snapshot('event_credit_lots'),onceLots);assert.deepEqual(snapshot('event_credit_ledger'),onceLedger);
 assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(),[]);
 assert.throws(()=>database.prepare("INSERT INTO event_credit_lots VALUES ('bad','code-active','active','audio','standard',2,?,?)").run(start,end),/CHECK/);
 console.log('PASS: video migration preserves existing usage, grants, resolutions, snapshots and expiry; supplements once; leaves unredeemed cards untouched; preserves foreign keys and rejects unknown capabilities. In-memory only.');
}finally{database.close();}
