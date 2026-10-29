const capabilities = { text: '文案', image: '图片', video: '视频' };
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function quotaSummary(quota) {
  return quota ? Object.entries(capabilities).filter(([key]) => quota[key] > 0).map(([key, label]) => `${label} ${quota[key]} ${key === 'image' ? '张' : key === 'video' ? '个' : '次'}`).join(' · ') : '';
}

export function installPackageQuota(row, quota) {
  row.querySelector('[data-quota-editor]')?.remove();
  const section = document.createElement('div');
  section.className = 'package-quota-editor'; section.dataset.quotaEditor = '';
  section.innerHTML = `<label class="checkbox"><input type="checkbox" data-quota-enabled ${quota ? 'checked' : ''}><span>分别设置文案、图片和视频次数</span></label><div class="quota-count-fields" ${quota ? '' : 'hidden'}>${Object.entries(capabilities).map(([key, label]) => `<label class="field">${label}${key === 'image' ? '张数' : key === 'video' ? '个数' : '次数'}<input type="number" min="0" max="1000000" step="1" data-quota-count="${key}" value="${esc(quota?.[key] ?? 0)}"></label>`).join('')}</div>`;
  row.querySelector('.sku-description-field').before(section);
  const sync = () => {
    const enabled = section.querySelector('[data-quota-enabled]').checked;
    section.querySelector('.quota-count-fields').hidden = !enabled;
    section.querySelectorAll('[data-quota-count]').forEach(input => { input.disabled = !enabled; input.required = enabled; });
    const units = row.querySelector('[data-package-units]');
    units.readOnly = enabled; units.closest('label').hidden = enabled;
    if (enabled) units.value = [...section.querySelectorAll('[data-quota-count]')].reduce((n, input) => n + Number(input.value || 0), 0) || 1;
  };
  section.addEventListener('input', sync); section.addEventListener('change', sync); sync();
}

export function readPackageQuota(row) {
  if (!row.querySelector('[data-quota-enabled]')?.checked) return undefined;
  const quota = {};
  for (const [key, label] of Object.entries(capabilities)) {
    const raw = row.querySelector(`[data-quota-count="${key}"]`).value;
    const number = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(number) || number < 0 || number > 1000000) throw new Error(`${label}次数须为 0 至 1000000 的整数`);
    quota[key] = number;
  }
  if (!Object.values(quota).some(value => value > 0)) throw new Error('组合套餐至少包含一种使用次数');
  if (Object.values(quota).reduce((a,b)=>a+b,0) > 1000000) throw new Error('组合套餐总次数不能超过 1000000');
  return quota;
}

export function loadCombinationSettings(form, product) {
  let section = form.querySelector('#combination-settings');
  if (!section) {
    section = document.createElement('section'); section.id = 'combination-settings'; section.className = 'product-config';
    section.innerHTML = `<label class="field">发卡方式<select name="fulfillment"><option value="stock">从预生成库存发卡</option><option value="on_payment">到账后按订单自动生成卡密</option></select></label><label class="checkbox section-space"><input type="checkbox" name="quotaPricingEnabled"><span>允许客户自由组合文案、图片、视频次数</span></label><div id="quota-pricing-fields" class="quota-count-fields section-space">${Object.entries(capabilities).map(([key, label]) => `<label class="field">每${key === 'image' ? '张图片' : key === 'video' ? '个视频' : '次文案'}售价（元）<input type="number" min="0" max="1000000" step="0.000001" name="quotaPrice_${key}"></label>`).join('')}${Object.entries(capabilities).map(([key,label])=>`<label class="field">${label}最多购买数量<input type="number" min="0" max="1000000" step="1" name="quotaMax_${key}"><span class="sub">填 0 关闭此项。</span></label>`).join('')}</div><p class="small section-space">文案、图片、视频分别扣次，仅用于当前平台。自动制卡无需提前备库存。</p>`;
    form.querySelector('.product-form-actions').before(section);
    form.elements.namedItem('quotaPricingEnabled').onchange = () => syncCombinationSettings(form);
  }
  form.elements.namedItem('fulfillment').value = product?.fulfillment ?? 'stock';
  form.elements.namedItem('quotaPricingEnabled').checked = product?.quotaPricing?.enabled === true;
  for (const key of Object.keys(capabilities)) form.elements.namedItem(`quotaPrice_${key}`).value = String((product?.quotaPricing?.unitPriceMicros?.[key] ?? {text:100000,image:1000000,video:2000000}[key]) / 1000000);
  for (const key of Object.keys(capabilities)) form.elements.namedItem(`quotaMax_${key}`).value = product?.quotaPricing?.maxCounts?.[key] ?? 10000;
  form.quotaPricingDefaults = product?.quotaPricing;
  syncCombinationSettings(form);
}

function syncCombinationSettings(form) {
  const enabled = form.elements.namedItem('quotaPricingEnabled').checked;
  const fields = form.querySelector('#quota-pricing-fields'); fields.hidden = !enabled;
  fields.querySelectorAll('input').forEach(input => { input.disabled = !enabled; input.required = enabled; });
}

export function readCombinationSettings(form, parsePrice) {
  const enabled = form.elements.namedItem('quotaPricingEnabled').checked;
  let quotaPricing = { ...form.quotaPricingDefaults, enabled };
  if (enabled) {
    const maxCounts = {};
    for (const key of Object.keys(capabilities)) { const raw=form.elements.namedItem(`quotaMax_${key}`).value; const count=Number(raw); if(!/^\d+$/.test(raw)||!Number.isSafeInteger(count)||count<0||count>1000000)throw new Error('每类最多购买次数须为 0 至 1000000 的整数'); maxCounts[key]=count; }
    quotaPricing = { enabled, unitPriceMicros: Object.fromEntries(Object.entries(capabilities).map(([key,label]) => {const price=form.elements.namedItem(`quotaPrice_${key}`).value;return [key,maxCounts[key]===0&&/^0(?:\.0+)?$/.test(price)?0:parsePrice(price,6,`${label}单价`,1000000000000)];})), maxCounts };
  }
  return { fulfillment: form.elements.namedItem('fulfillment').value, quotaPricing };
}

