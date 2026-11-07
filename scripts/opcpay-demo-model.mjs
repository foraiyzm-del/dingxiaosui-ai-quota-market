import { readFile } from 'node:fs/promises';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');

// Local model transport shared by the launcher and its delivery regression.
export async function fetchOpcpayDemoModel(url,init){
  if(url==='https://mock-model.invalid/image.png')return new Response(png,{headers:{'content-type':'image/png'}});
  if(url==='https://mock-model.invalid/video.mp4' || url==='https://mock-model.invalid/v1/videos/mock-video/content'){
    return new Response(await readFile(new URL('../public/assets/mock-video.mp4',import.meta.url)),{headers:{'content-type':'video/mp4'}});
  }
  if(!url.startsWith('https://mock-model.invalid/v1/'))throw new Error('隔离演示禁止外部模型网络');
  if(url.endsWith('/chat/completions'))return Response.json({choices:[{message:{content:JSON.stringify({answer:'【本地模拟】丁小穗文案生成与额度扣减验证。没有调用真实模型。',title:'尝鲜卡模拟文案'})}}]});
  if(url.endsWith('/images/generations'))return Response.json({data:[{url:'https://mock-model.invalid/image.png'}]});
  if(url.endsWith('/videos'))return Response.json({id:'mock-video',status:'completed',video_url:'https://mock-model.invalid/video.mp4'});
  if(url.endsWith('/videos/mock-video'))return Response.json({id:'mock-video',status:'completed',video_url:'https://mock-model.invalid/video.mp4'});
  throw new Error('未定义的本地模拟模型响应');
}
