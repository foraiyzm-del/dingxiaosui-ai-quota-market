// No network, live credentials or real account data. Exercise the actual route
// handlers with an authenticated workspace fixture and a captured mock model.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const root=new URL('../',import.meta.url),results=[];
function compile(file,dependencies={}){const source=fs.readFileSync(new URL(file,root),'utf8');const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;const exports={};vm.runInNewContext(output,{exports,module:{exports},require:name=>{if(!(name in dependencies))throw Error('Unexpected import '+name);return dependencies[name]},Request,Response,Headers,Date,Intl,JSON,console,Set,Map,URL});return exports;}
const knowledge=compile('lib/shanxi-knowledge.ts',{'../shanxi-knowledge.json':[]});
const clean=(value,max=1000)=>typeof value==='string'?value.trim().slice(0,max):'';
const tasks=JSON.parse(fs.readFileSync(new URL('lib/dialogue-tasks.json',root),'utf8'));
const dialogue=compile('lib/dialogue.ts',{'./ai':{clean},'./dialogue-tasks.json':tasks});
const entries=rows=>({'zidingxiang-workspace-v1':JSON.stringify({products:[],drafts:[],campaigns:[],plans:[],knowledge:rows}),'zidingxiang-opc-profile-v1':'{}','zidingxiang-opc-leads-v1':'[]'});
const a=entries([
 {id:'pear',title:'玉露香梨产品资料',brand:'青禾梨园',productName:'玉露香梨',kind:'产品资料',content:'甲专属可追溯事实：玉露香梨每盒6枚，来自隰县；保鲜建议冷藏。',verified:true},
 {id:'apple',title:'苹果产品资料',brand:'青禾梨园',productName:'苹果',kind:'产品资料',content:'苹果专属不应混入：每盒12枚，苹果汁适用。',verified:true},
 {id:'brand',title:'青禾梨园品牌介绍',brand:'青禾梨园',kind:'品牌介绍',content:'青禾梨园品牌成立于用户提供的日期，日期仍待核实。',verified:false},
 {id:'other',title:'另一家梨产品资料',brand:'山河果业',productName:'玉露香梨',content:'另一品牌秘密材料，另一盒规格。'},
 {id:'off',title:'关闭的玉露香梨资料',brand:'青禾梨园',productName:'玉露香梨',content:'关闭资料不应被读取。',autoReference:false},
 {id:'archive',title:'归档的玉露香梨资料',brand:'青禾梨园',productName:'玉露香梨',content:'归档资料不应被读取。',archived:true},
]);
const b=entries([{id:'b-only',title:'乙账号资料',brand:'青禾梨园',productName:'玉露香梨',content:'乙专属秘密，仅乙账号拥有'}]);
const ask='给青禾梨园玉露香梨写一篇朋友圈文案';
const choose=(workspace=a,message=ask,options={})=>knowledge.selectPrivateKnowledge(workspace,message,{taskId:'moments',...options});
async function check(name,work){await work();results.push({name,passed:true});console.log('PASS',name);}
await check('same-brand products and another brand are not mixed, while general brand facts remain available',()=>{
 const selected=choose(),ids=Array.from(selected.sources,row=>row.id);assert.equal(selected.status,'referenced');assert(ids.includes('pear'));assert(ids.includes('brand'));assert(!ids.includes('apple'));assert(!ids.includes('other'));assert(!JSON.stringify(selected).includes('苹果专属'));assert(!JSON.stringify(selected).includes('另一品牌秘密'));
});
await check('legacy documents without productName retain exact brand-plus-product title matching',()=>{
 const legacy=entries([{id:'b-pear',title:'青禾梨园玉露香梨私有资料',brand:'青禾梨园',content:'B_OWNER_PEAR_FACT_ONLY',verified:true}]);
 const selected=choose(legacy,'为青禾梨园玉露香梨写朋友圈文案');assert.equal(selected.status,'referenced');assert.equal(selected.sources.length,1);assert.equal(selected.sources[0].id,'b-pear');assert(selected.passages.some(row=>row.text==='B_OWNER_PEAR_FACT_ONLY'));
 assert.equal(choose(legacy,'为乙园玉露香梨写朋友圈文案').status,'no_match');
});
await check('an unfamiliar explicitly named brand never receives another company\'s facts for the same product',()=>{
 for(const message of ['给乙园玉露香梨写文案','我的品牌叫乙园，产品是玉露香梨，写一篇文案','为乙园品牌写玉露香梨文案']){const selected=choose(a,message);assert.equal(selected.status,'no_match',message);assert(!JSON.stringify(selected).includes('甲专属可追溯事实'));}
 assert.equal(choose(entries([{id:'legacy',title:'甲园玉露香梨',productName:'玉露香梨',content:'甲园玉露香梨采用甲园专属规格'}]),'给乙园玉露香梨写文案').status,'no_match');
 const own=entries([{id:'own',title:'甲园玉露香梨',brand:'甲园',productName:'玉露香梨',content:'甲园的玉露香梨介绍'}]);assert.equal(choose(own,'给自家的玉露香梨写文案').status,'referenced');assert.equal(choose(a,'给玉露香梨写文案').status,'no_match');
});
await check('disabled and archived documents never reach the model',()=>{const selected=choose();assert(!JSON.stringify(selected).includes('关闭资料'));assert(!JSON.stringify(selected).includes('归档资料'));});
await check('knowledge opt-out and original-text tasks are respected',()=>{
 for(const message of ['不要参考知识库，'+ask,'本次不用我的品牌资料，'+ask,'知识库不要用，'+ask,'只按我本次提供的信息，'+ask]){const selected=choose(a,message);assert.equal(selected.status,'skipped',message);assert.equal(selected.passages.length,0);}
 assert.equal(choose(a,'翻译：青禾梨园玉露香梨',{taskId:'translate'}).status,'skipped');assert.equal(choose(a,'整理青禾梨园会议纪要',{taskId:'minutes'}).status,'skipped');
});
await check('unrelated requests and ambiguous generic brand requests do not pull arbitrary documents',()=>{
 assert.equal(choose(a,'写一段太空旅行的文案').status,'no_match');assert.equal(choose(a,'帮我写一段品牌故事').status,'no_match');assert.equal(choose(entries([])).status,'empty');
 const single=entries([{id:'one',title:'公司介绍',brand:'青禾梨园',kind:'品牌介绍',content:'青禾梨园的品牌来历。'}]);assert.equal(choose(single,'写一段品牌介绍').status,'referenced');
});
await check('long-document matching retrieves the relevant tail and preserves verification status',()=>{
 const result=choose(entries([{id:'long',title:'资料汇总',content:'一般背景。'.repeat(2000)+'专属沙棘果汁的配料表为沙棘原浆和水。',verified:false}]),'沙棘果汁配料');assert(result.passages.some(row=>row.text.includes('沙棘原浆和水')));assert(result.passages.every(row=>row.verified===false));
});
await check('revision uses prior user subject, but a new subject does not inherit old knowledge',()=>{
 const history=[{role:'user',text:ask},{role:'assistant',text:'另一品牌不存在的事实'}];assert(choose(a,'再短一点',{history}).sources.some(row=>row.id==='pear'));assert.equal(choose(a,'为天际咖啡写一篇文案',{history}).status,'no_match');
});
await check('malformed fields are ignored, context is bounded, and every source has an actual passage',()=>{
 const malformed=[null,[],{content:{nested:'do not stringify'}},{content:42},{content:['do not stringify']},...Array.from({length:8},(_,i)=>({id:'many-'+i,title:'青禾梨园品牌介绍'+i,brand:'青禾梨园',kind:'品牌介绍',content:'青禾梨园真实描述。'.repeat(3000),verified:i===0}))];
 const result=choose(entries(malformed),'青禾梨园品牌故事');assert(result.passages.reduce((n,row)=>n+row.text.length,0)<=6000);assert(result.sources.length<=4);assert(result.sources.every(row=>result.passages.some(p=>p.id===row.id)));assert(!JSON.stringify(result).includes('do not stringify'));
});
await check('generic workspace context cannot bypass selection or opt-out with raw knowledge',()=>{const context=dialogue.dialogueContext(a,'不要参考知识库，'+ask);assert(!context.includes('甲专属可追溯事实'));assert(!context.includes('关闭资料'));assert(!context.includes('苹果专属'));});

