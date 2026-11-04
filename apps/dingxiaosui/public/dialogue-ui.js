(() => {
  'use strict';
  const D = window.ZdxDialogue, KEY = 'zidingxiang-workspace-v1';
  const isPublic = document.body.dataset.dialogueMode === 'public';
  const $ = selector => document.querySelector(selector);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const icon = (name, size = 17) => {
    const paths = { book: '<path d="M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H4V4Zm16 0h-4a3 3 0 0 0-3 3m7-3v15h-4a4 4 0 0 0-3 2"/>', plus: '<path d="M12 5v14M5 12h14"/>', search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>', box: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 5V3m6 2V3"/>', sparkle: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/>', arrow: '<path d="M12 19V5m-5 5 5-5 5 5"/>', chevron: '<path d="m9 5 7 7-7 7"/>', menu: '<path d="M4 6h16M4 12h16M4 18h16"/>', close: '<path d="m6 6 12 12M6 18 18 6"/>', leaf: '<path d="M20 4C9 2 2 8 5 15s16 4 15-11ZM5 19l10-9"/>', edit: '<path d="m15 4 5 5M4 20l4-1L21 6l-4-4L4 15Z"/>', calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18m-12 4h3"/>', tools: '<path d="m4 20 9-9M14 4a6 6 0 0 0 6 7l-4-4 3-4a6 6 0 0 0-5 1ZM5 4l5 5M3 3l3 1-2 2Z"/>', download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>', user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>', stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>' };
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.sparkle}</svg>`;
  };
  const parse = (key, fallback) => { try { return JSON.parse(window.zdxStorage.local.getItem(key)) ?? fallback; } catch { return fallback; } };
  let state = D.normalize(parse(KEY, {})), profile = parse('zidingxiang-opc-profile-v1', {}), leads = parse('zidingxiang-opc-leads-v1', []);
  let currentId = null, taskId = 'general', tasks = [], owner = null, connected = false, media = null, busy = false, controller = null, toastTimer, shelfFilter = '', sheetReturnFocus = null;
  let textCredits = null, eventWallet = null, pollingMedia = false;
  let creativeMode = null;
  const eventMode = () => !!window.ZdxEventAccess?.state?.enabled;
  const needsActivation = () => eventMode() && !window.ZdxEventAccess.state.platformAdmin && (!window.ZdxEventAccess.state.authenticated || !window.ZdxEventAccess.state.activated);
  const balanceLabel = () => !owner || textCredits === null ? '查看额度' : eventMode() ? `文案 ${textCredits} · 图片 ${eventWallet?.quotas?.find(row=>row.capability==='image')?.available??'—'} · 视频 ${eventWallet?.quotas?.find(row=>row.capability==='video')?.available??'—'}` : `${textCredits} 点`;
  const creditPanel=window.ZdxCredits.create({getOwner:()=>owner,openSheet,onBalance:(value,summary)=>{textCredits=value;eventWallet=summary||null;document.querySelectorAll('[data-credit-balance]').forEach(entry=>{entry.textContent=balanceLabel();});}});
  let lastSavedRaw = window.zdxStorage.local.getItem(KEY);
  let regionalKnowledge = [], modelReason = '';
  const safeSource = value => typeof value==='string' && /^https:\/\/[^\s]+$/.test(value) ? escape(value) : '';
  const referenceLinks = rows => (rows||[]).slice(0,5).filter(row=>safeSource(row.url)).map(row=>`<a class="small-action" href="${safeSource(row.url)}" target="_blank" rel="noopener">${escape(row.title)} · ${escape(row.published||'来源日期见原文')} ↗</a>`).join('');
  const regionalRecords = () => regionalKnowledge.map(row=>({id:row.id,collection:'regional',label:'山西农品参考 · '+row.sourceType,title:row.title,body:row.facts,row}));
  function showRegional(){openSheet('山西农品参考',`<p class="sheet-intro">第一批公开资料，按产地、品类与品牌整理。官方背景与表达建议分开记录；具体商品以你提供并确认的信息为准。</p><div class="sheet-records">${regionalRecords().map(record=>`<article class="result-card"><span class="result-label">${escape(record.label)}</span><h3>${escape(record.title)}</h3><p>${escape(record.body)}</p><button class="small-action" data-record="${record.id}" data-collection="regional">查看来源与表达建议 ↗</button></article>`).join('')}</div>`);}
  const ids = () => crypto.randomUUID();
  const now = () => new Date().toISOString();
  const active = () => state.conversations.find(item => item.id === currentId);
  function toast(message) {
    let node = $('#dialogue-toast'); if (!node) { node = document.createElement('div'); node.id = 'dialogue-toast'; node.className = 'toast'; node.setAttribute('role', 'status'); document.body.append(node); }
    node.textContent = message; node.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { node.hidden = true; }, 4500);
  }
  function persist(next = state) {
    try {
      if (window.zdxStorage.local.getItem(KEY) !== lastSavedRaw) throw Error('另一个标签页已更新资料。请先复制当前未保存的内容，再刷新页面');
      const encoded = JSON.stringify(next); window.zdxStorage.local.setItem(KEY, encoded); lastSavedRaw = encoded; state = next; return true;
    }
    catch (error) { toast(error.message || '本机保存未完成，请先复制重要内容并检查页面顶部提示'); return false; }
  }
  function startThread() {
    if (busy) { toast('请先等待本次回答，或点击停止'); return false; }
    if (state.conversations.length >= 60) { toast('已达到 60 段对话上限，请先导出备份并整理已有记录'); return false; }
    currentId = null; taskId = 'general'; creativeMode = null; if($('#question'))$('#question').value=''; render(); $('#question').focus(); return true;
  }
  function ensureThread(question) {
    if (!active()) {
      if (state.conversations.length >= 60) throw Error('对话记录已满，请导出备份并整理后继续');
      const thread = { id: ids(), title: question.slice(0, 26), createdAt: now(), messages: [] };
      state.conversations.unshift(thread); currentId = thread.id;
    }
    return active();
  }
  const brand = `<a class="brand" href="/" aria-label="紫丁香计划首页"><span class="brand-icon"><img src="favicon.svg" alt=""></span><span><strong>紫丁香计划</strong><small>THE LILAC PROJECT</small></span></a>`;
  const quick = isPublic ? [
    ['sparkle', '了解紫丁香', '一场从山西好物开始的共创', '紫丁香计划是什么？'], ['leaf', '开启农品经营', '从一款真实农品开始', '我想加入 OPC 计划，怎么开始？'],
    ['edit', '一句话做内容', '农品卖点，变成好表达', '帮我写一条农品朋友圈文案'], ['tools', '更多 AI 能力', '写作、翻译与日常办公', 'tools'],
  ] : [
    ['leaf', '农产品营销', '产品卖点 · 内容推广', 'agri'], ['sparkle', '品牌营销', '品牌定位 · 品牌故事', 'brand'],
    ['user', '农业模特', '人物设定 · 农品展示方案', 'agri-model'], ['edit', 'AI 新农人', '个人 IP · 账号内容策划', 'new-farmer'],
    ['tools', '营销设计', '海报文案 · 包装视觉方案', 'design'], ['calendar', '农品 PPT', '品牌介绍 · 招商汇报大纲', 'ppt'],
  ];
  const commonScenes=[['moments','朋友圈种草'],['xiaohongshu','小红书笔记'],['script','短视频口播'],['live','直播带货'],['detail','电商详情'],['private','私域团购'],['season','节气上新'],['gift','节日礼盒'],['channel','招商与渠道'],['visit','采摘与农旅'],['sales','客户答疑'],['article','公众号文章']];
  const creativeScenes = {
    text: [['selling','营销文案','提炼卖点，让好产品更好卖','edit'],['brand','品牌故事','讲清产地、初心与品牌价值','leaf'],['script','短视频口播','从开场到结尾，说得自然','user'],['sales','客户答疑','产品怎么选，问题怎么答','sparkle']],
    image: [['product','产品主图','让你的农品，成为画面主角','leaf'],['detail','电商详情图','卖点、场景与细节，一图讲清','box'],['ppt','PPT 页面','把品牌介绍做成一页视觉','calendar'],['packaging','视觉包装','探索礼盒、标签与包装创意','tools']],
    video: [['brand','品牌宣传片','让产地与品牌故事动起来','leaf'],['ad','产品广告片','让产品，留下一个好印象','sparkle'],['avatar','数字人物模特','虚拟人物与农品的展示短片','user']],
  };
  const modeLabels = {text:'写文案',image:'做图片',video:'做视频'};
  function creativeHome(){
    const cards=[['text','01','写文案','让好产品，有自己的表达'],['image','02','做图片','让每一份好物，被看见'],['video','03','做视频','让品牌故事，鲜活起来']];
    return `<section class="creative-home" aria-label="农品品牌创作空间"><div class="creative-hero"><div class="creative-hero-copy"><span class="creative-kicker"><i></i> 紫丁香 · 农品品牌创作空间</span><h1>把家乡的好，<br><em>做成看得见的品牌。</em></h1><p>我是丁小穗。文案、图片、视频，<br class="mobile-break">陪你把一个好想法，做成一份好作品。</p><div class="creative-hero-note"><span>从一款真实农品开始</span><span class="note-line"></span><span>创作由你定义</span></div></div><div class="creative-mascot"><span class="mascot-orbit orbit-one"></span><span class="mascot-orbit orbit-two"></span><img src="ding-xiaosui-fluffy.webp" alt="丁小穗，你的农品品牌创作伙伴"><span class="mascot-note">今天，咱们做点什么？</span></div></div><div class="creative-modes" role="group" aria-label="选择创作类型">${cards.map(([mode,number,title,subtitle])=>`<button type="button" class="creative-mode mode-${mode}${creativeMode===mode?' is-active':''}" data-creative-mode="${mode}" aria-pressed="${creativeMode===mode}" aria-controls="creative-scenes"><span class="mode-number">${number} / ${mode==='text'?'WORDS':mode==='image'?'IMAGES':'FILMS'}</span><strong>${title}<span class="mode-arrow">↗</span></strong><span class="mode-description">${subtitle}</span><span class="mode-art" aria-hidden="true">${mode==='text'?'<span class="paper-back"></span><span class="paper-front"><b>好物，<br>自有回响。</b><i></i><i></i><small>THE LILAC PROJECT</small></span>':mode==='image'?'<img src="lilac-packaging-v2.webp" alt=""><span class="image-corner"></span>':'<img src="lilac-harvest-hero.webp" alt=""><span class="film-play">▷</span><small>VIDEO</small>'}</span></button>`).join('')}</div><section id="creative-scenes" class="creative-scenes${creativeMode?' has-selection':''}" aria-live="polite">${creativeMode?`<div class="creative-scene-heading"><div><span>下一步</span><h2>${creativeMode==='text'?'这次，想怎么讲？':creativeMode==='image'?'这次，想做哪种画面？':'这次，想拍什么故事？'}</h2></div><span>${creativeMode==='text'?'选一个场景，告诉我品牌与产品':creativeMode==='image'?'选好用途，进入图片创作':'确认画面与时长，进入视频创作'}</span></div><div class="creative-scene-grid${creativeMode==='video'?' three-scenes':''}">${creativeScenes[creativeMode].map(([id,title,desc,glyph])=>`<button type="button" class="creative-scene${creativeMode==='text'&&taskId===id?' is-selected':''}" ${creativeMode==='text'?`data-starter-task="${id}" aria-pressed="${taskId===id}"`:`data-media-scene="${id}" data-media-type="${creativeMode}"`}><span class="scene-glyph">${icon(glyph,18)}</span><strong>${title}</strong><small>${desc}</small><span class="scene-go">↗</span></button>`).join('')}</div>${creativeMode==='text'?'<button type="button" class="creative-more" data-action="tools">朋友圈、小红书、直播带货等更多文案场景 <span>→</span></button>':'<p class="creative-scene-note">进入后可补充产品资料、画面要求，再确认生成。</p>'}`:'<div class="creative-choose-note"><span>从上方选择一种创作方式</span><i></i><span>也可以直接告诉丁小穗，你想做什么</span></div>'}</section></section>`;
  }
  const wantsWrittenContent = question => /脚本|分镜|文案|口播稿|策划方案|提示词/.test(question);
  function mediaIntent(question){
    if(wantsWrittenContent(question))return null;
    if(/(?:生成|制作|做|输出|创作|拍|来).*(?:视频|宣传片|广告片)|文生视频/.test(question))return 'video';
    if(/(?:生成|制作|做|设计|输出|创作|画|来).*(?:图片|产品图|主图|详情图|海报|包装图|效果图|一张图)|文生图|生图/.test(question))return 'image';
    return null;
  }
  async function openMediaStudio(capability,scene,prompt=''){
    if(busy){toast('请先等待本次回答，或点击停止');return;}
    if(!['image','video'].includes(capability))return;
    if(needsActivation()){window.ZdxEventAccess.open();return;}
    const validScene=creativeScenes[capability].some(row=>row[0]===scene)?scene:capability==='image'?'product':'brand';
    try{
      if(prompt){
        if(prompt.length>4000)throw Error('图片和视频的创作要求请控制在 4000 字以内，原始内容仍已保留');
        if(owner){await window.zdxStorage.sync.flush();const sync=window.zdxStorage.sync.status();if(sync.dirty||['conflict','stale','remote','auth'].includes(sync.phase))throw Error('请先完成页面顶部的资料同步，再进入创作');}
        sessionStorage.setItem('zdx-media-handoff-v1',JSON.stringify({capability,scene:validScene,prompt,ownerId:owner?.id||null,createdAt:Date.now()}));
      }else sessionStorage.removeItem('zdx-media-handoff-v1');
      location.assign(`/account/studio?type=${capability}&provider=platform&scene=${validScene}`);
    }catch(error){toast(error.message||'暂时无法保存创作要求，请保留输入后重试');}
  }
  function startTask(id){if(busy){toast('请先等待本次回答，或点击停止');return;}const task=tasks.find(row=>row.id===id);if(!task){toast('工具正在读取，请稍后再试');return;}closeSheet();taskId=id;creativeMode='text';render();$('#selected-tool').textContent=task.name;$('#question').placeholder=task.placeholder||'品牌叫什么？或者说说你想做什么。';document.querySelectorAll('[data-starter-task]').forEach(button=>{const selected=button.dataset.starterTask===id;button.classList.toggle('is-selected',selected);button.setAttribute('aria-pressed',String(selected));});$('#question').focus();}
  function openWorkMethods(){openSheet('写作与办公',`<p class="sheet-intro">整理会议记录、翻译农品介绍、润色文案或准备PPT，选好场景，写下农产品名称或粘贴原文即可。</p><div class="sheet-tools">${tasks.filter(task=>task.source!=='original').map(task=>`<button class="tool-card" data-starter-task="${escape(task.id)}"><strong>${escape(task.name)}</strong><p>${escape(task.description)}</p></button>`).join('')}</div><p class="sheet-intro method-note">PPT 当前提供逐页文字大纲。</p><a class="small-action" href="third-party-notices.txt" target="_blank" rel="noopener">方法来源与许可说明 ↗</a>`);}

  function render() {
    const inputDraft = $('#question')?.value || '';
    const thread = active(), hasMessages = !!thread?.messages.length;
    const sidebar = `<div class="mobile-backdrop" data-action="menu-close"></div><aside class="sidebar" aria-label="工作台导航">${brand}<button class="side-new" data-action="new">${icon('plus', 15)} 开启新对话</button><nav class="side-nav"><button class="nav-button" data-action="knowledge">${icon('book')}知识库<span class="nav-arrow">${icon('chevron', 12)}</span></button><button class="nav-button" data-action="shelf">${icon('box')}资料与作品<span class="nav-arrow">${icon('chevron', 12)}</span></button><button class="nav-button" data-action="tools">${icon('sparkle')}AI 工具箱<span class="nav-arrow">${icon('chevron', 12)}</span></button></nav><p class="history-label">最近对话</p><div class="thread-list">${state.conversations.slice(0, 15).map(item => `<button class="thread-button ${item.id === currentId ? 'active' : ''}" data-thread="${escape(item.id)}">${escape(item.title)}</button>`).join('') || '<span class="thread-button">每次灵感，都可以接着聊。</span>'}</div><div class="sidebar-bottom"><button class="account-credits" type="button" data-action="credits" aria-label="我的额度与使用记录"><span>我的额度</span><span data-credit-balance="sidebar">${balanceLabel()}</span>${icon('chevron',11)}</button>${eventMode()?(owner?`<details class="account-menu"><summary class="account-link" aria-label="${escape(owner.displayName||'我的体验')}，账号菜单"><span class="account-badge">${icon('user',13)}</span><span class="account-name">${escape(owner.displayName||'我的体验')}</span><span class="account-menu-chevron">${icon('chevron',11)}</span></summary><div class="account-menu-panel"><span class="account-menu-caption">账号与额度</span><a href="/account/event">${icon('calendar',15)}额度与记录</a><button type="button" data-action="activation">${icon('user',15)}使用另一张激活码</button></div></details>`:`<button type="button" class="account-link account-activate" data-action="activation"><span class="account-badge">${icon('user',13)}</span><span class="account-name">输入激活码</span>${icon('chevron',11)}</button>`):`<a class="account-link" href="${owner?'/merchant':'/login?return_to=/workbench.html'}"><span class="account-badge">${icon('user',13)}</span>${owner?escape(owner.displayName||'我的体验'):'登录，保存我的工作'}${icon('chevron',11)}</a><a class="classic-link" href="classic.html">更多管理与原工作台 ↗</a>`}</div></aside>`;
    const header = isPublic ? `<header class="public-header">${brand}<div class="header-right"><button class="top-link" data-action="about">了解紫丁香</button><a class="header-button" href="workbench.html">进入我的工作台 ↗</a></div></header>` : `<header class="topbar"><div class="assistant-name"><button class="mobile-menu" data-action="menu" aria-label="打开导航">${icon('menu')}</button><strong>丁小穗</strong><span class="status-dot"></span><span>陪你做品牌的 AI 新农人</span></div><div class="top-actions">${!needsActivation()?`<button type="button" class="credit-summary" data-action="credits" aria-label="查看额度与使用记录">${icon('sparkle',12)}<span data-credit-balance="header">${balanceLabel()}</span></button>`:''}<button class="top-link" data-action="shelf">我的资料</button><button class="top-link" data-action="about">关于紫丁香</button><a class="ecosystem" href="https://zlg.aiglink.cn/" target="_blank" rel="noopener"><img src="suyi-original.png" alt="苏一二"><span>智链谷生态支持</span></a>${needsActivation()?'<button class="event-activation-trigger" type="button" data-action="activation">激活</button>':''}${eventMode()&&window.ZdxEventAccess.state.platformAdmin?'<button class="top-link" type="button" data-event-signout>退出管理员</button>':''}</div></header>`;
    $('#dialogue-app').innerHTML = `<div class="app-layout">${isPublic ? '' : sidebar}<main class="main-shell ${isPublic ? 'public' : ''} ${hasMessages ? 'conversation-active' : ''}">${header}<div class="chat-column">${!isPublic&&hasMessages?`<div class="conversation-modes"><span>继续创作</span>${Object.entries(modeLabels).map(([mode,label])=>`<button type="button" data-creative-mode="${mode}">${label} ↗</button>`).join('')}</div>`:''}${isPublic ? `<section class="welcome"><div class="welcome-mascot"><img src="ding-xiaosui-fluffy.webp" alt="丁小穗，老实又可爱的 AI 新农人"></div><div class="welcome-tag">${isPublic ? 'AI × 山西好物 × OPC 共创' : '丁小穗 · 陪你做品牌的 AI 新农人'}</div><h1>${isPublic ? '农品经营，<em>一句话开始。</em>' : '更懂山西农产品，<br><em>让农业品牌被看见。</em>'}</h1><p>${isPublic ? '我是丁小穗。你说想做啥，咱们一起做起来。' : '我是丁小穗。品牌叫什么？咱们先做一版。'}</p></section><div class="quick-prompts">${quick.map(([glyph, title, subtitle, prompt]) => `<button class="quick-card ${!isPublic&&taskId===prompt?'is-selected':''}" ${!isPublic?`data-starter-task="${escape(prompt)}" aria-pressed="${taskId===prompt}"`:prompt === 'tools' ? 'data-action="tools"' : `data-prompt="${escape(prompt)}"`}><span class="quick-icon">${icon(glyph, 16)}</span><strong>${title}</strong><small>${subtitle}</small></button>`).join('')}</div>${isPublic?'':`<section class="common-scenes" aria-labelledby="scenes-title"><div class="scenes-heading"><h2 id="scenes-title">常用场景</h2><span>选场景，说名字就能开始</span></div><div class="scene-list">${commonScenes.map(([id,label])=>`<button type="button" class="${taskId===id?'is-selected':''}" data-starter-task="${escape(id)}" aria-pressed="${taskId===id}">${escape(label)}</button>`).join('')}</div></section>`}<p class="starter-note">${isPublic ? '少一点寻找，多一点开始。' : '实在说农品，认真做品牌。拿不准的，咱们再一起核对。'}</p>${isPublic?'':`<div class="starter-actions">${eventMode()?'<a class="small-action" href="/account/studio?type=image&provider=platform">做图片 ↗</a><span>·</span>':''}<button type="button" data-action="tools">更多创作与办公场景 ↗</button><span>·</span><button type="button" data-action="regional">山西农品参考与来源 ↗</button></div>`}` : creativeHome()}<div class="messages" id="messages" role="log" aria-label="与丁小穗的对话" aria-live="polite"></div><div class="composer-wrap"><form class="composer" id="dialogue-form"><label class="hidden" for="question">告诉丁小穗你想做什么</label><textarea id="question" name="question" aria-label="告诉丁小穗你想做什么" rows="2" maxlength="6000" placeholder="${isPublic ? '比如：紫丁香能怎样帮我，把一款小米卖得更好？' : escape(creativeMode==='image'?'说说你的产品，想做怎样的图片？':creativeMode==='video'?'说说你的品牌，想要怎样的视频？':tasks.find(task=>task.id===taskId)?.placeholder||'告诉我品牌或农品名字，也可以直接说你想做什么。')}"></textarea><div class="composer-bottom"><div class="composer-options"><button class="tool-select" type="button" data-action="tools">${icon('sparkle', 12)}<span id="selected-tool">${escape(creativeMode==='image'?'图片创作':creativeMode==='video'?'视频创作':tasks.find(task => task.id === taskId)?.name || '让丁小穗帮我')}</span></button><span class="model-indicator" id="model-indicator">${creativeMode==='image'||creativeMode==='video'?'确认要求后再生成':connected ? '准备好，开始创作' : modelReason ? '文字创作已暂停' : '资料查询可用'}</span></div><button class="send-button" id="send-button" type="${busy ? 'button' : 'submit'}" aria-label="${busy ? '停止等待回答' : '发送消息'}" ${busy ? 'data-action="stop"' : ''}>${icon(busy ? 'stop' : 'arrow', 18)}</button></div></form><p class="composer-note">${connected ? '基于你的真实农品资料创作，发布前请核对关键信息。' : modelReason ? escape(modelReason) : eventMode() ? (owner ? '作品和额度随本次体验保存。' : '可先浏览场景与资料，点击右上角“激活”后开始 AI 创作。') : owner ? '资料按账号保存。连接文字服务后，可直接创作和连续修改。' : '访客资料暂存本机。登录同一账号，让工作可以换设备继续。'}</p></div></div><footer class="footer"><span class="footer-brand"><img class="footer-logo" src="zlg-logo.png" alt="智链谷官方 Logo"><span>${isPublic ? '山西农业大学智能传播研究院发起 · 智链谷生态支持' : '每一份真实资料，都值得被好好使用。'}</span></span><a class="footer-qr" href="https://zlg.aiglink.cn/" target="_blank" rel="noopener"><img src="zlg-site-qr.png" alt="智链谷官方网站二维码"><span>智链谷<br>官方网站</span></a></footer></main></div><input type="file" id="backup-file" class="file-input" accept="application/json,.json">`;
    renderMessages();
    $('#question').value = inputDraft;
    $('#dialogue-form').addEventListener('submit', event => { event.preventDefault(); void send($('#question').value); });
    $('#question').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); if (!busy) void send(event.currentTarget.value); } });
    $('#backup-file').addEventListener('change', event => { void importBackup(event.target.files?.[0]); });
  }
  function renderMessages() {
    const node = $('#messages'); if (!node) return;
    node.innerHTML = (active()?.messages || []).map(message => {
      if (message.role === 'user') return `<div class="message-row user"><div class="message-content"><p class="message-text">${escape(message.text)}</p></div></div>`;
      const cards = message.cards?.length ? `<div class="results-grid">${message.cards.map(card => `<article class="result-card"><span class="result-label">${escape(card.label)}</span><h3>${escape(card.title)}</h3><p>${escape(card.body?.slice(0, 160))}</p><div class="message-actions"><button class="small-action" data-record="${escape(card.id)}" data-collection="${escape(card.collection)}">查看资料 ↗</button>${card.collection === 'products' ? `<button class="small-action" data-product="${escape(card.id)}">用它写内容</button>` : card.collection === 'drafts' ? `<button class="small-action" data-plan-draft="${escape(card.id)}">安排发布</button>` : ''}</div></article>`).join('')}</div>` : '';
      const proposal = message.proposal ? `<div class="proposal-card"><h3>${escape(message.proposal.title)}</h3><p>${escape(message.proposal.preview || Object.entries(message.proposal.value || {}).filter(([key, value]) => value && ['name', 'origin', 'abv', 'summary', 'title', 'date', 'channel', 'body'].includes(key)).map(([key, value]) => `${({name:'农品',origin:'产地',abv:'规格',summary:'介绍',title:'主题',date:'日期',channel:'渠道',body:'内容'})[key]}：${value}`).join('\n').slice(0, 800))}</p><div class="message-actions"><button class="primary-small" data-confirm="${escape(message.id)}" ${message.applied ? 'disabled' : ''}>${message.applied ? '已保存' : message.proposal.kind === 'product' ? '确认保存农品' : message.proposal.kind === 'plan' ? '确认加入发布计划' : message.proposal.kind === 'media' ? (eventMode()?'确认生成，使用 1 张图片额度':'确认生成，使用模型额度') : '确认保存'}</button>${message.applied ? '<span class="proposal-state">页面顶部可查看同步状态</span>' : '<span class="proposal-state">核对内容后再保存</span>'}</div></div>` : '';
      const artifactActions = message.artifact ? `<button class="small-action" data-save-message="${escape(message.id)}">保存文案</button><button class="small-action" data-office-message="${escape(message.id)}">存为办公稿</button><button class="small-action" data-revise="${escape(message.id)}">继续修改</button>` : '';
      const mediaOutput = message.mediaJob ? mediaMarkup(message.mediaJob) : '';
      const retry = message.retry ? `<button class="small-action" data-retry-message="${escape(message.id)}">重试本次，不重复扣次</button>` : '';
      const mediaLink = message.mediaHandoff && ['image','video'].includes(message.mediaHandoff.capability) && typeof message.mediaHandoff.prompt==='string' ? `<div class="media-handoff-card"><div><span>${message.mediaHandoff.capability==='video'?'视频':'图片'}创作</span><p>${escape(message.mediaHandoff.prompt.slice(0,200))}</p></div><button class="primary-small" type="button" data-media-handoff="${escape(message.id)}">前往${message.mediaHandoff.capability==='video'?'视频':'图片'}创作 ↗</button></div>` : '';
      return `<div class="message-row"><img class="message-avatar" src="ding-xiaosui-fluffy.webp" alt="丁小穗"><div class="message-content"><p class="message-text">${escape(message.text)}</p>${cards}${proposal}${mediaOutput}${mediaLink}${knowledgeReferenceMarkup(message.knowledge)}${message.references?.length?`<p class="sheet-intro">可核对的参考来源</p><div class="message-actions">${referenceLinks(message.references)}</div>`:''}<div class="message-meta">${message.source ? `<span class="source-chip">${escape(message.source)}</span>` : ''}${message.provider ? `<span>${escape(message.provider)}</span>` : ''}</div><div class="message-actions">${artifactActions}${retry}${message.templateTask ? `<button class="small-action" data-template="${escape(message.id)}">记下这次需求</button>` : ''}${message.text ? `<button class="small-action" data-copy-message="${escape(message.id)}">复制回答</button>` : ''}</div></div></div>`;
    }).join('') + (busy ? '<div class="message-row"><img class="message-avatar" src="ding-xiaosui-fluffy.webp" alt=""><div class="message-content"><div class="typing" role="status" aria-label="正在生成，请稍候"><i></i><i></i><i></i></div><p class="message-text">正在生成，请稍候。文案通常一分钟内完成；图片大约几十秒。视频一般 1–3 分钟，高清视频可能要 2–8 分钟，这是正常的。只有成功交付才扣次数，失败会自动退回。</p></div></div>' : '');
  }
  const mediaStatus = status => ({submitting:'提交中',queued:'等待生成',running:'正在生成',saving:'已生成，正在保存',succeeded:'生成完成',failed:'生成失败',unknown:'结果待核对'})[status] || '状态待核对';
  function mediaMarkup(job) {
    const safe = value => typeof value === 'string' && (/^\/api\/media\/assets\//.test(value) || /^https:\/\//.test(value)) ? escape(value) : '';
    const waiting = ['submitting','queued','running','saving'].includes(job.status);
    const failed = job.status === 'failed';
    return `<div class="results-grid"><article class="result-card"><span class="result-label">${job.capability === 'video' ? '视频' : '图片'}任务</span><h3>${escape(mediaStatus(job.status))}${Number.isInteger(job.progress) ? ` · ${job.progress}%` : ''}</h3>${waiting ? `<p>${escape(job.hint || (job.capability === 'video' ? '视频正在生成。普通视频大约 1–3 分钟，高清视频大约 2–8 分钟。成功后才扣次数。' : '图片正在生成，请稍候。成功后才扣次数。'))}</p>` : ''}${(job.outputs || []).map(item => safe(item.url) ? `${job.capability === 'video' ? `<video controls playsinline src="${safe(item.url)}"></video>` : `<img src="${safe(item.url)}" alt="生成的农品创作图片">`}<a class="small-action" href="${safe(item.url)}" target="_blank" rel="noopener">打开并保存原文件 ↗</a>${item.persisted === false ? '<p>临时链接，请及时保存。</p>' : ''}` : '').join('')}<p>${escape(job.error || (waiting ? '' : '生成内容请核对实物、包装和文字后使用。'))}</p><button class="small-action" data-refresh-job="${escape(job.id)}">${waiting ? '查看进度' : '刷新任务状态'}</button>${failed ? `<button class="small-action" data-retry-media="${escape(job.id)}" data-media-capability="${escape(job.capability || 'image')}" data-media-prompt="${escape(job.prompt || '')}">重新生成</button>` : ''}</article></div>`;
  }
  function response(thread, value) {
    const message = { id: ids(), role: 'assistant', createdAt: now(), ...value };
    thread.messages.push(message); persist(); render();
    requestAnimationFrame(() => { $('#question').focus(); $('#dialogue-form').scrollIntoView({ behavior: 'smooth', block: 'end' }); });
    return message;
  }
  function lastArtifact(thread) { return thread.messages.slice().reverse().find(message => message.role === 'assistant' && message.artifact); }
  function aboutAnswer(question) {
    if (/加入|开始|OPC/i.test(question)) return '咱们可以先从一款农品、一件想做的事开始。想做品牌介绍、朋友圈文案，还是 PPT？说一句就行。\n\nOPC 在这里说的是一个人借助 AI 开展经营的方式。我是虚拟 AI 伙伴，帮你整理资料、策划内容和安排工作；供货、合作与履约还需要你核实。账号资料可以慢慢补齐，不用一次填全。';
    return '我是丁小穗，紫丁香计划的虚拟 AI 新农人，也是陪你做农品品牌的经营伙伴。\n\n我想帮更多农品经营者把自家的好东西讲清楚。咱们实在说农品，认真做品牌；拿不准的，我会问一句。\n\n想做宣传文案、品牌定位、农品 PPT 大纲，还是农业模特和新农人账号策划？选好场景，说出品牌名字就能开始；也可以直接说想做啥。正式稿我按用途写，资料缺什么，咱们慢慢补。\n\n紫丁香计划由山西农业大学智能传播研究院发起。登录后，资料按账号保存；文字生成是否可用，以输入框下方的服务状态为准。';
  }
  async function send(raw, retry) {
    const question = String(raw || '').trim(); if (!question || busy) return;
    if (question.length > 6000) { toast('这次内容请控制在 6000 字以内'); return; }
    const routed = D.route(question, taskId);
    const requestedMedia=mediaIntent(question)||(!isPublic&&!wantsWrittenContent(question)&&['image','video'].includes(creativeMode)&&routed.kind==='generate'?creativeMode:null);
    const intent=requestedMedia?{kind:'media'}:routed;
    if(needsActivation() && ['generate','media'].includes(intent.kind)){window.ZdxEventAccess.open();return;}
    let thread;
    try { thread = ensureThread(question); } catch (error) { toast(error.message); return; }
    if (thread.messages.length > 96) { toast('这段对话已很长，请开启新对话，历史仍会保留'); return; }
    if (!retry) thread.messages.push({ id: ids(), role: 'user', text: question, createdAt: now() });
    if (retry?.taskId) taskId = retry.taskId;
    const requestId = retry?.requestId || thread.messages.at(-1).id;
    if (!persist()) { render(); return; }
    $('#question').value = '';
    if(intent.kind==='github'){response(thread,{text:'已展开写作与办公场景，包括 PPT 大纲、农品介绍翻译、文案润色与会议纪要。选择后补充原始资料即可。',source:'写作与办公 · 未调用模型'});openWorkMethods();return;}
    if(intent.kind==='credits'){await refreshCredits();if(eventMode()){response(thread,{text:owner?`当前剩余${balanceLabel()}。已打开创作额度与使用记录。查看记录、保存和下载已有作品不消耗次数。`:'请先输入激活码，激活后即可查看文案、图片与视频次数。',source:'体验额度 · 未调用模型'});creditPanel.open();return;}response(thread,{text:owner&&textCredits!==null?`当前账号剩余 ${textCredits} 创作点。已打开点数面板，可以兑换激活码、查看使用记录和套餐。查点数不会扣点。`:'已打开创作点面板。登录后可查看自己的点数、兑换激活码和查询使用记录。',source:'账号创作点 · 未调用模型'});creditPanel.open();return;}
    if(intent.kind==='reference'){
      const exact=regionalRecords().filter(item=>item.row.tags.some(tag=>!['山西','品牌','产地','特优农业','有机旱作','知识'].includes(tag)&&question.includes(tag)));
      const found=exact.length?exact:regionalRecords();
      response(thread,{text:'这是目前整理的山西农品参考资料。产区特点是背景，不能直接替代某款商品的检测或认证；点开可以核对来源和具体表达建议。',cards:found.slice(0,9).map(({row,...card})=>card),source:'首批公开资料 · 2026-10-21 整理'});return;
    }
    if (intent.kind === 'about') { response(thread, { text: aboutAnswer(question), source: '紫丁香计划资料' }); return; }
    if (intent.kind === 'search') {
      const found = /图片|视频|素材|作品/.test(question) ? [...(/作品/.test(question)?D.records(state).filter(row=>row.collection==='drafts'):[]),...mediaRecords().filter(row=>/图片/.test(question)?row.row.capability==='image':/视频/.test(question)?row.row.capability==='video':true)] : D.search(question, state, profile, leads, intent);
      response(thread, { text: found.length ? `找到了 ${found.length} 条${intent.collection ? ({ ...D.collections, leads:'客户咨询',profile:'经营档案',mediaProfile:'账号定位' })[intent.collection] : '相关资料'}。${found.length > 12 ? '先展示前 12 条，也可以在“资料与作品”里继续找。' : '点开即可查看，也可以告诉我接下来要用它做什么。'}` : '这次还没找到对应资料。可以换个关键词，或者先告诉我农品叫什么，咱们慢慢补齐。', cards: found.slice(0, 12).map(({row,...card}) => card), source: owner ? '当前账号资料' : '访客本机资料' }); return;
    }
    if (intent.kind === 'product') {
      const proposal = D.productProposal(question);
      response(thread, proposal ? { text: '我按你提供的内容整理好了。没有提供的字段会留空，核对后保存到农品资料。', proposal, source: '按你的输入整理' } : { text: '咱们先记下农品名字。你可以说“新增农品：小米”，其他资料之后慢慢补齐。', source:'资料建档' }); return;
    }
    if (intent.kind === 'save') { proposeSave(thread, lastArtifact(thread), intent.collection); return; }
    if (intent.kind === 'plan') { proposePlan(thread, question); return; }
    if(requestedMedia){proposeMedia(thread,question,requestedMedia);return;}
    const product = D.matchProduct(question, state) || state.products.find(row => row.id === thread.productId);
    const history = Array.isArray(retry?.history) ? retry.history : thread.messages.slice(0,-1).slice(-6).map(({role,text})=>({role,text:String(text||'').slice(0,800)}));
    const requestTask = retry ? (retry.taskId || '') : taskId;
    const productId = retry ? (retry.productId || '') : (product?.id || '');
    if (!connected || !owner) {
      response(thread, { text: `${product ? `已找到「${product.name}」的农品资料。` : ''}${owner ? (modelReason || '当前账号的文字模型尚未连接。资料查询、农品建档和发布安排可以直接使用；连接服务后，我就能按这些资料完成创作。') : '我可以先帮你找资料、整理农品和安排工作。使用模型创作前，请先登录账号。'}${['translate','general'].includes(intent.taskId) ? '' : '\n\n也可以先记下这次需求，服务恢复后接着做。'}`, templateTask: ['translate','general'].includes(intent.taskId) ? null : intent.taskId, original: question, productId: product?.id, source: '服务状态说明' }); return;
    }
    busy = true; controller = new AbortController(); render();
    try {
      await window.zdxStorage.sync.flush();
      const sync = window.zdxStorage.sync.status();
      if (sync.dirty || ['conflict','stale','remote','auth'].includes(sync.phase)) throw Error('请先完成页面顶部的同步处理，再使用最新资料创作');
      const result = await fetch('/api/dialogue', { method:'POST',credentials:'same-origin',headers:{'content-type':'application/json','x-zdx-workspace-owner':owner.id},signal:controller.signal,body:JSON.stringify({ message:question, requestId, taskId:requestTask, productId, threadId:thread.id, consent:true, revision:sync.revision, history }) });
      let value = {}; try { value = await result.json(); } catch { throw Object.assign(Error('生成时间较长，服务器还没有返回结果。请点“重试本次”，不会重复扣次。'), { name: 'TimeoutError' }); }
      if (!result.ok) throw Error(value.error || '暂时没有取得回答，请稍后重试');
      busy = false;
      response(thread, { text:value.answer, references:value.references, knowledge:value.knowledge, source: sourceLabel(value.source), provider:value.provider, artifact:{title:value.title,taskId:value.taskId,productId:product?.id || '',channel:channelFor(value.taskId)} });
    } catch (error) {
      busy = false;
      const timedOut = error.name === 'AbortError' || error.name === 'TimeoutError' || /超时|尚未返回|仍在处理|不完整/.test(error.message || '');
      const text = error.name === 'AbortError' ? '已停止等待。如果模型已经开始生成，请点“重试本次”，会沿用同一次请求，不会重复扣次。' : (error.message || '暂时没有取得回答');
      response(thread, { text: timedOut || !error.message ? `${text} 失败或中断不会多扣次数；若次数已预留，重试原任务即可。` : text, source:'本次未取得有效模型结果', ...(timedOut ? { retry: { requestId, question, taskId:requestTask, productId, history } } : {}) });
    }
    finally { busy=false;controller=null;await refreshCredits();render(); }
  }
  const channelFor = id => ({moments:'朋友圈',xiaohongshu:'小红书',script:'视频号',article:'公众号'})[id] || '朋友圈';
  const sourceLabel = source => source==='github-meeting' ? '会议纪要' : source?.startsWith('baoyu-') ? '写作与办公' : '丁小穗创作';
  function mediaRecords() {
    return (media?.jobs || []).map(job => ({collection:'media',label:job.capability==='video'?'视频作品':'图片作品',id:job.id,title:job.prompt?.slice(0,70)||'创作任务',body:`${job.providerModel||job.modelName||''} · ${mediaStatus(job.status)}${job.error?'。'+job.error:''}`,row:job}));
  }
  const allRecords = () => [...D.records(state,profile,leads),...mediaRecords()];
  function proposeSave(thread, message, collection = 'drafts') {
    if (!message?.artifact) { response(thread, { text:'先完成一份内容创作，再告诉我“保存为文案”或“存到知识库”。已有作品可以在左侧“资料与作品”中查看。',source:'保存指引' }); return; }
    const kind = {drafts:'draft',office:'office',knowledge:'knowledge'}[collection] || 'draft';
    response(thread, { text: kind==='knowledge' ? '这份内容会作为“待核实”知识保存。核对来源后，可以在左侧“知识库”中编辑和标记核实。' : '内容已整理成待保存稿，确认后会进入你的资料库。', proposal:{kind,title:message.artifact.title,value:{title:message.artifact.title,body:message.text,content:kind==='knowledge'?message.text:undefined,productId:message.artifact.productId || '',channel:message.artifact.channel || '朋友圈',scene:'日常种草',engine:message.provider || '资料模板',kind:tasks.find(task=>task.id===message.artifact.taskId)?.name || '对话创作',source:'对话创作',verified:false}} });
  }
  function proposePlan(thread, question) {
    const latestSaved = [...thread.messages].reverse().find(message => message.savedRecord?.collection === 'drafts');
    const draft = state.drafts.find(row => row.title && question.includes(row.title)) || state.drafts.find(row => row.id === thread.selectedDraftId) || state.drafts.find(row => row.id === latestSaved?.savedRecord?.id);
    if (!draft) { response(thread, {text:'先选一条已保存的文案，再告诉我哪天发布。以下是你的现有文案；如果还没有文案，可以先完成创作并保存。',cards:D.records(state).filter(row=>row.collection==='drafts').slice(0,6).map(({row,...card})=>card),source:'发布安排'});return; }
    if (!/明天|后天|今天|\d{4}-\d{2}-\d{2}/.test(question)) { thread.selectedDraftId=draft.id; response(thread,{text:`已选中「${draft.title}」。计划哪天发布？例如：“安排明天发布这条文案”。`,source:'发布安排'});return; }
    const date=D.day(question);if(!date){response(thread,{text:'这个日期似乎无效，请用 YYYY-MM-DD 或“明天”再告诉我。'});return;}
    response(thread,{text:'确认后会加入待发布计划，届时由你核对并发布到对应平台。',proposal:{kind:'plan',title:draft.title,value:{draftId:draft.id,productId:draft.productId,title:draft.title,date,channel:draft.channel||'朋友圈',status:'待发布',views:0,inquiries:0,signups:0,note:'通过丁小穗对话安排'}}});
  }
  function proposeMedia(thread, question, capability='image') {
    const scene=capability==='video'?(/模特|数字人|人物/.test(question)?'avatar':/广告/.test(question)?'ad':'brand'):(/包装|礼盒|标签/.test(question)?'packaging':/详情/.test(question)?'detail':/PPT|幻灯片/i.test(question)?'ppt':'product');
    response(thread,{text:`已整理好这次${capability==='video'?'视频':'图片'}创作要求。进入工作室后，可以补充产品资料、选择画面比例，再确认生成。`,mediaHandoff:{capability,scene,prompt:question},source:'创作指引 · 尚未生成'});
  }
  async function confirmProposal(messageId) {
    const message=active()?.messages.find(item=>item.id===messageId);if(!message?.proposal||message.applied||busy)return;
    if(message.proposal.kind==='media'){
      busy=true;render();
      try{const r=await fetch('/api/media/jobs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...message.proposal.value,consent:true})});const value=await r.json();if(!r.ok)throw Error(value.error||'创作任务未确认提交');message.mediaJob=value.job||value;message.applied=true;message.text=eventMode()?'创作任务已提交，完成后会自动显示图片；离开页面也会继续保存。':'创作任务已提交，完成后会自动更新；也可稍后返回查看。';persist();}
      catch(error){toast(error.message);}finally{busy=false;render();}return;
    }
    const next=structuredClone(state),target=next.conversations.find(item=>item.id===currentId).messages.find(item=>item.id===messageId);
    try{const row=D.applyProposal(next,target.proposal);target.applied=true;target.savedRecord={collection:({product:'products',draft:'drafts',office:'office',knowledge:'knowledge',plan:'plans'})[target.proposal.kind],id:row.id};if(persist(next)){render();toast('已暂存，服务器保存状态见页面顶部');}}
    catch(error){toast(error.message);}
  }
  function openSheet(title, content) {
    closeSheet();sheetReturnFocus=document.activeElement;
    const overlay=document.createElement('div');overlay.className='overlay';overlay.id='dialogue-overlay';overlay.innerHTML=`<section class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" tabindex="-1"><div class="sheet-head"><h2 id="sheet-title">${escape(title)}</h2><button class="icon-button" data-action="sheet-close" aria-label="关闭面板">${icon('close',17)}</button></div>${content}</section>`;
    overlay.addEventListener('click',event=>{if(event.target===overlay)closeSheet();});document.body.append(overlay);overlay.querySelector('[data-action="sheet-close"]').focus();
  }
  function closeSheet(){const overlay=$('#dialogue-overlay');if(overlay){overlay.remove();sheetReturnFocus?.focus?.();}}
  function openTools() {
    const sceneGroups=[['品牌与形象',['agri','brand','agri-model','new-farmer','design','ppt']],['内容与销售',['selling','moments','xiaohongshu','script','article','live','detail','private','season','gift','channel','visit','sales','campaign']],['经营与办公',['plan','brief','minutes','weekly','email','translate','polish','sop','excel','knowledge']]];
    openSheet('农品创作与经营场景',`<p class="sheet-intro">从推广一款农品，到打造农业品牌与新农人 IP，选一个场景，说个品牌名字，或说说想做什么即可。</p><button class="auto-task" type="button" data-starter-task="general">${icon('sparkle',15)}让丁小穗自动判断<span>直接说你想做什么 ↗</span></button>${sceneGroups.map(([title,ids])=>`<h3 class="sheet-section">${title}</h3><div class="sheet-tools">${ids.map(id=>tasks.find(task=>task.id===id)).filter(Boolean).map(task=>`<button class="tool-card" data-starter-task="${escape(task.id)}"><strong>${escape(task.name)}</strong><p>${escape(task.description)}</p></button>`).join('')}</div>`).join('')}<p class="sheet-section">山西农品参考</p><button class="small-action" data-action="regional">查看山西农品参考与来源 ↗</button><p class="sheet-section">图片与视频创作</p><p class="sheet-intro">想直接制作画面或短片，可以进入对应工作室，补充资料后确认生成。</p><div class="message-actions"><button type="button" class="small-action" data-media-type="image" data-media-scene="product">做图片 ↗</button><button type="button" class="small-action" data-media-type="video" data-media-scene="brand">做视频 ↗</button><a class="small-action" href="/account/models">个人模型</a><a class="small-action" href="/platform/services">AI 服务设置</a><a class="small-action" href="third-party-notices.txt" target="_blank" rel="noopener">方法来源与许可说明</a></div>`);
  }
  const knowledgeKinds = ['品牌介绍','产品资料','文章素材','其他'];
  const knowledgeDraftKey = 'zdx-knowledge-editor-v1';
  let knowledgeFilter = '', knowledgeShowArchived = false, knowledgeSaving = false;
  let knowledgeDraft = (()=>{try{const draft=JSON.parse(window.zdxStorage.session.getItem(knowledgeDraftKey)||'null');return draft&&typeof draft==='object'&&typeof draft.id==='string'&&typeof draft.content==='string'&&draft.content.length<=6*1024*1024?draft:null;}catch{return null;}})();
  const knowledgeText = row => typeof row.content==='string'?row.content:typeof row.body==='string'?row.body:'';
  const knowledgeKind = row => knowledgeKinds.includes(row.kind)?row.kind:'其他';
  const knowledgeTags = row => Array.isArray(row.tags)?row.tags.filter(tag=>typeof tag==='string').join('、'):typeof row.tags==='string'?row.tags:'';
  function knowledgeCanEdit(){
    if(needsActivation()){closeSheet();window.ZdxEventAccess.open();return false;}
    if(!owner){toast('请先进入已激活的工作台，再保存知识库资料');return false;}
    return true;
  }
  function rememberKnowledgeDraft(){
    const form=$('#knowledge-form');if(!form||knowledgeSaving)return;
    knowledgeDraft={...knowledgeDraft,id:form.dataset.recordId,title:form.elements.title.value,kind:form.elements.kind.value,brand:form.elements.brand.value,productName:form.elements.productName.value,tags:form.elements.tags.value,source:form.elements.source.value,content:form.elements.content.value,verified:form.elements.verified.checked,autoReference:form.elements.autoReference.checked,dirty:true};
    try{window.zdxStorage.session.setItem(knowledgeDraftKey,JSON.stringify(knowledgeDraft));}catch{const note=$('#knowledge-form-status');if(note)note.textContent='浏览器暂存不可用，请先复制正文再关闭。';}
    const count=$('#knowledge-count');if(count)count.textContent=knowledgeDraft.content.length+' / 20,000 字';
  }
  function clearKnowledgeDraft(){knowledgeDraft=null;try{window.zdxStorage.session.removeItem(knowledgeDraftKey);}catch{}}
  function knowledgeReferenceMarkup(value){
    if(!value||value.status!=='referenced'||!Array.isArray(value.sources)||!value.sources.length)return '';
    return `<aside class="knowledge-references" aria-label="本次知识库参考资料"><span>${icon('book',13)}本次参考资料</span><div>${value.sources.slice(0,5).map(row=>row&&typeof row==='object'?`<button class="small-action" type="button" data-knowledge-view="${escape(row.id||'')}">${escape(row.title||'知识库资料')}<small>${row.verified?'已核实':'待核实'}</small></button>`:'').join('')}</div><small>已提供给丁小穗判断参考，未必全部采纳；发布前请核对事实。</small></aside>`;
  }
  function openKnowledge(){
    $('.sidebar')?.classList.remove('is-open');$('.mobile-backdrop')?.classList.remove('is-open');
    const activeCount=state.knowledge.filter(row=>!row.archived).length;
    openSheet('知识库',`<div class="knowledge-intro"><span class="knowledge-emblem">${icon('book',25)}</span><div><span class="knowledge-eyebrow">属于你的品牌资料</span><h3>好内容，从了解你的品牌开始。</h3><p>放进品牌介绍、产品资料和文章。写文案时，丁小穗会判断哪些资料与本次需求有关，再选择参考。</p></div></div><div class="knowledge-toolbar"><span>${activeCount} 篇在库资料 <small>仅当前账号可见</small></span><button class="primary-small" type="button" data-action="knowledge-new">${icon('plus',14)}添加资料</button></div>${knowledgeDraft?.dirty?`<div class="knowledge-draft-note"><span>有一份尚未提交的编辑草稿</span><button type="button" class="small-action" data-action="knowledge-resume">继续编辑</button></div>`:''}<input class="sheet-search" id="knowledge-search" placeholder="搜索标题、品牌、产品或正文" aria-label="搜索知识库"><div class="knowledge-filters"><div class="shelf-tabs">${['',...knowledgeKinds].map(kind=>`<button type="button" class="shelf-tab${knowledgeFilter===kind?' active':''}" data-knowledge-filter="${escape(kind)}" aria-pressed="${knowledgeFilter===kind}">${kind||'全部'}</button>`).join('')}</div><label><input id="knowledge-archived" type="checkbox" ${knowledgeShowArchived?'checked':''}>查看已归档</label></div><div id="knowledge-records" class="knowledge-records"></div><p class="knowledge-footer-note">只参考相关且开启“自动参考”的资料。已归档或关闭自动参考的内容不会用于创作；未核实信息会保留待核实标记。</p>`);
    $('#dialogue-overlay .sheet').classList.add('knowledge-sheet');
    $('#knowledge-search').addEventListener('input',renderKnowledge);
    $('#knowledge-archived').addEventListener('change',event=>{knowledgeShowArchived=event.target.checked;renderKnowledge();});
    renderKnowledge();
  }
  function renderKnowledge(){
    const list=$('#knowledge-records');if(!list)return;
    const query=$('#knowledge-search')?.value.trim().toLowerCase()||'';
    const rows=state.knowledge.map((row,index)=>({row,index})).filter(({row})=>Boolean(row.archived)===knowledgeShowArchived&&(!knowledgeFilter||knowledgeKind(row)===knowledgeFilter)&&(!query||[row.title,row.brand,row.productName,knowledgeTags(row),knowledgeText(row)].join(' ').toLowerCase().includes(query)));
    list.innerHTML=rows.length?rows.map(({row,index})=>`<article class="knowledge-card"><div class="knowledge-card-meta"><span>${escape(knowledgeKind(row))}</span><span class="${row.verified?'is-verified':'is-unverified'}">${row.verified?'已核实':'待核实'}</span><span>${row.archived?'已归档':row.autoReference===false||row.enabled===false?'仅保存':'自动参考'}</span></div><h3>${escape(row.title||'未命名资料')}</h3>${row.brand||row.productName?`<p class="knowledge-brand">${escape([row.brand,row.productName].filter(Boolean).join(' · '))}</p>`:''}<p class="knowledge-excerpt">${escape(knowledgeText(row).slice(0,130))}${knowledgeText(row).length>130?'…':''}</p><div class="knowledge-card-foot"><span>${escape(knowledgeTags(row).slice(0,100)||row.source||'自己提供的品牌资料')}</span><button type="button" class="small-action" data-knowledge-index="${index}">查看与编辑 ↗</button></div></article>`).join(''):`<div class="knowledge-empty"><span>${icon('book',30)}</span><h3>${query?'没有找到这份资料':knowledgeShowArchived?'还没有归档资料':'把品牌的故事，放在这里。'}</h3><p>${query?'换个关键词试试，也可以查看其他分类。':knowledgeShowArchived?'归档的资料会保留在这里，随时可以恢复。':'可以先粘贴一段品牌介绍，或一款产品的规格、卖点和保存方法。'}</p>${!query&&!knowledgeShowArchived?'<button type="button" class="primary-small" data-action="knowledge-new">添加第一份资料</button>':''}</div>`;
  }
  function openKnowledgeEditor(index=null,resume=false){
    if(knowledgeSaving){toast('正在保存资料，请稍候');return;}
    if(!knowledgeCanEdit())return;
    if(knowledgeDraft?.dirty&&!resume){openSheet('继续编辑知识库',`<p class="sheet-intro">你还有一份未提交的草稿。先处理它，避免覆盖正在编辑的内容。</p><div class="message-actions"><button type="button" class="primary-small" data-action="knowledge-resume">继续编辑草稿</button><button type="button" class="small-action" data-action="knowledge-discard">放弃这份草稿</button></div>`);return;}
    const row=resume?state.knowledge.find(item=>item.id===knowledgeDraft?.id):index!==null?state.knowledge[index]:null;
    if(index!==null&&!row&&!resume){toast('这条资料已变化，请重新打开知识库');return;}
    if(!row&&!resume&&state.knowledge.length>=500){toast('知识库已达到 500 篇，请先整理已有资料');return;}
    const draft=resume&&knowledgeDraft?knowledgeDraft:{id:typeof row?.id==='string'&&row.id?row.id:ids(),originalIndex:index,originalRecord:row?JSON.stringify(row):null,title:row?.title||'',kind:knowledgeKind(row||{}),brand:row?.brand||'',productName:row?.productName||state.products.find(product=>product.id===row?.productId)?.name||'',tags:knowledgeTags(row||{}),source:row?.source||'',content:knowledgeText(row||{}),verified:row?.verified===true,autoReference:row?.autoReference!==false&&row?.enabled!==false,dirty:false};
    knowledgeDraft=draft;
    openSheet(row?'编辑知识库资料':'添加知识库资料',`<form id="knowledge-form" class="knowledge-form" data-record-id="${escape(draft.id)}"><p class="knowledge-editor-intro">把已有介绍直接粘贴进来即可。品牌和产品名称有助于丁小穗找对资料。</p><label>资料标题 <span>必填</span><input name="title" aria-label="资料标题" required maxlength="120" placeholder="例如：隰县玉露香梨产品介绍" value="${escape(draft.title)}"></label><div class="knowledge-form-grid"><label>资料分类<select name="kind" aria-label="资料分类">${knowledgeKinds.map(kind=>`<option${draft.kind===kind?' selected':''}>${kind}</option>`).join('')}</select></label><label>所属品牌<input name="brand" aria-label="所属品牌" maxlength="120" placeholder="选填，例如：你的品牌名" value="${escape(draft.brand)}"></label></div><div class="knowledge-form-grid"><label>相关产品<input name="productName" aria-label="相关产品" maxlength="120" placeholder="选填，例如：玉露香梨" value="${escape(draft.productName)}"></label><label>关键词<input name="tags" aria-label="关键词" maxlength="320" placeholder="选填，用逗号分开" value="${escape(draft.tags)}"></label></div><label>资料正文 <span>必填</span><textarea name="content" aria-label="资料正文" required maxlength="20000" rows="10" placeholder="粘贴品牌故事、产品介绍、规格、真实卖点，或需要参考的文章……">${escape(draft.content)}</textarea></label><div class="knowledge-body-meta"><span id="knowledge-count">${draft.content.length} / 20,000 字</span><label class="knowledge-file-label">${icon('download',12)}导入 TXT / Markdown<input type="file" id="knowledge-text-file" accept=".txt,.md,text/plain,text/markdown" hidden></label></div><label>资料来源<input name="source" aria-label="资料来源" maxlength="400" placeholder="选填，例如：产品包装说明、官网链接、企业介绍" value="${escape(draft.source)}"></label><div class="knowledge-options"><label><input type="checkbox" name="verified" ${draft.verified?'checked':''}><span>我已核实这份资料中的事实<small>未勾选时仍可保存，生成时会提示待核实。</small></span></label><label><input type="checkbox" name="autoReference" ${draft.autoReference?'checked':''}><span>允许创作时自动参考<small>只在与当前品牌、产品或写作需求相关时参考。</small></span></label></div><p id="knowledge-form-status" class="knowledge-form-status" role="status">编辑草稿暂存在当前浏览器；点击保存后同步到你的知识库。</p><div class="knowledge-form-actions"><button type="submit" class="primary-small" id="knowledge-save">保存资料</button><button type="button" class="small-action" data-action="knowledge">返回知识库</button>${row?`<button type="button" class="small-action knowledge-archive" data-knowledge-archive="${escape(draft.id)}">${row.archived?'恢复到知识库':'归档资料'}</button>`:''}</div></form>`);
    $('#dialogue-overlay .sheet').classList.add('knowledge-sheet');
    $('#knowledge-form').addEventListener('input',rememberKnowledgeDraft);
    $('#knowledge-form').addEventListener('change',event=>{if(event.target.id!=='knowledge-text-file')rememberKnowledgeDraft();});
    $('#knowledge-form').addEventListener('submit',event=>{event.preventDefault();void saveKnowledge();});
    $('#knowledge-text-file').addEventListener('change',event=>void importKnowledgeText(event.target.files?.[0]));
  }
  async function importKnowledgeText(file){
    if(!file)return;const form=$('#knowledge-form');if(!form)return;
    try{if(!/\.(txt|md)$/i.test(file.name)||file.size>100000)throw Error('请选择不超过 100 KB 的 TXT 或 Markdown 文本');const content=(await file.text()).replace(/^\uFEFF/,'');if(content.length>20000)throw Error('资料正文请控制在 20,000 字以内');if(content.includes('\u0000'))throw Error('文件不是可读取的纯文本，请直接粘贴正文');if(form.elements.content.value.trim()&&!confirm('导入会替换这次编辑中的正文，是否继续？'))return;form.elements.content.value=content;if(!form.elements.title.value.trim())form.elements.title.value=file.name.replace(/\.(txt|md)$/i,'').slice(0,120);rememberKnowledgeDraft();toast('文本已读入，核对后点击保存资料');}catch(error){toast(error.message||'未能读取文件，请粘贴正文');}finally{if($('#knowledge-text-file'))$('#knowledge-text-file').value='';}
  }
  async function saveKnowledge(){
    if(knowledgeSaving||!knowledgeCanEdit())return;const form=$('#knowledge-form');if(!form)return;
    rememberKnowledgeDraft();const draft=knowledgeDraft,title=draft.title.trim(),content=draft.content.trim(),status=$('#knowledge-form-status');
    if(!title||!content||title.length>120||content.length>20000){status.textContent='请填写标题和正文，正文不超过 20,000 字。';status.classList.add('is-error');return;}
    const next=structuredClone(state);let index=next.knowledge.findIndex(row=>row.id===draft.id);if(index<0&&Number.isInteger(draft.originalIndex)){const original=next.knowledge[draft.originalIndex];if(!draft.originalRecord||!original||original.id||JSON.stringify(original)!==draft.originalRecord){status.textContent='原资料已发生变化，草稿仍保留。请先复制正文，再打开最新资料核对后编辑。';status.classList.add('is-error');return;}index=draft.originalIndex;}if(index>=0&&draft.originalRecord&&JSON.stringify(next.knowledge[index])!==draft.originalRecord){status.textContent='这份资料在你保存草稿后发生了变化。请先复制正文，再打开最新资料核对后编辑。';status.classList.add('is-error');return;}
    if(index<0&&next.knowledge.length>=500){status.textContent='知识库已达到 500 篇，请先整理已有资料。';return;}
    const previous=index>=0?next.knowledge[index]:{};
    const row={...previous,id:draft.id,title,content,kind:draft.kind,brand:draft.brand.trim(),productName:draft.productName.trim(),productId:state.products.find(product=>typeof product.name==='string'&&product.name===draft.productName.trim())?.id||'',tags:draft.tags.split(/[,，、\n]/).map(x=>x.trim()).filter(Boolean).slice(0,8).map(x=>x.slice(0,40)),source:draft.source.trim(),verified:draft.verified,autoReference:draft.autoReference,enabled:draft.autoReference,archived:previous.archived===true,createdAt:previous.createdAt||now(),updatedAt:now()};
    if(index>=0)next.knowledge[index]=row;else next.knowledge.unshift(row);
    if(!persist(next)){status.textContent='尚未保存，编辑内容已保留。请检查页面顶部提示。';status.classList.add('is-error');return;}
    knowledgeDraft={...draft,originalRecord:JSON.stringify(row),originalIndex:index>=0?index:0};try{window.zdxStorage.session.setItem(knowledgeDraftKey,JSON.stringify(knowledgeDraft));}catch{}
    knowledgeSaving=true;for(const field of form.elements)field.disabled=true;status.classList.remove('is-error');status.textContent='已暂存，正在保存到你的知识库…';
    try{await window.zdxStorage.sync.flush();const sync=window.zdxStorage.sync.status();if(sync.dirty||sync.phase!=='saved')throw Error('资料已暂存在本机，尚未确认服务器保存。请按页面顶部提示重试同步。');clearKnowledgeDraft();openKnowledge();toast('资料已保存，可在相关创作中自动参考');}catch(error){if(status.isConnected){status.textContent=error.message||'资料已暂存，请检查页面顶部同步状态。';status.classList.add('is-error');}}finally{knowledgeSaving=false;if(form.isConnected)for(const field of form.elements)field.disabled=false;}
  }
  async function archiveKnowledge(id){
    if(knowledgeSaving||!knowledgeCanEdit())return;
    const row=state.knowledge.find(item=>item.id===id);if(!row){toast('请先保存这份资料，再归档');return;}
    if(knowledgeDraft?.dirty){toast('请先保存当前编辑，再归档或恢复资料');return;}
    const next=structuredClone(state),target=next.knowledge.find(item=>item.id===id);target.archived=!target.archived;target.updatedAt=now();if(!persist(next))return;
    knowledgeSaving=true;const form=$('#knowledge-form');if(form)for(const field of form.elements)field.disabled=true;const status=$('#knowledge-form-status');if(status)status.textContent='正在同步资料状态…';
    try{await window.zdxStorage.sync.flush();const sync=window.zdxStorage.sync.status();if(sync.dirty||sync.phase!=='saved')throw Error('状态已暂存，等待同步。请检查页面顶部提示。');clearKnowledgeDraft();openKnowledge();toast(target.archived?'已归档，不再用于自动参考；可在“查看已归档”中恢复':'已恢复到知识库');}catch(error){clearKnowledgeDraft();openKnowledge();toast(error.message);}finally{knowledgeSaving=false;if(form?.isConnected)for(const field of form.elements)field.disabled=false;}
  }

  function openShelf(){
    openSheet('资料与作品',`<p class="sheet-intro">${owner?'当前账号的资料，和对话共用同一份工作区。':'这里展示当前访客的本机资料。登录后请在正确账号导入备份。'}</p><input class="sheet-search" id="shelf-search" placeholder="搜索农品、文案、知识或发布计划" aria-label="搜索资料与作品"><div class="shelf-tabs"><button class="shelf-tab ${!shelfFilter?'active':''}" data-shelf="">全部</button>${Object.entries({...D.collections,media:'图片与视频'}).map(([key,label])=>`<button class="shelf-tab ${shelfFilter===key?'active':''}" data-shelf="${key}">${label}</button>`).join('')}</div><div class="sheet-records" id="shelf-records"></div><div class="message-actions"><button class="small-action" data-action="export">${icon('download',12)}导出全部资料</button><button class="small-action" data-action="import">导入备份</button><a class="small-action" href="classic.html">更多管理 ↗</a></div>`);renderShelf();$('#shelf-search').addEventListener('input',renderShelf);
  }
  function renderShelf(){const target=$('#shelf-records');if(!target)return;const query=$('#shelf-search')?.value.trim().toLowerCase()||'';const rows=allRecords().filter(row=>(!shelfFilter||row.collection===shelfFilter)&&(!query||(row.title+row.body).toLowerCase().includes(query)));target.innerHTML=rows.length?rows.slice(0,60).map(row=>`<article class="result-card"><span class="result-label">${escape(row.label)}</span><h3>${escape(row.title)}</h3><p>${escape(row.body.slice(0,180))}</p><div class="message-actions"><button class="small-action" data-record="${escape(row.id)}" data-collection="${row.collection}">查看完整资料</button>${row.collection==='products'?`<button class="small-action" data-product="${escape(row.id)}">用它创作</button>`:row.collection==='drafts'?`<button class="small-action" data-plan-draft="${escape(row.id)}">安排发布</button>`:''}</div></article>`).join(''):'<p class="sheet-intro">这里还没有对应资料。可以直接对我说“新增农品：……”来开始。</p>';}
  function showRecord(collection,id){if(collection==='knowledge'){const index=state.knowledge.findIndex(row=>String(row.id)===id);if(index>=0)openKnowledgeEditor(index);else toast('这条知识库资料已变化，请重新打开知识库');return;}if(collection==='regional'){const row=regionalKnowledge.find(row=>row.id===id);if(!row)return;openSheet(row.title,`<p class="sheet-intro">${escape(row.sourceType)} · ${escape(row.published)}<br>整理日期：${escape(row.reviewed)}</p><h3>公开资料摘要</h3><p class="message-text">${escape(row.facts)}</p><h3>表达建议与核对项</h3><p class="message-text">${escape(row.application)}</p><div class="message-actions">${referenceLinks([{title:row.sourceTitle,url:row.url,published:row.published}])}</div>`);return;}const record=allRecords().find(row=>row.collection===collection&&String(row.id)===id);if(!record){toast('这条资料已变化，请重新查询');return;}
    if(collection==='media'){openSheet(record.label,mediaMarkup(record.row));return;}
    const labels={name:'名称',title:'标题',category:'品类',origin:'产地',abv:'规格',supplier:'供货主体',shelfLife:'保质期与保存',summary:'介绍',sellingPoints:'已确认卖点',occasions:'使用场景',body:'内容',content:'资料正文',date:'日期',channel:'渠道',status:'状态',quantity:'数量',amount:'实收金额',unit:'单位',threshold:'库存提醒线',price:'参考价格',goal:'目标',note:'备注',source:'来源',verified:'已核实',positioning:'定位',personality:'表达风格',audience:'目标受众',shopName:'店铺名称',city:'经营城市',province:'地区',tier:'参与路径',name:'名称'};
    openSheet(record.title,`<span class="result-label">${escape(record.label)}</span><dl class="detail-fields">${Object.entries(record.row).filter(([key,value])=>labels[key]&&value!==''&&value!==null&&value!==undefined).map(([key,value])=>`<div class="detail-field"><dt>${labels[key]}</dt><dd>${escape(typeof value==='boolean'?value?'是':'待核实':typeof value==='object'?JSON.stringify(value):value)}</dd></div>`).join('')}</dl>${collection==='products'?`<button class="primary-small" data-product="${escape(id)}">带着这份资料写内容</button>`:''}`);
  }
  function exportBackup(){const bundle={format:'zidingxiang-demo-v1',exportedAt:now(),workspace:state,profile,leads};const url=URL.createObjectURL(new Blob([JSON.stringify(bundle,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download=`紫丁香工作资料-${D.day('今天')}.json`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  async function importBackup(file){if(!file)return;if(file.size>5*1024*1024){toast('请选择不超过 5 MB 的资料备份');return;}
    try{const backup=JSON.parse(await file.text()),raw=backup.workspace||backup;if(!raw||!['products','drafts','plans','campaigns'].every(key=>Array.isArray(raw[key])))throw Error('这不是有效的紫丁香工作区备份');if(!confirm('导入会替换当前工作区，登录后也会更新服务器。请先导出现有资料，确认继续吗？'))return;const next=D.normalize(raw);const values={[KEY]:JSON.stringify(next)};if(backup.format==='zidingxiang-demo-v1'){values['zidingxiang-opc-profile-v1']=backup.profile?JSON.stringify(backup.profile):null;values['zidingxiang-opc-leads-v1']=JSON.stringify(Array.isArray(backup.leads)?backup.leads:[]);}window.zdxStorage.importWorkspace(values);lastSavedRaw=window.zdxStorage.local.getItem(KEY);state=next;profile=parse('zidingxiang-opc-profile-v1',{});leads=parse('zidingxiang-opc-leads-v1',[]);currentId=null;closeSheet();render();toast('资料已导入，服务器同步状态见页面顶部');}catch(error){toast(error.message||'导入未完成，原资料仍已保留');}}
  function template(message){const thread=active(),task=tasks.find(task=>task.id===message.templateTask);if(!task)return;const product=state.products.find(row=>row.id===message.productId);const facts=product?[`农品：${product.name}`,product.origin&&`产地：${product.origin}`,product.abv&&`规格：${product.abv}`,product.summary&&`商品介绍：${product.summary}`,product.sellingPoints&&`已录入卖点：${product.sellingPoints}`].filter(Boolean).join('\n'):'';const body=`【${task.name} · 待办需求】\n\n你想做的事\n${message.original}\n\n${facts?'已有农品资料\n'+facts+'\n\n':''}这次只记下需求，尚未调用模型生成内容。服务恢复后可以接着完成。`;response(thread,{text:body,source:'待办需求 · 未调用模型',artifact:{title:task.name+' · '+(product?.name||message.original.slice(0,28)),taskId:task.id,productId:product?.id||'',channel:channelFor(task.id)}});}
  async function refreshJob(id){try{const r=await fetch('/api/media/jobs?id='+encodeURIComponent(id),{cache:'no-store'});const data=await r.json();if(!r.ok)throw Error(data.error||'暂时无法读取任务');const message=active()?.messages.find(message=>message.mediaJob?.id===id);const job=data.job||data;if(media){media.jobs=(media.jobs||[]).map(item=>item.id===id?job:item);}if(message){message.mediaJob=job;persist();}if($('#dialogue-overlay'))showRecord('media',id);else render();}catch(error){toast(error.message);}}
  document.addEventListener('click',event=>{
    const accountMenu=$('.account-menu[open]');if(accountMenu&&!accountMenu.contains(event.target))accountMenu.open=false;
    const button=event.target.closest('[data-action],[data-prompt],[data-thread],[data-task],[data-shelf],[data-record],[data-product],[data-confirm],[data-save-message],[data-office-message],[data-copy-message],[data-revise],[data-template],[data-plan-draft],[data-refresh-job],[data-starter-task],[data-creative-mode],[data-media-scene],[data-media-handoff],[data-knowledge-filter],[data-knowledge-index],[data-knowledge-view],[data-knowledge-archive]');if(!button)return;
    if(button.hasAttribute('data-knowledge-filter')){knowledgeFilter=button.dataset.knowledgeFilter;document.querySelectorAll('[data-knowledge-filter]').forEach(item=>{const selected=item.dataset.knowledgeFilter===knowledgeFilter;item.classList.toggle('active',selected);item.setAttribute('aria-pressed',String(selected));});renderKnowledge();return;}
    if(button.hasAttribute('data-knowledge-index')){openKnowledgeEditor(Number(button.dataset.knowledgeIndex));return;}
    if(button.hasAttribute('data-knowledge-view')){const index=state.knowledge.findIndex(row=>row.id===button.dataset.knowledgeView);if(index>=0)openKnowledgeEditor(index);else toast('这条参考资料已变化，可到知识库查看当前版本');return;}
    if(button.dataset.knowledgeArchive){void archiveKnowledge(button.dataset.knowledgeArchive);return;}
    if(button.dataset.creativeMode){if(busy){toast('请先等待本次回答，或点击停止');return;}creativeMode=button.dataset.creativeMode;taskId='general';currentId=null;render();return;}
    if(button.dataset.mediaScene){void openMediaStudio(button.dataset.mediaType,button.dataset.mediaScene,$('#question')?.value||'');return;}
    if(button.dataset.mediaHandoff){const message=active()?.messages.find(item=>item.id===button.dataset.mediaHandoff);if(message?.mediaHandoff)void openMediaStudio(message.mediaHandoff.capability,message.mediaHandoff.scene,message.mediaHandoff.prompt);return;}
    if(button.dataset.starterTask){startTask(button.dataset.starterTask);return;}
    if(button.dataset.action){const action=button.dataset.action;if(action==='activation'){$('.account-menu')?.removeAttribute('open');$('.sidebar')?.classList.remove('is-open');$('.mobile-backdrop')?.classList.remove('is-open');window.ZdxEventAccess?.open();return;}if(action==='new')startThread();else if(action==='credits'){$('.sidebar')?.classList.remove('is-open');$('.mobile-backdrop')?.classList.remove('is-open');void creditPanel.open();return;}
    if(action==='knowledge')openKnowledge();else if(action==='knowledge-new')openKnowledgeEditor();else if(action==='knowledge-resume')openKnowledgeEditor(null,true);else if(action==='knowledge-discard'){if(confirm('放弃这份尚未提交的编辑草稿？已保存的知识库资料不会受影响。')){clearKnowledgeDraft();openKnowledge();}}else if(action==='github')openWorkMethods();else if(action==='tools')openTools();else if(action==='shelf')openShelf();else if(action==='regional')showRegional();else if(action==='sheet-close')closeSheet();else if(action==='menu'){$('.sidebar')?.classList.add('is-open');$('.mobile-backdrop')?.classList.add('is-open');}else if(action==='menu-close'){$('.sidebar')?.classList.remove('is-open');$('.mobile-backdrop')?.classList.remove('is-open');}else if(action==='about')void send('介绍紫丁香计划，你能帮我做什么？');else if(action==='stop')controller?.abort();else if(action==='export')exportBackup();else if(action==='import')$('#backup-file').click();return;}
    if(button.dataset.prompt){void send(button.dataset.prompt);return;}
    if(button.dataset.thread){if(busy){toast('请先等待本次回答或点击停止');return;}currentId=button.dataset.thread;taskId='general';creativeMode=null;render();return;}
    if(button.dataset.task){startTask(button.dataset.task);return;}
    if(button.hasAttribute('data-shelf')){shelfFilter=button.dataset.shelf;openShelf();return;}
    if(button.dataset.record){showRecord(button.dataset.collection,button.dataset.record);return;}
    if(button.dataset.product){const product=state.products.find(row=>row.id===button.dataset.product);if(!product)return;closeSheet();taskId='moments';if(active())active().productId=product.id;$('#selected-tool').textContent='朋友圈文案';$('#question').value=`给${product.name}写一条朋友圈文案`;$('#question').focus();return;}
    if(button.dataset.planDraft){const draft=state.drafts.find(row=>row.id===button.dataset.planDraft);if(!draft)return;closeSheet();taskId='general';if(active())active().selectedDraftId=draft.id;$('#selected-tool').textContent='自动判断';$('#question').value=`安排明天发布「${draft.title}」`;$('#question').focus();return;}
    if(button.dataset.confirm){void confirmProposal(button.dataset.confirm);return;}
    if(button.dataset.refreshJob){void refreshJob(button.dataset.refreshJob);return;}
    if(button.dataset.retryMessage){const message=active()?.messages.find(item=>item.id===button.dataset.retryMessage);if(message?.retry)void send(message.retry.question,message.retry);return;}
    if(button.dataset.retryMedia){void fetch('/api/media/jobs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({capability:button.dataset.mediaCapability||'image',modelId:null,prompt:button.dataset.mediaPrompt||'',consent:true,idempotencyKey:crypto.randomUUID().replace(/-/g,'')+crypto.randomUUID().replace(/-/g,'').slice(0,8)})}).then(async response=>{const body=await response.json();if(!response.ok)throw Error(body.error||'没有重新提交');toast(body.job?.status==='failed'?'重新生成没有成功，次数已退回':'已重新提交，成功后才会扣次数');void refreshJob(body.job.id);}).catch(error=>toast(error.message));return;}
    const id=button.dataset.saveMessage||button.dataset.officeMessage||button.dataset.copyMessage||button.dataset.revise||button.dataset.template;
    const message=active()?.messages.find(item=>item.id===id);if(!message)return;
    if(button.dataset.saveMessage)proposeSave(active(),message,'drafts');else if(button.dataset.officeMessage)proposeSave(active(),message,'office');else if(button.dataset.copyMessage)navigator.clipboard.writeText(message.text).then(()=>toast('回答已复制')).catch(()=>toast('未能复制，请手动选中文字'));else if(button.dataset.revise){taskId=message.artifact?.taskId||'general';$('#question').value='把刚才这份内容改成：';$('#question').focus();}else if(button.dataset.template)template(message);
  });
  document.addEventListener('keydown',event=>{const accountMenu=$('.account-menu[open]');if(event.key==='Escape'&&accountMenu){accountMenu.open=false;accountMenu.querySelector('summary')?.focus();event.preventDefault();return;}const overlay=$('#dialogue-overlay');if(!overlay)return;if(event.key==='Escape'){closeSheet();return;}if(event.key==='Tab'){const nodes=[...overlay.querySelectorAll('a[href],button:not([disabled]),input:not([hidden]),textarea,select,[tabindex="0"]')];if(!nodes.length)return;const first=nodes[0],last=nodes[nodes.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}});
  async function refreshCredits(){try{await creditPanel.refresh();}catch{textCredits=null;}}
  async function initialize(){
    if(window.ZdxEventAccess)await window.ZdxEventAccess.ready;
    render();
    try{const r=await fetch('dialogue-tools.json',{cache:'no-store'});if(r.ok)tasks=await r.json();}catch{}
    try{const r=await fetch('/api/me',{cache:'no-store'});if(r.ok)owner=(await r.json()).user;}catch{}
    try{const r=await fetch('/api/dialogue',{cache:'no-store'});if(r.ok){const value=await r.json();connected=!!value.connected;modelReason=value.reason||'';}}catch{}
    try{const r=await fetch('shanxi-knowledge.json',{cache:'no-store'});if(r.ok)regionalKnowledge=await r.json();}catch{}
    if(owner)try{const r=await fetch('/api/media/jobs',{cache:'no-store'});if(r.ok)media=await r.json();}catch{}
    await refreshCredits();render();
    void pollPendingMedia();
    const params=new URLSearchParams(location.search);
    const selectedPlan=params.get('plan');if(selectedPlan)creditPanel.open(selectedPlan);
    const selectedScene=params.get('scene');if(selectedScene&&tasks.some(task=>task.id===selectedScene))startTask(selectedScene);
    const question=params.get('q');if(question){$('#question').value=question.slice(0,6000);$('#question').focus();}
  }
  async function pollPendingMedia(){
    if(pollingMedia||!owner||document.visibilityState==='hidden'||busy)return;
    const live=job=>['submitting','queued','running','saving','unknown'].includes(job.status);
    const fresh=job=>live(job)&&Date.now()-Date.parse(job.createdAt||'')<60000;
    const known=[...(media?.jobs||[]),...state.conversations.flatMap(thread=>thread.messages.map(message=>message.mediaJob).filter(Boolean))];
    fastMediaPoll=known.some(fresh);
    const pending=new Set(known.filter(live).map(job=>job.id));
    if(!pending.size)return;
    pollingMedia=true;
    try{
      const expected=owner.id,check=await fetch('/api/me',{cache:'no-store'}),identity=check.ok?await check.json():null;
      if(identity?.user?.id!==expected){await window.zdxStorage.refreshIdentity();return;}
      const results=await Promise.allSettled([...pending].slice(0,12).map(async id=>{const response=await fetch('/api/media/jobs?id='+encodeURIComponent(id),{cache:'no-store',signal:AbortSignal.timeout(60000)});if(!response.ok)return null;return (await response.json()).job;}));
      const confirm=await fetch('/api/me',{cache:'no-store'}),confirmed=confirm.ok?await confirm.json():null;
      if(confirmed?.user?.id!==expected){await window.zdxStorage.refreshIdentity();return;}
      let updated=false;
      for(const result of results){if(result.status!=='fulfilled'||!result.value)continue;const job=result.value;
        if(media){const index=media.jobs.findIndex(item=>item.id===job.id);if(index<0||JSON.stringify(media.jobs[index])!==JSON.stringify(job))updated=true;if(index>=0)media.jobs[index]=job;else media.jobs.push(job);}
        for(const thread of state.conversations)for(const message of thread.messages)if(message.mediaJob?.id===job.id&&JSON.stringify(message.mediaJob)!==JSON.stringify(job)){message.mediaJob=job;updated=true;}
      }
      if(updated){persist();renderMessages();renderShelf();await refreshCredits();}
    }catch{/* Existing tasks remain on the server; the next status read resumes them. */}
    finally{pollingMedia=false;}
  }
  let fastMediaPoll=true;
  (function scheduleMediaPoll(){setTimeout(()=>{void pollPendingMedia();scheduleMediaPoll();},fastMediaPoll?2000:8000);})();
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){void refreshCredits();void pollPendingMedia();}});
  window.addEventListener('focus',()=>void refreshCredits());
  void initialize();
})();
