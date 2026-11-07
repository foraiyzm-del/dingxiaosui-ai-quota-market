import { paymentSelection, savedIntentSelection } from './opcpay-state.js';
const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const names = { created:'待购买或兑换', awaiting_payment:'等待权益到账', purchase_unknown:'购买入口待恢复', consuming:'正在核销权益', unknown:'核销结果待确认', consumed:'权益已核销，正在交付', fulfilled:'额度卡已交付', failed:'本次核销未成功', cancelled:'已取消', expired:'意向已过期' };
let info, buyer, intent, timer, busy = false, savedRecovery = true;
const money = cents => (cents/100).toFixed(2);
const quotaText = quota => `文案 ${quota.text} 次 · 图片 ${quota.image} 张 · 视频 ${quota.video} 个`;
const selected = () => paymentSelection(info,location.search,intent);
const requestStorage = id => id==='trial'?'opcpay-intent-request':'opcpay-intent-request-'+id;
function renderPackage() {
  const choice=selected(), card=choice?.package;
  if (!card) {
    $('#package-summary').innerHTML='<h2>套餐不可用</h2><p>请返回商城选择已开放套餐。</p>';
    $('#page-title').textContent='请选择额度卡'; return;
  }
  document.title=card.name+' · 额度集市'; $('#page-title').textContent=card.name;
  $('#package-summary').innerHTML=`<h2>${escape(card.name)}</h2><p class="price"><span>¥</span>${money(card.priceCents)}</p><ul><li><span>文案</span><strong>${card.quota.text} 次</strong></li><li><span>图片</span><strong>${card.quota.image} 张</strong></li><li><span>视频</span><strong>${card.quota.video} 个</strong></li></ul><p>购买 1 次权益，兑换 1 张完整额度卡。三项额度分别使用。</p><p class="small">支付宝购买 → 核销 1 次权益 → 领取卡密 → 丁小穗激活</p><p class="small">${choice.merchantProjectName?'收款项目：'+escape(choice.merchantProjectName):''}</p>`;
  const message=choice.sandbox?'本地模拟演示：不会向支付宝付款，不代表真实支付已验收。':!choice.ready?(choice.reason || '收款配置尚未完成，请暂勿付款。'):info.paymentTest?`真实付款测试：${money(card.priceCents)} 元由支付宝实际收取；文案、图片和视频为本地模拟，不调用真实模型。`:'';
  $('#environment').hidden=!message; $('#environment').textContent=message;
}
async function api(route, body) {
  const response = await fetch('/api/opcpay' + route, { method: body === undefined ? 'GET' : 'POST', cache:'no-store', headers: body === undefined ? {} : {'content-type':'application/json'}, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '操作未完成，请稍后重试');
  return data;
}
async function action(work) {
  if (busy) return;
  busy = true; $('#error').textContent = '';
  document.querySelectorAll('button').forEach(button => { button.disabled = true; });
  try { await work(); } catch (error) { $('#error').textContent = error.message; }
  finally { busy = false; renderIntent(); document.querySelectorAll('button[data-always], button[data-intent]').forEach(button => { button.disabled = false; }); }
}
function showAccount(recoveryCode) {
  if (!buyer?.authenticated) {
    $('#account').innerHTML = `<h2>先保存你的兑换账户</h2><p>账户用于找回购买权益和卡密。恢复码只显示一次，请保存在自己安全的位置。</p><button id="create-buyer" data-always>创建兑换账户</button><details><summary>已有恢复码，恢复原账户</summary><form id="recover-form"><label>账户恢复码<input name="recoveryCode" type="password" autocomplete="off" required></label><button class="secondary" data-always>恢复账户</button></form></details>`;
    $('#create-buyer').onclick = () => action(async () => { buyer = await api('/buyer', {}); savedRecovery = !buyer.recoveryCode; showAccount(buyer.recoveryCode); await loadHistory(); });
    $('#recover-form').onsubmit = event => { event.preventDefault(); const code = new FormData(event.currentTarget).get('recoveryCode'); action(async () => { buyer = await api('/buyer/recover', { recoveryCode:code }); savedRecovery = true; showAccount(); await loadHistory(true); }); };
    return;
  }
  if (recoveryCode) {
    $('#account').innerHTML = `<h2>保存账户恢复码</h2><p>换设备或清除浏览器数据后，用此码找回原权益和卡密。请勿发给他人。</p><label>恢复码<input id="recovery-code" type="password" readonly autocomplete="off"></label><div class="actions"><button id="download-recovery" data-always>下载恢复码</button><button class="secondary" id="show-recovery" data-always>显示恢复码</button></div><label><input id="recovery-saved" type="checkbox">我已将恢复码保存在安全位置</label>`;
    $('#recovery-code').value = recoveryCode;
    $('#show-recovery').onclick = () => { const input = $('#recovery-code'); input.type = input.type === 'password' ? 'text' : 'password'; $('#show-recovery').textContent = input.type === 'password' ? '显示恢复码' : '隐藏恢复码'; };
    $('#download-recovery').onclick = () => { const href = URL.createObjectURL(new Blob([`额度集市 · 丁小穗兑换账户恢复码\n请私密保存，不要分享。\n\n${recoveryCode}\n`],{type:'text/plain;charset=utf-8'})); const a = document.createElement('a'); a.href = href; a.download = '丁小穗兑换账户恢复码.txt'; a.click(); setTimeout(() => URL.revokeObjectURL(href),1000); };
    $('#recovery-saved').onchange = event => { savedRecovery = event.target.checked; renderIntent(); };
  } else {
    $('#account').innerHTML = `<p class="small">兑换账户已连接。原购买权益和卡密会保存在此账户。</p><details><summary>切换或恢复其他账户</summary><p class="small">先确认已保存当前账户恢复码。</p><button class="secondary" id="logout-buyer" data-always>退出当前账户</button></details>`;
    $('#logout-buyer').onclick = () => action(async () => { await api('/buyer/logout',{}); buyer=null; intent=null; clearTimeout(timer); $('#history').innerHTML=''; showAccount(); });
  }
}
function renderIntent() {
  clearTimeout(timer);
  renderPackage();
  const target = $('#intent');
  if (!buyer?.authenticated) { target.innerHTML=''; return; }
  if (!intent) {
    const choice=selected();
    if(!choice){target.innerHTML='<p>该套餐不可购买，请返回商城选择。</p>';return;}
    const card=choice.package;
    target.innerHTML = `<h2>选择${escape(card.name)}</h2><p>¥${money(card.priceCents)}，${quotaText(card.quota)}。</p><button id="create-intent" ${!savedRecovery || !choice.ready || busy ? 'disabled' : ''}>确认套餐，创建兑换意向</button>${!choice.ready ? `<p class="error">${escape(choice.reason || '商户尚未完成接入配置，请暂勿付款。')}</p>` : ''}`;
    $('#create-intent').onclick = () => action(async () => {
      const storage=requestStorage(card.packageId);let key = sessionStorage.getItem(storage);
      if (!key) { key=crypto.randomUUID(); sessionStorage.setItem(storage,key); }
      intent=await api('/intents',{requestId:key,packageId:card.packageId}); history.replaceState(null,'',`/opcpay?intent=${encodeURIComponent(intent.id)}`); await loadHistory();
    });
    return;
  }
  const closed = ['fulfilled','failed','cancelled','expired'].includes(intent.status);
  const pending = ['consuming','unknown','consumed'].includes(intent.status);
  target.innerHTML = `<span class="state" role="status">${escape(names[intent.status] || intent.status)}</span><h2>${intent.status === 'fulfilled' ? '你的额度卡已准备好' : escape(intent.snapshot.name)}</h2><p>${escape(intent.message || '购买成功后，查询权益并核销 1 次，领取你的额度卡。')}</p>${pending ? '<p>正在核对原核销记录。请勿重复购买；刷新页面会继续恢复。</p>' : ''}<div id="delivery"></div><div class="actions" id="actions"></div><p class="small">兑换编号：${escape(intent.id)}</p>`;
  const actions=$('#actions');
  if (intent.status==='fulfilled' && intent.order?.code) {
    $('#delivery').innerHTML=`<p>${quotaText(intent.snapshot.quota)}</p><label>激活码<input id="delivered-code" type="password" readonly autocomplete="off"></label><p class="small">请私密保存。到丁小穗点击「激活」，粘贴卡密。同码重复激活会恢复原余额，不重复加次数。</p>`;
    $('#delivered-code').value=intent.order.code;
    actions.innerHTML='<button id="copy-code">复制激活码</button><button class="secondary" id="show-code">显示卡密</button><a id="activate" class="button secondary" href="#" target="_blank" rel="noopener noreferrer">去丁小穗激活</a>';
    $('#copy-code').onclick=async()=>{try{await navigator.clipboard.writeText(intent.order.code);$('#copy-code').textContent='已复制';}catch{$('#error').textContent='复制未成功，请显示卡密后手动选择复制。';}};
    $('#show-code').onclick=()=>{ const field=$('#delivered-code'); field.type=field.type==='password'?'text':'password'; $('#show-code').textContent=field.type==='password'?'显示卡密':'隐藏卡密'; };
    $('#activate').href=info.workbenchUrl || '/platform/dingxiaosui';
  } else if (!closed) {
    if (!pending) { const buy=document.createElement('button'); buy.textContent=intent.purchaseUrl?'恢复购买入口':'打开支付宝购买入口'; buy.disabled=busy || !savedRecovery; buy.onclick=()=>action(async()=>{intent=await api(`/intents/${intent.id}/purchase`,{});}); actions.append(buy); }
    if (intent.purchaseUrl && !pending) {
      const link=document.createElement('a'); link.className='button secondary'; link.textContent=info.sandbox?'打开模拟购买页（无扣款）':'打开支付宝购买页'; link.href=intent.purchaseUrl; link.target='_blank'; link.rel='noopener noreferrer'; actions.append(link);
      if (!info.sandbox) { const qr=document.createElement('img');qr.className='qr';qr.alt='支付宝购买二维码';qr.referrerPolicy='no-referrer';const fallback=`/api/opcpay/intents/${encodeURIComponent(intent.id)}/qr`;qr.src=intent.purchaseQrCode || fallback;if(intent.purchaseQrCode)qr.onerror=()=>{qr.onerror=null;qr.src=fallback;};$('#delivery').append(qr); }
    }
    if (!intent.purchaseUrl && intent.purchaseQrCode && !pending) {
      const qr=document.createElement('img');qr.className='qr';qr.alt='请用支付宝扫描购买二维码';qr.referrerPolicy='no-referrer';qr.src=intent.purchaseQrCode;$('#delivery').append(qr);
    }
    const reconcile=document.createElement('button');reconcile.className='secondary';reconcile.textContent=pending?'查询原核销结果':'查询权益并兑换 1 张卡';reconcile.disabled=busy || !savedRecovery;reconcile.onclick=()=>action(async()=>{intent=await api(`/intents/${intent.id}/reconcile`,{});await loadHistory();});actions.append(reconcile);
    if(intent.canCancel){const cancel=document.createElement('button');cancel.className='secondary';cancel.textContent='取消本次意向';cancel.disabled=busy;cancel.onclick=()=>action(async()=>{intent=await api(`/intents/${intent.id}/cancel`,{});await loadHistory();});actions.append(cancel);}
  }
  if(closed){const next=document.createElement('button');next.className='secondary';next.textContent='再兑换一张';next.onclick=()=>{const id=intent.snapshot.packageId;sessionStorage.removeItem(requestStorage(id));intent=null;history.replaceState(null,'','/opcpay?package='+encodeURIComponent(id));renderIntent();};actions.append(next);}
  if(!closed){timer=setTimeout(async()=>{if(busy){renderIntent();return;}try{intent=await api(`/intents/${intent.id}`);renderIntent();}catch(error){$('#error').textContent=error.message;}},5000);}
}
async function loadHistory(select=false){
  if(!buyer?.authenticated)return;
  const {intents=[]}=await api('/intents');
  if(select){const match=savedIntentSelection(intents,location.search);if(match)intent=await api(`/intents/${match.id}`);}
  $('#history').innerHTML=intents.length?`<h2>我的兑换记录</h2><ul>${intents.map(item=>`<li><div>${escape(item.snapshot.name)} · ¥${money(item.snapshot.priceCents)} · ${escape(names[item.status] || item.status)}<br><small>${escape(new Date(item.createdAt).toLocaleString('zh-CN'))}</small></div><button class="secondary" data-intent="${escape(item.id)}">查看</button></li>`).join('')}</ul>`:'';
  document.querySelectorAll('[data-intent]').forEach(button=>button.onclick=()=>action(async()=>{intent=await api(`/intents/${button.dataset.intent}`);history.replaceState(null,'',`/opcpay?intent=${encodeURIComponent(intent.id)}`);}));
}
try{
  [info,buyer]=await Promise.all([api('/info'),api('/buyer')]);
  showAccount();await loadHistory(true);renderIntent();
}catch(error){$('#error').textContent=error.message;}
window.addEventListener('pagehide',()=>clearTimeout(timer));
