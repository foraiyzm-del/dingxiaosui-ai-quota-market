(() => {
  const knowledge = [
    {id:'plan',terms:['紫丁香','计划','发起','研究院','宗旨','口号','乡村振兴','县域'],title:'紫丁香计划',text:'紫丁香计划由山西农业大学智能传播研究院发起，以智能传播赋能山西特优农业。研究院提出四个方向：形成可复制、可推广的特优品牌解决方案；树立智慧农业示范案例；构建产学研用生态平台；打造智能传播创新高地。官网的具体主张是“让山西好物被更多人看见”。',link:'/#mission',label:'查看研究院宗旨'},
    {id:'opc',terms:['opc','主理人','加入','个人','招募','入驻','起步'],title:'OPC 主理人计划',text:'OPC 从一款真实农品起步：核实商品与素材、建立农品档案、做内容、展示个人小店、记录咨询并复盘。当前网页提供体验入驻与本地工作台；正式供货、订单和支付尚未接入。',link:'/#opc',label:'查看 OPC 计划'},
    {id:'studio',terms:['工作台','内容','创作','生成','小红书','视频号','知乎','抖音','朋友圈','导购卡','包装','一鱼多吃'],title:'紫丁香工作台',text:'在内容创作里选择一款农品、给一个主题，可一次生成朋友圈、小红书、视频号、知乎、抖音、公众号、线下海报、会客厅导购卡和包装文案的可编辑初稿。工作台还包括农品档案、品牌知识库、营销日历、办公提效、发布复盘及手动库存。发布前要核对商品事实、素材授权与标签。',link:'/index.html?view=studio',label:'打开内容创作'},
    {id:'salon',terms:['会客厅','线下','门店','体验店','品鉴','小店'],title:'紫丁香会客厅',text:'会客厅把线上 OPC 农品小店与线下约 48㎡ 的门店概念放在一起。线下方案包含农品陈列、风味品鉴、会客交流、内容拍摄与接待储物；门头和系列包装已经有概念效果图。实际装修、供货和运营仍需按场地与合作方深化。',link:'/index.html?view=salon',label:'看会客厅方案'},
    {id:'enterprise',terms:['品牌','企业','合作','收费','付费','定制','平台','价格','账号'],title:'品牌与企业合作',text:'目前规划三条合作路径：招募 OPC；品牌带商品和素材入驻，按内容、传播活动、培训或渠道服务商谈；企业按自身品牌使用整套平台并配置知识库、流程和团队权限。具体价格、授权和交付范围尚未确定，可在首页“品牌合作”生成需求简报。正式企业账号系统尚未上线。',link:'/#enterprise',label:'查看合作路径'},
    {id:'atlas',terms:['山西','农产品','特优','特色','地图','产地','地区','省内','风物'],title:'山西农产品地域特色',text:'山西省农业农村厅用“南果、中粮、北肉、东药材、西干果”概括特色农业布局。它适合寻找产区线索，不代表每个地方只生产一种农品。官网地图可点选山西 11 市；真正介绍商品时，还要核实城市、县域、生产者、规格与批次。',link:'/community.html#guides',label:'阅读山西风物课程'},
    {id:'taste',terms:['口味','风味','好吃','香','脆','糯','酸','甜','味道'],title:'如何介绍农品风味',text:'描述风味可以从香气、甜酸、脆软、汁水、嚼感和做法入手。果品可记录脆度与汁水，杂粮可记录煮后的谷香，干果可记录甜度与嚼感，调味品可记录酸香和搭配。口味随品种、批次、保存和烹饪变化，不能把一次试吃写成整片产区的固定特征。',link:'/community.html#guides',label:'阅读口味表达课程'},
    {id:'millet',terms:['小米','杂粮','谷物','沁州黄'],title:'小米与杂粮',text:'山西杂粮可从产地、品种、颗粒与煮后口感来讲。小米的“谷香”“软糯”属于具体样品的感官描述，应写明品种、做法和试吃记录；具体品牌的产地、等级与营养数据请看真实包装或已核实档案。',link:'/community.html#guides',label:'看山西风物课程'},
    {id:'vinegar',terms:['老陈醋','陈醋','醋'],title:'山西老陈醋',text:'介绍老陈醋时可以从酸香层次、烹饪搭配和实际试吃体验入手。不同品牌、工艺和批次会影响风味，配料、年份、产地和认证须以具体商品标签及生产者资料为准。',link:'/community.html#guides',label:'看风味课程'},
    {id:'fruit',terms:['红枣','梨','苹果','沙棘','果品','干果'],title:'山西果品与干果',text:'果品适合记录脆度、汁水、酸甜及储存后的变化；干果可记录甜度和嚼感。红枣、苹果、梨、沙棘等只是可探索的品类方向，不能代替某个具体商品的品种、产地、口味和供货信息。',link:'/community.html#guides',label:'看山西风物课程'},
    {id:'ip',terms:['丁小穗','小穗','形象','毛茸茸','ip','吉祥物'],title:'丁小穗',text:'我是丁小穗。“丁”取自紫丁香，“穗”连着山西的田野与丰收；毛茸茸的花冠、金色谷穗和农品小挎包，连接山西土地与好物。现在是官网 IP 形象提案，正式使用前还要核查名称和形象权利。',link:'/#lilac-ip',label:'看看我的形象'},
    {id:'news',terms:['新闻','报道','活动','启动','丰收'],title:'紫丁香行动纪实',text:'官网“行动纪实”汇总了行动启动、AI 新农人与产业一线、丰收交流会等报道，并链接到原文。具体活动日期、数据和成效请以发布方原文为准。',link:'/#news',label:'查看行动纪实'},
    {id:'academy',terms:['AI新农人','AI 新农人','新农人','培育学院','学院','课程','论坛','社区','学习','帖子'],title:'AI 新农人培育学院',text:'紫丁香计划面向农品生产者、品牌主理人和 OPC 伙伴培育 AI 新农人。可以先读八篇入门课程，学习山西风物、口味表达、AI 内容创作、产地短视频、直播演练、选品测试和 OPC 经营；再到工作台练习，在社区交流实际问题。',link:'/community.html#guides',label:'进入 AI 新农人培育学院'}
  ];
  const short = value => String(value ?? '').trim().slice(0, 700);
  const norm = value => String(value ?? '').toLowerCase().replace(/\s+/g,'');
  const readWorkspace = () => {
    try { const raw=JSON.parse(window.zdxStorage.local.getItem('zidingxiang-workspace-v1')||'{}'); return {products:Array.isArray(raw.products)?raw.products.slice(0,100):[],cards:Array.isArray(raw.knowledge)?raw.knowledge.filter(x=>x.verified).slice(0,100):[]}; }
    catch { return {products:[],cards:[]}; }
  };
  const productMatch = (question, products) => products.find(p => p.name && norm(question).includes(norm(p.name)) && p.id !== 'demo-product');
  const relevant = question => knowledge.map(item => ({...item,score:item.terms.reduce((n,term)=>n+(norm(question).includes(norm(term))?term.length>2?3:1:0),0)})).filter(x=>x.score).sort((a,b)=>b.score-a.score).slice(0,3);
  const localAnswer = question => {
    const workspace=readWorkspace();
    const product=productMatch(question,workspace.products);
    if(product){
      const cards=workspace.cards.filter(card=>norm(card.title+' '+card.content).includes(norm(product.name))).slice(0,2);
      const points=String(product.sellingPoints||'').split(/\n|、/).map(x=>x.trim()).filter(Boolean).slice(0,5);
      const lines=[`我在当前工作区的农品档案中找到了「${short(product.name)}」。`,product.origin?`记录的产地：${short(product.origin)}`:'产地待补充',product.abv?`记录的规格：${short(product.abv)}`:'规格待补充',product.summary?`商品介绍：${short(product.summary)}`:'商品介绍待补充',points.length?`档案中的特点：${points.map(short).join('；')}`:'特色卖点待补充'];
      if(cards.length)lines.push(`已标记核实的知识卡：${cards.map(c=>short(c.title)+'：'+short(c.content)).join('；')}`);
      lines.push('以上来自你当前账号或访客的工作区资料；对外介绍前，请再核对商品标签、批次及素材授权。');
      return {text:lines.join('\n'),links:[{href:'/index.html?view=products',label:'打开农品档案'}]};
    }
    if(/山西.*(农产品|好物|风物|特色)/.test(question)){
      const atlas=knowledge.find(item=>item.id==='atlas');
      return {text:atlas.text,links:[{href:atlas.link,label:atlas.label}]};
    }
    if(/(这个|这款|某款|所有|全部).*?(产品|农品|商品)|(产品|农品|商品).*?(特色|特点|有哪些|口味)/.test(question)){
      const products=workspace.products.filter(p=>p.id!=='demo-product');
      return products.length?{text:`当前工作区已有 ${products.length} 款农品档案：${products.slice(0,10).map(p=>short(p.name)).join('、')}。告诉我具体名称，我会按档案与已核实知识卡介绍特色；未核实的口味、产地和功效不会猜测。`,links:[{href:'/index.html?view=products',label:'查看农品档案'}]}:{text:'目前工作台只有虚构的演示商品，还没有可介绍的真实产品。先在“农品资料”录入一款真实商品及已确认特点，再问我它的特色。',links:[{href:'/index.html?view=products',label:'录入农品资料'}]};
    }
    const hits=relevant(question);
    if(hits.length){const top=hits[0];return {text:top.text,links:[{href:top.link,label:top.label}]};}
    return {text:'这个问题我暂时没有足够的已核实资料来回答。你可以问我紫丁香计划、AI 新农人培育学院、OPC、品牌合作、会客厅、工作台，或给我一款已录入农品的准确名称。我也可以帮你指出还需要核实哪些商品信息。',links:[{href:'/community.html#guides',label:'查看培育学院课程'}]};
  };
  const contextFor = question => {
    const workspace=readWorkspace(), product=productMatch(question,workspace.products);
    const hits=relevant(question);
    const docs=hits.length?hits:knowledge.filter(x=>['plan','atlas','taste'].includes(x.id));
    return [docs.map(x=>`${x.title}：${x.text} 来源：${x.link}`).join('\n'),product?`当前工作区商品档案：${JSON.stringify({name:product.name,category:product.category,origin:product.origin,summary:product.summary,sellingPoints:product.sellingPoints,occasions:product.occasions})}`:'',product?workspace.cards.filter(c=>norm(c.title+' '+c.content).includes(norm(product.name))).slice(0,3).map(c=>`用户标记已核实知识：${short(c.title)}：${short(c.content)} 来源：${short(c.source)}`).join('\n'):''].filter(Boolean).join('\n').slice(0,7500);
  };

  document.body.insertAdjacentHTML('beforeend', `<div class="ding-chat-root"><button class="ding-chat-launch" type="button" aria-label="和丁小穗对话" aria-expanded="false"><img src="ding-xiaosui-fluffy.webp" alt=""><span>问问丁小穗 <b>✦</b></span></button><section class="ding-chat-panel" role="dialog" aria-label="丁小穗对话" hidden><header><img src="ding-xiaosui-fluffy.webp" alt=""><div><b>丁小穗</b><small>紫丁香计划 · 山西农品向导</small></div><button type="button" class="ding-chat-close" aria-label="关闭对话">×</button></header><div class="ding-chat-messages" role="log" aria-live="polite"></div><div class="ding-chat-prompts"><button type="button">紫丁香计划是什么？</button><button type="button">山西农产品有什么特色？</button><button type="button">如何加入 OPC？</button></div><form class="ding-chat-form"><label for="ding-chat-input" class="sr-only">向丁小穗提问</label><input id="ding-chat-input" maxlength="500" placeholder="问我计划、产品、口味、会客厅…" autocomplete="off" required><button type="submit" aria-label="发送问题">↗</button></form><div class="ding-chat-meta"><span id="ding-chat-mode">依据官网与本地知识回答</span><label class="ding-chat-ai" hidden><input type="checkbox">使用在线 AI</label><button type="button" class="ding-chat-clear">清空对话</button></div></section></div>`);
  const root=document.querySelector('.ding-chat-root'),launch=root.querySelector('.ding-chat-launch'),panel=root.querySelector('.ding-chat-panel'),messages=root.querySelector('.ding-chat-messages'),input=root.querySelector('#ding-chat-input'),form=root.querySelector('.ding-chat-form'),send=form.querySelector('button'),aiLabel=root.querySelector('.ding-chat-ai'),aiToggle=aiLabel.querySelector('input');
  const key='zidingxiang-ding-chat-session-v3';
  let history=[];
  try{const saved=JSON.parse(window.zdxStorage.session.getItem(key)||'[]');if(Array.isArray(saved))history=saved.slice(-20).filter(x=>['assistant','user'].includes(x.role)&&typeof x.text==='string');}catch{}
  if(!history.length)history=[{role:'assistant',text:'你好，我是丁小穗！问我紫丁香计划、OPC、会客厅或山西风物。具体产品问题，我会查看当前工作区的农品档案。'}];
  const save=()=>{try{window.zdxStorage.session.setItem(key,JSON.stringify(history.slice(-20)));}catch{}};
  const render=()=>{
    messages.replaceChildren();
    history.forEach(item=>{
      const row=document.createElement('div');row.className=`ding-chat-message ${item.role}`;
      if(item.role==='assistant'){const avatar=document.createElement('img');avatar.src='ding-xiaosui-fluffy.webp';avatar.alt='';row.append(avatar);}
      const bubble=document.createElement('div');bubble.className='ding-chat-bubble';
      const p=document.createElement('p');p.textContent=item.text;bubble.append(p);
      (item.links||[]).forEach(link=>{const a=document.createElement('a');a.href=link.href;a.textContent=link.label+' ↗';bubble.append(a);});
      row.append(bubble);messages.append(row);
    });messages.scrollTop=messages.scrollHeight;
  };
  const add=(role,text,links=[])=>{history.push({role,text,links});history=history.slice(-20);save();render();};
  const open=()=>{panel.hidden=false;launch.setAttribute('aria-expanded','true');root.classList.add('open');render();input.focus();};
  const close=()=>{panel.hidden=true;launch.setAttribute('aria-expanded','false');root.classList.remove('open');launch.focus();};
  launch.addEventListener('click',()=>panel.hidden?open():close());
  document.querySelectorAll('[data-open-ding-chat]').forEach(button=>button.addEventListener('click',open));
  root.querySelector('.ding-chat-close').addEventListener('click',close);
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!panel.hidden)close();});
  root.querySelector('.ding-chat-clear').addEventListener('click',()=>{history=[{role:'assistant',text:'我们重新开始吧。你想了解紫丁香计划、山西农品，还是某款具体商品？'}];save();render();});
  const ask=async question=>{
    const value=question.trim().slice(0,500);if(!value)return;
    add('user',value);input.value='';send.disabled=true;root.querySelector('#ding-chat-mode').textContent='丁小穗正在整理资料…';
    let answer=localAnswer(value);
    let onlineUsed=false;
    if(aiToggle.checked){
      try{
        const response=await window.aiPilotFetch('/api/mascot-chat',{question:value,context:contextFor(value),history:history.slice(-7).map(x=>({role:x.role,text:x.text}))});
        if(!response.ok)throw new Error('online unavailable');
        const data=await response.json();if(data.answer){answer={text:data.answer,links:answer.links};onlineUsed=true;}
      }catch{aiToggle.checked=false;answer.text+='\n\n在线回答暂时不可用；以上为本地资料回答。';}
    }
    add('assistant',answer.text,answer.links);send.disabled=false;root.querySelector('#ding-chat-mode').textContent=onlineUsed?'在线 AI 已回答 · 请核对商品事实':'依据官网与本地知识回答';input.focus();
  };
  form.addEventListener('submit',event=>{event.preventDefault();ask(input.value);});
  root.querySelectorAll('.ding-chat-prompts button').forEach(button=>button.addEventListener('click',()=>ask(button.textContent)));
  fetch('/api/engine').then(r=>r.json()).then(data=>{if(data.mode==='model'){aiLabel.hidden=false;root.querySelector('#ding-chat-mode').textContent=`依据官网与本地知识回答 · 可选择${data.provider||'在线'} AI`;}}).catch(()=>{});
  aiToggle.addEventListener('change',()=>{root.querySelector('#ding-chat-mode').textContent=aiToggle.checked?'在线 AI 将接收本次问题及相关资料':'依据官网与本地知识回答';});
  render();
})();
