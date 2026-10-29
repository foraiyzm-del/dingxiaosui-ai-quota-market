// Browser smoke checks with intercepted HTTP only. No real cards, keys or model calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright';

const root=path.resolve(import.meta.dirname,'..');
const browser=await chromium.launch({channel:'chrome',headless:true});
const owner={id:'isolated-quota-owner'};
const shop='https://shop.example.test/?service=dingxiaosui-creator';
const baseAccess={enabled:true,authenticated:false,activated:false,quotaCenterEnabled:true,shopProductUrl:shop};
const wallet={ownerId:owner.id,creditSource:'quota_center',activated:true,active:true,shopProductUrl:shop,shared:{available:0},entries:[],quotas:[['text',3],['image',1],['video',1]].map(([capability,available])=>({capability,profile:'standard',available,total:available,reserved:0,used:0,expiresAt:null}))};
const html='<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="sheet"></div></body></html>';
let checks=0;
async function pageFor(access=baseAccess,summary=wallet){
 const page=await browser.newPage({viewport:{width:390,height:844}});
 await page.route('**/*',route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/api/event/session')return route.fulfill({json:access});
  if(url.pathname==='/api/account/event-credits')return route.fulfill({json:summary});
  if(url.pathname==='/api/credit-plans')return route.fulfill({json:{mode:'event',service:{available:false,reason:'旧本地模型未配置'}}});
  if(url.pathname==='/workbench.html')return route.fulfill({contentType:'text/html',body:html});
  return route.fulfill({status:404,body:''});
 });
 await page.goto('http://quota-ui.test/workbench.html');
 return page;
}
try{
 for(const [label,access] of [['combination',baseAccess],['legacy',{...baseAccess,quotaCenterEnabled:false,shopProductUrl:''}],['unsafe-link',{...baseAccess,shopProductUrl:'javascript:alert(1)'}]]){
  const page=await pageFor(access);
  await page.addStyleTag({content:fs.readFileSync(path.join(root,'event-access.css'),'utf8')});
  await page.addScriptTag({content:fs.readFileSync(path.join(root,'event-access.js'),'utf8')});
  await page.evaluate(async()=>{await window.ZdxEventAccess.ready;window.ZdxEventAccess.open();});
  const dialog=page.locator('.event-access-dialog');await dialog.waitFor({state:'visible'});
  const text=await dialog.innerText();
  if(label==='combination'){
   assert.match(text,/次数按需组合/);assert.doesNotMatch(text,/15 秒视频|激活后 7 天/);
   assert.equal(await page.locator('[data-event-purchase]').getAttribute('href'),shop);checks+=3;
  }else if(label==='legacy'){
   assert.match(text,/15 秒视频/);assert.match(text,/激活后 7 天/);checks+=2;
  }else{assert.equal(await page.locator('[data-event-purchase]').isVisible(),false);assert.equal(await page.locator('[data-event-purchase]').getAttribute('href'),null);checks+=2;}
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));checks++;
  await page.close();
 }
 for(const shared of [0,2]){
  const summary={...wallet,shared:{available:shared}};
  const page=await pageFor(baseAccess,summary);
  await page.evaluate(({access,owner})=>{window.ZdxEventAccess={state:access,ready:Promise.resolve(access),open(){window.activationOpened=true}};window.testOwner=owner;},{access:baseAccess,owner});
  await page.addScriptTag({content:fs.readFileSync(path.join(root,'dialogue-credits.js'),'utf8')});
  await page.evaluate(()=>{window.ZdxCredits.create({getOwner:()=>window.testOwner,openSheet(title,html){document.querySelector('#sheet').innerHTML=html;},onBalance(value){window.displayBalance=value;}}).open();});
  await page.waitForFunction(()=>window.displayBalance===3);
  const text=await page.locator('#credit-panel').innerText();
  assert.match(text,/文案、图片、视频次数/);assert.doesNotMatch(text,/首次激活起 7 天|15 秒视频|旧本地模型未配置|体验已到期/);checks+=2;
  assert.deepEqual(await page.locator('.wallet-event-balances strong').allTextContents(),['3次','1张','1条']);checks++;
  if(shared){assert.match(text,/2 次共享额度/);assert.match(text,/不能将三项可用次数相加/);checks+=2;}
  assert.equal(await page.getByRole('link',{name:'按需购买新激活码'}).getAttribute('href'),shop);checks++;
  await page.getByRole('button',{name:'使用另一张激活码'}).click();assert.equal(await page.evaluate(()=>window.activationOpened),true);checks++;
  await page.close();
 }
 console.log(`PASS ${checks} quota-center UI checks; all HTTP mocked, no paid calls.`);
}finally{await browser.close();}
