// Product briefs and secondary external tools share one AI creation entry.
(() => {
  VIEW_LABELS.creative='扩展创意工具';
  const nav=document.querySelector('.main-nav');
  nav?.querySelector('[data-view="creative"]')?.remove();
  document.querySelector('#view-home .hero-actions')?.insertAdjacentHTML('beforeend','<a class="button ghost" href="/account/studio">开始 AI 创作 ↗</a>');
  document.querySelector('#view-studio .page-heading')?.insertAdjacentHTML('afterend','<div class="creative-workflow-link"><span>写文案、做图片、做视频，统一从 AI 创作进入。</span><a href="/account/studio">打开 AI 创作 ↗</a><button type="button" data-creative-open>扩展工具 · PPT / AI 模特</button></div>');
  const tools=[
    ['创意广场','看山西农品案例，复用视觉方向','https://dxsg.aiglink.cn/portal/plaza','01'],
    ['包装设计','填写产品、风格与材质，探索包装视觉','https://dxsg.aiglink.cn/portal/create/packaging','02'],
    ['灵感集市','搜索脚本、详情页、品牌故事等模板','https://dxsg.aiglink.cn/portal/market','03'],
    ['图文创作','品牌故事、产品介绍与社媒文案扩展工具','https://dxsg.aiglink.cn/portal/create/copywriting','04'],
    ['AI PPT','品牌介绍、招商方案、培训课件和产品介绍','https://dxsg.aiglink.cn/portal/ppt','05'],
    ['AI 模特','模特库、产品库、拍摄方案和批量生图','https://dxsg.aiglink.cn/portal/model-studio/workspace','06'],
    ['创作历史','回看丁香拾光账号下的创作成果','https://dxsg.aiglink.cn/portal/history','07']
  ];
  document.querySelector('.app-shell main').insertAdjacentHTML('beforeend',`
    <section class="view plus-view" id="view-creative" aria-labelledby="creative-title">
      <div class="plus-heading creative-heading"><span>CREATIVE WORKFLOW</span><h1 id="creative-title">一份真实资料，<em>打开更多创意。</em></h1><p>写文案、做图片、做视频，统一进入 AI 创作。需要 PPT、AI 模特或包装灵感时，再使用下方独立扩展工具。</p></div>
      <article class="creative-unified-entry"><div><span>紫丁香 · AI 创作</span><h2>文案、图片、视频，一个入口。</h2><p>平台统一提供创作服务。选择任务、填写农品信息，即可开始；生成前会明确确认本次额度消耗。</p></div><a class="plus-primary" href="/account/studio">进入 AI 创作 ↗</a></article>
      <div class="creative-bridge"><div><span>ONE BRIEF · MANY CREATIONS</span><h2>先整理真实农品资料，<br>再带着简报开始创作。</h2><p>选择商品与已核实的知识卡，整理成可编辑的创作简报。检查后带入 AI 创作，也可复制到自己选择的工具中。</p></div><form id="creative-brief-form"><label>选择农品<select name="productId" id="creative-product" required></select></label><div class="plus-two"><label>创作方向<select name="purpose"><option>商品图片</option><option>短视频</option><option>品牌文案</option><option>包装设计</option><option>AI PPT</option><option>AI 模特拍摄</option></select></label><label>视觉风格<select name="style"><option>紫丁香统一品牌</option><option>国潮新中式</option><option>现代轻奢</option><option>乡土质朴</option></select></label></div><label>补充需求<input name="need" maxlength="180" placeholder="例如：用于会客厅陈列的伴手礼包装"></label><div class="creative-knowledge"><b>选择要引用的知识卡</b><div id="creative-knowledge-list"></div></div><button class="plus-primary" type="submit">整理并复制创作简报 ↗</button><textarea id="creative-brief-output" rows="10" readonly placeholder="创作简报会显示在这里，供你检查和复制。"></textarea><button class="plus-primary" type="button" id="creative-send-media" disabled>带简报进入 AI 创作 ↗</button></form></div>
      <details class="creative-external-tools"><summary><span>更多扩展工具</span><b>PPT、AI 模特、包装灵感</b><small>丁香拾光独立平台 ↘</small></summary><p class="creative-boundary">这些工具使用丁香拾光独立账号、积分与存储。紫丁香账号下的配置和创作记录不会自动同步到该平台。</p><div class="creative-tools-grid">${tools.map(([name,description,url,index])=>`<article><span>${index} / LILAC TIME</span><h2>${name}</h2><p>${description}</p><a href="${url}" target="_blank" rel="noopener noreferrer">打开独立工具 ↗</a></article>`).join('')}</div></details>
    </section>`);
  document.querySelector('#creative-send-media').addEventListener('click',async()=>{
    const content=document.querySelector('#creative-brief-output').value;
    if(!content.trim()){toast('先选择农品，整理创作简报');return;}
    const button=document.querySelector('#creative-send-media');button.disabled=true;
    try{const response=await fetch('/api/me',{cache:'no-store',signal:AbortSignal.timeout(6000)});if(response.status===401){location.href='/login?return_to=/workbench.html';return;}if(!response.ok)throw Error('账号状态暂时无法读取，请稍后重试');const data=await response.json();if(!data.user?.id)throw Error('请先登录账号');window.sessionStorage.setItem(`zdx-media-brief:${data.user.id}`,content);location.href='/account/studio?brief=1';}catch(error){toast(error.message||'简报暂时无法带入，请复制后粘贴');button.disabled=false;}
  });
  document.querySelectorAll('[data-creative-open]').forEach(button=>button.addEventListener('click',()=>showView('creative')));
  const renderSelect=()=>{const select=document.querySelector('#creative-product'),old=select.value;select.innerHTML='<option value="">请选择真实农品</option>'+state.products.filter(p=>p.id!=='demo-product').map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');if(state.products.some(p=>p.id===old))select.value=old;};
  const renderKnowledgeOptions=()=>{const chosen=new Set([...document.querySelectorAll('[data-creative-knowledge]:checked')].map(input=>input.value));document.querySelector('#creative-knowledge-list').innerHTML=state.knowledge.filter(item=>item.verified).map(item=>`<label><input data-creative-knowledge type="checkbox" value="${esc(item.id)}" ${chosen.has(item.id)?'checked':''}><span>${esc(item.title)}</span></label>`).join('')||'<small>暂无已核实知识卡。</small>';};
  const prior=window.renderPlus;
  window.renderPlus=()=>{prior?.();renderSelect();renderKnowledgeOptions();};
  renderSelect();renderKnowledgeOptions();
  document.querySelector('#creative-brief-form').addEventListener('submit',async event=>{
    event.preventDefault();const f=new FormData(event.currentTarget),product=state.products.find(p=>p.id===f.get('productId'));if(!product)return;
    const selectedIds=new Set([...document.querySelectorAll('[data-creative-knowledge]:checked')].map(input=>input.value));
    const verified=state.knowledge.filter(item=>item.verified&&selectedIds.has(item.id)).slice(0,4).map(item=>`- ${item.title}：${item.content}`).join('\n');
    const content=`紫丁香计划 · ${f.get('purpose')}创作简报\n\n商品：${product.name}\n品类：${product.category||'待核实'}\n产地：${product.origin||'待核实'}\n生产者：${product.supplier||'待核实'}\n规格：${product.abv||'待核实'}\n商品介绍：${product.summary}\n已确认特点：${product.sellingPoints||'待补充'}\n适用场景：${product.occasions||'待补充'}\n视觉风格：${f.get('style')}\n补充需求：${String(f.get('need')||'无').trim()}\n\n已核实知识：\n${verified||'未选择，需人工补充'}\n\n要求：只使用以上已经核实的事实；不编造产地、资质、价格、销量与功效。包装的法定标签内容由生产者审核；图片中的商标与人物素材须取得授权。`;
    document.querySelector('#creative-brief-output').value=content;
    document.querySelector('#creative-send-media').disabled=false;
    try{await navigator.clipboard.writeText(content);toast('创作简报已复制，可带入 AI 创作');}catch{toast('简报已生成，请检查后带入 AI 创作或手动复制');}
  });
  const requestedView=new URLSearchParams(location.search).get('view');
  if(requestedView&&VIEW_LABELS[requestedView])showView(requestedView);
})();
