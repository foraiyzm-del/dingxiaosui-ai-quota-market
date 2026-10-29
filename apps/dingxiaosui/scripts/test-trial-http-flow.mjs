// Exercises the actual built API with a disposable local preview, never production.
import assert from 'node:assert/strict';
const origin='http://127.0.0.1:8815';
const results=[];
async function request(path,{method='GET',body,cookie='',requestOrigin=origin}={}){
 const response=await fetch(origin+path,{method,headers:{origin:requestOrigin,...(body?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
 const data=response.headers.get('content-type')?.includes('json')?await response.json():null;
 return {response,data};
}
function check(name,actual,expected){assert.equal(actual,expected,name);results.push({name,pass:true});}
const auth=await request('/api/auth',{method:'POST',body:{action:'login',username:'brand-trial-qa',password:'LocalTrialOnly-20261015'}});
check('Local fixture login',auth.response.status,200);
const adminCookie=auth.response.headers.get('set-cookie').split(';')[0];
const workspace=await request('/api/media/jobs',{cookie:adminCookie});
check('Authenticated studio metadata',workspace.response.status,200);
check('Unconfigured platform image is unavailable',workspace.data.platform.image.available,false);
const job=workspace.data.jobs.find(j=>j.modelName==='预置验收素材');assert(job);
const asset=await request(job.outputs[0].url,{cookie:adminCookie});check('Persisted relative image URL',asset.response.status,200);check('Image response MIME',asset.response.headers.get('content-type'),'image/png');
check('Anonymous private asset denied',(await request(job.outputs[0].url)).response.status,401);
const other=await request('/api/auth',{method:'POST',body:{action:'register',username:'other-qa-'+Date.now(),password:'LocalTrialOnly-20261015',displayName:'本地第二品牌'}});
check('Second isolated account registration',other.response.status,200);
const memberCookie=other.response.headers.get('set-cookie').split(';')[0];
check('Other account cannot view asset',(await request(job.outputs[0].url,{cookie:memberCookie})).response.status,404);
check('Other account cannot view task',(await request('/api/media/jobs?id='+job.id,{cookie:memberCookie})).response.status,404);
check('Ordinary account cannot configure platform',(await request('/api/platform/media-settings',{cookie:memberCookie})).response.status,403);
check('Consent required before generation',(await request('/api/media/jobs',{method:'POST',cookie:adminCookie,body:{capability:'image',modelId:null,prompt:'验收不发送上游',consent:false,idempotencyKey:crypto.randomUUID()}})).response.status,400);
const personal={name:'本地图片设置验收（不调用）',kind:'ark',capability:'image',endpoint:'https://ark.cn-beijing.volces.com/api/v3/images/generations',model:'fixture-not-a-real-model',apiKey:'local-fixture-key-not-a-real-key',jsonMode:false};
const saved=await request('/api/account/models',{method:'POST',cookie:memberCookie,body:personal});check('Media model API accepts capability',saved.response.status,200);
const models=await request('/api/account/models',{cookie:memberCookie});assert(!JSON.stringify(models.data).includes(personal.apiKey));check('Image model capability retained',models.data.models[0].capability,'image');
check('Image default selection works',(await request('/api/account/models',{method:'PUT',cookie:memberCookie,body:{capability:'image',modelId:saved.data.id}})).response.status,200);
check('Text default rejects image',(await request('/api/account/models',{method:'PUT',cookie:memberCookie,body:{capability:'text',modelId:saved.data.id}})).response.status,400);
check('Media config cannot run text connection test',(await request('/api/account/models/test',{method:'POST',cookie:memberCookie,body:{id:saved.data.id,revision:1,consent:true}})).response.status,400);
check('Cross-site mutation rejected',(await request('/api/account/models',{method:'DELETE',cookie:memberCookie,body:{id:saved.data.id},requestOrigin:'https://evil.invalid'})).response.status,403);
console.log(JSON.stringify({at:new Date().toISOString(),scope:'Built local server and disposable fixture accounts; no upstream AI requests',passed:results.length,results},null,2));
