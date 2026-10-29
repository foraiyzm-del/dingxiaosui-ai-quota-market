// Read-only release smoke checks. This script never creates accounts or AI jobs.
import assert from 'node:assert/strict';
const origin=new URL(process.argv[2]||'http://127.0.0.1:8815').origin;
const checks=[];
for(const [pathname,status,marker] of [
 ['/',200,'紫丁香'],['/workbench.html',200,'workspace-storage.js'],
 ['/account/models',200,'默认用平台服务'],['/account/studio',200,'今天，想为农品做点什么'],
 ['/platform/services',200,'AI 服务'],['/ai-tutorial.html',200,'紫丁香'],
 ['/platform/media',200,'视频'],['/login',200,'欢迎回来'],
 ['/api/me',401],['/api/account/models',401],['/api/media/jobs',401],
 ['/api/platform/media-settings',401],
]){
 const response=await fetch(new URL(pathname,origin),{redirect:'follow',signal:AbortSignal.timeout(20000)});
 assert.equal(new URL(response.url).origin,origin,'release check must stay on the same site');
 const body=await response.text();
 checks.push({path:pathname,status:response.status,expected:status,marker:marker?body.includes(marker):undefined});
}
console.log(JSON.stringify({origin,checkedAt:new Date().toISOString(),checks},null,2));
for(const check of checks){assert.equal(check.status,check.expected,check.path);if(check.marker!==undefined)assert.equal(check.marker,true,check.path+' content');}
console.log('PASS: release pages and anonymous protected APIs. No paid provider calls, credentials, or production writes.');
