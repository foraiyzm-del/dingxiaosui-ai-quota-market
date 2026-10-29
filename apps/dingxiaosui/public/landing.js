const OPC_KEY = 'zidingxiang-opc-profile-v1';
const regions = SHANXI_MAP;
const publicSource = 'https://nynct.shanxi.gov.cn/sndt/tpxw/202512/t20251204_10007539.html';
const publicSource2 = 'https://nynct.shanxi.gov.cn/sndt/nyyw/202512/t20251229_10023042.html';
const sourceBrands = 'https://wjw.shanxi.gov.cn/xwzx/szyw/202412/t20241225_9727855.shtml';
const sourceJincheng = 'https://xxgk.jcgov.gov.cn/szfgzbm/jcswhhlyj/fdzdgknr_31403/tadf_wlj/202507/t20250703_2163680.shtml';
const sourceLvliang = 'https://www.lvliang.gov.cn/zjll/mlll/fqtc/201607/t20160729_233732.html';
const sourceYangquan = 'https://nynct.shanxi.gov.cn/sndt/snlb/yq/202602/t20260204_10055690.html';
const evidence = {
  '大同':{place:'云州区',products:['大同黄花','花蔬'],flavor:'鲜香 · 宜入家常菜',fact:'省农业农村厅报道云州区黄花产业及加工方向。',source:publicSource2,idea:'以泡发、搭配和家常做法解释黄花，先核实具体商品的加工与食用说明。'},
  '朔州':{place:'右玉县',products:['右玉羊肉','草原畜产'],flavor:'肉香 · 适合餐桌叙事',fact:'公开资料将右玉羊肉列为区域农业品牌。',source:sourceBrands,idea:'围绕部位、冷链、做法和到货体验设计内容，供应资质需逐项核实。'},
  '忻州':{place:'忻府区等',products:['忻州糯玉米','杂粮'],flavor:'软糯 · 谷物清甜',fact:'公开资料将忻州糯玉米列为区域农业品牌。',source:sourceBrands,idea:'用蒸煮方法和口感对比做短内容，甜度与软糯程度以具体品种为准。'},
  '太原':{place:'清徐县',products:['清徐老陈醋','酿造调味'],flavor:'酸香 · 层次醇厚',fact:'省农业农村厅公开资料提及清徐老陈醋涉农专业镇。',source:publicSource,idea:'以厨房搭配和工艺资料讲述风味，品牌、年份与工艺仅依据商品标签。'},
  '阳泉':{place:'阳泉',products:['富硒小米','杂粮'],flavor:'谷香 · 粥感绵润',fact:'省农业农村厅报道阳泉富硒农产品发展。',source:sourceYangquan,idea:'先核验具体商品的检测和标签，再讲小米的煮法与家庭早餐场景。'},
  '吕梁':{place:'临县',products:['临县红枣','干果'],flavor:'甜润 · 枣香',fact:'吕梁市政府介绍临县红枣为当地风物。',source:sourceLvliang,idea:'介绍鲜枣与干枣的区别，核实等级、含水率和保存条件。'},
  '晋中':{place:'平遥 / 太谷',products:['平遥牛肉','太谷饼'],flavor:'咸香与麦香 · 两种伴手礼方向',fact:'省农业农村厅报道平遥牛肉与太谷饼等特色产品。',source:publicSource2,idea:'比较餐桌和伴手礼两种场景，先核实标签、保质期与物流。'},
  '长治':{place:'沁县 / 上党',products:['沁州黄小米','潞党参'],flavor:'米香 · 适合早餐内容',fact:'省农业农村厅报道沁州黄小米及上党中药材产业。',source:publicSource2,idea:'优先讲小米的产地与煮粥体验；药材不可混同普通食品宣传。'},
  '晋城':{place:'高平 / 阳城',products:['高平黄梨','阳城小米'],flavor:'清甜与谷香 · 果粮并陈',fact:'晋城市政府公开资料列出高平黄梨和阳城小米。',source:sourceJincheng,idea:'用当季梨果与日常小米搭配双线选题，先核实采收期和实际供货。'},
  '临汾':{place:'隰县',products:['玉露香梨','果品'],flavor:'脆嫩 · 多汁感',fact:'省农业农村厅报道隰县玉露香梨，并描述其脆嫩特点。',source:publicSource2,idea:'围绕当季批次、分级、包装和到货体验设计内容。'},
  '运城':{place:'晋南',products:['晋南苹果','果品'],flavor:'清脆或甜润 · 看品种',fact:'省农业农村厅将晋南苹果列为优势特色产业集群。',source:publicSource,idea:'以具体品种、产地和采收批次做商品事实卡，再测试礼赠与家庭购买。'}
};
const cases = [
  {name:'大同黄花',tag:'大同 / 特色蔬菜',mark:'花',fact:'省农业农村厅报道了云州区黄花产业与深加工方向。',take:'先用一款具体商品做家常菜内容，并记录客户对规格与做法的提问。',source:publicSource2},
  {name:'沁州黄小米',tag:'长治 / 杂粮',mark:'谷',fact:'省农业农村厅报道了沁州黄小米的品牌与产业发展。',take:'把产地、净含量和食用方法做成商品事实卡，再测试早餐场景。',source:publicSource2},
  {name:'隰县玉露香梨',tag:'临汾 / 果品',mark:'梨',fact:'省农业农村厅报道将隰县玉露香梨列为山西特色农产品。',take:'先核实季节、分级、包装与配送，再设计适合的推广时间。',source:publicSource}
];
const months = [
  {name:'开年整理',focus:'整理供货与产品事实',actions:['确认供货主体和授权资料','盘点规格、价格、发货范围','记录客户今年的采购需求']},
  {name:'春季餐桌',focus:'家庭餐桌内容测试',actions:['选一款可稳定供货的农品','拍一组授权的使用场景','记录常见口味和做法问题']},
  {name:'春日回访',focus:'老客回访与复购',actions:['访谈 5 位既有客户','核实重复购买的真实原因','整理一张常见问题卡']},
  {name:'产地故事',focus:'把产地信息讲清楚',actions:['核对真实产地与生产者','整理可使用的产地素材','制作一条产品事实短视频']},
  {name:'初夏选品',focus:'按实际供货计划选品',actions:['确认供应批次与有效期','计算包装和物流成本','试发两种商品介绍角度']},
  {name:'年中复盘',focus:'内容与咨询复盘',actions:['比较各渠道实际询单','整理客户最关心的规格问题','调整下月选品优先级']},
  {name:'夏季场景',focus:'季节商品与配送体验',actions:['核实天气对配送的影响','更新商品保存说明','记录到货反馈与售后问题']},
  {name:'秋收预热',focus:'为当季商品准备资料',actions:['向供应商确认实际采收信息','准备包装与物流说明','安排内容与咨询承接']},
  {name:'伴手礼',focus:'礼赠与企业采购咨询',actions:['确认礼盒规格和交付周期','区分个人与团购需求','记录预算、数量与交付城市']},
  {name:'地方风物',focus:'讲述真实的三晋风物',actions:['采访产地或生产者','核实可公开的生产信息','让客户说出最想了解的问题']},
  {name:'年末采购',focus:'老客和团购回访',actions:['确认实际库存和发货截止日','制作清晰的商品信息卡','跟进已咨询客户的结果']},
  {name:'来年准备',focus:'选品与经营计划',actions:['复盘有效询单与实际成交','淘汰没有供应保障的商品','排出下一季度行动']}
];
const seasons = [
  {key:'winter',name:'冬 · 藏'}, {key:'winter',name:'冬 · 藏'},
  {key:'spring',name:'春 · 生'}, {key:'spring',name:'春 · 生'}, {key:'spring',name:'春 · 生'},
  {key:'summer',name:'夏 · 长'}, {key:'summer',name:'夏 · 长'}, {key:'summer',name:'夏 · 长'},
  {key:'autumn',name:'秋 · 收'}, {key:'autumn',name:'秋 · 收'}, {key:'autumn',name:'秋 · 收'},
  {key:'winter',name:'冬 · 藏'}
];
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let selectedRegion = '大同';
let selectedMonth = new Date().getMonth();
function goToWorkbench(intent){window.zdxStorage.session.setItem('zidingxiang-opc-intent',JSON.stringify(intent));location.href='workbench.html';}
function renderRegion(name){
  selectedRegion=name;
  document.querySelectorAll('[data-region]').forEach(node=>{const active=node.dataset.region===name;node.classList.toggle('active',active);if(node.tagName==='BUTTON')node.setAttribute('aria-pressed',String(active));});
  if($('#city-province'))$('#city-province').value=name;
  const info=evidence[name];
  $('#region-panel').innerHTML=`<div class="region-panel-top"><span class="region-index">FIELD NOTE / 山西风物档案</span><span class="region-count">11 CITIES</span></div><div class="region-headline"><span class="region-seal" aria-hidden="true">${esc(name.slice(0,1))}</span><div><small>山西 · ${esc(info.place)}</small><h3 class="region-title">${esc(name)}</h3></div></div><div class="region-feature"><span>风味记忆 / TASTE NOTES</span><strong>${esc(info.flavor)}</strong><small>品类感官提示，具体口感随商品与做法变化</small></div><div class="region-products">${info.products.map((product,i)=>`<span><b>0${i+1}</b>${esc(product)}</span>`).join('')}</div><div class="region-copy"><span class="region-label">产地线索</span><p>${esc(info.fact)}</p><span class="region-label">OPC 内容切口</span><p>${esc(info.idea)}</p></div><div class="region-source-line"><a class="region-source" href="${info.source}" target="_blank" rel="noopener">查看公开来源 ↗</a><small>资料仅作选题线索</small></div><div class="region-actions"><button data-region-action="create" type="button">以此创建内容 <span>↗</span></button><button class="secondary" data-region-action="calendar" type="button">放进营销日历</button></div>`;
  if($('#calendar-detail'))renderCalendar();
}
function renderCalendar(){
  document.querySelectorAll('#month-rail button').forEach((b,i)=>{b.classList.toggle('active',i===selectedMonth);b.setAttribute('aria-pressed',String(i===selectedMonth));});
  const item=months[selectedMonth];
  $('#calendar').dataset.season=seasons[selectedMonth].key;
  $('#calendar-season-name').textContent=seasons[selectedMonth].name;
  $('#calendar-detail').innerHTML=`<div class="calendar-top"><div class="calendar-month"><b>${String(selectedMonth+1).padStart(2,'0')}</b><span>月<br><small>${esc(item.name)}</small></span></div><label class="calendar-region">关注城市 <select id="calendar-region">${regions.map(r=>`<option ${r.name===selectedRegion?'selected':''}>${esc(r.name)}</option>`).join('')}</select></label></div><div class="calendar-body"><div class="calendar-theme"><span class="region-label">THIS MONTH'S FOCUS / 本月主题</span><h3>${esc(item.focus)}</h3><p>${esc(selectedRegion)}：${esc(evidence[selectedRegion]?.idea||'先收集真实商品、供货条件与客户需求，再选择具体推广主题。')}</p><button id="calendar-create" type="button">用这个主题开始创作 <span>↗</span></button></div><div class="calendar-actions"><span class="region-label">3 THINGS TO DO / 行动清单</span><ol>${item.actions.map((a,i)=>`<li><span>${String(i+1).padStart(2,'0')}</span><b>${esc(a)}</b></li>`).join('')}</ol><p>时间与供货信息请以实际商品资料为准。</p></div></div>`;
  $('#calendar-region').addEventListener('change',e=>renderRegion(e.target.value));
  $('#calendar-create').addEventListener('click',()=>goToWorkbench({scene:'日常种草',topic:`${selectedRegion} · ${item.focus}`}));
}
$('#map-visual').innerHTML=`<svg class="shanxi-svg" viewBox="0 0 520 700" role="img" aria-label="山西省 11 市轮廓图"><defs><linearGradient id="map-fill" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#775080"/><stop offset="1" stop-color="#4d335c"/></linearGradient><linearGradient id="map-active" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#e7c68f"/><stop offset="1" stop-color="#b57eac"/></linearGradient></defs>${regions.map(city=>`<g class="map-city" data-region="${city.name}" role="button" tabindex="0" aria-label="查看${city.name}农产品"><path d="${city.path}"></path><circle class="map-city-dot" cx="${city.x}" cy="${city.y}" r="3"></circle><text x="${city.x}" y="${city.y-8}" text-anchor="middle">${city.name}</text></g>`).join('')}</svg>`;
$('#map-city-rail').innerHTML=regions.map((city,i)=>`<button type="button" data-region="${city.name}" aria-pressed="false"><small>${String(i+1).padStart(2,'0')}</small>${city.name}</button>`).join('');
$('#map-visual').addEventListener('click',e=>{const b=e.target.closest('[data-region]');if(b)renderRegion(b.dataset.region);});
$('#map-visual').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){const b=e.target.closest('[data-region]');if(b){e.preventDefault();renderRegion(b.dataset.region);}}});
$('#map-city-rail').addEventListener('click',e=>{const b=e.target.closest('[data-region]');if(b)renderRegion(b.dataset.region);});
$('#region-panel').addEventListener('click',e=>{const b=e.target.closest('[data-region-action]');if(!b)return;if(b.dataset.regionAction==='calendar'){const calendar=$('#calendar');calendar.querySelector('details.home-fold')?.setAttribute('open','');calendar.scrollIntoView({behavior:'smooth'});}else goToWorkbench({scene:'日常种草',topic:`${selectedRegion}农品介绍`});});
$('#case-grid').innerHTML=cases.map((c,i)=>`<article class="case-card" data-mark="${c.mark}"><span class="case-n">${String(i+1).padStart(2,'0')} / PUBLIC LEAD</span><h3>${c.name}</h3><span class="case-category">${c.tag}</span><p><b>公开线索：</b>${c.fact}</p><div class="case-takeaway"><b>OPC 可试：</b>${c.take}</div><div class="case-actions"><a href="${c.source}" target="_blank" rel="noopener">查看公开来源 ↗</a><button type="button" data-case="${i}">借用这个思路 ↗</button></div></article>`).join('');
$('#case-grid').addEventListener('click',e=>{const b=e.target.closest('[data-case]');if(b){const c=cases[Number(b.dataset.case)];goToWorkbench({scene:'日常种草',topic:`认识${c.name}：${c.take}`});}});
$('#month-rail').innerHTML=months.map((month,i)=>`<button type="button" data-month="${i}" aria-label="查看${i+1}月经营主题"><b>${String(i+1).padStart(2,'0')}</b><small>${esc(month.name)}</small></button>`).join('');
$('#month-rail').addEventListener('click',e=>{const b=e.target.closest('[data-month]');if(b){selectedMonth=Number(b.dataset.month);renderCalendar();}});
$('#join-province').innerHTML='<option value="">请选择</option>'+regions.map(r=>`<option>${r.name}</option>`).join('');
$('#city-province').innerHTML=regions.map(r=>`<option>${r.name}</option>`).join('');
document.querySelectorAll('[data-join]').forEach(b=>b.addEventListener('click',()=>{if(b.dataset.join)$('#join-tier').value=b.dataset.join;$('#join-dialog').showModal();}));
$('#join-close').addEventListener('click',()=>$('#join-dialog').close());
$('#join-dialog').addEventListener('click',e=>{if(e.target===$('#join-dialog'))e.target.close();});
$('#join-form').addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.currentTarget);const profile={name:String(f.get('name')||'').trim(),province:String(f.get('province')||''),city:String(f.get('city')||'').trim(),tier:String(f.get('tier')||'探索 OPC'),joinedAt:new Date().toISOString()};if(!profile.name||!profile.province||f.get('ack')!=='on')return;window.zdxStorage.local.setItem(OPC_KEY,JSON.stringify(profile));goToWorkbench({view:'shop'});});
try{const profile=JSON.parse(window.zdxStorage.local.getItem(OPC_KEY));if(profile?.province&&regions.some(r=>r.name===profile.province))selectedRegion=profile.province;}catch{}
renderRegion(selectedRegion);
$('#city-form').addEventListener('submit',e=>{
  e.preventDefault();const f=new FormData(e.currentTarget);const city=String(f.get('city')||''),market=String(f.get('market')||'').trim(),product=String(f.get('product')||''),scene=String(f.get('scene')||'');if(!market)return;
  const topic=`${market}消费者如何认识${city}${product}`;
  $('#city-result').innerHTML=`<div class="city-result-top"><b>${esc(city)} · ${esc(product)}</b><span>推广市场：${esc(market)} / ${esc(scene)}</span></div><div class="city-result-grid"><article><b>01 核实商品</b><p>找到具体供应商，确认生产者、规格、批次、价格、资质、授权素材和履约条件。</p></article><article><b>02 测试内容</b><p>围绕“${esc(topic)}”做一条产地介绍、一条使用场景、一条咨询引导，并请供应商核对商品事实。</p></article><article><b>03 承接与复盘</b><p>记录客户原话、数量、预算与交付城市。一周后看哪类问题最多，再调整表达。</p></article></div><div class="city-result-bottom"><small>这是基于输入条件的行动建议，不代表当地需求调查或供货承诺。</small><button type="button" id="use-city-topic">用这个主题写内容 ↗</button></div>`;
  $('#use-city-topic').addEventListener('click',()=>goToWorkbench({scene:'日常种草',topic}));
});
