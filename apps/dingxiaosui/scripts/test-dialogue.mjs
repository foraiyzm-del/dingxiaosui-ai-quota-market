import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';

const root = new URL('../', import.meta.url), checks = [];
const sandbox = { window: {}, crypto: { randomUUID }, Date, Intl };
vm.runInNewContext(fs.readFileSync(new URL('dialogue-core.js', root), 'utf8'), sandbox);
const D = sandbox.window.ZdxDialogue;
const sample = D.normalize({ products: [{id:'p1',name:'山西小米',origin:'长治',summary:'真实录入资料'},{id:'demo-product',name:'虚构示例'}], drafts:[{id:'d1',productId:'p1',title:'小米的一天',body:'文案原文'}], campaigns:[],plans:[],knowledge:[{id:'k1',title:'小米保存',content:'放在阴凉干燥处',verified:false}],stock:[{id:'s1',productId:'p1',quantity:2,threshold:5,unit:'袋'}] });
assert.equal(D.route('查看我的农品资料').kind,'search');
assert.equal(D.route('查看我的农品资料','moments').kind,'search');
assert.equal(D.route('给山西小米写朋友圈').taskId,'moments');
assert.equal(D.route('把刚才的内容存到知识库').collection,'knowledge');
assert.equal(D.route('安排明天发布这条文案').kind,'plan');
assert.equal(D.route('翻译成英文：山西好物').taskId,'translate');
assert.equal(D.route('整理会议纪要：周五核对价格').taskId,'minutes');
assert.equal(D.route('做一份 PPT').taskId,'ppt');
assert.equal(D.route('为山西小米做营销设计').taskId,'design');
assert.equal(D.route('沁谷','ppt').taskId,'ppt');
assert.equal(D.route('我的品牌叫沁谷','ppt').taskId,'ppt');
assert.equal(D.route('做一份PPT','design').taskId,'design');
assert.equal(D.route('我想做个 PPT，我的品牌叫沁谷').taskId,'ppt');
assert.equal(D.route('我的品牌叫沁谷，我想做个定位').taskId,'brand');
assert.equal(D.route('我的品牌叫沁谷，我应该怎么宣传').taskId,'brand');
assert.equal(D.route('我的品牌叫沁谷').kind,'generate');
assert.equal(D.route('山西陈醋品牌','ppt').taskId,'ppt');
assert.equal(D.route('定位').taskId,'brand');
assert.equal(D.route('我的品牌叫沁谷，想宣传一下').taskId,'brand');
assert.equal(D.route('给农产品写一份内容方案').taskId,'agri');
assert.equal(D.route('GitHub上有哪些现成能力').kind,'github');
assert.equal(D.route('查看海报资料','design').kind,'search');
assert.equal(D.route('山西品牌有哪些特点').kind,'reference');
assert.equal(D.route('查看我的山西小米农品资料').kind,'search');
for(const question of ['查看剩余点数','我还有多少创作点','查看使用记录','兑换激活码','套餐有哪些'])assert.equal(D.route(question,'moments').kind,'credits');
assert.equal(D.route('写一份套餐推广文案').kind,'generate');
checks.push('natural-language routing, including a query after choosing a writing tool');
assert.equal(D.search('查看我的农品资料',sample).length,1);
assert.equal(D.search('查低库存农品',sample).length,1);
assert.equal(D.search('库存不足的有哪些',sample).length,1);
assert.equal(D.search('找小米',sample).length,4);
assert.equal(D.matchProduct('找',sample),undefined);
checks.push('real-record lookup, linked records, low stock, and demo exclusion');
const proposal=D.productProposal('新增农品：沙棘汁；产地：吕梁；规格：250mL；介绍：测试资料');
assert.equal(proposal.value.origin,'吕梁');
const added=D.applyProposal(sample,proposal,{id:'p2'});assert.equal(added.name,'沙棘汁');
assert.throws(()=>D.applyProposal(sample,{kind:'delete',value:{id:'p1'}}),/不支持/);
const knowledge=D.applyProposal(sample,{kind:'knowledge',value:{title:'建议',content:'待核实内容',verified:true}},{id:'k2'});assert.equal(knowledge.verified,false);
const plan=D.applyProposal(sample,{kind:'plan',value:{draftId:'d1',date:'2026-10-22',status:'已发布'}},{id:'plan1'});assert.equal(plan.status,'待发布');
assert.throws(()=>D.applyProposal(sample,{kind:'plan',value:{draftId:'missing',date:'2026-10-22'}}),/先保存/);
checks.push('confirmed writes preserve provenance; knowledge stays unverified and plans stay unpublished');
assert.equal(D.day('明天',new Date('2026-10-21T20:00:00Z')),'2026-10-23');
assert.equal(D.day('2026-02-30'),null);
checks.push('Shanghai date handling and invalid dates');

