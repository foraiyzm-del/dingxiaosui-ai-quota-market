(() => {
  const main=document.querySelector('.h5-shell main');
  let after=main.querySelector('.h5-jumps');
  for(const selector of ['#salon','#calendar','#cases','#atlas','#news','#join','#h5-path','.h5-creator']){
    const section=main.querySelector(selector);
    if(!section)continue;
    after.insertAdjacentElement('afterend',section);
    after=section;
  }
  const cities=[
    ['大同','黄花 / 家常做法'],['朔州','肉羊 / 产地故事'],['忻州','糯玉米 / 蒸煮体验'],['太原','老陈醋 / 餐桌搭配'],['阳泉','小米 / 早餐场景'],['吕梁','红枣 / 干果保存'],['晋中','牛肉与太谷饼 / 伴手礼'],['长治','沁州黄小米 / 谷物香'],['晋城','梨与小米 / 双线选题'],['临汾','玉露香梨 / 当季果品'],['运城','苹果 / 品种与批次']
  ];
  const cityGrid=document.querySelector('#h5-city-grid'),cityDetail=document.querySelector('#h5-city-detail');
  cityGrid.innerHTML=cities.map(([name],i)=>`<button type="button" data-city="${i}" aria-pressed="${i===0}">${name}</button>`).join('');
  const showCity=i=>{const [name,idea]=cities[i];cityGrid.querySelectorAll('button').forEach((button,index)=>button.setAttribute('aria-pressed',String(index===i)));cityDetail.innerHTML=`<span>NO. ${String(i+1).padStart(2,'0')} / SHANXI</span><h3>${name}</h3><p>内容线索：${idea}。请先找到具体商品与授权资料，再开始拍摄或销售。</p>`;};
  cityGrid.addEventListener('click',event=>{const button=event.target.closest('[data-city]');if(button)showCity(Number(button.dataset.city));});showCity(0);
  const months=[
    ['开年整理','核实供货主体、商品标签与素材授权'],['春季餐桌','拍一组真实家庭餐桌使用场景'],['老客回访','记录顾客重复问到的一个问题'],['产地故事','采访生产者，拍一条有依据的产地短片'],['初夏选品','确认供货批次、包装与物流'],['年中复盘','比较视频与直播实际带来的咨询'],['夏季场景','更新保存与配送说明'],['秋收预热','确认采收信息，准备短视频预告'],['伴手礼','讲清礼盒规格和交付周期'],['地方风物','记录一位生产者的真实工作'],['年末采购','核实库存和发货截止日'],['来年准备','留下有效选题，淘汰没有供应保障的商品']
  ];
  const monthGrid=document.querySelector('#h5-months'),monthCard=document.querySelector('#h5-month-card');
  monthGrid.innerHTML=months.map((_,i)=>`<button type="button" data-month="${i}" aria-pressed="false">${i+1}月</button>`).join('');
  const showMonth=i=>{monthGrid.querySelectorAll('button').forEach((button,index)=>button.setAttribute('aria-pressed',String(index===i)));monthCard.innerHTML=`<span>${String(i+1).padStart(2,'0')} / 12 · SEASONAL ACTION</span><h3>${months[i][0]}</h3><p>${months[i][1]}。实际采收、价格、库存和活动日期以具体商品为准。</p>`;};
  monthGrid.addEventListener('click',event=>{const button=event.target.closest('[data-month]');if(button)showMonth(Number(button.dataset.month));});showMonth(new Date().getMonth());
  fetch('/api/content',{cache:'no-store'}).then(response=>response.ok?response.json():null).then(data=>{
    if(!data)return;
    const settings=data.settings||{};
    if(settings.hero_title)document.querySelector('#h5-hero-title').textContent=String(settings.hero_title).slice(0,90);
    if(settings.hero_description)document.querySelector('#h5-hero-description').textContent=String(settings.hero_description).slice(0,190);
    if(settings.logo_image?.startsWith('/media/'))document.querySelector('.h5-brand img').src=settings.logo_image;
    if(settings.hero_image?.startsWith('/media/'))document.querySelector('.h5-hero').style.backgroundImage=`linear-gradient(180deg,#160e1d33,#1f1220d9),url(${JSON.stringify(settings.hero_image)})`;
    const news=(data.articles||[]).filter(item=>item.type==='news').slice(0,3);
    if(news.length){const list=document.querySelector('#h5-news-list');list.replaceChildren();for(const item of news){const a=document.createElement('a'),small=document.createElement('small'),b=document.createElement('b'),span=document.createElement('span');a.href=`/article.html?id=${encodeURIComponent(item.id)}`;small.textContent=String(item.publishedAt||'').slice(0,10)||'紫丁香行动';b.textContent=item.title;span.textContent='阅读全文 ↗';a.append(small,b,span);list.append(a);}}
  }).catch(()=>{});
})();
