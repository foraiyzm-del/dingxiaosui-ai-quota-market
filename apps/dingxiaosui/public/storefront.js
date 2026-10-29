// Shared exterior concept for the homepage and the workbench salon.
(() => {
  const facade = `<section class="lilac-facade" aria-label="紫丁香会客厅门头设计概念">
    <div class="lilac-facade-photo">
      <img src="lilac-salon-storefront.webp" alt="紫丁香会客厅店铺外立面概念：紫色门头、通透橱窗、中央入口，可看到山西农品陈列和品鉴空间">
      <div class="lilac-facade-sign"><div class="lilac-sign-wing"><i>◈</i><b>山西风物精选</b><small>SHANXI SELECTION</small></div><div class="lilac-sign-main"><span class="lilac-facade-emblem">✿</span><span><strong>紫丁香会客厅</strong><small>LILAC SALON · SHANXI PRODUCE</small></span></div><div class="lilac-sign-wing"><i>✦</i><b>品鉴 · 会客 · 共创</b><small>TASTE · MEET · CREATE</small></div></div>
      <div class="lilac-window-mark left"><small>01 / 山西风物</small><b>一县一味<br>一品一故事</b></div>
      <div class="lilac-window-mark right"><small>02 / 紫丁香体验</small><b>可逛 · 可尝<br>可坐下来聊</b></div>
    </div>
    <div class="lilac-facade-foot"><div><span>01 / STOREFRONT DESIGN</span><h3>从门头开始，就是紫丁香。</h3><p>主招牌居中，两侧分别表达山西风物与会客体验；左右橱窗有各自的内容，入口暖光把人自然带进店里。</p></div><div class="lilac-facade-points"><span>紫色发光招牌</span><span>双侧主题橱窗</span><span>开放式品鉴入口</span></div></div>
    <div class="lilac-facade-details"><article><span>01 / SIGN</span><b>主招牌</b><p>紫丁香标识与店名居中，左右信息平衡；深紫底板配暖白发光字。</p></article><article><span>02 / LEFT WINDOW</span><b>山西风物橱窗</b><p>按县域与当季主题轮换农品，展示商品卡、产地线索和包装系列。</p></article><article><span>03 / RIGHT WINDOW</span><b>品鉴活动橱窗</b><p>展示本周品鉴、主理人故事与线下活动，吸引进店交流。</p></article><article><span>04 / ENTRY</span><b>会客入口</b><p>通透玻璃门、暖光导视与礼盒陈列，把路过、进店、咨询接成一步。</p></article></div>
  </section>`;
  const workbench = document.querySelector('#view-salon .plus-heading');
  if (workbench) {
    workbench.insertAdjacentHTML('afterend', facade);
    const interiorLabel = document.querySelector('#view-salon .salon-visual-note span');
    if (interiorLabel) interiorLabel.textContent = '02 / INTERIOR · 48 M²';
  }
  const homepage = document.querySelector('#salon .section-top');
  if (homepage) {
    homepage.querySelector('p').textContent='紫丁香会客厅把线上 OPC 农品小店与约 48㎡ 的线下门店放在一起：线上展示好物、承接咨询，线下陈列、品鉴、会客与拍摄。';
    homepage.insertAdjacentHTML('afterend', facade);
    const interiorLabel = document.querySelector('#salon .salon-image-label span');
    if (interiorLabel) interiorLabel.textContent = '02 / INTERIOR · 48 M²';
  }
})();
