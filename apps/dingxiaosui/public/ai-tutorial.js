(() => {
  'use strict';
  const steps = [...document.querySelectorAll('.tutorial-step')];
  if (!steps.length) return;
  const chapterLinks = [...document.querySelectorAll('[data-chapter-link]')];
  const progressText = document.querySelector('#tutorial-progress-text');
  const progressCount = document.querySelector('#tutorial-progress-count');
  const progress = document.querySelector('#tutorial-progress-bar');
  const previous = document.querySelector('#tutorial-previous');
  const next = document.querySelector('#tutorial-next');
  const operate = document.querySelector('#tutorial-operate');
  const nextLabel = document.querySelector('#tutorial-next-label');
  const advanced = document.querySelector('#tutorial-advanced-nav');
  const daily = steps.filter(step => step.dataset.audience === 'brand');
  let current = 0;

  function resolveHash(hash = window.location.hash) {
    let name;
    try { name = decodeURIComponent(hash.replace(/^#/, '')); } catch { name = ''; }
    const exact = steps.findIndex(step => step.id === name);
    if (exact >= 0) return exact;
    const chapter = steps.findIndex(step => step.dataset.chapter === name);
    return chapter >= 0 ? chapter : 0;
  }

  function show(index, {focus = false, writeHash = false} = {}) {
    current = Math.max(0, Math.min(steps.length - 1, index));
    const active = steps[current];
    const chapter = active.dataset.chapter;
    const chapterSteps = steps.filter(step => step.dataset.chapter === chapter);
    const chapterIndex = chapterSteps.indexOf(active);
    const dayIndex = daily.indexOf(active);
    steps.forEach(step => { step.hidden = step !== active; });
    chapterLinks.forEach(link => {
      const selected = link.dataset.chapterLink === chapter;
      link.setAttribute('aria-current', selected ? 'true' : 'false');
      const count = link.querySelector('.chapter-progress');
      if (count) count.textContent = selected ? `${chapterIndex + 1} / ${chapterSteps.length}` : `${steps.filter(step => step.dataset.chapter === link.dataset.chapterLink).length} 步`;
    });
    if (active.dataset.audience !== 'brand') advanced.open = true;
    progressText.textContent = `${active.dataset.chapterLabel} · 本章第 ${chapterIndex + 1} / ${chapterSteps.length} 步`;
    progressCount.textContent = dayIndex >= 0 ? `日常教程 ${dayIndex + 1} / ${daily.length}` : '按需阅读 · 非日常必做';
    progress.max = chapterSteps.length;
    progress.value = chapterIndex + 1;
    progress.setAttribute('aria-label', `${active.dataset.chapterLabel}章节进度`);
    previous.disabled = current === 0;
    const chapterEnds = (chapter === 'faq' || chapter === 'admin' || chapter === 'personal-api') && chapterIndex === chapterSteps.length - 1;
    next.disabled = current === steps.length - 1 || chapterEnds;
    next.textContent = next.disabled ? (chapter === 'faq' ? '日常教程已读完' : '本节已读完') : '下一步 →';
    const title = steps[current + 1]?.querySelector('h2')?.textContent || '';
    nextLabel.textContent = next.disabled ? (chapter === 'faq' ? '需要接入平台服务的管理员，可从章节导航打开“管理员接入”。' : '可从章节导航选择其他内容。') : `下一步：${title}`;
    operate.href = active.dataset.action;
    operate.textContent = `${active.dataset.actionLabel} ↗`;
    operate.setAttribute('aria-label', `${active.dataset.actionLabel}，在新标签页打开，保留当前教程`);
    if (writeHash && window.location.hash !== `#${active.id}`) window.history.pushState(null, '', `#${active.id}`);
    if (focus) {
      active.querySelector('h2')?.focus({preventScroll: true});
      document.querySelector('#tutorial-progress').scrollIntoView({block: 'start', behavior: 'auto'});
    }
  }

  document.documentElement.classList.add('enhanced');
  document.querySelector('.tutorial-steps').classList.add('is-ready');
  document.querySelector('#tutorial-navigation').hidden = false;
  show(resolveHash(), {focus: Boolean(window.location.hash)});
  previous.addEventListener('click', () => { if (!previous.disabled) show(current - 1, {focus: true, writeHash: true}); });
  next.addEventListener('click', () => { if (!next.disabled) show(current + 1, {focus: true, writeHash: true}); });
  document.addEventListener('click', event => {
    const anchor = event.target.closest('a[href^="#"]');
    if (!anchor || anchor.classList.contains('skip-link')) return;
    const target = anchor.getAttribute('href');
    if (!steps.some(step => `#${step.id}` === target || `#${step.dataset.chapter}` === target)) return;
    event.preventDefault();
    show(resolveHash(target), {focus: true, writeHash: true});
  });
  const onHistory = () => show(resolveHash(), {focus: true});
  window.addEventListener('hashchange', onHistory);
  window.addEventListener('popstate', onHistory);

  const viewer = document.querySelector('#tutorial-image-viewer');
  const viewerImage = document.querySelector('#tutorial-viewer-image');
  const viewerTitle = document.querySelector('#tutorial-viewer-title');
  const viewerCaption = document.querySelector('#tutorial-viewer-caption');
  const viewerScroll = document.querySelector('#tutorial-viewer-scroll');
  let trigger = null;
  let scale = 1;
  let imageWidth = 1;
  let smallImage = false;

  function resizeImage(nextScale) {
    scale = Math.max(.35, Math.min(smallImage ? 1 : 3, nextScale));
    viewerImage.style.width = `${Math.round(imageWidth * scale)}px`;
    document.querySelector('#tutorial-zoom-out').disabled = scale <= .35;
    document.querySelector('#tutorial-zoom-in').disabled = scale >= (smallImage ? 1 : 3);
  }
  function openImage(button) {
    trigger = button;
    const image = button.querySelector('img');
    imageWidth = Number(image.getAttribute('width')) || image.naturalWidth || 700;
    smallImage = button.classList.contains('small-shot');
    viewerImage.src = image.src;
    viewerImage.alt = image.alt;
    viewerTitle.textContent = image.alt;
    viewerCaption.textContent = button.closest('figure').querySelector('figcaption')?.textContent || '';
    resizeImage(Math.min(smallImage ? 1 : 1.5, (window.innerWidth - 70) / imageWidth));
    viewer.showModal();
    viewerScroll.scrollTop = 0;
    viewerScroll.scrollLeft = 0;
    document.querySelector('#tutorial-viewer-close').focus();
  }
  document.querySelectorAll('[data-zoom-image]').forEach(button => button.addEventListener('click', () => openImage(button)));
  document.querySelector('#tutorial-viewer-close').addEventListener('click', () => viewer.close());
  document.querySelector('#tutorial-zoom-in').addEventListener('click', () => resizeImage(scale + .25));
  document.querySelector('#tutorial-zoom-out').addEventListener('click', () => resizeImage(scale - .25));
  viewer.addEventListener('click', event => { if (event.target === viewer) viewer.close(); });
  viewer.addEventListener('cancel', event => { event.preventDefault(); viewer.close(); });
  viewer.addEventListener('close', () => { viewerImage.removeAttribute('src'); trigger?.focus({preventScroll: true}); });
})();
