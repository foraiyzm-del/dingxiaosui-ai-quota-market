import { ApiError, db } from './tenancy';

export const workspaceKeys = ['zidingxiang-workspace-v1', 'zidingxiang-opc-profile-v1', 'zidingxiang-opc-leads-v1'] as const;
export type WorkspaceEntries = Record<typeof workspaceKeys[number], string | null>;
type WorkspaceRow = { revision: number; entries_json: string; updated_at: string };
const emptyEntries = (): WorkspaceEntries => Object.fromEntries(workspaceKeys.map(key => [key, null])) as WorkspaceEntries;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const maxBytes = 6 * 1024 * 1024;

export async function readWorkspaceInput(request: Request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new ApiError(415, '请提交 JSON 格式的工作区资料');
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, '工作区资料为空');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new ApiError(413, '工作区资料不能超过 6 MB，请先导出备份并精简资料'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let body: unknown;
  try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw new ApiError(400, '工作区资料格式不正确'); }
  if (!object(body) || Object.keys(body).some(key => !['revision', 'entries'].includes(key)) || !Number.isSafeInteger(body.revision) || Number(body.revision) < 0) throw new ApiError(400, '工作区版本不正确');
  if (!object(body.entries) || Object.keys(body.entries).length !== workspaceKeys.length || Object.keys(body.entries).some(key => !(workspaceKeys as readonly string[]).includes(key))) throw new ApiError(400, '工作区字段不正确');
  const entries = emptyEntries();
  for (const key of workspaceKeys) {
    const value = body.entries[key];
    if (value === null) continue;
    if (typeof value !== 'string') throw new ApiError(400, '工作区内容需为 JSON 文本');
    let parsed: unknown;
    try { parsed = JSON.parse(value); } catch { throw new ApiError(400, '工作区内容不是有效 JSON'); }
    if (key === 'zidingxiang-workspace-v1') {
      if (!object(parsed)) throw new ApiError(400, '农品工作区格式不正确');
      const limits: Record<string, number> = { products: 1000, campaigns: 1000, drafts: 3000, plans: 3000, knowledge: 500, stock: 500, sales: 2000, office: 500, agentRuns: 200, manualHotTopics: 30, conversations: 60 };
      for (const [field, limit] of Object.entries(limits)) {
        const rows = parsed[field];
        if (rows === undefined && !['products', 'campaigns', 'drafts', 'plans'].includes(field)) continue;
        if (!Array.isArray(rows) || rows.length > limit || rows.some(row => !object(row))) throw new ApiError(400, `${field} 资料格式或数量不正确`);
      }
      if (Array.isArray(parsed.conversations) && parsed.conversations.some(thread => !object(thread) || !Array.isArray(thread.messages) || thread.messages.length > 100 || thread.messages.some(message => !object(message) || !['user', 'assistant'].includes(String(message.role)) || typeof message.text !== 'string' || message.text.length > 12000))) throw new ApiError(400, '对话记录格式或数量不正确');
    } else if (key === 'zidingxiang-opc-profile-v1' ? !object(parsed) : !Array.isArray(parsed) || parsed.length > 500 || parsed.some(row => !object(row))) throw new ApiError(400, '经营档案或咨询记录格式不正确');
    entries[key] = value;
  }
  return { revision: Number(body.revision), entries };
}

export async function getWorkspace(userId: string) {
  const row = await db().prepare('SELECT revision, entries_json, updated_at FROM account_workspaces WHERE user_id=?').bind(userId).first<WorkspaceRow>();
  return row ? { revision: row.revision, updatedAt: row.updated_at, entries: JSON.parse(row.entries_json) as WorkspaceEntries } : { revision: 0, updatedAt: null, entries: emptyEntries() };
}

export async function saveWorkspace(userId: string, revision: number, entries: WorkspaceEntries) {
  const now = new Date().toISOString(), encoded = JSON.stringify(entries);
  const row = revision === 0
    ? await db().prepare('INSERT INTO account_workspaces(user_id,revision,entries_json,updated_at) VALUES (?,1,?,?) ON CONFLICT(user_id) DO NOTHING RETURNING revision').bind(userId, encoded, now).first<{ revision: number }>()
    : await db().prepare('UPDATE account_workspaces SET revision=revision+1,entries_json=?,updated_at=? WHERE user_id=? AND revision=? RETURNING revision').bind(encoded, now, userId, revision).first<{ revision: number }>();
  if (row) return { revision: row.revision, updatedAt: now, entries };
  // A lost acknowledgement can safely be retried when the intended snapshot is already stored.
  const current = await getWorkspace(userId);
  if (workspaceKeys.every(key => current.entries[key] === entries[key])) return current;
  throw new ApiError(409, '另一台设备已更新资料。已保留本机修改，请先备份并核对服务器版本');
}
