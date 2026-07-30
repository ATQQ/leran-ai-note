/**
 * 协议时间线：展示 stream_detail
 * （文本碎片 / 文本汇总 / 工具碎片 / 解析完成）
 * 供运行时实时追加，以及从 Trace 重建时复用。
 */

/**
 * @param {HTMLElement} root
 */
export function clearTimeline(root) {
  root.replaceChildren();
}

/**
 * 追加一张协议细节卡
 * @param {HTMLElement} root
 * @param {{ title?: string, summary?: string, note?: string|null, payload?: unknown }} eventData
 */
export function appendTimelineCard(root, eventData) {
  const detail = eventData.payload;
  const kind =
    detail && typeof detail === "object" && "kind" in detail
      ? detail.kind
      : "unknown";

  const card = document.createElement("div");
  card.className = `tl-card kind-${kind}`;

  const head = document.createElement("div");
  head.className = "tl-head";
  head.textContent = eventData.title || kind;

  const summary = document.createElement("div");
  summary.className = "tl-summary";
  summary.textContent = eventData.summary || "";

  card.append(head, summary);

  if (kind === "text_fragment" && detail) {
    const grid = document.createElement("div");
    grid.className = "tl-grid";
    for (const [k, v] of [
      ["seq", String(detail.seq)],
      ["delta", detail.delta ?? ""],
      ["accContent", detail.accContent ?? ""],
    ]) {
      const key = document.createElement("span");
      key.className = "tl-k";
      key.textContent = k;
      const val = document.createElement("code");
      val.className = "tl-v";
      val.textContent = v;
      grid.append(key, val);
    }
    card.append(grid);
  }

  if (kind === "tool_fragment" && detail) {
    const grid = document.createElement("div");
    grid.className = "tl-grid";
    const rows = [
      ["index", String(detail.index)],
      ["id", detail.id || "—"],
      ["accName", detail.accName || "—"],
      ["accArguments", detail.accArguments || ""],
    ];
    if (detail.nameDelta) rows.push(["nameDelta", detail.nameDelta]);
    if (detail.argumentsDelta) rows.push(["argumentsDelta", detail.argumentsDelta]);
    for (const [k, v] of rows) {
      const key = document.createElement("span");
      key.className = "tl-k";
      key.textContent = k;
      const val = document.createElement("code");
      val.className = "tl-v";
      val.textContent = v;
      grid.append(key, val);
    }
    card.append(grid);
  }

  if (kind === "text_summary" && detail) {
    const grid = document.createElement("div");
    grid.className = "tl-grid";
    for (const [k, v] of [
      ["deltaCount", String(detail.deltaCount)],
      ["contentLength", String(detail.contentLength)],
    ]) {
      const key = document.createElement("span");
      key.className = "tl-k";
      key.textContent = k;
      const val = document.createElement("code");
      val.className = "tl-v";
      val.textContent = v;
      grid.append(key, val);
    }
    card.append(grid);
    if (detail.content) {
      const pre = document.createElement("pre");
      pre.className = "tl-json";
      pre.textContent = detail.content;
      card.append(pre);
    }
  }

  if (kind === "tool_parse_done" && detail?.toolCalls) {
    const pre = document.createElement("pre");
    pre.className = "tl-json";
    pre.textContent = JSON.stringify(detail.toolCalls, null, 2);
    card.append(pre);
  }

  if (eventData.note) {
    const note = document.createElement("div");
    note.className = "tl-note";
    note.textContent = eventData.note;
    card.append(note);
  }

  root.append(card);
  root.scrollTop = root.scrollHeight;
}

/**
 * 从 Trace steps 重建协议时间线
 * @param {HTMLElement} root
 * @param {Array<{ phase?: string, title?: string, summary?: string, note?: string|null, payload?: unknown }>} steps
 */
export function rebuildTimelineFromSteps(root, steps) {
  clearTimeline(root);
  for (const step of steps) {
    const kind = step.payload?.kind;
    if (
      step.phase === "stream_parse" ||
      kind === "text_fragment" ||
      kind === "tool_fragment" ||
      kind === "text_summary" ||
      kind === "tool_parse_done"
    ) {
      appendTimelineCard(root, step);
    }
  }
}
