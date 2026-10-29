(async () => {
  const id = new URLSearchParams(location.search).get('id');
  const title = document.querySelector('#article-title');
  if (!id) { title.textContent = '文章编号缺失'; return; }
  try {
    const response = await fetch('/api/content', { cache:'no-store' });
    if (!response.ok) throw new Error('内容暂时无法读取');
    const data = await response.json();
    const article = (data.articles || []).find(item => item.id === id);
    if (!article) throw new Error('这篇文章还未发布或已下线');
    title.textContent = article.title;
    document.title = `${article.title} · 紫丁香计划`;
    document.querySelector('#article-meta').textContent = `${article.type === 'guide' ? 'AI 新农人课程' : article.type === 'document' ? '文档资料' : '行动文章'} / ${String(article.publishedAt || '').slice(0,10)}`;
    document.querySelector('#article-summary').textContent = article.summary || '';
    if (article.coverUrl?.startsWith('/media/')) { const image = document.querySelector('#article-cover'); image.src = article.coverUrl; image.hidden = false; }
    const body = document.querySelector('#article-body');
    for (const paragraph of String(article.body || '').split(/\n\s*\n/).filter(Boolean)) { const p = document.createElement('p'); p.textContent = paragraph; body.append(p); }
    if (article.sourceUrl) { const link = document.createElement('a'); link.href = article.sourceUrl; link.rel = 'noopener noreferrer'; link.textContent = article.type === 'document' ? '查看文档 ↗' : '查看资料来源 ↗'; document.querySelector('#article-source').append(link); }
  } catch(error) { title.textContent = error.message || '文章暂时无法打开'; }
})();
