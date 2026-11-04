'use client';
import {useEffect,useState} from 'react';

function prefill(raw: string) {
  const compact = raw.trim().toUpperCase().replace(/[\s-]+/g, '');
  if (/^QTA[0-9A-F]{36}$/.test(compact)) return `QTA-${compact.slice(3)}`;
  if (/^QTA[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{16}$/.test(compact)) {
    const body = compact.slice(3);
    return `QTA-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}-${body.slice(12)}`;
  }
  return raw.trim();
}

export default function RedeemPage() {
  const [code, setCode] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  useEffect(() => {
    const incoming = new URLSearchParams(location.search).get('code') || '';
    if (incoming) setCode(prefill(incoming));
    void fetch('/api/event/session', { cache: 'no-store' }).then(async response => {
      if (!response.ok) return;
      const body = await response.json() as { authenticated?: boolean };
      setLoggedIn(Boolean(body.authenticated));
    }).catch(() => undefined);
  }, []);
  const returnTo = `/redeem?code=${encodeURIComponent(code || new URLSearchParams(typeof location === 'undefined' ? '' : location.search).get('code') || '')}`;
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true); setNotice('正在确认激活码，请稍候…');
    try {
      const response = await fetch('/api/event/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: code.trim() }) });
      const body = await response.json() as { error?: string; authenticated?: boolean };
      if (!response.ok || !body.authenticated) throw new Error(body.error || '激活未完成，请用同一张卡再试一次');
      location.replace('/workbench.html');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '激活未完成，请稍后再试');
      setBusy(false);
    }
  }
  return <main style={{ maxWidth: 480, margin: '0 auto', padding: '28px 18px 48px', fontFamily: '"Source Han Sans SC","Noto Sans SC",sans-serif', color: '#1f2933' }}>
    <a href="/workbench.html" style={{ color: '#5b4b8a', textDecoration: 'none' }}>丁小穗</a>
    <h1 style={{ fontSize: 28, lineHeight: 1.3, margin: '18px 0 8px' }}>兑换激活码</h1>
    <p style={{ lineHeight: 1.6 }}>请核对卡面上的激活码。确认后才会兑换，不会一打开页面就扣次数。这张卡就是进入创作的凭证，不用另外注册。</p>
    <form onSubmit={submit} style={{ display: 'grid', gap: 12, marginTop: 18 }}>
      <label style={{ display: 'grid', gap: 6 }}>激活码
        <input value={code} onChange={event => setCode(event.target.value)} autoCapitalize="characters" autoCorrect="off" spellCheck={false} inputMode="text" required maxLength={120} style={{ fontSize: 18, padding: '12px 10px', letterSpacing: '0.04em' }} />
      </label>
      <button disabled={busy} style={{ fontSize: 18, padding: '12px 14px', background: '#5b4b8a', color: 'white', border: 0, borderRadius: 8 }}>{busy ? '正在确认…' : '确认兑换并进入'}</button>
    </form>
    {notice && <p role="status" style={{ lineHeight: 1.5 }}>{notice}</p>}
    <p style={{ lineHeight: 1.6 }}>{loggedIn ? '当前浏览器已登录。确认后会进入这张卡对应的作品和额度。' : '还没有登录也可以直接用卡兑换。如果您已经有丁小穗账号，可以先登录或注册，完成后会回到本页，再点确认。'}</p>
    {!loggedIn && <p style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
      <a href={`/login?return_to=${encodeURIComponent(returnTo)}`}>已有账号，登录后兑换</a>
      <a href={`/login?return_to=${encodeURIComponent(returnTo)}`}>注册后回到兑换</a>
    </p>}
  </main>;
}
