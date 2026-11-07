// Private configuration only. Never receives or prints a secret on the CLI.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { root } from './setup.mjs';
import { FIXED_PACKAGES } from '../sidecar/opcpay.mjs';
const template = card => ({ enabled:false, apiKey:'', skuId:'', merchantProjectName:card.name,
  projectId:card.projectId, productId:card.productId, packageId:card.packageId, termsConfirmed:false,
  verifiedPackage:{priceCents:card.priceCents,quotaUnit:'COUNT',amount:1} });
export async function prepareOpcpayConfig({directory=root,addFixedPackages=false}={}) {
  const folder=path.join(directory,'local'), target=path.join(folder,'opcpay.json');
  await fs.mkdir(folder,{recursive:true});
  let previous;
  try { previous=await fs.readFile(target,'utf8'); } catch(error){if(error.code!=='ENOENT')throw error;}
  const config=previous===undefined?{...template(FIXED_PACKAGES.trial),sandbox:false}:JSON.parse(previous);
  if(!config || typeof config!=='object' || Array.isArray(config))throw new Error('配置格式无效');
  if(previous!==undefined&&!addFixedPackages)return {created:false,changed:false};
  if(config.packages!==undefined&&(!config.packages || Array.isArray(config.packages)||typeof config.packages!=='object'))throw new Error('packages 配置格式无效');
  config.packages??={}; let changed=previous===undefined;
  for(const id of ['week','month']) if(config.packages[id]===undefined){config.packages[id]=template(FIXED_PACKAGES[id]);changed=true;}
  if(!changed)return {created:false,changed:false};
  let backup;
  if(previous!==undefined){backup=path.join(folder,`opcpay-before-week-month-${Date.now()}.json`);await fs.writeFile(backup,previous,{flag:'wx',mode:0o600});}
  const temporary=target+'.'+process.pid+'.tmp';
  try {await fs.writeFile(temporary,JSON.stringify(config,null,2)+'\n',{flag:'wx',mode:0o600});await fs.rename(temporary,target);}
  finally {await fs.rm(temporary,{force:true});}
  return {created:previous===undefined,changed:true,backup:backup?path.basename(backup):undefined};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const args=process.argv.slice(2);
    if(args.length>1||(args.length&&args[0]!=='--add-fixed-packages'))throw new Error('参数无效');
    const result=await prepareOpcpayConfig({addFixedPackages:args.includes('--add-fixed-packages')});
    console.log(result.changed?'已准备 local/opcpay.json；原配置私密备份，已有字段保留。周/月默认停用，请填入专用项目资料后运行只读探针。':'现有配置保持不变。');
  }catch{console.error('配置初始化未完成，请检查本机 local/opcpay.json；未输出密钥。');process.exitCode=1;}
}
