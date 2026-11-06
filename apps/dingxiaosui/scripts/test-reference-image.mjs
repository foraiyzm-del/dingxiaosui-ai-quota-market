// Real browser decode/canvas regression. Only synthetic images and loopback HTTP;
// no production data, .env files or model calls. Run with retain-test-files.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import ts from 'typescript';
import {imageMime} from '../../../sidecar/image.mjs';

const root=path.resolve(import.meta.dirname,'..');
const folder=fs.mkdtempSync(path.join(fs.mkdirSync(path.join(root,'.ecs-test'),{recursive:true})||path.join(root,'.ecs-test'),'reference-image-'));
const source=fs.readFileSync(path.join(root,'lib/reference-image.ts'),'utf8');
const module=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText+'\nwindow.prepareReference=prepareReference;';
const server=http.createServer((req,res)=>{
 res.setHeader('cache-control','no-store');
 if(req.url==='/reference-image.js'){res.writeHead(200,{'content-type':'text/javascript'});res.end(module);return;}
 if(req.url==='/'){res.writeHead(200,{'content-type':'text/html'});res.end('<!doctype html><html><head><meta charset="utf-8"></head><body><script type="module" src="/reference-image.js"></script></body></html>');return;}
 res.writeHead(404);res.end();
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
let browser;
const results=[];
try{
 browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage();
 await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await page.goto(origin);await page.waitForFunction(()=>typeof window.prepareReference==='function');
 for(const scenario of [
  {name:'landscape-png',width:6000,height:3000,mime:'image/png',expected:[4096,2048],transparent:true},
  {name:'portrait-jpeg',width:3000,height:6000,mime:'image/jpeg',expected:[2048,4096]},
  {name:'rounded-webp',width:6000,height:2000,mime:'image/webp',expected:[4096,1365],transparent:true},
  {name:'maximum-input-edge',width:8192,height:2048,mime:'image/png',expected:[4096,1024]},
  {name:'upload-edge-unchanged',width:4096,height:2048,mime:'image/png',expected:[4096,2048]},
  {name:'small-image-no-upscale',width:640,height:480,mime:'image/png',expected:[640,480]},
 ]){
  const result=await page.evaluate(async scenario=>{
   const original=document.createElement('canvas');original.width=scenario.width;original.height=scenario.height;
   const paint=original.getContext('2d');
   if(!scenario.transparent){paint.fillStyle='rgb(240,240,240)';paint.fillRect(0,0,original.width,original.height);}
   paint.fillStyle='rgba(32,160,64,0.75)';paint.fillRect(original.width/4,original.height/4,original.width/2,original.height/2);
   const blob=await new Promise(resolve=>original.toBlob(resolve,scenario.mime,0.92));
   original.width=0;original.height=0;
   const file=new File([blob],scenario.name,{type:''});
   const sourceBefore=await file.arrayBuffer();
   const prepared=await window.prepareReference(file);
   const sourceAfter=await file.arrayBuffer();
   const decoded=await createImageBitmap(await (await fetch(prepared.dataUrl)).blob());
   const canvas=document.createElement('canvas');canvas.width=decoded.width;canvas.height=decoded.height;
   const context=canvas.getContext('2d');context.drawImage(decoded,0,0);
   const pixels={corner:[...context.getImageData(0,0,1,1).data],center:[...context.getImageData(Math.floor(decoded.width/2),Math.floor(decoded.height/2),1,1).data]};
   const decodedSize=[decoded.width,decoded.height];decoded.close();canvas.width=0;canvas.height=0;
   return{...prepared,inputBytes:file.size,decodedSize,pixels,originalUnchanged:new Uint8Array(sourceBefore).every((value,index)=>value===new Uint8Array(sourceAfter)[index])};
  },scenario);
  const bytes=Buffer.from(result.dataUrl.split(',')[1],'base64');
  assert.deepEqual([result.width,result.height],scenario.expected,scenario.name);
  assert.deepEqual(result.decodedSize,scenario.expected,'Preview dimensions must describe the uploaded bytes');
  assert.ok(Math.abs(result.width/scenario.width-result.height/scenario.height)<=1/Math.min(scenario.width,scenario.height),'Image is scaled proportionally with at most one rounded pixel');
  assert.ok(bytes.length<=6*1024*1024);assert.ok(result.originalUnchanged,'Original file must stay untouched');
  assert.equal(imageMime(bytes),scenario.mime,'The center must accept the actual browser output');
  assert.equal(result.hash,createHash('sha256').update(bytes).digest('hex'),'Idempotency hash must describe the resized bytes');
  if(scenario.transparent){assert.equal(result.pixels.corner[3],0,'Transparent borders must remain transparent');assert.ok(Math.abs(result.pixels.center[3]-191)<=2,'Partial alpha must survive scaling');}
  const file=path.join(folder,scenario.name+'.'+({'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[scenario.mime]));fs.writeFileSync(file,bytes);
  results.push({name:scenario.name,source:[scenario.width,scenario.height],output:result.decodedSize,inputBytes:result.inputBytes,outputBytes:bytes.length,centerAccepted:true});console.log('PASS',scenario.name);
 }
 for(const [mode,expected] of [['input-too-large',/6 MB/],['invalid-signature',/有效的 JPG/],['invalid-image',/无法读取/],['unsupported-size',/8192/],['output-too-large',/处理后的图片超过 6 MB/]]){
  const message=await page.evaluate(async mode=>{
   let file,restore;
   if(mode==='input-too-large')file=new File([new Uint8Array(6*1024*1024+1)],'large.png');
   else if(mode==='invalid-signature')file=new File(['not an image'],'fake.jpg');
   else if(mode==='invalid-image')file=new File([new Uint8Array([137,80,78,71,13,10,26,10,1,2,3,4,5,6,7,8])],'broken.png');
   else{
    const canvas=document.createElement('canvas');canvas.width=mode==='unsupported-size'?8193:2;canvas.height=2;
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));canvas.width=0;canvas.height=0;
    file=new File([blob],'synthetic.png');
    if(mode==='output-too-large'){
     const original=HTMLCanvasElement.prototype.toBlob;
     HTMLCanvasElement.prototype.toBlob=function(callback){callback(new Blob([new Uint8Array(6*1024*1024+1)],{type:'image/png'}));};
     restore=()=>{HTMLCanvasElement.prototype.toBlob=original;};
    }
   }
   try{await window.prepareReference(file);return 'unexpected success';}catch(error){return error.message;}finally{restore?.();}
  },mode);
  assert.match(message,expected,mode);results.push({name:mode,rejected:true,message});console.log('PASS',mode);
 }
 fs.writeFileSync(path.join(folder,'results.json'),JSON.stringify({passed:results.length,realProviderCalls:false,results},null,2));
 console.log(`PASS ${results.length} browser reference-image regressions. Artifacts retained: ${folder}`);
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
