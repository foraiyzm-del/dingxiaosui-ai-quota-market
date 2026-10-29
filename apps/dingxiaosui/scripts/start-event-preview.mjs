// Standalone event preview. Uses its own data, master key and app snapshot.
// Does not load .env files, create users, issue cards, or call model services.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';

const root=path.resolve(import.meta.dirname,'..');
process.chdir(root);
const [major,minor]=process.versions.node.split('.').map(Number);
if(major<22||(major===22&&minor<13))throw Error('Node.js 22.13 or later required');
const args=process.argv.slice(2);
if(args.length!==0&&(args.length!==2||args[0]!=='--port'))throw Error('Usage: node scripts/start-event-preview.mjs [--port 8845]');
const port=args.length===0?8845:Number(args[1]);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid local event port');
await new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',()=>reject(Error('Event preview port is in use; choose another with --port')));probe.listen(port,'127.0.0.1',()=>probe.close(resolve));});
const standalone=path.join(root,'.next','standalone');
if(!fs.existsSync(path.join(standalone,'server.js'))||!fs.existsSync(path.join(root,'.next','static')))throw Error('Build the updated app first: node scripts/local-handoff.mjs build');

const runtimeRoot=path.join(root,'.local-event-runtime'),dataDir=path.join(runtimeRoot,'data'),configPath=path.join(runtimeRoot,'config.json'),appsRoot=path.join(runtimeRoot,'apps');
const buildId=fs.readFileSync(path.join(standalone,'.next','BUILD_ID'),'utf8').trim();
if(!/^[a-zA-Z0-9_-]{1,100}$/.test(buildId))throw Error('Invalid build identity');
const appDir=path.join(appsRoot,buildId),snapshotPath=path.join(appDir,'runtime-snapshot.json');
for(const item of [runtimeRoot,dataDir,configPath,appsRoot,appDir,path.join(dataDir,'zdx.sqlite')])if(fs.existsSync(item)&&fs.lstatSync(item).isSymbolicLink())throw Error('Refusing linked event runtime path: '+item);
fs.mkdirSync(runtimeRoot,{recursive:true,mode:0o700});
fs.mkdirSync(dataDir,{recursive:true,mode:0o700});
let config;
if(fs.existsSync(configPath)){
 config=JSON.parse(fs.readFileSync(configPath,'utf8'));
 if(!/^[a-f0-9]{64}$/i.test(config.encryptionKey||''))throw Error('Invalid event encryption configuration; restore config.json before starting');
}else{
 if(fs.readdirSync(dataDir).some(name=>/^zdx\.sqlite(?:-wal|-shm)?$/.test(name)))throw Error('Event database exists without its encryption configuration; restore config.json before starting');
 config={encryptionKey:randomBytes(32).toString('hex')};
 fs.writeFileSync(configPath,JSON.stringify(config),{mode:0o600,flag:'wx'});
}
fs.chmodSync(runtimeRoot,0o700);fs.chmodSync(dataDir,0o700);fs.chmodSync(configPath,0o600);

// Drop inherited AI/login/gateway credentials and settings. All provider keys
// must be entered in this preview's authenticated administrator settings page.
for(const name of Object.keys(process.env))if(/^(?:AI_|OPENAI_|APIMART_|ARK_|DASHSCOPE_|DEEPSEEK_|LOCAL_|ZLG_|PLATFORM_ADMIN_)/.test(name))delete process.env[name];
Object.assign(process.env,{ZDX_DATA_DIR:dataDir,AI_CONFIG_ENCRYPTION_KEY:config.encryptionKey,APP_ENV:'production',PASSWORD_AUTH_ENABLED:'1',APP_ORIGIN:'http://127.0.0.1:'+port,ZLG_GATEWAY_REQUIRED:'0',EVENT_ACTIVATION_ENABLED:'1',AI_ALLOW_PAID_FALLBACK:'false',MEDIA_BACKGROUND_ENABLED:'1',NEXT_TELEMETRY_DISABLED:'1'});
await import('./migrate-ecs.mjs');
const {sqlite}=await import('../runtime/node-env.mjs');
const needsAdmin=!sqlite().prepare('SELECT 1 FROM password_accounts WHERE platform_admin=1').get();
if(needsAdmin)await import('./setup-admin-ecs.mjs');
sqlite().close();

// Copy into a private runtime snapshot rather than rewriting the shared build
// that an existing local service may already be using. Never copy env files.
fs.mkdirSync(appsRoot,{recursive:true,mode:0o700});
if(fs.existsSync(snapshotPath)){
 if(JSON.parse(fs.readFileSync(snapshotPath,'utf8')).buildId!==buildId||!fs.existsSync(path.join(appDir,'server.js')))throw Error('Local app snapshot is incomplete; retain it and rebuild before starting');
 if(fs.readdirSync(appDir).some(name=>/^\.env(?:\.|$)|^\.dev\.vars/.test(name)))throw Error('Event app snapshot contains an env file; move it out manually before starting');
}else{
 // Build into a fresh directory. Re-copying pnpm links over an existing runtime
 // can resolve source and destination to the same file and fail on every restart.
 const staging=path.join(appsRoot,buildId+'-preparing-'+randomUUID());
 fs.mkdirSync(staging,{mode:0o700});
 fs.cpSync(standalone,staging,{recursive:true,filter:source=>!/^\.env(?:\.|$)|^\.dev\.vars/.test(path.basename(source))&&(process.platform!=='win32'||!['node_modules','public',path.join('.next','static')].includes(path.relative(standalone,source)))});
 // Windows cannot recreate pnpm file symlinks without extra OS privileges.
 // Reuse this checkout's installed dependencies through a directory junction;
 // application files, database and master key remain in the private snapshot.
 if(process.platform==='win32'){
  // Windows copying this project's public assets can terminate Node without a
  // catchable exception. Serve the installed dependencies and static files
  // through directory junctions, as in the isolated HTTP acceptance runtime.
  for(const directory of ['node_modules','public',path.join('.next','static')])fs.symlinkSync(path.join(root,directory),path.join(staging,directory),'junction');
 }else{
  fs.cpSync(path.join(root,'public'),path.join(staging,'public'),{recursive:true});
  fs.cpSync(path.join(root,'.next','static'),path.join(staging,'.next','static'),{recursive:true});
 }
 fs.writeFileSync(path.join(staging,'runtime-snapshot.json'),JSON.stringify({buildId}),{mode:0o600,flag:'wx'});
 if(fs.existsSync(appDir))fs.renameSync(appDir,appDir+'-interrupted-'+randomUUID());
 fs.renameSync(staging,appDir);
}
console.log('Independent local event preview: '+process.env.APP_ORIGIN);
console.log('Administrator AI Key settings: '+process.env.APP_ORIGIN+'/platform/services');
console.log('Activation management: '+process.env.APP_ORIGIN+'/platform/event-codes');
if(needsAdmin)console.log('Create the first administrator using the one-use link in: '+path.join(dataDir,'admin-setup.txt'));
console.log('Private event data: '+dataDir+'; keep config.json with it. No users or cards were created; no model request was sent.');
const child=spawn(process.execPath,[path.join(appDir,'server.js')],{cwd:appDir,env:{...process.env,NODE_ENV:'production',PORT:String(port),HOSTNAME:'127.0.0.1'},stdio:'inherit'});
child.on('error',error=>{console.error(error.message);process.exitCode=1});
child.on('exit',code=>{process.exitCode=code||0});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
