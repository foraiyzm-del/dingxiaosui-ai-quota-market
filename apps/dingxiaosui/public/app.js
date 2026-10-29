const STORAGE_KEY = 'zidingxiang-workspace-v1';
const CHANNELS = ['朋友圈', '小红书', '视频号', '知乎', '抖音', '公众号', '线下海报', '会客厅导购卡', '包装文案'];
const SCENES = ['日常种草', '新品上市', '产地体验邀约', '节庆推广', '渠道推荐'];
const VIEW_LABELS = {home:'工作总览',agent:'经营智能体',studio:'内容创作',knowledge:'品牌知识库',products:'农品资料',campaigns:'营销活动',plans:'发布与效果',office:'办公提效',inventory:'销售与库存',salon:'紫丁香会客厅',shop:'我的 OPC 农品小店'};
const $ = (selector, root=document) => root.querySelector(selector);
const $$ = (selector, root=document) => [...root.querySelectorAll(selector)];
const id = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const today = () => new Date().toLocaleDateString('sv-SE');
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const num = value => Math.max(0, Math.floor(Number(value) || 0));
const formatNumber = value => new Intl.NumberFormat('zh-CN').format(num(value));
const shortDate = value => value ? new Date(`${value}T00:00:00`).toLocaleDateString('zh-CN',{month:'numeric',day:'numeric'}) : '日期待定';
function defaultKnowledge(){return [
  {id:'editorial-shanxi-layout',title:'山西特优农业总体布局',kind:'产地故事',source:'https://nynct.shanxi.gov.cn/sndt/nyyw/202601/t20260122_10044589.html',content:'山西省农业农村厅用“南果、中粮、北肉、东药材、西干果”概括特色农业布局。具体商品的产地、供货和授权需逐项核实。',verified:true},
  {id:'editorial-lilac-mission',title:'智能传播研究院四句宗旨',kind:'品牌规范',source:'项目方提供',content:'形成一套可复制、可推广的特优品牌解决方案；树立一批有影响、有特色的智慧农业示范案例；构建一个强协同、强共享的产学研用生态平台；打造一处跨学科、跨领域的智能传播创新高地。',verified:true}
];}

