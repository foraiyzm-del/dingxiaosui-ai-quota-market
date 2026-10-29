// Destructive fixtures are restricted to the fresh, local test copy made by
// prepare-tenancy-test.mjs. No remote command, real identity, or browser storage.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
const root=path.resolve(import.meta.dirname,'..');
const hosting=JSON.parse(fs.readFileSync(path.join(root,'.openai/hosting.json'),'utf8'));
if(hosting.project_id || !fs.readFileSync(path.join(root,'.dev.vars'),'utf8').includes('APP_ENV=local'))throw Error('Only an isolated local test copy is allowed');
const base=process.env.TEST_URL||'http://127.0.0.1:8807';
if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(base))throw Error('Loopback test URL required');
const dir=path.join(root,'.local-test');fs.mkdirSync(dir,{recursive:true});
const sqlite=fs.readdirSync(path.join(root,'.wrangler/state/v3/d1/miniflare-D1DatabaseObject')).find(x=>x.endsWith('.sqlite'));
const database=new DatabaseSync(path.join(root,'.wrangler/state/v3/d1/miniflare-D1DatabaseObject',sqlite));
database.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
const phase=process.argv[2]||'before-restart',results=[];
function record(name,details){results.push({name,passed:true,...details});console.log('PASS',name);}
async function test(name,work){try{const details=await work();record(name,details)}catch(e){results.push({name,passed:false,error:e.message});console.error('FAIL',name,e.message);throw e}}
function request(url,{method='GET',cookie,body,headers={}}={}){
 const payload=body===undefined?undefined:Buffer.isBuffer(body)?body:Buffer.from(JSON.stringify(body));
 return new Promise((resolve,reject)=>{
  const req=http.request(base+url,{method,agent:false,headers:{...(cookie?{cookie}:{}),...(payload?{'content-type':'application/json','content-length':payload.length}:{}),...headers}},res=>{
   const chunks=[];res.on('data',x=>chunks.push(x));res.on('end',()=>{const bytes=Buffer.concat(chunks),text=bytes.toString();let data;try{data=JSON.parse(text)}catch{}resolve({status:res.statusCode,headers:res.headers,bytes,text,data})});
  });req.setTimeout(6000,()=>req.destroy(Error('timeout')));req.on('error',reject);req.end(payload);
 });
}
async function expect(url,opts,status){const r=await request(url,opts);assert.equal(r.status,status,`${opts?.method||'GET'} ${url}: ${r.status} ${r.text.slice(0,160)}`);return r;}
const counts=()=>Object.fromEntries(['users','auth_identities','merchants','merchant_memberships','merchant_shops','articles','media_files'].map(t=>[t,database.prepare(`SELECT count(*) AS n FROM ${t}`).get().n]));
const shopRow=id=>database.prepare('SELECT * FROM merchant_shops WHERE id=?').get(id);
const endpoint=m=>`/api/merchants/${m.id}/shops/${m.shopId}`;
const file=path.join(dir,'private-session.json');
let state;
try{
 if(phase==='before-restart'){
  assert.equal(counts().merchants,0,'Fresh database required, never rerun setup over existing merchants');
  state={cookies:{},users:{}};
  await test('anonymous and forged identity headers cannot register or write',async()=>{
   const before=counts();await expect('/api/me',{},401);
   await expect('/api/me',{headers:{'oai-authenticated-user-id':'test-platform','oai-authenticated-user-email':'platform@local.test','x-user-id':'test-platform','x-role':'admin'}},401);
   await expect('/api/platform/merchants',{method:'POST',body:{name:'forged',slug:'forged',ownerUserId:'fake'}},401);
   assert.deepEqual(counts(),before);return {status:401,databaseUnchanged:true};
  });
  for(const alias of ['platform','ownerA','memberA','ownerB']){
   const r=await expect('/api/local/session',{method:'POST',body:Buffer.from('identity='+alias),headers:{'content-type':'application/x-www-form-urlencoded'}},303);
   state.cookies[alias]=r.headers['set-cookie'][0].split(';')[0];
   state.users[alias]=(await expect('/api/me',{cookie:state.cookies[alias]},200)).data.user;
  }
  const c=state.cookies;
  await test('only trusted local sessions associate stable subjects with users',async()=>{
   assert.equal(counts().users,4);assert.equal(counts().auth_identities,4);
   const repeat=(await expect('/api/me',{cookie:c.ownerA},200)).data.user;assert.equal(repeat.id,state.users.ownerA.id);assert.equal(counts().users,4);
   await expect('/api/me',{cookie:c.ownerA.slice(0,-4)+'aaaa'},401);return {users:4,identities:4,repeatedLoginSameUser:true,tamperedCookieStatus:401};
  });
  await test('platform refuses unverified owner and merchant cannot access platform',async()=>{
   const before=counts();await expect('/api/platform/merchants',{cookie:c.platform,method:'POST',body:{name:'bad',slug:'bad-owner',ownerUserId:'unverified-user'}},400);
   for(const p of ['/api/platform/owners','/api/platform/merchants','/api/admin/state'])await expect(p,{cookie:c.ownerA},403);
   await expect('/api/platform/merchants',{cookie:c.ownerA,method:'POST',body:{name:'bad',slug:'bad-owner',ownerUserId:state.users.ownerA.id}},403);
   assert.deepEqual(counts(),before);return {unknownOwner:400,merchantPlatformAccess:403,databaseUnchanged:true};
  });
  await test('platform creates two merchants and verified owners atomically',async()=>{
   for(const alias of ['ownerA','ownerB']){const letter=alias.at(-1);state[letter]=(await expect('/api/platform/merchants',{cookie:c.platform,method:'POST',body:{name:`本地验收商户 ${letter}`,slug:`local-shop-${letter.toLowerCase()}`,ownerUserId:state.users[alias].id}},201)).data;}
   assert.equal(counts().merchants,2);assert.equal(counts().merchant_memberships,2);assert.equal(counts().merchant_shops,2);
   const before=counts();await expect('/api/platform/merchants',{cookie:c.platform,method:'POST',body:{name:'duplicate',slug:state.A.slug,ownerUserId:state.users.ownerB.id}},409);assert.deepEqual(counts(),before);
   return {created:2,duplicateSlug:409,counts:before};
  });
  // Fixture only: this iteration intentionally has no public role/member editor.
  database.prepare("INSERT INTO merchant_memberships(merchant_id,user_id,role,status,created_at) VALUES (?,?,'member','active',?)").run(state.A.id,state.users.memberA.id,new Date().toISOString());
  await test('effective memberships have no default tenant; multi-merchant schema works',async()=>{
   const a=(await expect('/api/me',{cookie:c.ownerA},200)).data.merchants;assert.deepEqual(a.map(x=>x.id),[state.A.id]);
   assert.deepEqual((await expect('/api/me',{cookie:c.platform},200)).data.merchants,[]);
   database.prepare("INSERT INTO merchant_memberships VALUES (?,?,'member','active',?)").run(state.B.id,state.users.memberA.id,new Date().toISOString());
   assert.equal((await expect('/api/me',{cookie:c.memberA},200)).data.merchants.length,2);
   database.prepare('DELETE FROM merchant_memberships WHERE merchant_id=? AND user_id=?').run(state.B.id,state.users.memberA.id);
   await expect(endpoint(state.A),{cookie:c.platform},403);return {ownerASeesOnlyA:true,multipleMembershipsSupported:true,platformNoImplicitBusinessMembership:403};
  });
  state.saved={name:'A 店铺 · 服务端持久化验收',description:'保存在独立 D1，重启后仍应存在。',publicContact:'本地测试公开联系方式'};
  await test('owner saves own shop; direct SQLite confirms persisted row',async()=>{
   await expect(endpoint(state.A),{cookie:c.ownerA,method:'PATCH',body:state.saved},200);
   assert.equal(shopRow(state.A.shopId).name,state.saved.name);
   assert.equal((await expect(endpoint(state.A),{cookie:c.ownerA},200)).data.shop.description,state.saved.description);
   return {status:200,sqliteRow:shopRow(state.A.shopId)};
  });
  await test('B cannot read or update A; mixed shop and merchant IDs also fail',async()=>{
   const before=shopRow(state.A.shopId);
   await expect(endpoint(state.A),{cookie:c.ownerB},403);
   await expect(endpoint(state.A),{cookie:c.ownerB,method:'PATCH',body:state.saved},403);
   await expect(`/api/merchants/${state.B.id}/shops/${state.A.shopId}`,{cookie:c.ownerB},404);
   await expect(`/api/merchants/${state.B.id}/shops/${state.A.shopId}`,{cookie:c.ownerB,method:'PATCH',body:state.saved},403);
   await expect(`/api/merchants/${state.A.id}/shops/${state.B.shopId}`,{cookie:c.ownerA},404);
   await expect(endpoint(state.A),{cookie:c.ownerB,method:'PATCH',headers:{'x-user-id':state.users.ownerA.id,'oai-authenticated-user-id':'test-owner-a'},body:{...state.saved,userId:state.users.ownerA.id}},403);
   assert.deepEqual(shopRow(state.A.shopId),before);return {statuses:[403,403,404,403,404,403],sqliteUnchanged:true};
  });
  await test('request body cannot override identity, shop, merchant, or role',async()=>{
   const before=shopRow(state.A.shopId);
   for(const key of ['userId','merchantId','shopId','role'])await expect(endpoint(state.A),{cookie:c.ownerA,method:'PATCH',body:{...state.saved,[key]:'forged'}},400);
   await expect(endpoint(state.A),{cookie:c.ownerA,method:'PATCH',headers:{origin:'https://outside.example'},body:state.saved},403);
   assert.deepEqual(shopRow(state.A.shopId),before);return {extraAuthorizationFields:400,crossOrigin:403,sqliteUnchanged:true};
  });
  await test('member can read but cannot edit shop, owner role, or membership',async()=>{
   const before=counts(),row=shopRow(state.A.shopId);
   await expect(endpoint(state.A),{cookie:c.memberA},200);
   await expect(endpoint(state.A),{cookie:c.memberA,method:'PATCH',body:{...state.saved,role:'owner',merchantId:state.B.id}},403);
   await expect(`/api/platform/merchants/${state.A.id}`,{cookie:c.memberA,method:'PATCH',body:{status:'disabled',ownerUserId:state.users.memberA.id}},403);
   await expect(`/api/platform/merchants/${state.A.id}`,{cookie:c.ownerA,method:'PATCH',body:{status:'disabled'}},403);
   assert.equal(database.prepare('SELECT role FROM merchant_memberships WHERE merchant_id=? AND user_id=?').get(state.A.id,state.users.memberA.id).role,'member');
   assert.deepEqual(counts(),before);assert.deepEqual(shopRow(state.A.shopId),row);return {read:200,writes:403,roleUnchanged:true};
  });
  await test('disabled membership and disabled user invalidate existing sessions',async()=>{
   database.prepare("UPDATE merchant_memberships SET status='disabled' WHERE merchant_id=? AND user_id=?").run(state.A.id,state.users.memberA.id);
   await expect(endpoint(state.A),{cookie:c.memberA},403);assert.equal((await expect('/api/me',{cookie:c.memberA},200)).data.merchants.length,0);
   database.prepare("UPDATE merchant_memberships SET status='active' WHERE merchant_id=? AND user_id=?").run(state.A.id,state.users.memberA.id);
   database.prepare("UPDATE users SET status='disabled' WHERE id=?").run(state.users.ownerA.id);
   await expect(endpoint(state.A),{cookie:c.ownerA,method:'PATCH',body:state.saved},403);
   database.prepare("UPDATE users SET status='active' WHERE id=?").run(state.users.ownerA.id);return {oldSessionDenied:403};
  });
  await test('public shop returns only explicitly public fields',async()=>{
   const r=await expect('/api/shops/'+state.A.slug,{},200);assert.deepEqual(Object.keys(r.data.shop).sort(),['slug','name','description','publicContact'].sort());
   const html=await expect('/shops/'+state.A.slug,{},200);assert(html.text.includes(state.saved.name));assert(!html.text.includes(state.users.ownerA.id));assert(!html.text.includes(state.A.id));return {keys:Object.keys(r.data.shop),publicPage:200};
  });
  await test('CMS draft hidden, published and edited content readable',async()=>{
   const body={title:'本地 CMS 回归文章',type:'news',body:'草稿正文',status:'draft'};
   state.articleId=(await expect('/api/admin/articles',{cookie:c.platform,method:'POST',body},200)).data.id;
   assert(!(await expect('/api/content',{},200)).data.articles.some(a=>a.id===state.articleId));
   await expect('/api/admin/articles',{cookie:c.ownerA,method:'POST',body:{...body,id:state.articleId,status:'published'}},403);
   await expect('/api/admin/articles',{cookie:c.platform,method:'POST',body:{...body,id:state.articleId,status:'published'}},200);
   assert((await expect('/api/content',{},200)).data.articles.some(a=>a.id===state.articleId));
   await expect('/api/admin/articles',{cookie:c.platform,method:'POST',body:{...body,id:state.articleId,status:'published',body:'修改后的内容，重启仍需保留'}},200);
   assert.equal((await expect('/api/content',{},200)).data.articles.find(a=>a.id===state.articleId).body,'修改后的内容，重启仍需保留');
   return {draftHidden:true,publish:true,edit:true,merchantWriteDenied:403};
  });
  await test('R2 upload and read still work under platform authorization',async()=>{
   const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6yxkAAAAASUVORK5CYII=','base64');
   const boundary='zdx-local-regression';const body=Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="local-test.png"\r\nContent-Type: image/png\r\n\r\n`),png,Buffer.from(`\r\n--${boundary}--\r\n`)]);
   state.upload={body:body.toString('base64'),type:`multipart/form-data; boundary=${boundary}`};
   const r=await expect('/api/admin/media',{cookie:c.platform,method:'POST',body,headers:{'content-type':state.upload.type}},200);state.mediaUrl=r.data.url;
   assert.deepEqual((await expect(state.mediaUrl,{},200)).bytes,png);return {upload:200,read:200,bytesMatch:true};
  });
  await test('denied requests are stable without retry: JSON + multipart + fetch',async()=>{
   const before=counts(),row=shopRow(state.A.shopId),statuses=[];
   for(let i=0;i<40;i++)statuses.push((await expect(endpoint(state.A),{method:'PATCH',body:state.saved},401)).status);
   for(let i=0;i<40;i++)statuses.push((await expect('/api/admin/articles',{method:'POST',body:{title:'denied',body:'must not save'}},403)).status);
   for(let i=0;i<20;i++)statuses.push((await expect('/api/admin/media',{cookie:c.ownerA,method:'POST',body:Buffer.from(state.upload.body,'base64'),headers:{'content-type':state.upload.type}},403)).status);
   for(let i=0;i<20;i++){const r=await fetch(base+endpoint(state.A),{method:'PATCH',headers:{cookie:c.ownerB,'content-type':'application/json'},body:JSON.stringify(state.saved),signal:AbortSignal.timeout(6000)});await r.arrayBuffer();assert.equal(r.status,403);statuses.push(r.status);}
   assert.deepEqual(counts(),before);assert.deepEqual(shopRow(state.A.shopId),row);return {requests:120,retries:0,statuses,databaseUnchanged:true,timeouts:0,unexpected503:0};
  });
  fs.writeFileSync(file,JSON.stringify(state));
 }else if(phase==='after-restart'){
  state=JSON.parse(fs.readFileSync(file,'utf8'));const c=state.cookies;
  await test('full service restart preserves D1 shop, CMS and R2 records',async()=>{
   assert.equal((await expect(endpoint(state.A),{cookie:c.ownerA},200)).data.shop.name,state.saved.name);
   assert.equal(shopRow(state.A.shopId).name,state.saved.name);
   assert.equal((await expect('/api/content',{},200)).data.articles.find(a=>a.id===state.articleId).body,'修改后的内容，重启仍需保留');
   assert((await expect(state.mediaUrl,{},200)).bytes.length>0);return {shopPersisted:true,cmsPersisted:true,r2Persisted:true,sqliteRow:shopRow(state.A.shopId)};
  });
  await test('disabled merchant rejects old sessions and disappears publicly',async()=>{
   const before=shopRow(state.A.shopId);
   await expect(`/api/platform/merchants/${state.A.id}`,{cookie:c.platform,method:'PATCH',body:{status:'disabled'}},200);
   await expect(endpoint(state.A),{cookie:c.ownerA,method:'PATCH',body:state.saved},403);
   await expect(endpoint(state.A),{cookie:c.ownerA},403);await expect(endpoint(state.A),{cookie:c.memberA},403);
   assert.equal((await expect('/api/me',{cookie:c.ownerA},200)).data.merchants.length,0);
   await expect('/api/shops/'+state.A.slug,{},404);assert.deepEqual(shopRow(state.A.shopId),before);
   await expect(`/api/platform/merchants/${state.A.id}`,{cookie:c.platform,method:'PATCH',body:{status:'active'}},200);
   return {oldSessionsDenied:403,publicShop:404,sqliteShopUnchanged:true,reenabledForReview:true};
  });
 }else throw Error('Unknown phase');
}finally{
 fs.writeFileSync(path.join(dir,phase+'-results.json'),JSON.stringify({phase,identity:'local-test only; production login NOT verified',base,at:new Date().toISOString(),retries:0,results},null,2));
 database.close();
}
