import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {spawn,spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {parseEnv} from 'node:util';
const root=path.resolve(import.meta.dirname,'..');process.chdir(root);
const command=process.argv[2];if(!['build','start'].includes(command))throw Error('Usage: node scripts/local-handoff.mjs build|start [--port 8825]');
const [major,minor]=process.versions.node.split('.').map(Number);if(major<22||(major===22&&minor<13))throw Error('Node.js 22.13 or later required');
if(!fs.existsSync(path.join(root,'node_modules/next/dist/bin/next')))throw Error('Install locked dependencies first; see 新电脑启动说明.txt');
function run(args){const result=spawnSync(process.execPath,args,{cwd:root,stdio:'inherit',env:{...process.env,NEXT_TELEMETRY_DISABLED:'1'}});if(result.error)throw result.error;if(result.status!==0)process.exit(result.status||1)}
if(command==='build'){run(['scripts/sync-public.mjs']);run(['node_modules/next/dist/bin/next','build','--webpack']);process.exit(0)}
const portIndex=process.argv.indexOf('--port'),port=portIndex===-1?8825:Number(process.argv[portIndex+1]);if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid local port');
await new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',()=>reject(Error('Local port is in use; choose another with --port')));probe.listen(port,'127.0.0.1',()=>probe.close(resolve))});
const standalone=path.join(root,'.next/standalone');if(!fs.existsSync(path.join(standalone,'server.js')))throw Error('Build first: node scripts/local-handoff.mjs build');
const localRoot=path.join(root,'.local-runtime'),dataDir=path.join(localRoot,'data');fs.mkdirSync(dataDir,{recursive:true,mode:0o700});
const configPath=path.join(localRoot,'config.json');let config;if(fs.existsSync(configPath)){config=JSON.parse(fs.readFileSync(configPath,'utf8'));if(!/^[a-f0-9]{64}$/i.test(config.encryptionKey||''))throw Error('Existing encryption configuration is invalid; refusing to rotate it')}else{if(fs.existsSync(path.join(dataDir,'zdx.sqlite')))throw Error('Database exists without its encryption configuration; restore config.json before starting');config={encryptionKey:randomBytes(32).toString('hex')};fs.writeFileSync(configPath,JSON.stringify(config),{mode:0o600})}
for(const key of ['ARK_API_KEY','DASHSCOPE_API_KEY','DEEPSEEK_API_KEY','OPENAI_API_KEY','OPENAI_GENERATION_PAUSED_REASON','AI_PILOT_CODE','AI_LOCAL_SHARED_ARK','AI_LOCAL_SHARED_ARK_REASON','AI_LOCAL_SHARED_ARK_PAUSED','LOCAL_OPENAI_ENABLED','LOCAL_AUTH_ENABLED','LOCAL_AUTH_SECRET','PLATFORM_ADMIN_SUBJECTS'])delete process.env[key];
const openaiFile=path.join(root,'.env.local');
if(fs.existsSync(openaiFile)){
 if(fs.lstatSync(openaiFile).isSymbolicLink())throw Error('Refusing to load a linked OpenAI configuration');
 const saved=parseEnv(fs.readFileSync(openaiFile,'utf8'));
 if(saved.OPENAI_API_KEY?.trim()){
  Object.assign(process.env,{OPENAI_API_KEY:saved.OPENAI_API_KEY.trim(),OPENAI_MODEL:saved.OPENAI_MODEL?.trim()||'gpt-6.1-sol',OPENAI_GENERATION_PAUSED_REASON:saved.OPENAI_GENERATION_PAUSED_REASON||'',LOCAL_OPENAI_ENABLED:'1',AI_ALLOW_PAID_FALLBACK:'false'});
  console.log('文字模型：OpenAI GPT；仅供本机登录账号使用，保留每日60次、每月1000次请求上限。');
  if(saved.OPENAI_GENERATION_PAUSED_REASON)console.log('GPT 文字生成当前暂停：'+saved.OPENAI_GENERATION_PAUSED_REASON);
 }
}
Object.assign(process.env,{ZDX_DATA_DIR:dataDir,AI_CONFIG_ENCRYPTION_KEY:config.encryptionKey,APP_ENV:'production',PASSWORD_AUTH_ENABLED:'1',APP_ORIGIN:'http://127.0.0.1:'+port,NEXT_TELEMETRY_DISABLED:'1'});
await import('./migrate-ecs.mjs');const {sqlite}=await import('../runtime/node-env.mjs');
if(!sqlite().prepare('SELECT 1 FROM password_accounts WHERE platform_admin=1').get())await import('./setup-admin-ecs.mjs');sqlite().close();
fs.cpSync(path.join(root,'public'),path.join(standalone,'public'),{recursive:true});fs.cpSync(path.join(root,'.next/static'),path.join(standalone,'.next/static'),{recursive:true});
console.log('Local system: '+process.env.APP_ORIGIN);console.log('First administrator: open the link inside .local-runtime/data/admin-setup.txt and set your own credentials.');console.log('Local data and encryption configuration: .local-runtime/ — preserve them together; never publish this directory.');
const child=spawn(process.execPath,[path.join(standalone,'server.js')],{cwd:standalone,env:{...process.env,PORT:String(port),HOSTNAME:'127.0.0.1'},stdio:'inherit'});child.on('error',e=>{console.error(e.message);process.exitCode=1});child.on('exit',code=>{process.exitCode=code||0});for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
