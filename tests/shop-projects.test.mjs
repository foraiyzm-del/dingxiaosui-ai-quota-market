import assert from 'node:assert/strict';
import { test } from 'node:test';
import { catalogFor, storefrontFor, storefrontSelection } from '../public/shop.js';
import { storefrontCatalog } from '../sidecar/storefront-catalog.mjs';

const catalog = {
  platforms: [{ id: 'dingxiaosui', name: '丁小穗' }, { id: 'other', name: '另一个项目' }],
  products: [
    { id: 'ding-card', projectId: 'dingxiaosui', name: '丁小穗卡', active: true, units: 27, priceCents: 990 },
    { id: 'other-card', projectId: 'other', name: '其他项目卡', active: true, units: 27, priceCents: 990 },
    { id: 'draft', projectId: 'other', active: false, units: 27, priceCents: 990 },
  ],
};

test('project entry never selects another project even when a conflicting service link is supplied', () => {
  const result = catalogFor(catalog, '?project=other&service=ding-card');
  assert.equal(result.selectedId, 'other-card');
  assert.deepEqual(result.products.map(p => p.id), ['other-card']);
  assert.equal(result.projects.find(p => p.id === 'other').name, '另一个项目');
});

test('unknown project links show an empty catalog instead of silently offering another project', () => {
  const result = catalogFor(catalog, '?project=missing&service=ding-card');
  assert.equal(result.products.length, 0);
  assert.equal(result.selectedId, undefined);
  assert.equal(result.unknownProject, true);
});

test('legacy service deep links and the all-project catalog remain available', () => {
  const result = catalogFor(catalog, '?service=other-card');
  assert.equal(result.selectedId, 'other-card');
  assert.equal(result.products.length, 2);
  assert.equal(result.projects.length, 2);
  assert.equal(result.projectId, '');
});

const fixedEntitlement = {
  enabled: true, ready: true, sandbox: false,
  package: { projectId: 'dingxiaosui', productId: 'dingxiaosui-opcpay-trial', packageId: 'trial',
    name: '丁小穗尝鲜卡', priceCents: 990, quota: { text: 10, image: 15, video: 2 }, amount: 1 },
};

test('only the fixed Ding trial uses the entitlement route and other products keep their checkout catalog', () => {
  const source = { ...catalog, entitlement: fixedEntitlement };
  for (const search of ['', '?project=dingxiaosui']) {
    const result = catalogFor(source, search);
    assert.equal(result.entitlement?.href, '/opcpay');
    assert.equal(result.entitlement?.priceCents, 990);
    assert.deepEqual(result.entitlement?.quota, { text: 10, image: 15, video: 2 });
  }
  assert.deepEqual(catalogFor(source).products.map(product => product.id), ['ding-card', 'other-card']);
  for (const search of ['?project=other', '?project=missing&service=dingxiaosui-opcpay-trial']) {
    assert.equal(catalogFor(source, search).entitlement, null);
  }
});

test('a disabled or changed fixed entitlement cannot advertise the live purchase route', () => {
  for (const entitlement of [
    { ...fixedEntitlement, enabled: false },
    { ...fixedEntitlement, package: { ...fixedEntitlement.package, projectId: 'other' } },
    { ...fixedEntitlement, package: { ...fixedEntitlement.package, priceCents: 1 } },
    { ...fixedEntitlement, package: { ...fixedEntitlement.package, quota: { text: 27, image: 0, video: 0 } } },
  ]) assert.equal(catalogFor({ ...catalog, entitlement }).entitlement, null);
  const result = catalogFor({ ...catalog, entitlement: { ...fixedEntitlement, ready: false, reason: '本地套餐待核对' } });
  assert.equal(result.entitlement.ready, false);
  assert.equal(result.entitlement.href, null);
  assert.equal(result.entitlement.reason, '本地套餐待核对');
});

test('an enabled project without products remains an entry with no purchase choice', () => {
  const result = catalogFor({ ...catalog, entitlement: fixedEntitlement, platforms: [...catalog.platforms,
    { id: 'second-project', name: '一二大模型', enabled: true, description: '项目入口，业务接入准备中。' },
    { id: 'disabled-project', name: '已停用入口', enabled: false },
  ] }, '?project=second-project');
  assert.equal(result.unknownProject, false);
  assert.equal(result.projects.find(project => project.id === 'second-project').entryOnly, true);
  assert.equal(result.projects.some(project => project.id === 'disabled-project'), false);
  assert.deepEqual(result.products, []);
  assert.equal(result.selectedId, undefined);
  assert.equal(result.entitlement, null);
});