const tasks=JSON.parse(fs.readFileSync(new URL('lib/dialogue-tasks.json',root),'utf8'));
assert.equal(tasks.length,31);assert.equal(new Set(tasks.map(task=>task.id)).size,31);
for(const id of ['brand','agri-model','new-farmer','live','detail','private','season','gift','channel','visit']){const task=tasks.find(row=>row.id===id);assert(task.instructions&&task.placeholder);assert.equal(D.route('沁谷',id).taskId,id,`仅品牌名应保持所选任务：${id}`);}
for(const [message,id] of [['农业模特持品方案','agri-model'],['AI 新农人账号定位','new-farmer'],['为小米写品牌营销方案','brand'],['为农品写直播带货话术','live'],['为农品写电商详情页','detail'],['写私域团购方案','private'],['写节气上新方案','season'],['写节日礼盒推广','gift'],['写招商与渠道合作介绍','channel'],['写采摘农旅活动草案','visit']])assert.equal(D.route(message).taskId,id,message);
assert(tasks.find(task=>task.id==='agri').instructions.includes('县域产地'));
assert(tasks.find(task=>task.id==='design').instructions.includes('版式'));
assert(tasks.find(task=>task.id==='ppt').instructions.includes('用户只提供农产品名称也可以开始'));
const browserTasks=JSON.parse(fs.readFileSync(new URL('dialogue-tools.json',root),'utf8'));
assert.equal(browserTasks.length,tasks.length);
for(const task of browserTasks){assert(!('instructions' in task));assert(!('example' in task));assert(task.placeholder.length<50);}
for(const id of ['minutes','translate','ppt','polish'])assert.notEqual(tasks.find(task=>task.id===id).source,'original');
assert(fs.readFileSync(new URL('THIRD_PARTY_NOTICES.md',root),'utf8').includes('Copyright GitHub, Inc.'));
checks.push('31 task adapters, agricultural scenario routing, truthful image prompts and upstream MIT notices');

