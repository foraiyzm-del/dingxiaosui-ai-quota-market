import tasks from './dialogue-tasks.json';
import { clean } from './ai';
import type { WorkspaceEntries } from './workspace';

type Row = Record<string, unknown>;
export const dialogueTasks = tasks;
export const publicDialogueTasks = tasks.map(({id,name,group,description,placeholder,source})=>({id,name,group,description,placeholder,source}));
export function resolveDialogueTask(message: string, selectedId = 'general') {
  const selected = tasks.find(task => task.id === selectedId);
  if (!selected || selected.id !== 'general') return selected;
  const matches: [string, RegExp][] = [
    ['ppt', /PPT|幻灯片|演示/i], ['agri-model', /农业模特|农品模特/],
    ['new-farmer', /AI\s*新农人|新农人.*(?:账号|IP|定位)/i],
    ['design', /营销设计|海报(?:文案|设计)|包装(?:文案|设计)|视觉方案|宣传物料/],
    ['brand', /品牌营销|品牌定位|品牌故事|做(?:一)?个定位|做定位|想.*定位|如何定位|怎么定位|怎么宣传|如何宣传|应该.*宣传|宣传一下|宣传下|怎么推广|如何推广|想.*宣传|想.*推广|^定位$|^宣传$/],
    ['agri', /农产品营销|农品营销|农品内容|农产品内容|农品.*内容方案|农产品.*内容方案/],
    ['live', /直播带货|直播话术/], ['detail', /电商详情|详情页/],
    ['private', /私域团购|社群团购/], ['season', /节气上新|应季上新/],
    ['gift', /节日礼盒|礼盒推广/], ['channel', /招商|渠道合作/], ['visit', /采摘|农旅/],
    ['translate', /翻译|译成|译为/], ['minutes', /会议|纪要/], ['weekly', /周报|总结/],
    ['polish', /润色|改写|改成/], ['xiaohongshu', /小红书/], ['script', /脚本|短视频|视频号/],
    ['article', /公众号|文章/], ['campaign', /活动/], ['moments', /朋友圈|文案/],
    ['selling', /卖点/], ['email', /邮件/], ['sop', /SOP|操作步骤/i],
    ['excel', /Excel|表格公式/i], ['sales', /客户.*(?:回复|答疑|跟进)/],
    ['brief', /商业计划|创业计划/], ['knowledge', /整理.*知识库|知识库整理/],
  ];
  const id = matches.find(([, pattern]) => pattern.test(message))?.[0];
  return tasks.find(task => task.id === id) || selected;
}
export function dialogueContext(entries: WorkspaceEntries, message: string, selectedProductId = '') {
  const parse = (key: keyof WorkspaceEntries, fallback: unknown): unknown => { try { return JSON.parse(entries[key] || 'null') ?? fallback; } catch { return fallback; } };
  const raw = parse('zidingxiang-workspace-v1', {}) as Row;
  // Private knowledge is selected separately with account scope, opt-out and
  // relevance checks. Forwarding raw rows here would bypass those decisions.
  const keys = ['products', 'drafts', 'plans', 'campaigns', 'stock', 'sales', 'office', 'agentRuns', 'manualHotTopics'];
  const question = message.toLowerCase().slice(0, 500);
  const chinese = question.match(/[\u4e00-\u9fff]+/g) || [];
  const terms = [...new Set([...(question.match(/[a-z0-9]+/g) || []), ...chinese.flatMap(part => Array.from({length:Math.max(0,part.length-1)},(_,i)=>part.slice(i,i+2)))])].slice(0, 200);
  const data: Row = {};
  for (const key of keys) {
    const rows = Array.isArray(raw[key]) ? raw[key] as Row[] : [];
    const chosen = rows.filter(row => row && typeof row === 'object' && !['demo-product', 'demo-campaign'].includes(String(row.id))).map(row => {
      // Conversation history is deliberately excluded from workspace context.
      const value = Object.fromEntries(Object.entries(row).filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value)).map(([field, value]) => [field, typeof value === 'string' ? clean(value, 300) : value]));
      const haystack = JSON.stringify(value).toLowerCase();
      const named = [row.name, row.title].some(value => typeof value === 'string' && value.length > 1 && message.includes(value));
      const selected = !!selectedProductId && (row.id === selectedProductId || row.productId === selectedProductId);
      return { value, score: Number(selected) * 200 + Number(named) * 100 + terms.reduce((sum, term) => sum + Number(haystack.includes(term)), 0) };
    }).filter(row=>row.score>0).sort((a, b) => b.score - a.score).slice(0, 2).map(row => JSON.stringify(row.value).slice(0, key === 'products' ? 1200 : 650));
    data[key] = { count: rows.filter(row => !['demo-product', 'demo-campaign'].includes(String(row?.id))).length, selected: chosen };
  }
  data.profile = JSON.stringify(parse('zidingxiang-opc-profile-v1', {})).slice(0, 1200);
  data.leads = JSON.stringify((parse('zidingxiang-opc-leads-v1', []) as unknown[]).slice(0, 5)).slice(0, 1200);
  data.mediaProfile = JSON.stringify(raw.mediaProfile || {}).slice(0, 1000);
  // A fixed context ceiling avoids forwarding an entire large workspace to a provider.
  return JSON.stringify(data).slice(0, 18000);
}

export function previousDialogueDraft(entries: WorkspaceEntries, threadId: string, question: string) {
  if (!/改|润色|继续|上一|刚才|简短|扩写/.test(question)) return '';
  try {
    const workspace = JSON.parse(entries['zidingxiang-workspace-v1'] || '{}');
    const thread = Array.isArray(workspace.conversations) ? workspace.conversations.find((item: Row) => item.id === threadId) : null;
    const messages: Row[] = Array.isArray(thread?.messages) ? thread.messages : [];
    const prior = messages.slice().reverse().find(item => item.role === 'assistant' && item.artifact && typeof item.text === 'string');
    return clean(prior?.text, 9000);
  } catch { return ''; }
}
