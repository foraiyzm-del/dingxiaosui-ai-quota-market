import ModelSettings from './settings-client';
import './settings.css';
import './media-settings.css';
export default function Page(){return <main className="personal-settings"><nav><a href="/workbench.html">← 返回工作台</a><div><a href="/account/studio">AI 创作</a><a href="/merchant">商户中心</a></div></nav><header className="ai-settings-header"><span className="settings-eyebrow">紫丁香计划 · 账号设置</span><h1>AI 设置</h1><p>默认用平台服务，兑换次数后开始文字创作。<br/>使用自己的 API，是一个可选项。</p></header><ModelSettings/></main>}

