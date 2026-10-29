'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import '../billing/credits.css';

type Quota={capability:'image'|'text'|'video';profile:'standard';available:number;reserved:number;used:number;total:number;expiresAt:string|null};
type Entry={id:string;kind:string;delta:number;note:string;createdAt:string;capability:'image'|'text'|'video';profile:string};
type AccessState={creditSource?:string;quotaCenterEnabled?:boolean;shopProductUrl?:string;videoSeconds?:number};
type Summary=AccessState&{ownerId:string;activated:boolean;active:boolean;quotas:Quota[];entries?:Entry[];shared?:{available:number;total?:number;reserved?:number;used?:number}};
type ResponseBody=Partial<Summary>&{error?:string};
type EventAccess={open:()=>void;exit:()=>void};
const names={image:'图片',text:'文案',video:'视频'};
function purchaseUrl(value?:string){if(!value)return null;try{const url=new URL(value,typeof location==='undefined'?'http://localhost':location.href);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password?url.href:null;}catch{return null;}}
function summary(value:ResponseBody):Summary{
 if(typeof value.ownerId!=='string'||typeof value.activated!=='boolean'||typeof value.active!=='boolean'||!Array.isArray(value.quotas)||value.quotas.length!==3||new Set(value.quotas.map(row=>row.capability)).size!==3||value.quotas.some(row=>!['image','text','video'].includes(row.capability)||row.profile!=='standard'||['available','reserved','used','total'].some(key=>!Number.isSafeInteger(row[key as keyof Quota])||Number(row[key as keyof Quota])<0)))throw Error('额度响应不完整，请重新读取。');
 return value as Summary;
}
function date(value:string){const parsed=new Date(value);return Number.isNaN(parsed.getTime())?'时间待核对':parsed.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'});}

export default function EventClient(){
 const [wallet,setWallet]=useState<Summary|null>(null),[notice,setNotice]=useState(''),[loading,setLoading]=useState(true),[authenticated,setAuthenticated]=useState(false);
 const epoch=useRef(0);
 const [configuration,setConfiguration]=useState<AccessState>({});
 const load=useCallback(async()=>{
  const version=epoch.current;
  try{
   const [response,session]=await Promise.all([fetch('/api/account/event-credits',{cache:'no-store',credentials:'same-origin'}),fetch('/api/event/session',{cache:'no-store',credentials:'same-origin'}).then(async response=>response.ok?await response.json() as AccessState:null).catch(()=>null)]),value=await response.json() as ResponseBody;
   if(session&&version===epoch.current)setConfiguration(session);
   if(version!==epoch.current)return;
   if(response.status===401){setAuthenticated(false);setWallet(null);setNotice('');return;}
   if(!response.ok)throw Error(value.error||'体验额度暂时无法读取。');
   setWallet(summary(value));setAuthenticated(true);setNotice('');
  }catch(error){if(version===epoch.current){setWallet(null);setNotice((error as Error).message);}}
  finally{if(version===epoch.current)setLoading(false);}
 },[]);
 useEffect(()=>{
  void load();
  const changed=(event:StorageEvent)=>{if(event.key==='zdx-auth-change-v1'){epoch.current++;setWallet(null);window.location.reload();}};
  window.addEventListener('storage',changed);return()=>{epoch.current++;window.removeEventListener('storage',changed);};
 },[load]);
 function access(){return (window as Window&{ZdxEventAccess?:EventAccess}).ZdxEventAccess;}
 function activate(){if(access())access()!.open();else setNotice('激活入口正在加载，请稍后重试。');}
 const center=wallet?.creditSource==='quota_center'||configuration.creditSource==='quota_center',flexible=center||(!wallet?.activated&&configuration.quotaCenterEnabled);
 const shop=purchaseUrl(wallet?.shopProductUrl||configuration.shopProductUrl);
 return <main className="credit-page"><header className="credit-header"><Link href="/"><b>✿ 紫丁香计划</b></Link></header><nav className="credit-nav"><a href="/workbench.html">返回创作工作台</a><Link href="/account/studio?type=image&provider=platform">打开图片创作</Link>{authenticated&&<button className="credit-link-button" type="button" onClick={()=>access()?.exit()}>退出当前创作空间</button>}</nav><div className="credit-heading"><span>我的额度</span><h1>我的创作次数</h1><p>{flexible?'文案、图片、视频次数按需组合。激活后分别使用，余额随这张激活码保存。':'每卡含 5 张图片、10 次文案创作和 2 条 15 秒视频，首次激活起 7 天有效。输入激活码即可使用，不需要注册或设置密码。'}</p></div>
  {notice&&<p className="credit-notice" role="status">{notice}</p>}
  {loading?<section className="credit-panel"><p role="status">正在读取创作额度…</p></section>:!authenticated||!wallet?.activated?<section className="credit-panel"><h2>输入激活码开始</h2><p>粘贴购买或收到的完整激活码即可开始。之后输入同一码，可继续使用原作品与剩余额度。</p><button className="credit-button" type="button" onClick={activate}>输入激活码</button></section>:null}
  {shop&&<div className="credit-nav"><a className="credit-button" href={shop} target="_blank" rel="noopener noreferrer">{wallet?.activated?'按需购买新激活码':'购买激活码'} ↗</a>{wallet?.activated&&<button className="credit-link-button" type="button" onClick={activate}>使用另一张激活码</button>}</div>}
  {wallet?.activated&&<><p className="credit-service" role="status">{center?'文案、图片、视频分别扣次，用完一种不会扣除其他类型。':wallet.active?'体验期内。图片、文案和视频额度分别计算。':'体验已到期，可以继续查看已有作品；新的生成需要有效体验额度。'}</p>{center&&!!(wallet.shared?.total||wallet.shared?.available||wallet.shared?.reserved||wallet.shared?.used)&&<p className="credit-service">各项可用次数含 {wallet.shared!.available} 次共享额度，可用于任一类型，三项不能相加。共享处理中 {wallet.shared!.reserved||0} 次 · 已使用 {wallet.shared!.used||0} 次。</p>}<div className="credit-columns">{(['text','image','video'] as const).map(capability=>{const quota=wallet.quotas.find(row=>row.capability===capability);return <section className="credit-panel" key={capability}><h2>{!center&&capability==='video'?'15 秒视频':names[capability]}</h2><p>当前可用：<strong>{quota?.available??'—'}</strong> {capability==='image'?'张':capability==='video'?'条':'次'}</p><p>处理中：{quota?.reserved??'—'} · 已成功使用：{quota?.used??'—'} · 已到账总额：{quota?.total??'—'}</p><p>{quota?.expiresAt?'到期时间：'+date(quota.expiresAt)+'（北京时间）':center?'按激活码实际到账次数使用':quota&&quota.total>0?'体验已到期':'激活后开始计时'}</p><p>任务先占用次数，成功后扣除；明确失败释放，待确认时保留占用。</p><a className="credit-button" href={capability==='text'?'/workbench.html':'/account/studio?type='+capability+'&provider=platform'}>{capability==='image'?'开始图片创作':capability==='video'?'开始视频创作':'开始文案创作'}</a></section>;})}</div>
   <section className="credit-panel" style={{marginTop:24}}><h2>最近额度记录</h2><button className="credit-button" disabled={loading} onClick={()=>{setLoading(true);void load();}}>刷新额度和记录</button>{wallet.entries?.length?<ul className="credit-ledger">{wallet.entries.map(entry=><li key={entry.id}><div><b>{names[entry.capability]} · {entry.kind==='grant'?'激活码到账':'成功创作'}</b><span>{entry.note}</span><small>{date(entry.createdAt)}</small></div><strong className={entry.delta>0?'credit-plus':''}>{entry.delta>0?'+':''}{entry.delta} {entry.capability==='image'?'张':entry.capability==='video'?'条':'次'}</strong></li>)}</ul>:<p>还没有对应记录，当前可用次数以以上余额为准。</p>}</section>
   <section className="credit-panel" style={{marginTop:24}}><h2>次数怎么用</h2><p>每次成功生成使用对应类型的次数。主动重新生成或修改为新版本另计；查看资料、保存作品、查看历史和重新下载不扣次数。</p><p>请妥善保存激活码，不要转发给他人。同一码可以找回作品与剩余额度，不会重复充值。另一张卡对应独立创作空间，换卡不会删除原作品。{center?'视频时长以创作页显示为准。':'体验卡视频时长固定为 15 秒，不包含高级模型档位。'}</p></section></>}
  {!loading&&notice&&<button className="credit-button" onClick={()=>{setLoading(true);void load();}}>重新读取</button>}
  <footer className="credit-footer"><span>额度以服务器最新记录为准。</span></footer>
 </main>;
}
