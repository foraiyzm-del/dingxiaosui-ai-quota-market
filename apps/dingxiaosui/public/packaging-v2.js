(() => {
  const image = '<figure class="lilac-package-photo"><img src="lilac-packaging-v2.webp" alt="紫丁香系列包装概念图，包含礼盒、纸袋、小米和红枣袋装、商品吊牌"><figcaption>紫丁香系列包装 · 礼盒 / 纸袋 / 农品袋装 / 吊牌</figcaption></figure>';
  for (const selector of ['#salon .salon-pack-cards', '#view-salon .package-stage']) {
    const container = document.querySelector(selector);
    if (container) { container.removeAttribute('aria-hidden'); container.innerHTML = image; }
  }
})();
