import assert from 'node:assert/strict';
import { test } from 'node:test';
import { paymentSelection, savedIntentSelection } from '../public/opcpay-state.js';

const info = {packages:[
  {ready:true,package:{packageId:'trial',name:'丁小穗尝鲜卡',priceCents:990,quota:{text:10,image:15,video:2}}},
  {ready:true,package:{packageId:'week',name:'丁小穗周卡',priceCents:2990,quota:{text:30,image:45,video:6}}},
  {ready:false,reason:'收款配置待完成',package:{packageId:'month',name:'丁小穗月卡',priceCents:9900,quota:{text:100,image:150,video:20}}},
]};
test('checkout displays the selected plan but saved intent snapshot wins over URL changes',()=>{
  assert.equal(paymentSelection(info,'?package=week').package.priceCents,2990);
  assert.equal(paymentSelection(info,'?package=month').ready,false);
  assert.equal(paymentSelection(info,'?package=season'),null);
  const intent={snapshot:{...info.packages[0].package}};
  const chosen=paymentSelection(info,'?package=month',intent);
  assert.equal(chosen.package.packageId,'trial');
  assert.deepEqual(chosen.package.quota,{text:10,image:15,video:2});
  assert.equal(chosen.package.priceCents,990);
});
test('weekly purchase never automatically restores an unfinished trial intent',()=>{
  const intents=[{id:'trial-old',status:'awaiting_payment',snapshot:{packageId:'trial'}},
    {id:'week-old',status:'unknown',snapshot:{packageId:'week'}}];
  assert.equal(savedIntentSelection(intents,'?package=week').id,'week-old');
  assert.equal(savedIntentSelection(intents,'?package=month'),undefined);
  assert.equal(savedIntentSelection(intents,'?intent=trial-old&package=month').id,'trial-old');
  assert.equal(savedIntentSelection(intents,'?intent=missing'),undefined);
  assert.equal(savedIntentSelection(intents,'').id,'trial-old');
});
