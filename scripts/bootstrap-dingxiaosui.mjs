/** Local development bootstrap. Creates missing configuration, never paid usage. */
export async function bootstrapDingxiaosui({ baseUrl, adminPassword, workbenchUrl = 'http://127.0.0.1:8845/workbench.html', fetchImpl = fetch }) {
  const base = new URL(baseUrl);
  if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) || base.username || base.password || base.search || base.hash || base.pathname !== '/') {
    throw new Error('本地初始化只接受本机发卡网根地址');
  }
  if (typeof adminPassword !== 'string' || !adminPassword) throw new Error('缺少本机管理员凭证');
  let cookie = '';
  async function request(route, data) {
    const response = await fetchImpl(new URL(route, base), {
      method: data === undefined ? 'GET' : 'POST', redirect: 'error',
      headers: { ...(cookie ? { cookie } : {}), ...(data === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }), signal: AbortSignal.timeout(10000),
    });
    let result;
    try { result = await response.json(); } catch { throw new Error('本机发卡网返回无效结果'); }
    if (!response.ok) throw new Error(result.error || `本机发卡网初始化失败（HTTP ${response.status}）`);
    if (route === '/api/admin/login') cookie = response.headers.get('set-cookie')?.split(';')[0] || '';
    return result;
  }
  await request('/api/admin/login', { password: adminPassword });
  if (!cookie) throw new Error('未获取本机管理员会话');
  try {
    const state = await request('/api/admin/state');
    if (!Array.isArray(state.platforms) || !Array.isArray(state.products)) throw new Error('本机发卡网版本不兼容');
    if (!state.platforms.some(item => item.id === 'dingxiaosui')) {
      await request('/api/admin/platforms', {
        id: 'dingxiaosui', name: '丁小穗', url: workbenchUrl,
        description: '文案、图片与视频创作。请在后台配置 API 渠道并绑定模型后启用销售。',
        enabled: true, unitsPerUse: 1, bindings: [],
      });
    }
    const product = state.products.find(item => item.id === 'dingxiaosui-creator');
    if (product && product.projectId !== 'dingxiaosui') throw new Error('丁小穗商品标识已用于其他平台，请在后台核对');
    if (!product) {
      await request('/api/admin/products', {
        id: 'dingxiaosui-creator', projectId: 'dingxiaosui', name: '丁小穗创作额度',
        description: '分别选择文案、图片、视频次数。当前为待配置草稿，示例价格请根据实际成本修改。',
        active: false, fulfillment: 'on_payment', units: 5, priceCents: 330,
        packageOptions: [{ id: 'creative-311', label: '文案 3 次＋图片 1 张＋视频 1 个', quota: { text: 3, image: 1, video: 1 }, priceCents: 330, capabilities: ['text', 'image', 'video'] }],
        quotaPricing: { enabled: true, unitPriceMicros: { text: 100000, image: 1000000, video: 2000000 }, maxCounts: { text: 100, image: 100, video: 100 } },
      });
    }
    const credential = await request('/api/admin/platforms/dingxiaosui/credential', {});
    if (credential.projectId !== 'dingxiaosui' || typeof credential.apiKey !== 'string' || !credential.apiKey) throw new Error('丁小穗接入凭证尚未生成');
    return { apiKey: credential.apiKey, createdPlatform: !state.platforms.some(item => item.id === 'dingxiaosui'), createdProduct: !product };
  } finally {
    await request('/api/admin/logout', {}).catch(() => {});
  }
}
