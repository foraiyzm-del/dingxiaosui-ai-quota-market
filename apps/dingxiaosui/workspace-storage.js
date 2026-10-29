/* Account-scoped browser cache and authenticated server workspace synchronization. */
(() => {
  'use strict';
  const AUTH_SIGNAL = 'zdx-auth-change-v1';
  const ACTIVE_SIGNAL = 'zdx-active-workspace-v1';
  const PREFIX = 'zdx-workspace-v2:';
  const rawLocal = window.localStorage;
  const rawSession = window.sessionStorage;
  const legacyKeys = ['zidingxiang-workspace-v1', 'zidingxiang-opc-profile-v1', 'zidingxiang-opc-leads-v1'];
  let namespace = '', locked = true, checking = null;
  let sync = null, syncStatus = null;
  const readRaw = (storage, key) => { try { return storage.getItem(key); } catch { return null; } };
  function freeze(message = '正在确认当前账号…') {
    locked = true;
    document.documentElement.setAttribute('data-zdx-storage-locked', '');
    const text = document.querySelector('#zdx-storage-lock-message');
    if (text) text.textContent = message;
  }
  function unlock() {
    locked = false;
    document.documentElement.removeAttribute('data-zdx-storage-locked');
  }
  function scoped(storage, shared = false) {
    const keyFor = key => {
      if (locked || !namespace) throw new Error('当前账号尚未确认或已更换，请刷新页面后继续');
      return PREFIX + encodeURIComponent(namespace) + ':' + key;
    };
    return Object.freeze({
      getItem: key => storage.getItem(keyFor(String(key))),
      setItem: (key, value) => { key = String(key); const physical = keyFor(key); if (shared) sync?.beforeChange(key); storage.setItem(physical, String(value)); if (shared) sync?.afterChange(key); },
      removeItem: key => { key = String(key); const physical = keyFor(key); if (shared) sync?.beforeChange(key); storage.removeItem(physical); if (shared) sync?.afterChange(key); },
      // Business storage events carry the physical key; callers compare through this helper.
      matches: (eventKey, key) => !locked && !!namespace && eventKey === keyFor(String(key)),
    });
  }
  async function identify() {
    try {
      const response = await fetch('/api/me', { cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(6000) });
      if (response.status === 401) return 'guest';
      if (!response.ok) throw new Error('identity-unavailable');
      const data = await response.json();
      if (!data.user || typeof data.user.id !== 'string' || !data.user.id) throw new Error('identity-invalid');
      return 'account:' + data.user.id;
    } catch {
      // An outage must never reuse whichever signed-in account last visited this device.
      let token = readRaw(rawSession, 'zdx-offline-workspace-v1');
      if (!token) {
        token = crypto.randomUUID();
        try { rawSession.setItem('zdx-offline-workspace-v1', token); } catch {}
      }
      return 'offline:' + token;
    }
  }
  async function refreshIdentity() {
    if (!namespace) return ready;
    if (checking) return checking;
    freeze();
    checking = (async () => {
      const next = await identify();
      if (next !== namespace) {
        sync?.stop();
        freeze('账号或登录状态已改变，正在重新打开对应的本机资料…');
        location.reload();
        return false;
      }
      unlock();
      void sync?.refresh();
      return true;
    })().finally(() => { checking = null; });
    return checking;
  }
  function exportLegacy() {
    if (locked) return;
    try {
      const workspace = JSON.parse(readRaw(rawLocal, legacyKeys[0]) || 'null');
      if (!workspace) throw new Error();
      const parsed = (key, fallback) => { try { return JSON.parse(readRaw(rawLocal, key)) ?? fallback; } catch { return fallback; } };
      const bundle = { format: 'zidingxiang-demo-v1', exportedAt: new Date().toISOString(), workspace,
        profile: parsed(legacyKeys[1], null), leads: parsed(legacyKeys[2], []) };
      const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json;charset=utf-8' }));
      const link = document.createElement('a'); link.href = url; link.download = '紫丁香-旧版未归属资料备份.json';
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { window.alert('旧版备份无法读取，请保留当前浏览器资料，并联系管理员协助恢复。'); }
  }
  function mountNotice() {
    const style = document.createElement('style');
    style.textContent = '[data-zdx-storage-locked] body>*{visibility:hidden!important}#zdx-storage-lock{display:none;position:fixed;inset:0;z-index:2147483647;background:#faf7fb;color:#4a3356;align-items:center;justify-content:center;text-align:center;padding:30px;font:15px/1.8 sans-serif}[data-zdx-storage-locked] #zdx-storage-lock,[data-zdx-storage-locked] #zdx-storage-lock *{visibility:visible!important}[data-zdx-storage-locked] #zdx-storage-lock{display:flex}.zdx-storage-notice{position:relative;z-index:20;margin:0;padding:9px 18px;background:#f4edf7;border-bottom:1px solid #e4d5ed;color:#664671;font:12px/1.7 sans-serif}.zdx-storage-notice button,.zdx-storage-notice a{margin-left:10px;color:#633775}';
    document.head.append(style);
    const overlay = document.createElement('div'); overlay.id = 'zdx-storage-lock';
    overlay.innerHTML = '<div><p id="zdx-storage-lock-message" role="status">正在确认当前账号…</p><button type="button">重新打开页面</button></div>';
    overlay.querySelector('button').addEventListener('click', () => location.reload());
    document.body.append(overlay);
    const notice = document.createElement('div'); notice.className = 'zdx-storage-notice';
    if (namespace.startsWith('account:')) {
      const text = document.createElement('span'); text.id = 'zdx-sync-message'; text.setAttribute('role', 'status'); text.setAttribute('aria-live', 'polite'); notice.append(text);
      const actions = document.createElement('span'); actions.id = 'zdx-sync-actions'; notice.append(actions);
    } else if(window.ZdxEventAccess?.state?.enabled)notice.textContent='输入体验码即可开始，作品将随本次体验保存。';
    else notice.textContent = namespace === 'guest' ? '当前为访客本机资料；登录后可将备份导入所属账号，保存到服务器。' : '账号服务暂不可用，当前使用本标签页的临时访客资料；请导出备份，恢复登录后再导入。';
    if (!namespace.startsWith('account:')&&!window.ZdxEventAccess?.state?.enabled) { const login = document.createElement('a'); login.href = '/login?return_to=/workbench.html'; login.textContent = '登录账号'; notice.append(login); }
    if (readRaw(rawLocal, legacyKeys[0])) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = '导出旧版未归属资料';
      button.title = '旧资料原样保留，未自动归属任何账号。导出后核对归属，再在正确账号导入。';
      button.addEventListener('click', exportLegacy); notice.append(button);
    }
    document.body.prepend(notice);
    renderSyncStatus();
  }
  function downloadEntries(entries, label) {
    const parse = (key, fallback) => { try { return JSON.parse(entries[key]) ?? fallback; } catch { return fallback; } };
    const bundle = { format: 'zidingxiang-demo-v1', exportedAt: new Date().toISOString(), workspace: parse(legacyKeys[0], {version:1,products:[],campaigns:[],drafts:[],plans:[]}), profile: parse(legacyKeys[1], null), leads: parse(legacyKeys[2], []) };
    const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `紫丁香-${label}-${Date.now()}.json`;
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function renderSyncStatus() {
    if (!syncStatus) return;
    const message = document.querySelector('#zdx-sync-message'), actions = document.querySelector('#zdx-sync-actions');
    if (!message || !actions) return;
    message.textContent = syncStatus.message; actions.replaceChildren();
    const button = (label, action) => {
      const node = document.createElement('button'); node.type = 'button'; node.textContent = label;
      node.addEventListener('click', async () => { node.disabled = true; try { await action(); } catch (error) { window.alert(error.message || '操作未完成，资料仍已保留'); } finally { node.disabled = false; } }); actions.append(node);
    };
    if (['offline', 'error', 'pending'].includes(syncStatus.phase)) button('重试同步', () => sync.retry());
    if (['conflict', 'remote', 'offline', 'error', 'auth'].includes(syncStatus.phase)) button('导出本机备份', () => downloadEntries(sync.localEntries(), '本机备份'));
    if (['conflict', 'remote'].includes(syncStatus.phase)) {
      button('导出服务器备份', async () => downloadEntries(await sync.serverEntries(), '服务器备份'));
      button('读取服务器版本', async () => {
        if (!window.confirm('请先导出本机备份。读取服务器版本会替换本机工作区并刷新页面，未提交的表单不会保留。确定继续吗？')) return;
        await sync.acceptRemote(); location.reload();
      });
    }
    if (['stale', 'auth'].includes(syncStatus.phase)) button('重新打开页面', () => location.reload());
  }
  function importWorkspace(values) {
    const items = Object.entries(values);
    if (!items.length || items.some(([key, value]) => !legacyKeys.includes(key) || value !== null && typeof value !== 'string')) throw new Error('导入字段不正确');
    // Stage the entire backup before allowing a queued server save to observe it.
    if (locked || !namespace) throw new Error('当前账号尚未确认，请刷新页面');
    const physical = key => PREFIX + encodeURIComponent(namespace) + ':' + key;
    const previous = items.map(([key]) => [key, rawLocal.getItem(physical(key))]);
    sync?.beforeChange(items[0][0]);
    try {
      for (const [key, value] of items) { if (value === null) rawLocal.removeItem(physical(key)); else rawLocal.setItem(physical(key), value); }
    } catch (error) {
      for (const [key, value] of previous) { if (value === null) rawLocal.removeItem(physical(key)); else rawLocal.setItem(physical(key), value); }
      throw error;
    }
    sync?.afterChange(items[0][0]);
  }
  freeze();
  const ready = (async () => {
    if(window.ZdxEventAccess)await window.ZdxEventAccess.ready;
    namespace = await identify();
    if (namespace.startsWith('account:')) {
      if (typeof window.createZdxWorkspaceSync !== 'function') throw new Error('资料同步组件未能加载，请刷新页面后重试');
      sync = window.createZdxWorkspaceSync({ storage: rawLocal, prefix: PREFIX + encodeURIComponent(namespace) + ':', ownerId: namespace.slice('account:'.length), request: (...args) => fetch(...args), onStatus: status => { syncStatus = status; renderSyncStatus(); } });
      await sync.hydrate();
    }
    mountNotice();
    unlock();
    try { rawLocal.setItem(ACTIVE_SIGNAL, namespace); } catch {}
    // Keep classic scripts in their original order so their shared bindings remain valid.
    for (const placeholder of document.querySelectorAll('script[data-zdx-src]')) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script'); script.src = placeholder.getAttribute('data-zdx-src'); script.async = false;
        script.onload = resolve; script.onerror = () => reject(new Error('页面组件加载失败，请刷新重试'));
        document.head.append(script);
      });
    }
  })().catch(error => { freeze(error.message || '页面暂时无法打开，请刷新重试'); throw error; });
  window.zdxStorage = Object.freeze({ local: scoped(rawLocal, true), session: scoped(rawSession), ready, refreshIdentity, importWorkspace, sync: Object.freeze({ flush: () => sync?.flush(), status: () => sync?.state() || { phase: 'guest', dirty: false } }) });
  window.addEventListener('storage', event => {
    if (event.key === AUTH_SIGNAL || event.key === ACTIVE_SIGNAL && event.newValue !== namespace) { freeze('登录状态已变更，正在确认当前账号…'); void refreshIdentity(); }
    else sync?.externalChange(event.key);
  });
  window.addEventListener('online', () => { void sync?.retry(); });
  window.addEventListener('beforeunload', event => { if (sync?.state().dirty) { event.preventDefault(); event.returnValue = ''; } });
  window.addEventListener('focus', () => { void refreshIdentity(); });
  window.addEventListener('pageshow', event => { if (event.persisted) void refreshIdentity(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void refreshIdentity(); });
  setInterval(() => { if (document.visibilityState === 'visible') void refreshIdentity(); }, 30000);
})();