function compile(relative, dependencies) {
 const eventOff={eventActivationEnabled:()=>false};
 const protocol={APIMART_TEXT_ENDPOINT:'https://api.apimart.ai/v1/chat/completions',APIMART_TEXT_MODEL:'deepseek-v4.1-flash'};
 dependencies={'./quota-center':{quotaCenterEnabled:()=>false,quotaAccount:async()=>null},'./quota-generation':{currentQuotaAccount:async()=>null},'./zlg-gateway':{centerRequired:()=>false},'./event-credits':eventOff,'./apimart-protocol':protocol,'@/lib/event-credits':eventOff,'@/lib/event-plans':{},'@/lib/apimart-protocol':protocol,...dependencies};
 const source=fs.readFileSync(new URL(relative,root),'utf8');
 const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true,resolveJsonModule:true}}).outputText;
 const exported={};
 vm.runInNewContext(output,{exports:exported,module:{exports:exported},require:name=>{if(!(name in dependencies))throw Error('Unexpected dependency '+name);return dependencies[name]},Request,Response,Headers,AbortSignal,Date,Intl,JSON,console,Set,Map,URL});
 return exported;
}
const clean=(value,max=1000)=>typeof value==='string'?value.trim().slice(0,max):'';
const dialogue=compile('lib/dialogue.ts',{'./dialogue-tasks.json':tasks,'./ai':{clean}});
for(const task of tasks.filter(task=>task.id!=='general')){assert.equal(dialogue.resolveDialogueTask('沁谷',task.id).id,task.id);assert.equal(D.route('沁谷',task.id).taskId,task.id);}
for(const [message,id] of [['我想做个 PPT，我的品牌叫沁谷','ppt'],['我的品牌叫沁谷，我想做个定位','brand'],['我的品牌叫沁谷，我应该怎么宣传','brand'],['我想给沁谷写朋友圈','moments']]){assert.equal(dialogue.resolveDialogueTask(message).id,id);assert.equal(D.route(message).taskId,id);}
assert.equal(dialogue.resolveDialogueTask('沁谷').id,'general');
assert.equal(dialogue.resolveDialogueTask('做一份PPT','design').id,'design');
const regionalKnowledge=JSON.parse(fs.readFileSync(new URL('shanxi-knowledge.json',root),'utf8'));
const regional=compile('lib/shanxi-knowledge.ts',{'../shanxi-knowledge.json':regionalKnowledge});
const persona=compile('lib/ding-persona.ts',{});
const agriculture=compile('lib/agriculture-policy.ts',{'./shanxi-knowledge':regional,'./ding-persona':persona});
const prepared=agriculture.prepareAgricultureText('仅返回指定JSON结构',{product:{name:'山西小米',origin:'长治'},brief:{topic:'产品介绍'}});
assert(prepared.instructions.includes('更懂山西农产品')&&prepared.instructions.includes('更懂农业品牌')&&prepared.instructions.includes('仅返回指定JSON结构'));
assert(prepared.input.agricultureContext.references.some(row=>row.title.includes('小米')));
assert.equal(prepared.input.task.product.origin,'长治');
assert(prepared.instructions.includes(persona.dingPersonaRules));
assert.equal(prepared.input.agricultureContext.personaVersion,persona.dingPersonaVersion);
const officePrepared=agriculture.prepareAgricultureText('仅返回翻译正文，不增加解释',{context:'Hello'});
assert(officePrepared.instructions.includes('纯正文任务直接交正文'));
assert(officePrepared.instructions.includes('没有真实种植经历'));
assert(officePrepared.instructions.includes('不卖萌、不推责、不编借口'));
assert.equal(officePrepared.input.task.context,'Hello');
checks.push('shared Ding persona reaches agricultural and office tasks while preserving deliverable format and honest identity');
assert(agriculture.prepareAgricultureText('翻译给定原文',{context:'Hello'}).instructions.includes('不擅自加入不存在的山西'));
assert(agriculture.agricultureMediaPrompt('用户真实农品要求','image').includes('用户真实农品要求'));
assert.equal(regionalKnowledge.length,9);
assert.equal(regional.shanxiReferences('给沁州黄小米写文案')[0].id,'sx-millet');
assert(regional.shanxiReferences('玉露香梨有什么特点').some(row=>row.id==='sx-pear'));
const privateEntries={'zidingxiang-workspace-v1':JSON.stringify({knowledge:[{title:'我的农品资料',source:'本人提供',verified:false,content:'普通背景'.repeat(1500)+'专属沙棘果汁的配料表为沙棘原浆和水。'}]})};
assert(regional.privateKnowledgePassages(privateEntries,'沙棘果汁配料').some(row=>row.text.includes('沙棘原浆和水')));
assert(regional.privateKnowledgePassages(privateEntries,'沙棘果汁配料').every(row=>row.verified===false));
assert.equal(regional.privateKnowledgePassages({'zidingxiang-workspace-v1':'{}'},'沙棘果汁配料').length,0);
checks.push('sourced Shanxi background and retrieval from long private materials, preserving verification state');
const makeEntries=label=>({ 'zidingxiang-workspace-v1':JSON.stringify({products:Array.from({length:30},(_,i)=>({id:label+'-'+i,name:i===29?label+'专属农品':'农品'+i,summary:label+'的真实资料'})),drafts:[],plans:[],campaigns:[],conversations:[{id:'thread-'+label,messages:[{role:'assistant',text:label+'已有作品完整版',artifact:{title:'作品'}}]}]}),'zidingxiang-opc-profile-v1':JSON.stringify({shopName:label+'经营档案'}),'zidingxiang-opc-leads-v1':'[]'});
const entriesA=makeEntries('甲'),entriesB=makeEntries('乙');
const selected=dialogue.dialogueContext(entriesA,'给甲专属农品写朋友圈');
assert(selected.includes('甲专属农品'));assert(!selected.includes('乙经营档案'));assert(!selected.includes('已有作品完整版'));
assert.equal(dialogue.previousDialogueDraft(entriesA,'thread-甲','把刚才改短一点'),'甲已有作品完整版');
assert.equal(dialogue.previousDialogueDraft(entriesA,'thread-乙','把刚才改短一点'),'');
checks.push('relevant records beyond the first page and account-bound full drafts for revisions');

