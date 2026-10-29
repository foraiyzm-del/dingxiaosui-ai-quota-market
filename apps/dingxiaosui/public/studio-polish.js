// A single product and topic can become a coordinated set of online and offline drafts.
(() => {
  const studio=document.querySelector('#view-studio');
  const heading=studio.querySelector('.page-heading');
  heading.classList.add('studio-hero');
  heading.querySelector('.eyebrow').innerHTML='<span class="eyebrow-line"></span> 一鱼多吃 / ONE IDEA, MANY FORMATS';
  heading.querySelector('h1').innerHTML='一个主题，<em>讲给每一个对的人。</em>';
  heading.querySelector('p').textContent='选一款真实农品，写下这次要讲的主题。一键生成朋友圈、小红书、视频号、知乎、抖音和线下物料；每个版本都可以继续编辑。';
  heading.insertAdjacentHTML('beforeend','<div class="studio-hero-art" aria-hidden="true"><span>ONE<br>IDEA</span><i>↗</i><span>MANY<br>STORIES</span></div>');
  heading.insertAdjacentHTML('afterend','<div class="studio-flow"><div><span>01 / SOURCE</span><b>真实农品</b><small>产地与卖点有资料</small></div><i>→</i><div><span>02 / THEME</span><b>一个主题</b><small>一句话说清重点</small></div><i>→</i><div><span>03 / CHANNELS</span><b>一键多用</b><small>线上内容＋线下物料</small></div></div>');

  const form=document.querySelector('#brief-form');
  const product=form.querySelector('#brief-product').closest('label');
  const topic=form.querySelector('#brief-topic').closest('label');
  product.after(topic);
  topic.classList.add('studio-topic');
  form.querySelector('#brief-topic').placeholder='例如：一碗山西小米，如何走上年轻人的早餐桌？';
  const advanced=document.createElement('details');
  advanced.className='studio-advanced';
  advanced.innerHTML='<summary>补充场景、人群和已核实资料 <span>可选，打开后细化内容 ↘</span></summary><div class="studio-advanced-fields"></div>';
  const fields=advanced.querySelector('div');
  [form.querySelector('.field-row'),...['audience','facts','cta'].map(name=>form.querySelector(`[name="${name}"]`).closest('label'))].forEach(el=>fields.appendChild(el));
  const channels=form.querySelector('.channel-field');
  const official=channels.querySelector('input[value="公众号"]').closest('label');
  official.before(channels.querySelector('input[value="知乎"]').closest('label'),channels.querySelector('input[value="抖音"]').closest('label'));
  channels.before(advanced);
  channels.insertAdjacentHTML('beforebegin','<div class="studio-preset-head"><div><span>02 / CHANNEL MIX</span><h3>选你要发布的阵地</h3><p>先按全渠道生成，想聚焦时可切换组合。</p></div><strong id="studio-selected-count">9 个版本</strong></div><div class="studio-presets" role="group" aria-label="渠道组合"><button type="button" data-channel-preset="all">全渠道一键生成</button><button type="button" data-channel-preset="social">五大线上阵地</button><button type="button" data-channel-preset="offline">线下会客厅物料</button></div>');
  channels.querySelector('label').insertAdjacentHTML('beforebegin','<div class="studio-channel-category">线上内容 / ONLINE</div>');
  channels.querySelector('input[value="线下海报"]').closest('label').insertAdjacentHTML('beforebegin','<div class="studio-channel-category">线下物料 / OFFLINE</div>');
  const channelInputs=[...channels.querySelectorAll('input[name="channel"]')];
  channelInputs.forEach(input=>input.checked=true);
  const presets={all:channelInputs.map(input=>input.value),social:['朋友圈','小红书','视频号','知乎','抖音'],offline:['线下海报','会客厅导购卡','包装文案']};
  const count=()=>{
    const selected=channelInputs.filter(input=>input.checked).map(input=>input.value);
    document.querySelector('#studio-selected-count').textContent=`${selected.length} 个版本`;
    const button=document.querySelector('#generate-button');
    if(!button.disabled)button.firstChild.textContent=`一键生成 ${selected.length} 个渠道版本 `;
    document.querySelectorAll('[data-channel-preset]').forEach(button=>button.setAttribute('aria-pressed',String(selected.length===presets[button.dataset.channelPreset].length&&selected.every(x=>presets[button.dataset.channelPreset].includes(x)))));
  };
  window.updateStudioChannelCount=count;
  channelInputs.forEach(input=>input.addEventListener('change',count));
  document.querySelector('.studio-presets').addEventListener('click',event=>{const button=event.target.closest('[data-channel-preset]');if(!button)return;const selected=new Set(presets[button.dataset.channelPreset]);channelInputs.forEach(input=>input.checked=selected.has(input.value));count();});
  document.querySelector('#reset-brief').addEventListener('click',()=>{channelInputs.forEach(input=>input.checked=true);advanced.open=false;count();});
  studio.querySelector('.brief-panel .section-kicker').textContent='01 / ONE BRIEF';
  studio.querySelector('.brief-panel h2').textContent='这次只讲一个主题';
  studio.querySelector('.output-panel .section-kicker').textContent='03 / MANY OUTPUTS';
  studio.querySelector('.output-panel h2').textContent='每个渠道，各有讲法';
  count();
})();
