import {Building2, Settings2, FileText, ArrowUpRight, Flower2, ShieldCheck, Store, ChevronRight, FlaskConical} from 'lucide-react';
import {identityReady,localAuthEnabled} from '@/lib/identity';
import {env} from 'cloudflare:workers';
import '../tenancy.css';
import './platform.css';
export default function PlatformShell({children,active='merchants'}:{children:React.ReactNode;active?:'merchants'|'ai'|'media'|'services'|'codes'}){
 const local=localAuthEnabled(),eventMode=(env as unknown as Record<string,string|undefined>).EVENT_ACTIVATION_ENABLED==='1';
 const items=[{href:'/platform',label:'商户入驻',icon:Building2,id:'merchants'},{href:'/platform/services',label:'AI 服务',icon:Settings2,id:active==='ai'?'ai':active==='media'?'media':'services'},{href:eventMode?'/platform/event-codes':'/platform/activation-codes',label:eventMode?'现场体验卡':'激活码管理',icon:FileText,id:'codes'},{href:'/admin',label:'内容后台',icon:FileText,id:'content'}];
 return <div className="platform-app"><aside className="platform-rail">
 <a className="platform-brand" href="/"><span className="platform-brand-icon"><Flower2 size={27}/></span><span><b>紫丁香计划</b><small>平台管理中心</small></span></a>
 <div className="platform-space"><ShieldCheck size={15}/><span>平台管理空间</span><span className="space-dot"/></div><div className="rail-label">平台工作台</div>
 <nav aria-label="平台管理导航">{items.map(({href,label,icon:Icon,id})=><a key={id} href={href} className={active===id?'is-active':''} aria-current={active===id?'page':undefined}><Icon size={19}/><span>{label}</span>{active===id&&<ChevronRight size={14}/>}</a>)}</nav>
 <div className="rail-label rail-secondary-label">快捷访问</div><nav aria-label="快捷访问"><a href="/merchant"><Store size={18}/><span>商户中心</span></a><a href="/workbench.html"><ArrowUpRight size={18}/><span>经营工作台</span></a></nav>
 <div className="rail-bottom"><div className="rail-brand-note"><Flower2 size={27}/><b>让好农品，遇见更多人。</b><p>连接产地、商户与每一份信任。</p><a href="/">查看品牌官网 <ArrowUpRight size={13}/></a></div><small>紫丁香计划 · 山西农品</small></div></aside>
 <div className="platform-body"><header className="platform-topbar"><div className="platform-breadcrumb">管理中心 <ChevronRight size={13}/><strong>{active==='merchants'?'商户入驻':active==='codes'?'激活码管理':'AI 服务'}</strong></div><div className="platform-top-actions"><a href="/workbench.html">打开工作台 <ArrowUpRight size={14}/></a><span className="platform-avatar" aria-hidden="true">紫</span></div></header>
 <main className="tenant-shell platform-content"><div className={`platform-environment ${local?'':'environment-warning'}`}><FlaskConical size={15}/><span>{local?'本地验收环境 · 使用模拟身份，尚未验证真实生产登录。':identityReady()?'独立账号登录 · 仅平台管理员可以修改平台设置。':'登录服务暂未启用。'}</span>{!local&&<a href="/login">登录账号</a>}{!local&&<a href="/logout">退出</a>}{local&&<a href="/local-login">切换测试身份 <ArrowUpRight size={12}/></a>}</div>{children}<footer className="platform-footer"><span>紫丁香计划 / 平台管理</span><span>每一份资料，都值得认真对待。</span></footer></main></div></div>;
}
