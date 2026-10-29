import assert from 'node:assert/strict';
import fs from 'node:fs';
const phase=process.argv[2]||'production-build';
const base='http://127.0.0.1:8812',results=[];
async function check(route,expected,options={}){const r=await fetch(base+route,{...options,redirect:'manual',signal:AbortSignal.timeout(6000)});const body=await r.text();assert.equal(r.status,expected,route+': '+body);results.push({route,status:r.status,body});return r;}
if(phase==='database-unavailable'){
 const r=await check('/api/local/session',303,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:'identity=platform'});
 await check('/api/me',503,{headers:{cookie:r.headers.get('set-cookie').split(';')[0]}});
 await check('/api/platform/merchants',503,{method:'POST',headers:{cookie:r.headers.get('set-cookie').split(';')[0],'content-type':'application/json'},body:JSON.stringify({name:'must not save',slug:'must-not-save',ownerUserId:'fake'})});
 await check('/api/shops/local-shop-a',503);
}else{
 for(let i=0;i<10;i++)await check('/api/local/session',404,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:'identity=platform'});
 await check('/api/me',503,{headers:{'oai-authenticated-user-id':'test-platform','oai-authenticated-user-email':'platform@local.test'}});
 await check('/api/platform/merchants',503,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
 await check('/api/admin/articles',503,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
}
fs.mkdirSync('.local-test',{recursive:true});fs.writeFileSync('.local-test/'+phase+'.json',JSON.stringify({phase,retries:0,passed:true,results},null,2));console.log('PASS',phase,results.length,'checks, zero retries');
