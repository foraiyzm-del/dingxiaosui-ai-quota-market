import { env } from 'cloudflare:workers';

export type ZlgIdentity = { sub: string; name: string; billingManaged: boolean };
export const centerRequired = () => (env as unknown as Record<string, string>).ZLG_GATEWAY_REQUIRED === '1';
export async function verifiedZlgIdentity(headers: Headers): Promise<ZlgIdentity | null> {
  try {
    const secret = (env as unknown as Record<string, string>).ZLG_GATEWAY_SECRET;
    if (!secret || secret.length < 32) return null;
    const payload = headers.get('x-zlg-identity') || '', signature = headers.get('x-zlg-signature') || '';
    if (!payload || payload.length > 4000 || !/^[a-f0-9]{64}$/.test(signature)) return null;
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const bytes = Uint8Array.from(signature.match(/../g)!, x => parseInt(x, 16));
    if (!await crypto.subtle.verify('HMAC', key, bytes, new TextEncoder().encode(payload))) return null;
    const raw = atob(payload.replaceAll('-', '+').replaceAll('_', '/')), v = JSON.parse(new TextDecoder().decode(Uint8Array.from(raw, x => x.charCodeAt(0))));
    if (v.appId !== 'zidingxiang' || v.aud !== 'zlg-app-gateway-v1' || typeof v.sub !== 'string' || !/^[a-f0-9-]{36}$/.test(v.sub) || !Number.isFinite(v.exp) || v.exp < Date.now() || v.exp > Date.now() + 60000) return null;
    return { sub: v.sub, name: String(v.name || '智链谷用户').slice(0, 60), billingManaged: v.billingManaged === true };
  } catch { return null; }
}
