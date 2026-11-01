const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const money = cents => (Number(cents) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const unitMoney = micros => (Number(micros) / 1000000).toLocaleString('zh-CN', { maximumFractionDigits: 6 });
const number = value => Number(value).toLocaleString('zh-CN');
const quotaTypes = ['text', 'image', 'video'];
const quotaNames = { text: '文案', image: '图片', video: '视频' };
const quotaUnits = { text: '次', image: '张', video: '个' };
const quotaFor = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const quota = Object.fromEntries(quotaTypes.map(type => [type, value[type] ?? 0]));
  return quotaTypes.every(type => Number.isSafeInteger(quota[type]) && quota[type] >= 0 && quota[type] <= 1000000)
    && Object.values(quota).reduce((sum, units) => sum + units, 0) > 0 ? quota : null;
};
const quotaLabel = value => {
  const quota = quotaFor(value);
  return quota ? quotaTypes.filter(type => quota[type] > 0).map(type => `${quotaNames[type]} ${number(quota[type])} ${quotaUnits[type]}`).join(' · ') : '';
};
const quotaPricingFor = product => {
  const pricing = product.quotaPricing;
  if (product.fulfillment !== 'on_payment' || pricing?.enabled !== true) return null;
  const maxCounts = Object.fromEntries(quotaTypes.map(type => [type, pricing.maxCounts?.[type] ?? 1000000]));
  if (!quotaTypes.every(type => Number.isSafeInteger(maxCounts[type]) && maxCounts[type] >= 0 && maxCounts[type] <= 1000000)) return null;
  if (!quotaTypes.some(type => maxCounts[type] > 0)) return null;
  const unitPriceMicros = {};
  for (const type of quotaTypes) {
    const price = pricing.unitPriceMicros?.[type] ?? 0;
    if (!Number.isSafeInteger(price) || price < 0 || price > 1000000000000) return null;
    // A closed capability may be priced at 0. An open one still needs a price.
    if (maxCounts[type] > 0 && price <= 0) return null;
    unitPriceMicros[type] = price;
  }
  return { ...pricing, maxCounts, unitPriceMicros };
};
const purchaseSummary = value => quotaLabel(value.quota) || `${number(value.units)} 次服务`;
const optionsFor = product => {
  const options = Array.isArray(product.packageOptions) ? product.packageOptions.filter(option => option && typeof option.id === 'string' && Number.isSafeInteger(option.units) && option.units > 0 && Number.isSafeInteger(option.priceCents) && option.priceCents > 0) : [];
  return options.length ? options : [{ id: null, label: '标准套餐', units: product.units, priceCents: product.priceCents, stockAvailable: 0 }];
};
const pricingFor = product => {
  const value = product.customPricing;
  return value?.enabled === true && Number.isSafeInteger(value.minUnits) && value.minUnits > 0 && Number.isSafeInteger(value.maxUnits) && value.maxUnits >= value.minUnits && Number.isSafeInteger(value.unitPriceMicros) && value.unitPriceMicros > 0 ? value : null;
};
function selectionFor(product, choice) {
  if (choice.type === 'custom_quota') {
    const pricing = quotaPricingFor(product);
    if (!pricing) return { valid: false, error: '此服务暂不支持自由组合。' };
    const quota = {};
    for (const type of quotaTypes) {
      if (pricing.maxCounts[type] === 0) { quota[type] = 0; continue; }
      const raw = String(choice.customQuota?.[type] ?? '').trim();
      if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) > pricing.maxCounts[type]) return { valid: false, error: `${quotaNames[type]}请输入 0 至 ${number(pricing.maxCounts[type])} 的整数。` };
      quota[type] = Number(raw);
    }
    const units = Object.values(quota).reduce((sum, count) => sum + count, 0);
    if (units < 1 || units > 1000000) return { valid: false, error: units < 1 ? '至少选择一项需要的额度。' : '本次购买合计不能超过 1,000,000 次。' };
    const micros = quotaTypes.reduce((sum, type) => sum + BigInt(quota[type]) * BigInt(pricing.unitPriceMicros[type]), 0n);
    const cents = (micros + 9999n) / 10000n;
    if (cents < 1n || cents > 100000000n) return { valid: false, error: '金额超出购买范围，请调整次数。' };
    return { valid: true, quota, units, priceCents: Number(cents), stock: Infinity, label: '自由组合', payload: { customQuota: quota } };
  }
  if (choice.type !== 'custom') {
    const option = optionsFor(product).find(item => item.id === choice.packageId);
    return option ? { valid: true, quota: quotaFor(option.quota), units: option.units, priceCents: option.priceCents, stock: product.fulfillment === 'on_payment' ? Infinity : option.stockAvailable ?? 0, label: option.label || `${option.units} 次套餐`, payload: option.id === null ? {} : { packageId: option.id } } : { valid: false, error: '请选择一个套餐。' };
  }
  const pricing = pricingFor(product), raw = String(choice.customUnits ?? '').trim();
  if (!pricing) return { valid: false, error: '此服务暂不支持自定义次数。' };
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < 1) return { valid: false, error: '请输入完整的次数，例如 25。' };
  const units = Number(raw);
  if (units < pricing.minUnits || units > pricing.maxUnits) return { valid: false, error: `请输入 ${number(pricing.minUnits)} 至 ${number(pricing.maxUnits)} 次。` };
  const cents = (BigInt(units) * BigInt(pricing.unitPriceMicros) + 9999n) / 10000n;
  if (cents < 1n || cents > 100000000n) return { valid: false, error: '金额超出购买范围，请调整次数。' };
  return { valid: true, units, priceCents: Number(cents), stock: product.fulfillment === 'on_payment' ? Infinity : (product.customStock ?? []).find(item => item.units === units)?.available ?? 0, label: `自定义 ${number(units)} 次`, payload: { customUnits: units } };
}
const statusNames = { pending: '待付款', submitted: '等待确认', approved: '正在发卡', fulfilled: '购买成功', expired: '订单已过期', cancelled: '订单已取消' };
const icon = (name, size = 18) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${{
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>', back: '<path d="M19 12H5m5-5-5 5 5 5"/>',
  check: '<path d="m5 12 4 4L19 6"/>', close: '<path d="m6 6 12 12M6 18 18 6"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
}[name] ?? ''}</svg>`;
const header = () => `<header class="shop-header"><div class="shop-header-inner"><a class="shop-brand" href="/" aria-label="额度集市首页"><span class="shop-mark" aria-hidden="true">额</span>额度集市</a><nav class="shop-nav" aria-label="主导航"><a href="/" ${location.pathname === '/' ? 'aria-current="page"' : ''}>服务商店</a><button type="button" id="shop-recent-open">我的订单</button></nav></div></header>`;
const footer = `<footer class="shop-footer"><span>额度集市 · 服务次数商店</span><div><a href="/#shop-help">购买帮助</a><a href="/admin">商家管理</a></div></footer>`;
export { quotaPricingFor, selectionFor };
const recentStorage = 'quota-market-recent-orders';
const recentOrders = () => {
  try { return JSON.parse(localStorage.getItem(recentStorage) || '[]').filter(item => item && /^[a-f0-9]{32}$/i.test(item.id) && /^[a-f0-9]{64}$/i.test(item.token)).slice(0, 10); } catch { return []; }
};
const orderLink = order => `/checkout/${encodeURIComponent(order.id)}?token=${encodeURIComponent(order.token)}`;
function rememberOrder(order, token = order.token) {
  if (!/^[a-f0-9]{32}$/i.test(order.id ?? '') || !/^[a-f0-9]{64}$/i.test(token ?? '')) return;
  try { localStorage.setItem(recentStorage, JSON.stringify([{ id: order.id, token, name: order.productName, units: order.units, quota: quotaFor(order.quota), priceCents: order.priceCents, status: order.status, createdAt: order.createdAt }, ...recentOrders().filter(item => item.id !== order.id)].slice(0, 10))); } catch { /* Private browsing can disable persistence; the order URL still works. */ }
}
let cleanupPrevious;
async function request(url, body, signal) {
  const response = await fetch(url, { method: body === undefined ? 'GET' : 'POST', cache: 'no-store', signal,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  let result; try { result = await response.json(); } catch { throw new Error('暂时无法连接，请稍后重试。'); }
  if (!response.ok) throw Object.assign(new Error(typeof result.error === 'string' ? result.error : '操作未完成，请稍后重试。'), { status: response.status });
  return result;
}

/** Customer surfaces: one service, one package, one next action. */
export async function renderShop(app) {
  cleanupPrevious?.(); document.body.classList.add('shop-page'); app.classList.add('shop-root');
  const controller = new AbortController();
  let stopped = false, timer, dialog;
  const cleanup = () => { stopped = true; clearTimeout(timer); controller.abort(); dialog?.remove(); window.removeEventListener('pagehide', cleanup); };
  cleanupPrevious = cleanup; window.addEventListener('pagehide', cleanup);
  const get = url => request(url, undefined, controller.signal), post = (url, body) => request(url, body, controller.signal);
  function openDialog(contents, returnFocus) {
    if (dialog?.open) return null;
    dialog = document.createElement('dialog'); dialog.className = 'shop-dialog'; dialog.setAttribute('aria-labelledby', 'shop-dialog-title');
    dialog.innerHTML = `<button class="shop-dialog-close" type="button" aria-label="关闭窗口">${icon('close')}</button>${contents}`;
    document.body.append(dialog); dialog.showModal();
    const current = dialog;
    const close = () => { current.close(); current.remove(); if (dialog === current) dialog = undefined; if (returnFocus?.isConnected) returnFocus.focus(); };
    current.querySelector('.shop-dialog-close').onclick = close;
    current.addEventListener('cancel', event => { event.preventDefault(); close(); });
    current.addEventListener('click', event => { if (event.target === current) close(); });
    return current;
  }
  function wireHeader() {
    const button = app.querySelector('#shop-recent-open');
    if (!button) return;
    button.onclick = () => {
      const orders = recentOrders();
      openDialog(`<h2 id="shop-dialog-title">我的订单</h2><p class="shop-dialog-intro">仅显示此浏览器保存的最近 10 笔订单。</p>${orders.length ? `<div class="shop-recent-list">${orders.map(order => `<a class="shop-recent-order" href="${orderLink(order)}"><span><strong>${esc(order.name || '服务订单')}</strong><small>${esc(purchaseSummary(order))} · ${esc(statusNames[order.status] || '查看订单')}</small></span><span>¥${money(order.priceCents)} ${icon('arrow', 16)}</span></a>`).join('')}</div>` : '<div class="shop-recent-empty">还没有订单<p>购买后，订单会保存在这里。</p></div>'}<p class="shop-fine-print">更换浏览器时，请使用你保存的完整订单链接。订单链接可领取卡密，请勿转发给他人。</p>`, button);
    };
  }
  function failView(title, message) {
    if (stopped) return;
    app.innerHTML = `${header()}<main class="shop-error-view"><h1>${esc(title)}</h1><p>${esc(message)}</p><div class="shop-error-actions"><a class="shop-button shop-button-primary" href="/">返回商店</a><button class="shop-button" id="shop-retry">重新载入</button></div></main>${footer}`;
    wireHeader(); app.querySelector('#shop-retry').onclick = () => location.reload();
  }
  try {
    const match = location.pathname.match(/^\/checkout\/([^/]+)\/?$/);
    if (match) {
      const orderId = decodeURIComponent(match[1]), token = new URLSearchParams(location.search).get('token');
      if (!token) return failView('订单链接不完整', '请使用下单时保存的完整链接。');
      const route = `/api/shop/orders/${encodeURIComponent(orderId)}?token=${encodeURIComponent(token)}`;
      app.innerHTML = `${header()}<main class="shop-loading" role="status">正在读取订单…</main>${footer}`;
      let order = await get(route); if (stopped) return;
      rememberOrder(order, token);
      app.innerHTML = `${header()}<main class="shop-checkout"><a class="shop-back" href="/">${icon('back', 16)} 返回商店</a><ol class="shop-checkout-steps" aria-label="购买进度"><li data-step="1"><span>1</span>确认订单</li><li data-step="2"><span>2</span>完成付款</li><li data-step="3"><span>3</span>领取激活码</li></ol><div class="shop-checkout-grid"><aside class="shop-order-summary"><p class="shop-section-label">你选择的服务</p><h1 id="shop-order-product"></h1><p class="shop-order-selection" id="shop-order-selection"></p><div class="shop-summary-price"><span>¥</span><strong id="shop-order-amount"></strong></div><span class="shop-order-status" id="shop-order-status" role="status" aria-live="polite"></span><p class="shop-order-deadline" id="shop-order-expiry"></p><details class="shop-order-details"><summary>订单详情</summary><dl><div><dt>订单编号</dt><dd id="shop-order-number"></dd></div><div><dt>服务次数</dt><dd id="shop-order-units"></dd></div></dl><button class="shop-text-button" id="shop-copy-order">${icon('copy', 15)} 复制订单链接</button><p class="shop-fine-print">订单也已保存在「我的订单」。</p><button class="shop-text-button shop-cancel-link" id="shop-cancel-order">取消未付款订单</button></details></aside><section class="shop-payment-section" aria-label="订单处理"><div id="shop-payment-content"></div><p class="shop-connection" id="shop-connection" role="status" aria-live="polite"></p></section></div></main>${footer}`;
      wireHeader();
      app.querySelector('#shop-order-product').textContent = order.productName;
      app.querySelector('#shop-order-selection').textContent = quotaLabel(order.quota) || (order.selectionType === 'custom' ? `自定义 ${number(order.units)} 次` : (order.packageLabel || `${number(order.units)} 次套餐`));
      app.querySelector('#shop-order-amount').textContent = money(order.priceCents);
      app.querySelector('#shop-order-number').textContent = order.orderNo;
      app.querySelector('#shop-order-units').textContent = `${purchaseSummary(order)}，仅限此服务使用`;
      const copy = async (value, button, label) => {
        try { await navigator.clipboard.writeText(value); button.textContent = '已复制'; setTimeout(() => { if (button.isConnected) button.innerHTML = `${icon('copy', 15)} ${esc(label)}`; }, 2000); }
        catch { app.querySelector('#shop-connection').textContent = '复制失败，请长按或选择内容手动复制。'; }
      };
      app.querySelector('#shop-copy-order').onclick = event => copy(location.href, event.currentTarget, '复制订单链接');
      app.querySelector('#shop-cancel-order').onclick = async event => {
        const button = event.currentTarget; button.disabled = true;
        try { order = await post(`/api/shop/orders/${encodeURIComponent(orderId)}/cancel?token=${encodeURIComponent(token)}`, {}); paymentContent(); }
        catch (error) { app.querySelector('#shop-connection').textContent = error.message; button.disabled = false; }
      };
      let fingerprint;
      const paymentContent = () => {
        rememberOrder(order, token);
        const current = `${order.status}|${Boolean(order.qrConfigured)}|${order.payment?.mode}|${order.payment?.configured}|${order.code ?? ''}`;
        app.querySelector('#shop-cancel-order').hidden = order.status !== 'pending';
        app.querySelector('#shop-order-expiry').textContent = order.expiresAt && order.status === 'pending' ? `订单保留至 ${new Date(order.expiresAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}` : '';
        app.querySelector('#shop-order-status').textContent = statusNames[order.status] ?? '处理中';
        app.querySelector('#shop-order-status').dataset.state = order.status;
        const stage = order.status === 'fulfilled' || order.status === 'approved' ? 3 : 2;
        app.querySelectorAll('[data-step]').forEach(step => { step.classList.toggle('is-done', Number(step.dataset.step) < stage || order.status === 'fulfilled'); step.classList.toggle('is-current', Number(step.dataset.step) === stage); });
        if (fingerprint === current) return; fingerprint = current;
        const target = app.querySelector('#shop-payment-content');
        if (order.status === 'fulfilled') {
          target.innerHTML = `<div class="shop-payment-heading"><span class="shop-success-mark">${icon('check', 26)}</span><h2>你的激活码已准备好</h2><p>复制后，到对应服务中兑换次数。</p></div>${order.quota ? `<p class="shop-delivered-quota">${esc(quotaLabel(order.quota))}</p>` : ''}<div class="shop-code-box"><span>激活码</span><code id="shop-delivered-code"></code></div><button class="shop-button shop-button-primary shop-wide" id="shop-copy-code">${icon('copy')} 复制激活码</button><a class="shop-button shop-wide shop-use-link" id="shop-use-service" href="/platform/${encodeURIComponent(order.projectId)}">去兑换使用 ${icon('arrow')}</a><p class="shop-fine-print">仅限「${esc(order.productName)}」使用，每张激活码只能兑换一次。</p><p class="shop-fine-print" id="shop-service-note">当前入口为接入体验页，次数保存在此浏览器账户。已接入的正式服务请使用原账户登录。</p>`;
          target.querySelector('#shop-delivered-code').textContent = order.code ?? '暂未读取到激活码，请刷新订单。';
          const button = target.querySelector('#shop-copy-code'); button.disabled = !order.code; button.onclick = () => copy(order.code, button, '复制激活码');
          // The configured business URL is optional; this fallback remains usable before integration.
          get(`/api/platforms/${encodeURIComponent(order.projectId)}`).then(platform => {
            if (stopped || order.status !== 'fulfilled' || !platform.url) return;
            let url; try { url = new URL(platform.url); } catch { return; }
            if (!['https:', 'http:'].includes(url.protocol)) return;
            const link = target.querySelector('#shop-use-service'), note = target.querySelector('#shop-service-note');
            if (link) { link.href = url.href; link.rel = 'noreferrer'; }
            if (note) note.textContent = order.projectId === 'dingxiaosui' ? '进入丁小穗，点击「激活」，粘贴激活码即可开始创作，无需注册。' : '登录服务平台，在账户中兑换激活码即可使用。';
          }).catch(() => {});
          return;
        }
        if (order.status === 'submitted' || order.status === 'approved') {
          target.innerHTML = `<div class="shop-wait-state"><span class="shop-state-mark">${icon('clock', 28)}</span><h2>${order.status === 'approved' ? '正在发放激活码' : '付款信息已提交'}</h2><p>${order.status === 'approved' ? '付款已确认，稍后即可领取。' : '商家确认到账后，激活码会显示在这里。'}</p><span class="shop-auto-update">页面会自动更新，无需重复提交</span></div>`; return;
        }
        if (['expired', 'cancelled'].includes(order.status)) {
          target.innerHTML = `<div class="shop-wait-state"><span class="shop-state-mark">${icon('clock', 28)}</span><h2>${statusNames[order.status]}</h2><p>如需购买，请重新选择套餐下单。</p><a class="shop-button shop-button-primary" href="/">返回商店</a><p class="shop-fine-print">如果已经付款，请联系商家并提供订单编号，避免重复付款。</p></div>`; return;
        }
        if (order.payment?.mode === 'epay' && order.payment?.configured) {
          const methods = order.payment.enabledMethods ?? ['wxpay'];
          target.innerHTML = `<div class="shop-payment-heading"><h2>选择付款方式</h2><p>付款成功后，激活码会自动发放。</p></div><div class="shop-pay-methods">${methods.map(method => `<button class="shop-button ${methods.length === 1 ? 'shop-button-primary' : ''}" data-pay-method="${esc(method)}">${method === 'alipay' ? '支付宝支付' : '微信支付'} ${icon('arrow')}</button>`).join('')}</div><p class="shop-form-error" id="shop-pay-error" role="alert"></p><p class="shop-fine-print">完成付款后，返回此页面领取激活码。</p>`;
          target.querySelectorAll('[data-pay-method]').forEach(button => button.onclick = async () => {
            const buttons = [...target.querySelectorAll('[data-pay-method]')]; buttons.forEach(item => { item.disabled = true; });
            try { const payment = await post(`/api/shop/orders/${encodeURIComponent(orderId)}/pay?token=${encodeURIComponent(token)}`, { method: button.dataset.payMethod }); const url = new URL(payment.redirectUrl); if (!['https:', 'http:'].includes(url.protocol)) throw new Error('支付地址无效，请联系商家。'); location.assign(url.href); }
            catch (error) { target.querySelector('#shop-pay-error').textContent = error.message; buttons.forEach(item => { item.disabled = false; }); }
          }); return;
        }
        if (!order.qrConfigured) {
          target.innerHTML = `<div class="shop-wait-state"><span class="shop-state-mark">${icon('clock', 28)}</span><h2>商家暂未开启收款</h2><p>订单已保存，现在无需付款。</p><a class="shop-button" href="/">返回商店</a><p class="shop-fine-print">商家开通收款后，可从「我的订单」回来继续。</p></div>`; return;
        }
        const date = new Date(), localTime = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
        target.innerHTML = `<div class="shop-payment-heading"><h2>微信扫码付款</h2><p>请按订单金额支付 <strong>¥${money(order.priceCents)}</strong></p></div><div class="shop-qr-wrap"><img class="shop-payment-qr" src="/payment-qr" alt="商家微信收款码" width="200" height="200"><span>使用微信扫一扫</span></div><details class="shop-proof-details"><summary>我已付款，提交付款信息 ${icon('arrow', 16)}</summary><form id="shop-proof-form" class="shop-proof-form"><label class="shop-field">微信交易单号<input name="reference" maxlength="120" autocomplete="off" required placeholder="在微信账单详情中查看"></label><div class="shop-form-columns"><label class="shop-field">付款时间<input name="paidAt" type="datetime-local" value="${localTime}" required></label><label class="shop-field">付款人昵称 <span>选填</span><input name="payer" maxlength="80" placeholder="便于商家核对"></label></div><p class="shop-form-error" id="shop-proof-error" role="alert"></p><button class="shop-button shop-button-primary shop-wide" type="submit">提交付款信息</button></form></details><p class="shop-fine-print">商家核实到账后发卡，提交信息不会立即认定付款成功。</p>`;
        const form = target.querySelector('#shop-proof-form'), qr = target.querySelector('.shop-payment-qr'); let busy = false;
        qr.onerror = () => { qr.replaceWith(Object.assign(document.createElement('p'), { className: 'shop-form-error', textContent: '收款码未能加载，请稍后重试。' })); form.querySelector('button').disabled = true; };
        form.onsubmit = async event => {
          event.preventDefault(); if (busy || !order.qrConfigured) return; busy = true;
          const button = form.querySelector('button'); button.disabled = true; button.textContent = '正在提交…'; form.querySelector('#shop-proof-error').textContent = '';
          try {
            const data = new FormData(form), paidAt = new Date(data.get('paidAt')); if (!Number.isFinite(paidAt.getTime())) throw new Error('请选择正确的付款时间。');
            order = await post(`/api/shop/orders/${encodeURIComponent(orderId)}/proof?token=${encodeURIComponent(token)}`, { reference: String(data.get('reference')).trim(), payer: String(data.get('payer') || '').trim(), paidAt: paidAt.toISOString() });
            if (!stopped) paymentContent();
          } catch (error) { if (!stopped && form.isConnected) form.querySelector('#shop-proof-error').textContent = error.message; }
          finally { busy = false; if (button.isConnected) { button.disabled = false; button.textContent = '提交付款信息'; } }
        };
      };
      paymentContent();
      const poll = async () => {
        if (stopped || ['fulfilled', 'expired', 'cancelled'].includes(order.status)) return;
        try { order = await get(route); if (stopped) return; app.querySelector('#shop-connection').textContent = ''; paymentContent(); }
        catch (error) { if (stopped) return; app.querySelector('#shop-connection').textContent = [401, 403, 404].includes(error.status) ? '无法读取订单，请使用下单时保存的完整链接。' : '暂时无法更新订单，正在重试…'; if ([401, 403, 404].includes(error.status)) return; }
        if (!stopped && !['fulfilled', 'expired', 'cancelled'].includes(order.status)) timer = setTimeout(poll, 4000);
      };
      if (!['fulfilled', 'expired', 'cancelled'].includes(order.status)) timer = setTimeout(poll, 4000);
      return;
    }

    app.innerHTML = `${header()}<main class="shop-loading" role="status">正在读取服务…</main>${footer}`;
    const result = await get('/api/shop/products'); if (stopped) return;
    const products = (result.products ?? []).filter(product => product.active && Number.isSafeInteger(product.priceCents) && product.priceCents > 0 && Number.isSafeInteger(product.units) && product.units > 0);
    const choices = new Map(products.map(product => {
      const options = optionsFor(product), initial = options.find(option => product.fulfillment === 'on_payment' || option.stockAvailable > 0) ?? options[0], pricing = pricingFor(product);
      const quotaPricing = quotaPricingFor(product), initialQuota = quotaFor(initial.quota) ?? Object.fromEntries(quotaTypes.map(type => [type, quotaPricing ? Math.min(1, quotaPricing.maxCounts[type]) : 0]));
      const stockedCustom = (product.customStock ?? []).find(item => item.available > 0);
      return [product.id, { type: 'package', packageId: initial.id, customQuota: Object.fromEntries(quotaTypes.map(type => [type, String(initialQuota[type])])), customUnits: String(stockedCustom?.units ?? (pricing ? Math.min(pricing.maxUnits, Math.max(pricing.minUnits, product.units)) : product.units)) }];
    }));
    let selectedId = products.find(product => product.id === new URLSearchParams(location.search).get('service'))?.id ?? products[0]?.id;
    app.innerHTML = `${header()}<main class="shop-main"><div class="shop-intro"><h1>购买服务次数</h1><p>选好服务与次数，付款后领取激活码。</p></div>${products.length ? `<div class="shop-purchase-workspace"><aside class="shop-services"><h2><span>1</span>选择服务</h2><div class="shop-service-list" role="tablist" aria-label="服务">${products.map((product, i) => `<button class="shop-service-option" type="button" role="tab" id="shop-service-${i}" data-service="${esc(product.id)}" aria-controls="shop-selected-service" aria-selected="false"><span class="shop-service-symbol" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span><span><strong>${esc(product.name)}</strong><small>${optionsFor(product).length} 种次数套餐</small></span>${icon('arrow', 16)}</button>`).join('')}</div><p class="shop-service-note">不同服务的次数分别使用。</p></aside><section class="shop-selected-service" id="shop-selected-service" role="tabpanel"></section></div>` : '<div class="shop-empty"><h2>服务正在准备中</h2><p>商家上架后，会显示在这里。</p></div>'}<details class="shop-help" id="shop-help" ${location.hash === '#shop-help' ? 'open' : ''}><summary>购买后怎么使用？</summary><ol><li><strong>选择服务与次数</strong><span>下单后，订单会保存在当前浏览器。</span></li><li><strong>完成付款，领取激活码</strong><span>付款确认后，在订单页复制激活码。</span></li><li><strong>到对应服务兑换</strong><span>登录服务平台，兑换后即可使用。</span></li></ol></details></main>${footer}`;
    wireHeader();
    function renderSelection() {
      const product = products.find(item => item.id === selectedId); if (!product) return;
      const options = optionsFor(product), pricing = pricingFor(product), quotaPricing = quotaPricingFor(product), choice = choices.get(product.id);
      const region = app.querySelector('#shop-selected-service');
      app.querySelectorAll('[data-service]').forEach(button => { const selected = button.dataset.service === product.id; button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1; if (selected) region.setAttribute('aria-labelledby', button.id); });
      const optionMarkup = options.map((option, i) => {
        const quota = quotaFor(option.quota);
        const contents = quota
          ? `<strong class="shop-combo-title">${esc(option.label || '组合套餐')}</strong><span class="shop-option-quota">${quotaTypes.filter(type => quota[type] > 0).map(type => `<span>${quotaNames[type]}<b>${number(quota[type])} ${quotaUnits[type]}</b></span>`).join('')}</span>`
          : `<strong>${number(option.units)}<span> 次</span></strong>`;
        return `<button class="shop-package-option ${quota ? 'shop-package-combo' : ''}" type="button" role="radio" aria-checked="false" data-shop-option="${i}">${contents}<span class="shop-option-price">¥${money(option.priceCents)}</span>${quota ? '' : `<span class="shop-option-label">${esc(option.label || '标准套餐')}</span>`}<span class="shop-option-stock">${product.fulfillment === 'on_payment' ? '付款后发卡' : option.stockAvailable > 0 ? '有货' : '暂时缺货'}</span><span class="shop-option-check" aria-hidden="true">${icon('check', 12)}</span></button>`;
      }).join('');
      const quotaControls = quotaPricing ? `<div class="shop-quota-controls" role="group" aria-label="自由组合额度" hidden><p>分别选择需要的额度，不需要的填 0。</p><div class="shop-quota-fields">${quotaTypes.map(type => `<label class="shop-field"><span>${quotaNames[type]}<small>¥${unitMoney(quotaPricing.unitPriceMicros[type])} / ${quotaUnits[type]}</small></span><span class="shop-quota-input-wrap"><input data-quota-type="${type}" type="number" min="0" max="${quotaPricing.maxCounts[type]}" step="1" inputmode="numeric" aria-label="${quotaNames[type]}${type === 'text' ? '次数' : type === 'image' ? '张数' : '个数'}" ${quotaPricing.maxCounts[type] === 0 ? 'disabled' : ''}><span>${quotaUnits[type]}</span></span></label>`).join('')}</div></div>` : '';
      region.innerHTML = `<div class="shop-service-heading"><h2>${esc(product.name)}</h2><p>${esc(product.description || '选择适合你的次数套餐。')}</p></div><div class="shop-package-heading"><h3><span>2</span>选择次数</h3><span>仅限此服务使用</span></div><div class="shop-package-options" role="radiogroup" aria-label="次数套餐">${optionMarkup}${pricing ? '<button class="shop-package-option shop-option-custom" type="button" role="radio" aria-checked="false" data-shop-custom><strong>自定义次数</strong><span class="shop-option-price">选择需要的次数</span><span class="shop-option-check" aria-hidden="true">' + icon('check', 12) + '</span></button>' : ''}${quotaPricing ? `<button class="shop-package-option shop-option-custom" type="button" role="radio" aria-checked="false" data-shop-quota><strong>自由组合</strong><span class="shop-option-price">文案、图片、视频<br>按需选择</span><span class="shop-option-check" aria-hidden="true">${icon('check', 12)}</span></button>` : ''}</div>${pricing ? `<div class="shop-custom-controls" hidden><label class="shop-field">购买次数<input class="shop-custom-input" type="number" min="${pricing.minUnits}" max="${pricing.maxUnits}" step="1" inputmode="numeric" aria-label="自定义购买次数"></label><div class="shop-custom-note"><span>¥${unitMoney(pricing.unitPriceMicros)} / 次</span><p>可选 ${number(pricing.minUnits)}–${number(pricing.maxUnits)} 次</p></div>${product.fulfillment !== 'on_payment' && (product.customStock ?? []).some(item => item.available > 0) ? `<p class="shop-custom-stock">当前可购：${(product.customStock ?? []).filter(item => item.available > 0).map(item => `${number(item.units)} 次`).join('、')}</p>` : ''}</div>` : ''}${quotaControls}<p class="shop-choice-error" role="status" aria-live="polite"></p><div class="shop-buy-bar"><div class="shop-total" aria-live="polite"><span data-selected-label></span><strong><small>¥</small><b data-total></b></strong></div><button class="shop-button shop-button-primary" id="shop-buy">继续下单 ${icon('arrow')}</button></div><p class="shop-buy-note">${result.qrConfigured || result.payment?.configured ? '付款后领取激活码，到对应服务兑换使用。' : '商家暂未开放收款。你可以先查看套餐和订单。'}</p>`;
      const input = region.querySelector('.shop-custom-input'), custom = region.querySelector('.shop-custom-controls'), quotaControlsNode = region.querySelector('.shop-quota-controls'), quotaInputs = [...region.querySelectorAll('[data-quota-type]')], buy = region.querySelector('#shop-buy');
      quotaInputs.forEach(field => { field.value = choice.customQuota[field.dataset.quotaType]; });
      if (input) input.value = choice.customUnits;
      function update() {
        const selected = selectionFor(product, choice);
        region.querySelectorAll('[data-shop-option]').forEach(button => { const checked = choice.type === 'package' && options[Number(button.dataset.shopOption)].id === choice.packageId; button.setAttribute('aria-checked', String(checked)); button.tabIndex = checked ? 0 : -1; });
        const customButton = region.querySelector('[data-shop-custom]');
        if (customButton) { customButton.setAttribute('aria-checked', String(choice.type === 'custom')); customButton.tabIndex = choice.type === 'custom' ? 0 : -1; }
        if (custom) custom.hidden = choice.type !== 'custom';
        const quotaButton = region.querySelector('[data-shop-quota]');
        if (quotaButton) { quotaButton.setAttribute('aria-checked', String(choice.type === 'custom_quota')); quotaButton.tabIndex = choice.type === 'custom_quota' ? 0 : -1; }
        if (quotaControlsNode) quotaControlsNode.hidden = choice.type !== 'custom_quota';
        region.querySelector('[data-selected-label]').textContent = selected.valid ? purchaseSummary(selected) : '请选择次数';
        region.querySelector('[data-total]').textContent = selected.valid ? money(selected.priceCents) : '—';
        region.querySelector('.shop-choice-error').textContent = selected.error || (selected.valid && selected.stock < 1 ? '这个套餐暂时缺货，补货后即可购买。' : '');
        buy.disabled = !selected.valid || selected.stock < 1;
        buy.innerHTML = !selected.valid ? '请填写次数' : selected.stock < 1 ? '暂时缺货' : `${result.qrConfigured || result.payment?.configured ? '继续下单' : '查看订单'} ${icon('arrow')}`;
        if (input) input.setAttribute('aria-invalid', String(choice.type === 'custom' && !selected.valid));
        quotaInputs.forEach(field => field.setAttribute('aria-invalid', String(choice.type === 'custom_quota' && !selected.valid)));
      }
      region.querySelectorAll('[data-shop-option]').forEach(button => button.onclick = () => { choice.type = 'package'; choice.packageId = options[Number(button.dataset.shopOption)].id; update(); });
      region.querySelector('[data-shop-custom]')?.addEventListener('click', () => { choice.type = 'custom'; update(); input.focus(); });
      input?.addEventListener('input', () => { choice.customUnits = input.value; update(); });
      region.querySelector('[data-shop-quota]')?.addEventListener('click', () => { choice.type = 'custom_quota'; update(); quotaInputs.find(field => !field.disabled)?.focus(); });
      quotaInputs.forEach(field => field.addEventListener('input', () => { choice.customQuota[field.dataset.quotaType] = field.value; update(); }));
      update();
      // Keyboard users can switch package choices without traversing every option.
      region.querySelector('.shop-package-options').addEventListener('keydown', event => {
        if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(event.key)) return;
        const buttons = [...region.querySelectorAll('[role="radio"]')], index = buttons.indexOf(document.activeElement); if (index < 0) return;
        event.preventDefault(); const next = buttons[(index + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1) + buttons.length) % buttons.length]; next.click(); next.focus();
      });
      buy.onclick = () => {
        const selection = selectionFor(product, choice); if (!selection.valid || selection.stock < 1) return;
        const enabled = result.qrConfigured || result.payment?.configured;
        const popup = openDialog(`<p class="shop-section-label">确认购买</p><h2 id="shop-dialog-title">${esc(product.name)}</h2><div class="shop-dialog-package"><span>${esc(purchaseSummary(selection))}</span><strong>¥${money(selection.priceCents)}</strong></div><form class="shop-order-form"><label class="shop-field">联系邮箱<input name="email" type="email" autocomplete="email" maxlength="254" required placeholder="填写常用邮箱"></label><p class="shop-field-help">用于联系你，激活码在订单页领取。</p>${enabled ? '' : '<p class="shop-dialog-notice">商家暂未开启收款，现在只创建订单，无需付款。</p>'}<p class="shop-form-error" role="alert"></p><button class="shop-button shop-button-primary shop-wide" type="submit">${enabled ? '创建订单，去付款' : '创建订单'} ${icon('arrow')}</button></form>`, buy);
        if (!popup) return; const form = popup.querySelector('form'); let busy = false;
        form.onsubmit = async event => {
          event.preventDefault(); if (busy) return;
          const latest = selectionFor(product, choice); if (!latest.valid || latest.stock < 1) { form.querySelector('.shop-form-error').textContent = latest.error || '此套餐已缺货，请刷新后选择。'; return; }
          busy = true; const button = form.querySelector('button'); button.disabled = true; button.textContent = '正在创建订单…'; form.querySelector('.shop-form-error').textContent = '';
          try {
            const order = await post('/api/shop/orders', { productId: product.id, email: String(new FormData(form).get('email')).trim(), ...latest.payload });
            if (!order.id || !order.token) throw new Error('订单未能创建，请稍后重试。');
            rememberOrder(order); location.assign(orderLink(order));
          } catch (error) { if (!stopped && form.isConnected) { form.querySelector('.shop-form-error').textContent = error.message; button.disabled = false; button.textContent = enabled ? '创建订单，去付款' : '创建订单'; } busy = false; }
        };
      };
    }
    app.querySelectorAll('[data-service]').forEach(button => button.onclick = () => { selectedId = button.dataset.service; renderSelection(); history.replaceState(null, '', `/?service=${encodeURIComponent(selectedId)}`); });
    app.querySelector('[role="tablist"]')?.addEventListener('keydown', event => {
      if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(event.key)) return;
      const buttons = [...app.querySelectorAll('[data-service]')], index = buttons.indexOf(document.activeElement); if (index < 0) return;
      event.preventDefault(); const next = buttons[(index + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1) + buttons.length) % buttons.length]; next.click(); next.focus();
    });
    renderSelection();
  } catch (error) { if (!stopped && error.name !== 'AbortError') failView('暂时无法打开页面', error.message); }
}
