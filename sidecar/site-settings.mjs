const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };

export function createSiteSettings(db) {
  db.exec('CREATE TABLE IF NOT EXISTS center_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  function origin(value) {
    if (value === undefined || value === null || value === '') return '';
    if (typeof value !== 'string' || value.length > 300) fail(400, '丁小穗公开地址格式无效');
    let url;
    try { url = new URL(value.trim()); } catch { fail(400, '丁小穗公开地址必须是完整网址'); }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || (url.protocol === 'http:' && !local)) {
      fail(400, '丁小穗公开地址请填写 https 域名；本机试用才可以使用 http://127.0.0.1');
    }
    // Operators often paste the workbench entry. Redeem links still use the site origin.
    if (url.pathname !== '/' && url.pathname !== '' && url.pathname !== '/workbench.html') fail(400, '丁小穗公开地址只填写域名。生产入口是 https://域名/workbench.html，扫码地址会用同一域名下的 /redeem');
    return url.origin;
  }
  return {
    get() {
      const row = db.prepare("SELECT value FROM center_settings WHERE key='dingxiaosui_origin'").get();
      return { dingxiaosuiOrigin: row?.value || '' };
    },
    save(input = {}) {
      const dingxiaosuiOrigin = origin(input.dingxiaosuiOrigin);
      db.prepare("INSERT INTO center_settings(key,value) VALUES('dingxiaosui_origin',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(dingxiaosuiOrigin);
      return { dingxiaosuiOrigin };
    },
  };
}

export function redeemLink(origin, code) {
  if (!origin || !code) return '';
  const url = new URL('/redeem', origin.endsWith('/') ? origin : `${origin}/`);
  url.searchParams.set('code', code);
  return url.toString();
}
