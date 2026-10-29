// Offline preparation. --issue-local-codes creates a NEW database only.
// Never reads .env, opens an existing database, contacts a model, or prints codes.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';

const root=path.resolve(import.meta.dirname,'..');
const jsUrl=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const tsUrl=source=>jsUrl(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
const protocolUrl=tsUrl(fs.readFileSync(path.join(root,'lib/apimart-protocol.ts'),'utf8'));
const plansUrl=tsUrl(fs.readFileSync(path.join(root,'lib/event-plans.ts'),'utf8').replace("'./apimart-protocol'",JSON.stringify(protocolUrl)));
const plans=await import(plansUrl);

export function parsePreparationArgs(args){
 let outputDir='',issueLocalCodes=false;
 for(let index=0;index<args.length;index++){
  if(args[index]==='--out'){if(outputDir||!args[index+1]||args[index+1].startsWith('--'))throw Error('--out requires one new absolute directory');outputDir=args[++index];}
  else if(args[index]==='--issue-local-codes'){if(issueLocalCodes)throw Error('Duplicate issuance flag');issueLocalCodes=true;}
  else throw Error('Unknown option: '+args[index]);
 }
 if(!path.isAbsolute(outputDir))throw Error('Use --out with a new absolute private directory; no default database is selected');
 return {outputDir,issueLocalCodes};
}
export function preparationManifest(){
 const plan=structuredClone(plans.launchEventPlan),serviceProfiles=structuredClone(plans.eventServiceProfiles);
 return {schemaVersion:1,createdAt:new Date().toISOString(),...plans.eventPreparationSummary(),plan,serviceProfiles,
  planSha256:createHash('sha256').update(JSON.stringify({plan,serviceProfiles})).digest('hex'),
  deployment:'local_only',productionDeployed:false};
}
function newPrivateDirectory(destination){
 const parent=fs.realpathSync(path.dirname(destination)),output=path.join(parent,path.basename(destination));
 if(fs.existsSync(output)||fs.lstatSync(output,{throwIfNoEntry:false}))throw Error('Output already exists; refusing to overwrite or reopen it');
 for(const folder of ['public','dist','assets','outputs']){
  const protectedPath=path.resolve(root,folder);
  if(output===protectedPath||output.startsWith(protectedPath+path.sep))throw Error('Cards must not be prepared in a public/static/output directory');
 }
 fs.mkdirSync(output,{mode:0o700});return output;
}
function savePrivate(file,value){fs.writeFileSync(file,value,{encoding:'utf8',mode:0o600,flag:'wx'});}
async function localCredits(database){
 const binding='eventPreparationDb_'+randomUUID().replaceAll('-','');
 class Statement {
  constructor(sql,values=[]){this.sql=sql;this.values=values;}
  bind(...values){return new Statement(this.sql,values);}
  execute(){const stmt=database.prepare(this.sql);if(stmt.columns().length)return {results:stmt.all(...this.values),meta:{changes:0}};const result=stmt.run(...this.values);return {results:[],meta:{changes:Number(result.changes)}};}
  async run(){return this.execute();}async all(){return this.execute();}async first(){return database.prepare(this.sql).get(...this.values)||null;}
 }
 globalThis[binding]={prepare(sql){return new Statement(sql)},async batch(statements){database.exec('BEGIN IMMEDIATE');try{const result=statements.map(statement=>statement.execute());database.exec('COMMIT');return result;}catch(error){database.exec('ROLLBACK');throw error;}}};
 const tenancyUrl=jsUrl(`export class ApiError extends Error{constructor(status,message){super(message);this.status=status}};export const db=()=>globalThis[${JSON.stringify(binding)}];export function field(value,max,required=false){if(typeof value!=='string'||value.length>max||(required&&!value.trim()))throw new ApiError(400,'invalid input');return value.trim()}`);
 const envUrl=jsUrl("export const env={EVENT_ACTIVATION_ENABLED:'1'}");
 const source=fs.readFileSync(path.join(root,'lib/event-credits.ts'),'utf8').replace("'cloudflare:workers'",JSON.stringify(envUrl)).replace("'./tenancy'",JSON.stringify(tenancyUrl)).replace("'./event-plans'",JSON.stringify(plansUrl));
 return {credits:await import(tsUrl(source)),dispose(){delete globalThis[binding];}};
}
export async function prepareEventCards({outputDir,issueLocalCodes=false}){
 if(!path.isAbsolute(outputDir))throw Error('An absolute output directory is required');
 const previousMask=process.umask(0o077);let database,runtime;
 try{
  const output=newPrivateDirectory(outputDir),manifest=preparationManifest();
  if(issueLocalCodes){
   const dataDir=path.join(output,'data');fs.mkdirSync(dataDir,{mode:0o700});
   const databasePath=path.join(dataDir,'zdx.sqlite');database=new DatabaseSync(databasePath);
   database.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE _ecs_migrations(name TEXT PRIMARY KEY,applied_at TEXT NOT NULL)');
   for(const name of fs.readdirSync(path.join(root,'drizzle')).filter(name=>/^\d+.*\.sql$/.test(name)).sort()){
    database.exec('BEGIN IMMEDIATE');try{database.exec(fs.readFileSync(path.join(root,'drizzle',name),'utf8'));database.prepare('INSERT INTO _ecs_migrations VALUES (?,?)').run(name,new Date().toISOString());database.exec('COMMIT');}catch(error){database.exec('ROLLBACK');throw error;}
   }
   const issuerId=randomUUID();database.prepare("INSERT INTO users(id,display_name,status,created_at) VALUES (?,?,'active',?)").run(issuerId,'本地体验卡发行准备',new Date().toISOString());
   runtime=await localCredits(database);
   const issued=await runtime.credits.issueEventCodes(issuerId,{requestId:randomUUID(),count:50,label:plans.launchEventPlan.label});
   const cards=issued.codes.map((code,index)=>({number:index+1,code,images:5,texts:10,videos:2,videoDuration:15,validityDays:7,validityStartsAt:'redemption',profile:'standard',status:'unredeemed'}));
   savePrivate(path.join(output,'激活码-50张.json'),JSON.stringify({batchId:issued.batchId,environment:'local_only',cards},null,2)+'\n');
   savePrivate(path.join(output,'激活码-50张.csv'),'\uFEFF序号,激活码,标准图片次数,标准文案次数,15秒视频条数,兑换后有效天数\r\n'+cards.map(card=>[card.number,card.code,5,10,2,7].join(',')).join('\r\n')+'\r\n');
   const count=database.prepare("SELECT count(*) AS n FROM event_activation_codes WHERE batch_id=? AND status='active'").get(issued.batchId).n;
   if(count!==50||database.prepare('PRAGMA foreign_key_check').all().length)throw Error('Local card verification failed; do not distribute this folder');
   Object.assign(manifest,{status:'issued_local_unredeemed',issued:true,batchId:issued.batchId,issuedCount:count,database:'data/zdx.sqlite',notice:'50 张卡仅已发行到此文件夹的新建本地数据库，尚未部署到公网。兑换成功后分别计 7 天；本地账号数据不与旧网站混用。'});
   database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  }
  savePrivate(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  savePrivate(path.join(output,'使用说明.txt'),(issueLocalCodes?'这是紫丁香独立活动体验的本地专用数据库和 50 张未兑换卡。\n只能在指向此 data 目录的独立本地演示服务兑换，未公网发行。\n完整激活码文件为私密资料，请勿上传到 public、dist 或公开仓库。\n':'这是无需数据库的发行方案准备文件；未生成或发行任何激活码。\n')+'标准卡：5 张标准图片 + 10 次标准文案 + 2 条 15 秒视频，兑换成功后 7 天。\n高级模型档位尚未定价和开放，标准卡不能调用高级档。\n此脚本拒绝覆盖已有目录，也不会打开旧数据库。\n');
  return {outputDir:output,status:manifest.status,issuedCount:manifest.issuedCount||0,productionDeployed:false};
 }finally{runtime?.dispose();database?.close();process.umask(previousMask);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{console.log(JSON.stringify(await prepareEventCards(parsePreparationArgs(process.argv.slice(2))),null,2));}
 catch(error){console.error(error instanceof Error?error.message:'Preparation failed');process.exitCode=1;}
}
