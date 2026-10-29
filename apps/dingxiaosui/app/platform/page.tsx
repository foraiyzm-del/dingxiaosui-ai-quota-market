import PlatformShell from './platform-shell';
import PlatformClient from './platform-client';
export const dynamic='force-dynamic';
export default function PlatformPage(){return <PlatformShell><div className="platform-heading"><div><div className="tenant-label">MERCHANT MANAGEMENT</div><h1>把每一家好店，连接起来。</h1><p>管理商户入驻与经营状态，让每家店铺拥有自己的经营空间。</p></div><span className="platform-heading-tag">商户入驻管理</span></div><PlatformClient/></PlatformShell>}
