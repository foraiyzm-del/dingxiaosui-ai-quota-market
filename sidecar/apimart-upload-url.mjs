// Only upload URLs returned by the authenticated APIMart upload endpoint are
// accepted. This does not fetch the asset or relax the download DNS boundary.
const uploadPaths = new Map([
  ['upload.apimart.ai', '/f/image/'],
  ['getapib.org', '/image/'],
]);
const unsafeCharacters = /[\s\u0000-\u001f\u007f-\u009f\\]/u;
const controls = /[\u0000-\u001f\u007f-\u009f\\]/u;

export function apimartUploadUrl(value, { secrets = [] } = {}) {
  if (typeof value !== 'string' || !value || value.length > 8000 || unsafeCharacters.test(value)) return null;
  try {
    const url = new URL(value);
    const prefix = uploadPaths.get(url.hostname);
    const parts = value.match(/^https:\/\/([^/?#]*)([^?#]*)/iu);
    const authority = parts?.[1].toLowerCase();
    if (!prefix || url.protocol !== 'https:' || url.username || url.password || url.port || value.includes('#')
      || ![url.hostname, `${url.hostname}:443`].includes(authority)) return null;
    if (!url.pathname.startsWith(prefix) || url.pathname.length === prefix.length) return null;
    // Do not let percent encoding hide control characters, credentials, path
    // traversal or separators that another HTTP stack could interpret differently.
    const decoded = decodeURIComponent(value);
    const pathname = decodeURIComponent(parts?.[2] || '');
    if (controls.test(decoded) || /%2f|%5c|%25/iu.test(url.pathname)
      || pathname.split('/').some(part => part === '.' || part === '..')) return null;
    for (const secret of secrets) {
      if (typeof secret === 'string' && secret && (value.includes(secret)
        || value.includes(encodeURIComponent(secret)) || decoded.includes(secret))) return null;
    }
    return url.href;
  } catch { return null; }
}
