// Read-only merchant preflight. Never prints raw configuration or errors.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { root } from './setup.mjs';
import { FIXED_PACKAGES } from '../sidecar/opcpay.mjs';
import { createOpcpayClient } from '../sidecar/opcpay-client.mjs';
export async function probeOpcpay({config,packageId='trial',client}={}) {
  const card=Object.hasOwn(FIXED_PACKAGES,packageId)&&FIXED_PACKAGES[packageId];
  if(!card)throw new Error('不支持的套餐');
  const profile=packageId==='trial'?config:config?.packages?.[packageId];
  const result={checkedAt:new Date().toISOString(),readOnly:true,packageId,
    expected:{priceCents:card.priceCents,quotaUnit:'COUNT',amount:1},differences:[],realPaymentVerified:false};
  if(!profile?.apiKey){result.differences.push('缺少该套餐专用项目的服务端 API Key');return result;}
  try {
    const pay=client??createOpcpayClient({apiKey:profile.apiKey,baseURL:profile.baseURL});
    const [caps,product]=await Promise.all([pay.capabilities(),pay.product()]);
    result.providerConfigured=caps.provider_configured===true;result.projectName=product.product_name;result.status=product.capability_status;
    result.capabilities=caps.capabilities;result.termsConfirmed=profile.termsConfirmed===true;
    if(!result.providerConfigured)result.differences.push('商户服务未配置');
    for(const flag of ['purchase_entry','entitlement_query','consumption','purchase_request_query'])if(!caps.capabilities?.[flag])result.differences.push('缺少能力：'+flag);
    if(product.capability_status!=='ENABLED')result.differences.push('收款项目未启用');
    if(product.product_name!==profile.merchantProjectName)result.differences.push('收款项目名称与本地记录不一致');
    if(product.billing_mode!=='QUANTITY'||product.quota_unit!=='COUNT')result.differences.push('项目须为 QUANTITY / COUNT');
    if(product.charging_options?.length!==1)result.differences.push('每档卡须为只含一个套餐的专用收款项目');
    const sku=product.charging_options?.find(x=>x.sku_id===profile.skuId);
    result.package=sku?Object.fromEntries(['sku_id','display_name','billing_mode','price','currency','quota_unit','quota_amount','entitlement_rule'].map(k=>[k,sku[k]])):null;
    if(!sku)result.differences.push('找不到配置的 SKU');
    else {
      for(const [field,value] of Object.entries({billing_mode:'QUANTITY',entitlement_rule:'QUOTA',quota_unit:'COUNT',quota_amount:1,currency:'CNY'}))if(sku[field]!==value)result.differences.push(field+' 不匹配');
      const match=typeof sku.price==='string'&&/^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(sku.price);
      if(!match || BigInt(match[1])*100n+BigInt((match[2]??'').padEnd(2,'0'))!==BigInt(card.priceCents))result.differences.push('价格应为 '+(card.priceCents/100).toFixed(2)+' 元');
    }
    if(packageId!=='trial')for(const id of ['trial','week','month']){
      if(id===packageId)continue;const other=id==='trial'?config:config?.packages?.[id];
      if(other?.apiKey&&(other.apiKey===profile.apiKey||other.merchantProjectName===profile.merchantProjectName))result.differences.push('不能与其他卡共用收款项目');
    }
  }catch {result.differences.push('商户只读请求失败，请检查本机配置与权限');}
  return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try{
    const args=process.argv.slice(2), packageId=args[0]==='--package'?args[1]:'trial';
    if(args.length&&!(args.length===1&&args[0]==='--all')&&!(args.length===2&&args[0]==='--package'&&Object.hasOwn(FIXED_PACKAGES,packageId)))throw new Error('参数无效');
    const config=JSON.parse(await fs.readFile(path.join(root,'local/opcpay.json'),'utf8'));
    const results=[];for(const id of args[0]==='--all'?['trial','week','month']:[packageId])results.push(await probeOpcpay({config,packageId:id}));
    console.log(JSON.stringify(results.length===1?results[0]:results,null,2));
    if(results.some(r=>r.differences.length))process.exitCode=1;
  }catch{console.error('只读核对未完成；请检查 local/opcpay.json 和 --package trial|week|month 参数。未创建购买或核销。');process.exitCode=1;}
}
