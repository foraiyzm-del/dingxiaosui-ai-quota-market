/* 管理后台发布的内容只在服务端保存；静态演示版保留原页面。 */
(async () => {
  let data;
  try {
    const response = await fetch('/api/content', { cache: 'no-store' });
    if (!response.ok) return;
    data = await response.json();
  } catch { return; }
  const settings = data?.settings || {};
  const first = selector => document.querySelector(selector);
  const setText = (selector, value) => { const node = first(selector); if (node && value) node.textContent = value; };
  if (settings.hero_title) setText('#hero-title', settings.hero_title);
  setText('.hero .hero-copy>p', settings.hero_description);
  setText('#mission .mission-lead>p', settings.mission_text);
  setText('#opc .opc-intro>p', settings.opc_message);
  if (settings.hero_image && settings.hero_image.startsWith('/media/')) {
    const visual = first('.hero-visual');
    if (visual) visual.style.backgroundImage = `linear-gradient(90deg,#1a111eea 0%,#241527c9 26%,#311e3590 46%,#2a183222 72%),url(${JSON.stringify(settings.hero_image)})`;
  }
  if (settings.logo_image && settings.logo_image.startsWith('/media/')) {
    document.querySelectorAll('.institute-logo-frame img,.news-logo-card img').forEach(image => { image.src = settings.logo_image; });
  }
  const articles = Array.isArray(data.articles) ? data.articles : [];
  const newsGrid = first('.news-grid');
  const guideGrid = first('#guide-grid');
  for (const item of articles) {
    const href = `/article.html?id=${encodeURIComponent(item.id)}`;
    if (item.type === 'news' && newsGrid) {
      const card = document.createElement('article'); card.className = 'news-card';
      const date = document.createElement('span'); date.textContent = `${String(item.publishedAt || '').slice(0,10)} / 紫丁香计划`;
      const title = document.createElement('h3'); title.textContent = item.title;
      const summary = document.createElement('p'); summary.textContent = item.summary || String(item.body).slice(0,100);
      const link = document.createElement('a'); link.href = href; link.textContent = '阅读文章 ↗';
      card.append(date,title,summary,link); newsGrid.prepend(card);
    }
    if (['guide','document'].includes(item.type) && guideGrid) {
      const card = document.createElement('article'); card.className = 'guide-card';
      const top = document.createElement('div'); top.className = 'guide-card-top'; top.textContent = item.type === 'guide' ? 'AI 新农人课程 / 新增' : '文档资料 / 新增';
      const title = document.createElement('h3'); title.textContent = item.title;
      const summary = document.createElement('p'); summary.textContent = item.summary || String(item.body).slice(0,100);
      const link = document.createElement('a'); link.href = href; link.textContent = '阅读全文 ↗'; link.style.color = '#81558e';
      card.append(top,title,summary,link); guideGrid.prepend(card);
    }
  }
})();
