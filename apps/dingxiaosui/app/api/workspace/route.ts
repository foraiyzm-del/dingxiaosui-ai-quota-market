import { env } from 'cloudflare:workers';
import { actor, api, ApiError, json } from '@/lib/tenancy';
import { getWorkspace, readWorkspaceInput, saveWorkspace } from '@/lib/workspace';

export const dynamic = 'force-dynamic';
async function workspaceActor(request: Request) {
  const user = await actor();
  const expectedOwner = request.headers.get('x-zdx-workspace-owner');
  if (expectedOwner && expectedOwner !== user.id) throw new ApiError(403, '账号已改变，请重新登录后同步资料');
  if (request.method === 'PUT' && !expectedOwner) throw new ApiError(400, '缺少工作区账号标识，请刷新页面');
  return user;
}
export async function GET(request: Request) {
  return api(request, async () => json(await getWorkspace((await workspaceActor(request)).id)));
}
export async function PUT(request: Request) {
  return api(request, async () => {
    const user = await workspaceActor(request);
    const expected = (env as unknown as Record<string, string>).APP_ORIGIN || new URL(request.url).origin;
    if (request.headers.get('origin') !== expected) throw new ApiError(403, '请求来源不允许');
    const { revision, entries } = await readWorkspaceInput(request);
    return json(await saveWorkspace(user.id, revision, entries));
  });
}
