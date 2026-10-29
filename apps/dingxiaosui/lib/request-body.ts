// Vinext + the local Workers runtime can restart a request when an unread body
// is abandoned on an early response. Drain without retaining the payload.
// Bound the work for oversized or stalled clients; those are not normal uploads.
export async function discardRequestBody(request: Request) {
  if (!request.body || request.bodyUsed) return;
  const reader = request.body.getReader();
  let total = 0;
  const timer = setTimeout(() => { void reader.cancel().catch(() => {}); }, 5000);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 24 * 1024 * 1024) { await reader.cancel(); break; }
    }
  } catch { /* A disconnected client must never turn a denial into a write. */ }
  finally { clearTimeout(timer); reader.releaseLock(); }
}
