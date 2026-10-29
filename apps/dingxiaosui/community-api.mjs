import { readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

const file = resolve(import.meta.dirname, 'community-data.json');
const categories = new Set(['内容创作', '本地营销', 'OPC 经营', '系统使用', '山西风物']);
const kinds = new Set(['discussion', 'article']);
let mutationQueue = Promise.resolve();

const clean = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const tokenHash = value => createHash('sha256').update(value).digest('hex');
const publicPost = post => ({
  id:post.id,kind:post.kind,category:post.category,title:post.title,body:post.body,
  author:post.author,province:post.province,createdAt:post.createdAt,
  editorial:Boolean(post.editorial),source:post.editorial?post.source:undefined,
  replies:(post.replies||[]).map(reply=>({id:reply.id,author:reply.author,body:reply.body,createdAt:reply.createdAt}))
});
const send = (response,status,data) => response.writeHead(status,{
  'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff'
}).end(JSON.stringify(data));

async function readStore(){
  const seed=JSON.parse(await readFile(resolve(import.meta.dirname,'community-seed.json'),'utf8'));
  const editorialPosts=(seed.posts||[]).map(post=>({...post,ownerHash:'editorial'}));
  let contents;
  try{contents=await readFile(file,'utf8');}
  catch(error){
    if(error.code==='ENOENT'){
      return {posts:editorialPosts};
    }
    throw error;
  }
  const parsed=JSON.parse(contents);
  if(!Array.isArray(parsed.posts))throw new Error('社区数据格式不正确，请先检查 community-data.json。');
  const existing=new Set(parsed.posts.map(post=>post.id));
  for(const post of editorialPosts)if(!existing.has(post.id))parsed.posts.push(post);
  return parsed;
}
async function readBody(request){
  let body='';
  for await(const chunk of request){
    body+=chunk;
    if(body.length>22000)throw new Error('内容过长，请缩短后再发布。');
  }
  try{return JSON.parse(body);}catch{throw new Error('提交内容格式不正确。');}
}
function mutate(work){
  const result=mutationQueue.then(work);
  mutationQueue=result.catch(()=>{});
  return result;
}

export async function handleCommunityApi(request,response,pathname){
  if(!pathname.startsWith('/api/community'))return false;
  if(pathname==='/api/community' && request.method==='GET'){
    try{
      const store=await readStore();
      send(response,200,{posts:store.posts.slice().reverse().map(publicPost)});
    }catch{send(response,500,{error:'社区数据暂时无法读取，请检查本地数据文件。'});}
    return true;
  }
  if(pathname==='/api/community/posts' && request.method==='POST'){
    try{
      const input=await readBody(request);
      const author=clean(input.author,24),province=clean(input.province,24),title=clean(input.title,90),body=clean(input.body,6000),
        category=clean(input.category,24),kind=clean(input.kind,16),ownerToken=clean(input.ownerToken,100);
      if(!author||!title||body.length<20||!categories.has(category)||!kinds.has(kind)||ownerToken.length<24||input.ack!==true){
        send(response,400,{error:'请填好称呼、标题和至少 20 字正文，并确认资料可分享。'});return true;
      }
      const post=await mutate(async()=>{
        const store=await readStore();
        if(store.posts.length>=500){send(response,507,{error:'本地演示社区已达到容量上限。'});return null;}
        const item={id:randomUUID(),kind,category,title,body,author,province,createdAt:new Date().toISOString(),ownerHash:tokenHash(ownerToken),replies:[]};
        store.posts.push(item);
        await writeFile(file,JSON.stringify(store,null,2),'utf8');
        return item;
      });
      if(post)send(response,201,{post:publicPost(post)});
    }catch(error){send(response,400,{error:error.message||'发布失败。'});}
    return true;
  }
  const replyMatch=/^\/api\/community\/posts\/([a-f0-9-]{36})\/replies$/.exec(pathname);
  if(replyMatch && request.method==='POST'){
    try{
      const input=await readBody(request);
      const author=clean(input.author,24),body=clean(input.body,1200);
      if(!author||body.length<2||input.ack!==true){send(response,400,{error:'请填写称呼和回复内容。'});return true;}
      const reply=await mutate(async()=>{
        const store=await readStore(),post=store.posts.find(item=>item.id===replyMatch[1]);
        if(!post){send(response,404,{error:'帖子不存在。'});return null;}
        if((post.replies||[]).length>=100){send(response,507,{error:'这条讨论的回复已达到演示上限。'});return null;}
        const item={id:randomUUID(),author,body,createdAt:new Date().toISOString()};
        post.replies.push(item);
        await writeFile(file,JSON.stringify(store,null,2),'utf8');
        return item;
      });
      if(reply)send(response,201,{reply});
    }catch(error){send(response,400,{error:error.message||'回复失败。'});}
    return true;
  }
  const postMatch=/^\/api\/community\/posts\/([a-f0-9-]{36})$/.exec(pathname);
  if(postMatch && request.method==='DELETE'){
    try{
      const input=await readBody(request),ownerToken=clean(input.ownerToken,100);
      if(ownerToken.length<24){send(response,403,{error:'仅原发布浏览器可以删除此帖。'});return true;}
      const removed=await mutate(async()=>{
        const store=await readStore(),index=store.posts.findIndex(item=>item.id===postMatch[1]);
        if(index<0){send(response,404,{error:'帖子不存在。'});return false;}
        if(store.posts[index].ownerHash!==tokenHash(ownerToken)){send(response,403,{error:'仅原发布浏览器可以删除此帖。'});return false;}
        store.posts.splice(index,1);
        await writeFile(file,JSON.stringify(store,null,2),'utf8');
        return true;
      });
      if(removed)send(response,200,{ok:true});
    }catch(error){send(response,400,{error:error.message||'删除失败。'});}
    return true;
  }
  send(response,404,{error:'社区接口不存在。'});
  return true;
}
