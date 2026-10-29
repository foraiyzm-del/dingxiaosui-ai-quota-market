/* Account workspace snapshots. Browser cache stays intact on failed or conflicting writes. */
(() => {
  'use strict';
  const keys = ['zidingxiang-workspace-v1', 'zidingxiang-opc-profile-v1', 'zidingxiang-opc-leads-v1'];
  window.createZdxWorkspaceSync = ({ storage, prefix, ownerId, request, onStatus }) => {
    const metaKey = prefix + '__sync-v1';
    const snapshot = () => Object.fromEntries(keys.map(key => [key, storage.getItem(prefix + key)]));
    const same = (a, b) => keys.every(key => a[key] === b[key]);
    let revision = 0, dirty = false, entries = snapshot(), phase = 'loading', stopped = false;
    let pending = null, timer = null, generation = 0;
    const publish = (next, message) => { phase = next; onStatus({ phase, message, dirty, revision }); };
    const persist = () => storage.setItem(metaKey, JSON.stringify({ revision, dirty }));
    const validate = value => {
      if (!value || !Number.isSafeInteger(value.revision) || value.revision < 0 || !value.entries || !keys.every(key => value.entries[key] === null || typeof value.entries[key] === 'string')) throw new Error('服务器资料格式不正确，请稍后重试');
      return value;
    };
    async function call(method = 'GET', body) {
      const response = await request('/api/workspace', { method, cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(15000), headers: { 'content-type': 'application/json', 'x-zdx-workspace-owner': ownerId }, ...(body ? { body: JSON.stringify(body) } : {}) });
      if (response.status === 401 || response.status === 403) {
        stopped = true;
        publish('auth', '登录状态已改变，本机修改已保留。请重新登录后继续同步。');
        throw new Error('请重新登录后继续同步');
      }
      const value = await response.json();
      if (!response.ok) {
        const error = new Error(value.error || '服务器暂时无法保存资料');
        error.status = response.status;
        throw error;
      }
      return validate(value);
    }
    function applyRemote(remote) {
      for (const key of keys) {
        if (remote.entries[key] === null) storage.removeItem(prefix + key);
        else storage.setItem(prefix + key, remote.entries[key]);
      }
      revision = remote.revision; entries = snapshot(); dirty = false; persist();
    }
    function hasLocal() { return keys.some(key => entries[key] !== null); }
    function current() {
      if (stopped) throw new Error('登录状态已改变，请刷新页面');
      if (phase === 'stale' || !same(snapshot(), entries)) {
        publish('stale', '另一个标签页已修改本机资料。请先复制未提交的表单，再重新打开此页。');
        throw new Error('其他标签页已修改资料，请先刷新页面');
      }
    }
    function schedule() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; void flush(); }, 600);
    }
    async function hydrate() {
      let known = false;
      try {
        const meta = JSON.parse(storage.getItem(metaKey) || 'null');
        if (meta && Number.isSafeInteger(meta.revision) && meta.revision >= 0 && typeof meta.dirty === 'boolean') { revision = meta.revision; dirty = meta.dirty; known = true; }
      } catch { /* Unknown caches require comparison before any replacement. */ }
      try {
        const remote = await call();
        if (!known && hasLocal() && remote.revision > 0 && !same(remote.entries, entries) || known && dirty && revision !== remote.revision && !same(remote.entries, entries)) {
          dirty = true; persist();
          publish('conflict', '本机资料与服务器版本不同，两份资料均已保留。请先导出备份，再选择要读取的版本。');
        } else if (known && dirty || !known && hasLocal() && remote.revision === 0) {
          if (same(remote.entries, entries)) { revision = remote.revision; dirty = false; persist(); publish('saved', '资料已保存到服务器，同一账号可换设备继续使用。'); }
          else { revision = remote.revision; dirty = true; persist(); publish('pending', '正在将本机已有资料保存到服务器…'); schedule(); }
        } else {
          applyRemote(remote);
          publish('saved', remote.revision ? '已读取服务器资料，同一账号可换设备继续使用。' : '账号资料将自动保存到服务器。');
        }
      } catch (error) {
        if (!stopped) {
          // A cache with no migration marker must never be mistaken for a clean server copy.
          if (!known && hasLocal()) { dirty = true; persist(); }
          publish('offline', '暂时无法连接服务器，当前使用本机缓存。联网后点击“重试同步”。');
        }
      }
    }
    async function flush() {
      if (pending) { await pending; return; }
      if (stopped || ['conflict', 'stale', 'remote', 'error'].includes(phase) || !dirty) return;
      pending = (async () => {
        try {
          current();
          const sent = { ...entries }, expected = revision, sentGeneration = generation;
          publish('saving', '正在保存到服务器，请稍候…');
          const result = await call('PUT', { revision: expected, entries: sent });
          // Another tab or an account change must not adopt this response into the old page.
          if (stopped || phase === 'stale' || !same(snapshot(), entries)) return;
          revision = result.revision;
          dirty = generation !== sentGeneration;
          persist();
          publish(dirty ? 'pending' : 'saved', dirty ? '还有新修改，正在继续保存…' : '资料已保存到服务器，同一账号可换设备继续使用。');
          if (dirty) schedule();
        } catch (error) {
          if (stopped || phase === 'stale') return;
          if (error.status === 409) publish('conflict', error.message);
          else if (error.status && error.status < 500) publish('error', error.message + '；本机修改仍保留，请导出备份后检查资料。');
          else publish('offline', '本机修改已保留，尚未确认服务器保存成功。请联网后重试同步。');
        }
      })().finally(() => { pending = null; });
      await pending;
    }
    function beforeChange(key) {
      if (!keys.includes(key)) return;
      current();
      // Mark dirty before writing the cache, so a crash cannot make unsent edits look clean.
      dirty = true; persist();
    }
    function afterChange(key) {
      if (!keys.includes(key)) return;
      entries = snapshot(); generation++;
      if (!['conflict', 'remote', 'error'].includes(phase)) { publish('pending', '本机修改已暂存，等待服务器确认…'); schedule(); }
    }
    async function refresh() {
      if (stopped || pending || phase === 'stale' || phase === 'conflict' || phase === 'remote') return;
      if (dirty) { if (phase === 'error') return; await flush(); return; }
      try {
        const remote = await call();
        if (stopped || dirty || phase === 'stale') return;
        if (!same(snapshot(), entries)) { current(); return; }
        if (!same(remote.entries, entries)) publish('remote', '另一台设备已更新资料。请先保存或复制正在填写的表单，再读取服务器版本。');
        else { revision = remote.revision; persist(); publish('saved', '资料已保存到服务器，同一账号可换设备继续使用。'); }
      } catch { if (!stopped) publish('offline', '暂时无法连接服务器，当前使用本机缓存。联网后可重试同步。'); }
    }
    async function acceptRemote() {
      if (pending) await pending;
      if (stopped || phase === 'stale') throw new Error('请重新打开页面后读取最新资料');
      const remote = await call();
      current();
      applyRemote(remote);
    }
    return Object.freeze({
      hydrate, flush, refresh, acceptRemote, beforeChange, afterChange,
      state: () => ({ phase, dirty, revision }),
      localEntries: () => ({ ...entries }),
      serverEntries: async () => (await call()).entries,
      externalChange: key => { if (keys.some(item => key === prefix + item)) publish('stale', '另一个标签页已更新资料，请复制未提交的表单后重新打开此页。'); },
      stop: () => { stopped = true; if (timer) clearTimeout(timer); },
      retry: async () => { if (['conflict', 'stale', 'remote', 'auth'].includes(phase)) return; if (phase === 'error') publish('pending', '正在重试保存…'); if (dirty) await flush(); else await refresh(); },
    });
  };
})();