function initialState(){
  return {
    version:1,
    demo:true,
    products:[{id:'demo-product',name:'晋乡·谷物礼盒',category:'杂粮 / 小米',abv:'500 g / 袋',price:'家庭餐桌 / 伴手礼',origin:'山西（示例，待核实）',supplier:'演示数据，无实际供货方',shelfLife:'待核实',summary:'这是一款用于体验紫丁香计划的虚构农品。正式创作前请替换为真实且获得授权的商品资料。',sellingPoints:'可展示清晰规格\n可记录真实咨询',occasions:'家庭餐桌、节日伴手礼',createdAt:new Date().toISOString()}],
    campaigns:[{id:'demo-campaign',name:'秋收好物内容计划（示例）',scene:'节庆推广',productId:'demo-product',startDate:'',endDate:'',goal:'围绕家庭餐桌场景，准备一组内容初稿。',createdAt:new Date().toISOString()}],
    drafts:[],plans:[],knowledge:defaultKnowledge(),stock:[],sales:[],office:[],agentRuns:[],mediaProfile:{},manualHotTopics:[]
  };
}
function normalizeState(raw){
  if(!raw || typeof raw !== 'object' || !Array.isArray(raw.products) || !Array.isArray(raw.campaigns) || !Array.isArray(raw.drafts) || !Array.isArray(raw.plans)) throw new Error('invalid workspace');
  return {version:1,demo:Boolean(raw.demo),products:raw.products.slice(0,1000),campaigns:raw.campaigns.slice(0,1000),drafts:raw.drafts.slice(0,3000),plans:raw.plans.slice(0,3000),knowledge:Array.isArray(raw.knowledge)?raw.knowledge.slice(0,500):defaultKnowledge(),stock:Array.isArray(raw.stock)?raw.stock.slice(0,500):[],sales:Array.isArray(raw.sales)?raw.sales.slice(0,2000):[],office:Array.isArray(raw.office)?raw.office.slice(0,500):[],agentRuns:Array.isArray(raw.agentRuns)?raw.agentRuns.slice(0,200):[],mediaProfile:raw.mediaProfile&&typeof raw.mediaProfile==='object'?raw.mediaProfile:{},manualHotTopics:Array.isArray(raw.manualHotTopics)?raw.manualHotTopics.slice(0,30):[],conversations:Array.isArray(raw.conversations)?raw.conversations.slice(0,60):[]};
}
let state;
try { state = normalizeState(JSON.parse(window.zdxStorage.local.getItem(STORAGE_KEY))); }
catch { state = initialState(); }
let activeView = 'home';
let engineMode = 'template';
let toastTimer;
function save(){try{window.zdxStorage.local.setItem(STORAGE_KEY,JSON.stringify(state));return true;}catch{toast('本次修改未能保存到浏览器，请先导出备份，再检查存储空间或刷新后的账号。');return false;}}
function toast(message){const el=$('#toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),3000);}
function showView(view){if(view==='shop'&&window.salonUnified){window.showSalonMode?.('online');return;}if(!VIEW_LABELS[view])return;activeView=view;if(view==='home')renderHome();$$('.view').forEach(el=>el.classList.toggle('is-active',el.id===`view-${view}`));$$('.nav-item').forEach(el=>el.classList.toggle('is-active',el.dataset.view===view));$$('[data-cycle-go]').forEach(el=>el.classList.toggle('is-active',el.dataset.cycleGo===view||(view==='salon'&&el.dataset.cycleGo==='shop')));$('#current-view-label').textContent=VIEW_LABELS[view];window.scrollTo({top:0,behavior:'instant'});window.positioningIntake?.showIfNeeded(view);}
function openDialog(name){$(`#${name}`).showModal();}
function closeDialog(name){$(`#${name}`).close();}
function productName(productId){return state.products.find(x=>x.id===productId)?.name || '未关联农品';}

function renderSelects(){
  for(const [selector,emptyText] of [['#brief-product','请先添加农品'],['#campaign-product','暂不关联']]){
    const select=$(selector), previous=select.value;
    select.innerHTML=`<option value="">${emptyText}</option>`+state.products.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
    if(state.products.some(p=>p.id===previous)) select.value=previous;
  }
  if(!$('#brief-product').value && state.products.length===1) $('#brief-product').value=state.products[0].id;
}
function renderHome(){
  const realProductIds=new Set(state.products.filter(item=>item.id!=='demo-product').map(item=>item.id));
  const realDrafts=state.drafts.filter(item=>realProductIds.has(item.productId));
  const realDraftIds=new Set(realDrafts.map(item=>item.id));
  const realCampaigns=state.campaigns.filter(item=>item.id!=='demo-campaign');
  const published=state.plans.filter(item=>item.status==='已发布'&&(!item.draftId||realDraftIds.has(item.draftId)));
  $('#metric-products').textContent=realProductIds.size;
  $('#metric-drafts').textContent=realDrafts.length;
  $('#metric-campaigns').textContent=realCampaigns.length;
  $('#metric-published').textContent=published.length;
  const recent=realDrafts.slice().sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,3);
  $('#home-recent').innerHTML=recent.length?recent.map(d=>`<div class="recent-item"><span class="recent-badge">${esc(d.channel)}</span><div><strong>${esc(d.title)}</strong><small>${esc(productName(d.productId))} · ${esc(d.scene)}</small></div><span>${shortDate(String(d.createdAt).slice(0,10))}</span></div>`).join(''):'<div class="empty-state"><strong>还没有内容初稿</strong>选择一款农品，生成你的第一组营销内容。</div>';
  const recordedInquiries=published.reduce((sum,item)=>sum+num(item.inquiries),0);
  let leads=[];try{const parsed=JSON.parse(window.zdxStorage.local.getItem('zidingxiang-opc-leads-v1')||'[]');leads=Array.isArray(parsed)?parsed:[];}catch{}
  const realLeads=leads.filter(item=>item.productId!=='demo-product');
  const realSales=state.sales.filter(item=>realProductIds.has(item.productId));
  const steps=[
    {label:'产品资料',detail:realProductIds.size?`${realProductIds.size} 款真实农品`:'待建立',done:realProductIds.size>0,view:'products',action:'先建立真实农品档案'},
    {label:'内容初稿',detail:realDrafts.length?`${realDrafts.length} 条真实农品初稿`:'待生成',done:realDrafts.length>0,view:'studio',action:'用真实资料生成内容'},
    {label:'渠道发布',detail:published.length?`${published.length} 条已手动标记发布`:'待记录',done:published.length>0,view:'plans',action:'安排发布并记录渠道'},
    {label:'客户咨询',detail:recordedInquiries+realLeads.length?`${recordedInquiries+realLeads.length} 条已记录`:'待承接',done:recordedInquiries+realLeads.length>0,view:'shop',action:'展示农品并记录咨询'},
    {label:'经营复盘',detail:realSales.length?`${realSales.length} 笔真实农品销售`:'待复盘',done:realSales.length>0,view:'inventory',action:'登记销售与库存'}
  ];
  $('#cycle-progress-steps').innerHTML=steps.map((step,index)=>`<button class="${step.done?'is-done':''}" data-goto="${step.view}" type="button"><span>${String(index+1).padStart(2,'0')}</span><b>${step.label}</b><small>${step.detail}</small><i>${step.done?'✓':'继续'}</i></button>`).join('');
  const next=steps.find(step=>!step.done)||steps[4],nextButton=$('#cycle-next-action');nextButton.dataset.goto=next.view;nextButton.textContent=steps.every(step=>step.done)?'查看经营复盘 ↗':`${next.action} ↗`;
  $('#cycle-progress-note').textContent=steps.every(step=>step.done)?'五步已有真实记录。继续用新一轮发布、咨询和销售数据验证内容效果。':'发布、浏览、咨询和销售均由使用者手动记录；站点不会代替你向任何平台自动发布。';
}
function renderProducts(){
  const demoCount=state.products.filter(item=>item.id==='demo-product').length,realCount=state.products.length-demoCount;
  $('#product-count').textContent=`${realCount} 款真实农品${demoCount?' · 另有演示资料':''}`;
  $('#product-list').innerHTML=state.products.length?state.products.map(p=>{
    const points=String(p.sellingPoints||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean).slice(0,3);
    const fields=[['品类',p.category],['产地',p.origin],['供货主体',p.supplier],['规格',p.abv],['保质期',p.shelfLife],['产品介绍',p.summary],['卖点',p.sellingPoints],['使用场景',p.occasions]],missing=fields.filter(([,value])=>!String(value||'').trim()).map(([label])=>label),score=Math.round((fields.length-missing.length)/fields.length*100),isDemo=p.id==='demo-product';
    return `<article class="product-card"><div class="product-cover"><span>${esc(p.category||'农品资料')}</span></div><div class="product-content"><h2>${esc(p.name)}</h2><div class="meta">${esc([p.origin,p.abv,p.price].filter(Boolean).join(' · ')||'农品信息')}</div><div class="profile-quality ${isDemo?'is-demo':score===100?'is-complete':''}"><div><span>${isDemo?'演示资料':`资料完整度 ${score}%`}</span><b>${isDemo?'不计入真实经营进度':missing.length?`待补：${missing.slice(0,3).join('、')}${missing.length>3?'等':''}`:'关键信息已补齐'}</b></div><i style="--quality:${isDemo?0:score}%"></i></div><p>${esc(p.summary)}</p><div class="tags">${points.map(point=>`<span>${esc(point)}</span>`).join('')}</div><div class="card-actions"><button class="small-button accent" data-product-action="create" data-id="${esc(p.id)}" type="button">用于创作 ↗</button><button class="small-button" data-product-action="edit" data-id="${esc(p.id)}" type="button">${!isDemo&&missing.length?'补全资料':'编辑'}</button><button class="small-button danger" data-product-action="remove" data-id="${esc(p.id)}" type="button">删除</button></div></div></article>`;
  }).join(''):'<div class="empty-state"><strong>先添加一款农品</strong>农品资料会成为内容创作的基础。</div>';
}
function renderCampaigns(){
  const ordered=state.campaigns.slice().sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
  $('#campaign-list').innerHTML=ordered.length?ordered.map(c=>`<article class="campaign-row"><span class="campaign-icon">◇</span><div class="main"><strong>${esc(c.name)}</strong><small>${esc(c.scene)} · ${esc(productName(c.productId))} · ${esc(c.startDate?`${shortDate(c.startDate)} 开始`:'日期待定')}</small></div><span class="status">进行中</span><button class="small-button accent" data-campaign-action="create" data-id="${esc(c.id)}" type="button">写内容 ↗</button><button class="small-button danger" data-campaign-action="remove" data-id="${esc(c.id)}" type="button">删除</button></article>`).join(''):'<div class="empty-state"><strong>还没有营销活动</strong>从上面的场景模板开始，或创建自己的活动。</div>';
}
let activeDraftId=null;
function renderDrafts(){
  const ordered=state.drafts.slice().sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
  $('#draft-count').textContent=`${ordered.length} 条`;
  if(!ordered.length){$('#draft-output').innerHTML='<div class="studio-empty"><span>✧</span><h3>一个主题，长出一组内容。</h3><p>选好农品和主题，点一次生成，即可得到朋友圈、小红书、视频号、知乎、抖音及线下物料版本。</p><div>朋友圈 · 小红书 · 视频号 · 知乎 · 抖音 · 导购卡 · 包装文案</div></div>';return;}
  const batchId=ordered[0].batchId;
  const latest=(batchId?ordered.filter(d=>d.batchId===batchId):ordered.slice(0,1)).sort((a,b)=>CHANNELS.indexOf(a.channel)-CHANNELS.indexOf(b.channel));
  const older=ordered.filter(d=>!latest.includes(d));
  if(!latest.some(d=>d.id===activeDraftId))activeDraftId=latest[0].id;
  const current=latest.find(d=>d.id===activeDraftId);
  const card=d=>`<article class="draft-card" data-draft-id="${esc(d.id)}"><div class="draft-top"><strong>${esc(d.channel)} · ${esc(d.scene)}</strong><span>${d.engine&&d.engine!=='template'?'AI 生成':'模板生成'} · ${shortDate(String(d.createdAt).slice(0,10))}</span></div><div class="draft-main"><label>标题</label><input data-draft-field="title" value="${esc(d.title)}" maxlength="150"><label>正文 / 脚本</label><textarea data-draft-field="body" maxlength="8000">${esc(d.body)}</textarea><div class="draft-actions"><button class="small-button accent" data-draft-action="copy" type="button">复制这个版本</button><button class="small-button" data-draft-action="plan" type="button">加入发布计划</button><button class="small-button danger" data-draft-action="remove" type="button">删除</button></div></div></article>`;
  $('#draft-output').innerHTML=`<div class="studio-batch-head"><div><span>ONE IDEA / MANY FORMATS</span><h3>最新一组 · ${latest.length} 个渠道版本</h3><p>切换渠道查看结构，直接编辑后复制或加入发布计划。</p></div><button data-copy-batch type="button">复制整组 ↗</button></div><div class="studio-channel-tabs" role="group" aria-label="最新一组内容渠道">${latest.map(d=>`<button data-switch-draft="${esc(d.id)}" aria-pressed="${d.id===activeDraftId}" type="button"><span>${esc(d.channel)}</span><small>${d.id===activeDraftId?'正在编辑':'查看版本'}</small></button>`).join('')}</div>${card(current)}${older.length?`<details class="studio-archive"><summary>查看更早的内容初稿 <b>${older.length} 条</b></summary><div>${older.map(card).join('')}</div></details>`:''}`;
}
function renderPlans(){
  const published=state.plans.filter(x=>x.status==='已发布');
  $('#report-posts').textContent=formatNumber(published.length);
  $('#report-views').textContent=formatNumber(published.reduce((sum,p)=>sum+num(p.views),0));
  $('#report-inquiries').textContent=formatNumber(published.reduce((sum,p)=>sum+num(p.inquiries),0));
  $('#report-signups').textContent=formatNumber(published.reduce((sum,p)=>sum+num(p.signups),0));
  $('#plan-count').textContent=`${state.plans.length} 条`;
  const ordered=state.plans.slice().sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  $('#plan-list').innerHTML=ordered.length?ordered.map(p=>`<article class="plan-row"><div class="plan-main"><div><strong>${esc(p.title)}</strong><small>${esc(p.channel)} · ${esc(p.date||'未定日期')}</small></div><span class="status-pill ${p.status==='已发布'?'done':''}">${esc(p.status)}</span></div>${p.status==='已发布'?`<div class="plan-metrics">浏览 ${formatNumber(p.views)} · 咨询 ${formatNumber(p.inquiries)} · 报名 ${formatNumber(p.signups)}</div><div class="publish-proof ${p.reviewConfirmed?'is-verified':''}">${p.reviewConfirmed?'✓ 已记录人工发布核验': '历史发布记录 · 未留存核验清单'}</div>`:''}<div class="plan-actions"><button class="small-button" data-plan-action="edit" data-id="${esc(p.id)}" type="button">编辑</button>${p.status==='待发布'?`<button class="small-button accent" data-plan-action="publish" data-id="${esc(p.id)}" type="button">核验并标记发布</button>`:`<button class="small-button" data-plan-action="results" data-id="${esc(p.id)}" type="button">录入效果</button>`}<button class="small-button danger" data-plan-action="remove" data-id="${esc(p.id)}" type="button">删除</button></div></article>`).join(''):'<div class="empty-state"><strong>还没有发布计划</strong>从内容初稿一键加入，或点击右上角添加。</div>';
  const totals=CHANNELS.map(channel=>({channel,posts:published.filter(p=>p.channel===channel),views:published.filter(p=>p.channel===channel).reduce((sum,p)=>sum+num(p.views),0)}));
  const max=Math.max(...totals.map(x=>x.views),1);
  $('#channel-insights').innerHTML=published.length?totals.map(c=>`<div class="channel-row"><div class="channel-top"><strong>${esc(c.channel)}</strong><span>${c.posts.length} 条 · ${formatNumber(c.views)} 浏览</span></div><div class="channel-bar"><span style="width:${Math.max(c.views/max*100,c.posts.length?4:0)}%"></span></div></div>`).join(''):'<div class="empty-state"><strong>发布后再看效果</strong>录入实际浏览和咨询数据，渠道表现会显示在这里。</div>';
}
function renderAll(){renderSelects();renderHome();renderProducts();renderCampaigns();renderDrafts();renderPlans();$('#demo-banner').hidden=!state.products.some(p=>p.id==='demo-product')&&!state.campaigns.some(c=>c.id==='demo-campaign');window.renderShop?.();window.renderPlus?.();window.renderMediaStudio?.();window.renderAgent?.();}

function safeWords(value){return String(value||'').trim().replace(/[。！？!?]+$/,'');}
function makeDraft(product, brief, channel){
  const topic=safeWords(brief.topic);
  const creator=state.mediaProfile?.onboardingComplete?state.mediaProfile:{};
  const audience=safeWords(brief.audience)||'关注山西好物的顾客';
  const points=String(product.sellingPoints||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean).slice(0,3);
  const pointText=safeWords(points.length?points.join('、'):product.summary);
  const facts=safeWords(brief.facts);
  const productFacts=[product.origin&&`产地：${product.origin}`,product.abv&&`规格：${product.abv}`,product.shelfLife&&`保质期：${product.shelfLife}`].filter(Boolean).join('；');
  const action=safeWords(brief.cta)||({品牌认知:'欢迎了解这款农品',获取咨询:'欢迎私信了解详情',活动报名:'欢迎咨询报名方式',渠道合作:'欢迎联系了解合作'}[brief.goal]||'欢迎了解详情');
  const sceneCopy={
    日常种草:{title:`${topic}｜认识${product.name}`,lead:`给${audience}的一份农品介绍，今天从「${topic}」聊起。`,middle:`${product.name}属于${product.category||'农品'}。${product.summary}\n\n${productFacts}。值得了解的地方：${pointText}。`,end:`适合的场景：${product.occasions||'请按实际场景介绍'}。${action}。`},
    新品上市:{title:`新品来了｜认识${product.name}`,lead:`一款新商品，先从真实特点开始介绍。${topic}。`,middle:`${product.name}：${product.summary}\n\n${productFacts}。这次想让大家记住：${pointText}。`,end:`${action}。上市、库存和价格请以实际供货资料为准。`},
    产地体验邀约:{title:`产地体验邀约｜一起认识${product.name}`,lead:`如果你想更认真地了解一款农品，欢迎关注这场体验。`,middle:`本次主题：${topic}。\n\n我们将围绕${product.name}，分享${pointText}。`,end:`${facts?`活动信息：${facts}。\n\n`:''}${action}。名额、时间和地点请以最终通知为准。`},
    节庆推广:{title:`${topic}｜让相聚多一份心意`,lead:`节日的好时刻，适合和重要的人一起分享。`,middle:`这次推荐${product.name}。${product.summary}\n\n它的特点：${pointText}。${product.occasions?`适合${product.occasions}等场景。`:''}`,end:`${action}。`},
    渠道推荐:{title:`渠道推荐｜认识${product.name}`,lead:`给正在寻找合适农品的合作伙伴，一份清晰的产品介绍。`,middle:`产品：${product.name}\n品类：${product.category||'待补充'}\n${productFacts}\n供货主体：${product.supplier||'待核实'}\n定位：${product.price||'待补充'}\n卖点：${pointText}\n适用场景：${product.occasions||'待补充'}`,end:`${action}。供货、合作政策与价格请以正式文件为准。`}
  }[brief.scene] || {};
  let body=`${sceneCopy.lead}\n\n${sceneCopy.middle}${facts&&brief.scene!=='产地体验邀约'?`\n\n已确认补充信息：${facts}。`:''}\n\n${sceneCopy.end}`;
  if(channel==='朋友圈') body=`${sceneCopy.lead}\n\n${product.name}，${pointText}。${product.occasions?`适合${product.occasions}。`:''}${facts?`\n${facts}。`:''}\n\n${action}。`;
  if(channel==='小红书') body=`${sceneCopy.lead}\n\n📌 农品：${product.name}\n🌾 产地与规格：${productFacts||'请以实际商品标签为准'}\n✨ 值得了解：${pointText}\n🍽️ 场景：${product.occasions||'按实际场景选择'}\n\n${product.summary}${facts?`\n\n${facts}。`:''}\n\n${action}。\n\n#山西好物 #${product.name.replace(/\s+/g,'')}`;
  if(channel==='视频号') body=`【封面】${sceneCopy.title}\n\n【开场 0—5 秒】\n${sceneCopy.lead}\n\n【主体 5—40 秒】\n镜头展示农品与真实场景。\n口播：这款${product.name}，${product.summary}\n主要特点是${pointText}。${facts?`\n已确认信息：${facts}。`:''}\n\n【结尾】\n${action}。\n\n【画面建议】使用已获授权的农品实拍与场景素材。`;
  if(channel==='公众号') body=`${sceneCopy.lead}\n\n一、认识这款农品\n${product.name}，${product.category||'农品'}。${product.summary}\n\n二、值得关注的特点\n${points.length?points.map((x,i)=>`${i+1}. ${x}`).join('\n'):pointText}\n\n三、适合的场景\n${product.occasions||'请结合实际消费场景介绍'}。${facts?`\n\n补充信息：${facts}。`:''}\n\n${sceneCopy.end}`;
  if(channel==='知乎') body=`问题：${topic}？\n\n先说结论：选择${product.name}前，最好看清具体商品资料和使用场景。\n\n这款商品已录入的信息：${product.summary}\n${productFacts||'产地与规格待核实'}。\n\n实际选择时可以看三点：\n1. 生产者和产地资料是否清楚；\n2. 规格、保存和配送是否适合自己；\n3. ${pointText}。\n\n${facts?`补充已确认信息：${facts}。\n\n`:''}${action}。`;
  if(channel==='抖音') body=`【3 秒开头】${topic}？先看这款${product.name}。\n【镜头 1】真实商品包装与标签特写。\n【镜头 2】产地或使用场景实拍，口播：${product.summary}\n【镜头 3】展示${pointText}，并说明${productFacts||'具体规格以商品标签为准'}。\n【结尾】${action}。\n【拍摄核对】镜头、音乐、场地、人物和商品资料须获授权。`;
  if(channel==='线下海报') body=`主标题：${topic}\n副标题：认识${product.name}\n核心介绍：${product.summary}\n现场看点：${pointText}\n商品信息：${productFacts||'具体信息以现场标签为准'}\n行动提示：${action}\n\n排版建议：上方品牌识别 / 中间商品实拍 / 下方规格与咨询二维码占位。二维码与活动信息须在印刷前核实。`;
  if(channel==='会客厅导购卡') body=`紫丁香会客厅 · 农品介绍卡\n\n商品：${product.name}\n产地与规格：${productFacts||'请核对商品标签'}\n一句话介绍：${product.summary}\n可以让来访者体验：${pointText}\n适合场景：${product.occasions||'请现场询问需求'}\n导购提问：您更关注口味、用途、规格还是配送？\n下一步：${action}。\n\n请以店内真实商品和授权素材替换演示内容。`;
  if(channel==='包装文案') body=`包装正面\n品牌：紫丁香计划 / 合作品牌须获授权\n商品名：${product.name}\n一句话：${pointText}\n\n包装背面信息草案\n品类：${product.category||'待核实'}\n产地：${product.origin||'待核实'}\n规格：${product.abv||'待核实'}\n生产者：${product.supplier||'待核实'}\n保存与保质期：${product.shelfLife||'待核实'}\n\n设计提示：紫丁香紫 × 暖白 × 产地纹样。最终标签项目、配料和资质需由生产者按实物及适用要求审核。`;
  if(creator.shopName&&['朋友圈','小红书'].includes(channel)) body=`我是「${creator.shopName}」的主理人。\n\n${body}`;
  if(creator.positioning&&['视频号','抖音'].includes(channel)) body=`【账号表达参考】${creator.positioning}\n【出镜口吻】${creator.personality || '自然讲述'}；按本人真实说话方式调整。\n\n${body}`;
  return {id:id(),productId:product.id,scene:brief.scene,channel,title:sceneCopy.title,body,engine:'template',createdAt:new Date().toISOString()};
}

async function loadEngine(){
  try{
    const response=await fetch('/api/engine',{cache:'no-store'});
    const data=await response.json();
    engineMode=data.mode==='model'?'model':'template';
  }catch{engineMode='template';}
  $('#engine-mode').textContent=engineMode==='model'?'✦ 在线模型生成':'✦ 模板演示生成';
  $('#model-consent-wrap').hidden=engineMode!=='model';
}
window.addEventListener('zdx:model-changed',()=>{void loadEngine();});

function productFormData(form){const f=new FormData(form);return {id:String(f.get('id')||id()),name:String(f.get('name')||'').trim(),category:String(f.get('category')||'').trim(),abv:String(f.get('abv')||'').trim(),price:String(f.get('price')||'').trim(),origin:String(f.get('origin')||'').trim(),supplier:String(f.get('supplier')||'').trim(),shelfLife:String(f.get('shelfLife')||'').trim(),summary:String(f.get('summary')||'').trim(),sellingPoints:String(f.get('sellingPoints')||'').trim(),occasions:String(f.get('occasions')||'').trim(),createdAt:new Date().toISOString()};}
function openProduct(product){const form=$('#product-form');form.reset();form.elements.id.value=product?.id||'';for(const key of ['name','category','abv','price','origin','supplier','shelfLife','summary','sellingPoints','occasions']) form.elements[key].value=product?.[key]||'';$('#product-dialog-title').textContent=product?'编辑农品':'新增农品';openDialog('product-dialog');}
function openCampaign(scene){const form=$('#campaign-form');form.reset();form.elements.scene.value=scene||'新品上市';if(scene) form.elements.name.value=scene==='新品上市'?'新品上市传播':scene==='产地体验邀约'?'产地体验活动':'节庆推广活动';openDialog('campaign-dialog');}
function openPlan(plan,draft){const form=$('#plan-form');form.reset();form.elements.id.value=plan?.id||'';form.elements.draftId.value=plan?.draftId||draft?.id||'';form.elements.title.value=plan?.title||draft?.title||'';form.elements.channel.value=plan?.channel||draft?.channel||'朋友圈';form.elements.date.value=plan?.date||today();$('#plan-dialog-title').textContent=plan?'编辑发布计划':'添加发布计划';openDialog('plan-dialog');}
function openPublishCheck(plan){const form=$('#publish-form');form.reset();form.elements.id.value=plan.id;$('#publish-plan-title').textContent=`${plan.title} · ${plan.channel} · ${plan.date||'未定日期'}`;openDialog('publish-dialog');}
function openResults(plan){const form=$('#results-form');form.reset();form.elements.id.value=plan.id;form.elements.views.value=num(plan.views);form.elements.inquiries.value=num(plan.inquiries);form.elements.signups.value=num(plan.signups);form.elements.note.value=plan.note||'';$('#results-plan-title').textContent=`${plan.title} · ${plan.channel}`;openDialog('results-dialog');}

$$('button.nav-item').forEach(button=>button.addEventListener('click',()=>showView(button.dataset.view)));
document.addEventListener('click',event=>{const button=event.target.closest('[data-goto]');if(button)showView(button.dataset.goto);});
$$('[data-cycle-go]').forEach(button=>button.addEventListener('click',()=>showView(button.dataset.cycleGo)));
$$('[data-close]').forEach(button=>button.addEventListener('click',()=>closeDialog(button.dataset.close)));
$$('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();}));
$('#today-label').textContent=new Date().toLocaleDateString('zh-CN',{year:'numeric',month:'long',day:'numeric'});

$('#add-product').addEventListener('click',()=>openProduct());
$('#product-form').addEventListener('submit',event=>{
  event.preventDefault();const product=productFormData(event.currentTarget);
  if(!product.name||!product.summary)return;
  const index=state.products.findIndex(x=>x.id===product.id);
  if(index>=0){product.createdAt=state.products[index].createdAt;state.products[index]=product;}else state.products.unshift(product);
  state.demo=false;if(!save())return;renderAll();closeDialog('product-dialog');toast(index>=0?'农品资料已更新':'农品已添加');
});
$('#product-list').addEventListener('click',event=>{
  const button=event.target.closest('[data-product-action]');if(!button)return;
  const product=state.products.find(x=>x.id===button.dataset.id);if(!product)return;
  if(button.dataset.productAction==='edit')openProduct(product);
  if(button.dataset.productAction==='create'){$('#brief-product').value=product.id;showView('studio');$('#brief-topic').focus();}
  if(button.dataset.productAction==='remove'&&confirm(`确定删除「${product.name}」吗？已有草稿仍会保留。`)){state.products=state.products.filter(x=>x.id!==product.id);state.demo=false;if(!save())return;renderAll();toast('农品已删除');}
});

$('#add-campaign').addEventListener('click',()=>openCampaign());
$$('[data-template]').forEach(button=>button.addEventListener('click',()=>openCampaign(button.dataset.template)));
$('#campaign-form').addEventListener('submit',event=>{
  event.preventDefault();const f=new FormData(event.currentTarget);
  const campaign={id:id(),name:String(f.get('name')||'').trim(),scene:String(f.get('scene')||''),productId:String(f.get('productId')||''),startDate:String(f.get('startDate')||''),endDate:String(f.get('endDate')||''),goal:String(f.get('goal')||'').trim(),createdAt:new Date().toISOString()};
  if(!campaign.name)return;
  state.campaigns.unshift(campaign);state.demo=false;if(!save())return;renderAll();closeDialog('campaign-dialog');toast('活动已创建');
});
$('#campaign-list').addEventListener('click',event=>{
  const button=event.target.closest('[data-campaign-action]');if(!button)return;
  const campaign=state.campaigns.find(x=>x.id===button.dataset.id);if(!campaign)return;
  if(button.dataset.campaignAction==='create'){$('#brief-scene').value=campaign.scene;if(campaign.productId)$('#brief-product').value=campaign.productId;$('#brief-topic').value=campaign.name;showView('studio');$('#brief-topic').focus();}
  if(button.dataset.campaignAction==='remove'&&confirm(`确定删除活动「${campaign.name}」吗？`)){state.campaigns=state.campaigns.filter(x=>x.id!==campaign.id);state.demo=false;if(!save())return;renderAll();toast('活动已删除');}
});

$('#reset-brief').addEventListener('click',()=>{$('#brief-form').reset();if(state.products.length===1)$('#brief-product').value=state.products[0].id;toast('内容简报已重置');});
$('#brief-form').addEventListener('submit',async event=>{
  event.preventDefault();const f=new FormData(event.currentTarget);
  const product=state.products.find(x=>x.id===f.get('productId'));
  const channels=f.getAll('channel').filter(x=>CHANNELS.includes(x)).sort((a,b)=>CHANNELS.indexOf(a)-CHANNELS.indexOf(b));
  const topic=String(f.get('topic')||'').trim();
  if(!product){toast('请先选择农品');return;}if(!topic){toast('请填写内容主题');return;}if(!channels.length){toast('请至少选择一个渠道');return;}
  const selectedKnowledge=$$('[data-knowledge-use]:checked').map(input=>state.knowledge.find(item=>item.id===input.value)).filter(item=>item?.verified).map(item=>item.content).join('\n').slice(0,1200);
  const brief={scene:SCENES.includes(f.get('scene'))?f.get('scene'):'日常种草',goal:String(f.get('goal')||''),topic,audience:String(f.get('audience')||''),facts:[String(f.get('facts')||''),selectedKnowledge].filter(Boolean).join('\n').slice(0,1600),cta:String(f.get('cta')||''),positioning:String(state.mediaProfile?.positioning||'').slice(0,240),personality:String(state.mediaProfile?.personality||'').slice(0,60)};
  const button=$('#generate-button');
  let drafts;
  if(engineMode==='model'){
    if(!$('#model-consent').checked){toast('请先确认资料使用与模型发送授权');return;}
    button.disabled=true;button.firstChild.textContent='正在生成初稿 ';
    try{
      const response=await window.aiPilotFetch('/api/generate',{product,brief,channels});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||'AI 生成失败，请稍后重试');
      drafts=data.drafts.map(d=>({id:id(),productId:product.id,scene:brief.scene,channel:d.channel,title:d.title,body:d.body,engine:data.provider||'model',createdAt:new Date().toISOString()}));
    }catch(error){toast(error.message||'AI 生成失败');return;}
    finally{button.disabled=false;button.firstChild.textContent='一键生成多渠道内容 ';$('#model-consent').checked=false;window.updateStudioChannelCount?.();}
  }else drafts=channels.map(channel=>makeDraft(product,brief,channel));
  const batchId=id();drafts.forEach(draft=>draft.batchId=batchId);activeDraftId=drafts[0]?.id||null;
  state.drafts.unshift(...drafts);state.demo=false;if(!save())return;renderAll();toast(`已生成 ${drafts.length} 条可编辑初稿`);
});
function persistDraftEdit(event,notify=false){
  const input=event.target.closest('[data-draft-field]');if(!input)return;
  if(!['title','body'].includes(input.dataset.draftField))return;
  const card=input.closest('[data-draft-id]'),draft=state.drafts.find(x=>x.id===card?.dataset.draftId);if(!draft)return;
  draft[input.dataset.draftField]=input.value.trim();if(!save())return;
  if(notify){renderHome();toast('修改已保存');}
}
$('#draft-output').addEventListener('input',event=>persistDraftEdit(event));
$('#draft-output').addEventListener('change',event=>persistDraftEdit(event,true));
$('#draft-output').addEventListener('click',async event=>{
  const switcher=event.target.closest('[data-switch-draft]');
  if(switcher){activeDraftId=switcher.dataset.switchDraft;renderDrafts();return;}
  const copyBatch=event.target.closest('[data-copy-batch]');
  if(copyBatch){const ordered=state.drafts.slice().sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))),batchId=ordered[0]?.batchId,latest=batchId?ordered.filter(d=>d.batchId===batchId):ordered.slice(0,1);try{await navigator.clipboard.writeText(latest.map(d=>`【${d.channel}】\n${d.title}\n\n${d.body}`).join('\n\n──────────\n\n'));toast(`已复制 ${latest.length} 个渠道版本`);}catch{toast('复制失败，请逐个复制内容');}return;}
  const button=event.target.closest('[data-draft-action]');if(!button)return;
  const card=button.closest('[data-draft-id]'),draft=state.drafts.find(x=>x.id===card?.dataset.draftId);if(!draft)return;
  if(button.dataset.draftAction==='copy'){
    const title=$('[data-draft-field="title"]',card).value,body=$('[data-draft-field="body"]',card).value;
    draft.title=title.trim();draft.body=body.trim();const saved=save();renderHome();
    try{await navigator.clipboard.writeText(`${title}\n\n${body}`);toast(saved?'内容已复制，修改已保存':'内容已复制；本机保存失败，请保留此备份');}catch{toast('复制失败，请手动选择内容复制');}
  }
  if(button.dataset.draftAction==='plan')openPlan(null,draft);
  if(button.dataset.draftAction==='remove'&&confirm('确定删除这条内容初稿吗？')){state.drafts=state.drafts.filter(x=>x.id!==draft.id);if(!save())return;renderAll();toast('初稿已删除');}
});