test('the fixed entitlement alone keeps its project selectable without adding a cash product', () => {
  const result = catalogFor({ platforms: [], products: [], entitlement: fixedEntitlement }, '?project=dingxiaosui');
  assert.equal(result.unknownProject, false);
  assert.equal(result.projects.find(project => project.id === 'dingxiaosui').entryOnly, false);
  assert.equal(result.products.length, 0);
  assert.equal(result.entitlement.href, '/opcpay');
});

const fourProjectStore = { products: [], entitlement: fixedEntitlement, storefront: storefrontCatalog(),
  platforms: ['hongfan-party', 'jiuqing', 'second-project', 'dingxiaosui'].map(id => ({ id, enabled: true })) };

test('four-project storefront opens Ding first and keeps the requested project order', () => {
  const store = storefrontFor(fourProjectStore);
  assert.equal(store.selected.id, 'dingxiaosui');
  assert.deepEqual(store.projects.map(project => project.name), ['丁小穗', '一二大模型', '酒擎', '红帆党建']);
  assert.equal(store.entitlement.href, '/opcpay');
});

test('the three entry-only projects cannot expose the Ding purchase action', () => {
  for (const id of ['second-project', 'jiuqing', 'hongfan-party']) {
    const store = storefrontFor(fourProjectStore, '?project=' + id);
    assert.equal(store.selected.id, id);
    assert.equal(store.entitlement, null);
  }
  const invalid = storefrontFor(fourProjectStore, '?project=marketing-copy');
  assert.equal(invalid.selected, null);
  assert.equal(invalid.entitlement, null);
});

test('an unrelated custom catalog is not replaced by the four-project storefront', () => {
  assert.equal(storefrontFor(catalog), null);
});

test('original quota packages can be compared but only trial opens the fixed purchase route', () => {
  const store = storefrontFor(fourProjectStore);
  assert.deepEqual(store.packages.map(item => item.id), ['trial', 'week', 'month', 'season', 'custom']);
  assert.equal(storefrontSelection(store, 'trial').href, '/opcpay');
  for (const [id, price, quota] of [['week', 2990, {text:30,image:45,video:6}], ['month',9900,{text:100,image:150,video:20}], ['season',29900,{text:300,image:450,video:70}]]) {
    const selection = storefrontSelection(store, id);
    assert.equal(selection.priceCents, price);
    assert.deepEqual(selection.quota, quota);
    assert.equal(selection.href, null);
  }
  assert.equal(storefrontSelection(store, 'not-a-package'), null);
});

test('custom quota preview has no invented unit pricing or payment route', () => {
  const store = storefrontFor(fourProjectStore);
  const selection = storefrontSelection(store, 'custom', {text:'12',image:'8',video:'1'});
  assert.deepEqual(selection.quota, {text:12,image:8,video:1});
  assert.equal(selection.priceCents, null);
  assert.equal(selection.href, null);
  for (const value of ['-1','1.5','1000001','abc']) assert.equal(storefrontSelection(store, 'custom', {text:value,image:'0',video:'0'}).quota, null);
});

test('a changed preview cannot send an inconsistent trial or another project to payment', () => {
  const store = storefrontFor(fourProjectStore);
  store.packages = store.packages.map(item => item.id === 'trial' ? {...item,priceCents:1} : item);
  assert.equal(storefrontSelection(store,'trial').href, null);
  assert.equal(storefrontSelection(storefrontFor(fourProjectStore,'?project=jiuqing'),'trial'), null);
});

test('weekly and monthly checkout links require their own matching ready entitlement', () => {
  const options = [fixedEntitlement, ...[
    ['week','丁小穗周卡',2990,{text:30,image:45,video:6}],
    ['month','丁小穗月卡',9900,{text:100,image:150,video:20}],
  ].map(([id,name,priceCents,quota]) => ({enabled:true,ready:true,sandbox:false,package:{
    projectId:'dingxiaosui',productId:'dingxiaosui-opcpay-'+id,packageId:id,name,priceCents,quota,amount:1}}))];
  const source = {...fourProjectStore,entitlement:{...fixedEntitlement,packages:options}};
  for (const id of ['week','month']) {
    assert.equal(storefrontSelection(storefrontFor(source),id).href,'/opcpay?package='+id);
    const blocked=structuredClone(source);
    blocked.entitlement.packages.find(x=>x.package.packageId===id).ready=false;
    assert.equal(storefrontSelection(storefrontFor(blocked),id).href,null);
    const tampered=structuredClone(source);
    tampered.entitlement.packages.find(x=>x.package.packageId===id).package.quota.text=10;
    assert.equal(storefrontSelection(storefrontFor(tampered),id).href,null);
  }
  assert.equal(storefrontSelection(storefrontFor(source),'trial').href,'/opcpay');
  assert.equal(storefrontSelection(storefrontFor(source),'season').href,null);
  assert.equal(storefrontSelection(storefrontFor(source,'?project=jiuqing'),'month'),null);
});
