import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createQuota } from '../sidecar/quota.mjs';
import { createChannels } from '../sidecar/channels.mjs';
import { createPlatforms } from '../sidecar/platforms.mjs';
import { createGeneration } from '../sidecar/generation.mjs';
import { createCommerce } from '../sidecar/commerce.mjs';
import { configurePlatformCatalog } from '../sidecar/sample-platforms.mjs';

const businessIds = ['dingxiaosui', 'second-project', 'jiuqing', 'hongfan-party'];
function catalogFixture(t) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  t.after(() => db.close());
  const quota = createQuota(db), channels = createChannels(db, { secret: 'catalog-isolated-test-secret' });
  const platforms = createPlatforms(db, { quota, channels });
  const commerce = createCommerce(db, { quota, channels, platforms, secret: 'catalog-isolated-test-secret' });
  return { db, quota, channels, platforms, commerce, migrate: () => configurePlatformCatalog(db, quota, commerce, platforms) };
}
function formerSamples({ db, platforms, commerce }) {
  db.exec("CREATE TABLE app_feature_migrations(id TEXT PRIMARY KEY,applied_at TEXT NOT NULL); INSERT INTO app_feature_migrations VALUES('platform-business-catalog','2026-11-07')");
  for (const [id,name,description,prices] of [
    ['marketing-copy','营销文案平台','营销文案、活动方案与内容策划。购买次数包后，在本平台兑换使用。',[390,1490,2490]],
    ['packaging-design','包装设计平台','产品包装创意、商品视觉与设计图生成。次数仅在包装设计平台使用。',[1990,8990,15990]],
  ]) {
    platforms.savePlatform({id,name,description,enabled:true,unitsPerUse:1,bindings:[]});
    commerce.saveProduct({id,projectId:id,name,description,units:10,priceCents:prices[0],active:true,
      packageOptions:[10,50,100].map((units,i)=>({id:i===0?'standard':`uses-${units}`,label:`${units} 次套餐`,units,priceCents:prices[i],projectId:id,capabilities:[],apiBindings:[]})),
      customPricing:{enabled:true,minUnits:1,maxUnits:10000,unitPriceMicros:prices[0]*1000}});
  }
}

test('new business catalog has four named entry projects and no fabricated goods or payment routes', t => {
  const f = catalogFixture(t); f.migrate();
  assert.deepEqual(f.platforms.listPlatforms().map(p=>p.id).sort(),[...businessIds].sort());
  assert.deepEqual(businessIds.map(id=>f.platforms.getPlatform(id).name),['丁小穗','一二大模型','酒擎','红帆党建']);
  assert.ok(f.platforms.listPlatforms().every(p=>p.enabled && !p.url && !p.bindings.length));
  assert.equal(f.commerce.listProducts({admin:true}).length,0);
  f.migrate(); assert.equal(f.platforms.listPlatforms().length,4);
});

test('unused original sample platforms are removed once while Ding order, card and account stay unchanged', t => {
  const f = catalogFixture(t); formerSamples(f);
  const models=['text','image','video'].map(capability=>({id:`fixture-${capability}`,capability}));
  f.channels.saveChannel({id:'fixture-channel',name:'测试渠道',baseUrl:'https://fixture.invalid/v1',apiKey:'fixture-only-key',models});
  f.platforms.savePlatform({id:'dingxiaosui',name:'丁小穗',url:'http://127.0.0.1:8945/workbench.html',description:'已接入',
    bindings:models.map(model=>({capability:model.capability,channelId:'fixture-channel',model:model.id}))});
  f.platforms.savePlatform({id:'second-project',name:'一二大模型',description:'已有入口说明',bindings:[]});
  f.commerce.saveProduct({id:'ding-card',projectId:'dingxiaosui',name:'保留额度卡',units:27,priceCents:990,
    packageOptions:[{id:'trial',label:'尝鲜卡',quota:{text:10,image:15,video:2},priceCents:990}]});
  f.commerce.generateInventory({productId:'ding-card',quantity:1,packageId:'trial'});
  const order=f.commerce.createOrder({productId:'ding-card',packageId:'trial',email:'test@example.com'});
  f.commerce.approveOrder({id:order.id,verifiedReference:'fixture-paid-1',confirmed:true});
  f.quota.redeem({projectId:'dingxiaosui',userId:'fixture-buyer',code:f.commerce.getOrder(order).code});
  const protectedTables=['shop_orders','shop_inventory','quota_codes','quota_accounts','quota_account_buckets'];
  const before=protectedTables.map(table=>f.db.prepare(`SELECT * FROM ${table}`).all());
  const ding=f.platforms.getPlatform('dingxiaosui'),second=f.platforms.getPlatform('second-project');
  f.migrate();
  assert.deepEqual(f.platforms.listPlatforms().map(p=>p.id).sort(),[...businessIds].sort());
  assert.deepEqual(f.commerce.listProducts({admin:true}).map(p=>p.id),['ding-card']);
  assert.deepEqual(protectedTables.map(table=>f.db.prepare(`SELECT * FROM ${table}`).all()),before);
  assert.deepEqual(f.platforms.getPlatform('dingxiaosui'),ding); assert.deepEqual(f.platforms.getPlatform('second-project'),second);
  assert.equal(f.db.prepare('PRAGMA foreign_key_check').all().length,0);
  f.migrate(); assert.equal(f.commerce.listProducts({admin:true}).length,1);
});

