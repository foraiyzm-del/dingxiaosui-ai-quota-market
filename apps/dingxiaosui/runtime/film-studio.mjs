import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomBytes,randomUUID,createCipheriv,createDecipheriv} from 'node:crypto';
import {submitVideo,pollVideo,downloadVideo,synthesizeSpeech} from './film-providers.mjs';
import {renderFilm,checkRenderer} from './film-renderer.mjs';

export class FilmError extends Error {constructor(status,message){super(message);this.status=status;}}
const sha=value=>createHash('sha256').update(value).digest('hex');
const stamp=()=>new Date().toISOString();
const activeStatuses=new Set(['queued','running']);
const voice='zh_female_zhixingnv_uranus_bigtts';
const resource='seed-tts-2.0';
const preset={title:'岚县，一桌宴与一双手',segments:[
 {prompt:'山西岚县土豆宴创意影像，10秒9:16竖屏。暖色自然窗光、木桌与陶碗，写实电影质感。先拍带泥纹理的土豆特写，再切到蒸屉里的半透明蒸饺和土豆泥状主食，蒸汽轻轻升起；最后手将陶碗轻放到桌上。镜头缓慢稳定，不要魔法变形、文字、字幕、商标或人物面孔。手指结构正确，食物不漂浮。这是概念场景，不冒充餐馆实拍。',narration:'在山西岚县，一颗土豆，也能做成一桌宴。蒸汽升起，家常食材有了许多种滋味。'},
 {prompt:'岚县面塑手作创意影像，10秒9:16竖屏。暖色自然侧光、木案、真实面团质感。一双成年人的手慢慢压出一片面团花瓣，动作简单克制；切到白面莲花、桃子造型和红枣装饰的细节，缓慢推进。手指结构正常，不展示具体传承人，不生成文字、字幕、商标，不要魔法变形或花瓣凭空生长。概念演绎，非实拍。',narration:'一团面，在手里捏出花瓣，变成莲花、寿桃，再点上一颗红枣。'},
 {prompt:'岚县一桌宴与一双手创意影像，10秒9:16竖屏。保持暖米色、木桌、陶碗、自然窗光。左侧土豆宴概念菜肴热气轻升，右侧白面莲花、寿桃和红枣装饰。一双手把面花轻放桌上，镜头缓慢拉远，最后稳定留白。真实食物与手作质感，手指正常，无文字字幕商标、无穿模漂浮。不冒充真实餐馆与传承人。',narration:'我们用人工智能，把资料里的味道与手艺变成眼前的想象。岚县，一桌宴与一双手。'}
]};
function atomic(file,value){const temp=file+'.tmp-'+randomUUID();fs.writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600});fs.renameSync(temp,file);}
function read(file){return JSON.parse(fs.readFileSync(file,'utf8'));}
function safeText(value,max,label){if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))throw new FilmError(400,`${label}缺失或过长`);return value.trim();}
function alive(pid){try{process.kill(pid,0);return true;}catch{return false;}}
function publicJob(job){return {id:job.id,title:job.title,status:job.status,stage:job.stage,error:job.error||null,createdAt:job.createdAt,updatedAt:job.updatedAt,canResume:!!job.canResume,segments:job.segments.map(s=>({status:s.status,stage:s.stage})),...(job.output?{output:{videoUrl:`/api/films/jobs/${job.id}/video`,downloadUrl:`/api/films/jobs/${job.id}/video?download=1`,subtitleUrl:`/api/films/jobs/${job.id}/subtitles`,duration:job.output.duration,width:job.output.width,height:job.output.height,subtitleTiming:job.output.subtitleTiming}}:{})};}

