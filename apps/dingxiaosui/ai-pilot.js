// 试用邀请码只保存在本标签页；模型密钥始终留在服务端。
(() => {
  const nav=document.querySelector('.main-nav');
  if(nav){
    // Keep one creation entry with the same icon and row structure as the native navigation.
    let studio=nav.querySelector('#ai-creation-link');
    if(!studio){studio=document.createElement('a');studio.id='ai-creation-link';studio.className='nav-item';studio.dataset.view='studio';studio.href='/account/studio';studio.innerHTML='<span class="nav-icon" aria-hidden="true">✦</span><span class="nav-label">AI 创作</span>';const old=nav.querySelector('[data-view="studio"]');if(old)old.replaceWith(studio);else nav.querySelector('[data-view="home"]')?.after(studio);}
    nav.querySelectorAll('a[href="/account/models"],a[href="/platform/ai"],a[href="/platform/media"],label.nav-item').forEach(item=>item.remove());
    nav.querySelectorAll('a[href="/account/studio"]').forEach(item=>{if(item!==studio)item.remove()});
  }
  const sidebarBottom=document.querySelector('.sidebar-bottom');
  if(sidebarBottom){
    const access=document.createElement('div');access.className='workbench-admin-access';access.hidden=true;sidebarBottom.prepend(access);
    fetch('/api/me',{cache:'no-store',signal:AbortSignal.timeout(6000)}).then(r=>r.ok?r.json():null).then(user=>{if(user?.platformAdmin){access.innerHTML='<a href="/platform/services"><span aria-hidden="true">⚙</span> 平台服务设置 <span aria-hidden="true">↗</span></a>';access.hidden=false;}}).catch(()=>{});
    window.addEventListener('storage',event=>{if(event.key==='zdx-auth-change-v1'){access.hidden=true;access.replaceChildren()}});
  }
  const storageKey = 'zidingxiang-ai-pilot-code';
  function askCode() {
    return new Promise(resolve => {
      const dialog = document.createElement('dialog');
      dialog.className = 'ai-pilot-dialog';
      dialog.innerHTML = `<form method="dialog" class="ai-pilot-card"><span>紫丁香计划 / PRIVATE AI PILOT</span><h2>开启在线模型试用</h2><p>输入研究院发放的试用邀请码。本次提问或简报会发送给已接入的模型服务；发布前仍需核对商品事实。</p><label>试用邀请码<input name="code" type="password" autocomplete="off" minlength="16" maxlength="120" required placeholder="请输入至少 16 位邀请码"></label><div><button value="cancel" type="button" data-cancel>暂不使用</button><button value="confirm" type="submit">开始使用 AI ↗</button></div></form>`;
      document.body.append(dialog);
      const finish = value => { dialog.close(); dialog.remove(); resolve(value); };
      dialog.querySelector('[data-cancel]').addEventListener('click', () => finish(null));
      dialog.addEventListener('cancel', event => { event.preventDefault(); finish(null); });
      dialog.querySelector('form').addEventListener('submit', event => { event.preventDefault(); finish(dialog.querySelector('[name="code"]').value.trim()); });
      dialog.showModal(); dialog.querySelector('[name="code"]').focus();
    });
  }
  window.aiPilotFetch = async (url, body) => {
    // Request metadata only; the existing creation UI stays unchanged. Reuse
    // this identifier when the same request retries after authentication.
    body={...body,requestId:body.requestId||crypto.randomUUID()};
    const statusResponse=await fetch('/api/engine',{cache:'no-store'});
    if(!statusResponse.ok)throw new Error('AI 服务状态暂时无法读取');
    const status=await statusResponse.json();
    if(status.mode!=='model')throw new Error('平台文案服务尚未启用，请联系管理员；个人 API 可在「AI 创作」的 AI 设置中选配');
    if(status.access==='account'||status.access==='personal')return fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...body,consent:true})});
    let code = window.zdxStorage.session.getItem(storageKey) || await askCode();
    if (!code) throw new Error('已取消在线模型试用');
    const send = value => fetch(url, { method:'POST', headers:{'content-type':'application/json','x-zdx-pilot-code':value}, body:JSON.stringify({...body,consent:true}) });
    let response = await send(code);
    if (response.status === 401) {
      window.zdxStorage.session.removeItem(storageKey);
      code = await askCode();
      if (!code) throw new Error('已取消在线模型试用');
      response = await send(code);
    }
    if (response.status !== 401) window.zdxStorage.session.setItem(storageKey, code);
    return response;
  };
})();
