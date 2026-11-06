import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { PRINTABLE_CODE } from '../sidecar/activation-codes.mjs';
import { createChannelBudgets } from '../sidecar/channel-budgets.mjs';
import { createChannels } from '../sidecar/channels.mjs';
import { createCommerce } from '../sidecar/commerce.mjs';
import { createGeneration } from '../sidecar/generation.mjs';
import { issueLeaderBatch, leaderQuote } from '../sidecar/leader-batch.mjs';
import { LEADER_PROFILE, LEADER_QUOTA } from '../sidecar/model-tiers.mjs';
import { createPlatforms } from '../sidecar/platforms.mjs';
import { createQuota } from '../sidecar/quota.mjs';
import { createSiteSettings } from '../sidecar/site-settings.mjs';

const secret = 'leader-card-test-secret';
const apiKey = 'leader-card-not-a-real-key';
const json = data => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

function harness(t, fetchImpl) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const quota = createQuota(db);
  const channels = createChannels(db, { secret });
  channels.saveChannel({ id: 'relay', name: '测试中转', protocol: 'apimart', baseUrl: 'https://api.apimart.ai/v1', apiKey,
    models: [{ id: 'deepseek-v4.1-flash', capability: 'text', pricing: { inputPerMillionCents: 22.86, outputPerMillionCents: 91.43 } },
      { id: 'gpt-image-2.5-flare', capability: 'image' }, { id: 'seedance-2.0-mini', capability: 'video' }] });
  const platforms = createPlatforms(db, { quota, channels });
  platforms.savePlatform({ id: 'dingxiaosui', name: '丁小穗', bindings: [
    { capability: 'text', channelId: 'relay', model: 'deepseek-v4.1-flash' },
    { capability: 'image', channelId: 'relay', model: 'gpt-image-2.5-flare' },
    { capability: 'video', channelId: 'relay', model: 'seedance-2.0-mini' },
  ] });
  const commerce = createCommerce(db, { quota, channels, platforms, secret });
  commerce.saveProduct({ id: 'monthly', projectId: 'dingxiaosui', name: '99元月卡', units: 5, priceCents: 9900, active: true, fulfillment: 'on_payment',
    packageOptions: [{ id: 'standard', label: '月卡', quota: { text: 3, image: 1, video: 1 }, priceCents: 9900 }],
    mediaSpec: { video: { seconds: 5, resolution: '480p', audio: false } } });
  const budgets = createChannelBudgets(db);
  const siteSettings = createSiteSettings(db);
  const generation = createGeneration(db, { quota, channels, platforms, fetchImpl });
  return { db, quota, channels, platforms, commerce, budgets, siteSettings, generation };
}

test('new cards avoid confusing characters and old hex cards still redeem', t => {
  const { quota } = harness(t);
  const issued = quota.generateCodes({ projectId: 'dingxiaosui', quantity: 30, units: 2, numbered: true });
  assert.equal(issued.codes.length, 30);
  assert.equal(new Set(issued.cardNumbers).size, 30);
  assert.equal(issued.cardNumbers[0], 'DXS-0001');
  for (const code of issued.codes) {
    assert.match(code, PRINTABLE_CODE);
    assert.equal(/[01OILl]/.test(code.slice(4).replaceAll('-', '')), false);
  }
  const messy = ` ${issued.codes[0].toLowerCase().replaceAll('-', ' ')} `;
  assert.equal(quota.redeem({ projectId: 'dingxiaosui', userId: 'leader', code: messy }).units, 2);
  const legacy = `QTA-${'AB'.repeat(18)}`;
  const hash = createHash('sha256').update(legacy).digest('hex');
  const { db } = harness(t);
  db.prepare(`INSERT INTO quota_codes(id,project_id,code_hash,code_suffix,units,created_at,issuance_state) VALUES(?,?,?,?,?,?, 'active')`)
    .run(randomUUID(), 'dingxiaosui', hash, 'ABAB', 4, new Date().toISOString());
  const redeemed = createQuota(db).redeem({ projectId: 'dingxiaosui', userId: 'legacy', code: `qta${'ab'.repeat(18)}` });
  assert.equal(redeemed.units, 4);
});

