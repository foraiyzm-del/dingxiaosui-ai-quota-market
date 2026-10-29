import { mkdir, readdir, readFile, writeFile, copyFile, cp, lstat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import {renderCreditOffers} from './scripts/render-credit-offers.mjs';

const root=import.meta.dirname, output=join(root,'dist');
// Public task metadata never contains the server-side generation instructions.
const taskCatalog=JSON.parse(await readFile(join(root,'lib','dialogue-tasks.json'),'utf8'));
const publicTasks=taskCatalog.map(({id,name,group,description,placeholder,source})=>({id,name,group,description,placeholder,source}));
await writeFile(join(root,'dialogue-tools.json'),JSON.stringify(publicTasks,null,2)+'\n','utf8');
// Update generated files without bulk deletion; never follow a linked directory.
const outputInfo=await lstat(output).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
if(outputInfo?.isSymbolicLink())throw new Error('Refusing to replace a linked dist directory');
await mkdir(output,{recursive:true});
const eventEntry=html=>html.replace(/<head(?:\s[^>]*)?>/i,tag=>tag+'<link rel="stylesheet" href="/event-access.css?v=direct-1"><script src="/event-access.js?v=direct-1" defer></script>');
const allowed=new Set(['.html','.js','.css','.webp','.jpg','.jpeg','.png','.svg','.json']);
for(const name of await readdir(root)){
  if(!allowed.has(extname(name))||['community-data.json','package.json','package-lock.json','tsconfig.json','components.json'].includes(name))continue;
  if(name==='landing.html'||name==='index.html')continue;
  const source=join(root,name),destination=join(output,name);
  if(['.html','.js','.css'].includes(extname(name))){
    const original=await readFile(source,'utf8');
    const content=name==='event-access.js'?original:original.replaceAll('index.html','workbench.html');
    await writeFile(destination,extname(name)==='.html'?eventEntry(content):content,'utf8');
  }else await copyFile(source,destination);
}
const catalog=JSON.parse(await readFile(join(root,'credit-plans.json'),'utf8'));
await writeFile(join(output,'index.html'),eventEntry((await readFile(join(root,'landing.html'),'utf8')).replace('<!-- CREDIT_OFFERS -->',renderCreditOffers(catalog)).replaceAll('index.html','workbench.html')),'utf8');
await writeFile(join(output,'workbench.html'),eventEntry((await readFile(join(root,'index.html'),'utf8')).replaceAll('index.html','workbench.html')),'utf8');
// Keep tutorial screenshots on the same origin; never publish deliverables or runtime data.
await cp(join(root,'assets','ai-tutorial'),join(output,'assets','ai-tutorial'),{recursive:true});
await copyFile(join(root,'third-party-notices.txt'),join(output,'third-party-notices.txt'));
console.log('静态发布目录已生成：dist/');
