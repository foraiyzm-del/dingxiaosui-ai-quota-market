// Explicit local-only preparation. Creates the first local event administrator
// and exactly one recoverable 50-card batch; never calls a model or production.
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..'),runtime=path.join(root,'.local-event-runtime'),origin='http://127.0.0.1:8845';
const credentialsFile=path.join(runtime,'管理员登录信息.json'),cardsDir=path.join(runtime,'cards');
if(!fs.existsSync(path.join(runtime,'config.json')))throw Error('Start the independent event preview first');
for(const p of [runtime,credentialsFile,cardsDir])if(fs.existsSync(p)&&fs.lstatSync(p).isSymbolicLink())throw Error('Refusing a linked private path');
fs.mkdirSync(cardsDir,{recursive:true,mode:0o700});
async function api(route,body,cookie){const r=await fetch(origin+route,{method:body?'POST':'GET',headers:{origin,'content-type':'application/json',...(cookie?{cookie}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});const data=await r.json();if(!r.ok)throw Error(data.error||'Local request failed');return {data,cookie:r.headers.get('set-cookie')?.split(';')[0]};}
let credentials;
if(fs.existsSync(credentialsFile)){credentials=JSON.parse(fs.readFileSync(credentialsFile,'utf8'));if(credentials.origin!==origin)throw Error('Saved administrator belongs to another preview');}
else{credentials={origin,username:'zdx-event-admin',password:randomBytes(18).toString('base64url'),createdAt:new Date().toISOString()};fs.writeFileSync(credentialsFile,JSON.stringify(credentials,null,2),{mode:0o600,flag:'wx'});}
let auth;
try{auth=await api('/api/auth',{action:'login',username:credentials.username,password:credentials.password});}
catch{
 const setup=new URL(fs.readFileSync(path.join(runtime,'data','admin-setup.txt'),'utf8').trim());if(setup.origin!==origin)throw Error('Administrator setup belongs to another preview');
 const setupToken=new URLSearchParams(setup.hash.slice(1)).get('setup');if(!setupToken)throw Error('No valid local setup token');
 auth=await api('/api/auth',{action:'setup',username:credentials.username,password:credentials.password,displayName:'紫丁香活动管理员',setupToken});
}
const {data:me}=await api('/api/me',null,auth.cookie);if(!me.platformAdmin)throw Error('Local account is not an administrator');
const requestFile=path.join(cardsDir,'issuance-request.json');
if(!fs.existsSync(requestFile))fs.writeFileSync(requestFile,JSON.stringify({action:'issue',requestId:randomUUID(),count:50,label:'紫丁香发布会体验卡 · 50 张'}),{mode:0o600,flag:'wx'});
const request=JSON.parse(fs.readFileSync(requestFile,'utf8')),receiptFile=path.join(cardsDir,'issuance-receipt.json');
let receipt;
if(fs.existsSync(receiptFile)){receipt=JSON.parse(fs.readFileSync(receiptFile,'utf8'));}
else{
 const issued=(await api('/api/platform/event-codes',request,auth.cookie)).data;
 if(issued.codes.length!==50)throw Error('No fresh 50-code response. Check this batch; do not issue another automatically.');
 receipt={...issued,createdAt:new Date().toISOString(),origin,scope:'local event preview; not yet deployed'};
 const temporary=receiptFile+'.pending';fs.writeFileSync(temporary,JSON.stringify(receipt,null,2),{mode:0o600,flag:'wx'});fs.renameSync(temporary,receiptFile);
}
if(!Array.isArray(receipt.codes)||receipt.codes.length!==50||new Set(receipt.codes).size!==50)throw Error('Saved card receipt is incomplete');
const csvPath=path.join(cardsDir,'紫丁香体验卡-50张.csv');
if(!fs.existsSync(csvPath))fs.writeFileSync(csvPath,'\uFEFF序号,激活码,标准图片张数,标准文案次数,15秒视频条数,兑换后有效天数\n'+receipt.codes.map((code,i)=>[String(i+1).padStart(2,'0'),code,5,10,2,7].join(',')).join('\n')+'\n',{mode:0o600,flag:'wx'});
const overview=(await api('/api/platform/event-codes?batchId='+receipt.batchId,null,auth.cookie)).data;
if(overview.codes.length!==50)throw Error('Database does not match saved cards');
console.log(JSON.stringify({prepared:true,cardCount:50,redeemed:overview.codes.filter(c=>c.status==='redeemed').length,revoked:overview.codes.filter(c=>c.status==='revoked').length,credentialFile:credentialsFile,csvFile:csvPath,scope:'independent local preview only; no model request'},null,2));
