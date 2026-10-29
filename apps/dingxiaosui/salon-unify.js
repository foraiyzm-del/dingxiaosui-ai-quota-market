// One 紫丁香会客厅 entry contains the online OPC store and the physical salon.
(() => {
  const salon=document.querySelector('#view-salon'),shop=document.querySelector('#view-shop');
  if(!salon||!shop)return;
  const wasShop=activeView==='shop';
  const heading=salon.querySelector('.plus-heading');
  heading.querySelector('h1').innerHTML='紫丁香会客厅，<em>线上线下是一件事。</em>';
  heading.querySelector('p').textContent='线上用 OPC 农品小店展示好物、承接咨询；线下用会客厅门店让人看见、品尝并坐下来交流。';
  const offline=document.createElement('div');offline.id='salon-offline-panel';offline.className='salon-mode-panel';offline.setAttribute('role','tabpanel');offline.setAttribute('aria-labelledby','salon-tab-offline');
  [...salon.children].filter(child=>child!==heading).forEach(child=>offline.appendChild(child));
  const online=document.createElement('div');online.id='salon-online-panel';online.className='salon-mode-panel';online.setAttribute('role','tabpanel');online.setAttribute('aria-labelledby','salon-tab-online');
  while(shop.firstChild)online.appendChild(shop.firstChild);
  shop.remove();
  const oldNav=document.querySelector('.main-nav [data-view="shop"]'),duplicateNav=document.querySelector('.main-nav [data-view="salon"]');
  duplicateNav?.remove();
  if(oldNav){oldNav.dataset.view='salon';oldNav.innerHTML='<span class="nav-icon">✿</span> 紫丁香会客厅';}
  salon.insertAdjacentHTML('beforeend','<div class="salon-mode-switch" role="tablist" aria-label="会客厅线上与线下"><button id="salon-tab-online" type="button" role="tab" aria-controls="salon-online-panel"><span>01 / ONLINE</span><strong>线上 · OPC 农品小店</strong><small>商品展示 · 推广名片 · 咨询承接</small></button><button id="salon-tab-offline" type="button" role="tab" aria-controls="salon-offline-panel"><span>02 / OFFLINE</span><strong>线下 · 紫丁香会客厅门店</strong><small>品牌门头 · 农品品鉴 · 空间与包装</small></button></div>');
  const tabs=salon.querySelector('.salon-mode-switch');
  salon.append(online,offline);
  let mode='offline';
  function setMode(next){mode=next==='online'?'online':'offline';online.hidden=mode!=='online';offline.hidden=mode!=='offline';tabs.querySelectorAll('[role="tab"]').forEach(button=>{const selected=button.id===`salon-tab-${mode}`;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;});}
  tabs.addEventListener('click',event=>{const button=event.target.closest('[role="tab"]');if(button)setMode(button.id==='salon-tab-online'?'online':'offline');});
  tabs.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();const next=mode==='online'?'offline':'online';setMode(next);tabs.querySelector(`#salon-tab-${next}`).focus();});
  window.salonUnified=true;
  window.showSalonMode=next=>{setMode(next);showView('salon');};
  const requestedView=new URLSearchParams(location.search).get('view');
  setMode(wasShop||requestedView==='shop'?'online':'offline');
  if(wasShop||requestedView==='shop')showView('salon');
})();
