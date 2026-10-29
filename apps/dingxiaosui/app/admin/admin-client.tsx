"use client";

import { useEffect, useState } from "react";

type Article = { id:string; type:string; title:string; summary:string; body:string; cover_url:string; source_url:string; status:string; updated_at:string };
type Post = { id:string; author:string; title:string; body:string; category:string; status:string; is_featured:number; is_pinned:number; created_at:string };
type Media = { id:string; name:string; mime:string; size:number; createdAt:string };
type State = { settings:Record<string,string>; articles:Article[]; posts:Post[]; media:Media[] };
const emptyArticle = { id:"", type:"news", title:"", summary:"", body:"", coverUrl:"", sourceUrl:"", status:"draft" };
const siteFields = [
  { key:"hero_title", label:"首页主标题", help:"一句话说清紫丁香计划想解决什么问题。" },
  { key:"hero_description", label:"首屏说明", help:"突出农品企业的现实痛点和工作台方法。" },
  { key:"hero_image", label:"Banner 图片", help:"上传横版图片后，粘贴素材库链接。" },
  { key:"logo_image", label:"Logo 图片", help:"建议使用透明背景或白底标识。" },
  { key:"mission_text", label:"研究院宗旨说明", help:"保留研究院原有四项目标，补充计划的具体路径。" },
  { key:"opc_message", label:"OPC 计划介绍", help:"说明谁可以加入、需要准备什么、如何开始。" },
];

