/**
 * 用 fetch 读 SSE（支持 POST + AbortSignal）
 */
export function parseSseChunk(buffer, chunkText) {
  const next = buffer + chunkText;
  const parts = next.split("\n\n");
  const rest = parts.pop() || "";
  const events = [];
  for (const block of parts) {
    const lines = block.split("\n").filter(Boolean);
    let event = "message";
    const dataLines = [];
    for (const line of lines) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    if (!dataLines.length) continue;
    let data = dataLines.join("\n");
    try {
      data = JSON.parse(data);
    } catch {
      /* keep string */
    }
    events.push({ event, data });
  }
  return { buffer: rest, events };
}

export async function runSse(url, { body, signal, onEvent }) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
    signal,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  if (!res.body) throw new Error("empty body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const decoded = decoder.decode(value, { stream: true });
    const parsed = parseSseChunk(buffer, decoded);
    buffer = parsed.buffer;
    for (const ev of parsed.events) onEvent?.(ev);
  }
}
