// 私域获客工作台：复用本浏览器的农品、咨询与内容资料。
// 当前只生成供人工检查的草稿，不连接微信、社群或第三方账号。
(() => {
  VIEW_LABELS.private = '私域获客';
  const nav = document.querySelector('.main-nav');
  const navButton = '<button class="nav-item" data-view="private" type="button"><span class="nav-icon">◎</span> 私域获客</button>';
  nav.querySelector('[data-view="plans"]').insertAdjacentHTML('afterend', navButton);
  nav.querySelector('[data-view="private"]').addEventListener('click', () => openPrivate());

  document.querySelector('#view-home .cycle-progress').insertAdjacentHTML('afterend', `
    <button class="private-home-entry" data-private-open type="button">
      <span class="private-home-orb">◎</span><span><small>NEW WORKSPACE / PRIVATE GROWTH</small><strong>把一次咨询，经营成长期关系。</strong><em>同一款农品，从内容触达到私域跟进、社群话题与复盘。</em></span><b>进入私域获客 ↗</b>
    </button>`);
  document.querySelector('#view-shop .shop-leads, #view-salon .shop-leads')?.insertAdjacentHTML('beforebegin', `
    <button class="private-shop-entry" data-private-open type="button"><span>◎ 咨询已经记录？继续做私域跟进和社群内容</span><b>打开私域获客 ↗</b></button>`);
  document.querySelectorAll('[data-private-open]').forEach(button => button.addEventListener('click', openPrivate));

  document.querySelector('.app-shell main').insertAdjacentHTML('beforeend', `
    <section class="view private-view" id="view-private" aria-labelledby="private-title">
      <div class="private-hero">
        <div class="private-hero-copy"><span>06 / PRIVATE GROWTH · 山西农品私域工作台</span><h1 id="private-title">让每一次看见，<em>变成一次真实对话。</em></h1><p>把朋友圈、小红书、视频号和会客厅带来的咨询，连到同一款农品的资料、跟进节奏和社群内容里。</p><div class="private-hero-actions"><button data-private-jump="private-leads" type="button">查看客户机会 <b>↗</b></button><button data-private-jump="private-compose" type="button">生成跟进草稿 <b>↗</b></button></div></div>
        <div class="private-flow" aria-label="私域获客四步流程"><div><span>01</span><b>内容种草</b><small>让对的人看见</small></div><i>→</i><div><span>02</span><b>承接咨询</b><small>记下真实需求</small></div><i>→</i><div><span>03</span><b>持续跟进</b><small>给出可信回答</small></div><i>→</i><div><span>04</span><b>复盘关系</b><small>看咨询与成交</small></div></div>
      </div>
      <div class="private-metrics" id="private-metrics"></div>
      <div class="private-section-head"><div><span>START WITH A REAL QUESTION</span><h2>从哪里找到今天的客户？</h2><p>先记录来源和客户原话，再决定发什么内容、什么时候回访。</p></div></div>
      <div class="private-source-grid">
        <button data-private-source="朋友圈" type="button"><span>01 / WECHAT MOMENTS</span><b>朋友圈</b><small>从日常农品内容进入一对一咨询</small><i>＋ 记录咨询</i></button>
        <button data-private-source="小红书" type="button"><span>02 / REDNOTE</span><b>小红书</b><small>从场景笔记追问口味、产地与规格</small><i>＋ 记录咨询</i></button>
        <button data-private-source="视频号" type="button"><span>03 / VIDEO</span><b>视频号</b><small>从产地短视频延续商品问答</small><i>＋ 记录咨询</i></button>
        <button data-private-source="线下会客厅" type="button"><span>04 / SALON</span><b>线下会客厅</b><small>把品鉴与到店交流接回线上</small><i>＋ 记录咨询</i></button>
      </div>
      <div class="private-section-head" id="private-leads"><div><span>LEAD DESK / 同一处跟进</span><h2>今天最该跟进谁？</h2><p>线索直接读取 OPC 农品小店的咨询记录，无需再录一遍。</p></div><div class="private-head-actions"><select id="private-lead-filter" aria-label="筛选客户机会"><option value="open">待跟进</option><option value="all">全部机会</option><option value="新咨询">新咨询</option><option value="跟进中">跟进中</option><option value="已完成">已完成</option></select><button id="private-add-lead" type="button">＋ 新增咨询</button></div></div>
      <div class="private-lead-grid"><div id="private-lead-list" class="private-lead-list"></div><aside class="private-insight"><span>CHANNEL SIGNAL / 当前来源</span><h3>客户从哪里来</h3><div id="private-sources"></div><p>“已完成”表示这条咨询已办结，不自动代表成交。成交应以销售记录核对。</p><button id="private-open-shop" type="button">查看 OPC 小店咨询看板 ↗</button></aside></div>
      <div class="private-compose" id="private-compose"><div class="private-compose-intro"><span>ONE PRODUCT · ONE REAL CONVERSATION</span><h2>把农品事实，写成有温度的跟进。</h2><p>选择一款真实农品和一条咨询，生成可编辑的回复、邀约或回访初稿。内容只在本浏览器处理，由经营者核实后自行发送。</p><div class="private-tone-note"><b>当前为本地模板模式</b><small>尚未接入参考工具的账号、模型或消息发送接口。</small></div></div><form id="private-compose-form"><label>选择已核实农品<select name="productId" id="private-product" required></select></label><label>关联咨询<select name="leadId" id="private-lead-select"><option value="">不关联，先写通用话术</option></select></label><div class="private-form-row"><label>沟通场景<select name="goal"><option value="初次回复">初次回复</option><option value="商品答疑">商品答疑</option><option value="会客厅邀约">会客厅邀约</option><option value="温和回访">温和回访</option><option value="社群分享">社群分享</option></select></label><label>语气<select name="tone"><option value="真诚简洁">真诚简洁</option><option value="亲切日常">亲切日常</option><option value="专业清晰">专业清晰</option></select></label></div><label>补充本次已确认的信息<textarea name="facts" rows="3" maxlength="450" placeholder="例如：本周会客厅品鉴时间；未核实的价格和库存请勿填写"></textarea></label><label class="private-verify"><input name="reviewed" type="checkbox" required><span>我已核对选中农品的资料和使用权限，本次只生成内部待审草稿</span></label><button type="submit">生成可编辑跟进稿 ↗</button><label class="private-output-label">草稿，可修改后复制<textarea id="private-draft-output" rows="9" maxlength="3000" placeholder="选择真实农品后生成草稿。"></textarea></label><div class="private-output-actions"><button id="private-copy-draft" type="button">复制草稿</button><button id="private-save-draft" type="button">存入办公草稿</button></div><small>请先核对商品标签、价格、库存与素材授权；不自动发送微信消息，不批量加好友。</small></form></div>
      <div class="private-section-head"><div><span>COMMUNITY RHYTHM / 社群有内容</span><h2>从一次咨询，延伸到一周内容。</h2><p>围绕真实商品事实安排三类轻量话题，避免每天重复“买买买”。</p></div><button id="private-community-generate" type="button">生成本周话题 ↗</button></div><div class="private-community-grid" id="private-community-grid"></div>
      <div class="private-bridge"><div><span>REFERENCE TOOL / 参考工作台</span><h2>也可以打开你现有的私域获客 AI 工具。</h2><p>紫丁香先承接农品资料和咨询流程；参考工具目前独立登录，尚无账号、客户数据或消息接口同步。</p></div><a href="https://ycnaecraoeqn.doubaoapps.com/app/app_17ef94w01vc" target="_blank" rel="noopener noreferrer">打开原有工作台 ↗</a></div>
      <p class="private-boundary">试点说明：登录后咨询与草稿保存到服务器，同一账号可换设备使用；多人团队共享、客户授权与消息发送接口需另行配置。</p>
    </section>`);

  function openPrivate() { showView('private'); renderPrivateGrowth(); }
  function currentLeads() { return Array.isArray(opcLeads) ? opcLeads : []; }
  function realProducts() { return state.products.filter(product => product.id !== 'demo-product'); }
  function renderPrivateGrowth() {
    const leads = currentLeads(), now = today();
    const open = leads.filter(lead => (lead.status || '新咨询') !== '已完成');
    const due = open.filter(lead => lead.followUpDate && lead.followUpDate <= now);
    const sold = state.sales.filter(sale => realProducts().some(product => product.id === sale.productId));
    document.querySelector('#private-metrics').innerHTML = `
      <article><span>已记录咨询</span><b>${leads.length}</b><small>来自 OPC 小店与手动录入</small></article>
      <article class="${due.length ? 'is-urgent' : ''}"><span>今天要跟进</span><b>${due.length}</b><small>含已到期的未办结咨询</small></article>
      <article><span>进行中机会</span><b>${open.length}</b><small>新咨询与跟进中</small></article>
      <article><span>已记录销售</span><b>${sold.length}</b><small>以工作台手动销售记录为准</small></article>`;
    const filter = document.querySelector('#private-lead-filter').value;
    const shown = leads.filter(lead => filter === 'all' || (filter === 'open' ? (lead.status || '新咨询') !== '已完成' : (lead.status || '新咨询') === filter)).sort((a,b) => String(a.followUpDate || '9999').localeCompare(String(b.followUpDate || '9999')));
    document.querySelector('#private-lead-list').innerHTML = shown.length ? shown.map(lead => {
      const status = ['新咨询','跟进中','已完成'].includes(lead.status) ? lead.status : '新咨询';
      const product = state.products.find(item => item.id === lead.productId);
      const late = status !== '已完成' && lead.followUpDate && lead.followUpDate <= now;
      return `<article class="private-lead-card ${late ? 'is-due' : ''}"><div class="private-lead-top"><span>${esc(lead.source || '来源待记录')}</span><time>${esc(lead.date || '')}</time></div><h3>${esc(lead.name || '未命名咨询')}<small>${esc(product?.name || '未关联农品')}</small></h3><p>${esc(lead.note || '还没有记录客户原话')}</p><div class="private-next"><b>${late ? '今天处理' : '下一步'}</b><span>${esc(lead.next || '待安排')}${lead.followUpDate ? ` · ${esc(lead.followUpDate)}` : ''}</span></div><div class="private-lead-actions"><label>状态<select data-private-status="${esc(lead.id)}"><option ${status==='新咨询'?'selected':''}>新咨询</option><option ${status==='跟进中'?'selected':''}>跟进中</option><option ${status==='已完成'?'selected':''}>已完成</option></select></label><button data-private-compose-lead="${esc(lead.id)}" type="button">写跟进稿 ↗</button></div></article>`;
    }).join('') : '<div class="private-empty"><b>还没有符合条件的咨询</b><span>从朋友圈、内容平台或会客厅记录第一条真实需求。</span></div>';
    const counts = new Map();
    for (const lead of leads) counts.set(lead.source || '其他', (counts.get(lead.source || '其他') || 0) + 1);
    const ordered = [...counts].sort((a,b) => b[1] - a[1]);
    const max = Math.max(1, ...ordered.map(item => item[1]));
    document.querySelector('#private-sources').innerHTML = ordered.length ? ordered.map(([source,count]) => `<div><label><b>${esc(source)}</b><span>${count} 条</span></label><i><u style="width:${count/max*100}%"></u></i></div>`).join('') : '<div class="private-empty small">记录咨询后，这里会显示真实来源。</div>';
    const productSelect = document.querySelector('#private-product'), previousProduct = productSelect.value;
    productSelect.innerHTML = '<option value="">请选择真实农品</option>' + realProducts().map(product => `<option value="${esc(product.id)}">${esc(product.name)}</option>`).join('');
    if (realProducts().some(product => product.id === previousProduct)) productSelect.value = previousProduct;
    const leadSelect = document.querySelector('#private-lead-select'), previousLead = leadSelect.value;
    leadSelect.innerHTML = '<option value="">不关联，先写通用话术</option>' + leads.map(lead => `<option value="${esc(lead.id)}">${esc(lead.name || '未命名')} · ${esc(lead.source || '来源待记')}</option>`).join('');
    if (leads.some(lead => lead.id === previousLead)) leadSelect.value = previousLead;
    const grid = document.querySelector('#private-community-grid');
    if (realProducts().length && grid.querySelector('.private-empty')) document.querySelector('#private-community-generate').click();
  }
  window.renderPrivateGrowth = renderPrivateGrowth;

  document.querySelectorAll('[data-private-source]').forEach(button => button.addEventListener('click', () => {
    openDialog('inquiry-dialog');
    const form = document.querySelector('#inquiry-form');
    form.elements.source.value = button.dataset.privateSource;
    form.elements.name.focus();
  }));
  document.querySelector('#private-add-lead').addEventListener('click', () => openDialog('inquiry-dialog'));
  document.querySelector('#private-open-shop').addEventListener('click', () => showView('shop'));
  document.querySelector('#private-lead-filter').addEventListener('change', renderPrivateGrowth);
  document.querySelectorAll('[data-private-jump]').forEach(button => button.addEventListener('click', () => document.getElementById(button.dataset.privateJump).scrollIntoView({behavior:'smooth'})));
  document.querySelector('#private-lead-list').addEventListener('change', event => {
    const input = event.target.closest('[data-private-status]'); if (!input) return;
    const lead = currentLeads().find(item => item.id === input.dataset.privateStatus); if (!lead) return;
    lead.status = input.value; if(!saveLeads())return; renderShop(); toast('跟进状态已更新');
  });
  document.querySelector('#private-lead-list').addEventListener('click', event => {
    const button = event.target.closest('[data-private-compose-lead]'); if (!button) return;
    const lead = currentLeads().find(item => item.id === button.dataset.privateComposeLead); if (!lead) return;
    const form = document.querySelector('#private-compose-form');
    document.querySelector('#private-lead-select').value = lead.id;
    if (realProducts().some(product => product.id === lead.productId)) document.querySelector('#private-product').value = lead.productId;
    form.elements.goal.value = '初次回复';
    document.querySelector('#private-compose').scrollIntoView({behavior:'smooth'});
  });

  function buildDraft(product, lead, goal, tone, facts) {
    const name = lead?.name ? `${lead.name}，` : '';
    const leadQuestion = lead?.note ? `上次你提到“${String(lead.note).slice(0,100)}”。` : '';
    const productFacts = [product.origin && `产地资料：${product.origin}`, product.abv && `规格：${product.abv}`, product.summary && `商品介绍：${product.summary}`].filter(Boolean).join('；');
    const verified = facts ? `这次已确认的信息：${facts}。` : '';
    const opening = tone === '专业清晰' ? `你好，${name}关于${product.name}，我把已核实的信息整理给你。` : `你好呀，${name}想和你聊聊${product.name}。`;
    const intent = {
      '初次回复': '如果你最关心口味、规格或产地，我可以按你想了解的点继续说明。',
      '商品答疑': '哪些信息还不清楚？我可以先核对商品标签与供货资料，再准确回复你。',
      '会客厅邀约': '如果你方便，也欢迎来紫丁香会客厅看看实物；时间和地点确认后我再发给你。',
      '温和回访': '之前聊到的需求我还记得。如果还想了解这款农品，我可以继续帮你核对信息。',
      '社群分享': '想在群里和大家分享一款山西农品，先从它的真实产地、规格和餐桌用法聊起。'
    }[goal] || '';
    return `${goal}｜${product.name}\n\n${opening}\n${leadQuestion}\n${productFacts || '这款商品的资料尚需补齐。'}\n${verified}\n${intent}\n\n发送前检查：价格、库存、口味评价和活动信息请以当天真实资料为准；不要承诺未经核实的功效或配送时间。`;
  }
  document.querySelector('#private-compose-form').addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget, f = new FormData(form);
    const product = realProducts().find(item => item.id === f.get('productId'));
    if (!product) { toast('请先建立并选择真实农品资料'); return; }
    const lead = currentLeads().find(item => item.id === f.get('leadId'));
    document.querySelector('#private-draft-output').value = buildDraft(product, lead, String(f.get('goal')), String(f.get('tone')), String(f.get('facts') || '').trim());
    toast('已生成可编辑跟进稿，请核对后自行发送');
  });
  document.querySelector('#private-copy-draft').addEventListener('click', async () => {
    const text = document.querySelector('#private-draft-output').value.trim();
    if (!text) { toast('请先生成或填写跟进稿'); return; }
    try { await navigator.clipboard.writeText(text); toast('跟进稿已复制'); } catch { toast('复制失败，请手动选择文本'); }
  });
  document.querySelector('#private-save-draft').addEventListener('click', () => {
    const body = document.querySelector('#private-draft-output').value.trim();
    if (!body) { toast('请先生成或填写跟进稿'); return; }
    state.office.unshift({id:id(),kind:'客户跟进',body,date:today()}); if(!save())return; window.renderPlus?.(); toast('已存入办公草稿');
  });
  document.querySelector('#private-community-generate').addEventListener('click', () => {
    const product = realProducts().find(item => item.id === document.querySelector('#private-product').value) || realProducts()[0];
    if (!product) { toast('请先建立一款真实农品'); showView('products'); return; }
    const topics = [
      ['周二 · 认识产地', `这款${product.name}来自哪里？先讲清产地、生产者和我们已经核实的资料。`, '适合朋友圈或社群图文'],
      ['周四 · 回答一个问题', `大家最想知道${product.name}的口味、规格还是保存方式？把真实问题整理成一条问答。`, '适合社群讨论与一对一回复'],
      ['周末 · 使用场景', `${product.name}适合哪些餐桌场景？用获得授权的真实图片展示，再补充已经核实的商品特点。`, '适合短视频或会客厅展示']
    ];
    document.querySelector('#private-community-grid').innerHTML = topics.map(([title,body,channel],index) => `<article><span>0${index+1} / WEEKLY RHYTHM</span><h3>${esc(title)}</h3><p>${esc(body)}</p><small>${esc(channel)}</small></article>`).join('');
    toast('本周社群话题已生成，请按真实素材调整');
  });
  renderPrivateGrowth();
  if (realProducts().length) document.querySelector('#private-community-generate').click();
  else document.querySelector('#private-community-grid').innerHTML = '<div class="private-empty"><b>先从一款真实农品开始</b><span>建立并核实农品资料后，可以生成一周社群话题。</span></div>';
  if (new URLSearchParams(location.search).get('view') === 'private') openPrivate();
})();
