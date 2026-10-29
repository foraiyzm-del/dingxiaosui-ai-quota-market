import Link from 'next/link';
import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {platformIdentity} from '@/lib/identity';
import Studio from './studio-client';
import './studio.css';
import '../../../ai-tutorial-entry.css';
export const dynamic='force-dynamic';
export default async function Page(){
 const vars=env as unknown as Record<string,string|undefined>,eventMode=vars.EVENT_ACTIVATION_ENABLED==='1'||!!(vars.QUOTA_CENTER_URL&&vars.QUOTA_PLATFORM_KEY),who=eventMode?await getChatGPTUser():null,eventGuest=eventMode&&!(who&&platformIdentity(who));
 return <main className="media-studio"><nav className="studio-nav"><Link className="studio-brand" href="/">紫丁香计划<span>AI 创作</span></Link><div>{!eventGuest&&<a className="ai-tutorial-entry" href="/ai-tutorial.html" target="_blank" rel="noopener" title="在新标签页打开教程，边看边操作"><span aria-hidden="true">?</span>使用教程</a>}{!eventGuest&&<a href="/video-studio.html">30 秒成片</a>}<a href="/workbench.html">{eventGuest?'创作工作台':'经营工作台'}</a>{eventGuest?<a href="/account/event">我的创作额度</a>:<a href="/account/models">AI 设置</a>}{eventGuest&&!who&&<button type="button" className="event-activation-trigger" data-event-activate>激活</button>}</div></nav><header className="studio-hero"><span className="studio-eyebrow">更懂山西 · 更懂山西农产品 · 更懂农业品牌</span><h1>今天，想为农品做点什么？</h1><p>{eventGuest?'从一款好农品开始，让想法变成图片或短片。选择用途、补充资料，丁小穗陪你完成创作。':'从真实产地、农品特点与品牌资料开始，制作图片和视频。补充商品事实，再确认创作要求。'}</p></header><Studio eventGuest={eventGuest}/></main>;
}
