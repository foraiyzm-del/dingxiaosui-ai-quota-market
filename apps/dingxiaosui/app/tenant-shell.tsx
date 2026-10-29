import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {identityReady,localAuthEnabled,platformIdentity} from '@/lib/identity';
import "./tenancy.css";
export default async function TenantShell({children}:{children:React.ReactNode}){
 const eventMode=(env as unknown as Record<string,string|undefined>).EVENT_ACTIVATION_ENABLED==='1';
 const who=eventMode?await getChatGPTUser():null,administrator=!!who&&platformIdentity(who);
 return <main className="tenant-shell"><div className="tenant-top"><a href="/">✿ 紫丁香计划</a><nav>{eventMode&&!administrator?<><a href="/workbench.html">创作工作台</a><a href="/account/event">我的体验额度</a></>:<><a href="/merchant">商户中心</a><a href="/platform">平台管理</a><a href="/admin">内容后台</a></>}{localAuthEnabled()&&<a href="/local-login">切换测试身份</a>}</nav></div>{localAuthEnabled()?<p className="tenant-notice">本地模拟身份 · 独立测试数据库。此处通过不代表真实生产登录已验证。</p>:eventMode&&!administrator?<p className="tenant-notice">现场体验 · 输入激活码即可创作。<a href="/account/event">查看图片与文案额度</a></p>:<p className="tenant-alert">{identityReady()?<>账号独立登录 · 商户资料按权限访问。 <a href="/login">{eventMode?'管理员登录':'登录 / 注册'}</a> · <a href="/logout">退出</a></>:"登录服务暂未启用。"}</p>}{children}</main>;
}
