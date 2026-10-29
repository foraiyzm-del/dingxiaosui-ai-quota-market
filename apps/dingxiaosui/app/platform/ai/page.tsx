import PlatformShell from '../platform-shell';
import AISettings from './settings-client';
export const dynamic='force-dynamic';
export default function Page(){return <PlatformShell active="ai"><div className="platform-heading"><div><div className="tenant-label">MODEL CONNECTION</div><h1>让创作，多一份助力。</h1><p>统一配置文字模型，连接内容创作、经营方案与丁小穗问答。</p></div><span className="platform-heading-tag">AI 设置</span></div><AISettings/></PlatformShell>}
