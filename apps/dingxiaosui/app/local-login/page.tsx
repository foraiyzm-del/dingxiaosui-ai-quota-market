import { localAuthEnabled, localIdentities } from "@/lib/identity";
import "../tenancy.css";
export const dynamic="force-dynamic";
export default function LocalLogin(){return <main className="tenant-shell"><h1>本地模拟身份验收</h1>{localAuthEnabled()?<><p>仅隔离测试使用，不代表真实 ChatGPT 登录。切换身份后，所有接口重新检查成员关系。</p><form action="/api/local/session" method="post" className="tenant-panel">{Object.entries(localIdentities).map(([key,user])=><button key={key} name="identity" value={key}>{user.displayName}</button>)}<button name="identity" value="logout">退出测试身份</button></form></>:<p role="alert">此构建未开启本地测试身份。生产登录可信边界尚未确认，暂不可登录。</p>}</main>}