test('leader batch keeps the monthly product and platform models unchanged', t => {
  const state = harness(t);
  state.budgets.saveBudget({ channelId: 'relay', total: { text: 5000, image: 5000, video: 500 } });
  const before = state.platforms.getPlatform('dingxiaosui').bindings.map(item => item.model);
  const issued = issueLeaderBatch({ ...state, quantity: 2, origin: 'https://ding.example' });
  assert.deepEqual(state.platforms.getPlatform('dingxiaosui').bindings.map(item => item.model), before);
  assert.equal(state.commerce.listProducts().some(product => product.id === 'leader-experience'), false);
  const admin = state.commerce.listProducts({ admin: true }).find(product => product.id === 'leader-experience');
  assert.equal(admin.active, false);
  assert.deepEqual(admin.packageOptions[0].quota, LEADER_QUOTA);
  assert.equal(admin.mediaSpec.models.video, 'seedance-2.5');
  assert.equal(state.commerce.listProducts({ admin: true }).find(product => product.id === 'monthly').mediaSpec.video.resolution, '480p');
  assert.equal(issued.batch.quantity, 2);
  const csv = state.commerce.exportCsv({ batchId: issued.batch.batchId, origin: 'https://ding.example' }).body;
  assert.match(csv, /卡号,激活码,套餐内容,有效期截止日,扫码链接,领取人/);
  assert.match(csv, /DXS-0001/);
  assert.match(csv, /https:\/\/ding\.example\/redeem\?code=/);
  assert.match(csv, /文案10次、图片15张、视频2条/);
  const card = state.quota.findByCardNumber('DXS-0001');
  assert.equal(card.redeemed, false);
  assert.equal(card.mediaSpec.models.text, 'claude-sonnet-5-5');
  state.quota.redeem({ projectId: 'dingxiaosui', userId: 'boss', code: csv.split('\n')[1].split(',')[1].replaceAll('"', '') });
  const used = state.quota.findByCardNumber('DXS-0001');
  assert.equal(used.redeemed, true);
  assert.equal(used.balance.byCapability.text.available, 10);
  assert.equal(used.balance.byCapability.image.available, 15);
  assert.equal(used.balance.byCapability.video.available, 2);
  const revoked = state.commerce.revokeInventoryBatch({ batchId: issued.batch.batchId });
  assert.equal(revoked.revoked, 1);
  assert.equal(revoked.skipped, 1);
  assert.throws(() => state.quota.redeem({ projectId: 'dingxiaosui', userId: 'other', code: csv.split('\n')[2].split(',')[1].replaceAll('"', '') }), error => error.status === 409);
});

test('an ordinary card video failure does not call the leader video model', async t => {
  const seen = [];
  const state = harness(t, async (_url, init) => {
    const body = JSON.parse(init.body);
    seen.push(body.model);
    if (body.model === 'seedance-2.0-mini') return json({ code: 200, data: [{ task_id: 'mini', status: 'failed' }] });
    return json({ code: 200, data: [{ task_id: 'leader-model', status: 'submitted' }] });
  });
  const channel = state.channels.listChannels()[0];
  state.channels.saveChannel({ ...channel, models: [...channel.models, { id: 'seedance-2.0', capability: 'video' }, { id: 'seedance-2.5', capability: 'video' }] });
  const code = state.quota.generateCodes({ projectId: 'dingxiaosui', quantity: 1, quota: { text: 1, image: 1, video: 1 }, mediaSpec: { tier: 'standard', video: { seconds: 5, resolution: '480p', audio: false } } }).codes[0];
  state.quota.redeem({ projectId: 'dingxiaosui', userId: 'member', code });
  const result = await state.generation.execute({ projectId: 'dingxiaosui', userId: 'member', requestId: 'std-fail', capability: 'video', prompt: '月卡视频失败' });
  assert.equal(result.status, 'failed');
  assert.deepEqual(seen, ['seedance-2.0-mini']);
});