$('#add-plan').addEventListener('click',()=>openPlan());
$('#plan-form').addEventListener('submit',event=>{
  event.preventDefault();const f=new FormData(event.currentTarget);
  const plan={id:String(f.get('id')||id()),draftId:String(f.get('draftId')||''),title:String(f.get('title')||'').trim(),channel:String(f.get('channel')||''),date:String(f.get('date')||''),status:'待发布',views:0,inquiries:0,signups:0,note:'',createdAt:new Date().toISOString()};
  if(!plan.title||!plan.date)return;
  const index=state.plans.findIndex(x=>x.id===plan.id);
  if(index>=0){const previous=state.plans[index];Object.assign(previous,plan,{createdAt:previous.createdAt,status:previous.status,views:previous.views,inquiries:previous.inquiries,signups:previous.signups,note:previous.note,reviewConfirmed:previous.reviewConfirmed,reviewConfirmedAt:previous.reviewConfirmedAt,publicationMethod:previous.publicationMethod});}else state.plans.unshift(plan);
  state.demo=false;if(!save())return;renderAll();closeDialog('plan-dialog');showView('plans');toast(index>=0?'发布计划已更新':'已加入发布计划');
});
$('#plan-list').addEventListener('click',event=>{
  const button=event.target.closest('[data-plan-action]');if(!button)return;
  const plan=state.plans.find(x=>x.id===button.dataset.id);if(!plan)return;
  if(button.dataset.planAction==='edit')openPlan(plan);
  if(button.dataset.planAction==='publish')openPublishCheck(plan);
  if(button.dataset.planAction==='results')openResults(plan);
  if(button.dataset.planAction==='remove'&&confirm(`确定删除发布记录「${plan.title}」吗？`)){state.plans=state.plans.filter(x=>x.id!==plan.id);if(!save())return;renderAll();toast('发布记录已删除');}
});
$('#publish-form').addEventListener('submit',event=>{
  event.preventDefault();const f=new FormData(event.currentTarget),plan=state.plans.find(x=>x.id===f.get('id'));if(!plan)return;
  if(f.get('facts')!=='on'||f.get('rights')!=='on'||f.get('manual')!=='on'){toast('请完成三项发布核验');return;}
  plan.status='已发布';plan.reviewConfirmed=true;plan.reviewConfirmedAt=new Date().toISOString();plan.publicationMethod='manual';
  if(!save())return;renderAll();closeDialog('publish-dialog');toast('已记录人工发布，可继续录入实际效果');
});
$('#results-form').addEventListener('submit',event=>{
  event.preventDefault();const f=new FormData(event.currentTarget),plan=state.plans.find(x=>x.id===f.get('id'));if(!plan)return;
  plan.views=num(f.get('views'));plan.inquiries=num(f.get('inquiries'));plan.signups=num(f.get('signups'));plan.note=String(f.get('note')||'').trim();
  if(!save())return;renderAll();closeDialog('results-dialog');toast('发布效果已记录');
});