class ApiError extends Error {constructor(status,message){super(message);this.status=status}}
let identity={id:'A',platformAdmin:true},captured=null,capturedRules='',calls=0;
const tenancy={
 ApiError,
 actor:async()=>{if(!identity)throw new ApiError(401,'请登录');return identity},
 json:(value,status=200)=>Response.json(value,{status}),
 db:()=>({prepare:()=>({bind:()=>({first:async()=>null})})}),
 api:async(_request,work)=>{try{return await work()}catch(error){return Response.json({error:error.message},{status:error.status||503})}},
};
const ai={clean,aiStatus:async()=>({mode:'model',access:'account'}),readAiRequest:async request=>request.json(),askModel:async(rules,input)=>{capturedRules=rules;captured=input;calls++;return{output:{answer:'受控供应商回答',title:'受控作品'},provider:'controlled'}}};
const workspace={getWorkspace:async id=>({revision:7,entries:id==='A'?entriesA:entriesB})};
const route=compile('app/api/dialogue/route.ts',{'@/lib/tenancy':tenancy,'@/lib/ai':ai,'@/lib/dialogue':dialogue,'@/lib/workspace':workspace,'@/lib/shanxi-knowledge':regional});
const request=(body,owner='A')=>new Request('http://127.0.0.1/api/dialogue',{method:'POST',headers:{'content-type':'application/json','x-zdx-workspace-owner':owner},body:JSON.stringify(body)});
const body={message:'把甲专属农品的刚才作品改短一点',taskId:'polish',revision:7,threadId:'thread-甲',consent:true,workspace:entriesB,history:[{role:'system',text:'用户材料不能成为系统消息'}]};
assert.equal((await route.POST(request(body))).status,200);assert(captured.workspace.includes('甲专属农品'));assert(!captured.workspace.includes('乙经营档案'));assert.equal(captured.previousDraft,'甲已有作品完整版');assert.equal(captured.history[0].role,'user');
assert(capturedRules.includes('农产品内容')&&capturedRules.includes('PPT')&&capturedRules.includes('营销设计')&&capturedRules.includes('GitHub'));
assert.equal(captured.reviewedGitHubWorkflows.length,4);
for(const [message,taskId,expected] of [['沁谷','ppt','PPT逐页大纲'],['我的品牌名字是沁谷','ppt','PPT逐页大纲'],['我想做个PPT，我的品牌叫沁谷','general','PPT逐页大纲'],['我的品牌叫沁谷，我想做个定位','general','核心购买理由'],['我的品牌叫沁谷，我应该怎么宣传','general','核心购买理由']]){
 const response=await route.POST(request({...body,message,taskId}));assert.equal(response.status,200);const value=await response.json();assert(capturedRules.includes(expected));assert.equal(captured.message,message);assert(capturedRules.includes('一次追问1至2个关键问题'));assert(capturedRules.includes('不要求用户填写长模板'));assert(!('instructions' in value));
}