test('catalog migration preserves edited fixtures and fixtures with any card or order history', t => {
  const f=catalogFixture(t);formerSamples(f);
  const original=f.commerce.listProducts({admin:true}).find(p=>p.id==='marketing-copy');
  f.commerce.saveProduct({...original,priceCents:777});
  f.commerce.generateInventory({productId:'packaging-design',quantity:1});
  f.commerce.createOrder({productId:'packaging-design',email:'pending@example.com'});
  f.migrate();
  assert.equal(f.commerce.listProducts({admin:true}).find(p=>p.id==='marketing-copy').priceCents,777);
  assert.ok(f.platforms.listPlatforms().some(p=>p.id==='packaging-design'));
  assert.equal(f.commerce.listOrders().length,1);
  assert.equal(f.db.prepare('PRAGMA foreign_key_check').all().length,0);
});

test('catalog migration preserves configured platform metadata and cross-product project references', t => {
  const f=catalogFixture(t);formerSamples(f);
  f.platforms.savePlatform({id:'marketing-copy',url:'https://configured.example'});
  f.platforms.savePlatform({id:'other',name:'自己的项目',bindings:[]});
  f.commerce.saveProduct({id:'other-card',projectId:'other',name:'自己的套餐',units:10,priceCents:100});
  // Earlier catalogs supported cross-project SKU snapshots; current creation rejects them.
  f.db.prepare('UPDATE shop_products SET package_options=? WHERE id=?').run(JSON.stringify(
    [{id:'standard',label:'跨项目旧套餐',projectId:'packaging-design',units:10,priceCents:100}]),'other-card');
  f.migrate();
  assert.equal(f.platforms.getPlatform('marketing-copy').url,'https://configured.example/');
  assert.equal(f.platforms.getPlatform('packaging-design').name,'包装设计平台');
});

test('a separately configured application catalog is not populated with unrelated storefront entries', t => {
  const f=catalogFixture(t);
  f.platforms.savePlatform({id:'studio',name:'现有业务',bindings:[]});
  f.commerce.saveProduct({id:'studio-card',projectId:'studio',name:'现有卡',units:3,priceCents:100});
  f.migrate();
  assert.deepEqual(f.platforms.listPlatforms().map(p=>p.id),['studio']);
  assert.deepEqual(f.commerce.listProducts({admin:true}).map(p=>p.id),['studio-card']);
});

test('a disabled video route keeps the healthy text capability usable without exposing routing', async t => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const quota = createQuota(db), channels = createChannels(db, { secret: 'platform-readiness-test-secret' });
  const textChannel = { id: 'text-relay', name: '文案渠道', baseUrl: 'https://text.example/v1', apiKey: 'test-only-text-key', models: [{ id: 'text-model', capability: 'text' }] };
  const videoChannel = { id: 'video-relay', name: '视频渠道', baseUrl: 'https://video.example/v1', apiKey: 'test-only-video-key', models: [{ id: 'video-model', capability: 'video' }] };
  channels.saveChannel(textChannel); channels.saveChannel(videoChannel);
  const platforms = createPlatforms(db, { quota, channels });
  platforms.savePlatform({ id: 'studio', name: '创作平台', bindings: [
    { capability: 'text', channelId: textChannel.id, model: 'text-model' },
    { capability: 'video', channelId: videoChannel.id, model: 'video-model' },
  ] });
  channels.saveChannel({ ...videoChannel, enabled: false });
  const publicPlatform = platforms.getPlatform('studio', { public: true });
  assert.equal(publicPlatform.ready, false);
  assert.equal(publicPlatform.readiness, 'channel-unavailable');
  assert.deepEqual(publicPlatform.availableCapabilities, ['text']);
  assert.deepEqual(publicPlatform.capabilities, ['text', 'video']);
  assert.equal('bindings' in publicPlatform, false);
  assert.doesNotMatch(JSON.stringify(publicPlatform), /text-relay|video-relay|text-model|video-model|test-only/);

  const code = quota.generateCodes({ projectId: 'studio', quantity: 1, units: 1, quota: { text: 1, image: 0, video: 0 } }).codes[0];
  quota.redeem({ projectId: 'studio', userId: 'test-user', code });
  let calls = 0;
  const generation = createGeneration(db, { quota, channels, platforms, fetchImpl: async () => {
    calls++;
    return new Response(JSON.stringify({ choices: [{ message: { content: '文案正常生成' } }] }), { headers: { 'content-type': 'application/json' } });
  } });
  const result = await generation.execute({ projectId: 'studio', userId: 'test-user', requestId: 'text-request', capability: 'text', prompt: '生成文案' });
  assert.equal(result.status, 'succeeded');
  assert.equal(calls, 1);
  assert.equal(quota.balance({ projectId: 'studio', userId: 'test-user' }).byCapability.text.consumed, 1);

  platforms.savePlatform({ id: 'studio', enabled: false });
  assert.deepEqual(platforms.getPlatform('studio', { public: true }).availableCapabilities, []);
  assert.equal(platforms.getPlatform('studio').ready, false);
});