/** File-backed worker for the project's Node/local runtime. No external editor or database migration. */
export function createFilmStudio({directory,providers={},renderer=renderFilm,rendererCheck=checkRenderer,pollMs=12000,maxPolls=150}={}){
 if(!directory)throw Error('Video data directory is required');
 directory=path.resolve(directory);fs.mkdirSync(directory,{recursive:true,mode:0o700});
 if(fs.lstatSync(directory).isSymbolicLink())throw Error('Video data directory must not be a link');
 const keyFile=path.join(directory,'settings.key'),settingsFile=path.join(directory,'settings.enc.json'),jobsDir=path.join(directory,'jobs'),lockFile=path.join(directory,'worker.lock');
 fs.mkdirSync(jobsDir,{recursive:true,mode:0o700});
 if(!fs.existsSync(keyFile)){if(fs.existsSync(settingsFile))throw Error('Restore the video settings encryption key');try{fs.writeFileSync(keyFile,randomBytes(32),{mode:0o600,flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;}}
 const encryptionKey=fs.readFileSync(keyFile);if(encryptionKey.length!==32)throw Error('Invalid video settings encryption key');
 const active=new Map(),api={submitVideo,pollVideo,downloadVideo,synthesizeSpeech,...providers};
 const folder=id=>path.join(jobsDir,id),jobFile=id=>path.join(folder(id),'job.json');
 function loadSettings(){if(!fs.existsSync(settingsFile))return {revision:0,videoModel:'',videoApiKey:'',speechApiKey:'',speechResourceId:resource,speechVoice:voice};const data=read(settingsFile),decipher=createDecipheriv('aes-256-gcm',encryptionKey,Buffer.from(data.iv,'hex'));decipher.setAuthTag(Buffer.from(data.tag,'hex'));return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data.data,'base64')),decipher.final()]).toString());}
 const speechMode=c=>c.speechAuthMode||'apiKey';
 const speechReady=c=>speechMode(c)==='legacy'?!!c.speechAppId&&!!c.speechAccessToken:!!c.speechApiKey;
 function publicSettings(){const c=loadSettings();return {revision:c.revision,videoModel:c.videoModel,hasVideoKey:!!c.videoApiKey,hasSpeechKey:!!c.speechApiKey,speechAuthMode:speechMode(c),speechAppId:c.speechAppId||'',hasSpeechAccessToken:!!c.speechAccessToken,speechResourceId:c.speechResourceId,speechVoice:c.speechVoice};}
 function saveSettings(body){
  const c=loadSettings();if(body.revision!==c.revision)throw new FilmError(409,'配置已经更新，请刷新后再保存');
  const permitted=['revision','videoModel','videoApiKey','speechApiKey','speechAuthMode','speechAppId','speechAccessToken','speechResourceId','speechVoice'];if(Object.keys(body).some(k=>!permitted.includes(k)))throw new FilmError(400,'包含不支持的配置字段');
  const model=safeText(body.videoModel,120,'视频模型 ID');if(!/^[a-zA-Z0-9._:-]+$/.test(model))throw new FilmError(400,'视频模型 ID 格式不正确');
  for(const k of ['videoApiKey','speechApiKey','speechAccessToken'])if(body[k]!==undefined&&(typeof body[k]!=='string'||body[k].length>4096||/[\r\n]/.test(body[k])))throw new FilmError(400,'接口密钥格式不正确');
  const authMode=body.speechAuthMode??speechMode(c);if(!['apiKey','legacy'].includes(authMode))throw new FilmError(400,'语音认证方式不正确');
  const appId=body.speechAppId===undefined?(c.speechAppId||''):body.speechAppId;if(typeof appId!=='string'||(appId!==''&&!/^\d{1,30}$/.test(appId)))throw new FilmError(400,'语音 APP ID 应为数字');
  if(c.speechAccessToken&&appId!==c.speechAppId&&!body.speechAccessToken?.trim())throw new FilmError(400,'更换语音 APP ID 时请同时填写对应的 Access Token');
  if(body.speechResourceId!==resource||body.speechVoice!==voice)throw new FilmError(400,'本版使用语音合成 2.0 的知性女声');
  const next={revision:c.revision+1,videoModel:model,videoApiKey:body.videoApiKey?.trim()||c.videoApiKey,speechApiKey:body.speechApiKey?.trim()||c.speechApiKey,speechAuthMode:authMode,speechAppId:appId,speechAccessToken:body.speechAccessToken?.trim()||c.speechAccessToken||'',speechResourceId:resource,speechVoice:voice};
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',encryptionKey,iv),data=Buffer.concat([cipher.update(JSON.stringify(next)),cipher.final()]);atomic(settingsFile,{iv:iv.toString('hex'),tag:cipher.getAuthTag().toString('hex'),data:data.toString('base64')});return publicSettings();
 }
 let rendererCached;
 const rendererOptions=()=>({ffmpegPath:process.env.FILM_FFMPEG_PATH,ffprobePath:process.env.FILM_FFPROBE_PATH,fontPath:process.env.FILM_FONT_PATH});
 async function capabilities(){const c=loadSettings();if(!rendererCached||Date.now()-rendererCached.at>60000){try{const detail=await rendererCheck(rendererOptions());rendererCached={at:Date.now(),ready:detail?.ready!==false,detail,reason:detail?.reason};}catch(e){rendererCached={at:Date.now(),ready:false,reason:e.message};}}
  const missing=[];if(!c.videoApiKey)missing.push('火山方舟视频 API Key');if(!c.videoModel)missing.push('已开通的视频模型 ID');if(!speechReady(c))missing.push(speechMode(c)==='legacy'?'豆包语音 APP ID 与 Access Token（语音合成 2.0）':'豆包语音 API Key（语音合成 2.0）');if(!rendererCached.ready)missing.push('本机视频合成组件：'+rendererCached.reason);
  return {ready:missing.length===0,missing,video:{configured:!!c.videoApiKey&&!!c.videoModel,model:c.videoModel},speech:{configured:speechReady(c),voiceName:'知性女声'},renderer:{ready:rendererCached.ready,...(rendererCached.reason?{reason:rendererCached.reason}:{})}};
 }
 function writeJob(job){job.updatedAt=stamp();atomic(jobFile(job.id),job);}
 function readOwned(owner,id){if(!/^[a-f0-9-]{36}$/.test(id))throw new FilmError(404,'短片任务不存在');let job;try{job=read(jobFile(id));}catch(e){if(e.code==='ENOENT')throw new FilmError(404,'短片任务不存在');throw e;}if(job.owner!==sha(owner))throw new FilmError(404,'短片任务不存在');return job;}
 function recover(job){
  if(!activeStatuses.has(job.status)||active.has(job.id))return job;
  let lock;try{lock=read(lockFile);}catch{}
  if(lock?.jobId===job.id&&alive(lock.pid))return job;
  const ambiguous=job.segments.some(s=>s.videoSubmitting&&!s.upstreamId||s.speechSubmitting&&!s.audioPath);
  job.status='needs_attention';job.stage='任务中断';job.canResume=!ambiguous;job.error=ambiguous?'服务曾在提交模型时中断，是否计费尚未确认。请先核对服务商任务，不会自动重新生成。':'服务已重启，已完成镜头和配音均保留，可继续处理。';writeJob(job);return job;
 }
 function list(owner){return fs.readdirSync(jobsDir).filter(id=>/^[a-f0-9-]{36}$/.test(id)).flatMap(id=>{try{const j=read(jobFile(id));return j.owner===sha(owner)?[publicJob(recover(j))]:[];}catch{return [];}}).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,50);}
 function acquire(jobId){const token=randomUUID();let handle;try{handle=fs.openSync(lockFile,'wx',0o600);}catch(e){if(e.code!=='EEXIST')throw e;let old;try{old=read(lockFile);}catch{throw new FilmError(409,'合成服务正在恢复，请稍后再试');}if(alive(old.pid))throw new FilmError(409,'网站正在制作另一条短片，请等待完成');fs.renameSync(lockFile,lockFile+'.interrupted-'+randomUUID());handle=fs.openSync(lockFile,'wx',0o600);}fs.writeFileSync(handle,JSON.stringify({jobId,pid:process.pid,token}));fs.closeSync(handle);return ()=>{try{if(read(lockFile).token===token)fs.unlinkSync(lockFile);}catch{}};}
 async function create(owner,body){
  if(body.consent!==true)throw new FilmError(400,'请确认本次生成三段视频和配音会使用模型额度');
  if(typeof body.requestId!=='string'||!/^[a-zA-Z0-9_-]{16,80}$/.test(body.requestId))throw new FilmError(400,'缺少有效的任务标识');
  const title=safeText(body.title,60,'短片标题');if(!Array.isArray(body.segments)||body.segments.length!==3)throw new FilmError(400,'30 秒短片需要三个镜头');
  const segments=body.segments.map(s=>({prompt:safeText(s.prompt,1800,'镜头描述'),narration:safeText(s.narration,60,'旁白（每段最多60字）')}));
  const hash=sha(JSON.stringify({title,segments})),ownerHash=sha(owner);
  // Check every durable receipt before any paid POST, even if the browser lost its acknowledgement.
  for(const name of fs.readdirSync(jobsDir)){if(!/^[a-f0-9-]{36}$/.test(name))continue;const j=read(jobFile(name));if(j.owner===ownerHash&&j.requestId===body.requestId){if(j.hash!==hash)throw new FilmError(409,'同一请求标识对应了不同内容，请先核对已有任务');return publicJob(recover(j));}}
  const caps=await capabilities();if(!caps.ready)throw new FilmError(503,'尚未具备生成条件：'+caps.missing.join('、'));
  // A concurrent request may have written its receipt while preflight awaited FFmpeg.
  for(const name of fs.readdirSync(jobsDir)){if(!/^[a-f0-9-]{36}$/.test(name))continue;const j=read(jobFile(name));if(j.owner===ownerHash&&j.requestId===body.requestId){if(j.hash!==hash)throw new FilmError(409,'任务标识冲突');return publicJob(recover(j));}}
  const id=randomUUID(),release=acquire(id);try{
   // A process that won the lock must recheck idempotency after an awaited preflight.
   for(const name of fs.readdirSync(jobsDir)){if(!/^[a-f0-9-]{36}$/.test(name))continue;const j=read(jobFile(name));if(j.owner===ownerHash&&j.requestId===body.requestId){release();if(j.hash!==hash)throw new FilmError(409,'任务标识冲突');return publicJob(j);}}
   fs.mkdirSync(folder(id),{mode:0o700});const job={id,owner:ownerHash,requestId:body.requestId,hash,title,segments:segments.map(s=>({...s,status:'queued',stage:'等待生成'})),createdAt:stamp(),updatedAt:stamp(),status:'queued',stage:'准备生成',canResume:false};writeJob(job);start(job,release);return publicJob(job);
  }catch(e){release();throw e;}
 }
 function start(job,release){const task=run(job).finally(()=>{active.delete(job.id);release();});active.set(job.id,task);void task.catch(()=>{});}
 async function run(job){const config=loadSettings();job.status='running';job.canResume=false;job.error=null;writeJob(job);
  try{
   for(let i=0;i<3;i++){
    const s=job.segments[i],setStage=text=>{s.stage=text;job.stage=`镜头 ${i+1}/3 · ${text}`;writeJob(job);};s.status='running';
    if(!s.videoPath){
     if(!s.upstreamId){if(s.videoSubmitting)throw new FilmError(409,'视频提交结果待核对，禁止自动重新提交');setStage('提交视频生成');s.videoSubmitting=true;writeJob(job);
      try{const submitted=await api.submitVideo({apiKey:config.videoApiKey,model:config.videoModel,prompt:s.prompt});s.upstreamId=submitted.id;s.videoSubmitting=false;writeJob(job);}catch(e){if(!e.uncertain)s.videoSubmitting=false;throw e;}}
     setStage('等待动态镜头');let completed=false;
     for(let attempt=0;attempt<maxPolls;attempt++){
      const result=await api.pollVideo({apiKey:config.videoApiKey,id:s.upstreamId});
      if(result.status==='succeeded'){setStage('保存动态镜头');const dest=path.join(folder(job.id),`scene-${i+1}.mp4`);if(fs.existsSync(dest))fs.renameSync(dest,path.join(folder(job.id),`scene-${i+1}.unconfirmed-${randomUUID()}.mp4`));await api.downloadVideo({url:result.url,destination:dest});s.videoPath=dest;completed=true;writeJob(job);break;}
      if(['failed','expired','cancelled'].includes(result.status)){s.providerFailed=true;throw new FilmError(502,result.error||'视频模型未完成本镜头，请检查权限、余额和内容要求');}
      await new Promise(resolve=>setTimeout(resolve,pollMs));
     }
     if(!completed)throw new FilmError(504,'动态镜头仍在服务商生成，可稍后继续查询，不会重复提交');
    }
    if(!s.audioPath){if(s.speechSubmitting)throw new FilmError(409,'配音提交结果待核对，禁止自动重新提交');setStage('生成知性女声与字幕');s.speechSubmitting=true;writeJob(job);
     try{const auth=speechMode(config)==='legacy'?{appId:config.speechAppId,accessToken:config.speechAccessToken}:{apiKey:config.speechApiKey};const audio=await api.synthesizeSpeech({...auth,resourceId:config.speechResourceId,voice:config.speechVoice,text:s.narration,destination:path.join(folder(job.id),`voice-${i+1}.mp3`),requestId:randomUUID()});s.audioPath=audio.path;s.subtitles=audio.subtitles;s.speechSubmitting=false;writeJob(job);}catch(e){if(!e.uncertain)s.speechSubmitting=false;throw e;}}
    s.status='succeeded';setStage('镜头与配音已完成');
   }
   job.stage='合成 30 秒视频与字幕';writeJob(job);
   const output=await renderer({directory:folder(job.id),segments:job.segments,title:job.title,...rendererOptions(),onProgress:message=>{job.stage=typeof message==='string'?message:`合成字幕与视频${typeof message?.progress==='number'?' · '+Math.round(message.progress*100)+'%':''}`;writeJob(job);}});
   job.output={...output,subtitleTiming:output.segments?.every(s=>s.timingSource==='provider')?'provider':'mixed-or-estimated'};job.status='succeeded';job.stage='成片已完成';job.canResume=false;writeJob(job);
  }catch(e){job.status=e.uncertain||job.segments.some(s=>s.videoSubmitting||s.speechSubmitting)?'needs_attention':'failed';job.error=e.message||'制作未完成，已保留已生成的素材';job.stage='等待处理';for(const segment of job.segments)if(segment.status==='running'){segment.status=job.status;segment.stage='已暂停，等待核对';}job.canResume=job.status==='failed'&&!job.segments.some(s=>s.providerFailed)&&job.segments.some(s=>s.upstreamId||s.videoPath);writeJob(job);}
 }
 async function resume(owner,id,body){if(body.consent!==true)throw new FilmError(400,'请确认继续处理已保存的任务');let job=recover(readOwned(owner,id));if(activeStatuses.has(job.status)||job.status==='succeeded')return publicJob(job);if(!job.canResume)throw new FilmError(409,'当前任务不能自动继续，请先核对提示原因');const caps=await capabilities();if(!caps.ready)throw new FilmError(503,caps.missing.join('、'));const release=acquire(id);try{job=readOwned(owner,id);if(activeStatuses.has(job.status)||job.status==='succeeded'){release();return publicJob(job);}if(!job.canResume)throw new FilmError(409,'任务状态已经变化，请刷新后核对');start(job,release);return publicJob(job);}catch(e){release();throw e;}}
 function asset(owner,id,type){const job=readOwned(owner,id);if(job.status!=='succeeded'||!job.output)throw new FilmError(404,'成片尚未完成');const file=type==='video'?job.output.videoPath:job.output.srtPath;if(typeof file!=='string'||!fs.existsSync(file))throw new FilmError(404,'作品文件不存在');const real=fs.realpathSync(file);if(!real.startsWith(fs.realpathSync(folder(id))+path.sep))throw new FilmError(403,'作品文件路径不可访问');return {path:real,contentType:type==='video'?'video/mp4':'application/x-subrip; charset=utf-8',filename:`lanxian-${id}.${type==='video'?'mp4':'srt'}`};}
 return {capabilities,publicSettings,saveSettings,create,resume,asset,list,get:(owner,id)=>publicJob(recover(readOwned(owner,id))),workspace:async(owner,canConfigure=false)=>({preset,capabilities:await capabilities(),storageScope:sha(owner).slice(0,24),canConfigure,jobs:list(owner)}),wait:async()=>{await Promise.allSettled([...active.values()]);}};
}