export default function AdminClient({ email, localTest=false }: { email:string; localTest?:boolean }) {
  const [tab,setTab] = useState("site");
  const [state,setState] = useState<State | null>(null);
  const [settings,setSettings] = useState<Record<string,string>>({});
  const [article,setArticle] = useState({ ...emptyArticle });
  const [notice,setNotice] = useState("");
  const [busy,setBusy] = useState(false);
  async function load() {
    const response = await fetch("/api/admin/state", { cache:"no-store" });
    const value = await response.json() as State & {error?:string};
    if (!response.ok) throw new Error(value.error || "后台数据读取失败");
    setState(value); setSettings(value.settings || {});
  }
  useEffect(() => { load().catch((error) => setNotice(error.message)); }, []);
  async function send(path:string, method:string, body:unknown) {
    setBusy(true); setNotice("");
    try {
      const response = await fetch(path,{ method, headers:{ "content-type":"application/json" }, body:JSON.stringify(body) });
      const value = await response.json() as {error?:string;id:string};
      if (!response.ok) throw new Error(value.error || "保存失败");
      await load(); setNotice("已保存。公开内容可能需要约半分钟刷新缓存。");
      return value;
    } catch(error) { setNotice(error instanceof Error ? error.message : "保存失败"); return null; }
    finally { setBusy(false); }
  }
  async function upload(file:File | undefined) {
    if (!file) return;
    setBusy(true); setNotice("");
    try {
      const form = new FormData(); form.append("file",file);
      const response = await fetch("/api/admin/media",{ method:"POST", body:form });
      const value = await response.json() as {error?:string;name:string;url:string};
      if (!response.ok) throw new Error(value.error || "上传失败");
      await load(); setNotice(`已上传 ${value.name}，链接：${value.url}`);
      await navigator.clipboard.writeText(value.url).catch(() => {});
    } catch(error) { setNotice(error instanceof Error ? error.message : "上传失败"); }
    finally { setBusy(false); }
  }
  async function copyWeChatDraft() {
    const draft = `标题：${article.title}\n摘要：${article.summary}\n\n${article.body}\n\n封面：${article.coverUrl || "待添加"}\n来源：${article.sourceUrl || "待核实"}`;
    try { await navigator.clipboard.writeText(draft); setNotice("已复制公众号排版稿，可粘贴到公众号草稿箱。正式发布仍需在公众号后台审核。") }
    catch { setNotice("复制失败，请检查浏览器剪贴板权限。"); }
  }
  const tabs = [{id:"site",name:"官网规划",no:"01"},{id:"articles",name:"文章与资料",no:"02"},{id:"community",name:"社区审核",no:"03"},{id:"media",name:"图片与文档",no:"04"}];
  return <div className="admin-shell"><aside className="admin-sidebar"><div className="admin-brand"><span>✿</span><div><b>紫丁香计划</b><small>内容运营后台</small></div></div><nav className="admin-platform-links" aria-label="平台管理导航"><a href="/platform">商户入驻 <span>↗</span></a><a href="/platform/ai">AI 设置 <span>↗</span></a></nav><p className="admin-sidebar-label">内容管理</p><nav aria-label="后台功能">{tabs.map((item) => <button type="button" key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}><small>{item.no}</small>{item.name}</button>)}</nav><div className="admin-sidebar-bottom"><a href="/index.html" target="_blank">查看官网 ↗</a><a href="/workbench.html" target="_blank">打开工作台 ↗</a><span>{email}</span></div></aside><main className="admin-main"><header className="admin-top"><span>山西农业大学智能传播研究院 · 紫丁香计划</span><a href={localTest ? "/local-login" : "/logout"} target="_top">{localTest ? "切换或退出测试身份" : "退出登录"}</a></header><div className="admin-content"><div className="admin-heading"><div><small>CONTENT CONTROL / 紫丁香计划</small><h1>{tabs.find((x) => x.id === tab)?.name}</h1><p>把对外表达、真实资料和社区内容放在同一处管理。</p></div><span className="admin-live"><i /> {localTest ? "本地模拟管理员 · 非生产登录" : "已登录管理员"}</span></div>{notice && <div className="admin-notice" role="status">{notice}</div>}
    {tab === "site" && <section className="admin-panel"><div className="admin-panel-head"><div><small>HOMEPAGE SYSTEM</small><h2>首页内容与品牌视觉</h2></div><button disabled={busy} onClick={() => send("/api/admin/settings","PUT",settings)}>保存并同步官网</button></div><div className="admin-fields">{siteFields.map((field) => <label key={field.key}><b>{field.label}</b><small>{field.help}</small>{field.key.includes("description") || field.key.includes("text") || field.key.includes("message") ? <textarea value={settings[field.key] || ""} onChange={(event) => setSettings({...settings,[field.key]:event.target.value})} rows={4} /> : <input value={settings[field.key] || ""} onChange={(event) => setSettings({...settings,[field.key]:event.target.value})} />}{field.key.endsWith("_image") && settings[field.key]?.startsWith("/") && <img className="admin-image-preview" src={settings[field.key]} alt="当前图片预览" />}</label>)}</div><p className="admin-hint">空字段沿用目前官网设计。上线前请核对标题、事实、图片使用权和研究院标识。</p></section>}
    {tab === "articles" && <div className="admin-columns"><section className="admin-panel"><div className="admin-panel-head"><div><small>EDITOR</small><h2>{article.id ? "编辑内容" : "新建内容"}</h2></div><button type="button" className="light" onClick={() => setArticle({...emptyArticle})}>新建</button></div><div className="admin-fields"><label><b>内容类型</b><select value={article.type} onChange={(event) => setArticle({...article,type:event.target.value})}><option value="news">行动文章</option><option value="guide">学院课程</option><option value="document">文档资料</option></select></label><label><b>标题</b><input value={article.title} onChange={(event) => setArticle({...article,title:event.target.value})} /></label><label><b>摘要</b><textarea rows={3} value={article.summary} onChange={(event) => setArticle({...article,summary:event.target.value})} /></label><label><b>正文</b><textarea rows={14} value={article.body} onChange={(event) => setArticle({...article,body:event.target.value})} /></label><label><b>封面图片链接</b><input value={article.coverUrl} onChange={(event) => setArticle({...article,coverUrl:event.target.value})} /></label><label><b>来源或文档链接</b><input value={article.sourceUrl} onChange={(event) => setArticle({...article,sourceUrl:event.target.value})} /></label></div><div className="admin-actions"><button disabled={busy} onClick={() => send("/api/admin/articles","POST",{...article,status:"draft"})}>保存草稿</button><button disabled={busy} onClick={async () => { const value=await send("/api/admin/articles","POST",{...article,status:"published"}); if(value) setArticle({...article,id:value.id,status:"published"}); }}>发布到官网</button><button className="light" onClick={copyWeChatDraft}>复制公众号排版稿</button></div><p className="admin-hint">公众号自动推送需要公众号主体授权与接口权限。此处先输出可审阅的图文草稿。</p></section><section className="admin-panel"><div className="admin-panel-head"><div><small>LIBRARY</small><h2>内容列表</h2></div><span>{state?.articles?.length || 0} 篇</span></div><div className="admin-list">{state?.articles?.map((item) => <button key={item.id} onClick={() => setArticle({id:item.id,type:item.type,title:item.title,summary:item.summary,body:item.body,coverUrl:item.cover_url,sourceUrl:item.source_url,status:item.status})}><span>{item.type === "guide" ? "学院课程" : item.type === "document" ? "文档资料" : "行动文章"} · {item.status === "published" ? "已发布" : "草稿"}</span><b>{item.title}</b><small>{item.updated_at?.slice(0,10)}</small></button>)}{!state?.articles?.length && <p>暂无后台文章。官网原有行动纪实会保留。</p>}</div></section></div>}
    {tab === "community" && <section className="admin-panel"><div className="admin-panel-head"><div><small>COMMUNITY MODERATION</small><h2>帖子审核与加精</h2></div><span>{state?.posts?.length || 0} 条</span></div><div className="admin-posts">{state?.posts?.map((post) => <article key={post.id}><div><small>{post.category} · {post.author} · {post.created_at?.slice(0,10)}</small><h3>{post.title}</h3><p>{post.body}</p></div><div className="admin-post-controls"><select aria-label="审核状态" value={post.status} onChange={(event) => send("/api/admin/posts","PATCH",{id:post.id,status:event.target.value,isFeatured:!!post.is_featured,isPinned:!!post.is_pinned})}><option value="pending">待审核</option><option value="published">公开</option><option value="hidden">隐藏</option></select><label><input type="checkbox" checked={!!post.is_featured} onChange={(event) => send("/api/admin/posts","PATCH",{id:post.id,status:post.status,isFeatured:event.target.checked,isPinned:!!post.is_pinned})} /> 加精</label><label><input type="checkbox" checked={!!post.is_pinned} onChange={(event) => send("/api/admin/posts","PATCH",{id:post.id,status:post.status,isFeatured:!!post.is_featured,isPinned:event.target.checked})} /> 置顶</label></div></article>)}{!state?.posts?.length && <p>尚无提交到后台的帖子。公开社区的数据接入后，这里就可以集中审核。</p>}</div></section>}
    {tab === "media" && <section className="admin-panel"><div className="admin-panel-head"><div><small>ASSET LIBRARY</small><h2>图片与文档素材库</h2></div><span>{state?.media?.length || 0} 份</span></div><label className="admin-upload">点击上传 Banner、Logo、文章图片或 PDF/DOCX 文档<input type="file" accept="image/jpeg,image/png,image/webp,.pdf,.docx" onChange={(event) => upload(event.target.files?.[0])} disabled={busy} /></label><div className="admin-media-grid">{state?.media?.map((item) => <div key={item.id}>{item.mime.startsWith("image/") ? <img src={`/media/${item.id}`} alt={item.name} /> : <span className="media-document">DOC</span>}<b>{item.name}</b><small>{(item.size/1024/1024).toFixed(2)} MB</small><button onClick={() => navigator.clipboard.writeText(`/media/${item.id}`).then(() => setNotice("素材链接已复制"))}>复制链接</button></div>)}</div><p className="admin-hint">图片不超过 5 MB，文档不超过 20 MB。文档默认仅管理员能读取，正式公开前请确认授权范围。</p></section>}
  </div></main></div>;
}
