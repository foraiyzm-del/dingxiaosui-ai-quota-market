// 首页保留核心路径，深度内容折叠在原有锚点内。
(() => {
  const main = document.querySelector('main#top');
  let after = document.querySelector('.enterprise-loop');
  for (const selector of ['#salon','#calendar','#cases','#map','#news','#opc','.tiers-section','#mission','#lilac-ip','#city-lab','#pain','#enterprise']) {
    const section = main?.querySelector(selector);
    if (!section || !after) continue;
    after.insertAdjacentElement('afterend', section);
    after = section;
  }
  const primary = document.querySelector('.hero-cta .cta-main');
  if (primary) { primary.href='workbench.html?view=agent'; primary.innerHTML='体验经营智能体 <span>↗</span>'; }
  const homeIntro = document.querySelector('.enterprise-loop-intro p');
  if (homeIntro) homeIntro.textContent='从真实商品资料出发，定账号 IP、安排短视频与直播，再把客户咨询和经营复盘接回工作台。';
  const sections = [
    ['#news','行动纪实 · 新闻','读真实报道与阶段进展','报道与原文'],
    ['#city-lab','城市打法','选城市和品类，生成起步建议','打开工具'],
    ['#pain','为什么要做','生产、内容、节奏和个人经营的四个问题','查看方法'],
    ['#cases','晋品线索','看公开资料中的产区与品类方向','查看线索'],
    ['#calendar','营销日历','按月份规划选品、拍摄与客户沟通','打开日历'],
    ['#lilac-ip','认识丁小穗','毛茸茸的紫丁香农品向导，看看她的设计故事','认识 IP'],
    ['#salon','紫丁香会客厅','线上 OPC 小店与约 48㎡ 线下会客空间','看门头与空间'],
    ['#enterprise','三种合作方式','OPC 主理人、农品品牌与企业定制','查看合作路径'],
    ['.tiers-section','OPC 成长路径','从启航到伙伴，选择适合的起点','查看路径'],
  ];
  for (const [selector,title,sub,action] of sections) {
    const section = document.querySelector(selector); if (!section) continue;
    const details = document.createElement('details'); details.className='home-fold';
    const summary = document.createElement('summary');
    summary.innerHTML=`<span class="home-fold-glyph" aria-hidden="true">✦</span><span class="home-fold-copy"><b>${title}</b><small>${sub}</small></span><em>${action} ↗</em>`;
    while (section.firstChild) details.append(section.firstChild);
    details.prepend(summary); section.append(details); section.dataset.compact='true';
    if (section.id && location.hash === `#${section.id}`) details.open=true;
  }
  const openHash = () => {
    if (!location.hash) return;
    const section = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    section?.querySelector(':scope > details.home-fold')?.setAttribute('open','');
  };
  addEventListener('hashchange',openHash);
})();
