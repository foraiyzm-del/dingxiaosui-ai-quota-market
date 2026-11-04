function pieceText(value) {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.map(part => typeof part === 'string' ? part : part?.text || part?.content || '').join('');
}

/** Turn an OpenAI-style SSE body into one chat completion object. */
export function assembleServerSentEvents(raw) {
  let content = '';
  let sawDelta = false;
  let usage = null;
  let id = null;
  const objects = [];
  for (const line of String(raw).split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const data = trimmed.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    let event;
    try { event = JSON.parse(data); } catch { continue; }
    if (!event || typeof event !== 'object' || Array.isArray(event)) continue;
    objects.push(event);
    if (typeof event.id === 'string') id = event.id;
    if (event.usage && typeof event.usage === 'object') usage = event.usage;
    const choice = Array.isArray(event.choices) ? event.choices[0] : null;
    if (choice?.delta) {
      sawDelta = true;
      content += pieceText(choice.delta.content);
    } else if (choice?.message) {
      const full = pieceText(choice.message.content);
      if (full) content = full;
    }
  }
  if (!objects.length) throw new Error('流式响应没有可解析的数据');
  if (!sawDelta && !content) return objects.at(-1);
  return { ...(id ? { id } : {}), choices: [{ message: { role: 'assistant', content } }], ...(usage ? { usage } : {}) };
}

/** JSON body, or an SSE stream if the gateway ignored stream:false. */
export function parseUpstreamBody(raw) {
  const text = String(raw ?? '').replace(/^\uFEFF/u, '').trim();
  if (!text) throw new Error('响应为空');
  if (text.startsWith('data:')) return assembleServerSentEvents(text);
  return JSON.parse(text);
}
