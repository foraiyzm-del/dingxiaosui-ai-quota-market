// Persistent local test runtime. Default: no real payment or model traffic.
// --live-payment explicitly uses a separate fresh merchant-test database; models remain mocked.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { startCenter } from '../sidecar/server.mjs';
import { FIXED_PACKAGE } from '../sidecar/opcpay.mjs';
import { bootstrapDingxiaosui } from './bootstrap-dingxiaosui.mjs';
import { createMockOpcpay } from './opcpay-mock.mjs';
import { fetchOpcpayDemoModel as fetchImpl } from './opcpay-demo-model.mjs';
import { assertRuntimeNotMigrated } from './start-dingxiaosui-attached.mjs';

const root=path.resolve(import.meta.dirname,'..');
const livePayment=process.argv.includes('--live-payment');
if(process.argv.slice(2).some(arg=>arg!=='--live-payment'))throw new Error('仅支持可选参数 --live-payment');
const folder=path.join(root,'local',livePayment?'opcpay-live-test':'opcpay-demo');
if(livePayment)assertRuntimeNotMigrated(folder);
const centerRoot=path.join(folder,'center');
const ding=path.join(root,'apps','dingxiaosui');
const standalone=path.join(ding,'.next','standalone');
const centerPort=Number(process.env.OPCPAY_DEMO_PORT || 3199);
const dingPort=Number(process.env.OPCPAY_DEMO_DING_PORT || 8845);
const mockPort=Number(process.env.OPCPAY_DEMO_MOCK_PORT || 13999);
const shop=`http://127.0.0.1:${centerPort}`, origin=`http://127.0.0.1:${dingPort}`;
for(const port of [centerPort,dingPort,...(livePayment?[]:[mockPort])]){
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('演示端口必须是1–65535整数');
  const probe=net.createServer();
  try{await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(port,'127.0.0.1',resolve);});}
  catch{throw new Error(`端口 ${port} 已占用，演示未连接或停止该服务。请通过 OPCPAY_DEMO_*_PORT 指定空闲端口。`);}
  finally{if(probe.listening)await new Promise(resolve=>probe.close(resolve));}
}
if(!fs.existsSync(path.join(standalone,'server.js')))throw new Error('先构建 apps/dingxiaosui');
fs.mkdirSync(path.join(centerRoot,'local'),{recursive:true});
const buildId=fs.readFileSync(path.join(standalone,'.next','BUILD_ID'),'utf8').trim();
if(!/^[a-zA-Z0-9_-]{1,100}$/.test(buildId))throw new Error('丁小穗构建标识无效');
const appDir=path.join(folder,'apps',buildId);
if(!fs.existsSync(path.join(appDir,'ready.json'))){
  if(fs.existsSync(appDir))throw new Error('测试应用快照不完整，请保留现场并检查 apps 目录');
  fs.mkdirSync(appDir,{recursive:true});
  fs.cpSync(standalone,appDir,{recursive:true,filter:source=>!/^\.env(?:\.|$)|^\.dev\.vars/.test(path.basename(source))
    && !['public',path.join('.next','static'),...(process.platform==='win32'?['node_modules']:[])].includes(path.relative(standalone,source))});
  for(const directory of ['public',path.join('.next','static'),...(process.platform==='win32'?['node_modules']:[])]){
    if(process.platform==='win32')fs.symlinkSync(path.join(ding,directory),path.join(appDir,directory),'junction');
    else fs.cpSync(path.join(ding,directory),path.join(appDir,directory),{recursive:true});
  }
  fs.writeFileSync(path.join(appDir,'ready.json'),JSON.stringify({buildId}),{flag:'wx'});
}
if(!fs.existsSync(path.join(centerRoot,'public')))fs.symlinkSync(path.join(root,'public'),path.join(centerRoot,'public'),'junction');
const privateFile=path.join(folder,'config.json');
let config;
if(fs.existsSync(privateFile))config=JSON.parse(fs.readFileSync(privateFile,'utf8'));
else{
  config={merchantKey:randomBytes(32).toString('hex'),adminPassword:randomBytes(24).toString('hex'),dingKey:randomBytes(32).toString('hex')};
  fs.writeFileSync(privateFile,JSON.stringify(config,null,2),{flag:'wx',mode:0o600});
}
fs.writeFileSync(path.join(centerRoot,'local','ACCESS.md'),`# ${livePayment?'独立真实付款测试（模型模拟）':'独立模拟演示'}\n仅本机私密使用。\n管理员密码：${config.adminPassword}\n`,{mode:0o600});
let center,mock,child,closing=false;
async function close(){
  if(closing)return;closing=true;
  if(child && child.exitCode===null){const stopped=once(child,'exit');child.kill();await stopped;}
  if(center)await center.close();
  if(mock)await mock.close();
}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>close().then(()=>process.exit(0)));
try{
  let paymentConfig;
  if(livePayment){
    paymentConfig=JSON.parse(fs.readFileSync(path.join(root,'local','opcpay.json'),'utf8'));
    if(paymentConfig.enabled!==true || paymentConfig.sandbox!==false || !paymentConfig.apiKey || paymentConfig.termsConfirmed!==true)throw new Error('真实付款测试配置未完成；请先在本机配置商户并确认商品范围和退款路径。');
  }else{
    mock=await createMockOpcpay({dbPath:path.join(folder,'provider.sqlite'),port:mockPort});
    paymentConfig={
    enabled:true,sandbox:true,apiKey:'local-mock-only-no-real-key',skuId:'opcpay-trial-sku',merchantProjectName:'丁小穗尝鲜卡（本地模拟）',
    projectId:FIXED_PACKAGE.projectId,productId:FIXED_PACKAGE.productId,packageId:FIXED_PACKAGE.packageId,
    termsConfirmed:true,verifiedPackage:{priceCents:990,quotaUnit:'COUNT',amount:1},
    };
  }
  center=await startCenter({root:centerRoot,port:centerPort,config:{...config,port:centerPort,opcpayPaymentTest:livePayment},generationOptions:{fetchImpl},opcpayOptions:{...(mock?{client:mock.client}:{}),config:paymentConfig}});
  const credential=await bootstrapDingxiaosui({baseUrl:shop,adminPassword:config.adminPassword,workbenchUrl:origin+'/workbench.html'});
  const models=[{id:'mock-text',capability:'text'},{id:'mock-image',capability:'image'},{id:'mock-video',capability:'video'}];
  center.channels.saveChannel({id:'opcpay-demo-model',name:'隔离模拟模型（不联网）',baseUrl:'https://mock-model.invalid/v1',apiKey:'mock-model-only',enabled:true,models});
  center.platforms.savePlatform({id:'dingxiaosui',name:'丁小穗',url:origin+'/workbench.html',enabled:true,bindings:models.map(model=>({capability:model.capability,model:model.id,channelId:'opcpay-demo-model'}))});
  const description=livePayment
    ?'真实付款测试商品：9.90 元由支付宝实际收取，1 次权益兑换 1 张卡；文案、图片和视频均为本地模拟，不调用真实模型。'
    :'专用本地模拟商品；1 次权益兑换 1 张卡，不发生真实付款，不调用真实模型。';
  const product=center.commerce.listProducts({admin:true}).find(p=>p.id===FIXED_PACKAGE.productId);
  if(!product)center.commerce.saveProduct({
    id:FIXED_PACKAGE.productId,projectId:FIXED_PACKAGE.projectId,name:FIXED_PACKAGE.name,description,
    units:27,priceCents:990,active:true,fulfillment:'on_payment',packageOptions:[{id:'trial',label:FIXED_PACKAGE.name,quota:FIXED_PACKAGE.quota,priceCents:990}],
  });
  else if(product.description!==description)center.commerce.saveProduct({...product,description});
  const env={...process.env,ZDX_DATA_DIR:path.join(folder,'ding-data'),AI_CONFIG_ENCRYPTION_KEY:config.dingKey,APP_ENV:'production',APP_ORIGIN:origin,
    PASSWORD_AUTH_ENABLED:'1',EVENT_ACTIVATION_ENABLED:'1',ZLG_GATEWAY_REQUIRED:'0',MEDIA_BACKGROUND_ENABLED:'1',QUOTA_CENTER_URL:shop,
    QUOTA_PLATFORM_KEY:credential.apiKey,SHOP_PRODUCT_URL:shop+'/opcpay',NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1',PORT:String(dingPort),HOSTNAME:'127.0.0.1'};
  for(const key of Object.keys(env))if(/^(OPENAI_|APIMART_|ARK_|DASHSCOPE_|DEEPSEEK_|LOCAL_|PLATFORM_ADMIN_)/.test(key))delete env[key];
  const migration=spawnSync(process.execPath,['scripts/migrate-ecs.mjs'],{cwd:ding,env,encoding:'utf8',windowsHide:true});
  fs.writeFileSync(path.join(folder,'migration.log'),migration.stdout+ migration.stderr);
  if(migration.status!==0)throw new Error('丁小穗隔离迁移失败，查看私有 migration.log');
  const preload=path.join(folder,'network-boundary.mjs');
  fs.writeFileSync(preload,`const original=globalThis.fetch;globalThis.fetch=(url,init)=>{if(new URL(String(url)).origin!==${JSON.stringify(shop)})throw Error('External network blocked in OPCPay demo');return original(url,init)};`);
  const log=fs.openSync(path.join(folder,'ding-server.log'),'a');
  child=spawn(process.execPath,['--import',pathToFileURL(preload).href,path.join(appDir,'server.js')],{cwd:appDir,env,windowsHide:true,stdio:['ignore',log,log]});
  fs.closeSync(log);
  let ready=false;
  for(let count=0;count<200;count++){
    if(child.exitCode!==null)throw new Error('丁小穗演示服务退出，查看私有 ding-server.log');
    try{if((await fetch(origin+'/api/event/session')).ok){ready=true;break;}}catch{}
    await new Promise(resolve=>setTimeout(resolve,150));
  }
  if(!ready)throw new Error('丁小穗演示启动超时');
  if(!(await fetch(origin+'/workbench.html')).ok)throw new Error('丁小穗页面资源不完整，不能作为可演示服务');
  fs.writeFileSync(path.join(folder,'runtime.json'),JSON.stringify({pid:process.pid,dingPid:child.pid,centerPort,dingPort,...(mock?{mockPort}:{}),mode:livePayment?'live-payment-test':'local-simulation',startedAt:new Date().toISOString()},null,2));
  console.log(livePayment?'真实支付测试入口：9.90 元，1 次权益换丁小穗尝鲜卡；模型仍为模拟。':'本地模拟演示（无真实付款、无真实模型）：');
  if(livePayment)console.log('收款项目：'+paymentConfig.merchantProjectName+'。请用户核对支付宝收款页后自行付款。');
  console.log('商城：'+shop+'/');console.log('固定套餐：'+shop+'/opcpay');console.log('丁小穗：'+origin+'/workbench.html');
  console.log(`测试数据持久保存在 local/${livePayment?'opcpay-live-test':'opcpay-demo'}，重启继续原兑换。Ctrl+C 停止本脚本创建的服务。`);
}catch(error){await close();console.error(error.message);process.exitCode=1;}