/** Supports range playback and attachment downloads without exposing filesystem paths. */
export function filmAssetResponse(asset,request){const stat=fs.statSync(asset.path),range=request.headers.get('range');let start=0,end=stat.size-1,status=200;
 const headers={'content-type':asset.contentType,'cache-control':'private, no-store','x-content-type-options':'nosniff','accept-ranges':'bytes','content-disposition':`${new URL(request.url).searchParams.get('download')==='1'||asset.filename.endsWith('.srt')?'attachment':'inline'}; filename="${asset.filename}"`};
 if(range){const m=/^bytes=(\d*)-(\d*)$/.exec(range);if(!m||!m[1]&&!m[2])return new Response(null,{status:416,headers:{'content-range':`bytes */${stat.size}`}});if(!m[1]){start=Math.max(0,stat.size-Number(m[2]));}else{start=Number(m[1]);if(m[2])end=Math.min(Number(m[2]),end);}if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=stat.size)return new Response(null,{status:416,headers:{'content-range':`bytes */${stat.size}`}});status=206;headers['content-range']=`bytes ${start}-${end}/${stat.size}`;}
 headers['content-length']=String(end-start+1);if(request.method==='HEAD')return new Response(null,{status,headers});
 // Stream byte ranges; a 30-second result need not be buffered in memory to play.
 const stream=fs.createReadStream(asset.path,{start,end});const body=new ReadableStream({start(controller){stream.on('data',chunk=>controller.enqueue(new Uint8Array(chunk)));stream.on('end',()=>controller.close());stream.on('error',error=>controller.error(error));},cancel(){stream.destroy();}});return new Response(body,{status,headers});
}
