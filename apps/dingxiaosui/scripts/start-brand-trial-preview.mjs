// Disposable local acceptance server. No existing database or service credentials are loaded.
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import ts from 'typescript';
const root=path.resolve(import.meta.dirname,'..');process.chdir(root);
const port=8815;
const resumeArg=process.argv.indexOf('--resume');
const resumed=resumeArg!==-1;
const previewDir=resumed?path.resolve(process.argv[resumeArg+1]||''):path.resolve('.ecs-test','brand-preview-'+Date.now());
if(path.dirname(previewDir)!==path.resolve('.ecs-test')||!path.basename(previewDir).startsWith('brand-preview-'))throw Error('Preview data must be a brand-preview directory inside .ecs-test');
if(resumed&&!fs.existsSync(path.join(previewDir,'zdx.sqlite')))throw Error('Preview database not found');
if(resumed&&path.dirname(fs.realpathSync(previewDir))!==fs.realpathSync(path.resolve('.ecs-test')))throw Error('Preview data must not redirect outside .ecs-test');
process.env.ZDX_DATA_DIR=previewDir;
process.env.APP_ENV='production';process.env.PASSWORD_AUTH_ENABLED='1';
process.env.APP_ORIGIN=`http://127.0.0.1:${port}`;
const runtimeFile=path.join(previewDir,'preview-runtime.json');
const retained=fs.existsSync(runtimeFile)?JSON.parse(fs.readFileSync(runtimeFile,'utf8')):null;
if(retained!==null&&(typeof retained.encryptionKey!=='string'||!/^[a-f0-9]{64}$/i.test(retained.encryptionKey)))throw Error('Invalid retained preview encryption key. Refusing to rotate it.');
process.env.AI_CONFIG_ENCRYPTION_KEY=retained?.encryptionKey||randomBytes(32).toString('hex');
// Refuse inherited paid-provider settings in this isolated preview.
for(const key of ['ARK_API_KEY','DASHSCOPE_API_KEY','DEEPSEEK_API_KEY','OPENAI_API_KEY','AI_PILOT_CODE'])delete process.env[key];
await import('./migrate-ecs.mjs');
const {sqlite,env}=await import('../runtime/node-env.mjs');const database=sqlite();
if(resumed&&!retained){
 const encrypted=['ai_settings','platform_media_settings','user_models','media_jobs'].some(table=>database.prepare(`SELECT count(*) AS n FROM ${table} WHERE key_cipher != ''`).get().n>0);
 if(encrypted)throw Error('This legacy preview has encrypted settings but no retained master key. Keep the original runtime; do not rotate its key.');
}
if(!retained)fs.writeFileSync(runtimeFile,JSON.stringify({encryptionKey:process.env.AI_CONFIG_ENCRYPTION_KEY}),{mode:0o600});
const source=fs.readFileSync('lib/password-auth.ts','utf8').replace("'cloudflare:workers'",JSON.stringify(pathToFileURL(path.resolve('runtime/node-env.mjs')).href));
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {authAction}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
// Publicly documented test identity, valid only in this freshly generated local database.
const username='brand-trial-qa',password='LocalTrialOnly-20261015';
if(!database.prepare('SELECT id FROM password_accounts WHERE username=?').get(username)){
 if(resumed)throw Error('This is not the documented brand preview fixture');
 const response=await authAction(new Request(process.env.APP_ORIGIN+'/api/auth',{method:'POST',headers:{origin:process.env.APP_ORIGIN,'content-type':'application/json'},body:JSON.stringify({action:'register',username,password,displayName:'本地品牌验收'})}));
 if(!response.ok)throw Error('Local fixture identity failed');
}
database.prepare('UPDATE password_accounts SET platform_admin=1 WHERE username=?').run(username);
const userId=database.prepare("SELECT user_id FROM auth_identities WHERE provider='password' AND subject=(SELECT id FROM password_accounts WHERE username=?)").get(username).user_id;
if(!database.prepare("SELECT id FROM media_jobs WHERE user_id=? AND model_name='预置验收素材'").get(userId)){
const jobId=crypto.randomUUID(),now=new Date().toISOString(),bucketKey=`generated/${userId}/${jobId}/0`;
await env.BUCKET.put(bucketKey,fs.readFileSync('lilac-packaging-v2.png'));
database.prepare("INSERT INTO media_jobs(id,user_id,capability,idempotency_key,request_hash,prompt,model_name,provider_kind,provider_endpoint,provider_model,key_cipher,status,outputs_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,'succeeded',?,?,?)")
 .run(jobId,userId,'image','qa-fixture-'+jobId,createHash('sha256').update('fixture').digest('hex'),'本地界面验收：预置概念图，用来验证本站媒体鉴权与预览；不是本轮模型生成。','预置验收素材','ark','https://ark.cn-beijing.volces.com/api/v3/images/generations','fixture-only','',JSON.stringify([{url:`/api/media/assets/${jobId}?index=0`,persisted:true,bucketKey,contentType:'image/png'}]),now,now);
}
console.log(`Local-only acceptance: ${process.env.APP_ORIGIN}; fixture account: ${username} / ${password}; ${resumed?'existing local preview data retained':'no paid model enabled'}.`);
const standalone=path.join(root,'.next','standalone');
fs.cpSync(path.join(root,'public'),path.join(standalone,'public'),{recursive:true});
fs.cpSync(path.join(root,'.next','static'),path.join(standalone,'.next','static'),{recursive:true});
const child=spawn(process.execPath,[path.join(standalone,'server.js')],{cwd:standalone,env:{...process.env,PORT:String(port),HOSTNAME:'127.0.0.1'},stdio:'inherit'});
child.on('exit',code=>{process.exitCode=code||0});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
