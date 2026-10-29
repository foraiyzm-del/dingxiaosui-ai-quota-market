import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

let database;
const dataDir = () => path.resolve(process.env.ZDX_DATA_DIR || './data');
export function sqlite() {
  if (!database) {
    fs.mkdirSync(dataDir(), {recursive:true,mode:0o700});
    database = new DatabaseSync(path.join(dataDir(),'zdx.sqlite'));
    database.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  }
  return database;
}
class Statement {
  constructor(sql, values=[]) {this.sql=sql;this.values=values;}
  bind(...values) {return new Statement(this.sql,values);}
  execute() {const stmt=sqlite().prepare(this.sql);if(stmt.columns().length)return {results:stmt.all(...this.values),success:true,meta:{changes:0}};const r=stmt.run(...this.values);return {results:[],success:true,meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}};}
  async all() {return this.execute();}
  async run() {return this.execute();}
  async first(column) {const row=sqlite().prepare(this.sql).get(...this.values);return row ? (column ? row[column] : row) : null;}
  async raw() {return this.execute().results.map(row=>Object.values(row));}
}
const DB = {prepare(sql){return new Statement(sql)},async batch(statements){const db=sqlite();db.exec('BEGIN IMMEDIATE');try{const results=statements.map(s=>s.execute());db.exec('COMMIT');return results;}catch(e){db.exec('ROLLBACK');throw e;}},async exec(sql){sqlite().exec(sql);return {count:0,duration:0}}};
function objectPath(key){const folder=path.join(dataDir(),'media');fs.mkdirSync(folder,{recursive:true,mode:0o700});return path.join(folder,createHash('sha256').update(key).digest('hex'));}
const BUCKET={async put(key,body){const p=objectPath(key),tmp=p+'.tmp-'+crypto.randomUUID();const bytes=body instanceof ArrayBuffer?Buffer.from(body):Buffer.from(await new Response(body).arrayBuffer());fs.writeFileSync(tmp,bytes,{mode:0o600});fs.renameSync(tmp,p);return {key};},async get(key){try{return {body:new Uint8Array(fs.readFileSync(objectPath(key)))}}catch(e){if(e.code==='ENOENT')return null;throw e;}},async delete(key){try{fs.unlinkSync(objectPath(key))}catch(e){if(e.code!=='ENOENT')throw e;}}};
export const env = new Proxy({}, {get(_target,key){if(key==='DB')return DB;if(key==='BUCKET')return BUCKET;return process.env[key];}});
