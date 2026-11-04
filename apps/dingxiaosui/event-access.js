/* Event access uses an HttpOnly server session. Never persist the activation code. */
(() => {
  'use strict';
  if (window.ZdxEventAccess) return;
  let state = null, dialog = null, submitting = false;
  const purchaseUrl = () => { try { const url = new URL(state?.shopProductUrl || '', location.href); return state?.shopProductUrl && ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''; } catch { return ''; } };
  const administrative = /^\/(?:login|logout|local-login|platform(?:\/|$)|admin(?:\/|$))/.test(location.pathname);
  const changed = () => { try { localStorage.setItem('zdx-auth-change-v1', Date.now() + ':' + crypto.randomUUID()); } catch {} };
  const request = async (method = 'GET', body, url = '/api/event/session') => {
    const response = await fetch(url, { method, credentials: 'same-origin', cache: 'no-store', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(method === 'POST' ? 45000 : 15000), ...(body ? { body: JSON.stringify(body) } : {}) });
    if (response.status === 404 && method === 'GET') return { enabled: false };
    const data = await response.json();
    if (!response.ok) throw Object.assign(Error(data.error || '暂时无法确认体验状态，请稍后重试。'), {status:response.status});
    return data;
  };
  function status(message, error = false) {
    const node = dialog?.querySelector('[data-event-status]');
    if (node) { node.textContent = message; node.classList.toggle('is-error', error); }
  }
  function show() {
    if (administrative || state?.enabled === false) return;
    if (!dialog) {
      dialog = document.createElement('dialog'); dialog.className = 'event-access-dialog'; dialog.setAttribute('aria-labelledby', 'event-access-title');
      dialog.innerHTML = `<form class="event-access-form"><img class="event-access-mascot" src="/ding-xiaosui-fluffy.webp" alt="丁小穗"><p class="event-access-eyebrow">紫丁香 · 农品品牌创作</p><h1 id="event-access-title">输入激活码，开始创作</h1><p class="event-access-intro">不用注册。说出品牌、产品和想法，<br>让丁小穗陪你做出第一份作品。</p><div class="event-access-rights"></div><label for="event-access-code">你的激活码</label><input id="event-access-code" name="code" type="text" required maxlength="100" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="粘贴完整激活码，横线和空格可以不输入"><p class="event-access-note" data-event-admin-note hidden>当前为管理员。点击下方按钮后，将退出管理身份并进入这张卡；管理员资料与 API 配置会保留。</p><button class="event-access-submit" type="submit">激活并进入创作 <span aria-hidden="true">↗</span></button><p data-event-status role="status" aria-live="polite"></p><a class="event-access-purchase" data-event-purchase target="_blank" rel="noopener noreferrer" hidden>还没有激活码？按需购买 ↗</a><p class="event-access-note">请妥善保存激活码。换设备或退出后，再次输入同一码可找回本次作品与剩余额度。</p><button class="event-access-cancel" type="button">暂不激活，继续浏览</button><a class="event-access-admin" href="/login?return_to=/platform/services">管理员入口</a></form>`;
      document.body.append(dialog);
      dialog.addEventListener('cancel', event => { if (submitting) event.preventDefault(); });
      dialog.querySelector('.event-access-cancel').addEventListener('click', () => { if (!submitting) dialog.close(); });
      dialog.querySelector('form').addEventListener('submit', async event => {
        event.preventDefault(); if (submitting) return;
        const input = dialog.querySelector('input'), code = input.value.trim(); if (!code) { input.focus(); return; }
        submitting = true; input.disabled = true; dialog.querySelector('.event-access-submit').disabled = true; status('正在确认激活码…');
        try {
          const value = await request('POST', { code, ...(state?.platformAdmin ? {switchFromAdmin:true} : {}) });
          if (!value.authenticated || !value.user?.id) throw Error('体验状态未能确认，请保留激活码后重试。');
          input.value = ''; state = value; changed();
          location.replace('/workbench.html');
        } catch (error) {
          if(error.status===409){try{state=await request();updateDialog();}catch{/* Keep the typed code for retry. */}}
          status(error.name === 'TimeoutError' || error.name === 'AbortError' ? '确认结果暂未返回，请保留当前激活码，稍后用同一码重试。无需重新购买。' : error.message || '激活未完成，请用同一码重试。', true);
        }
        finally { submitting = false; input.disabled = false; dialog.querySelector('.event-access-submit').disabled = false; }
      });
    }
    updateDialog();
    const cancel = dialog.querySelector('.event-access-cancel'); cancel.hidden = false; cancel.textContent = state?.activated ? '返回我的创作' : '暂不激活，继续浏览';
    if (state?.authenticated && state.activated && !state.platformAdmin) status('输入另一张卡会切换到该卡的独立作品与额度；输入同一码可继续原来的创作。');
    if (!dialog.open) dialog.showModal();
    dialog.querySelector('input').focus();
  }
  function updateDialog(){
    if(!dialog)return;
    const admin=!!state?.platformAdmin;
    dialog.querySelector('[data-event-admin-note]').hidden=!admin;
    dialog.querySelector('.event-access-submit').textContent=admin?'退出管理员，使用激活码':'激活并进入创作 ↗';
    dialog.querySelector('.event-access-rights').innerHTML=state?.quotaCenterEnabled?'<span>文案</span><span>图片</span><span>视频</span><span>次数按需组合</span>':'<span><b>5</b> 张图片</span><span><b>10</b> 次文案</span><span><b>2</b> 条 15 秒视频</span><span>激活后 <b>7</b> 天</span>';
    const link=dialog.querySelector('[data-event-purchase]'),url=purchaseUrl();link.hidden=!url;if(url)link.href=url;else link.removeAttribute('href');
  }
  async function exit() {
    try { if(state?.platformAdmin)await request('POST',{action:'logout'},'/api/auth');else await request('DELETE'); changed(); location.replace('/workbench.html'); } catch (error) { show(); status('退出未完成：' + error.message, true); }
  }
  const ready = (async () => {
    try {
      state = await request();
      if (state.enabled) {
        document.documentElement.dataset.zdxEvent = 'true';
        if (!administrative && ['/', '/index.html'].includes(location.pathname)) { location.replace('/workbench.html' + location.search + location.hash); return state; }
        if (!administrative && !state.platformAdmin && ['/account/billing','/account/models','/merchant'].includes(location.pathname)) { location.replace(location.pathname==='/account/billing'?'/account/event':'/workbench.html'); return state; }
      }
    } catch (error) {
      // Opening a page never opens the activation dialog, even during an outage.
      console.warn('Experience status is temporarily unavailable.');
    }
    window.dispatchEvent(new CustomEvent('zdx-event-access-ready', { detail: state }));
    return state;
  })();
  document.addEventListener('click', event => {
    const signout = event.target.closest('[data-event-signout]');
    if(signout){event.preventDefault();void exit();return;}
    const trigger = event.target.closest('[data-event-activate]');
    const imageLink = event.target.closest('a[href]');
    const needsActivation = state?.enabled && !state.platformAdmin && (!state.authenticated || !state.activated);
    if (trigger) { event.preventDefault(); show(); }
    else if (needsActivation && imageLink && new URL(imageLink.href,location.href).pathname === '/account/studio') { event.preventDefault(); show(); }
  });
  window.ZdxEventAccess = Object.freeze({ ready, open: show, exit, get state() { return state; } });
})();
