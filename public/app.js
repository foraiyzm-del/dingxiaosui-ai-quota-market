import { renderShop } from '/shop.js';
import { createAdminExtensions } from '/admin-extensions.js';
import { renderPlatform } from '/platform.js';
import { installPackageQuota, readPackageQuota, loadCombinationSettings, readCombinationSettings, quotaSummary } from '/combination-editor.js';
document.title = location.pathname === '/admin' ? '额度集市 · 管理后台' : location.pathname === '/demo' ? '额度集市 · 兑换体验' : location.pathname.startsWith('/checkout/') ? '额度集市 · 订单与付款' : '额度集市 · AI 服务次数商店';
const app = document.querySelector('#app');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = cents => (cents / 100).toFixed(2);
const date = value => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';
const brand = '<div class="brand"><span class="brand-mark">额</span><span>额度集市</span></div>';
const capabilityNames = { text:'文字生成', image:'图片生成', video:'视频生成' };
let tab = ['overview','payments','platforms','products','channels','quotas','usage','settings'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'overview', state, poll;
let toastTimer, orderFilter='all';
function toast(message) { const el = document.querySelector('#toast'); el.textContent = message; el.classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('visible'), 5000); }
async function api(route, options = {}) {
  const res = await fetch(route, { ...options, headers: { ...(options.body && !(options.body instanceof File) ? {'content-type':'application/json'} : {}), ...options.headers } });
  const data = await res.json(); if (!res.ok) throw Object.assign(new Error(data.error ?? '请求失败'), { status: res.status }); return data;
}
const post = (route, body = {}) => api(route, { method: 'POST', body: JSON.stringify(body) });
const statusNames = { pending:'待付款', fulfilled:'已发卡', awaiting_payment:'待付款', submitted:'待核验', approved:'到账已核实', delivered:'已发卡', unused:'未兑换', redeemed:'已兑换', reserved:'预扣中', committed:'已消费', cancelled:'已取消', expired:'已过期', available:'可售', sold:'已售', revoked:'已停用', queued:'等待执行', running:'执行中', ready:'待交付', succeeded:'成功', failed:'失败', uncertain:'待核对' };
const badge = s => `<span class="badge ${s === 'fulfilled' || s === 'delivered' || s === 'committed' || s === 'redeemed' || s === 'succeeded' || s === 'sold' ? 'good' : s === 'submitted' || s === 'reserved' || s === 'uncertain' || s === 'running' || s === 'queued' ? 'wait' : 'blue'}">${esc(statusNames[s] ?? s)}</span>`;
function empty(title, body) { return `<div class="empty"><strong>${esc(title)}</strong><p class="small">${esc(body)}</p></div>`; }
function metric(label, number, unit = '') { return `<div class="metric"><span>${esc(label)}</span><strong>${esc(number)}</strong><em>${esc(unit)}</em></div>`; }
function login() {
  app.innerHTML = `<div class="login-wrap"><div class="login">${brand}<div class="eyebrow">商家管理</div><h1>登录工作台</h1><p>管理商品、卡密和收款。</p><form id="login-form"><label class="field">管理密码<input name="password" type="password" autocomplete="current-password" required placeholder="输入本机管理密码"></label><div class="inline-error" id="login-error"></div><button class="primary">进入工作台</button></form><footer>管理密码见本机项目的 local/ACCESS.md</footer></div></div>`;
  document.querySelector('#login-form').onsubmit = async e => { e.preventDefault(); const button = e.target.querySelector('button'); button.disabled = true; try { await post('/api/admin/login', { password: new FormData(e.target).get('password') }); await refresh(); } catch (err) { document.querySelector('#login-error').textContent = err.message; button.disabled = false; } };
}
async function refresh() { try { state = await api('/api/admin/state'); render(); } catch (err) { if (err.status === 401) login(); else toast(err.message); } }
function render() {
  const pending = state.payments.filter(p => p.status === 'submitted').length;
  const names = { overview:'经营概览', payments:'收款订单', platforms:'业务平台', products:'商品套餐', quotas:'卡密库存', channels:'API 渠道', usage:'调用记录', settings:'收款设置' };
  const extensions=createAdminExtensions({state,esc,money,date,heading,metric,badge,empty,api,post,toast,refresh});
  const groups=[['日常管理',['overview','payments','quotas','usage']],['商品与服务',['platforms','products']],['系统设置',['channels','settings']]];
  app.innerHTML = `<aside class="sidebar">${brand}<nav class="nav" aria-label="管理导航">${groups.map(([label,keys])=>`<div class="nav-group"><div class="nav-group-title">${label}</div>${keys.map(key=>`<button data-tab="${key}" class="${tab===key?'active':''}" ${tab===key?'aria-current="page"':''}>${names[key]}${key==='payments'&&pending?`<span class="nav-count">${pending}</span>`:''}</button>`).join('')}</div>`).join('')}</nav><div class="sidebar-bottom"><a href="/" target="_blank" rel="noreferrer">查看商城 ↗</a><button class="quiet" id="logout">退出登录</button></div></aside><div class="shell"><header class="topbar"><span>商家工作台 <span class="muted">/</span> <strong>${names[tab]}</strong></span><div class="links"><a href="/" target="_blank" rel="noreferrer">查看商城 ↗</a></div></header><main class="content">${tab==='overview'?extensions.renderOverview():tab==='payments'?paymentsView():tab==='platforms'?extensions.renderPlatforms():tab==='products'?productsView():tab==='channels'?channelsView():tab==='quotas'?extensions.renderInventory():tab==='usage'?extensions.renderUsage():extensions.renderSettings()}</main></div>`;
  document.querySelectorAll('[data-tab]').forEach(el => el.onclick = () => { tab = el.dataset.tab; history.replaceState(null, '', `#${tab}`); render(); });
  document.querySelector('#logout').onclick = async () => { await post('/api/admin/logout'); login(); };
  document.querySelector('#refresh')?.addEventListener('click', refresh);
  document.querySelectorAll('[data-approve]').forEach(el => el.onclick = () => approveDialog(el.dataset.approve));
  document.querySelectorAll('[data-retry]').forEach(el => el.onclick = async () => { el.disabled = true; try { const result = await post(`/api/admin/shop-orders/${el.dataset.retry}/approve`, {verifiedReference:state.payments.find(p=>p.id===el.dataset.retry).verifiedReference,confirmed:true}); toast(result.status==='fulfilled'?'卡密已发放':'核账已保存，发卡待重试'); await refresh(); } catch (err) { toast(err.message); el.disabled = false; } });
  document.querySelector('#upload-form')?.addEventListener('submit', upload);
  document.querySelector('#product-form')?.addEventListener('submit', saveProduct);
  document.querySelector('#channel-form')?.addEventListener('submit', saveChannel);
  extensions.wire();
  wireChannelEditor();
  wireProductEditor();
  document.querySelectorAll('[data-edit-product]').forEach(button => button.onclick = () => {
    const product = state.products.find(p=>p.id===button.dataset.editProduct), form = document.querySelector('#product-form');
    loadProductEditor(form, product);
    document.querySelector('#product-editor-title').textContent='编辑商品';
  });
  document.querySelectorAll('[data-order-filter]').forEach(button=>button.onclick=()=>{orderFilter=button.dataset.orderFilter;render();});
  prepareEditorDialogs();
}
function heading(title, desc) { return `<div class="heading"><div><h1>${title}</h1><p>${desc}</p></div><div class="toolbar"><button class="quiet" id="refresh" aria-label="刷新当前页面">刷新</button></div></div>`; }
function prepareEditorDialogs() {
  const editors=[
    {form:'product-form',button:'new-product',edit:'data-edit-product',label:'新增商品'},
    {form:'channel-form',button:'new-channel',edit:'data-edit-channel',label:'添加 API 渠道'},
    {form:'platform-form',button:'new-platform',edit:'data-edit-platform',label:'新增平台'},
    {form:'inventory-form',button:'new-inventory',label:'批量制卡'},
  ];
  for(const item of editors) {
    const form=document.getElementById(item.form); if(!form) continue;
    const panel=form.closest('.panel'), title=panel?.querySelector('.panel-head h2'); if(!panel||!title) continue;
    const dialog=document.createElement('dialog'); dialog.className='admin-dialog'; dialog.id=`${item.form}-dialog`;
    if(!title.id) title.id=item.form==='product-form'?'product-editor-title':`${item.form}-title`;
    dialog.setAttribute('aria-labelledby',title.id);
    let button=document.getElementById(item.button);
    if(!button) {button=document.createElement('button');button.id=item.button;button.type='button';}
    button.className='primary'; button.textContent=item.label;
    document.querySelector('.heading .toolbar').append(button);
    const head=document.createElement('div');head.className='dialog-head';head.append(title);
    const close=document.createElement('button');close.type='button';close.className='dialog-close';close.textContent='×';close.setAttribute('aria-label','关闭表单');head.append(close);
    const body=panel.querySelector('.panel-body');body.classList.add('dialog-body');
    dialog.append(head,body);panel.replaceWith(dialog);
    const open=()=>{if(!dialog.open)dialog.showModal();form.elements.namedItem('name')?.focus();};
    form.addEventListener('invalid',event=>{
      let ancestor=event.target.parentElement;
      while(ancestor&&ancestor!==form){if(ancestor.tagName==='DETAILS')ancestor.open=true;ancestor=ancestor.parentElement;}
    },true);
    button.addEventListener('click',open);
    if(item.edit)document.querySelectorAll(`[${item.edit}]`).forEach(trigger=>trigger.addEventListener('click',open));
    close.onclick=()=>dialog.close();
    form.querySelector('.product-form-actions')?.classList.add('dialog-actions');
    const idField=form.elements.namedItem('id')?.closest('.field');
    if(idField) {
      const settings=document.createElement('details');settings.className='inline-disclosure editor-identity';
      const summary=document.createElement('summary');summary.textContent='内部标识';settings.append(summary);
      const row=idField.parentElement; settings.append(idField); if(row?.classList.contains('form-row')&&row.children.length===1)row.classList.add('single-field');
      form.insertBefore(settings,form.querySelector('.product-form-actions'));
    }
  }
}
function productOptions(product) {
  return Array.isArray(product?.packageOptions) && product.packageOptions.length
    ? product.packageOptions
    : [{ id:'standard', label:'标准套餐', units:product?.units ?? 100, priceCents:product?.priceCents ?? 1990 }];
}
function microsToYuan(value) {
  const amount=BigInt(value), whole=amount/1000000n, fraction=String(amount%1000000n).padStart(6,'0').replace(/0+$/,'');
  return `${whole}${fraction?'.'+fraction:''}`;
}
function parseYuan(value, decimals, label, maximum) {
  const raw=String(value??'').trim(), match=raw.match(new RegExp(`^(\\d{1,13})(?:\\.(\\d{1,${decimals}}))?$`));
  if(!match) throw new Error(`${label}请输入正数，最多 ${decimals} 位小数`);
  const amount=BigInt(match[1])*10n**BigInt(decimals)+BigInt((match[2]??'').padEnd(decimals,'0'));
  if(amount<1n||amount>BigInt(maximum)) throw new Error(`${label}超出允许范围`);
  return Number(amount);
}
function parseUnits(value,label) {
  const raw=String(value??'').trim(), number=Number(raw);
  if(!/^\d+$/.test(raw)||!Number.isSafeInteger(number)||number<1||number>1000000) throw new Error(`${label}必须是 1 到 1000000 之间的整数`);
  return number;
}
function packageEditorRow(option) {
  return `<div class="package-editor-row" data-package-id="${esc(option.id)}"><label class="field package-label-field">套餐名称<input data-package-label maxlength="80" required value="${esc(option.label)}" placeholder="例如 50 次套餐"></label><label class="field">使用次数<input data-package-units type="number" min="1" max="1000000" step="1" required value="${esc(option.units)}"></label><label class="field">价格（元）<input data-package-price type="number" min="0.01" max="1000000" step="0.01" required value="${money(option.priceCents)}"></label><label class="field sku-description-field">套餐说明<textarea data-package-description maxlength="500" rows="2" placeholder="例如适合小批量产品设计">${esc(option.description??'')}</textarea></label><button type="button" class="package-remove quiet" data-remove-package aria-label="删除${esc(option.label)}套餐">删除套餐</button></div>`;
}
function updatePackageButtons(form) {
  const rows=form.querySelectorAll('[data-package-id]');
  form.querySelector('#add-package').disabled=rows.length>=12;
  rows.forEach(row=>row.querySelector('[data-remove-package]').disabled=rows.length<=1);
  form.querySelector('#package-count').textContent=`${rows.length} / 12 个选项`;
}
function renderPackageRows(form,options) {
  form.querySelector('#package-rows').innerHTML=options.map(packageEditorRow).join('');
  [...form.querySelectorAll('[data-package-id]')].forEach((row, index) => installPackageQuota(row, options[index].quota));
  updatePackageButtons(form);
}
function showCustomPricing(form) {
  const enabled=form.elements.namedItem('customEnabled').checked, fields=form.querySelector('#custom-pricing-fields');
  fields.hidden=!enabled;
  fields.querySelectorAll('input').forEach(input=>input.disabled=!enabled);
}
function productPlatformName(projectId) {
  return (state.platforms??[]).find(platform=>platform.id===projectId)?.name
    ?? (state.projects??[]).find(project=>project.id===projectId)?.name
    ?? projectId;
}
function productPlatformOptions(projectId) {
  const platforms=state.platforms??[];
  const options=platforms.map(platform=>`<option value="${esc(platform.id)}" ${platform.id===projectId?'selected':''}>${esc(platform.name)}${platform.enabled===false?'（已停用）':''}</option>`);
  if(projectId&&!platforms.some(platform=>platform.id===projectId)) {
    options.push(`<option value="${esc(projectId)}" selected>${esc(productPlatformName(projectId))} · 历史平台（请配置接入）</option>`);
  }
  return options.length?options.join(''):'<option value="" selected disabled>请先在「业务平台」创建平台</option>';
}
function loadProductEditor(form,product) {
  if(!form) return;
  for(const name of ['id','name','description']) form.elements.namedItem(name).value=product?.[name]??'';
  form.elements.namedItem('id').value=product?.id??`product-${crypto.randomUUID().slice(0,8)}`;
  const title=document.querySelector('#product-editor-title');if(title)title.textContent=product?'编辑商品':'新增商品';
  form.elements.namedItem('id').readOnly=!!product;
  const platformSelect=form.elements.namedItem('projectId');
  platformSelect.innerHTML=productPlatformOptions(product?.projectId);
  if(product?.projectId) platformSelect.value=product.projectId;
  form.elements.namedItem('units').value=product?.units??100;
  form.elements.namedItem('price').value=money(product?.priceCents??1990);
  form.elements.namedItem('active').checked=product?.active??true;
  renderPackageRows(form,productOptions(product));
  const custom=product?.customPricing??{enabled:false,minUnits:1,maxUnits:10000,unitPriceMicros:Math.max(1,Math.round((product?.priceCents??1990)*10000/(product?.units??100)))};
  form.customPricingDefaults={...custom};
  form.elements.namedItem('customEnabled').checked=custom.enabled===true;
  form.elements.namedItem('customMinUnits').value=custom.minUnits;
  form.elements.namedItem('customMaxUnits').value=custom.maxUnits;
  form.elements.namedItem('customUnitPrice').value=microsToYuan(custom.unitPriceMicros);
  showCustomPricing(form);
  loadCombinationSettings(form,product);
}
function wireProductEditor() {
  const form=document.querySelector('#product-form'); if(!form) return;
  loadProductEditor(form);
  form.querySelector('#add-package').onclick=()=>{
    if(form.querySelectorAll('[data-package-id]').length>=12) return toast('每个商品最多支持 12 种套餐');
    const units=Number(form.elements.namedItem('units').value)||100, price=Number(form.elements.namedItem('price').value)||19.9;
    form.querySelector('#package-rows').insertAdjacentHTML('beforeend',packageEditorRow({id:`pkg-${crypto.randomUUID()}`,label:'新次数套餐',units,priceCents:Math.round(price*100)}));
    installPackageQuota(form.querySelector('[data-package-id]:last-child'));
    updatePackageButtons(form);
  };
  form.querySelector('#package-rows').onclick=e=>{
    const button=e.target.closest('[data-remove-package]'); if(!button) return;
    if(form.querySelectorAll('[data-package-id]').length<=1) return;
    button.closest('[data-package-id]').remove(); updatePackageButtons(form);
  };
  form.querySelector('#package-rows').oninput=e=>{
    const row=e.target.closest('[data-package-id]'); if(row!==form.querySelector('[data-package-id]')) return;
    if(e.target.matches('[data-package-units]')) form.elements.namedItem('units').value=e.target.value;
    if(e.target.matches('[data-package-price]')) form.elements.namedItem('price').value=e.target.value;
  };
  for(const [name,selector] of [['units','[data-package-units]'],['price','[data-package-price]']]) {
    form.elements.namedItem(name).oninput=e=>{
      const standard=[...form.querySelectorAll('[data-package-id]')].find(row=>row.dataset.packageId==='standard');
      if(standard) standard.querySelector(selector).value=e.target.value;
    };
  }
  form.elements.namedItem('customEnabled').onchange=()=>showCustomPricing(form);
  document.querySelector('#new-product').onclick=()=>{form.reset();loadProductEditor(form);form.elements.namedItem('id').focus();};
}
function productsView() {
  return heading('商品套餐','设置每个服务的次数和售价。') + `<div class="panel"><div class="panel-head"><h2>在售与下架商品</h2><span class="muted small">共 ${state.products.length} 件</span></div><div class="table-scroll"><table><thead><tr><th>商品</th><th>所属平台</th><th>默认次数</th><th>默认售价</th><th>状态</th><th>操作</th></tr></thead><tbody>${state.products.map(p=>`<tr><td>${esc(p.name)}<div class="sub">${productOptions(p).length} 种套餐${p.customPricing?.enabled||p.quotaPricing?.enabled?' · 可自定义':''}</div></td><td>${esc(productPlatformName(p.projectId))}</td><td>${esc(quotaSummary(productOptions(p)[0]?.quota)||`${p.units} 次`)}<div class="sub">${p.fulfillment==='on_payment'?'到账自动制卡':'库存发卡'}</div></td><td>¥${money(p.priceCents)}</td><td><span class="badge ${p.active?'good':''}">${p.active?'上架中':'已下架'}</span></td><td><button data-edit-product="${esc(p.id)}">编辑</button></td></tr>`).join('')}</tbody></table></div></div><div class="panel"><div class="panel-head"><h2>新增商品</h2><button type="button" id="new-product">新建商品</button></div><div class="panel-body"><form id="product-form" class="stack"><div class="form-row"><label class="field">商品标识<input name="id" required placeholder="例如 ai-assistant" pattern="[A-Za-z0-9._-]+"></label><label class="field">所属平台<select name="projectId" required>${productPlatformOptions()}</select></label></div><label class="field">商品名称<input name="name" required placeholder="例如 包装设计平台"></label><label class="field">商品说明<textarea name="description" rows="2" placeholder="说明这个平台提供的服务和使用范围"></textarea></label><div class="form-row" hidden><label class="field">默认次数<input name="units" type="number" min="1" max="1000000" step="1" value="100" required></label><label class="field">默认价格（元）<input name="price" type="number" min="0.01" max="1000000" step="0.01" value="19.90" required></label></div><section class="product-config"><div class="product-config-heading"><div><h3>次数套餐</h3><p class="small">填写用户可购买的次数与价格。</p></div><span id="package-count" class="muted small"></span></div><div id="package-rows" class="package-editor-list"></div><button type="button" id="add-package">＋ 添加套餐</button></section><section class="product-config"><label class="checkbox product-custom-toggle"><input name="customEnabled" type="checkbox"><span><strong>允许客户自定义次数</strong><span class="sub">按单次价格计费，销售前需生成对应次数的库存卡。</span></span></label><div id="custom-pricing-fields" class="custom-pricing-fields" hidden><label class="field">每次单价（元）<input name="customUnitPrice" type="number" min="0.000001" max="1000000" step="0.000001" required></label><label class="field">最少次数<input name="customMinUnits" type="number" min="1" max="1000000" step="1" required></label><label class="field">最多次数<input name="customMaxUnits" type="number" min="1" max="1000000" step="1" required></label></div></section><div class="product-form-actions"><label class="checkbox"><input name="active" type="checkbox" checked><span>上架销售</span></label><button class="primary" type="submit">保存商品</button></div></form></div></div><p class="small">先添加业务平台，再设置它的商品和套餐。</p>`;
}
async function saveProduct(e) {
  e.preventDefault(); const form=e.target,data=new FormData(form),button=e.submitter??form.querySelector('[type=submit]'); button.disabled=true;
  try {
    const first=form.querySelector('[data-package-id]');
    const units=parseUnits(first?.querySelector('[data-package-units]')?.value??data.get('units'),'套餐次数'),priceCents=parseYuan(first?.querySelector('[data-package-price]')?.value??data.get('price'),2,'套餐价格',100000000);
    const rows=[...form.querySelectorAll('[data-package-id]')];
    if(rows.length<1||rows.length>12) throw new Error('请保留 1 到 12 种套餐');
    const ids=new Set();
    const packageOptions=rows.map((row,index)=>{
      const id=row.dataset.packageId,label=row.querySelector('[data-package-label]').value.trim();
      if(ids.has(id)) throw new Error('套餐标识重复，请重新添加该套餐'); ids.add(id);
      if(!label||label.length>80) throw new Error(`套餐 ${index+1} 的名称须为 1 到 80 个字符`);
      const description=row.querySelector('[data-package-description]').value.trim();
      if(description.length>500) throw new Error(`套餐 ${index+1} 的说明不能超过 500 个字符`);
      const quota=readPackageQuota(row);
      return {id,label,units:quota?Object.values(quota).reduce((a,b)=>a+b,0):parseUnits(row.querySelector('[data-package-units]').value,`套餐 ${index+1} 次数`),priceCents:parseYuan(row.querySelector('[data-package-price]').value,2,`套餐 ${index+1} 价格`,100000000),projectId:data.get('projectId'),description,capabilities:[],apiBindings:[],quota:quota??null};
    });
    const enabled=data.get('customEnabled')==='on';
    let customPricing={...form.customPricingDefaults,enabled};
    if(enabled) {
      customPricing={enabled,minUnits:parseUnits(data.get('customMinUnits'),'最少次数'),maxUnits:parseUnits(data.get('customMaxUnits'),'最多次数'),unitPriceMicros:parseYuan(data.get('customUnitPrice'),6,'每次单价',1000000000000)};
      if(customPricing.minUnits>customPricing.maxUnits) throw new Error('最少次数不能大于最多次数');
    }
    await post('/api/admin/products',{id:data.get('id'),projectId:data.get('projectId'),name:data.get('name'),description:data.get('description'),units,priceCents,active:data.get('active')==='on',packageOptions,customPricing,...readCombinationSettings(form,parseYuan)});
    toast('商品已保存'); await refresh();
  } catch(err) {toast(err.message);button.disabled=false;}
}
function channelsView() {
  const channels=state.channels??[];
  return heading('API 渠道','统一保存中转站接口，供业务平台调用。')+`<div class="panel"><div class="panel-head"><h2>已配置渠道</h2><span class="muted small">${channels.length} 个渠道 · ${channels.filter(channel=>channel.enabled).length} 个启用</span></div>${!channels.length?empty('添加第一个 API 渠道','点击“添加 API 渠道”，填写中转站提供的地址和密钥。'):`<div class="table-scroll"><table class="channels-table"><thead><tr><th>渠道 / 地址</th><th>可用模型</th><th>密钥</th><th>状态</th><th>操作</th></tr></thead><tbody>${channels.map(channel=>`<tr><td><strong>${esc(channel.name)}</strong><div class="sub mono channel-address">${esc(channel.baseUrl)}</div></td><td><div class="channel-model-summary">${Object.entries(capabilityNames).filter(([key])=>channel.models.some(model=>model.capability===key)).map(([key,name])=>`<span>${name}<b>${channel.models.filter(model=>model.capability===key).length}</b></span>`).join('')}</div></td><td><span class="mono">${esc(channel.hasKey?(channel.keyHint||'已保存'):'未设置')}</span></td><td><span class="badge ${channel.enabled?'good':''}">${channel.enabled?'已启用':'已停用'}</span></td><td><button data-edit-channel="${esc(channel.id)}">编辑</button></td></tr>`).join('')}</tbody></table></div>`}</div><div class="panel"><div class="panel-head"><h2 id="channel-editor-title">新增 API 渠道</h2><button type="button" id="new-channel">新建渠道</button></div><div class="panel-body"><form id="channel-form" class="stack"><div class="form-row"><label class="field">渠道标识<input name="id" required maxlength="64" pattern="[A-Za-z0-9][A-Za-z0-9._-]*" placeholder="例如 relay-main"><span class="sub">系统已自动填写，保存后固定。</span></label><label class="field">渠道名称<input name="name" maxlength="160" required placeholder="例如 主用中转站"></label></div><label class="field">接口基础地址<input name="baseUrl" type="url" required maxlength="2000" placeholder="https://example.com/v1" autocomplete="off"><span class="sub">如接口地址包含 /v1，请一并填写。</span></label><label class="field">API 密钥<input name="apiKey" type="password" required maxlength="4096" placeholder="输入此渠道的 API Key" autocomplete="new-password" spellcheck="false"><span class="sub" id="channel-key-hint">密钥加密保存在服务器，保存后只显示脱敏状态。</span></label><section class="channel-model-editor"><div><h3>模型配置</h3><p class="small">至少填写一种能力的模型名称，每行一个。</p></div><div class="channel-model-fields">${Object.entries(capabilityNames).map(([key,name])=>`<label class="field">${name}<textarea name="models_${key}" rows="2" maxlength="18000" spellcheck="false" placeholder="填写${name}模型 ID"></textarea><span class="sub">未提供此能力时留空。</span></label>`).join('')}</div></section><details class="channel-advanced"><summary>高级设置 · 接口协议与成本</summary><p class="small section-space">选择协议后可使用默认接口路径。APIMart 会自动查询图片和视频任务结果。</p><div class="form-row section-space">${Object.entries({text:'文字接口',image:'图片接口',video:'视频创建接口',videoStatus:'视频状态接口',videoContent:'视频内容接口'}).map(([key,label])=>`<label class="field">${label}<input name="endpoint_${key}" placeholder="${{text:'chat/completions',image:'images/generations',video:'videos',videoStatus:'videos/{id}',videoContent:'videos/{id}/content'}[key]}" maxlength="300"></label>`).join('')}</div><div class="form-row section-space"><label class="field">视频提交格式<select name="videoRequestFormat"><option value="multipart">表单 multipart</option><option value="json">JSON</option></select></label><label class="field">请求超时（秒）<input name="timeoutSeconds" type="number" min="1" max="300" step="1" value="120"></label></div><h3 class="section-space">模型成本估算</h3><p class="small">可留空。按中转站实际价格填写，仅用于估算调用成本。</p><div id="channel-pricing" class="table-scroll"></div></details><div class="inline-error" id="channel-error" role="alert"></div><div class="product-form-actions"><label class="checkbox"><input name="enabled" type="checkbox" checked><span>启用渠道</span></label><button type="submit" class="primary">保存 API 渠道</button></div><p class="small">保存不产生调用费用。实际连通性以生成结果为准。</p></form></div></div>`;
}
function updateChannelPricing(form) {
  const previous=new Map([...form.querySelectorAll('[data-pricing-model]')].map(row=>[`${row.dataset.pricingCapability}:${row.dataset.pricingModel}`,Object.fromEntries([...row.querySelectorAll('input')].map(i=>[i.dataset.price,i.value]))]));
  const models=Object.keys(capabilityNames).flatMap(capability=>[...new Set(form.elements.namedItem(`models_${capability}`).value.split(/[,，\n]+/u).map(s=>s.trim()).filter(Boolean))].map(id=>({id,capability})));
  form.querySelector('#channel-pricing').innerHTML=models.length?`<table><thead><tr><th>模型</th><th>每次请求（元）</th><th>百万输入 token（元）</th><th>百万输出 token（元）</th></tr></thead><tbody>${models.map(model=>{const key=`${model.capability}:${model.id}`,stored=form.savedPricing?.get(key),values=previous.get(key);return `<tr data-pricing-model="${esc(model.id)}" data-pricing-capability="${model.capability}"><td>${esc(model.id)}<span class="sub">${capabilityNames[model.capability]}</span></td>${['perRequestCents','inputPerMillionCents','outputPerMillionCents'].map(field=>`<td><input type="number" min="0" max="1000000" step="0.000001" data-price="${field}" aria-label="${esc(model.id)} ${field}" value="${esc(values?.[field]??(stored?.[field]==null?'':stored[field]/100))}" placeholder="未配置"></td>`).join('')}</tr>`;}).join('')}</tbody></table>`:'<p class="small section-space">先填写模型名称，再配置成本。</p>';
}
function loadChannelEditor(form, channel) {
  form.reset();
  for(const name of ['id','name','baseUrl']) form.elements.namedItem(name).value=channel?.[name]??'';
  form.elements.namedItem('id').value=channel?.id??`channel-${crypto.randomUUID().slice(0,8)}`;
  form.elements.namedItem('id').readOnly=!!channel;
  const key=form.elements.namedItem('apiKey'); key.value=''; key.required=!channel;
  key.placeholder=channel?'留空保留原密钥；填写则替换':'输入此渠道的 API Key';
  form.elements.namedItem('enabled').checked=channel?.enabled??true;
  for(const capability of Object.keys(capabilityNames)) form.elements.namedItem(`models_${capability}`).value=(channel?.models??[]).filter(model=>model.capability===capability).map(model=>model.id).join('\n');
  form.savedPricing=new Map((channel?.models??[]).map(model=>[`${model.capability}:${model.id}`,model.pricing]));
  form.querySelector('#channel-pricing').replaceChildren();updateChannelPricing(form);
  for(const key of ['text','image','video','videoStatus','videoContent'])form.elements.namedItem(`endpoint_${key}`).value=channel?.endpoints?.[key]??'';
  form.elements.namedItem('videoRequestFormat').value=channel?.videoRequestFormat??'multipart';
  let protocol=form.elements.namedItem('protocol');
  if(!protocol){const label=document.createElement('label');label.className='field';label.innerHTML='<span>接口协议</span><select name="protocol"><option value="openai-compatible">OpenAI 兼容接口</option><option value="apimart">APIMart（图片、视频异步任务）</option></select>';form.elements.namedItem('baseUrl').closest('label').before(label);protocol=form.elements.namedItem('protocol');protocol.onchange=()=>{for(const key of ['text','image','video','videoStatus','videoContent'])form.elements.namedItem(`endpoint_${key}`).value='';form.elements.namedItem('videoRequestFormat').value=protocol.value==='apimart'?'json':'multipart';};}
  protocol.value=channel?.protocol??'openai-compatible';
  form.elements.namedItem('timeoutSeconds').value=(channel?.timeoutMs??120000)/1000;
  document.querySelector('#channel-editor-title').textContent=channel?'编辑 API 渠道':'新增 API 渠道';
  document.querySelector('#channel-key-hint').textContent=channel?`已保存密钥${channel.keyHint?` ${channel.keyHint}`:''}。留空保留原密钥；填写新值将替换。`:'密钥加密保存在服务器，保存后只显示脱敏状态。';
  document.querySelector('#channel-error').textContent='';
}
function wireChannelEditor() {
  const form=document.querySelector('#channel-form'); if(!form) return;
  loadChannelEditor(form);
  for(const capability of Object.keys(capabilityNames))form.elements.namedItem(`models_${capability}`).onchange=()=>updateChannelPricing(form);
  document.querySelector('#new-channel').onclick=()=>{loadChannelEditor(form);form.elements.namedItem('id').focus();};
  document.querySelectorAll('[data-edit-channel]').forEach(button=>button.onclick=()=>{
    const channel=(state.channels??[]).find(item=>item.id===button.dataset.editChannel);
    loadChannelEditor(form,channel);
  });
}
async function saveChannel(e) {
  e.preventDefault(); const form=e.target, data=new FormData(form), button=e.submitter??form.querySelector('[type=submit]'), error=document.querySelector('#channel-error');
  error.textContent=''; button.disabled=true;
  try {
    const models=Object.keys(capabilityNames).flatMap(capability=>[...new Set(String(data.get(`models_${capability}`)??'').split(/[,，\n]+/u).map(value=>value.trim()).filter(Boolean))].map(id=>({id,capability})));
    if(!models.length) throw new Error('请至少为一种生成能力填写模型 ID');
    if(models.length>100) throw new Error('每个渠道最多配置 100 个模型');
    updateChannelPricing(form);
    for(const model of models){const row=[...form.querySelectorAll('[data-pricing-model]')].find(r=>r.dataset.pricingModel===model.id&&r.dataset.pricingCapability===model.capability);const pricing={};for(const input of row?.querySelectorAll('[data-price]')??[]){if(input.value!==''){const amount=Number(input.value)*100;if(!Number.isFinite(amount)||amount<0)throw new Error('模型成本必须为非负金额');pricing[input.dataset.price]=amount;}}if(Object.keys(pricing).length)model.pricing=pricing;}
    const endpoints=Object.fromEntries(['text','image','video','videoStatus','videoContent'].map(key=>[key,String(data.get(`endpoint_${key}`)??'').trim()]).filter(([,value])=>value));
    const apiKey=String(data.get('apiKey')??'').trim();
    await post('/api/admin/channels',{id:data.get('id'),name:data.get('name'),baseUrl:data.get('baseUrl'),enabled:data.get('enabled')==='on',protocol:data.get('protocol'),endpoints,videoRequestFormat:data.get('videoRequestFormat'),timeoutMs:Number(data.get('timeoutSeconds'))*1000,models,...(apiKey?{apiKey}:{})});
    form.elements.namedItem('apiKey').value=''; toast('API 渠道已保存，可以到业务平台配置路由'); await refresh();
  } catch(err) {error.textContent=err.message;button.disabled=false;}
}
function paymentsView() {
  const pending=state.payments.filter(p=>p.status==='submitted').length;
  const approved=state.payments.filter(p=>['approved','fulfilled'].includes(p.status));
  const filters={all:{label:'全部订单',accept:()=>true},attention:{label:'待处理',accept:p=>['submitted','approved'].includes(p.status)},fulfilled:{label:'已发卡',accept:p=>p.status==='fulfilled'},closed:{label:'已关闭',accept:p=>['expired','cancelled'].includes(p.status)}};
  const selected=filters[orderFilter]??filters.all;
  const ordered=state.payments.filter(selected.accept).sort((a,b)=>({submitted:0,approved:1,pending:2}[a.status]??3)-({submitted:0,approved:1,pending:2}[b.status]??3));
  return heading('收款订单','核实到账后发卡，自动支付订单无需手动确认。') + `<div class="metrics compact-stats">${metric('待核验',pending,'笔')}${metric('待发卡',state.payments.filter(p=>p.status==='approved').length,'笔')}${metric('累计到账',`¥${money(approved.reduce((n,p)=>n+p.priceCents,0))}`)}</div>${(state.paymentIssues??[]).length?`<div class="notice warning"><strong>${state.paymentIssues.length} 笔付款需要核对</strong>${state.paymentIssues.map(i=>`<div class="payment-issue-row"><span>${esc(i.orderNo)}<span class="sub">${esc(i.message)}</span></span><button data-recover-payment="${esc(i.orderId)}">核对并补发</button></div>`).join('')}</div>`:''}<section class="panel"><div class="panel-head"><div class="filter-tabs" role="group" aria-label="筛选订单">${Object.entries(filters).map(([key,filter])=>`<button type="button" data-order-filter="${key}" class="${key===orderFilter?'active':''}" aria-pressed="${key===orderFilter}">${filter.label}<span>${state.payments.filter(filter.accept).length}</span></button>`).join('')}</div></div>${ordered.length?`<div class="table-scroll"><table><thead><tr><th>商品 / 订单</th><th>金额</th><th>付款信息</th><th>状态</th><th>操作</th></tr></thead><tbody>${ordered.map(p=>`<tr><td><strong>${esc(p.productName)}</strong><div class="sub">${esc(p.packageLabel||`${p.units} 次`)}</div>${p.quota?`<div class="sub">${esc(quotaSummary(p.quota))}</div>`:''}<div class="sub mono">${esc(p.orderNo)}</div></td><td class="amount">¥${money(p.priceCents)}</td><td>${p.reference?`<details class="inline-proof"><summary>已提交凭证</summary><span class="mono">${esc(p.reference)}</span><span class="sub">${esc(p.payer)} · ${esc(p.paidAt)}</span></details>`:'<span class="muted">未提交</span>'}</td><td>${badge(p.status)}${p.fulfillmentError?'<div class="sub">发卡待重试</div>':''}</td><td>${p.status==='submitted'||p.status==='pending'?`<button ${p.status==='submitted'?'class="primary"':''} data-approve="${p.id}">核实到账</button>`:p.status==='approved'?`<button data-retry="${p.id}">重试发卡</button>`:p.status==='fulfilled'?'<span class="muted">已交付</span>':'<span class="muted">已关闭</span>'}</td></tr>`).join('')}</tbody></table></div>`:empty(orderFilter==='all'?'还没有订单':'当前没有这类订单','新的订单和处理结果会显示在这里。')}</section>${!state.qrConfigured&&state.paymentSettings?.mode!=='epay'?'<p class="small">尚未开启收款，请到「收款设置」完成配置。</p>':''}`;
}
async function upload(e) { e.preventDefault(); const file = new FormData(e.target).get('qr'); try { await api('/api/admin/payment-qr', { method:'POST',body:file }); toast('收款码已保存'); await refresh(); } catch (err) { toast(err.message); } }
function approveDialog(id) {
  const order = state.payments.find(p=>p.id===id), dialog = document.createElement('dialog');
  dialog.innerHTML = `<h2>核实到账 · ¥${money(order.priceCents)}</h2><p>核对收款账单中的金额与交易单号，再确认发卡。</p>${order.reference?`<div class="form-summary">客户提供：${esc(order.reference)}<span class="sub">${esc(order.payer)} · ${esc(order.paidAt)}</span></div>`:''}<form><label class="field">账单中的交易单号<input name="reference" required autocomplete="off" placeholder="核对后填写真实交易单号"></label><label class="field">核验备注<input name="note" placeholder="选填"></label><label class="checkbox"><input type="checkbox" name="confirmed" required><span>我已核对真实账单，确认交易单号、金额和到账时间。</span></label><div class="inline-error"></div><div class="dialog-actions"><button type="button" id="cancel">取消</button><button class="primary">确认到账并发卡</button></div></form>`;
  document.body.append(dialog); dialog.addEventListener('close',()=>dialog.remove(),{once:true}); dialog.showModal(); dialog.querySelector('#cancel').onclick = () => { dialog.close(); dialog.remove(); };
  dialog.querySelector('form').onsubmit = async e => { e.preventDefault(); const data = new FormData(e.target), button = e.target.querySelector('.primary'); button.disabled = true; try { const result = await post(`/api/admin/shop-orders/${id}/approve`, {verifiedReference:data.get('reference'), note:data.get('note'), confirmed:data.get('confirmed')==='on'}); dialog.close(); dialog.remove(); toast(result.status==='fulfilled'?'已核实到账，卡密已发放':'已核实到账，卡密发放待重试'); await refresh(); } catch (err) { dialog.querySelector('.inline-error').textContent = err.message; button.disabled = false; } };
}
async function demo() {
  const balance = await api('/api/demo/balance');
  app.innerHTML = `<header class="standalone-header">${brand}<a href="/" target="_blank" rel="noreferrer">打开商城 ↗</a></header><main class="standalone"><div class="demo-intro"><h1>兑换体验</h1><p>仅测试兑换和扣次，不调用模型。</p></div><div class="demo-balance" id="balance"></div><section class="panel"><div class="panel-body"><div class="heading"><h2>兑换卡密</h2><button id="claim-demo">领取 3 次体验码</button></div><form class="form-row" id="redeem-form"><input name="code" class="mono grow" placeholder="粘贴或领取 QTA- 体验卡密" required><button class="primary">兑换次数</button></form></div></section><section class="panel"><div class="panel-body"><h2>验证使用与扣次</h2><p class="small">一次业务只消费一次。失败流程会退回本次预扣的次数。</p><div class="row-actions section-space"><button class="primary" data-use="commit">模拟成功使用 · 扣 1 次</button><button data-use="cancel">模拟业务失败 · 退回 1 次</button></div><div id="demo-result"></div></div></section><p class="small">体验额度绑定当前浏览器。正式接入时，由你的网站后端传入已登录用户的账号 ID。</p></main>`;
  function showBalance(b) { document.querySelector('#balance').innerHTML = `<div><span>可用次数</span><strong>${b.available}</strong></div><div><span>预扣中</span><strong>${b.reserved}</strong></div><div><span>已消费</span><strong>${b.consumed}</strong></div>`; }
  showBalance(balance);
  document.querySelector('#claim-demo').onclick = async e => { e.target.disabled = true; try { const result = await post('/api/demo/claim'); document.querySelector('[name=code]').value = result.code; toast('已领取 3 次测试卡密，请点击兑换次数'); } catch (err) { toast(err.message); } finally { e.target.disabled = false; } };
  document.querySelector('#redeem-form').onsubmit = async e => { e.preventDefault(); try { const result = await post('/api/demo/redeem', {code:new FormData(e.target).get('code')}); showBalance(result.balance); e.target.reset(); toast(`兑换成功，增加 ${result.units} 次`); } catch(err) { toast(err.message); } };
  document.querySelectorAll('[data-use]').forEach(el=>el.onclick = async () => { document.querySelectorAll('[data-use]').forEach(b=>b.disabled=true); try { const result=await post('/api/demo/use',{action:el.dataset.use,requestId:crypto.randomUUID()}); showBalance(result.balance); const out=document.querySelector('#demo-result'); out.className='result'; out.textContent=result.message; } catch(err) {toast(err.message);} finally {document.querySelectorAll('[data-use]').forEach(b=>b.disabled=false);} });
}
async function payment() {
  const id=location.pathname.split('/').pop(), token=new URLSearchParams(location.search).get('token');
  const route=`/api/payments/${encodeURIComponent(id)}?token=${encodeURIComponent(token??'')}`;
  const order = await api(route);
  app.innerHTML = `<header class="standalone-header">${brand}<span class="muted small">微信收款 · 人工核实到账</span></header><main class="payment"><div class="payment-steps"><b>01 确认订单</b><span>02 扫码付款</span><span>03 商家核实后发卡</span></div><div class="panel"><div class="payment-summary"><p>${esc(order.name)}</p><div class="amount"><small>¥</small>${money(order.priceCents)}</div><div class="mono sub">订单 ${esc(order.orderNo)}</div><div class="section-space" id="pay-state">${badge(order.state)}</div></div><div class="payment-body">${order.qrConfigured?'<img class="pay-qr" src="/payment-qr" alt="商家微信收款码"><p class="small center">请使用微信扫一扫，并核对应付金额。</p>':'<div class="qr-placeholder">商家尚未配置收款码<br>当前请勿付款</div>'}<div class="notice section-space">扫码后，请提交付款信息。商家核实微信真实账单后才会发卡；点击提交不会立即认定付款成功。</div><form id="proof-form"><label class="field">微信交易单号<input name="reference" required placeholder="微信付款详情中的交易单号"></label><div class="form-row"><label class="field">付款时间<input name="paidAt" type="datetime-local" required></label><label class="field">付款人备注<input name="payer" placeholder="选填，方便核对"></label></div><button class="primary" ${order.qrConfigured?'':'disabled'}>我已付款，提交核验</button></form><div id="pay-next" class="section-space"></div></div></div><p class="small">请保留此页面。到账与发卡状态会自动更新。</p></main>`;
  const time = new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16); document.querySelector('[name=paidAt]').value=time;
  function update(row) { document.querySelector('#pay-state').innerHTML=badge(row.state); if(['submitted','approved','delivered'].includes(row.state)) document.querySelector('#proof-form').hidden=true; if(row.state==='delivered') { document.querySelector('#pay-next').innerHTML=`<a href="${esc(row.returnUrl)}">返回商城查看卡密 →</a><p class="small">商城已接收支付通知，实际卡密履约状态请以商城订单为准。</p>`; clearInterval(poll); } else if(row.state==='submitted') document.querySelector('#pay-next').textContent='付款信息已提交，等待商家核实真实到账。'; else if(row.state==='approved') document.querySelector('#pay-next').textContent='商家已核实到账，正在通知商城发货。'; }
  update(order);
  document.querySelector('#proof-form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);try{const row=await post(`/api/payments/${id}/submit?token=${encodeURIComponent(token)}`,Object.fromEntries(f));update(row);toast('已提交，等待商家核实');}catch(err){toast(err.message);}};
  if(order.state!=='delivered')poll=setInterval(async()=>{try{update(await api(route));}catch{}},5000);
}
try { if(location.pathname==='/demo') await demo(); else if(location.pathname.startsWith('/pay/')) await payment(); else if(location.pathname==='/admin') await refresh(); else if(location.pathname.startsWith('/platform/')) await renderPlatform(app); else await renderShop(app); } catch(err) {app.innerHTML=`<main class="standalone"><h1>暂时无法打开</h1><p>${esc(err.message)}</p><a href="/">返回额度中心</a></main>`;}

