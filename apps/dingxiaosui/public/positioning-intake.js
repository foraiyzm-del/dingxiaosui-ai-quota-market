// 一分钟账号定位：只收集店铺、性格；农品和顾客场景可选。结果随账号工作区保存，访客资料仅在本机。
(() => {
  const targetViews = new Set(['studio', 'media']);
  const existingShop = (() => {
    try { return JSON.parse(window.zdxStorage.local.getItem('zidingxiang-opc-profile-v1') || '{}')?.shopName || ''; }
    catch { return ''; }
  })();
  const suggestedProduce = () => state.products.find(item => item.id !== 'demo-product')?.name || '';
  const safe = (value, max = 80) => String(value || '').trim().slice(0, max);

  document.body.insertAdjacentHTML('beforeend', `
    <dialog id="positioning-intake" class="positioning-intake" aria-labelledby="positioning-intake-title">
      <div class="positioning-shell">
        <aside class="positioning-story"><span class="positioning-overline">ZIDINGXIANG / 60 SECOND BRAND IP</span><img src="ding-xiaosui-fluffy.webp" alt="丁小穗陪你完成账号定位"><div><small>丁小穗的第一张创作卡</small><strong>先让大家<br>记住你是谁。</strong><p>好内容从真实的店、真实的人和真实的农品开始。</p></div><span class="positioning-story-foot">01 店铺 · 02 性格 · 03 定位</span></aside>
        <div class="positioning-main"><button class="positioning-close" type="button" aria-label="稍后填写定位">×</button><span class="positioning-kicker">一分钟完成 · 随时可修改</span><h2 id="positioning-intake-title">你的店，有自己的表达方式。</h2><p class="positioning-intro">填店铺名称和你的性格，丁小穗会给你一条账号定位、三个固定栏目和第一条选题。主营农品与顾客场景可选填。</p>
          <form id="positioning-intake-form"><label>你的店铺或账号叫什么 <em>*</em><input name="shopName" maxlength="40" required placeholder="例如：小林的山西好物铺" autocomplete="organization"></label><label>你在镜头前是什么性格 <em>*</em><input name="personality" maxlength="60" required placeholder="例如：朴实、爱讲故事、说话直接"></label><div class="positioning-chips" aria-label="性格快捷选择"><button type="button" data-personality="朴实真诚">朴实真诚</button><button type="button" data-personality="热情直爽">热情直爽</button><button type="button" data-personality="细致专业">细致专业</button><button type="button" data-personality="幽默亲切">幽默亲切</button></div><div class="positioning-field-row"><label>主营农品（可选）<input name="mainProduce" maxlength="60" placeholder="例如：山西杂粮"></label><label>主要想讲给谁听<select name="audience"><option>想了解山西好物的人</option><option>家庭餐桌采购者</option><option>想选伴手礼的人</option><option>同城到店顾客</option><option>企业采购者</option></select></label></div><button class="positioning-generate" type="submit">生成我的账号定位 <span>↗</span></button><small class="positioning-hint">生成可编辑的定位初稿；商品事实、素材授权与实际经营能力仍需你核实。</small></form>
          <div id="positioning-intake-result" class="positioning-result" hidden></div>
        </div>
      </div>
    </dialog>`);

  const dialog = document.querySelector('#positioning-intake');
  const form = dialog.querySelector('#positioning-intake-form');
  const result = dialog.querySelector('#positioning-intake-result');
  let targetView = 'media';
  const deferredKey = 'zidingxiang-positioning-deferred-v1';
  let deferred = false;
  try { deferred = window.zdxStorage.session.getItem(deferredKey) === '1'; } catch {}

  function defer() {
    deferred = true;
    try { window.zdxStorage.session.setItem(deferredKey, '1'); } catch {}
    dialog.close();
    renderEntry();
  }

  function fillForm() {
    const profile = state.mediaProfile || {};
    form.elements.shopName.value = profile.shopName || existingShop;
    form.elements.personality.value = profile.personality || '';
    form.elements.mainProduce.value = profile.mainProduce || suggestedProduce();
    const audience = profile.audience || '想了解山西好物的人';
    form.elements.audience.querySelector('option[data-custom]')?.remove();
    if (![...form.elements.audience.options].some(option => option.value === audience)) {
      form.elements.audience.add(new Option(audience, audience));
      form.elements.audience.lastElementChild.dataset.custom = '1';
    }
    form.elements.audience.value = audience;
    dialog.querySelectorAll('[data-personality]').forEach(button => button.classList.toggle('selected', button.dataset.personality === form.elements.personality.value));
  }
  function show(view = activeView) {
    targetView = targetViews.has(view) ? view : 'media';
    fillForm();
    form.hidden = false;
    result.hidden = true;
    if (!dialog.open) dialog.showModal();
    form.elements.shopName.focus();
  }
  function showIfNeeded(view) {
    if (!targetViews.has(view) || state.mediaProfile?.onboardingComplete || deferred) return;
    show(view);
  }
  function renderEntry() {
    const profile = state.mediaProfile || {};
    const banner = document.querySelector('#studio-positioning-banner');
    if (!banner) return;
    banner.hidden = !profile.onboardingComplete && !deferred;
    if (profile.onboardingComplete) banner.innerHTML = `<span>YOUR CREATOR POSITIONING / 已生成</span><b>${esc(profile.positioning)}</b><button type="button" data-edit-positioning>修改定位 ↗</button>`;
    else if (deferred) banner.innerHTML = '<span>账号定位 · 随时可补充</span><b>先继续创作，需要时再填写你的店铺与表达风格。</b><button type="button" data-edit-positioning>填写账号定位 ↗</button>';
  }
  function positionFrom(data) {
    const produce = data.mainProduce || '山西好物';
    return `「${data.shopName}」：由一位${data.personality}的主理人，给${data.audience}讲清${produce}的真实来历、选择依据和日常用法。`;
  }

  dialog.querySelector('.positioning-close').addEventListener('click', defer);
  dialog.addEventListener('click', event => { if (event.target === dialog) defer(); });
  dialog.addEventListener('cancel', event => { event.preventDefault(); defer(); });
  dialog.querySelectorAll('[data-personality]').forEach(button => button.addEventListener('click', () => {
    form.elements.personality.value = button.dataset.personality;
    dialog.querySelectorAll('[data-personality]').forEach(item => item.classList.toggle('selected', item === button));
  }));
  form.addEventListener('submit', event => {
    event.preventDefault();
    const data = {
      shopName:safe(form.elements.shopName.value, 40),
      personality:safe(form.elements.personality.value, 60),
      mainProduce:safe(form.elements.mainProduce.value, 60),
      audience:safe(form.elements.audience.value, 60)
    };
    if (!data.shopName || !data.personality) return;
    const previous = state.mediaProfile || {};
    state.mediaProfile = {
      ...previous, ...data,
      positioning:positionFrom(data),
      role:previous.role || '品牌主理人',
      traffic:data.audience === '同城到店顾客' ? '同城到店流量' : previous.traffic || '搜索问题流量',
      assets:previous.assets || '店铺日常、真实商品与已获授权的拍摄素材',
      days:previous.days || '3', team:previous.team || '一个人一部手机',
      onboardingComplete:true
    };
    save();
    const advanced = document.querySelector('#media-position-form');
    for (const key of ['audience','role','traffic','assets','days','team']) if (advanced?.elements[key]) advanced.elements[key].value = state.mediaProfile[key];
    const brief = document.querySelector('#brief-form');
    if (brief?.elements.audience && !brief.elements.audience.value.trim()) brief.elements.audience.value = data.audience;
    if (brief?.elements.topic && !brief.elements.topic.value.trim()) brief.elements.topic.value = `${data.shopName}如何讲清${data.mainProduce || '山西好物'}？`;
    const host = document.querySelector('#media-live-form input[name="host"]');
    if (host && !host.value.trim()) host.value = `${data.shopName}主理人`.slice(0,30);
    window.renderMediaStudio?.(); renderEntry();
    result.innerHTML = `<div class="positioning-result-head"><span>YOUR POSITIONING / 定位已生成</span><h3>${esc(state.mediaProfile.positioning)}</h3></div><div class="positioning-result-grid"><div><b>镜头里的你</b><p>${esc(data.personality)}，先用实物和亲身经历回答问题。</p></div><div><b>三个固定栏目</b><p>店里的一天 · 一款农品讲清楚 · 顾客问题现场答</p></div><div><b>第一条就拍</b><p>“我为什么开${esc(data.shopName)}，想把${esc(data.mainProduce || '山西好物')}讲给谁听？”</p></div></div><button type="button" class="positioning-continue">${targetView === 'media' ? '带着定位开始拍摄' : '带着定位开始创作'} <span>↗</span></button>`;
    form.hidden = true;
    result.hidden = false;
    result.querySelector('.positioning-continue').addEventListener('click', () => dialog.close());
    dialog.scrollTop = 0;
    toast('账号定位已保存，短视频、直播和内容简报都能使用');
  });

  document.querySelector('#view-studio .page-heading')?.insertAdjacentHTML('afterend', '<div id="studio-positioning-banner" class="studio-positioning-banner" hidden></div>');
  document.querySelector('#view-media .media-hero-actions')?.insertAdjacentHTML('beforeend', '<button type="button" class="positioning-edit-entry" data-edit-positioning>我的账号定位 ↗</button>');
  document.addEventListener('click', event => { if (event.target.closest('[data-edit-positioning]')) show(activeView); });
  renderEntry();
  window.positioningIntake = { showIfNeeded, show, renderEntry };
  showIfNeeded(activeView);
})();
