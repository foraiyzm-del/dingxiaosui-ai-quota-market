(() => {
  const actions = [
    {id:'blink', label:'眨眨眼！', duration:1450},
    {id:'wave', label:'嗨，今天也要元气满满！', duration:1800},
    {id:'tap', label:'叩叩！我来敲屏幕啦。', duration:1850},
    {id:'super', label:'变身！AI 新农人小超人 ✦', duration:3200}
  ];
  const dock = document.createElement('div');
  dock.className = 'ding-play-dock';
  dock.innerHTML = '<button type="button" class="ding-play-launch" data-ding-play aria-label="逗丁小穗玩，连续点击可眨眼、挥手、敲屏和变身" title="连续点四次，看看丁小穗变身"><img src="ding-xiaosui-fluffy.webp" alt=""></button><span class="ding-play-tip" aria-hidden="true">点我玩 · 四次变身 ✦</span><span class="ding-play-status" role="status" aria-live="polite"></span>';
  document.body.append(dock);
  const heroMascot = document.querySelector('.hero-mascot[data-ding-play]');
  if (heroMascot && 'IntersectionObserver' in window) {
    new IntersectionObserver(entries => {
      dock.classList.toggle('ding-play-dock-hidden', entries[0].isIntersecting);
    }, {threshold:0.2}).observe(heroMascot);
  }
  let count = 0;
  const activeTimers = new WeakMap();
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let lastFlight = 0;
  let flyer = null;
  const flyAcross = (from, arriving = false) => {
    if (reduceMotion.matches || document.visibilityState === 'hidden' || window.innerWidth < 340 || Date.now() - lastFlight < 3500) return;
    lastFlight = Date.now();
    flyer?.remove();
    const start = from?.getBoundingClientRect();
    const x0 = arriving ? -90 : (start ? start.left + start.width / 2 - 36 : window.innerWidth - 100);
    const y0 = arriving ? Math.min(170, window.innerHeight * .23) : (start ? start.top + start.height / 2 - 36 : window.innerHeight - 130);
    const x1 = Math.max(12, Math.min(window.innerWidth - 84, window.innerWidth * .48));
    const y1 = Math.max(70, Math.min(window.innerHeight * .34, 210));
    const dockRect = dock.querySelector('.ding-play-launch').getBoundingClientRect();
    const x2 = dockRect.left - 7, y2 = dockRect.top - 7;
    flyer = document.createElement('span');
    flyer.className = 'ding-flyer';
    flyer.setAttribute('aria-hidden', 'true');
    flyer.innerHTML = '<img src="ding-xiaosui-fluffy.webp" alt=""><i>✦</i>';
    document.body.append(flyer);
    const animation = flyer.animate([
      {transform:`translate(${x0}px,${y0}px) rotate(-14deg) scale(.78)`,opacity:0},
      {transform:`translate(${x1}px,${y1 - 66}px) rotate(10deg) scale(1.08)`,opacity:1,offset:.37},
      {transform:`translate(${x1 + 45}px,${y1 + 8}px) rotate(-8deg) scale(1)`,opacity:1,offset:.62},
      {transform:`translate(${x2}px,${y2}px) rotate(4deg) scale(.76)`,opacity:0}
    ], {duration:1800,easing:'cubic-bezier(.28,.02,.16,1)',fill:'forwards'});
    animation.onfinish = () => { flyer?.remove(); flyer = null; };
  };

  const tapRipple = (x, y) => {
    if (reduceMotion.matches) return;
    const ripple = document.createElement('span');
    ripple.className = 'ding-tap-ripple';
    ripple.style.left = `${x}px`;
    ripple.style.top = `${y}px`;
    ripple.setAttribute('aria-hidden', 'true');
    document.body.append(ripple);
    ripple.addEventListener('animationend', () => ripple.remove(), {once:true});
  };

  const play = (button, event) => {
    const action = actions[count % actions.length];
    count += 1;
    clearTimeout(activeTimers.get(button));
    button.querySelector('.ding-action-art')?.remove();
    button.querySelector('.ding-action-bubble')?.remove();
    button.querySelector('.ding-action-sparks')?.remove();

    const art = document.createElement('span');
    art.className = 'ding-action-art';
    art.setAttribute('aria-hidden', 'true');
    const bubble = document.createElement('span');
    bubble.className = 'ding-action-bubble';
    bubble.textContent = action.label;
    bubble.setAttribute('aria-hidden', 'true');
    const sparks = document.createElement('span');
    sparks.className = 'ding-action-sparks';
    sparks.textContent = '✦ ✧ ✦';
    sparks.setAttribute('aria-hidden', 'true');
    button.append(art, sparks, bubble);
    button.dataset.dingAction = action.id;
    button.classList.add('ding-play-active');
    dock.querySelector('.ding-play-status').textContent = action.label;
    if (action.id === 'tap') {
      const rect = button.getBoundingClientRect();
      tapRipple(event.clientX || rect.left + rect.width / 2, event.clientY || rect.top + rect.height / 2);
    }
    if (action.id === 'wave' || action.id === 'super') flyAcross(button);
    const timer = setTimeout(() => {
      button.classList.remove('ding-play-active');
      button.removeAttribute('data-ding-action');
      art.remove();
      bubble.remove();
      sparks.remove();
    }, action.duration);
    activeTimers.set(button, timer);
  };

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-ding-play]');
    if (button) { play(button, event); return; }
    const internalLink = event.target.closest('a[href]');
    if (internalLink && internalLink.origin === location.origin && internalLink.pathname !== location.pathname) {
      try { sessionStorage.setItem('ding-arrive', String(Date.now())); } catch {}
    }
    // Switching workspace views is navigation, not an invitation to play.
    // Keep flights for deliberate mascot interactions and cross-page arrivals.
  });
  try {
    const arrived = Number(sessionStorage.getItem('ding-arrive') || 0);
    sessionStorage.removeItem('ding-arrive');
    if (arrived && Date.now() - arrived < 10000) setTimeout(() => flyAcross(null, true), 380);
  } catch {}
})();