$('#export-data').addEventListener('click',()=>{
  const readBackup=(key,fallback)=>{try{return JSON.parse(window.zdxStorage.local.getItem(key))??fallback}catch{return fallback}};
  const bundle={format:'zidingxiang-demo-v1',exportedAt:new Date().toISOString(),workspace:state,profile:readBackup('zidingxiang-opc-profile-v1',null),leads:readBackup('zidingxiang-opc-leads-v1',[])};
  const blob=new Blob([JSON.stringify(bundle,null,2)],{type:'application/json;charset=utf-8'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`紫丁香计划工作数据-${today()}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('数据已导出');
});
$('#import-data').addEventListener('change',async event=>{
  const file=event.target.files?.[0];if(!file)return;
  if(file.size>5*1024*1024){toast('文件不能超过 5 MB');event.target.value='';return;}
  try{
    const parsed=JSON.parse(await file.text());
    const imported=normalizeState(parsed.workspace||parsed);
    if(!confirm('导入会替换当前工作区资料；已登录时还会更新服务器。请先导出备份，确定继续吗？'))return;
    const entries={[STORAGE_KEY]:JSON.stringify(imported)};
    if(parsed.format==='zidingxiang-demo-v1'){
      if(parsed.profile===null||parsed.profile&&typeof parsed.profile==='object'&&!Array.isArray(parsed.profile))entries['zidingxiang-opc-profile-v1']=parsed.profile===null?null:JSON.stringify(parsed.profile);
      if(Array.isArray(parsed.leads))entries['zidingxiang-opc-leads-v1']=JSON.stringify(parsed.leads.slice(0,500));
    }
    window.zdxStorage.importWorkspace(entries);state=imported;
    await window.zdxStorage.sync.flush();
    if(window.zdxStorage.sync.status().dirty){renderAll();toast('导入资料已暂存在本机，请先完成页面顶部的同步处理，再刷新。');return;}
    location.reload();
  }catch{toast('导入失败，请选择紫丁香计划导出的 JSON 文件');}finally{event.target.value='';}
});
$('#clear-demo').addEventListener('click',()=>{
  if(!confirm('移除虚构示例农品、活动及由示例农品生成的内容和发布记录？你自己添加的资料会保留。'))return;
  const sampleDrafts=new Set(state.drafts.filter(d=>d.productId==='demo-product').map(d=>d.id));
  state.products=state.products.filter(p=>p.id!=='demo-product');
  state.campaigns=state.campaigns.filter(c=>c.id!=='demo-campaign');
  state.drafts=state.drafts.filter(d=>!sampleDrafts.has(d.id));
  state.plans=state.plans.filter(p=>!sampleDrafts.has(p.draftId));
  state.demo=false;if(!save())return;renderAll();showView('products');toast('虚构示例已移除');
});

renderAll();
loadEngine();
const requestedView=new URLSearchParams(location.search).get('view');
if(requestedView&&VIEW_LABELS[requestedView])showView(requestedView);
