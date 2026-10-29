(() => {
  const mission = document.querySelector('#mission');
  if (!mission) return;
  mission.insertAdjacentHTML('afterend', `
    <section id="lilac-ip" class="lilac-ip-section section-wrap" aria-labelledby="lilac-ip-title">
      <div class="lilac-ip-card">
        <div class="lilac-ip-art"><span class="lilac-ip-orbit orbit-one"></span><span class="lilac-ip-orbit orbit-two"></span><img src="ding-xiaosui-fluffy.webp" width="1100" height="1372" alt="丁小穗：毛茸茸的紫丁香花精灵，头顶山西谷穗，背着农品小挎包"><span class="lilac-ip-badge">IP CONCEPT · 01</span></div>
        <div class="lilac-ip-copy"><span class="lilac-ip-kicker">MEET THE LILAC COMPANION / 紫丁香独立 IP 形象提案</span><h2 id="lilac-ip-title">你好，我是<br><em>丁小穗。</em></h2><p>“丁”取自紫丁香，“穗”连着山西的田野与丰收；毛茸茸的丁香花冠、金色谷穗与农品小包，则把山西土地和真实好物带进她的形象。</p><div class="lilac-ip-chips"><span>花瓣绒毛</span><span>山西谷穗</span><span>农品信使</span></div><a class="lilac-ip-maker-link" href="ip-360.html">查看丁小穗 360° 实物打样参考 <span>↗</span></a><div class="lilac-ip-note">名字与形象为本次官网提案，可用于首页、会客厅导视、课程陪伴与包装延展；正式使用前再做商标与形象权利核查。</div></div>
      </div>
    </section>`);

  const opc = document.querySelector('#opc');
  opc.insertAdjacentHTML('beforebegin', `
    <section id="enterprise" class="enterprise-section section-wrap" aria-labelledby="enterprise-title">
      <div class="section-top"><div><div class="section-overline">THREE WAYS TO GROW / 三条合作路径</div><h2 id="enterprise-title">一个平台，<br><em>连接主理人与品牌。</em></h2></div><p>招募 OPC，让真实农品有人讲、有人卖；品牌带着商品和预算入驻；成熟企业也可按自己的品牌使用整套工作台。</p></div>
      <div class="enterprise-grid">
        <article class="enterprise-card"><span>01 / OPC PARTNERS</span><div class="enterprise-glyph">✳</div><h3>招募 OPC</h3><p>面向新农人和个人主理人，提供农品资料、内容创作、线上小店与经营方法。</p><ul><li>课程与创作工具</li><li>农品小店展示</li><li>营销行动与会客厅协作</li></ul><button type="button" data-join>申请成为 OPC <b>↗</b></button></article>
        <article class="enterprise-card featured"><span>02 / BRAND PARTNERS</span><div class="enterprise-glyph">◈</div><h3>品牌入驻</h3><p>农产品品牌提供已核实商品与素材，可按内容、传播活动、培训或渠道服务商谈合作。</p><ul><li>品牌知识库与商品档案</li><li>一鱼多吃的全渠道内容</li><li>会客厅品鉴与活动共创</li></ul><button type="button" data-enterprise="brand">了解品牌合作 <b>↗</b></button></article>
        <article class="enterprise-card"><span>03 / ENTERPRISE EDITION</span><div class="enterprise-glyph">▣</div><h3>企业定制</h3><p>为县域平台、合作社或品牌企业配置专属平台与流程，让团队直接使用整套工作台。</p><ul><li>独立品牌视觉与知识库</li><li>内容、办公与经营模块组合</li><li>账号、权限与数据范围按项目设计</li></ul><button type="button" data-enterprise="custom">申请企业版方案 <b>↗</b></button></article>
      </div><p class="enterprise-footnote">合作模式为方案方向，具体服务、报价、品牌授权和平台交付范围由双方另行确认。</p>
    </section>`);

  document.querySelector('.site-footer>div:nth-child(2)').insertAdjacentHTML('beforeend','<a href="#enterprise">品牌与企业合作</a>');
  document.querySelector('.site-footer>div:nth-child(2)').insertAdjacentHTML('beforeend','<a href="ip-360.html">丁小穗实物打样</a>');

  document.body.insertAdjacentHTML('beforeend', `<dialog class="enterprise-dialog" id="enterprise-dialog" aria-labelledby="enterprise-dialog-title"><div class="enterprise-dialog-shell">
    <div class="enterprise-dialog-top"><span>紫丁香计划 / 企业合作入口</span><button type="button" id="enterprise-close" aria-label="关闭企业合作窗口">×</button></div>
    <div class="enterprise-dialog-intro"><span>BRAND & ENTERPRISE</span><h2 id="enterprise-dialog-title">让你的品牌，拥有自己的增长工作台。</h2><p>选择合作方向，整理一份可讨论的需求简报。</p></div>
    <div class="enterprise-choice" role="group" aria-label="合作方向"><button type="button" data-mode="brand" class="active">品牌入驻<small>商品与传播服务</small></button><button type="button" data-mode="custom">企业定制<small>整套平台与团队使用</small></button></div>
    <form id="enterprise-form" class="enterprise-form"><input type="hidden" name="mode" value="brand"><div class="enterprise-form-row"><label>机构 / 品牌名称 <input name="company" required maxlength="80" placeholder="例如：某某农品品牌"></label><label>联系人称呼 <input name="contact" required maxlength="30" placeholder="例如：张老师"></label></div><div class="enterprise-form-row"><label>关注的产品或县域 <input name="product" maxlength="100" placeholder="例如：沁州黄小米 / 长治"></label><label>预计团队规模 <select name="team"><option>尚未确定</option><option>1—5 人</option><option>6—20 人</option><option>20 人以上</option></select></label></div><label>希望解决的问题 <textarea name="need" required maxlength="1000" rows="4" placeholder="介绍目前的品牌、传播或平台使用需求"></textarea></label><button class="enterprise-submit" type="submit">生成合作简报 <span>↗</span></button><small>当前为本地演示：不会创建企业账号，也不会自动向项目组发送资料。生成后可复制简报用于正式沟通。</small></form>
    <div class="enterprise-result" id="enterprise-result" hidden><b>合作简报已生成</b><p>以下内容只显示在当前页面，请复制后与项目组沟通。</p><pre id="enterprise-summary"></pre><div><button type="button" id="enterprise-copy">复制合作简报</button><button type="button" id="enterprise-again">重新填写</button></div><small id="enterprise-copy-status" role="status"></small></div>
  </div></dialog>`);

  const dialog = document.querySelector('#enterprise-dialog');
  const form = document.querySelector('#enterprise-form');
  const result = document.querySelector('#enterprise-result');
  const choices = [...document.querySelectorAll('.enterprise-choice button')];
  const setMode = mode => {
    form.elements.mode.value = mode;
    choices.forEach(button => button.classList.toggle('active', button.dataset.mode === mode));
    result.hidden = true; form.hidden = false;
  };
  document.addEventListener('click', event => {
    const trigger = event.target.closest('[data-enterprise]');
    if (trigger) { setMode(trigger.dataset.enterprise); dialog.showModal(); }
    const join = event.target.closest('#enterprise [data-join]');
    if (join) document.querySelector('#join-dialog')?.showModal();
  });
  choices.forEach(button => button.addEventListener('click', () => setMode(button.dataset.mode)));
  document.querySelector('#enterprise-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  form.addEventListener('submit', event => {
    event.preventDefault();
    const data = new FormData(form);
    const mode = data.get('mode') === 'custom' ? '企业定制（整套平台使用）' : '品牌入驻（内容与传播合作）';
    const summary = `紫丁香计划合作简报\n合作方向：${mode}\n机构 / 品牌：${data.get('company')}\n联系人：${data.get('contact')}\n产品 / 县域：${data.get('product') || '待沟通'}\n团队规模：${data.get('team')}\n当前需求：${data.get('need')}\n\n说明：此简报由紫丁香计划本地演示页面生成，尚未正式提交。`;
    document.querySelector('#enterprise-summary').textContent = summary;
    form.hidden = true; result.hidden = false;
    document.querySelector('#enterprise-copy-status').textContent = '';
  });
  document.querySelector('#enterprise-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(document.querySelector('#enterprise-summary').textContent); document.querySelector('#enterprise-copy-status').textContent = '已复制，可粘贴给项目组。'; }
    catch { document.querySelector('#enterprise-copy-status').textContent = '请选中上方文字手动复制。'; }
  });
  document.querySelector('#enterprise-again').addEventListener('click', () => { form.hidden = false; result.hidden = true; });
})();
