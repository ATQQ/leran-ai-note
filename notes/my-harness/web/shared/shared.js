/**
 * 前端公共工具：用 fetch 消费 Server 推送的 SSE
 *
 * 为何不用 EventSource：
 * - EventSource 只支持 GET，而我们的 /api/run 需要 POST（传 prompt）
 * - 需要 AbortSignal，便于「取消」按钮断开
 *
 * SSE 帧格式（与 Server writeSse 对应）：
 *   event: <name>\n
 *   data: <json>\n
 *   \n
 */

/**
 * 把新到的文本拼进 buffer，按空行切出完整事件。
 * @returns { buffer 剩余半截, events 已解析事件列表 }
 */
export function parseSseChunk(buffer, chunkText) {
  const next = buffer + chunkText;
  const parts = next.split("\n\n");
  // 最后一段可能还不完整，留待下次
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
      // 非 JSON 时保留原始字符串
    }
    events.push({ event, data });
  }
  return { buffer: rest, events };
}

/**
 * POST 到 url，持续读取 SSE，每解析到一帧就回调 onEvent。
 * @param {{ body?: object, signal?: AbortSignal, onEvent?: Function }} options
 */
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