test('only the leader card selects the expensive models, and a failed primary falls back once', async t => {
  const seen = [];
  const state = harness(t, async (_url, init) => {
    const body = JSON.parse(init.body);
    seen.push(body);
    if (body.model === 'seedance-2.5') return json({ code: 200, data: [{ task_id: 'slow', status: 'failed' }] });
    if (body.model === 'seedance-2.0') return json({ code: 200, data: [{ task_id: 'fallback-video', status: 'submitted' }] });
    if (body.model === 'claude-sonnet-5-5') return json({ choices: [{ message: { content: 'not-json' } }] });
    if (body.model === 'deepseek-v4.1-flash') return json({ choices: [{ message: { content: '{"copy":"可用文案"}' } }] });
    return json({ code: 200, data: [{ task_id: 'mini', status: 'submitted' }] });
  });
  state.budgets.saveBudget({ channelId: 'relay', total: { text: 100, image: 100, video: 20 } });
  issueLeaderBatch({ ...state, quantity: 1 });
  const leaderCode = state.commerce.exportBatch({ batchId: state.commerce.listBatches()[0].batchId }).codes[0].code;
  state.quota.redeem({ projectId: 'dingxiaosui', userId: 'boss', code: leaderCode });
  const monthly = state.quota.generateCodes({ projectId: 'dingxiaosui', quantity: 1, quota: { text: 1, image: 1, video: 1 }, mediaSpec: { video: { seconds: 5, resolution: '480p', audio: false } } }).codes[0];
  state.quota.redeem({ projectId: 'dingxiaosui', userId: 'member', code: monthly });
  const standard = await state.generation.execute({ projectId: 'dingxiaosui', userId: 'member', requestId: 'std-video', capability: 'video', prompt: '月卡视频', seconds: 15 });
  assert.equal(seen.at(-1).model, 'seedance-2.0-mini');
  assert.equal(seen.at(-1).resolution, '480p');
  assert.equal(seen.at(-1).duration, 15);
  assert.equal(standard.status, 'running');
  const video = await state.generation.execute({ projectId: 'dingxiaosui', userId: 'boss', requestId: 'leader-video', capability: 'video', prompt: '领导视频', seconds: 15 });
  assert.equal(seen.filter(body => body.model === 'seedance-2.5').length, 1);
  assert.equal(seen.at(-1).model, 'seedance-2.0');
  assert.equal(seen.at(-1).resolution, '720p');
  assert.equal(seen.at(-1).duration, 15);
  assert.equal(seen.at(-1).generate_audio, false);
  assert.equal(video.status, 'running');
  const text = await state.generation.execute({ projectId: 'dingxiaosui', userId: 'boss', requestId: 'leader-text', capability: 'text', prompt: '领导文案', responseFormat: 'json_object', messages: [{ role: 'user', content: '写一句' }] });
  assert.equal(text.status, 'ready');
  assert.match(text.output.text, /可用文案/);
  assert.equal(seen.filter(body => body.model === 'claude-sonnet-5-5').length, 1);
  assert.equal(seen.filter(body => body.model === 'deepseek-v4.1-flash').length, 1);
  assert.equal(state.quota.balance({ projectId: 'dingxiaosui', userId: 'boss' }).byCapability.text.reserved, 1);
  assert.equal(state.quota.balance({ projectId: 'dingxiaosui', userId: 'boss' }).byCapability.text.consumed, 0);
  const quote = leaderQuote(100);
  assert.deepEqual(quote.counts, { text: 1000, image: 1500, video: 200 });
  assert.ok(quote.cny > 1000 && quote.cny < 3000);
});

test('an expired unredeemed card is refused and an already redeemed card can still be opened', t => {
  const { db, quota } = harness(t);
  const expired = quota.generateCodes({ projectId: 'dingxiaosui', quantity: 1, units: 1, expiresAt: new Date(Date.now() - 1000).toISOString() }).codes[0];
  assert.throws(() => quota.redeem({ projectId: 'dingxiaosui', userId: 'late', code: expired }), error => error.status === 400);
  const live = quota.generateCodes({ projectId: 'dingxiaosui', quantity: 1, units: 1, expiresAt: new Date(Date.now() + 86400000).toISOString() }).codes[0];
  quota.redeem({ projectId: 'dingxiaosui', userId: 'early', code: live });
  db.prepare("UPDATE quota_codes SET expires_at=? WHERE redeemed_by='early'").run(new Date(Date.now() - 1000).toISOString());
  const replay = quota.redeem({ projectId: 'dingxiaosui', userId: 'early', code: live, idempotent: true });
  assert.equal(replay.replayed, true);
});
