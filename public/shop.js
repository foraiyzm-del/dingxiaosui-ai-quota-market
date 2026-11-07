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
const header = () => `<header class="shop-header"><div class="shop-header-inner"><a class="shop-brand" href="/" aria-label="额度集市首页"><span class="shop-mark" aria-hidden="true">额</span>额度集市</a><nav class="shop-nav" aria-label="主导航"><a href="/" ${location.pathname === '/' ? 'aria-current="page"' : ''}>服务商店</a>${entitlementEntry ? '<a href="/opcpay">尝鲜卡订单</a>' : ''}<button type="button" id="shop-recent-open">我的订单</button></nav></div></header>${simulationMode ? '<div class="shop-simulation" role="status">本地模拟演示 · 请勿真实付款 · 不调用收费模型</div>' : ''}`;
const footer = `<footer class="shop-footer"><span>额度集市 · 服务次数商店</span><div><a href="/#shop-help">购买帮助</a><a href="/admin">商家管理</a></div></footer>`;
export { quotaPricingFor, selectionFor };
function fixedEntitlementFor(value) {
  const item = value?.package;
  const expected = {trial:[990,10,15,2],week:[2990,30,45,6],month:[9900,100,150,20]}[item?.packageId];
  if (!expected || value?.enabled !== true || item?.projectId !== 'dingxiaosui'
    || item.productId !== 'dingxiaosui-opcpay-'+item.packageId || item.priceCents !== expected[0] || item.amount !== 1
    || item.quota?.text !== expected[1] || item.quota?.image !== expected[2] || item.quota?.video !== expected[3]) return null;
  return { ...item, ready: value.ready === true, sandbox: value.sandbox === true,
    href: value.ready === true ? '/opcpay'+(item.packageId==='trial'?'':'?package='+item.packageId) : null, reason: value.reason || '' };
}
const storeProjects = [
  { id: 'dingxiaosui', name: '丁小穗', mark: '穗', tone: 'purple', tagline: '让农品故事，看得见', summary: '文案、图片、视频创作额度' },
  { id: 'second-project', name: '一二大模型', mark: '一二', tone: 'blue', tagline: '一二大模型', summary: '项目入口' },
  { id: 'jiuqing', name: '酒擎', mark: '酒', tone: 'wine', tagline: '酒擎', summary: '项目入口' },
  { id: 'hongfan-party', name: '红帆党建', mark: '帆', tone: 'red', tagline: '红帆党建', summary: '项目入口' },
];
export function storefrontFor(result, search = '') {
  const enabled = new Set((result.platforms ?? []).filter(platform => platform.enabled === true).map(platform => platform.id));
  if (!storeProjects.every(project => enabled.has(project.id))
    || [...enabled].some(id => !storeProjects.some(project => project.id === id))) return null;
  const selectedId = new URLSearchParams(search).get('project') || 'dingxiaosui';
  const selected = storeProjects.find(project => project.id === selectedId) ?? null;
  const packages = selected?.id === 'dingxiaosui' && Array.isArray(result.storefront?.dingxiaosui?.packages)
    ? result.storefront.dingxiaosui.packages.filter(item => ['trial', 'week', 'month', 'season', 'custom'].includes(item.id)
      && typeof item.label === 'string' && (item.id === 'custom' || (Number.isSafeInteger(item.priceCents) && item.priceCents > 0 && quotaFor(item.quota)))) : [];
  const entitlements = selected?.id === 'dingxiaosui'
    ? (result.entitlement?.packages ?? [result.entitlement]).map(fixedEntitlementFor).filter(Boolean) : [];
  return { projects: storeProjects, selected, packages, entitlements,
    entitlement: selected?.id === 'dingxiaosui' ? fixedEntitlementFor(result.entitlement) : null };
}
export function storefrontSelection(store, id = 'trial', custom = {}) {
  const item = store?.packages?.find(item => item.id === id);
  if (!item || store.selected?.id !== 'dingxiaosui') return null;
  if (id === 'custom') {
    const values = quotaTypes.map(type => String(custom[type] ?? '0').trim());
    const counts = values.map(Number), total = counts.reduce((a,b) => a+b, 0);
    const valid = values.every((value, index) => /^\d+$/.test(value) && Number.isSafeInteger(counts[index]) && counts[index] <= 1000000)
      && total > 0 && total <= 1000000;
    return { ...item, priceCents: null, quota: valid ? Object.fromEntries(quotaTypes.map((type,index) => [type,counts[index]])) : null, href: null };
  }
  const fixed = store.entitlements?.find(value=>value.packageId===id);
  const payable = fixed?.ready && item.priceCents === fixed.priceCents
    && quotaTypes.every(type => item.quota[type] === fixed.quota[type]);
  return { ...item, href: payable ? fixed.href : null, sandbox: fixed?.sandbox === true };
}
function storeProductDetail(store, selection, custom = {}) {
  if (!selection) return '<h1 id="store-title">请选择套餐</h1><p class="store-description">从上方选择需要的额度套餐。</p>';
  const customMode = selection.id === 'custom';
  const quota = customMode ? `<div class="store-custom-fields">${quotaTypes.map(type => `<label>${quotaNames[type]}<span><input data-store-quota="${type}" type="number" min="0" max="1000000" step="1" inputmode="numeric" aria-label="自由组合${quotaNames[type]}次数" value="${esc(custom[type] ?? '0')}"><small>${quotaUnits[type]}</small></span></label>`).join('')}</div><p class="store-custom-message" role="status">${selection.quota ? '已选择 '+esc(quotaLabel(selection.quota)) : '请选择至少一项额度，合计不超过 1,000,000 次。'}</p>`
    : `<dl class="store-quota">${quotaTypes.map(type => `<div><dt>${quotaNames[type]}</dt><dd>${selection.quota[type]}<small>${quotaUnits[type]}</small></dd></div>`).join('')}</dl>`;
  const purchase = selection.href ? `<a class="store-buy" href="${selection.href}">${selection.sandbox ? '模拟购买 · 不扣款' : '支付宝购买'}</a>`
    : `<button class="store-buy" disabled>${customMode ? '自由组合暂未开放购买' : '该套餐暂未开放购买'}</button>`;
  return `<span class="store-status">${selection.href ? '支付宝购买 · 自动发卡' : '套餐预览'}</span><h1 id="store-title">丁小穗${customMode ? '自由组合' : esc(selection.label)}</h1><p class="store-description">文案、图片、视频分别使用，按需选择。</p><div class="store-price"><strong>${customMode ? '价格待配置' : `<small>¥</small>${money(selection.priceCents)}`}</strong><span>${customMode ? '暂不计算金额' : '套餐价格'}</span></div><h2>${customMode ? '选择需要的额度' : '卡内额度'}</h2>${quota}<div class="store-purchase">${purchase}<a class="store-order-link" href="/opcpay">已购买？查看订单与卡密</a></div><p class="store-purchase-note">${selection.href ? '每次购买兑换 1 张卡，仅限丁小穗使用。' : '该套餐暂未开放付款，可选择其他已开放套餐。'}</p>`;
}
function storefrontMarkup(store, selection, custom) {
  const { selected, entitlement } = store;
  const storeHeader = `<header class="shop-header"><div class="shop-header-inner"><a class="shop-brand" href="/" aria-label="额度集市首页"><span class="shop-mark" aria-hidden="true">额</span>额度集市</a><nav class="shop-nav" aria-label="主导航"><a href="/" aria-current="page">服务购买</a><a href="/opcpay">订单查询</a></nav></div></header>`;
  const tabs = `<nav class="store-project-tabs" aria-label="选择项目">${store.projects.map(project => `<a href="/?project=${project.id}" ${selected?.id === project.id ? 'aria-current="page"' : ''}>${project.name}</a>`).join('')}</nav>`;
  const help = `<section class="store-steps" id="shop-help" aria-label="购买后怎么使用"><h2>购买后，三步开始使用</h2><ol><li><span>1</span><div><strong>支付宝购买</strong><p>保存购买账户恢复码</p></div></li><li><span>2</span><div><strong>领取卡密</strong><p>在订单页查看激活码</p></div></li><li><span>3</span><div><strong>到项目激活</strong><p>额度到账，分别使用</p></div></li></ol></section>`;
  const cover = selected ? `<div class="store-cover store-tone-${selected.tone}" aria-label="${selected.name}额度卡"><div class="store-cover-card"><span class="store-card-brand">${selected.name}</span><span class="store-card-mark" aria-hidden="true">${selected.mark}</span><div class="store-card-bottom"><span>${selected.id === 'dingxiaosui' ? '创作额度卡' : '项目入口'}</span><span>${selected.id === 'dingxiaosui' ? '文案 / 图片 / 视频' : '敬请期待'}</span></div></div><p>${selected.tagline}</p></div>` : '';
  const plans = store.packages.length ? `<section class="store-plans" aria-labelledby="store-plans-title"><h2 id="store-plans-title">选择额度套餐</h2><div class="store-plan-grid" role="radiogroup" aria-label="额度套餐">${store.packages.map(item => `<button class="store-plan-option" type="button" role="radio" data-store-package="${item.id}" aria-checked="${selection?.id === item.id}" tabindex="${selection?.id === item.id ? 0 : -1}"><span class="store-plan-title">${esc(item.label)}${item.recommended ? '<small>主推</small>' : ''}</span><span class="store-plan-check" aria-hidden="true">${icon('check',12)}</span>${item.quota ? `<span class="store-plan-counts">${quotaTypes.map(type => `<span><span>${quotaNames[type]}</span><b>${item.quota[type]} ${quotaUnits[type]}</b></span>`).join('')}</span><strong class="store-plan-price">¥${money(item.priceCents)}</strong><span class="store-plan-state">${storefrontSelection(store,item.id)?.href ? (storefrontSelection(store,item.id)?.sandbox ? '模拟购买' : '支付宝购买') : '暂未开放购买'}</span>` : '<span class="store-plan-custom">文案、图片、视频<br>按需选择</span><span class="store-plan-state">价格待配置</span>'}</button>`).join('')}</div></section>` : '';
  const detail = store.packages.length ? `<section class="store-product-info" id="store-product-detail" aria-labelledby="store-title">${storeProductDetail(store, selection, custom)}</section>`
    : selected ? `<section class="store-product-info store-coming" aria-labelledby="store-title"><span class="store-status">项目入口</span><h1 id="store-title">${selected.name}</h1><p class="store-description">${selected.id === 'dingxiaosui' ? '套餐正在准备中，开放后可在这里购买。' : '即将接入额度集市'}</p><div class="store-coming-note"><h2>暂未开放购买</h2><p>套餐上线后，可在这里统一购买和领取卡密。</p></div><button class="store-buy" disabled>敬请期待</button><a class="store-order-link" href="/?project=dingxiaosui">查看丁小穗尝鲜卡</a></section>`
    : '<section class="shop-empty"><h1>此项目不在商城目录中</h1><p>请从上方选择项目。</p><a class="store-order-link" href="/?project=dingxiaosui">查看丁小穗尝鲜卡</a></section>';
  return `${storeHeader}${simulationMode ? '<div class="shop-simulation" role="status">本地模拟演示 · 请勿真实付款</div>' : ''}<main class="store-main"><div class="store-panel"><div class="store-toolbar"><span>选择项目</span>${tabs}</div>${plans}<div class="store-product-layout">${selected ? `<div class="store-visual">${cover}${selected.id === 'dingxiaosui' ? help : ''}</div>` : ''}${detail}</div></div><p class="store-page-note">各项目独立激活，额度不互通。</p></main><footer class="store-footer"><span>额度集市</span><a href="/admin">商家管理</a></footer>`;
}
export function catalogFor(result, search = '') {
  const query = new URLSearchParams(search), projectId = query.get('project') || '';
  const allProducts = (result.products ?? []).filter(product => product.active && Number.isSafeInteger(product.priceCents) && product.priceCents > 0 && Number.isSafeInteger(product.units) && product.units > 0);
  const fixed = fixedEntitlementFor(result.entitlement), platforms = new Map((result.platforms ?? []).map(platform => [platform.id, platform]));
  const ids = new Set([...allProducts.map(product => product.projectId), ...(result.platforms ?? []).filter(platform => platform.enabled === true).map(platform => platform.id)]);
  if (fixed) ids.add(fixed.projectId);
  const projects = [...ids].map(id => ({ id, name: platforms.get(id)?.name || (id === 'dingxiaosui' ? '丁小穗' : id),
    description: platforms.get(id)?.description || '', entryOnly: !allProducts.some(product => product.projectId === id) && fixed?.projectId !== id }));
  const products = projectId ? allProducts.filter(product => product.projectId === projectId) : allProducts;
  return { projects, products, projectId, entitlement: !projectId || projectId === fixed?.projectId ? fixed : null,
    unknownProject: Boolean(projectId && !projects.some(project => project.id === projectId)),
    selectedId: products.find(product => product.id === query.get('service'))?.id ?? products[0]?.id };
}
let entitlementEntry = false, simulationMode = false;
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
  document.body.classList.remove('shop-project-store');
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
      openDialog(`<h2 id="shop-dialog-title">我的订单</h2><p class="shop-dialog-intro">普通订单显示此浏览器保存的最近 10 笔。${entitlementEntry ? '尝鲜卡订单保存在兑换账户中。' : ''}</p>${entitlementEntry ? '<a class="shop-button" href="/opcpay">查看尝鲜卡订单与卡密</a>' : ''}${orders.length ? `<div class="shop-recent-list">${orders.map(order => `<a class="shop-recent-order" href="${orderLink(order)}"><span><strong>${esc(order.name || '服务订单')}</strong><small>${esc(purchaseSummary(order))} · ${esc(statusNames[order.status] || '查看订单')}</small></span><span>¥${money(order.priceCents)} ${icon('arrow', 16)}</span></a>`).join('')}</div>` : '<div class="shop-recent-empty">还没有订单<p>购买后，订单会保存在这里。</p></div>'}<p class="shop-fine-print">更换浏览器时，请使用你保存的完整订单链接。订单链接可领取卡密，请勿转发给他人。</p>`, button);
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
      simulationMode = order.payment?.simulation === true;
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
            if (note) note.textContent = simulationMode ? '进入本项目的模拟接入页，粘贴测试卡激活；这里不是实际业务应用。' : order.projectId === 'dingxiaosui' ? '进入丁小穗，点击「激活」，粘贴激活码即可开始创作，无需注册。' : '登录服务平台，在账户中兑换激活码即可使用。';
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
        target.innerHTML = `<div class="shop-payment-heading"><h2>${simulationMode ? '模拟付款与发卡' : '微信扫码付款'}</h2><p>${simulationMode ? '仅演示订单金额，请勿付款' : '请按订单金额支付'} <strong>¥${money(order.priceCents)}</strong></p></div><div class="shop-qr-wrap"><img class="shop-payment-qr" src="/payment-qr" alt="商家微信收款码" width="200" height="200"><span>${simulationMode ? '演示二维码，不能付款' : '使用微信扫一扫'}</span></div><details class="shop-proof-details"><summary>${simulationMode ? '填写模拟付款信息' : '我已付款，提交付款信息'} ${icon('arrow', 16)}</summary><form id="shop-proof-form" class="shop-proof-form"><label class="shop-field">${simulationMode ? '模拟交易编号' : '微信交易单号'}<input name="reference" maxlength="120" autocomplete="off" required placeholder="${simulationMode ? '填写任意唯一的模拟编号' : '在微信账单详情中查看'}"></label><div class="shop-form-columns"><label class="shop-field">付款时间<input name="paidAt" type="datetime-local" value="${localTime}" required></label><label class="shop-field">付款人昵称 <span>选填</span><input name="payer" maxlength="80" placeholder="便于商家核对"></label></div><p class="shop-form-error" id="shop-proof-error" role="alert"></p><button class="shop-button shop-button-primary shop-wide" type="submit">提交付款信息</button></form></details><p class="shop-fine-print">商家核实到账后发卡，提交信息不会立即认定付款成功。</p>`;
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
    entitlementEntry = result.entitlement?.enabled === true;
    simulationMode = result.payment?.simulation === true;
    const storefront = storefrontFor(result, location.search);
    if (storefront) {
      document.body.classList.add('shop-project-store');
      let packageId = new URLSearchParams(location.search).get('package') || 'trial';
      const custom = { text: '0', image: '0', video: '0' };
      app.innerHTML = storefrontMarkup(storefront, storefrontSelection(storefront, packageId, custom), custom);
      const detail = app.querySelector('#store-product-detail');
      function selectPackage(id) {
        packageId = id;
        const selection = storefrontSelection(storefront, packageId, custom);
        if (!selection || !detail) return;
        app.querySelectorAll('[data-store-package]').forEach(button => {
          const checked = button.dataset.storePackage === packageId;
          button.setAttribute('aria-checked', String(checked)); button.tabIndex = checked ? 0 : -1;
        });
        detail.innerHTML = storeProductDetail(storefront, selection, custom);
        detail.querySelectorAll('[data-store-quota]').forEach(input => input.addEventListener('input', () => {
          custom[input.dataset.storeQuota] = input.value;
          const preview = storefrontSelection(storefront, 'custom', custom);
          detail.querySelector('.store-custom-message').textContent = preview.quota ? '已选择 '+quotaLabel(preview.quota) : '请输入非负整数，合计 1 至 1,000,000 次。';
          input.setAttribute('aria-invalid', String(!preview.quota));
        }));
        const query = new URLSearchParams(location.search); query.set('project', 'dingxiaosui'); query.set('package', packageId);
        history.replaceState(null, '', '/?' + query);
      }
      app.querySelectorAll('[data-store-package]').forEach(button => button.addEventListener('click', () => selectPackage(button.dataset.storePackage)));
      app.querySelector('.store-plan-grid')?.addEventListener('keydown', event => {
        if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
        const buttons = [...app.querySelectorAll('[data-store-package]')], index = buttons.indexOf(document.activeElement);
        if (index < 0) return;
        event.preventDefault(); const next = buttons[(index + (['ArrowLeft','ArrowUp'].includes(event.key) ? -1 : 1) + buttons.length) % buttons.length];
        next.click(); next.focus();
      });
      if (packageId === 'custom') selectPackage(packageId);
      return;
    }
    const catalog = catalogFor(result, location.search), { products, projects, projectId, entitlement } = catalog;
    const choices = new Map(products.map(product => {
      const options = optionsFor(product), initial = options.find(option => product.fulfillment === 'on_payment' || option.stockAvailable > 0) ?? options[0], pricing = pricingFor(product);
      const quotaPricing = quotaPricingFor(product), initialQuota = quotaFor(initial.quota) ?? Object.fromEntries(quotaTypes.map(type => [type, quotaPricing ? Math.min(1, quotaPricing.maxCounts[type]) : 0]));
      const stockedCustom = (product.customStock ?? []).find(item => item.available > 0);
      return [product.id, { type: 'package', packageId: initial.id, customQuota: Object.fromEntries(quotaTypes.map(type => [type, String(initialQuota[type])])), customUnits: String(stockedCustom?.units ?? (pricing ? Math.min(pricing.maxUnits, Math.max(pricing.minUnits, product.units)) : product.units)) }];
    }));
    let selectedId = catalog.selectedId;
    const selectedProject = projects.find(project => project.id === projectId);
    const entitlementMarkup = entitlement ? `<section class="shop-entitlement" aria-labelledby="shop-entitlement-title"><div><p class="shop-entitlement-label">丁小穗 · 固定套餐</p><h2 id="shop-entitlement-title">丁小穗尝鲜卡</h2><p class="shop-entitlement-quota">${esc(quotaLabel(entitlement.quota))}</p><p class="shop-entitlement-note">本次仅此卡支持支付宝购买。购买 1 次权益，兑换 1 张完整额度卡。</p></div><div class="shop-entitlement-actions"><strong class="shop-entitlement-price"><small>¥</small>${money(entitlement.priceCents)}</strong>${entitlement.ready ? `<a class="shop-button shop-button-primary" href="${entitlement.href}">${entitlement.sandbox ? '模拟购买 · 不扣款' : '支付宝购买'} ${icon('arrow')}</a>` : '<button class="shop-button shop-button-primary" disabled>暂未开放购买</button>'}<a class="shop-text-button" href="/opcpay">查看尝鲜卡订单与卡密</a>${entitlement.ready ? '' : `<p class="shop-choice-error">${esc(entitlement.reason || '套餐正在准备中')}</p>`}</div></section>` : '';
    const emptyMarkup = entitlement ? '' : selectedProject?.entryOnly
      ? `<section class="shop-empty shop-project-entry"><h2>${esc(selectedProject.name)} · 项目入口</h2><p>${esc(selectedProject.description || '项目正在准备接入独立商城。')}</p><p>购买与计费尚未接入，暂不提供下单。</p></section>`
      : '<div class="shop-empty"><h2>服务正在准备中</h2><p>商家上架后，会显示在这里。</p></div>';
    const projectSelector = `<div class="shop-project-picker"><label for="shop-project">选择项目</label><select id="shop-project"><option value="">全部项目</option>${projects.map(project => `<option value="${esc(project.id)}" ${project.id === projectId ? 'selected' : ''}>${esc(project.name)}${project.entryOnly ? '（入口）' : ''}</option>`).join('')}${catalog.unknownProject ? `<option value="${esc(projectId)}" selected>此项目暂无在售套餐</option>` : ''}</select><p>各项目额度分别计算，卡密仅限对应项目。</p></div>`;
    app.innerHTML = `${header()}<main class="shop-main"><div class="shop-intro"><h1>选择项目，购买服务次数</h1><p>统一下单，在对应项目激活，按文案、图片、视频分别扣次。</p></div>${projectSelector}${entitlementMarkup}${products.length ? `<div class="shop-purchase-workspace"><aside class="shop-services"><h2><span>1</span>选择服务</h2><div class="shop-service-list" role="tablist" aria-label="服务">${products.map((product, i) => `<button class="shop-service-option" type="button" role="tab" id="shop-service-${i}" data-service="${esc(product.id)}" aria-controls="shop-selected-service" aria-selected="false"><span class="shop-service-symbol" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span><span><strong>${esc(product.name)}</strong><small>${esc(projects.find(project => project.id === product.projectId)?.name || product.projectId)} · ${optionsFor(product).length} 种套餐</small></span>${icon('arrow', 16)}</button>`).join('')}</div><p class="shop-service-note">不同服务的次数分别使用。</p></aside><section class="shop-selected-service" id="shop-selected-service" role="tabpanel"></section></div>` : emptyMarkup}<details class="shop-help" id="shop-help" ${location.hash === '#shop-help' ? 'open' : ''}><summary>购买后怎么使用？</summary><ol><li><strong>选择服务与次数</strong><span>下单后，订单会保存在当前浏览器。</span></li><li><strong>完成付款，领取激活码</strong><span>付款确认后，在订单页复制激活码。</span></li><li><strong>到对应服务兑换</strong><span>登录服务平台，兑换后即可使用。</span></li></ol></details></main>${footer}`;
    wireHeader();
    app.querySelector('#shop-project').onchange = event => {
      const query = new URLSearchParams();
      if (event.target.value) query.set('project', event.target.value);
      location.assign('/' + (query.size ? '?' + query : ''));
    };
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
    app.querySelectorAll('[data-service]').forEach(button => button.onclick = () => { selectedId = button.dataset.service; renderSelection(); const query = new URLSearchParams(location.search); query.set('service', selectedId); history.replaceState(null, '', '/?' + query); });
    app.querySelector('[role="tablist"]')?.addEventListener('keydown', event => {
      if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(event.key)) return;
      const buttons = [...app.querySelectorAll('[data-service]')], index = buttons.indexOf(document.activeElement); if (index < 0) return;
      event.preventDefault(); const next = buttons[(index + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1) + buttons.length) % buttons.length]; next.click(); next.focus();
    });
    renderSelection();
  } catch (error) { if (!stopped && error.name !== 'AbortError') failView('暂时无法打开页面', error.message); }
}
