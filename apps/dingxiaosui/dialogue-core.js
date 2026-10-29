/* Pure dialogue routing and reviewed workspace operations. No external side effects. */
(() => {
  'use strict';
  const collections = {
    products: '农品', drafts: '文案', plans: '发布计划', knowledge: '知识库', campaigns: '营销活动',
    stock: '库存', sales: '销售记录', office: '办公草稿', agentRuns: '经营任务', manualHotTopics: '热点记录',
  };
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  const text = value => typeof value === 'string' ? value : '';
  function normalize(raw) {
    const value = object(raw) ? { ...raw } : {};
    for (const key of Object.keys(collections)) value[key] = Array.isArray(value[key]) ? value[key].filter(object) : [];
    value.conversations = Array.isArray(value.conversations) ? value.conversations.filter(thread => object(thread) && Array.isArray(thread.messages)) : [];
    value.mediaProfile = object(value.mediaProfile) ? value.mediaProfile : {};
    value.version = 1;
    return value;
  }
  const title = row => text(row.name || row.title || row.topic || row.kind || row.context || row.note || row.date) || '未命名记录';
  const body = row => [row.origin, row.abv, row.summary, row.sellingPoints, row.body, row.content, row.draft, row.goal, row.note, row.context, row.status, row.date, row.channel, typeof row.quantity === 'number' ? `数量 ${row.quantity}` : null, typeof row.amount === 'number' ? `实收 ¥${row.amount}` : null].filter(value => typeof value === 'string').join(' · ');
  function records(state, profile = {}, leads = []) {
    const rows = [];
    for (const [collection, label] of Object.entries(collections)) for (const row of state[collection] || []) {
      if (row.id === 'demo-product' || row.id === 'demo-campaign') continue;
      const product = state.products.find(item => item.id === row.productId);
      rows.push({ collection, label, id: row.id, title: collection === 'stock' ? (product?.name || title(row)) + ' · 库存' : title(row), body: collection === 'stock' ? `现有 ${Number(row.quantity) || 0}${row.unit || '件'} · 提醒线 ${Number(row.threshold) || 0}${row.unit || '件'}` : body(row), row });
    }
    for (const row of leads) if (object(row)) rows.push({ collection: 'leads', label: '客户咨询', id: row.id, title: title(row), body: body(row), row });
    if (Object.keys(profile).length) rows.push({ collection: 'profile', label: '经营档案', id: 'profile', title: profile.shopName || profile.name || '我的经营档案', body: Object.values(profile).filter(value => typeof value === 'string').join(' · '), row: profile });
    if (Object.keys(state.mediaProfile).length) rows.push({ collection: 'mediaProfile', label: '账号定位', id: 'media-profile', title: '我的拍摄与账号定位', body: Object.values(state.mediaProfile).filter(value => typeof value === 'string').join(' · '), row: state.mediaProfile });
    return rows;
  }
  const matchProduct = (question, state) => {
    const exact = state.products.filter(row => row.id !== 'demo-product' && row.name && question.includes(row.name)).sort((a, b) => b.name.length - a.name.length)[0];
    const needle = question.replace(/(?:帮我|查找|查一下|查询|找一下|找|看看|看|的资料|资料)/g, '').trim();
    return exact || (needle ? state.products.find(row => row.id !== 'demo-product' && row.name && row.name.includes(needle)) : undefined);
  };
  function route(question, taskId = 'general') {
    const wantsCreation=/(?:想|要|帮我|给我)(?:做|写|策划|规划|设计)|(?:怎么|如何|应该|该).*?(?:宣传|推广|营销|定位)|(?:做|写)(?:个|一个|份|一份).*(?:PPT|定位|方案|文案|脚本)/i.test(question);
    const brandIntro=/(?:品牌|产品|农品)(?:的)?(?:名字|名称)?(?:是|叫)|(?:我的|我们)品牌[:：]/.test(question);
    if(/github/i.test(question)&&/查看|看看|有哪些|现成能力|已复用|开源工具/.test(question)&&!/写|生成|创作|翻译|润色|设计/.test(question))return {kind:'github'};
    if (!/写|生成|创作一|翻译|润色/.test(question)&&/^(?:(?:请|帮我|查看|查询|看看|查一下|查|打开|兑换|了解|我的|我还有多少|还剩多少|剩余)\s*)*(?:我的)?(?:创作点|点数|激活码|套餐|使用记录|兑换记录|点数记录)(?:余额|使用记录|还剩多少|剩多少|怎么用|有哪些|[？?])?$/.test(question.trim())) return {kind:'credits'};
    if (/^(?:新增|添加|录入|建立|新建)(?:一款|一个|一条)?(?:农品|产品|商品)/.test(question)) return { kind: 'product' };
    if (/(?:保存|存成|存为|存到|留下|收进)/.test(question) && /(?:文案|草稿|知识库|办公)/.test(question)) return { kind: 'save', collection: /知识库/.test(question) ? 'knowledge' : /办公/.test(question) ? 'office' : 'drafts' };
    if (/(?:安排|加入|新增|添加|明天|后天|今天|\d{4}-\d{2}-\d{2})/.test(question) && /(?:发布|发这|发文|发一条)/.test(question)) return { kind: 'plan' };
    if (!wantsCreation && !brandIntro && /紫丁香是什么|介绍紫丁香|什么是紫丁香|了解紫丁香|你是谁|能做什么|怎么加入|如何加入|OPC|会客厅|研究院/i.test(question) && !/写|生成|文案|脚本|方案/.test(question)) return { kind: 'about' };
    const lookup = !wantsCreation && /查|找|列出|有哪些|库存多少/.test(question) && !/写|生成|创作|翻译|润色/.test(question);
    if ((taskId==='general'||lookup) && !wantsCreation && !brandIntro && /(?:山西|沁州黄|玉露香|大同黄花|汾州核桃|芮城|忻州|老陈醋)/.test(question) && /特点|特色|区别|品牌|优势|知识|产地/.test(question) && !/我的|客户|库存|写|生成|新增|保存/.test(question)) return {kind:'reference'};
    const sceneTask=/农业模特|农品模特/.test(question)?'agri-model':/AI\s*新农人|新农人.*(?:账号|IP|定位)/i.test(question)?'new-farmer':/品牌营销|品牌定位|品牌故事|做(?:一)?个定位|做定位|想.*定位|如何定位|怎么定位|怎么宣传|如何宣传|应该.*宣传|宣传一下|宣传下|怎么推广|如何推广|想.*宣传|想.*推广|^定位$|^宣传$/.test(question)?'brand':/农产品营销|农品营销/.test(question)?'agri':/直播带货|直播话术/.test(question)?'live':/电商详情|详情页/.test(question)?'detail':/私域团购|社群团购/.test(question)?'private':/节气上新|应季上新/.test(question)?'season':/节日礼盒|礼盒推广/.test(question)?'gift':/招商|渠道合作/.test(question)?'channel':/采摘|农旅/.test(question)?'visit':null;
    if (!lookup && (taskId !== 'general' || sceneTask || wantsCreation || brandIntro || /(?:写|生成|创作|翻译|润色|总结|整理|做一份|帮我做|策划|规划|提炼|改写|改成|PPT|幻灯片|营销设计|海报设计|包装设计|视觉方案)/i.test(question))) {
      const chosen = taskId !== 'general' ? taskId : /PPT|幻灯片|演示/i.test(question)?'ppt':/营销设计|海报(?:文案|设计)|包装(?:文案|设计)|视觉方案|宣传物料/.test(question)?'design':/农品内容|农产品内容|农品.*内容方案|农产品.*内容方案/.test(question)?'agri':sceneTask ? sceneTask : /翻译|译成|译为/.test(question) ? 'translate' : /会议|纪要/.test(question) ? 'minutes' : /周报|总结/.test(question) ? 'weekly' : /润色|改写|改成/.test(question) ? 'polish' : /小红书/.test(question) ? 'xiaohongshu' : /脚本|短视频|视频号/.test(question) ? 'script' : /公众号|文章/.test(question) ? 'article' : /活动/.test(question) ? 'campaign' : /朋友圈|文案/.test(question) ? 'moments' : /卖点/.test(question) ? 'selling' : 'general';
      return { kind: 'generate', taskId: chosen };
    }
    const categories = [
      ['products', /农品|产品|商品/], ['drafts', /文案|初稿|作品/], ['plans', /发布|日程/], ['knowledge', /知识|资料库/],
      ['stock', /库存|补货/], ['sales', /销售|成交|卖了/], ['office', /办公|纪要/], ['campaigns', /活动/], ['agentRuns', /任务|经营安排/],
      ['leads', /客户|咨询/], ['profile', /小店|店铺|经营档案/], ['mediaProfile', /定位|栏目/], ['manualHotTopics', /热点/],
    ];
    const found = categories.find(([, regex]) => regex.test(question));
    if (found || /查|找|搜索|资料|有哪些|列出|查看|全部|我的/.test(question)) {
      const lowStock = /库存/.test(question) && /低|不足|提醒|补货/.test(question);
      return { kind: 'search', collection: lowStock ? 'stock' : /全部|所有资料|我的资料|查资料/.test(question) ? null : found?.[0] || null, lowStock };
    }
    return { kind: 'generate', taskId: 'general' };
  }
  function search(question, state, profile, leads, intent = route(question)) {
    let found = records(state, profile, leads);
    if (intent.collection) found = found.filter(row => row.collection === intent.collection);
    if (intent.lowStock) found = found.filter(item => Number(item.row.quantity) <= Number(item.row.threshold));
    const product = matchProduct(question, state);
    if (product && question.includes(product.name) && intent.collection !== 'products') found = found.filter(item => item.row.productId === product.id || item.row.productName === product.name || (item.title + item.body).includes(product.name));
    else if (product && intent.collection === 'products') found = found.filter(item => item.id === product.id);
    else {
      const needle = question.replace(/(?:帮我|请|查一下|查找|查询|找一下|看看|搜索|查看|列出|最近|所有|全部|今天|我的|有哪些|一下|记录|农品|产品|商品|发布计划|计划|文案|初稿|作品|知识库|知识|资料库|资料|库存|销售|办公|客户|咨询|活动|经营任务|任务|小店|店铺|经营档案|定位|栏目|热点|日程|低于|不足|提醒|补货|查|找|低|的|了|？|\?)/g, '').trim();
      if (needle && !['多少', '数量', '情况', '总览', '明细', '汇总'].includes(needle)) found = found.filter(item => (item.title + item.body).toLowerCase().includes(needle.toLowerCase()));
    }
    return found;
  }
  function productProposal(question) {
    const value = question.replace(/^(?:新增|添加|录入|建立|新建)(?:一款|一个|一条)?(?:农品|产品|商品)[:：\s]*/, '');
    const segments = value.split(/[；;\n]/).map(part => part.trim()).filter(Boolean);
    const product = { name: '', origin: '', abv: '', summary: '', sellingPoints: '', category: '', supplier: '', shelfLife: '' };
    const fields = { '名称': 'name', '农品': 'name', '产品': 'name', '产地': 'origin', '规格': 'abv', '介绍': 'summary', '简介': 'summary', '卖点': 'sellingPoints', '品类': 'category', '供货方': 'supplier', '供货主体': 'supplier', '保质期': 'shelfLife' };
    for (const [index, segment] of segments.entries()) {
      const match = segment.match(/^([^:：]+)[:：](.*)$/);
      if (match && fields[match[1].trim()]) product[fields[match[1].trim()]] = match[2].trim().slice(0, 1000);
      else if (index === 0) product.name = segment.slice(0, 80);
    }
    if (!product.name) return null;
    return { kind: 'product', title: product.name, value: product };
  }
  function day(question, now = new Date()) {
    const explicit = question.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
    if (explicit) { const parsed = new Date(explicit + 'T00:00:00Z'); return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === explicit ? explicit : null; }
    const local = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    const date = new Date(local + 'T00:00:00Z'); date.setUTCDate(date.getUTCDate() + (/后天/.test(question) ? 2 : /明天/.test(question) ? 1 : 0));
    return date.toISOString().slice(0, 10);
  }
  function applyProposal(state, proposal, meta = {}) {
    if (!object(proposal) || !['product', 'draft', 'office', 'knowledge', 'plan'].includes(proposal.kind)) throw Error('不支持这项操作');
    const id = meta.id || crypto.randomUUID(), createdAt = meta.createdAt || new Date().toISOString();
    const row = { ...proposal.value, id, createdAt };
    if (proposal.kind === 'product') {
      if (!row.name || state.products.length >= 1000) throw Error('请填写农品名称，或先整理已有农品');
      state.products.unshift(row);
    } else if (proposal.kind === 'plan') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date || '') || day(row.date) !== row.date || !state.drafts.some(draft => draft.id === row.draftId) || state.plans.length >= 3000) throw Error('请先保存对应文案，并填写有效的发布日期');
      row.status = '待发布'; state.plans.unshift(row);
    } else {
      const collection = { draft: 'drafts', office: 'office', knowledge: 'knowledge' }[proposal.kind];
      if (!(row.body || row.content) || state[collection].length >= (collection === 'drafts' ? 3000 : 500)) throw Error('内容为空或已达到资料数量上限');
      if (collection === 'knowledge') row.verified = false;
      state[collection].unshift(row);
    }
    state.demo = false;
    return row;
  }
  window.ZdxDialogue = Object.freeze({ collections, normalize, records, route, search, title, body, matchProduct, productProposal, day, applyProposal });
})();