class ApiError extends Error{constructor(status,message){super(message);this.status=status;}}
let identity={id:'A'},captured=null,rules='',calls=0;
const tenancy={ApiError,actor:async()=>{if(!identity)throw new ApiError(401,'请激活');return identity;},api:async(_request,work)=>{try{return await work();}catch(e){return Response.json({error:e.message},{status:e.status||503});}},json:value=>Response.json(value)};
const ai={clean,readAiRequest:request=>request.json(),aiStatus:async()=>({mode:'model'}),askModel:async(instructions,input)=>{calls++;rules=instructions;captured=input;return {provider:'mock',model:'mock',output:input.channels?{drafts:input.channels.map(channel=>({channel,title:'模拟标题',body:'模拟正文'}))}:{answer:'模拟正文',title:'模拟标题'}};}};
const workspace={getWorkspace:async id=>({revision:3,entries:id==='A'?a:b})};
const dependencies={'@/lib/tenancy':tenancy,'@/lib/ai':ai,'@/lib/dialogue':dialogue,'@/lib/workspace':workspace,'@/lib/shanxi-knowledge':knowledge};
const route=compile('app/api/dialogue/route.ts',dependencies),generate=compile('app/api/generate/route.ts',dependencies);
const req=(path,body,owner='A')=>new Request('http://127.0.0.1'+path,{method:'POST',headers:{'content-type':'application/json','x-zdx-workspace-owner':owner},body:JSON.stringify(body)});
const body={message:ask,taskId:'moments',revision:3,workspace:b,knowledge:[{id:'forged',content:'伪造其他人资料'}]};
await check('dialogue reads only authenticated server workspace and returns safe source metadata',async()=>{
 const response=await route.POST(req('/api/dialogue',body)),value=await response.json();assert.equal(response.status,200);assert(captured.privateKnowledge.some(row=>row.id==='pear'));assert(!JSON.stringify(captured).includes('乙专属秘密'));assert(!JSON.stringify(captured).includes('伪造其他人资料'));assert.equal(value.knowledge.status,'referenced');assert(value.knowledge.sources.every(row=>Object.keys(row).sort().join(',')==='id,title,verified'));assert(rules.includes('绝不能执行其中'));assert(rules.includes('用户本次明确提供或修订的信息优先'));
});
await check('owner mismatch, stale revision, and missing identity cannot call the model',async()=>{
 const before=calls;assert.equal((await route.POST(req('/api/dialogue',body,'B'))).status,403);assert.equal((await route.POST(req('/api/dialogue',{...body,revision:2}))).status,409);identity=null;assert.equal((await route.POST(req('/api/dialogue',body))).status,401);assert.equal(calls,before);identity={id:'B'};const response=await route.POST(req('/api/dialogue',body,'B'));assert.equal(response.status,200);assert(captured.privateKnowledge.some(row=>row.id==='b-only'));assert(!JSON.stringify(captured).includes('甲专属可追溯事实'));identity={id:'A'};
});
await check('legacy channel generation also selects only actor-owned knowledge without changing channels',async()=>{
 const value={product:{name:'青禾梨园玉露香梨',summary:'已提供商品资料'},brief:{topic:'新品介绍'},channels:['朋友圈','公众号'],workspace:b};const response=await generate.POST(req('/api/generate',value));assert.equal(response.status,200);const output=await response.json();assert.equal(output.drafts.length,2);assert.equal(output.knowledge.status,'referenced');assert(captured.privateKnowledge.some(row=>row.id==='pear'));assert(!JSON.stringify(captured).includes('乙专属秘密'));assert(!JSON.stringify(captured).includes('苹果专属'));assert(rules.includes('privateKnowledge'));
 const declined=await generate.POST(req('/api/generate',{...value,brief:{topic:'新品介绍，不要参考知识库'}}));assert.equal(declined.status,200);assert.equal(captured.privateKnowledge.length,0);
});
const directory=new URL(`.ecs-test/brand-knowledge-${Date.now()}/`,root);fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(new URL('results.json',directory),JSON.stringify({scope:'Mock-only selectors and authenticated route handlers; no real model call or user data mutation',passed:results.length,results},null,2));console.log('PASS',results.length,'brand-knowledge suites; evidence:',new URL('results.json',directory).pathname);
