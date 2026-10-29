import PlatformShell from '../platform-shell';
import MediaSettings from './settings-client';
import './media.css';
export const dynamic='force-dynamic';
export default function Page(){return <PlatformShell active="media"><div className="platform-heading"><div><div className="tenant-label">PRODUCT CONTENT STUDIO</div><h1>让品牌老板，打开就能创作。</h1><p>平台统一提供图片与视频服务。品牌账号拥有有效商户归属后即可试用，个人 API 配置可选。</p></div><span className="platform-heading-tag">公用媒体服务</span></div><MediaSettings/></PlatformShell>}
