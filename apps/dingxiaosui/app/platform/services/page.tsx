import PlatformShell from '../platform-shell';
import ServiceSettings from './settings-client';
import './services.css';
export const dynamic='force-dynamic';

export default function Page(){return <PlatformShell active="services"><div className="platform-heading"><div><div className="tenant-label">AI SERVICES</div><h1>接入一次，品牌直接创作。</h1><p>统一管理平台 AI 服务。品牌用户进入 AI 创作即可使用，无需填写密钥。</p></div></div><ServiceSettings/></PlatformShell>}
