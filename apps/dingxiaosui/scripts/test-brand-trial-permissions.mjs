// Uses the documented disposable local fixture only. Never sends a valid generation after authorization.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';

const base='http://127.0.0.1:8815';
const root=path.resolve(import.meta.dirname,'..');
const reportPath=path.join(root,'部署验收','20261015-ark-live','普通品牌权限验收.json');
const suffix=randomBytes(4).toString('hex');
const username='qa-brand-20261015-'+suffix;
const displayName='验收用·普通品牌-'+suffix;
const password=randomBytes(24).toString('hex'); // In-memory only; never logged or included in evidence.
const merchantName='验收用·农品品牌-'+suffix;
const slug='qa-brand-20261015-'+suffix;
const checks=[];
const report={
  verifiedAt:new Date().toISOString(),origin:base,environment:'本地保留验收服务，非正式生产站',
  fixturePurpose:'新增专用普通品牌账号与商户；未修改已有账号或平台模型配置',
  account:{username,displayName,password:'未输出、未写入文件，随机密码仅存在执行进程内'},
  merchant:{name:merchantName,slug},checks,modelCallsSent:0,
  boundaries:['不读取数据库、runtime、环境密钥文件','不发送通过授权且参数有效的生成请求','无上游流量抓包；拒绝发生在模型调用前的结论结合HTTP结果与代码调用顺序'],
  passed:false,
};
const writeReport=()=>{fs.mkdirSync(path.dirname(reportPath),{recursive:true});fs.writeFileSync(reportPath,JSON.stringify(report,null,2));};
async function request(route,{cookie='',method='GET',body}={}){
  const response=await fetch(base+route,{method,redirect:'manual',signal:AbortSignal.timeout(15000),headers:{origin:base,...(cookie?{cookie}:{}),...(body!==undefined?{'content-type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  const text=await response.text();let data;try{data=JSON.parse(text)}catch{data=null}
  return {status:response.status,data,cookie:response.headers.get('set-cookie')?.split(';')[0]||''};
}
function check(name,result,expected,extra={}){
  assert.equal(result.status,expected,name+' returned unexpected HTTP status');
  checks.push({name,status:result.status,passed:true,...extra});
}
function noSecrets(value){
  if(!value||typeof value!=='object')return;
  for(const [name,entry]of Object.entries(value)){
    assert(!['apiKey','key_cipher','keyCipher','encryptionKey'].includes(name),'Private secret field was returned');
    noSecrets(entry);
  }
}
try{
  const adminLogin=await request('/api/auth',{method:'POST',body:{action:'login',username:'brand-trial-qa',password:'LocalTrialOnly-20261015'}});
  check('公开本地管理员 fixture 登录',adminLogin,200);assert(adminLogin.cookie,'No administrator session received');
  const adminCookie=adminLogin.cookie;
  const adminIdentity=await request('/api/me',{cookie:adminCookie});check('管理员身份确认',adminIdentity,200);assert.equal(adminIdentity.data.platformAdmin,true);
  const adminListing=await request('/api/media/jobs',{cookie:adminCookie});check('只读取得管理员作品作为越权对照',adminListing,200);
  const adminJob=adminListing.data.jobs.find(job=>job.status==='succeeded'&&job.outputs?.some(output=>output.persisted===true));
  assert(adminJob,'Expected an administrator-owned saved media job for ownership test');

  const registered=await request('/api/auth',{method:'POST',body:{action:'register',username,password,displayName}});
  check('注册唯一的验收用普通品牌账号',registered,200);assert(registered.cookie,'No ordinary brand session received');
  const cookie=registered.cookie;
  const before=await request('/api/me',{cookie});check('普通品牌尚未分配商户',before,200);assert.equal(before.data.platformAdmin,false);assert.equal(before.data.merchants.length,0);
  const userId=before.data.user.id;
  const ownModels=await request('/api/account/models',{cookie});check('新品牌无个人 API，使用平台默认',ownModels,200);assert.equal(ownModels.data.models.length,0);assert.deepEqual(ownModels.data.defaultModelIds,{text:null,image:null,video:null});noSecrets(ownModels.data);
  const beforeMedia=await request('/api/media/jobs',{cookie});check('未分配商户时平台图片与视频不可用',beforeMedia,200);assert.equal(beforeMedia.data.platform.image.available,false);assert.equal(beforeMedia.data.platform.video.available,false);assert.equal(beforeMedia.data.jobs.length,0);noSecrets(beforeMedia.data);

  const invalidText={consent:true,product:{},brief:{},channels:[]};
  const textDenied=await request('/api/generate',{cookie,method:'POST',body:invalidText});check('未分配商户：文字权限在输入校验/模型调用前拒绝',textDenied,403,{error:textDenied.data.error});
  assert.match(textDenied.data.error,/没有有效商户/);
  for(const capability of ['image','video']){
    const denied=await request('/api/media/jobs',{cookie,method:'POST',body:{capability,modelId:null,prompt:'验收用：只验证没有商户权限时请求会被拒绝。',consent:true,idempotencyKey:randomUUID(),ratio:'9:16',...(capability==='video'?{duration:5}:{})}});
    check('未分配商户：'+capability+' 在创建任务及上游请求前拒绝',denied,403,{error:denied.data.error});assert.match(denied.data.error,/没有有效商户/);
  }
  const unchanged=await request('/api/media/jobs',{cookie});assert.equal(unchanged.data.jobs.length,0);checks.push({name:'被拒绝的媒体提交没有创建任何品牌任务',passed:true,jobCount:0});

  const created=await request('/api/platform/merchants',{cookie:adminCookie,method:'POST',body:{name:merchantName,slug,ownerUserId:userId}});
  check('管理员通过正式业务接口开通并关联验收商户',created,201);report.merchant.id=created.data.id;report.merchant.shopId=created.data.shopId;
  const after=await request('/api/me',{cookie});check('原普通品牌会话取得有效商户负责人身份',after,200);assert.equal(after.data.platformAdmin,false);assert.equal(after.data.merchants.length,1);assert.equal(after.data.merchants[0].id,created.data.id);assert.equal(after.data.merchants[0].role,'owner');
  const enabledMedia=await request('/api/media/jobs',{cookie});check('分配商户后平台图片与视频已可用',enabledMedia,200);assert.equal(enabledMedia.data.platform.image.available,true);assert.equal(enabledMedia.data.platform.video.available,true);assert.equal(enabledMedia.data.jobs.length,0);noSecrets(enabledMedia.data);
  const engine=await request('/api/engine',{cookie});check('分配商户后文字使用平台模型',engine,200);assert.equal(engine.data.mode,'model');assert.equal(engine.data.access,'account');noSecrets(engine.data);
  const textPassed=await request('/api/generate',{cookie,method:'POST',body:invalidText});check('文字授权通过，故意缺失内容由输入校验拒绝，未调用模型',textPassed,400,{error:textPassed.data.error});assert.match(textPassed.data.error,/补齐农品、主题和渠道/);

  const hiddenJob=await request('/api/media/jobs?id='+encodeURIComponent(adminJob.id),{cookie});check('品牌不可读取管理员的媒体任务',hiddenJob,404);
  const hiddenAsset=await request('/api/media/assets/'+encodeURIComponent(adminJob.id)+'?index=0',{cookie});check('品牌不可下载管理员的媒体文件',hiddenAsset,404);
  for(const route of ['/api/platform/ai-settings','/api/platform/media-settings','/api/platform/owners','/api/platform/merchants']){
    const denied=await request(route,{cookie});check('普通品牌不可访问 '+route,denied,403);noSecrets(denied.data);
  }
  const finalModels=await request('/api/account/models',{cookie});assert.equal(finalModels.data.models.length,0);noSecrets(finalModels.data);
  checks.push({name:'平台可用状态和个人设置均不含 API Key 或加密密钥字段',passed:true});
  const finalListing=await request('/api/media/jobs',{cookie});assert.equal(finalListing.data.jobs.length,0);
  checks.push({name:'验收完成后品牌媒体任务仍为零，未提交真实生成',passed:true,jobCount:0});
  report.passed=true;report.completedAt=new Date().toISOString();writeReport();
  console.log(JSON.stringify({passed:true,checks:checks.length,account:username,merchant:merchantName,modelCallsSent:0,report:reportPath}));
}catch(error){report.error=error instanceof Error?error.message:'验收未完成';report.completedAt=new Date().toISOString();writeReport();console.error('FAIL ordinary brand permission acceptance; see sanitized report.');process.exitCode=1;}
