import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

const root=resolve(import.meta.dirname,'dist');
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.json':'application/json; charset=utf-8'};
createServer(async(req,res)=>{
  const pathname=decodeURIComponent(new URL(req.url||'/',`http://${req.headers.host||'localhost'}`).pathname);
  const name=pathname==='/'?'index.html':pathname.replace(/^\/+/,''),path=resolve(root,name);
  if(!path.startsWith(root+sep)){res.writeHead(403).end();return;}
  try{const body=await readFile(path);res.writeHead(200,{'Content-Type':types[name.slice(name.lastIndexOf('.'))]||'application/octet-stream'}).end(body);}
  catch{res.writeHead(404).end();}
}).listen(8768,'127.0.0.1');
