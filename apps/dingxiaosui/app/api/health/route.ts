import {env} from 'cloudflare:workers';
import {quotaCenterEnabled} from '@/lib/quota-center';

export const dynamic = 'force-dynamic';

export async function GET() {
  const vars = env as unknown as Record<string, string | undefined>;
  let quotaCenter: 'ok' | 'down' | 'unconfigured' = 'unconfigured';
  if (quotaCenterEnabled()) {
    try {
      const base = new URL(vars.QUOTA_CENTER_URL!.trim());
      const response = await fetch(new URL('/api/health', base.origin), { cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(8000) });
      const body = await response.json().catch(() => null) as { service?: string } | null;
      quotaCenter = response.ok && body?.service === 'quota-center' ? 'ok' : 'down';
    } catch { quotaCenter = 'down'; }
  }
  return Response.json({ ok: quotaCenter !== 'down', service: 'dingxiaosui', quotaCenter, quotaCenterEnabled: quotaCenterEnabled(), buildId: vars.DING_BUILD_ID || '' }, { headers: { 'cache-control': 'no-store' } });
}
