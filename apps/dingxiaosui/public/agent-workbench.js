// 经营智能体试点：基于当前工作区中已录入的事实编排任务，所有外发内容由人审核。
(() => {
  const nav = document.querySelector('.main-nav');
  const main = document.querySelector('.app-shell main');
  if (!nav || !main || typeof state === 'undefined') return;
  nav.querySelector('[data-view="home"]').insertAdjacentHTML('afterend', '<button class="nav-item" data-view="agent" type="button"><span class="nav-icon">✳</span> 经营智能体</button>');
  nav.querySelector('[data-view="agent"]').addEventListener('click', () => { showView('agent'); renderAgent(); });
  main.insertAdjacentHTML('beforeend', `
    <section class="view agent-view" id="view-agent" aria-labelledby="agent-title">
      <div class="agent-hero">
        <div><span class="agent-kicker">DING XIAOSUI · OPERATIONS COPILOT</span><h1 id="agent-title">今天的生意，<em>从哪件事做起？</em></h1><p>丁小穗读取你已录入的农品、知识、库存和发布记录，整理能执行的步骤。你决定内容、时间和承诺，再保存为草稿或计划。</p><div class="agent-hero-tags"><span>选一款农品</span><span>说清当前难题</span><span>拿到行动清单</span></div></div>
        <button class="agent-mascot" type="button" data-ding-play aria-label="逗丁小穗玩"><img src="ding-xiaosui-fluffy.webp" alt=""><span>陪你把事做成 ✦</span></button>
      </div>
      <div class="agent-workflow">
        <form class="agent-panel agent-brief" id="agent-form">
          <div class="agent-panel-heading"><span>01 / INPUT</span><h2>交给丁小穗一件具体的事</h2></div>
          <label>任务类型<select name="kind" required><option value="daily">今日经营安排</option><option value="video">短视频选题与拍摄</option><option value="live">一场直播怎么准备</option><option value="followup">客户咨询怎么跟进</option><option value="stock">库存怎么推进</option></select></label>
          <label>真实农品<select name="productId" id="agent-product" required><option value="">先添加真实农品</option></select></label>
          <label>眼下最棘手的问题<textarea name="context" rows="4" maxlength="600" required placeholder="例如：老客户问小米适合怎么吃，明天要拍一条短视频；不要填写客户手机号等敏感信息。"></textarea></label>
          <label>今天可用的时间<select name="minutes"><option value="20">20 分钟</option><option value="45" selected>45 分钟</option><option value="90">90 分钟</option></select></label>
          <label id="agent-model-option" hidden><input type="checkbox" name="useModel"> 使用在线模型细化执行方案（本次资料将发送给模型服务）</label>
          <div class="agent-input-note">使用当前账号的工作区记录；未登录时只使用本机资料。未核实的价格、功效、优惠和产地不会自动写成对外承诺。</div>
          <button class="agent-primary" type="submit">生成可执行方案 <span>↗</span></button>
          <button class="agent-link" type="button" data-agent-go="products">没有农品资料？先建档 ↗</button>
        </form>
        <div class="agent-panel agent-result-panel"><div class="agent-panel-heading"><span>02 / REVIEW & ACT</span><h2>检查，再变成行动</h2></div><div id="agent-result" class="agent-empty"><b>丁小穗在这里等你</b><p>选择任务，填一句当前问题。生成后可修改方案、勾选待办、保存到办公草稿或建立发布计划。</p></div></div>
      </div>
      <div class="agent-history-wrap"><div class="agent-panel-heading"><span>03 / WORK LOG</span><h2>最近的经营任务</h2></div><div id="agent-history" class="agent-history"></div></div>
      <p class="agent-boundary">先依据当前工作区中已录入的资料编排任务；在线模型需授权并逐次勾选。所有方案都由经营者核实后执行，不会自动向抖音、微信或客户发送内容。登录后经营记录自动保存到服务器；换设备登录同一账号即可读取，保存状态见页面顶部。</p>
    </section>`);

  const root = document.querySelector('#view-agent');
  const form = root.querySelector('#agent-form');
  const result = root.querySelector('#agent-result');
  const labels = {daily:'今日经营安排',video:'短视频选题与拍摄',live:'一场直播怎么准备',followup:'客户咨询怎么跟进',stock:'库存怎么推进'};
  let selectedRun = null;
  const refreshAgentModel=()=>fetch('/api/engine',{cache:'no-store'}).then(r=>r.ok?r.json():{mode:'template'}).then(data=>{const option=root.querySelector('#agent-model-option');option.hidden=data.mode!=='model';if(data.mode!=='model')option.querySelector('input').checked=false;}).catch(()=>{});
  refreshAgentModel();window.addEventListener('zdx:model-changed',refreshAgentModel);
  function realProducts() { return state.products.filter(p => p.id !== 'demo-product'); }
  function renderAgent() {
    const select = root.querySelector('#agent-product'), previous = select.value;
    select.innerHTML = '<option value="">请选择真实农品</option>' + realProducts().map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
    if (realProducts().some(p => p.id === previous)) select.value = previous;
    renderHistory();
    if (selectedRun) renderResult();
  }
  function renderHistory() {
    const runs = (state.agentRuns || []).slice(0,12);
    root.querySelector('#agent-history').innerHTML = runs.length ? runs.map(run => `<button type="button" data-agent-open="${esc(run.id)}"><small>${esc(run.date)} · ${esc(labels[run.kind] || run.kind)}</small><b>${esc(run.productName)}</b><span>${esc(run.context.slice(0,58))}</span><i>查看 ↗</i></button>`).join('') : '<p>还没有经营任务。先处理今天最重要的一件事。</p>';
  }
  function evidence(product) {
    const facts = [product.origin && `产地：${product.origin}`, product.abv && `规格：${product.abv}`, product.supplier && `供货方：${product.supplier}`, product.summary && `简介：${product.summary}`, product.sellingPoints && `卖点：${product.sellingPoints.replace(/\n/g, '；')}`].filter(Boolean);
    const verified = state.knowledge.filter(k => k.verified && (k.title.includes(product.name) || k.content.includes(product.name))).slice(0,2);
    return {facts, verified};
  }
  function makeRun({kind, product, context, minutes}) {
    const stock = state.stock.find(x => x.productId === product.id);
    const plans = state.plans.filter(x => x.productId === product.id || state.drafts.some(d => d.id === x.draftId && d.productId === product.id));
    const sold = state.sales.filter(x => x.productId === product.id).reduce((n,x) => n + Number(x.quantity || 0), 0);
    const {facts, verified} = evidence(product);
    const missing = [['产地',product.origin],['规格',product.abv],['供货方',product.supplier],['保质期与保存',product.shelfLife],['已确认卖点',product.sellingPoints]].filter(([,value]) => !String(value || '').trim()).map(([label]) => label);
    const lowStock = Boolean(stock && stock.quantity <= stock.threshold);
    if (lowStock) missing.push('可售库存已到提醒线，请先核实补货');
    if (!stock && ['live','stock'].includes(kind)) missing.push('库存尚未登记，请先核实可售数量');
    const slot = Math.max(5, Math.floor(minutes / 3));
    const stepMap = {
      daily: [['核资料',`用 ${slot} 分钟对照实物核对${product.name}的规格、库存和可说的卖点。`],['做内容',`用 ${slot} 分钟围绕“${context}”写一条回答客户问题的内容，再拍一段实物素材。`],['看反馈',`用剩余时间查看最近咨询、已发布内容和销售记录；只记录真实数字。`]],
      video: [['定开头',`用顾客真实问题“${context}”作前 3 秒；镜头先给商品实物和使用场景。`],['拍证据',`竖屏拍包装标签、产地或制作过程；每个口播点都能在资料卡或实物上找到依据。`],['发前审',`核对字幕、画面授权、规格和联系方式，再加入发布计划并人工发布。`]],
      live: [['直播前',`核实${product.name}的现货、规格、价格、配送与售后；没有确认的内容留作待答问题。`],['直播中',`按“开场说明→实物展示→客户问答→使用演示→回顾咨询”讲清楚；把“${context}”放进问答段。`],['直播后',`记录观看、咨询、常问问题和实际销售，整理下一场直播可改进的三点。`]],
      followup: [['还原需求',`先复述客户关于“${context}”的真实问题，确认用途、数量和交付期。`],['提供证据',`只发送已核实的${product.name}资料与实物图；价格、物流和时效先问供货方。`],['约定下次',`用明确日期安排人工跟进，记录客户回复与未解决问题，不自动发送消息。`]],
      stock: [['核数',`核对${product.name}的实物库存、可售数量和最近销售记录。`],lowStock ? ['先稳供货',`当前数量已到提醒线，先和供货方确认补货时间、可售上限；未确认前不要开展集中促销。`] : !stock ? ['先建库存',`库存尚未登记，先确认今天可售数量、计量单位、提醒线与供货联系人。`] : ['设计去化',`围绕真实使用场景做一条短内容和一张导购卡；不得捏造折扣与稀缺性。`],['看结果',`将咨询、成交和余量逐日手动记入工作台，再决定是否补货或调整陈列。`]]
    };
    const steps = stepMap[kind].map(([title,body]) => ({title,body,done:false}));
    const stockLine = stock ? `库存：${stock.quantity}${stock.unit || '件'}，提醒线 ${stock.threshold}${stock.unit || '件'}` : '库存：尚未登记';
    const review = missing.length ? `发布前请补齐或核对：${missing.join('、')}。` : '基础商品字段已录入，发布前仍需核对实物标签、价格和素材授权。';
    const outward = kind === 'stock' && lowStock ? `当前库存已到提醒线。先确认补货与可售数量，再决定是否对外推广${product.name}；不得承诺未确认的发货时间。` : `针对“${context}”，先把${product.name}已核对的规格和使用场景讲清楚，再展示实物；具体价格、配送和功效请以确认资料为准。`;
    const draft = `【${labels[kind]}｜${product.name}】\n面向的问题：${context}\n\n经营者已录入资料：${facts.join('；') || '暂无商品资料'}。\n${stockLine}；已记销售 ${sold} 件；关联发布记录 ${plans.length} 条。\n\n今天的执行顺序：\n${steps.map((s,i) => `${i+1}. ${s.title}：${s.body}`).join('\n')}\n\n待审表达草稿：${outward}\n\n复核：${review}`;
    return {id:id(),kind,productId:product.id,productName:product.name,context,minutes,date:today(),facts,verified:verified.map(k => `${k.title}（${k.source || '来源待补'}）`),missing,stockLine,sold,plans:plans.length,steps,draft,review};
  }
  function renderResult() {
    const run = selectedRun;
    if (!run) return;
    result.className = 'agent-result';
    result.innerHTML = `<div class="agent-result-meta"><span>${esc(labels[run.kind] || run.kind)}</span><small>${esc(run.engine || '本地规则编排')} · ${esc(run.date)}</small></div><h3>${esc(run.productName)} · 先把这件事做完</h3><p class="agent-context">${esc(run.context)}</p>
      <div class="agent-evidence"><b>这次用了哪些资料</b><p>${run.facts.length ? run.facts.map(esc).join(' · ') : '商品资料待补齐'}</p><small>${run.verified.length ? `已核实知识：${run.verified.map(esc).join('；')}` : '没有匹配的商品知识卡；没有引用未核实知识。'}</small><small>${esc(run.stockLine)} · 已记销售 ${run.sold} 件 · 关联发布 ${run.plans} 条</small></div>
      <div class="agent-steps"><b>行动清单</b>${run.steps.map((step,i) => `<label><input type="checkbox" data-agent-step="${i}" ${step.done ? 'checked' : ''}><span><strong>${esc(step.title)}</strong><small>${esc(step.body)}</small></span></label>`).join('')}</div>
      <div class="agent-review"><b>发布前核对</b><p>${esc(run.review)}</p></div>
      <label class="agent-edit-label">可编辑方案<textarea id="agent-edit" rows="13" maxlength="8000">${esc(run.draft)}</textarea></label>
      <div class="agent-result-actions"><button type="button" data-agent-action="save">保存修改</button><button type="button" data-agent-action="office">存为办公草稿</button><button type="button" data-agent-action="draft">存为内容初稿</button><button type="button" data-agent-action="plan">建立发布计划</button><button type="button" data-agent-action="copy">复制方案</button></div>`;
  }
  function persist() {
    if (!selectedRun) return;
    selectedRun.draft = root.querySelector('#agent-edit')?.value.trim() || selectedRun.draft;
    const found = state.agentRuns.find(x => x.id === selectedRun.id);
    if (found) Object.assign(found, selectedRun);
    else state.agentRuns.unshift(selectedRun);
    state.agentRuns = state.agentRuns.slice(0,200);
    if(!save())return; renderHistory();
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const data = new FormData(form), product = realProducts().find(p => p.id === data.get('productId'));
    const context = String(data.get('context') || '').trim();
    if (!product) { toast('请先添加一款真实农品'); showView('products'); return; }
    if (context.length < 8) { toast('请具体写一句当前问题，至少 8 个字'); return; }
    const run = makeRun({kind:String(data.get('kind')),product,context,minutes:Number(data.get('minutes'))});
    let modelFailure='';
    if(data.get('useModel')==='on'){
      const submit=form.querySelector('[type="submit"]');submit.disabled=true;submit.firstChild.textContent='在线模型整理中 ';
      try{
        const response=await window.aiPilotFetch('/api/agent',{kind:run.kind,product,context,minutes:run.minutes,verified:run.verified,steps:run.steps.map(s=>`${s.title}：${s.body}`),stock:run.stockLine,review:run.review});
        const result=await response.json();if(!response.ok)throw new Error(result.error||'在线模型暂不可用');
        run.draft=result.body;run.engine=`${result.provider||'在线模型'}细化`;
      }catch(error){modelFailure=`${error.message||'在线模型失败'}；已保留本地方案`;}
      finally{submit.disabled=false;submit.firstChild.textContent='生成可执行方案 ';form.elements.useModel.checked=false;}
    }
    selectedRun = run;
    state.agentRuns.unshift(selectedRun); state.agentRuns = state.agentRuns.slice(0,200); if(!save())return;
    renderHistory(); renderResult(); result.scrollIntoView({behavior:'smooth',block:'start'});
    toast(modelFailure||'执行方案已生成，可修改并逐项完成');
  });
  root.addEventListener('change', event => {
    const step = event.target.closest('[data-agent-step]');
    if (!step || !selectedRun) return;
    selectedRun.steps[Number(step.dataset.agentStep)].done = step.checked;
    persist();
  });
  root.addEventListener('click', async event => {
    const go = event.target.closest('[data-agent-go]');
    if (go) { showView(go.dataset.agentGo); return; }
    const history = event.target.closest('[data-agent-open]');
    if (history) { selectedRun = state.agentRuns.find(x => x.id === history.dataset.agentOpen); renderResult(); result.scrollIntoView({behavior:'smooth',block:'start'}); return; }
    const button = event.target.closest('[data-agent-action]');
    if (!button || !selectedRun) return;
    persist();
    const action = button.dataset.agentAction;
    if (action === 'save') { toast('方案修改已保存'); return; }
    if (action === 'copy') { try { await navigator.clipboard.writeText(selectedRun.draft); toast('方案已复制'); } catch { toast('复制失败，请选中文本手动复制'); } return; }
    if (action === 'office') { state.office.unshift({id:id(),kind:labels[selectedRun.kind],body:selectedRun.draft,date:today()}); if(!save())return; window.renderPlus?.(); toast('已存入办公草稿，可继续编辑'); return; }
    if (action === 'draft') {
      state.drafts.unshift({id:id(),productId:selectedRun.productId,scene:'日常种草',channel:selectedRun.kind === 'video' ? '抖音' : '朋友圈',title:`${selectedRun.productName} · ${labels[selectedRun.kind]}`,body:selectedRun.draft,engine:selectedRun.engine?'model':'template',createdAt:new Date().toISOString()});
      if(!save())return; renderAll(); toast('已存入可编辑内容初稿'); return;
    }
    if (action === 'plan') {
      state.plans.unshift({id:id(),draftId:'',title:`${selectedRun.productName} · ${labels[selectedRun.kind]}`,channel:selectedRun.kind === 'video' ? '抖音' : '朋友圈',date:today(),status:'待发布',createdAt:new Date().toISOString()});
      if(!save())return; renderAll(); showView('plans'); toast('发布计划已建立，请人工审核后发布');
    }
  });
  window.renderAgent = renderAgent;
  renderAgent();
  if (new URLSearchParams(location.search).get('view') === 'agent') showView('agent');
})();
