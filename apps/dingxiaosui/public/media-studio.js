// 紫丁香短视频与直播导演台。所有产出都是本地待审草稿；热点数据清楚标注来源。
(() => {
  VIEW_LABELS.media = '拍摄与直播计划';
  const nav = document.querySelector('.main-nav');
  nav.querySelector('[data-view="home"]').insertAdjacentHTML('afterend', '<button class="nav-item" data-view="media" type="button"><span class="nav-icon">▶</span> 拍摄与直播计划</button>');
  nav.querySelector('[data-view="media"]').addEventListener('click', () => openMedia());
  document.querySelector('#view-home .hero-heading')?.insertAdjacentHTML('afterend', '<button class="media-home-entry" type="button" data-media-open><span>NEW · VIDEO & LIVE STUDIO</span><strong>今天拍什么？今晚播什么？</strong><small>先定账号 IP，再选题、写分镜、排直播执行单。</small><b>进入导演台 ↗</b></button>');
  document.querySelector('[data-media-open]')?.addEventListener('click', () => openMedia());
  document.querySelector('.app-shell main').insertAdjacentHTML('beforeend', `
    <section class="view media-view" id="view-media" aria-labelledby="media-title">
      <div class="media-hero"><div class="media-hero-copy"><span>01 / ZIDINGXIANG CREATOR OPERATING SYSTEM</span><h1 id="media-title">每天知道<em>拍什么、怎么拍。</em><br>每场直播知道<em>讲什么、怎么讲。</em></h1><p>围绕真实农品，把账号定位、热点判断、七天选题、逐镜拍摄和直播节奏放在同一张导演台。</p><div class="media-hero-actions"><button type="button" data-media-go="video">生成七天拍摄计划 ↗</button><button type="button" data-media-go="live">准备下一场直播 ↗</button></div></div><button class="media-mascot-portal" type="button" data-ding-play aria-label="逗丁小穗玩，连续点击可眨眼、挥手、敲屏和变身"><img src="ding-xiaosui-fluffy.webp" alt=""><span><b>丁小穗陪你拍</b><small>点我试试 · 四次变身 ✦</small></span></button></div>
      <div class="media-steps"><span><b>01</b> 定 IP / 受众 / 流量入口</span><span><b>02</b> 看热点 / 判断关联</span><span><b>03</b> 拍七天 / 播一场 / 复盘</span></div>
      <div class="media-tabs" role="tablist" aria-label="短视频直播工作环节"><button type="button" role="tab" data-media-tab="position" aria-selected="true" aria-controls="media-panel-position">账号定位</button><button type="button" role="tab" data-media-tab="hot" aria-selected="false" aria-controls="media-panel-hot">热点雷达</button><button type="button" role="tab" data-media-tab="video" aria-selected="false" aria-controls="media-panel-video">七天短视频</button><button type="button" role="tab" data-media-tab="live" aria-selected="false" aria-controls="media-panel-live">直播执行台</button></div>
      <div id="media-panel-position" class="media-panel" role="tabpanel"><div class="media-section-heading"><span>POSITIONING / 先回答“为什么关注你”</span><h2>先用一分钟定方向，再逐项打磨账号 IP。</h2><p>填店铺与性格即可生成第一版定位；左侧表单用于继续调整受众、真实素材和拍摄节奏。定位用于选题，不代表平台流量保证。</p></div><div class="media-two-col"><form id="media-position-form" class="media-form media-card"><div class="media-form-grid"><label>你在镜头前的身份<select name="role"><option>产地生产者</option><option>品牌主理人</option><option>OPC 推荐官</option><option>会客厅主理人</option></select></label><label>优先获取哪类流量<select name="traffic"><option>搜索问题流量</option><option>同城到店流量</option><option>兴趣推荐流量</option><option>直播间咨询流量</option></select></label><label>最想服务的人<input name="audience" maxlength="60" placeholder="例如：想选山西伴手礼的城市家庭" required></label><label>主要经营地区<input name="market" maxlength="50" placeholder="例如：太原及周边城市"></label><label class="wide">你能反复拍到的真实素材<textarea name="assets" rows="3" maxlength="280" placeholder="例如：加工工序、农户采访、做饭过程、会客厅试吃" required></textarea></label><label class="wide">你与同类账号有什么真实不同<textarea name="edge" rows="3" maxlength="280" placeholder="只写有证据的产地、人物、工艺或服务差异"></textarea></label><label>每周能拍几天<select name="days"><option value="3">3 天</option><option value="5">5 天</option><option value="7">7 天</option></select></label><label>拍摄条件<select name="team"><option>一个人一部手机</option><option>两人协作</option><option>有完整拍摄团队</option></select></label></div><button type="submit">更新账号定位与栏目结构 ↗</button><small>登录后资料自动保存到服务器，仍可随工作台数据一起导出。</small></form><div id="media-position-result" class="media-position-result media-card"></div></div></div>
      <div id="media-panel-hot" class="media-panel" role="tabpanel" hidden><div class="media-section-heading"><span>DOUYIN SIGNAL / 热点必须有来源</span><h2>把热点当成入口，别让农品成为硬蹭的道具。</h2><p>官方“获取实时热点词”接口需要申请 hotsearch 权限；榜单约每两小时更新。未获权限时，人工从抖音榜单核对并记录标题。</p></div><div class="media-hot-toolbar"><div id="media-hot-status" role="status"></div><button id="media-refresh-hot" type="button">尝试读取官方热点 ↻</button><a href="https://www.douyin.com/hot" target="_blank" rel="noopener noreferrer">打开抖音热点榜 ↗</a></div><div id="media-hot-list" class="media-hot-list"></div><form id="media-manual-hot-form" class="media-form media-manual-hot"><div><h3>把今天看到的热点带进来</h3><p>每行一个标题；可写成“热点标题 | 抖音链接”。录入内容始终标记为“人工核对”，不会冒充实时接口。</p></div><textarea name="lines" rows="4" maxlength="1600" placeholder="例如：家乡的秋天怎么拍 | https://www.douyin.com/hot"></textarea><button type="submit">记录这些热点 ↗</button></form><p class="media-source-note">接口依据：<a href="https://open.douyin.com/platform/resource/docs/openapi/data-open-service/hot-video-data/get-current-hot-words/" target="_blank" rel="noopener noreferrer">抖音开放平台《获取实时热点词》</a>。热点能否用于商品内容，仍需人工判断关联和版权。</p></div>
      <div id="media-panel-video" class="media-panel" role="tabpanel" hidden><div class="media-section-heading"><span>SEVEN DAY SHOOTING BOARD / 一周不重复</span><h2>一键排出七天内容，再把每一条拆成能照着拍的镜头。</h2><p>“产地—商品事实—客户问题—真实使用—人物—直播预告—复盘”七条线轮流拍；每条含开头、镜头、口播、道具和发布检查。</p></div><form id="media-video-form" class="media-quick-form"><label>选择农品<select name="productId" id="media-video-product" required></select></label><label>发布阵地<select name="channel"><option>抖音</option><option>视频号</option></select></label><label>单条时长<select name="duration"><option value="30">30 秒</option><option value="60">60 秒</option></select></label><label>参考热点<select name="topicId" id="media-video-topic"><option value="">不使用热点，先做常青选题</option></select></label><button type="submit">生成七天拍摄计划 ↗</button></form><div id="media-match" class="media-match" role="status"></div><div class="media-video-layout"><div id="media-week-list" class="media-week-list"></div><div id="media-script-detail" class="media-script-detail"></div></div><div class="media-tools-note"><b>开拍前 10 分钟</b><span>手机竖屏 9:16 · 擦镜头 · 固定机位 · 靠窗或柔光 · 录 5 秒环境声 · 商品标签与人物授权先核对。</span></div></div>
      <div id="media-panel-live" class="media-panel" role="tabpanel" hidden><div class="media-section-heading"><span>LIVE SHOWRUNNER / 从开场到复盘</span><h2>直播不是反复喊“下单”，而是把一款农品讲明白。</h2><p>先核实供货、价格、库存和售后，再安排展示、问答、回顾和咨询承接。执行单可复制，也可存入办公草稿。</p></div><form id="media-live-form" class="media-quick-form"><label>主推农品<select name="productId" id="media-live-product" required></select></label><label>直播时长<select name="duration"><option value="60">60 分钟</option><option value="90">90 分钟</option><option value="120">120 分钟</option></select></label><label>直播主讲人<input name="host" maxlength="30" placeholder="例如：品牌主理人"></label><label>这场直播的主要目的<select name="goal"><option>回答商品问题</option><option>展示产地与工艺</option><option>引导会客厅体验</option><option>收集团购咨询</option></select></label><button type="submit">生成直播执行单 ↗</button></form><div id="media-live-output" class="media-live-output"></div></div>
      <p class="media-boundary">试点说明：登录后账号定位、热点人工记录和脚本保存到服务器；未登录时仅保存在当前浏览器。生成的是待核对方案，不自动拍摄、开播、发布或保证流量。官方热点接口只有在应用获批并配置服务端密钥后才会读取。</p>
    </section>`);

  const root = document.querySelector('#view-media');
  root.querySelector('.media-steps').insertAdjacentHTML('beforebegin','<p class="media-match"><b>脚本与成片</b><span>本区生成拍摄计划、分镜与直播执行单。要直接生成视频片段，请进入 <a href="/account/studio?type=video">AI 创作 ↗</a>，填写商品信息即可开始做视频。</span></p>');
  const realProducts = () => state.products.filter(item => item.id !== 'demo-product');
  const allTopics = () => [...officialTopics, ...(state.manualHotTopics || [])];
  let officialTopics = [], activeWeek = [], activeDay = 0, liveText = '', activeTab = 'position';
  const setText = (selector, text) => { root.querySelector(selector).textContent = text; };
  const product = productId => state.products.find(item => item.id === productId);
  const limit = (value, n=90) => String(value || '').trim().slice(0,n);

  function openMedia(tab) { showView('media'); if (tab) switchTab(tab); renderMediaStudio(); }
  function switchTab(tab) {
    activeTab = ['position','hot','video','live'].includes(tab) ? tab : 'position';
    root.querySelectorAll('[data-media-tab]').forEach(button => { const selected = button.dataset.mediaTab === activeTab; button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1; });
    root.querySelectorAll('.media-panel').forEach(panel => { panel.hidden = panel.id !== `media-panel-${activeTab}`; });
    if (activeTab === 'hot') loadOfficial();
  }
  root.querySelector('.media-tabs').addEventListener('click', event => { const button = event.target.closest('[data-media-tab]'); if (button) switchTab(button.dataset.mediaTab); });
  root.querySelector('.media-tabs').addEventListener('keydown', event => { if (!['ArrowLeft','ArrowRight'].includes(event.key)) return; event.preventDefault(); const tabs = ['position','hot','video','live'], next = (tabs.indexOf(activeTab)+(event.key==='ArrowRight'?1:3))%4; switchTab(tabs[next]); root.querySelector(`[data-media-tab="${tabs[next]}"]`).focus(); });
  root.querySelectorAll('[data-media-go]').forEach(button => button.addEventListener('click', () => openMedia(button.dataset.mediaGo)));

  function renderMediaStudio() {
    for (const selector of ['#media-video-product','#media-live-product']) {
      const input = root.querySelector(selector), previous = input.value;
      input.innerHTML = state.products.length ? state.products.map(item => `<option value="${esc(item.id)}">${esc(item.name)}${item.id==='demo-product'?'（虚构示例）':''}</option>`).join('') : '<option value="">请先建立农品资料</option>';
      if (state.products.some(item => item.id === previous)) input.value = previous;
      else if (realProducts().length) input.value = realProducts()[0].id;
    }
    renderPosition(); renderTopics();
  }
  window.renderMediaStudio = renderMediaStudio;

  function renderPosition() {
    const info = state.mediaProfile || {};
    const target = root.querySelector('#media-position-result');
    if (!info.audience || !info.assets) { target.innerHTML = '<span>YOUR BRAND IP / 待定位</span><h3>别人为什么要看你，而不只看商品图？</h3><p>先填店铺和性格，用一分钟生成定位；进阶表单可继续细化受众与素材。</p><button type="button" data-edit-positioning>一分钟定账号 ↗</button><div class="media-placeholder-lines"><i></i><i></i><i></i></div>'; return; }
    const role = info.role || '农品主理人', traffic = info.traffic || '搜索问题流量';
    const pillars = [
      ['人物与产地', `拍${role}和真实生产场景，回答“谁在做、在哪里做”。`],
      ['商品证据', '拍包装、规格、工序和已核实差异，不用空泛形容词替代事实。'],
      ['顾客问答', `围绕${info.audience}最常问的用途、口味、保存与配送问题拍。`],
      ['使用与互动', `把${info.assets}做成可重复的栏目，邀请观众提出下一个真实问题。`],
    ];
    target.innerHTML = `<span>YOUR BRAND IP / 账号主张</span><h3>${esc(info.positioning || `${role}，把山西农品讲给${info.audience}听。`)}</h3><p>${info.shopName?`店铺：${esc(info.shopName)} · 性格：${esc(info.personality || '待补充')}<br>`:''}主流量入口：${esc(traffic)}${info.market?` · 重点地区：${esc(info.market)}`:''}。身份和真实素材先于话术，商品卖点必须可核实。</p><div class="media-ip-pillars">${pillars.map(([title,body],i)=>`<div><b>0${i+1} ${esc(title)}</b><small>${esc(body)}</small></div>`).join('')}</div><p class="media-position-foot">执行节奏：每周拍 ${esc(info.days || 3)} 天 · ${esc(info.team || '一个人一部手机')}。差异点：${esc(info.edge || '先用真实素材和客户反馈验证。')}</p><button type="button" data-edit-positioning>修改一分钟定位 ↗</button>`;
  }
  const profileForm = root.querySelector('#media-position-form');
  for (const [key,value] of Object.entries(state.mediaProfile || {})) if (profileForm.elements[key]) profileForm.elements[key].value = String(value);
  profileForm.addEventListener('submit', event => {
    event.preventDefault(); const form = new FormData(profileForm), data = {};
    for (const key of ['role','traffic','audience','market','assets','edge','days','team']) data[key] = limit(form.get(key), key==='assets'||key==='edge'?280:80);
    const previous = state.mediaProfile || {};
    state.mediaProfile = {...previous,...data};
    if (previous.onboardingComplete && previous.shopName) state.mediaProfile.positioning = `「${previous.shopName}」：由一位${previous.personality}的主理人，给${data.audience}讲清${previous.mainProduce || '山西好物'}的真实来历、选择依据和日常用法。`;
    if(!save())return; renderPosition(); window.positioningIntake?.renderEntry?.(); toast('账号定位已更新，可用于短视频与直播选题');
  });

  async function loadOfficial(force=false) {
    const status = root.querySelector('#media-hot-status');
    if (!force && officialTopics.length) return;
    status.innerHTML = '<b>正在读取抖音官方接口状态…</b><small>没有权限时不会展示虚构热点。</small>';
    try {
      const response = await fetch('/api/douyin/hot', { cache:'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || '官方热点暂时不可用');
      officialTopics = Array.isArray(data.topics) ? data.topics.map((item,index) => ({ id:`official-${index}`,title:limit(item.title,80),source:'抖音官方接口',capturedAt:limit(data.activeTime || item.activeTime,30),hotLevel:Number(item.hotLevel || 0) })).filter(item => item.title) : [];
      status.innerHTML = data.configured ? `<b>官方热点已连接 · ${officialTopics.length} 条</b><small>榜单时间：${esc(data.activeTime || '以接口返回为准')} · 抖音约每两小时更新</small>` : '<b>官方热点接口待开通</b><small>当前没有抖音 hotsearch 权限。请打开官方榜单核对后手动记录，页面不会伪装成实时榜。</small>';
      renderTopics();
    } catch (error) { status.innerHTML = `<b>官方热点暂时不可读取</b><small>${esc(error.message || '请稍后重试')}。仍可录入已核对的话题。</small>`; renderTopics(); }
  }
  root.querySelector('#media-refresh-hot').addEventListener('click', () => loadOfficial(true));
  function renderTopics() {
    const topics = allTopics();
    root.querySelector('#media-hot-list').innerHTML = topics.length ? topics.map(item => `<article><div><span>${esc(item.source)}${item.capturedAt?` · ${esc(item.capturedAt)}`:''}</span><h3>${esc(item.title)}</h3></div><div>${item.url?`<a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">核对原链接 ↗</a>`:''}<button type="button" data-media-use-topic="${esc(item.id)}">用于选题 ↗</button>${item.source==='人工核对'?`<button type="button" data-media-remove-topic="${esc(item.id)}" aria-label="移除${esc(item.title)}">×</button>`:''}</div></article>`).join('') : '<div class="media-hot-empty"><b>还没有已核对的热点</b><p>先查看官方榜单，挑与山西农品确有联系的话题录入；也可以不借热点，直接生成常青选题。</p></div>';
    const select = root.querySelector('#media-video-topic'), previous = select.value;
    select.innerHTML = '<option value="">不使用热点，先做常青选题</option>' + topics.map(item => `<option value="${esc(item.id)}">${esc(item.title)} · ${esc(item.source)}</option>`).join('');
    if (topics.some(item => item.id === previous)) select.value = previous;
  }
  root.querySelector('#media-manual-hot-form').addEventListener('submit', event => {
    event.preventDefault(); const form = event.currentTarget;
    const lines = String(new FormData(form).get('lines') || '').split(/\r?\n/).map(item=>item.trim()).filter(Boolean).slice(0,12);
    if (!lines.length) { toast('请先写下至少一个已核对的话题'); return; }
    const capturedAt = new Date().toLocaleString('zh-CN',{hour12:false});
    const records = lines.map(line => {
      const [title,urlRaw] = line.split('|').map(item=>item.trim());
      const url = /^https:\/\/(www\.)?douyin\.com\//.test(urlRaw || '') ? urlRaw.slice(0,300) : '';
      return { id:id(), title:limit(title,80), url, source:'人工核对', capturedAt };
    }).filter(item => item.title);
    state.manualHotTopics = [...records,...(state.manualHotTopics || [])].slice(0,30); if(!save())return; form.reset(); renderTopics(); toast(`已记录 ${records.length} 条人工核对话题`);
  });
  root.querySelector('#media-hot-list').addEventListener('click', event => {
    const use = event.target.closest('[data-media-use-topic]'), remove = event.target.closest('[data-media-remove-topic]');
    if (use) { switchTab('video'); root.querySelector('#media-video-topic').value = use.dataset.mediaUseTopic; root.querySelector('#media-video-form').scrollIntoView({behavior:'smooth'}); }
    if (remove) { state.manualHotTopics = state.manualHotTopics.filter(item => item.id !== remove.dataset.mediaRemoveTopic); if(!save())return; renderTopics(); toast('话题已移除'); }
  });

  function topicDecision(topic,item) {
    if (!topic) return { use:false, text:'本轮使用常青选题，不依赖当天热点。' };
    const haystack = `${item.name} ${item.category} ${item.origin} ${item.occasions}`;
    const keywords = ['山西','农','乡村','家乡','丰收','餐','吃','食','菜','果','粮','醋','礼','年货','直播','产地','小米','枣','梨'];
    const relevant = keywords.some(word => topic.title.includes(word) && (haystack.includes(word)||['山西','农','乡村','家乡','丰收','餐','吃','食','菜','礼','年货','直播','产地'].includes(word)));
    return relevant ? { use:true, text:`初筛可关联“${topic.title}”：只借观众关心的问题，镜头仍以真实商品和人物为主。发布前人工确认关联与素材授权。` } : { use:false, text:`“${topic.title}”与这款农品的关联尚不明确。本轮不把它写进脚本，避免生硬蹭热点。` };
  }
  function weekPlan(item, profile, topic) {
    const audience = profile.audience || '想了解山西好物的观众', role = profile.role || '农品主理人', traffic = profile.traffic || '搜索问题流量';
    const productName = item.name, origin = item.origin && !item.origin.includes('待核实') ? item.origin : '待核实产地';
    const category = String(item.category || '农品');
    const detail = String(item.sellingPoints || '').split(/\r?\n/).map(value=>value.trim()).find(Boolean) || '一个已核实的商品特点';
    const scene = String(item.occasions || '真实餐桌场景').split(/[、，,]/)[0];
    const demoVisual = /果|梨|苹果|枣/.test(category) ? '切开实物 → 展示果肉和实际样品 → 记录试吃原话' : /粮|米|豆|面/.test(category) ? '展示原粮 → 拍浸泡或蒸煮 → 拍真实餐桌' : /醋|调味/.test(category) ? '展示配料与标签 → 拍实际用量 → 拍一道家常菜' : /肉/.test(category) ? '展示包装与保存说明 → 拍合规处理过程 → 拍一道熟制菜' : '展示实物和标签 → 拍一个真实用法 → 拍使用后场景';
    const nextStep = traffic==='同城到店流量' ? '如需现场看看实物与规格，欢迎了解会客厅的可用体验安排。' : traffic==='直播间咨询流量' ? '把想问的规格、做法与配送问题留在评论区，直播时拿实物回答。' : traffic==='兴趣推荐流量' ? `你会在${scene}用到它吗？告诉我你最想看的实际场景。` : '想了解规格、产地与保存方式，可以留言具体问题，我们核对资料后回答。';
    const gear = profile.team==='两人协作' ? '主讲一人、拍摄与评论记录一人、收音和补光' : profile.team==='有完整拍摄团队' ? '主讲、摄影、收音与素材记录分工' : '一部手机、固定支架、自然光或一盏补光灯';
    const basics = [
      ['周一','先回答“你是谁”',profile.shopName?`我是「${profile.shopName}」的主理人，今天从${productName}开始。`:`我是${role}，今天从${productName}开始。`,'人物 / 信任','正面半身 → 真实工作场景 → 商品近景','人物、场地和商品素材授权'],
      ['周二','从产地讲清一件事实',`这款${productName}具体来自哪里？先看可核实资料。`,'产地 / 证据','产地位置 → 生产现场 → 标签或供货凭证','产地、生产者和拍摄场地授权'],
      ['周三','拆开规格与包装',`买${productName}前，先看${item.abv||'实际规格'}、保存方式和供货条件。`,'商品 / 搜索','外包装正面 → 规格标签特写 → 手持展示','规格、保质期、价格与库存'],
      ['周四','回答顾客最常问的一个问题',`${audience}最常问的一个问题，我们拿实物回答。`,'问答 / 搜索','问题字幕 → 实物演示 → 事实卡','问题来自真实咨询，不编评价'],
      ['周五','拍真实使用场景',`${productName}怎么用于${scene}？`,'场景 / 兴趣',demoVisual,'食用方法、人物肖像和画面授权'],
      ['周六','带观众认识一个人',`这款${category}背后，谁负责把它做好？`,'人物 / 信任','人物开场 → 一段工序 → 一句真实回答','人物同意出镜，职责与身份核实'],
      ['周日','预告直播并回收问题',`关于${productName}，你还想看什么？我们下一场现场答。`,'直播 / 咨询','本周三个画面快切 → 商品正面 → 预告字幕','直播时间、地点、供货与售后先确认'],
    ];
    const shootingDays = Number(profile.days || 7) === 3 ? [0,2,5] : Number(profile.days || 7) === 5 ? [0,1,2,3,4] : [0,1,2,3,4,5,6];
    return basics.map(([day,title,hook,pillar,visual,verify],index) => ({ day,title,hook,pillar,visual,verify,channel:'抖音',traffic,positioning:profile.positioning || '',personality:profile.personality || '',shootThisWeek:shootingDays.includes(index),
      shots:[
        ['0–3 秒','镜头先给问题或反差',hook],
        ['3–8 秒',visual.split(' → ')[0] || '真实场景',`先把${index===2?'规格':index===4?'使用方式':'一个可核实信息'}拍清楚。`],
        ['8–22 秒',visual.split(' → ')[1] || '商品证据',item.id==='demo-product'?'当前是虚构示例，请换成真实商品与已核实资料再拍。':index===2?`资料卡写着：规格 ${item.abv||'待核实'}，保存 ${item.shelfLife||'待核实'}；镜头请对照实物标签逐项展示。`:index===4?`这次用${scene}场景演示${productName}；资料卡中的特点“${limit(detail,35)}”还需与实际样品核对。`:`商品资料卡摘录：${limit(item.summary,70).replace(/[。；;]+$/,'') || '资料待补齐'}。发布前请与供货方逐项核对。`],
        ['22–30 秒',visual.split(' → ')[2] || '人物和商品同框',nextStep],
      ],
      props:`${gear}、${productName}实物、商品标签、授权素材；产地资料：${origin}。`,
      cover:`${productName}｜${title}`, comment:`关于${productName}，你最想先弄清产地、口味、规格，还是${scene}怎么用？`,
      topic:index===4 && topic ? topic.title : '',topicSource:index===4 && topic ? topic.source : '',topicTime:index===4 && topic ? topic.capturedAt : '',
    }));
  }
  function planText(item) { return `${item.day}｜${item.title}\n本周安排：${item.shootThisWeek?'建议拍摄':'备选选题，可下周再拍'}\n${item.positioning?`账号定位：${item.positioning}\n表达风格：${item.personality || '自然表达'}\n`:''}账号入口：${item.traffic} · 栏目：${item.pillar}\n封面标题：${item.cover}\n开头钩子：${item.hook}\n\n逐镜拍摄\n${item.shots.map(([time,shot,spoken])=>`${time}｜画面：${shot}\n口播：${spoken}`).join('\n\n')}\n\n道具：${item.props}\n评论区问题：${item.comment}\n核验重点：${item.verify}${item.topic?`\n参考热点：${item.topic}｜${item.topicSource}｜记录于 ${item.topicTime || '待核对'}（发布前再次核对时效和关联）`:''}\n\n说明：这是待审脚本，不能直接当作已核实广告发布。`; }
  function renderWeek() {
    root.querySelector('#media-week-list').innerHTML = activeWeek.map((item,index) => `<button type="button" data-media-day="${index}" class="${index===activeDay?'active':''}"><span>${esc(item.day)} · ${item.shootThisWeek?'本周拍摄':'备选'} · ${esc(item.pillar)}</span><b>${esc(item.title)}</b><small>${esc(item.hook)}</small></button>`).join('');
    const item = activeWeek[activeDay];
    root.querySelector('#media-script-detail').innerHTML = item ? `<div class="media-script-top"><span>${esc(item.day)} / CAMERA READY · ${item.shootThisWeek?'本周拍摄':'备选'} · ${esc(item.traffic)}</span><h3>${esc(item.title)}</h3>${item.positioning?`<p>账号定位：${esc(item.positioning)}</p>`:''}<p>封面：${esc(item.cover)}</p></div><div class="media-shot-list">${item.shots.map(([time,shot,spoken])=>`<div><b>${esc(time)}</b><span><strong>${esc(shot)}</strong><small>${esc(spoken)}</small></span></div>`).join('')}</div><div class="media-script-bottom">${item.topic?`<p><b>参考热点</b>${esc(item.topic)} · ${esc(item.topicSource)} · ${esc(item.topicTime || '时间待核对')}</p>`:''}<p><b>道具</b>${esc(item.props)}</p><p><b>评论区</b>${esc(item.comment)}</p><p><b>发布前核验</b>${esc(item.verify)}</p></div><div class="media-output-actions"><button id="media-copy-video" type="button">复制这条分镜</button><button id="media-save-video" type="button">存入内容草稿 ↗</button></div>` : '<div class="media-script-empty">先选一款农品，生成七天拍摄计划。</div>';
  }
  root.querySelector('#media-video-form').addEventListener('submit', event => {
    event.preventDefault(); const form = new FormData(event.currentTarget), item = product(form.get('productId'));
    if (!item) { toast('请先建立农品资料'); showView('products'); return; }
    const topic = allTopics().find(topic => topic.id === form.get('topicId'));
    const decision = topicDecision(topic,item);
    root.querySelector('#media-match').innerHTML = `<b>${topic?(decision.use?'热点适配初筛：可尝试':'热点适配初筛：先不使用'):'常青选题'}</b><span>${esc(decision.text)}</span>`;
    activeWeek = weekPlan(item,state.mediaProfile || {},decision.use?topic:null).map(entry => ({...entry,productId:item.id,channel:String(form.get('channel')),duration:Number(form.get('duration'))}));
    if (decision.use && topic) {
      const entry=activeWeek[4];
      entry.title='从热点话题拍真实使用';
      entry.hook=`“${topic.title}”为什么会被讨论？我们用${item.name}的真实使用场景回答一个相关问题。`;
      entry.cover=`${limit(topic.title,25)}｜${item.name}怎么用`;
      entry.shots[0]=['0–3 秒','话题文字叠加真实商品画面',entry.hook];
      entry.shots[1]=['3–8 秒','展示与话题相关的真实使用场景',`先说明话题与${item.name}的真实关联，不照搬别人的视频。`];
      entry.verify+='；话题时效、来源与自然关联';
    }
    if (Number(form.get('duration'))===60) activeWeek.forEach(entry => { entry.shots[2][0]='8–48 秒'; entry.shots[3][0]='48–60 秒'; });
    activeDay = 0; renderWeek(); toast('七天拍摄计划已生成，逐条核对后再拍摄');
  });
  root.querySelector('#media-week-list').addEventListener('click', event => { const button=event.target.closest('[data-media-day]'); if (!button) return; activeDay=Number(button.dataset.mediaDay); renderWeek(); });
  root.querySelector('#media-script-detail').addEventListener('click', async event => {
    const item = activeWeek[activeDay]; if (!item) return;
    if (event.target.id==='media-copy-video') { try { await navigator.clipboard.writeText(planText(item)); toast('分镜已复制'); } catch { toast('复制失败，请手动选择内容'); } }
    if (event.target.id==='media-save-video') { state.drafts.unshift({ id:id(), productId:item.productId, scene:'日常种草', channel:item.channel, title:item.cover, body:planText(item), engine:'template', createdAt:new Date().toISOString() }); if(!save())return; renderAll(); toast('已存入内容草稿，可继续编辑和加入发布计划'); }
  });

  function livePlan(item, duration, host, goal) {
    const scale = duration/60, boundaries = [0,5,12,22,35,45,52,58,60].map(n=>Math.round(n*scale));
    const category=String(item.category||'农品'),scene=String(item.occasions||'一个真实使用场景').split(/[、，,]/)[0];
    const segments = [
      ['开场留人','说清今天能看到什么，先问观众从哪里来。',`我是${host}${state.mediaProfile?.shopName?`，来自「${state.mediaProfile.shopName}」`:''}。今天只围绕${item.name}，把实物、规格、使用方式和大家的问题讲清楚。`],
      ['先问顾客','把观众正在纠结的问题记下来，不急着报价。',`你买这类农品最在意产地、口味、规格，还是配送？打在评论区，我先记下来。`],
      ['讲产地与人物','展示已获授权的产地画面、生产者和生产过程。',`关于这款${category}，资料卡写着产地${item.origin||'待核实'}、供货方${item.supplier||'待核实'}；直播前请逐项核对。`],
      ['拆解商品','近景展示包装、规格、配料、保存方式和可核实特点。',`看这处实物标签：规格${item.abv||'待核实'}，保存方式${item.shelfLife||'待核实'}。价格、库存与发货条件以今天核对的信息为准。`],
      ['真实演示',`现场展示${scene.endsWith('场景') ? scene : `${scene}场景`}，镜头保持商品和实际做法可见。`,`现在用${item.name}演示${scene.endsWith('场景') ? scene : `${scene}场景`}；具体口味是这次样品的体验，不能代替每个批次。`],
      ['集中答疑','按评论区真实问题逐一核实回答，答不上来就记为待确认。',`这个问题我还没有可靠资料，先记下，核对后再回复。`],
      ['说明下一步','明确咨询、到店或团购沟通的具体入口，不编造优惠。',`如果你想了解${item.name}，先告诉我用途和数量，我们核对规格、供货与售后后再答复。`],
      ['收尾与复盘','复述已确认信息、收集剩余问题、记录本场数据。',`今天大家最关心的是哪些问题？下一场我们继续拿真实资料回答。`],
    ].map(([title,action,spoken],i)=>({ start:boundaries[i], end:boundaries[i+1], title, action, spoken }));
    return { item, duration, host, goal, segments, positioning:state.mediaProfile?.positioning || '', personality:state.mediaProfile?.personality || '' };
  }
  function liveTextFrom(plan) {
    const {item,duration,host,goal,segments}=plan;
    return `紫丁香直播执行单｜${item.name}\n主讲：${host}｜时长：${duration} 分钟｜目标：${goal}${plan.positioning?`\n账号定位：${plan.positioning}\n表达风格：${plan.personality || '自然表达'}`:''}\n\n开播前 30 分钟\n1. 核对实物、标签、价格、可售库存、供货方、发货与售后条件。\n2. 手机竖屏、支架、收音、补光、网络、备用电源和直播封面逐项检查。\n3. 备好商品近景、授权产地素材、常见问题卡和咨询记录表。\n4. 没有核实的价格、功效、认证、销量和时限不得口播。\n\n直播节奏\n${segments.map(s=>`${s.start}–${s.end} 分钟｜${s.title}\n动作：${s.action}\n示例话术：${s.spoken}`).join('\n\n')}\n\n开播中\n每 10–15 分钟复述直播主题、商品是什么、今天能核实什么；安排一人记录真实问题与咨询来源。\n\n下播后 20 分钟\n记录实际观看、停留、咨询、成交与未答问题；把重复问题变成下一条短视频。\n\n本执行单是待审模板，实际销售与平台发布由经营者负责。`;
  }
  root.querySelector('#media-live-form').addEventListener('submit', event => {
    event.preventDefault(); const data=new FormData(event.currentTarget), item=product(data.get('productId'));
    if (!item) { toast('请先建立农品资料'); showView('products'); return; }
    const plan=livePlan(item,Number(data.get('duration')),limit(data.get('host'),30)||'主理人',String(data.get('goal')));
    liveText=liveTextFrom(plan);
    root.querySelector('#media-live-output').innerHTML = `<div class="media-live-summary"><span>LIVE RUN OF SHOW / ${plan.duration} MINUTES</span><h3>${esc(item.name)} · 一场讲清楚</h3><p>主讲：${esc(plan.host)} · 目标：${esc(plan.goal)}${item.id==='demo-product'?' · 虚构示例，仅供体验':''}</p>${plan.positioning?`<p>账号定位：${esc(plan.positioning)}<br>表达风格：${esc(plan.personality || '自然表达')}</p>`:''}</div><div class="media-live-checks"><div><b>开播前 30 分钟</b><small>实物、标签、供货、价格、库存、配送、售后逐项核对；手机、收音、灯光、网络、备用电源检查。</small></div><div><b>直播中</b><small>每 10–15 分钟复述主题；记录真实问题，不确定的信息先标记待核实。</small></div><div><b>下播后 20 分钟</b><small>记录观看、咨询和实际成交；把高频问题变成下一条短视频。</small></div></div><div class="media-live-timeline">${plan.segments.map(segment=>`<article><time>${segment.start}–${segment.end}<small>分钟</small></time><div><h4>${esc(segment.title)}</h4><p>${esc(segment.action)}</p><blockquote>${esc(segment.spoken)}</blockquote></div></article>`).join('')}</div><div class="media-output-actions"><button id="media-copy-live" type="button">复制整场执行单</button><button id="media-save-live" type="button">存入办公草稿 ↗</button></div><p class="media-demo-warning">${item.id==='demo-product'?'当前商品是虚构示例，执行单不得直接对外使用。':'发布前仍须由经营者复核每一项商品事实与承诺。'}</p>`;
    toast('直播执行单已生成，请核对真实商品和现场条件');
  });
  root.querySelector('#media-live-output').addEventListener('click', async event => {
    if (!liveText) return;
    if (event.target.id==='media-copy-live') { try { await navigator.clipboard.writeText(liveText); toast('直播执行单已复制'); } catch { toast('复制失败，请手动选择内容'); } }
    if (event.target.id==='media-save-live') { state.office.unshift({ id:id(),kind:'会客厅活动 SOP',body:liveText,date:today() }); if(!save())return; window.renderPlus?.(); toast('已存入办公草稿'); }
  });
  renderMediaStudio();
  root.querySelector('#media-hot-status').innerHTML = '<b>官方热点接口待开通</b><small>可以先从抖音榜单人工核对、录入话题；也可以直接做常青选题。</small>';
  root.querySelector('#media-week-list').innerHTML = '<div class="media-script-empty">选择农品后生成七天拍摄计划。</div>';
  root.querySelector('#media-script-detail').innerHTML = '<div class="media-script-empty">七天计划生成后，点击任意一天查看逐镜脚本。</div>';
  root.querySelector('#media-live-output').innerHTML = '<div class="media-script-empty">填写一场直播的农品和目标，生成逐段执行单。</div>';
  if (new URLSearchParams(location.search).get('view')==='media') openMedia('video');
})();
