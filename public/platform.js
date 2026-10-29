const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const capabilityNames = { text: '文案', image: '图片', video: '视频' };
const capabilityUnits = { text: '次', image: '张', video: '个' };
const quotaDescription = quota => Object.keys(capabilityNames)
  .filter(capability => Number.isSafeInteger(quota?.[capability]) && quota[capability] > 0)
  .map(capability => `${capabilityNames[capability]} ${quota[capability]} ${capabilityUnits[capability]}`).join('、');
const statusNames = { queued: '正在准备', running: '正在生成', succeeded: '已完成', failed: '未完成', uncertain: '等待核对' };
const safeMedia = value => {
  if (typeof value !== 'string') return '';
  if (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value)) return value;
  try {
    const url = new URL(value, location.origin);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
};

async function request(path, body) {
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error ?? '暂时无法完成，请稍后重试'), { status: response.status });
  return result;
}

export async function renderPlatform(app) {
  const id = decodeURIComponent(location.pathname.split('/')[2] ?? '');
  const root = `/api/platforms/${encodeURIComponent(id)}`;
  const response = await request(root), platform = response.platform ?? response;
  let balance = await request(`${root}/balance`);
  balance = balance.balance ?? balance;
  let timer, stopped = false, working = false, currentStatus = '', copiedText = '';
  const units = platform.unitsPerUse ?? 1;
  const hasCapabilityReadiness = Array.isArray(platform.availableCapabilities);
  const caps = (hasCapabilityReadiness ? platform.availableCapabilities : platform.capabilities ?? (platform.bindings ?? []).map(binding => binding.capability)).filter(capability => capabilityNames[capability]);
  const available = caps.length > 0 && platform.enabled !== false && (hasCapabilityReadiness || platform.ready !== false);
  const pendingKey = `quota-platform:${id}:pending`, jobKey = `quota-platform:${id}:job`;
  let pendingRequest;
  try { pendingRequest = JSON.parse(sessionStorage.getItem(pendingKey) || 'null'); } catch { pendingRequest = null; }
  const savePending = value => {
    pendingRequest = value;
    try { value ? sessionStorage.setItem(pendingKey, JSON.stringify(value)) : sessionStorage.removeItem(pendingKey); } catch { /* Private browsing may disable storage. */ }
  };

  document.title = `${platform.name} · 服务体验`;
  document.body.classList.add('platform-page');
  app.innerHTML = `
    <header class="service-topbar">
      <a class="service-brand" href="/" aria-label="额度集市首页"><span class="service-brand-mark" aria-hidden="true">额</span>额度集市</a>
      <a class="service-store-link" href="/">购买次数 <span aria-hidden="true">↗</span></a>
    </header>
    <main class="service-main">
      <div class="service-heading">
        <div><p class="service-overline">服务体验</p><h1>${esc(platform.name)}</h1><p class="service-description">${esc(platform.description || '兑换次数后，即可开始使用。')}</p></div>
        ${platform.url ? `<a class="service-official-link" href="${esc(safeMedia(platform.url))}" target="_blank" rel="noopener noreferrer">前往正式平台 ↗</a>` : ''}
      </div>
      <section class="service-credit" aria-label="本平台次数">
        <div class="service-balances" id="platform-balance" aria-live="polite"></div>
        <button class="service-secondary" id="toggle-redeem" type="button" aria-controls="service-redeem-panel" aria-expanded="${balance.available === 0}">兑换次数</button>
      </section>
      <section class="service-redeem" id="service-redeem-panel" ${balance.available === 0 ? '' : 'hidden'} aria-labelledby="redeem-title">
        <div class="service-redeem-heading"><h2 id="redeem-title">已有激活码？</h2><p>粘贴本服务的激活码，次数立即到账。</p></div>
        <form id="platform-redeem">
          <div class="service-code-row"><label class="service-sr-only" for="service-code">本平台激活码</label><input id="service-code" name="code" required maxlength="200" autocomplete="off" spellcheck="false" placeholder="粘贴激活码"><button class="service-primary" type="submit">确认兑换</button></div>
          <p class="service-message" id="redeem-error" role="status"></p>
        </form>
      </section>
      <section class="service-workspace" aria-labelledby="create-title">
        <div class="service-workspace-heading"><h2 id="create-title">开始创作</h2><span id="service-usage-rule">每次成功使用 ${esc(units)} 次</span></div>
        ${available ? `
          <form id="platform-generate">
            <div class="service-type-row"><label for="service-capability">生成类型</label><select name="capability" id="service-capability">${caps.map(capability => `<option value="${capability}">${capabilityNames[capability]}</option>`).join('')}</select></div>
            <label class="service-prompt-label" for="service-prompt">想生成什么？</label>
            <textarea name="prompt" id="service-prompt" required maxlength="12000" rows="6" placeholder="例如：为一款环保包装写一段推广文案，语气简洁、有吸引力。"></textarea>
            <details class="service-options" id="generation-options" hidden><summary>尺寸与时长（选填）</summary><div class="service-option-fields"><label id="image-size-field">尺寸<input name="size" placeholder="留空使用默认尺寸"></label><label id="video-seconds-field" hidden>时长（秒）<input name="seconds" type="number" min="1" max="60" placeholder="留空使用默认时长"></label></div></details>
            <p class="service-message service-error" id="generate-error" role="alert"></p>
            <div class="service-generate-actions"><p id="generation-balance-hint"></p><button class="service-primary" type="submit" id="generate-button">开始生成 <span aria-hidden="true">→</span></button></div>
          </form>` : `
          <div class="service-unavailable"><h3>服务暂未开放</h3><p>商家正在准备这项服务，请稍后再来。</p><a href="/">查看其他服务 →</a></div>`}
      </section>
      <section class="service-result" id="platform-output" hidden aria-labelledby="result-title">
        <div class="service-result-heading"><div><h2 id="result-title">生成结果</h2><span class="service-status" id="generation-status"></span></div><button class="service-secondary" type="button" id="copy-result" hidden>复制内容</button></div>
        <p class="service-result-note" id="generation-note" role="status"></p>
        <div class="service-result-content" id="generation-content"></div>
        <p class="service-message service-error" id="generation-poll-error" role="status"></p>
        <details class="service-task-details"><summary>任务详情</summary><p id="generation-task"></p><p id="generation-detail-error"></p></details>
      </section>
      <footer class="service-footer"><span>体验账户仅关联当前浏览器，次数仅限本服务使用。</span><details><summary>使用说明</summary><p>正式业务平台请使用原平台账号。生成成功后扣次；明确失败会退回次数。结果暂时无法确认时，次数保留至商家核对后处理。</p></details></footer>
    </main>`;

  const form = app.querySelector('#platform-generate');
  const generateButton = app.querySelector('#generate-button');
  const redeemPanel = app.querySelector('#service-redeem-panel');
  const hasTypedBalance = () => balance.byCapability && typeof balance.byCapability === 'object';
  const selectedCapability = () => pendingRequest?.capability ?? form?.elements.namedItem('capability')?.value ?? caps[0];
  const availableFor = capability => hasTypedBalance()
    ? (balance.byCapability[capability]?.available ?? 0) + (balance.shared?.available ?? 0)
    : balance.available ?? 0;
  function updateActions() {
    if (!form) return;
    const awaitingCheck = currentStatus === 'uncertain';
    const capability = selectedCapability(), typed = hasTypedBalance(), usable = availableFor(capability);
    const enough = usable >= units;
    generateButton.disabled = working || awaitingCheck || (!enough && !pendingRequest);
    generateButton.textContent = working ? '正在生成…' : awaitingCheck ? '等待商家核对' : pendingRequest ? '恢复上次请求' : enough ? '开始生成 →' : typed ? `请先兑换${capabilityNames[capability]}额度` : '请先兑换次数';
    form.querySelectorAll('input,textarea,select').forEach(element => { element.disabled = !!pendingRequest || working; });
    app.querySelector('#generation-balance-hint').textContent = working ? '正在处理本次请求，请勿重复提交。' : awaitingCheck ? '本次预扣额度保留中，等待核对结果。' : pendingRequest ? '恢复原请求，不会重新扣次。' : typed
      ? enough ? `${capabilityNames[capability]}当前可用 ${usable} 次，成功后扣除 ${units} 次，失败退回。` : `${capabilityNames[capability]}额度不足，当前可用 ${usable} 次，需要 ${units} 次。`
      : enough ? `成功后扣除 ${units} 次，失败退回。` : `当前次数不足，需要 ${units} 次。`;
    app.querySelectorAll('[data-balance-capability]').forEach(item => item.classList.toggle('is-selected', item.dataset.balanceCapability === capability));
  }
  function showBalance(value) {
    balance = value.balance ?? value;
    const typed = hasTypedBalance(), target = app.querySelector('#platform-balance');
    target.classList.toggle('service-balances-typed', !!typed);
    target.innerHTML = typed
      ? `${Object.keys(capabilityNames).map(capability => `<div class="service-capability-balance" data-balance-capability="${capability}"><span>${capabilityNames[capability]}可用</span><strong>${esc(balance.byCapability[capability]?.available ?? 0)}<small>${capabilityUnits[capability]}</small></strong></div>`).join('')}<div class="service-credit-details">${(balance.shared?.available ?? 0) > 0 ? `<span>另有通用次数 ${esc(balance.shared.available)} 次，可补充任一类型</span>` : ''}<span>处理中 ${esc(balance.reserved ?? 0)} 次 · 已使用 ${esc(balance.consumed ?? 0)} 次</span></div>`
      : `<div class="service-credit-available"><span>可用次数</span><strong>${esc(balance.available ?? 0)}<small>次</small></strong></div><div><span>处理中</span><strong>${esc(balance.reserved ?? 0)}</strong></div><div><span>已使用</span><strong>${esc(balance.consumed ?? 0)}</strong></div>`;
    app.querySelector('#service-usage-rule').textContent = typed ? `每次成功扣除 ${units} 次对应额度` : `每次成功使用 ${units} 次`;
    updateActions();
  }
  const refreshBalance = async () => { try { showBalance(await request(`${root}/balance`)); } catch { /* The next successful task refresh also refreshes the balance. */ } };
  showBalance(balance);

  app.querySelector('#toggle-redeem').onclick = () => {
    redeemPanel.hidden = !redeemPanel.hidden;
    app.querySelector('#toggle-redeem').setAttribute('aria-expanded', String(!redeemPanel.hidden));
    if (!redeemPanel.hidden) app.querySelector('#service-code').focus();
  };
  app.querySelector('#platform-redeem').onsubmit = async event => {
    event.preventDefault();
    const button = event.submitter, message = app.querySelector('#redeem-error');
    button.disabled = true; button.textContent = '正在兑换…'; message.textContent = ''; message.classList.remove('service-error');
    try {
      const data = await request(`${root}/redeem`, { code: new FormData(event.target).get('code') });
      showBalance(data.balance ?? await request(`${root}/balance`));
      message.textContent = data.quota ? `兑换成功，已增加${quotaDescription(data.quota)}。` : `兑换成功，已增加 ${data.units ?? 0} 次。`;
      event.target.reset();
    } catch (error) { message.textContent = error.message; message.classList.add('service-error'); }
    finally { button.disabled = false; button.textContent = '确认兑换'; }
  };
  app.querySelector('#copy-result').onclick = async event => {
    const button = event.currentTarget;
    try { await navigator.clipboard.writeText(copiedText); button.textContent = '已复制'; }
    catch { app.querySelector('#generation-poll-error').textContent = '无法自动复制，请选中结果文字后复制。'; }
  };

  function showJob(value) {
    const job = value.job ?? value;
    if (job.id) { try { sessionStorage.setItem(jobKey, job.id); } catch { /* Session storage is optional. */ } }
    app.querySelector('#platform-output').hidden = false;
    currentStatus = job.status;
    const status = app.querySelector('#generation-status');
    status.textContent = statusNames[job.status] ?? '状态更新中';
    status.className = `service-status service-status-${job.status}`;
    app.querySelector('#generation-task').textContent = `任务编号：${job.id ?? ''} · 本次使用 ${hasTypedBalance() && capabilityNames[job.capability] ? `${capabilityNames[job.capability]} ` : ''}${job.units ?? units} 次`;
    app.querySelector('#generation-detail-error').textContent = typeof job.error === 'string' ? job.error : job.error?.message ?? '';
    const notes = { queued: '任务正在准备，结果会自动显示。', running: '正在处理，离开页面后任务仍会继续。', failed: '本次未完成，预扣次数已退回。你可以调整要求后重试。', uncertain: '结果暂时无法确认，次数暂未结算。请联系商家核对，勿重复提交。', succeeded: '' };
    app.querySelector('#generation-note').textContent = notes[job.status] ?? '';
    const content = app.querySelector('#generation-content');
    content.replaceChildren(); copiedText = '';
    const output = job.output, text = typeof output === 'string' ? output : output?.text ?? output?.content;
    if (text) {
      copiedText = typeof text === 'string' ? text : JSON.stringify(text, null, 2);
      const pre = document.createElement('pre'); pre.className = 'service-generated-text'; pre.textContent = copiedText; content.append(pre);
    }
    const copyButton = app.querySelector('#copy-result'); copyButton.hidden = !copiedText; copyButton.textContent = '复制内容';
    const images = output?.images ?? output?.data ?? [];
    for (const item of Array.isArray(images) ? images : []) {
      const source = safeMedia(typeof item === 'string' ? item : item.url ?? item.dataUrl ?? (item.b64_json ? `data:image/png;base64,${item.b64_json}` : ''));
      if (source) {
        const anchor = document.createElement('a'); anchor.href = source; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; anchor.className = 'service-generated-image';
        const image = document.createElement('img'); image.src = source; image.alt = '生成的图片，点击查看原图'; image.loading = 'lazy'; anchor.append(image); content.append(anchor);
      }
    }
    const video = output?.videoUrl ?? output?.video?.url ?? (job.capability === 'video' ? output?.url : null);
    const source = safeMedia(video) || (output?.contentAvailable ? `${root}/jobs/${encodeURIComponent(job.id)}/content` : '');
    if (source) { const element = document.createElement('video'); element.src = source; element.controls = true; element.preload = 'metadata'; content.append(element); }
    if (job.status === 'succeeded' && !content.children.length) app.querySelector('#generation-note').textContent = '任务已完成，如需获取结果请联系商家。';
    working = ['queued', 'running'].includes(job.status);
    updateActions();
    if (value.balance) showBalance(value.balance); else refreshBalance();
    // Observe merchant resolution too; polling never resubmits a generation request.
    if ((working || job.status === 'uncertain') && job.id && !stopped) {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        try {
          const next = await request(`${root}/jobs/${encodeURIComponent(job.id)}`);
          if (!stopped) { app.querySelector('#generation-poll-error').textContent = ''; showJob(next); }
        } catch {
          if (!stopped) {
            app.querySelector('#generation-poll-error').textContent = '连接暂时中断，正在恢复任务状态，请勿重复提交。';
            if (generateButton) generateButton.disabled = true;
            timer = setTimeout(() => { if (!stopped) showJob(job); }, 4000);
          }
        }
      }, job.status === 'uncertain' ? 10000 : 4000);
    }
  }

  if (form) {
    const change = () => {
      const capability = form.elements.namedItem('capability').value;
      app.querySelector('#generation-options').hidden = capability === 'text';
      app.querySelector('#image-size-field').hidden = capability === 'text';
      app.querySelector('#video-seconds-field').hidden = capability !== 'video';
      form.elements.namedItem('prompt').placeholder = capability === 'image' ? '例如：一款简约的茶叶礼盒包装，以米白和墨绿为主色，展示正面设计。' : capability === 'video' ? '例如：一段产品展示短片，镜头缓慢环绕包装，背景干净、光线柔和。' : '例如：为一款环保包装写一段推广文案，语气简洁、有吸引力。';
      updateActions();
    };
    form.elements.namedItem('capability').onchange = change;
    if (pendingRequest) {
      for (const key of ['capability', 'prompt', 'size', 'seconds']) if (form.elements.namedItem(key)) form.elements.namedItem(key).value = pendingRequest[key] ?? '';
      app.querySelector('#generate-error').textContent = '上次请求尚未确认，点击恢复即可继续查看结果。';
    }
    change(); updateActions();
    form.onsubmit = async event => {
      event.preventDefault();
      if (working || currentStatus === 'uncertain') return;
      const data = new FormData(form);
      const payload = pendingRequest ?? { requestId: crypto.randomUUID(), capability: data.get('capability'), prompt: data.get('prompt') };
      if (!pendingRequest && availableFor(payload.capability) < units) {
        app.querySelector('#generate-error').textContent = hasTypedBalance() ? `请先兑换足够的${capabilityNames[payload.capability]}额度。` : '请先兑换足够的次数。';
        updateActions(); return;
      }
      if (!pendingRequest) {
        if (data.get('size') && payload.capability !== 'text') payload.size = String(data.get('size')).trim();
        if (data.get('seconds') && payload.capability === 'video') payload.seconds = Number(data.get('seconds'));
      }
      working = true; app.querySelector('#generate-error').textContent = '';
      savePending(payload); updateActions();
      try {
        const result = await request(`${root}/generate`, payload);
        savePending(null); showJob(result);
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        app.querySelector('#platform-output').scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'nearest' });
      } catch (error) {
        if (error.status && error.status < 500) savePending(null);
        working = false; updateActions();
        app.querySelector('#generate-error').textContent = `${error.message}${pendingRequest ? '。点击“恢复上次请求”继续，不会重复扣次。' : ''}`;
        await refreshBalance();
      }
    };
  }
  try {
    const jobId = sessionStorage.getItem(jobKey);
    if (jobId && !pendingRequest) showJob(await request(`${root}/jobs/${encodeURIComponent(jobId)}`));
  } catch { /* A missing historical task should not prevent a new task. */ }
  window.addEventListener('pagehide', () => { stopped = true; clearTimeout(timer); }, { once: true });
}
