import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';

const source = fs.readFileSync(new URL('../workspace-storage.js', import.meta.url), 'utf8');
const store = () => { const data = new Map(); return {getItem:k=>data.has(k)?data.get(k):null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k),data}; };
const shared = store();
shared.setItem('zidingxiang-workspace-v1', JSON.stringify({products:[{name:'旧版未归属农品'}]}));
function browser(user, local=shared, session=store()) {
  const events = {}, attrs = new Set(), order = [], nodes = new Map();
  let current = user, reloads = 0, pending = null;
  const node = () => ({style:{},setAttribute(){},getAttribute(){},removeAttribute(){},addEventListener(){},append(){},prepend(){},remove(){},click(){},querySelector(){return node()}});
  const head = node(); head.append = value => { if (value.src) { order.push(value.src); queueMicrotask(()=>value.onload()); } };
  const root = node();root.setAttribute=k=>attrs.add(k);root.removeAttribute=k=>attrs.delete(k);
  const doc = {head,body:node(),documentElement:root,visibilityState:'visible',querySelector:()=>null,createElement:node,addEventListener:(name,fn)=>events[name]=fn,
    querySelectorAll:()=>['app.js','ai-pilot.js','opc.js'].map(src=>({getAttribute:()=>src}))};
  const context = {document:doc,location:{reload:()=>reloads++},crypto:{randomUUID},AbortSignal,Blob,URL,Date,Promise,encodeURIComponent,Error,setTimeout:fn=>fn(),setInterval(){},queueMicrotask,
    fetch:async()=>{if(pending)await pending;if(current instanceof Error)throw current;return current?{ok:true,status:200,json:async()=>({user:{id:current}})}:{ok:false,status:401}},
    localStorage:local,sessionStorage:session,addEventListener:(name,fn)=>events[name]=fn,alert(){}};
  context.window=context;
  // Synchronization has dedicated state-machine tests; this suite covers the identity bootstrap.
  context.createZdxWorkspaceSync=()=>({async hydrate(){},beforeChange(){},afterChange(){},async refresh(){},stop(){},externalChange(){},state:()=>({dirty:false})});
  vm.runInNewContext(source,context,{filename:'workspace-storage.js'});
  return {api:context.zdxStorage,events,attrs,order,get reloads(){return reloads},switchTo:value=>{current=value},pause:promise=>{pending=promise}};
}
const a=browser('owner-a');await a.api.ready;
assert.deepEqual(a.order,['app.js','ai-pilot.js','opc.js'],'classic scripts load in declared order after identity');
assert.equal(a.api.local.getItem('zidingxiang-workspace-v1'),null,'old unassigned data is not adopted');
a.api.local.setItem('zidingxiang-workspace-v1','brand-a-products');
a.api.session.setItem('chat','brand-a-chat');
const b=browser('owner-b');await b.api.ready;
assert.equal(b.api.local.getItem('zidingxiang-workspace-v1'),null,'second account cannot see first account workspace');
b.api.local.setItem('zidingxiang-workspace-v1','brand-b-products');
const a2=browser('owner-a');await a2.api.ready;
assert.equal(a2.api.local.getItem('zidingxiang-workspace-v1'),'brand-a-products','returning account keeps its own data');
assert.equal(b.api.local.getItem('zidingxiang-workspace-v1'),'brand-b-products');
const guest=browser(null);await guest.api.ready;
assert.equal(guest.api.local.getItem('zidingxiang-workspace-v1'),null,'guest is separate from signed-in accounts');
assert(shared.getItem('zidingxiang-workspace-v1').includes('旧版未归属农品'),'legacy data is preserved unchanged');
// A storage signal must hide the old content before the asynchronous identity check finishes.
let resume;const waiting=new Promise(resolve=>resume=resolve);a.pause(waiting);a.switchTo('owner-b');
a.events.storage({key:'zdx-auth-change-v1',newValue:'changed'});
assert(a.attrs.has('data-zdx-storage-locked'),'old page is hidden immediately on account signal');
assert.throws(()=>a.api.local.getItem('zidingxiang-workspace-v1'),/账号/);
assert.throws(()=>a.api.local.setItem('zidingxiang-workspace-v1','wrong-account-write'),/账号/);
assert.equal(a.api.local.matches('unrelated','key'),false);
resume();await a.api.refreshIdentity();assert.equal(a.reloads,1,'old tab reloads instead of adopting a new identity in memory');
assert(a.attrs.has('data-zdx-storage-locked'),'old page stays hidden while reloading');
const offline=browser(new Error('network-down'));await offline.api.ready;
assert.equal(offline.api.local.getItem('zidingxiang-workspace-v1'),null,'outage never reads last signed-in account');
offline.api.local.setItem('zidingxiang-workspace-v1','offline-only');
assert.equal(guest.api.local.getItem('zidingxiang-workspace-v1'),null,'offline workspace is separate from confirmed guest');
const sameSession=store();const chatA=browser('owner-a',shared,sameSession);await chatA.api.ready;chatA.api.session.setItem('chat','a-only');
const chatB=browser('owner-b',shared,sameSession);await chatB.api.ready;assert.equal(chatB.api.session.getItem('chat'),null,'session chat is separated even in the same browser tab');
const stable=browser('owner-a');await stable.api.ready;await stable.api.refreshIdentity();assert.equal(stable.reloads,0);assert(!stable.attrs.has('data-zdx-storage-locked'));
const importing=browser('import-test');await importing.api.ready;
importing.api.importWorkspace({'zidingxiang-workspace-v1':'old-workspace','zidingxiang-opc-profile-v1':'old-profile'});
const originalSet=shared.setItem;let failImport=true;
shared.setItem=(key,value)=>{if(failImport&&value==='new-profile'){failImport=false;throw Error('QuotaExceededError')}originalSet(key,value)};
assert.throws(()=>importing.api.importWorkspace({'zidingxiang-workspace-v1':'new-workspace','zidingxiang-opc-profile-v1':'new-profile'}),/QuotaExceeded/);
assert.equal(importing.api.local.getItem('zidingxiang-workspace-v1'),'old-workspace','failed multi-part imports roll back the workspace');
assert.equal(importing.api.local.getItem('zidingxiang-opc-profile-v1'),'old-profile','failed imports retain the old profile');
shared.setItem=originalSet;
for(const filename of ['index.html','classic.html','explore.html','community.html','shop-demo.html','h5.html']) {
  const html=fs.readFileSync(new URL('../'+filename,import.meta.url),'utf8');
  assert.equal((html.match(/src="workspace-storage\.js/g)||[]).length,1,filename+' has one identity bootstrap');
  assert.equal((html.match(/src="workspace-sync\.js/g)||[]).length,1,filename+' loads account synchronization');
  assert(html.indexOf('src="workspace-sync.js')<html.indexOf('src="workspace-storage.js'),filename+' synchronization loads before the identity bootstrap');
  assert(!/<script src="(?!workspace-(?:storage|sync)\.js)/.test(html),filename+' business scripts wait for identity');
}
const homepage=fs.readFileSync(new URL('../landing.html',import.meta.url),'utf8');
assert(!homepage.includes('workspace-storage.js'),'official homepage is stateless and does not load private workspaces');
assert(homepage.includes('href="workbench.html"'),'official homepage leads into the workbench');
for(const filename of ['app.js','opc.js','positioning-intake.js','ding-chat.js','shop-demo.js','community.js','landing.js']) {
  const js=fs.readFileSync(new URL('../'+filename,import.meta.url),'utf8');
  assert(!/\b(?:localStorage|sessionStorage)\./.test(js),filename+' has no unscoped business storage');
}
const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const saveCode=app.match(/^function save\(\).*$/m)?.[0];assert(saveCode);
const notices=[];const quotaContext={window:{zdxStorage:{local:{setItem(){throw new Error('QuotaExceededError')}}}},STORAGE_KEY:'workspace',state:{products:[]},toast:message=>notices.push(message)};
vm.runInNewContext(saveCode,quotaContext);assert.equal(quotaContext.save(),false,'full browser storage reports failure without throwing out of event handlers');assert(notices[0].includes('未能保存'));
quotaContext.window.zdxStorage.local.setItem=()=>{};assert.equal(quotaContext.save(),true,'successful browser persistence reports success');
console.log('PASS: account A/B separation, guest/offline separation, legacy preservation, session chat isolation, immediate cross-tab lock, blocked stale writes, identity recheck, ordered bootstrap, all page entrypoints, storage-full handling and backup import rollback. Server authorization is covered by test-workspace-api.mjs.');
