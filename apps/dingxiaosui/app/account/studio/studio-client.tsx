'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {Image as ImageIcon,Film,Sparkles,RefreshCw,ArrowUpRight,CheckCircle2,Clock3,AlertCircle,Leaf,FileText,Upload,X} from 'lucide-react';

type Capability='image'|'video';
type JobStatus='submitting'|'queued'|'running'|'saving'|'succeeded'|'failed'|'unknown';
type Job={id:string;capability:Capability;status:JobStatus;prompt:string;modelName:string;createdAt:string;updatedAt:string;outputs:{url:string;persisted?:boolean;expiresAt?:string;expiresAtSource?:'provider'}[];error?:string|null};
type Model={id:string;name:string;kind:string;model:string;capability:Capability};
type Platform={available:boolean;name:string;model:string;kind?:string;authorized?:boolean;durationSeconds?:number;referenceImageSupported?:boolean;unavailableReason?:'account_not_authorized'|'service_not_configured'|null};
type Listing={jobs:Job[];models:Model[];defaultModelIds:Record<Capability,string|null>;platform:Record<Capability,Platform>;creditSource?:string};
type CreditSummary={ownerId:string;creditSource?:string;shopProductUrl?:string;quotas:{capability:'text'|Capability;available:number;reserved:number}[]};
type Ratio='1:1'|'16:9'|'9:16';
type ImageEditDraft={instructions:string;product:string;brand:string;sellingPoints:string;scene:string};
type Pending={signature:string;key:string;jobId?:string;status?:JobStatus;editDraft?:ImageEditDraft};
type ReferenceImage={dataUrl:string;hash:string;name:string;width:number;height:number};
const maxReferenceBytes=6*1024*1024;
const editIdeas=[
 {label:'换背景',text:'保留产品主体、包装与已有文字，把背景换成干净的米白色摄影棚，增加柔和自然光与真实投影。'},
 {label:'产品精修',text:'保留产品形状、颜色、纹理、包装与已有文字，优化曝光、光线、清晰度与构图，修整背景杂物，呈现自然的电商产品摄影质感。'},
 {label:'包装概念',text:'以实拍产品为依据，保留产品本身的形态与品牌识别，为外包装设计一版简洁、有质感的视觉概念；允许按此要求调整包装配色与版式，不添加未提供的认证、功效或价格。'},
];
async function prepareReference(file:File):Promise<ReferenceImage>{
 if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('请选择 JPG、PNG 或 WebP 图片。');
 if(!file.size||file.size>maxReferenceBytes)throw Error('图片须小于等于 6 MB，请压缩后重新选择。');
 const url=URL.createObjectURL(file),image=new window.Image();
 try{
  await new Promise<void>((resolve,reject)=>{image.onload=()=>resolve();image.onerror=()=>reject(Error('这张图片无法读取，请重新导出为 JPG、PNG 或 WebP。'));image.src=url});
  const width=image.naturalWidth,height=image.naturalHeight;
  if(!width||!height||width>8192||height>8192||width*height>40000000)throw Error('图片尺寸过大，请缩小至最长边 8192 像素以内后再试。');
  // Re-encode pixels to remove EXIF/location metadata; retain transparency in PNG/WebP.
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const context=canvas.getContext('2d');if(!context)throw Error('浏览器暂时无法处理图片，请换一个浏览器重试。');
  context.drawImage(image,0,0);
  const mime=file.type==='image/jpeg'?'image/jpeg':file.type==='image/webp'?'image/webp':'image/png';
  const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error('图片处理失败，请重新选择。')),mime,0.94));
  canvas.width=0;canvas.height=0;
  if(blob.size>maxReferenceBytes)throw Error('处理后的图片超过 6 MB，请缩小图片后重试。');
  const bytes=await blob.arrayBuffer(),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('');
  const dataUrl=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(Error('图片读取失败，请重新选择。'));reader.readAsDataURL(blob)});
  return {dataUrl,hash,name:file.name,width,height};
 }finally{URL.revokeObjectURL(url);image.onload=null;image.onerror=null}
}
const statusLabels:Record<JobStatus,string>={submitting:'正在提交',queued:'等待生成',running:'正在生成',saving:'正在保存作品',succeeded:'已完成',failed:'生成失败',unknown:'结果待确认'};
const activeStatuses:JobStatus[]=['submitting','queued','running','saving'];
const labels:Record<Capability,string>={image:'图片',video:'视频'};
const creativeScenes={
 image:[{id:'product',label:'产品主图',brief:'以商品为视觉中心，用自然光、清晰质感与克制留白呈现农品。'},
 {id:'detail',label:'电商详情页',brief:'设计一张竖版电商详情视觉：商品特写、真实卖点分区与使用场景，层次清晰，文字精简。'},
 {id:'ppt',label:'PPT 视觉页',brief:'设计一张横版品牌演示页面，16:9构图，大标题区、商品视觉和简洁信息层级，便于用于汇报。'},
 {id:'packaging',label:'包装视觉概念',brief:'设计农品包装的视觉概念效果图，呈现包装材质、品牌位置与商品关系。作为概念方案，不作为印刷刀版。'}],
 video:[{id:'brand',label:'品牌宣传片',brief:'品牌宣传短片：产地氛围开场，商品质感与使用场景推进，品牌意境收尾。'},
 {id:'ad',label:'产品广告片',brief:'产品广告短片：前三秒突出商品吸引力，中段展示已确认卖点与使用场景，最后定格商品。'},
 {id:'avatar',label:'虚拟人物模特',brief:'虚拟人物展示短片：一位自然亲切的虚构成年模特，在农品产地或日常生活场景中展示商品；镜头兼顾人物和商品特写，不模仿真实人物。'}],
};
class StudioApiError extends Error{constructor(message:string,readonly status:number){super(message)}}
function safeUrl(value:string){if(/^\/api\/media\/assets\/[a-zA-Z0-9_-]+(?:\?index=\d+)?$/.test(value))return value;try{const url=new URL(value);return url.protocol==='https:'||url.protocol==='http:'?url.href:null}catch{return null}}
async function api<T>(url:string,method='GET',body?:unknown,ownerId?:string):Promise<T>{
 const response=await fetch(url,{method,cache:'no-store',headers:{'content-type':'application/json',...(ownerId?{'x-zdx-media-owner':ownerId}:{})},...(url==='/api/me'?{signal:AbortSignal.timeout(6000)}:{}),...(body?{body:JSON.stringify(body)}:{})});
 const text=await response.text();let data;try{data=JSON.parse(text)}catch{throw new Error('服务暂时无法响应，请稍后刷新任务状态。')}
 if(!response.ok)throw new StudioApiError(data.error||'请求未完成，请稍后再试',response.status);return data as T;
}
function visitorMessage(message:string,eventGuest:boolean){
 if(!eventGuest)return message;
 if(/次数不足|额度不足/.test(message))return /图片/.test(message)?'图片次数已用完，请购买含图片次数的激活码。':/视频/.test(message)?'视频次数已用完，请购买含视频次数的激活码。':'当前类型的创作次数不足，请查看我的额度。';
 if(/体验已到期/.test(message))return '体验已到期，请查看我的额度。';
 if(/尚未配置|暂未开通|尚未开通|模型已停用|模型服务|密钥/.test(message))return '当前创作服务暂未开启，请稍后重试或联系工作人员。';
 if(/请先登录|身份登记|商户/.test(message))return '请先输入有效激活码，再开始创作。';
 if(/服务商|上游|接口/.test(message))return '任务状态暂未确认，请刷新或联系工作人员。系统不会自动重复生成。';
 return message;
}
function formatTime(value:string){return new Date(value).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}
export default function Studio({eventGuest=false}:{eventGuest?:boolean}){
 const [capability,setCapability]=useState<Capability>('image'),[data,setData]=useState<Listing|null>(null),[loaded,setLoaded]=useState(false),[notice,setNotice]=useState(''),[pollNotice,setPollNotice]=useState(''),[busy,setBusy]=useState(false),[refreshing,setRefreshing]=useState(false),[selected,setSelected]=useState<Record<Capability,string|null>>({image:null,video:null}),[ratio,setRatio]=useState<Ratio>('1:1'),[duration,setDuration]=useState(5),[consent,setConsent]=useState(false),[product,setProduct]=useState(''),[brand,setBrand]=useState(''),[sellingPoints,setSellingPoints]=useState(''),[scene,setScene]=useState('产品主图'),[prompt,setPrompt]=useState(''),[historyFilter,setHistoryFilter]=useState<'all'|Capability>('all'),[focusedJob,setFocusedJob]=useState<string|null>(null);
 const [imageMode,setImageMode]=useState<'text'|'edit'>('text'),[referenceImage,setReferenceImage]=useState<ReferenceImage|null>(null),[referenceBusy,setReferenceBusy]=useState(false),[referenceError,setReferenceError]=useState(''),[editInstructions,setEditInstructions]=useState('');
 const referenceInput=useRef<HTMLInputElement|null>(null),referenceEpoch=useRef(0);
 const pendingRequest=useRef<Pending|null>(null),polling=useRef(false),identityRef=useRef<string|null>(null),epochRef=useRef(0),lockedRef=useRef(true);
 const [identityReady,setIdentityReady]=useState(false),[pendingReview,setPendingReview]=useState(false),[creditSummary,setCreditSummary]=useState<CreditSummary|null>(null);
 const persistPending=useCallback((value:Pending|null)=>{pendingRequest.current=value;setPendingReview(!!value&&(value.status==='unknown'||value.status==='submitting'));if(!identityRef.current)return false;try{const key=`zdx-media-pending:${identityRef.current}`;if(value)window.sessionStorage.setItem(key,JSON.stringify(value));else window.sessionStorage.removeItem(key);return true}catch{setNotice(eventGuest?'浏览器暂时无法保存创作进度，已暂停新任务。请启用浏览器存储后重试；已有任务请刷新或联系工作人员。':'浏览器无法保存请求标识，已阻止新任务提交。请启用本机存储后再试；已有任务请先核对服务商记录。');return false}},[eventGuest]);
 const identityChanged=useCallback(()=>{epochRef.current++;lockedRef.current=true;identityRef.current=null;pendingRequest.current=null;setIdentityReady(false);setData(null);setCreditSummary(null);setPrompt('');setProduct('');setBrand('');setSellingPoints('');referenceEpoch.current++;setReferenceImage(null);setReferenceBusy(false);setReferenceError('');setImageMode('text');setEditInstructions('');setConsent(false);setPendingReview(false);setLoaded(false);window.location.reload()},[]);
 const verifyIdentity=useCallback(async()=>{const expected=identityRef.current;try{const current=await api<{user:{id:string}}>('/api/me');if(expected&&current.user.id!==expected){identityChanged();throw Error('账号已切换，正在重新读取。')}return current.user.id}catch(e){if(expected){if(e instanceof StudioApiError&&(e.status===401||e.status===403))identityChanged();else{lockedRef.current=true;setIdentityReady(false);setConsent(false);setNotice('暂时无法验证当前账号，作品已隐藏。请检查网络后重新验证。')}}throw e}},[identityChanged]);
 const load=useCallback(async(initial=false)=>{
  const epoch=epochRef.current,userId=await verifyIdentity(),[listing,credits]=await Promise.all([api<Listing>('/api/media/jobs'),eventGuest?api<CreditSummary>('/api/account/event-credits').catch(()=>null):Promise.resolve(null)]),confirmedId=await verifyIdentity();
  if(epoch!==epochRef.current)return;if(confirmedId!==userId){identityChanged();return}identityRef.current=userId;lockedRef.current=false;setIdentityReady(true);setData(listing);setCreditSummary(credits?.ownerId===userId?credits:null);
  if(initial){const params=new URLSearchParams(window.location.search);setSelected(eventGuest||params.get('provider')==='platform'?{image:null,video:null}:listing.defaultModelIds||{image:null,video:null});try{const stored=window.sessionStorage.getItem(`zdx-media-pending:${userId}`);if(stored){const value=JSON.parse(stored) as Pending;if(typeof value.key==='string'&&typeof value.signature==='string'){const job=listing.jobs.find(j=>j.id===value.jobId);if(job&&(job.status==='succeeded'||job.status==='failed'))persistPending(null);else{persistPending(value);if((!params.has('type')&&!params.has('brief')&&!params.has('provider'))||(value.editDraft&&params.get('type')!=='video'&&!params.has('brief'))){const previous=JSON.parse(value.signature) as {capability:Capability;modelId:string|null;prompt:string;ratio:Ratio;duration?:number;referenceImageHash?:string};if((previous.capability==='image'||previous.capability==='video')&&(!eventGuest||!previous.modelId)&&typeof previous.prompt==='string'){setCapability(previous.capability);setPrompt(previous.prompt.slice(0,4000));setSelected(old=>({...old,[previous.capability]:previous.modelId}));if(['1:1','16:9','9:16'].includes(previous.ratio))setRatio(previous.ratio);if(previous.duration===5||previous.duration===10||previous.duration===15)setDuration(previous.duration);setScene(previous.capability==='video'?'品牌宣传片':'产品主图');if(previous.capability==='image'&&previous.referenceImageHash&&value.editDraft){const draft=value.editDraft;if([draft.instructions,draft.product,draft.brand,draft.sellingPoints,draft.scene].every(item=>typeof item==='string')){setImageMode('edit');setEditInstructions(draft.instructions.slice(0,2800));setProduct(draft.product.slice(0,120));setBrand(draft.brand.slice(0,200));setSellingPoints(draft.sellingPoints.slice(0,1200));setScene(draft.scene.slice(0,100));}setReferenceError('上次的参考图未保存在浏览器。需要重试时，请重新选择同一张图片；已有任务可直接刷新状态。')}}}setNotice(eventGuest?'已恢复上次创作。请刷新任务状态或联系工作人员，系统不会自动重复生成。':'已恢复上次未确认的请求。请先刷新对应任务或核对服务商记录；再次提交相同内容会沿用原请求标识。')}}}}catch{/* Ignore malformed or unavailable local draft storage. */}}
  else{const job=listing.jobs.find(j=>j.id===pendingRequest.current?.jobId);if(job&&(job.status==='succeeded'||job.status==='failed'))persistPending(null)}setLoaded(true);
 },[verifyIdentity,identityChanged,persistPending,eventGuest]);
 useEffect(()=>{
  const params=new URLSearchParams(window.location.search);const requested=params.get('type')==='video'?'video':'image';const chosen=creativeScenes[requested].find(item=>item.id===params.get('scene'));if(params.get('type')==='video'){setCapability('video');setScene('品牌宣传片');setRatio('16:9')}if(chosen){setScene(chosen.label);if(chosen.id==='ppt')setRatio('16:9');if(chosen.id==='detail')setRatio('9:16')}
  let cancelled=false;const epoch=epochRef.current;
  void load(true).then(()=>{if(cancelled||epoch!==epochRef.current)return;try{const raw=window.sessionStorage.getItem('zdx-media-handoff-v1');if(raw){window.sessionStorage.removeItem('zdx-media-handoff-v1');const handoff=JSON.parse(raw);const age=Date.now()-Number(handoff.createdAt);if(handoff.ownerId===identityRef.current&&handoff.capability===requested&&age>=0&&age<15*60*1000&&typeof handoff.prompt==='string'){setPrompt(handoff.prompt.slice(0,4000));setNotice('已带入刚才的创作需求，确认画面要求后即可生成。')}}}catch{/* Ignore malformed or unavailable transfer data. */}if(params.get('brief')==='1'&&identityRef.current){try{const brief=window.sessionStorage.getItem(`zdx-media-brief:${identityRef.current}`);if(brief){setPrompt(brief.slice(0,4000));setNotice(brief.length>4000?'简报超过 4000 字，已带入前 4000 字。请精简并检查提示词后再生成。':'已带入本机商品简报。请检查并编辑提示词，确认后再提交生成。')}}catch{setNotice('本机简报未能读取，可在下方重新填写。')}}}).catch(e=>{if(!cancelled&&epoch===epochRef.current){setNotice(e.message);setLoaded(true)}});
  const changed=(event:StorageEvent)=>{if(event.key==='zdx-auth-change-v1')identityChanged()};
  const check=()=>{if(!identityRef.current||document.visibilityState==='hidden')return;const capturedEpoch=epochRef.current;lockedRef.current=true;setIdentityReady(false);void verifyIdentity().then(()=>{if(capturedEpoch===epochRef.current){lockedRef.current=false;setIdentityReady(true)}}).catch(()=>{if(capturedEpoch===epochRef.current)setNotice('账号暂未验证，作品已隐藏。请检查网络后重新验证。')})};
  window.addEventListener('storage',changed);window.addEventListener('focus',check);document.addEventListener('visibilitychange',check);
  return()=>{cancelled=true;epochRef.current++;referenceEpoch.current++;lockedRef.current=true;window.removeEventListener('storage',changed);window.removeEventListener('focus',check);document.removeEventListener('visibilitychange',check)};
 },[load,identityChanged,verifyIdentity,eventGuest]);
 const updateJob=useCallback((job:Job)=>{if(lockedRef.current)return;setData(current=>current?{...current,jobs:[job,...current.jobs.filter(j=>j.id!==job.id)].sort((a,b)=>b.createdAt.localeCompare(a.createdAt))}:current);if(pendingRequest.current?.jobId===job.id){if(job.status==='succeeded'||job.status==='failed')persistPending(null);else persistPending({...pendingRequest.current,status:job.status})}if(eventGuest){const expected=identityRef.current;void api<CreditSummary>('/api/account/event-credits').then(value=>{if(expected&&identityRef.current===expected&&value.ownerId===expected&&!lockedRef.current)setCreditSummary(value)}).catch(()=>{});}},[persistPending,eventGuest]);
 const runningIds=data?.jobs.filter(j=>activeStatuses.includes(j.status)).map(j=>j.id).join(',')||'';
 useEffect(()=>{
  if(!runningIds)return;let cancelled=false;
  const timer=window.setInterval(async()=>{
   if(polling.current||lockedRef.current||document.visibilityState==='hidden')return;polling.current=true;const epoch=epochRef.current;
   try{await verifyIdentity();const results=await Promise.allSettled(runningIds.split(',').map(id=>api<{job:Job}>(`/api/media/jobs?id=${encodeURIComponent(id)}`)));await verifyIdentity();if(!cancelled&&epoch===epochRef.current&&!lockedRef.current){let failures=0;for(const result of results){if(result.status==='fulfilled')updateJob(result.value.job);else failures++}setPollNotice(failures?'部分任务状态暂未更新。任务不会因此重复提交，可稍后刷新。':'')}}catch(e){if(!cancelled&&epoch===epochRef.current)setPollNotice((e as Error).message)}finally{polling.current=false}
  },8000);
  return()=>{cancelled=true;window.clearInterval(timer)};
 },[runningIds,updateJob,verifyIdentity]);
 async function refresh(id?:string){if(lockedRef.current)return;const epoch=epochRef.current;setRefreshing(true);setPollNotice('');try{await verifyIdentity();if(id){const d=await api<{job:Job}>(`/api/media/jobs?id=${encodeURIComponent(id)}`);await verifyIdentity();if(epoch===epochRef.current&&!lockedRef.current)updateJob(d.job)}else await load();}catch(e){if(epoch===epochRef.current)setPollNotice((e as Error).message)}finally{if(epoch===epochRef.current)setRefreshing(false)}}
 function clearReference(){referenceEpoch.current++;setReferenceImage(null);setReferenceBusy(false);setReferenceError('');setConsent(false);if(referenceInput.current)referenceInput.current.value=''}
 function changeImageMode(next:'text'|'edit'){if(busy||next===imageMode)return;clearReference();setImageMode(next);setConsent(false)}
 async function chooseReference(file?:File){
  if(!file||busy)return;
  const token=++referenceEpoch.current,epoch=epochRef.current;setReferenceImage(null);setReferenceBusy(true);setReferenceError('');setConsent(false);
  try{const prepared=await prepareReference(file);if(token===referenceEpoch.current&&epoch===epochRef.current)setReferenceImage(prepared)}
  catch(error){if(token===referenceEpoch.current&&epoch===epochRef.current)setReferenceError((error as Error).message)}
  finally{if(token===referenceEpoch.current&&epoch===epochRef.current)setReferenceBusy(false)}
 }
 function switchCapability(next:Capability){if(busy)return;setConsent(false);if(next!==capability){clearReference();setImageMode('text');setEditInstructions('');setCapability(next);setPrompt('');setRatio(next==='video'?'16:9':'1:1');setScene(next==='image'?'产品主图':'品牌宣传片')}}
 function automaticPrompt(){
  if(!product.trim())return '';
  const context=`商品：${product.trim()}。${brand.trim()?`品牌 / 产地：${brand.trim()}。`:''}${sellingPoints.trim()?`已知商品信息与卖点：${sellingPoints.trim()}。`:''}使用场景：${scene}。${creativeScenes[capability].find(item=>item.label===scene)?.brief||''}`;
  return capability==='image'?`${context}\n创作一张真实自然、有质感的农产品宣传图片，以商品为画面主体，呈现真实食材纹理、干净柔和的光线和协调背景。保留适当留白，适合后期排版。不要凭空添加认证标志、功效承诺、虚构包装或促销价格，不要生成无法核实的文字。`:`${context}\n创作一条农产品展示短视频：先以产地或食材细节建立氛围，再缓慢推进展示商品质感，最后以干净的产品画面收尾。镜头平稳、光线自然，商品外观保持一致，不添加字幕、价格、认证标志或未经核实的功效承诺。`;
 }
 const extraContext=[`创作用途：${scene}。${creativeScenes[capability].find(item=>item.label===scene)?.brief||''}`,product.trim()?`商品：${product.trim()}`:'',brand.trim()?`品牌 / 产地：${brand.trim()}`:'',sellingPoints.trim()?`已确认商品信息：${sellingPoints.trim()}`:''].filter(Boolean).join('\n');
 const editing=capability==='image'&&imageMode==='edit';
 const creativePrompt=editing?`请依据上传的产品实拍图进行二次设计。\n修改要求：${editInstructions.trim()}\n保留用户未要求修改的产品主体、品牌识别与真实特征；如果明确要求包装概念，可按要求设计新包装，并视为概念效果图。不要虚构认证、产地、功效或促销价格。\n\n${extraContext}`:prompt.trim()?`${prompt.trim()}\n\n${extraContext}`:automaticPrompt();
 const center=data?.creditSource==='quota_center',quota=creditSummary?.quotas.find(row=>row.capability===capability);
 const selectedModel=data?.models.find(m=>m.id===selected[capability]&&m.capability===capability),platform=data?.platform[capability],serviceAvailable=!!selectedModel||(!selected[capability]&&!!platform?.available),available=serviceAvailable&&(!center||!quota||quota.available>0);
 let shop:string|null=null;try{if(creditSummary?.shopProductUrl){const url=new URL(creditSummary.shopProductUrl,window.location.href);if(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password)shop=url.href;}}catch{}
 const accountNotAuthorized=platform?.unavailableReason==='account_not_authorized'||platform?.authorized===false;
 const currentKind=selectedModel?.kind||platform?.kind;
 const editSupported=center?platform?.referenceImageSupported===true:currentKind==='apimart'&&(selectedModel?.model||platform?.model)==='gpt-image-2.5-flare';
 const editReady=!editing||editSupported&&!!referenceImage&&!referenceBusy&&editInstructions.trim().length>=5;
 const effectiveDuration=center?(Number.isSafeInteger(platform?.durationSeconds)&&platform!.durationSeconds!>0?platform!.durationSeconds!:5):currentKind==='apimart'||eventGuest?15:([5,10].includes(duration)?duration:5);
 const promptLimit=capability==='video'&&(currentKind==='apimart'||center)?3500:4000;
 const promptTooLong=creativePrompt.length>promptLimit;
 const ratioLabels:Record<Ratio,string>=capability==='video'?{'1:1':'方形 · 1:1','16:9':'横屏 · 16:9','9:16':'竖屏 · 9:16'}:currentKind==='openai-compatible'?{'1:1':'方图 · 1:1','16:9':'横图 · 3:2','9:16':'竖图 · 2:3'}:{'1:1':'方图 · 1:1','16:9':'横图 · 16:9','9:16':'竖图 · 9:16'};
 async function generate(event:React.FormEvent){
  event.preventDefault();if(busy||lockedRef.current||!identityReady||!consent||!available||!editReady||creativePrompt.length<5||promptTooLong)return;const epoch=epochRef.current;
  const body={capability,modelId:selected[capability],prompt:creativePrompt,ratio,...(capability==='video'?{duration:effectiveDuration}:{}),consent:true};
  setBusy(true);setNotice('');
  try{await verifyIdentity();if(epoch!==epochRef.current||lockedRef.current)return;const signature=JSON.stringify({...body,...(editing?{referenceImageHash:referenceImage!.hash}:{})});if(pendingRequest.current&&['unknown','submitting'].includes(pendingRequest.current.status||'')&&pendingRequest.current.signature!==signature){setNotice(eventGuest?'仍有一条创作的结果待确认，请刷新任务状态或联系工作人员，系统不会自动重复生成。':'仍有一条结果待确认的请求。请先核对服务商记录，并使用上方按钮明确允许另发新任务。');return}if(pendingRequest.current?.signature!==signature)persistPending({signature,key:crypto.randomUUID(),status:'submitting',...(editing?{editDraft:{instructions:editInstructions,product,brand,sellingPoints,scene}}:{})});const request=pendingRequest.current!;if(!persistPending(request)){setConsent(false);return}const result=await api<{job:Job}>('/api/media/jobs','POST',{...body,...(editing?{referenceImage:referenceImage!.dataUrl}:{}),idempotencyKey:request.key},identityRef.current!);await verifyIdentity();if(epoch!==epochRef.current||lockedRef.current)return;persistPending({...request,jobId:result.job.id,status:result.job.status});updateJob(result.job);setFocusedJob(result.job.id);setConsent(false);if(result.job.status==='succeeded'||result.job.status==='failed')persistPending(null);setNotice(result.job.status==='succeeded'?'生成已完成，请预览并检查商品细节。':result.job.status==='failed'?(eventGuest?'本次创作未能完成，对应体验额度已释放。请查看任务提示，或联系工作人员。':`生成未完成：${result.job.error||'请查看任务详情。'} 上游可能已扣费，请核对服务商记录。`):result.job.status==='unknown'?(eventGuest?'任务结果待确认，请刷新或联系工作人员。系统不会自动重复生成。':'任务结果待确认。请先在服务商控制台核对，重复提交相同内容会沿用原请求，不会自动创建另一任务。'):'任务已提交。可继续使用其他页面，返回后会恢复任务记录。');}
  catch(e){if(epoch===epochRef.current&&!lockedRef.current){if(e instanceof StudioApiError&&[400,401,402,403,408,413,415,429].includes(e.status)){persistPending(null);setNotice(visitorMessage(e.message,eventGuest));return;}if(pendingRequest.current)persistPending({...pendingRequest.current,status:'unknown'});setNotice(eventGuest?visitorMessage((e as Error).message,true)+' 请刷新创作记录或联系工作人员，系统不会自动重复生成。':`${(e as Error).message}。上游可能已扣费，请先刷新历史或核对服务商记录。相同内容重试将沿用原请求标识。`)}}finally{if(epoch===epochRef.current)setBusy(false)}
 }
 const jobs=data?.jobs.filter(job=>(historyFilter==='all'||job.capability===historyFilter))||[];
 return <>
  <nav className="studio-task-tabs" aria-label="选择创作任务">
   <a href="/workbench.html?view=studio"><FileText size={19}/><span>写文案</span></a>
   <button type="button" aria-pressed={capability==='image'} disabled={busy} className={capability==='image'?'is-active':''} onClick={()=>switchCapability('image')}><ImageIcon size={19}/><span>做图片</span></button>
   {<button type="button" aria-pressed={capability==='video'} disabled={busy} className={capability==='video'?'is-active':''} onClick={()=>switchCapability('video')}><Film size={19}/><span>做视频</span></button>}
  </nav>
  {notice&&<div role="status" aria-live="polite" className="studio-notice"><AlertCircle size={17}/><span>{visitorMessage(notice,eventGuest)}</span></div>}
  {pendingReview&&data&&identityReady&&<div className="studio-pending-review"><p>{eventGuest?'有一条创作的结果尚未确认。请先刷新任务状态或联系工作人员，系统不会自动重复生成。':'有一条请求尚未确认结果。相同内容提交会继续原请求；另发新任务可能再次消耗额度。'}</p>{eventGuest?<button type="button" disabled={refreshing} onClick={()=>void refresh()}>刷新创作记录</button>:<button type="button" disabled={busy||!identityReady} onClick={()=>{if(window.confirm('请先确认已在服务商控制台核对上次请求。另发新任务可能再次扣费，是否允许？')){if(persistPending(null)){setConsent(false);setNotice('已允许另发新任务。请重新核对提示词，并勾选额度确认后提交。')}}}}>我已核对记录，允许另发新任务</button>}</div>}
  {data&&!identityReady?<section className="studio-login"><h2>{eventGuest?'正在确认当前体验':'正在确认当前账号'}</h2><p>验证完成前，创作表单与历史作品已隐藏。网络恢复后可重新验证。</p><button onClick={()=>{setNotice('');void load().catch(e=>setNotice(e.message))}}>重新验证</button></section>:!loaded?<div className="studio-loading"><RefreshCw size={20}/>正在读取{eventGuest?'创作服务':'模型'}与创作记录…</div>:!data?<section className="studio-login"><h2>{eventGuest?'输入激活码，开始创作。':'登录后，开始创作。'}</h2><p>{eventGuest?'激活后即可生成图片和视频，作品和剩余额度会保存在本次体验中。已经激活的话，可以重新读取。':'模型配置与生成任务属于当前账号。请登录后使用；如已登录，可重新读取。'}</p>{eventGuest?<button type="button" onClick={()=>(window as Window&{ZdxEventAccess?:{open:()=>void}}).ZdxEventAccess?.open()}>输入激活码 →</button>:<a href="/login?return_to=/account/studio">登录 / 注册 →</a>}<button onClick={()=>{setNotice('');void load(true).catch(e=>setNotice(e.message))}}>重新读取</button></section>:<>
   <div className="studio-layout"><section className="studio-editor" aria-label={capability==='image'?'图片创作表单':'视频创作表单'}>
    <div className="studio-editor-heading"><span className="studio-eyebrow">{capability==='image'?'一张图，讲清商品的好':'一段视频，展示农品的好'}</span><h2>{capability==='image'?'想为哪款农品做图片？':'想为哪款农品做视频？'}</h2><p>填好商品信息，确认后就能生成。</p></div>
    <div className="studio-scene-choices" aria-label="创作用途">{creativeScenes[capability].map(item=><button key={item.id} type="button" disabled={busy} aria-pressed={scene===item.label} onClick={()=>{setScene(item.label);setConsent(false);if(item.id==='ppt')setRatio('16:9');if(item.id==='detail')setRatio('9:16')}}>{item.label}</button>)}</div><form onSubmit={generate}><fieldset disabled={busy||!identityReady}>
     <div className={`studio-service-strip ${available?'is-ready':''}`}><span>{available?<CheckCircle2 size={15}/>:<AlertCircle size={15}/>} {eventGuest?(center&&quota?.available===0?`${labels[capability]}次数已用完`:platform?.available?`${labels[capability]}服务已开启，可提交生成`:accountNotAuthorized?'当前体验尚未激活或已到期':`${labels[capability]}创作暂未开启`):selectedModel?'使用已选择的个人服务':platform?.available?'平台服务已配置，可提交生成':accountNotAuthorized?'当前账号尚未关联有效品牌商户':`平台${labels[capability]}服务暂未开通`}</span>{!available&&<small>{eventGuest?(center&&quota?.available===0?'可按需要购买新激活码，再回来继续创作。':'请查看我的额度，或联系工作人员。'):accountNotAuthorized?'请联系管理员关联并启用品牌商户。':'请联系管理员配置并启用此服务。'}</small>}</div>
     {center&&<div className="studio-quota-strip"><span>{quota?`剩余${labels[capability]} ${quota.available} ${capability==='image'?'张':'次'}${quota.reserved?` · 处理中 ${quota.reserved}`:''}`:'额度以提交时的最新余额为准'}</span><div><a href="/account/event">查看全部次数</a>{shop&&<a href={shop} target="_blank" rel="noopener noreferrer">购买激活码 ↗</a>}</div></div>}
     {!eventGuest&&data.models.some(m=>m.capability===capability)&&<details className="studio-service-options"><summary>更换创作服务{selectedModel?` · ${selectedModel.name}`:''}</summary><label>本次使用<select value={selected[capability]||''} onChange={e=>{setSelected({...selected,[capability]:e.target.value||null});clearReference();setConsent(false)}}><option value="">{platform?.available?'平台服务':accountNotAuthorized?'平台服务 · 账号尚未授权':'平台服务 · 暂未开通'}</option>{data.models.filter(m=>m.capability===capability).map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label><p className="studio-help">这里可以切换你已保存的个人服务。</p></details>}
     {capability==='image'&&<>
      <div className="studio-image-modes" aria-label="图片创作方式"><button type="button" aria-pressed={imageMode==='text'} onClick={()=>changeImageMode('text')}><Sparkles size={17}/><span>文字生图<small>从描述开始创作</small></span></button><button type="button" aria-pressed={imageMode==='edit'} onClick={()=>changeImageMode('edit')}><ImageIcon size={17}/><span>上传图片改图<small>基于你的产品实拍</small></span></button></div>
      {editing&&<section className="studio-image-edit" aria-label="产品图片二次设计">
       <div className="studio-reference-heading"><span>01 / 选择产品实拍图</span><small>JPG · PNG · WebP / 最多 6 MB</small></div>
       {!editSupported&&<p className="studio-poll-error" role="status">当前所选图片服务暂不支持此改图入口，请选择已接入的 GPT 图片服务。</p>}
       <input className="studio-reference-input" ref={referenceInput} id="studio-reference-file" type="file" tabIndex={-1} accept="image/jpeg,image/png,image/webp" aria-label="选择产品实拍图" disabled={!editSupported} onChange={e=>{const file=e.target.files?.[0];e.target.value='';void chooseReference(file)}}/>
       {referenceImage?<div className="studio-reference-preview"><img src={referenceImage.dataUrl} alt="本次用于二次设计的产品实拍图"/><div className="studio-reference-caption"><div><strong>{referenceImage.name}</strong><small>{referenceImage.width} × {referenceImage.height} · 仅在本页预览</small></div><button type="button" aria-label="移除参考图片" onClick={clearReference}><X size={16}/></button></div><button type="button" className="studio-reference-replace" onClick={()=>referenceInput.current?.click()}>替换图片</button></div>:<button type="button" className="studio-reference-drop" disabled={!editSupported||referenceBusy} onClick={()=>referenceInput.current?.click()}>{referenceBusy?<RefreshCw size={25} className="is-spinning"/>:<Upload size={25}/>}<strong>{referenceBusy?'正在处理图片…':'选择一张产品实拍图'}</strong><span>清晰的主体与包装，让修改更有依据</span></button>}
       {referenceBusy&&<button type="button" className="studio-reference-cancel" onClick={clearReference}>取消选择</button>}
       {referenceError&&<p className="studio-poll-error" role="alert">{referenceError}</p>}
       <label className="studio-edit-instructions">02 / 希望怎样修改？<textarea required minLength={5} maxLength={2800} rows={4} placeholder="例如：保留这盒玉露香梨和包装文字，换成米白色背景，柔和侧光，增加自然投影，做成电商主图。" value={editInstructions} onChange={e=>{setEditInstructions(e.target.value);setConsent(false)}}/></label>
       <div className="studio-edit-ideas" aria-label="改图建议">{editIdeas.map(idea=><button key={idea.label} type="button" onClick={()=>{setEditInstructions(idea.text);setConsent(false);if(idea.label==='包装概念')setScene('包装视觉概念')}}>{idea.label}<ArrowUpRight size={12}/></button>)}</div>
       <p className="studio-reference-note">原图不会被覆盖，结果另存为新作品。AI 可能改变细节，请核对产品外观、商标与包装文字。</p>
      </section>}
     </>}
     <div className="studio-fields"><label>商品名称{editing?'（可选）':''}<input required={!editing&&!prompt.trim()} maxLength={120} placeholder="例如：沁州黄小米" value={product} onChange={e=>{setProduct(e.target.value);setConsent(false)}}/></label><label>品牌 / 产地<input maxLength={200} placeholder="例如：某品牌 · 山西沁县" value={brand} onChange={e=>{setBrand(e.target.value);setConsent(false)}}/></label></div>
     <label>希望突出哪些特点？<textarea rows={3} maxLength={1200} placeholder="例如：金黄米粒、简洁袋装、适合家庭早餐。填写已确认的信息即可。" value={sellingPoints} onChange={e=>{setSellingPoints(e.target.value);setConsent(false)}}/></label>
     <label>准备怎么用？<select value={scene} onChange={e=>{setScene(e.target.value);setConsent(false)}}>{creativeScenes[capability].map(s=><option key={s.id}>{s.label}</option>)}</select></label>
     <div className="studio-fields"><label>{capability==='image'?'图片比例':'画面比例'}<select value={ratio} onChange={e=>{setRatio(e.target.value as Ratio);setConsent(false)}}>{(['1:1','16:9','9:16'] as Ratio[]).map(r=><option key={r} value={r}>{ratioLabels[r]}</option>)}</select></label>{capability==='video'?<label>视频时长<select value={effectiveDuration} onChange={e=>{setDuration(Number(e.target.value));setConsent(false)}}>{center?<option value={effectiveDuration}>{effectiveDuration} 秒</option>:currentKind==='apimart'||eventGuest?<option value={15}>15 秒 · 720p</option>:<><option value={5}>5 秒</option><option value={10}>10 秒</option></>}</select></label>:<div className="studio-size-note">每次生成 1 张图片</div>}</div>
     {!editing&&<details className="studio-advanced"><summary>调整创意描述（可选）{prompt.trim()?' · 已自定义':''}</summary><p>我们会根据商品信息自动整理。你也可以在这里补充构图、光线或镜头要求。</p><label>创意描述<textarea minLength={5} maxLength={4000} rows={6} placeholder="先填写商品名称，或直接描述你希望看到的画面…" value={prompt||automaticPrompt()} onChange={e=>{setPrompt(e.target.value);setConsent(false)}}/></label>{prompt&&<button className="studio-reset-prompt" type="button" onClick={()=>{setPrompt('');setConsent(false)}}>恢复为商品信息自动整理</button>}</details>}
     {promptTooLong&&<p role="alert" className="studio-poll-error">创作要求与商品信息合计 {creativePrompt.length} 字，请精简至 {promptLimit} 字以内再生成。</p>}<label className="studio-consent"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/><span>{editing&&<>我同意将这张产品图与修改要求发送给当前图片模型处理。</>}{eventGuest?`我确认生成${capability==='image'?' 1 张图片':` 1 条 ${effectiveDuration} 秒视频`}，成功后使用 1 次对应创作额度；商品信息已经核实。`:<>我确认使用{selected[capability]?'个人服务':'平台服务'}生成 {capability==='image'?'1 张图片':`1 条 ${effectiveDuration} 秒视频`}，会消耗{selected[capability]?'我的服务商':'平台'}额度；商品信息已经核实。</>}</span></label>
     {editing&&<p className="studio-reference-note">{center?'确认生成后，参考图将交给当前图片服务处理。':'确认生成后，参考图会上传到 APIMart 临时存储，服务方标注保留 72 小时。'}刷新或离开本页后，需要重新选择参考图。</p>}
     <button className="studio-generate" type="submit" disabled={busy||!consent||!available||!editReady||creativePrompt.length<5||promptTooLong}>{busy?<RefreshCw size={18}/>:capability==='image'?<Sparkles size={18}/>:<Film size={18}/>} {busy?'正在提交，请稍候…':editing?'生成改图作品':`生成${labels[capability]}`}<ArrowUpRight size={17}/></button>
     <p className="studio-help">{capability==='video'?'视频生成需要一些时间，提交后可在右侧查看进度。':'生成后请检查商品外观、包装与文字，再下载使用。'} 本页不收款。</p>
    </fieldset></form>
   </section><aside className="studio-results"><div className="studio-history-heading"><div><span className="studio-eyebrow">我的作品</span><h2>我的图片与视频</h2></div><button className="studio-refresh" aria-label="刷新所有创作记录" disabled={refreshing} onClick={()=>void refresh()}><RefreshCw size={17} className={refreshing?'is-spinning':''}/></button></div><div className="studio-filters" aria-label="作品类型筛选">{(['all','image','video'] as const).map(value=><button key={value} className={historyFilter===value?'is-active':''} onClick={()=>setHistoryFilter(value)}>{value==='all'?'全部':labels[value]}</button>)}</div>{pollNotice&&<p className="studio-poll-error" role="status">{visitorMessage(pollNotice,eventGuest)}</p>}
    {!jobs.length?<div className="studio-empty"><div><Leaf size={36}/></div><h3>第一份作品，从这里生长。</h3><p>填写左侧的商品信息并确认生成，<br/>结果会保存在{eventGuest?'本次体验':'当前账号'}的创作记录中。</p><small>{eventGuest?'生成后可预览、下载，输入同一激活码可继续查看':'生成后可预览、下载，历史记录属于当前账号'}</small></div>:<div className="studio-job-list">{jobs.map(job=><article key={job.id} className={`studio-job ${focusedJob===job.id?'is-focused':''}`}><div className="studio-job-top"><span className="studio-job-kind">{job.capability==='image'?<ImageIcon size={15}/>:<Film size={15}/>} {labels[job.capability]}</span><span className={`studio-job-status status-${job.status}`}>{activeStatuses.includes(job.status)?<Clock3 size={12}/>:job.status==='succeeded'?<CheckCircle2 size={12}/>:<AlertCircle size={12}/>} {statusLabels[job.status]||job.status}</span></div>
      {job.status==='succeeded'&&job.outputs?.length>0?<div className="studio-outputs">{job.outputs.map((output,index)=>{const url=safeUrl(output.url);return url?<div key={`${index}-${url}`}>{job.capability==='image'?<img src={url} alt={`生成的农品图片 ${index+1}`} loading="lazy"/>:<video src={url} controls playsInline preload="metadata"/>}<a href={url} target="_blank" rel="noopener noreferrer" download>打开{labels[job.capability]}并保存 <ArrowUpRight size={13}/></a>{output.persisted===false&&<p className="studio-poll-error">临时链接，请立即打开保存；实际有效期以服务商为准。{output.expiresAtSource==='provider'&&output.expiresAt&&Number.isFinite(Date.parse(output.expiresAt))&&`服务商标注到期：${formatTime(output.expiresAt)}`}</p>}</div>:<p key={index} className="studio-poll-error">结果地址不可用，请联系管理员检查接口。</p>})}</div>:<div className={`studio-job-placeholder ${job.status==='failed'?'is-failed':''}`}>{job.status==='failed'?<AlertCircle size={28}/>:job.capability==='image'?<ImageIcon size={30}/>:<Film size={30}/>}<b>{job.status==='succeeded'?'服务未返回可展示的文件':statusLabels[job.status]}</b><p>{job.status==='unknown'?(eventGuest?'任务结果待确认，请刷新或联系工作人员。系统不会自动重复生成。':'请先在服务商控制台核对结果，避免重复生成消耗额度。'):job.status==='failed'?visitorMessage(job.error||(eventGuest?'本次创作未能完成，对应体验额度已释放。请联系工作人员了解原因。':'请检查配置、额度或提示词后重试。'),eventGuest):job.status==='succeeded'?(eventGuest?'请刷新状态或联系工作人员查看结果。':'请刷新状态或联系管理员查看结果。'):'可以离开此页，稍后回来查看。'}</p></div>}
      {job.error&&job.status!=='failed'&&<p className="studio-poll-error">{visitorMessage(job.error,eventGuest)}</p>}<div className="studio-job-meta"><span>{eventGuest?(job.capability==='image'?'图片':center?'视频':'15 秒视频'):job.modelName}</span><time dateTime={job.createdAt}>{formatTime(job.createdAt)}</time></div><details><summary>查看创作要求与任务信息</summary><p>{job.prompt}</p><small>任务编号：{job.id}</small><small>更新时间：{formatTime(job.updatedAt)}</small></details><div className="studio-job-actions"><button disabled={refreshing} onClick={()=>void refresh(job.id)}><RefreshCw size={13}/>刷新状态</button><button disabled={busy} onClick={()=>{switchCapability(job.capability);clearReference();setImageMode('text');setEditInstructions('');setPrompt(job.prompt);const editMatch=job.capability==='image'&&job.prompt.startsWith('请依据上传的产品实拍图进行二次设计。')?job.prompt.match(/修改要求：([\s\S]*?)\n保留用户未要求修改/):null;if(editMatch){setImageMode('edit');setEditInstructions(editMatch[1]);setNotice('已带入改图要求，请重新选择产品实拍图，核实后确认生成。')}else setNotice('已带入该任务提示词。请核实内容并确认额度后生成。');window.scrollTo({top:0,behavior:'smooth'})}}>复用创意</button></div></article>)}</div>}
    <div className="studio-result-note"><Leaf size={16}/><p>{eventGuest?'生成后请核对包装、外观、产地信息及文字。作品会保存在本次体验中，也可下载到自己的设备。':'生成后请核对包装、外观、产地信息及文字。服务商的文件链接可能有有效期，满意后请及时保存到自己的设备。'}</p></div>
   </aside></div>
  </>}
 </>;
}