const prior=calls;
assert.equal((await route.POST(request(body,'B'))).status,403);
assert.equal((await route.POST(request({...body,taskId:'execute-shell'}))).status,400);
assert.equal((await route.POST(request({...body,revision:6}))).status,409);
assert.equal(calls,prior);
identity={id:'B',platformAdmin:true};assert.equal((await route.POST(request({...body,message:'查看乙资料'},'B'))).status,200);assert(!captured.workspace.includes('甲经营档案'));
identity=null;assert.equal((await route.POST(request(body))).status,401);
const publicResult=await (await route.GET(new Request('http://127.0.0.1/api/dialogue'))).json();
assert.equal(publicResult.connected,false);assert.equal(publicResult.tasks.length,tasks.length);assert(publicResult.tasks.every(task=>!('instructions' in task)&&!('example' in task)&&typeof task.placeholder==='string'));
checks.push('controlled model integration, account switching, task whitelist, revision conflicts and public catalogue');
let completionPayload=null,completionEndpoint='',upstreamStatus=200,upstreamBody={status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{"answer":"受控 GPT 回答"}'}]}]};
const completionEnv={AI_TEST_UPSTREAM:{fetch:async(endpoint,init)=>{completionEndpoint=endpoint;completionPayload=JSON.parse(init.body);return Response.json(upstreamBody,{status:upstreamStatus});}}};
const configModule=compile('lib/ai-config.ts',{'cloudflare:workers':{env:completionEnv},'./tenancy':tenancy,'./identity':{localAuthEnabled:()=>true}});
const controlledGpt={name:'controlled GPT',model:'gpt-6.1-sol',endpoint:'https://api.openai.com/v1/chat/completions',key:'controlled-secret',kind:'openai-compatible',jsonMode:true};
assert.equal(await configModule.requestCompletion(controlledGpt,[{role:'user',content:'返回 JSON'}],1000),'{"answer":"受控 GPT 回答"}');
assert.equal(completionEndpoint,'https://api.openai.com/v1/responses');assert.equal(completionPayload.store,false);assert.equal(completionPayload.max_output_tokens,1000);assert.equal(completionPayload.reasoning.effort,'low');assert(!('max_tokens' in completionPayload));assert(!('temperature' in completionPayload));
upstreamStatus=429;upstreamBody={error:{code:'insufficient_quota',message:'Never forward raw upstream diagnostics'}};
await assert.rejects(()=>configModule.requestCompletion(controlledGpt,[],100),/OpenAI API 额度不足/);
upstreamStatus=200;upstreamBody={status:'incomplete',output:[]};await assert.rejects(()=>configModule.requestCompletion(controlledGpt,[],100),/输出未完成/);
upstreamBody={choices:[{message:{content:'{"answer":"受控兼容回答"}'}}]};
await configModule.requestCompletion({...controlledGpt,model:'controlled-ark',kind:'ark',endpoint:'https://ark.cn-beijing.volces.com/api/v3/chat/completions'},[],300);
assert.equal(completionPayload.max_completion_tokens,300);assert.equal(completionPayload.thinking.type,'disabled');
checks.push('official GPT Responses payload, incomplete output, quota exhaustion, and existing compatible-provider behavior');
const localVars={OPENAI_API_KEY:'controlled-secret',OPENAI_MODEL:'gpt-6.1-sol',LOCAL_OPENAI_ENABLED:'1',PASSWORD_AUTH_ENABLED:'1',APP_ORIGIN:'http://127.0.0.1:8825'};
const localAi=compile('lib/ai.ts',{'cloudflare:workers':{env:localVars},'./ai-config':{getConfig:async()=>null},'./tenancy':tenancy,'./credits':{},'./agriculture-policy':agriculture,'./user-models':{selectedPersonalModel:async()=>null}});
identity={id:'A',platformAdmin:false};assert.equal((await localAi.aiStatus()).access,'local-openai');
assert(!(await localAi.readAiRequest(new Request('http://127.0.0.1/api/dialogue',{method:'POST',body:JSON.stringify({consent:true,message:'受控测试'})}),500))?.error);
localVars.OPENAI_GENERATION_PAUSED_REASON='受控的额度暂停原因';assert.equal((await localAi.aiStatus()).mode,'template');
const paused=await localAi.readAiRequest(new Request('http://127.0.0.1/api/dialogue',{method:'POST',body:JSON.stringify({consent:true})}),500);assert.equal(paused.status,503);assert.equal((await paused.json()).error,'受控的额度暂停原因');delete localVars.OPENAI_GENERATION_PAUSED_REASON;
identity=null;await assert.rejects(()=>localAi.aiStatus(),/请登录/);
identity={id:'A',platformAdmin:false};localVars.APP_ORIGIN='https://public.example';assert.equal((await localAi.aiStatus()).mode,'template');
const publicConfigAi=compile('lib/ai.ts',{'cloudflare:workers':{env:localVars},'./ai-config':{getConfig:async()=>({enabled:true,key_cipher:'controlled'})},'./tenancy':tenancy,'./credits':{},'./agriculture-policy':agriculture,'./user-models':{selectedPersonalModel:async()=>null}});
localVars.OPENAI_GENERATION_PAUSED_REASON='公开站文字服务暂停';
assert.equal((await publicConfigAi.aiStatus()).reason,'公开站文字服务暂停');
assert.equal((await publicConfigAi.readAiRequest(new Request('https://public.example/api/dialogue',{method:'POST',body:JSON.stringify({consent:true})}),500)).status,503);
await assert.rejects(()=>publicConfigAi.askModel('受控任务',{},100),/公开站文字服务暂停/);
const plansRoute=compile('app/api/credit-plans/route.ts',{'@/credit-plans.json':JSON.parse(fs.readFileSync(new URL('credit-plans.json',root),'utf8')),'@/lib/tenancy':tenancy,'@/lib/ai-config':{getConfig:async()=>({enabled:true,key_cipher:'controlled'})},'cloudflare:workers':{env:localVars}});
const pausedPlans=await (await plansRoute.GET(new Request('https://public.example/api/credit-plans'))).json();
assert.equal(pausedPlans.service.available,false);assert.equal(pausedPlans.service.reason,'公开站文字服务暂停');
delete localVars.OPENAI_GENERATION_PAUSED_REASON;
assert.equal((await (await plansRoute.GET(new Request('https://public.example/api/credit-plans'))).json()).service.available,true);
checks.push('local GPT requires authenticated accounts and loopback deployment; no public or invitation bypass');
console.log('PASS:',checks.length,'dialogue suites; no live provider requests\n'+checks.map(value=>'- '+value).join('\n'));
