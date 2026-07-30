/**
 * M5 步骤卡：mcp_bridge + Loop 每步（llm_request / tool / assistant…）
 */

export function createStepsView(root, onSelect) {
  let steps = [];

  function clear() {
    steps = [];
    root.replaceChildren();
  }

  function select(id) {
    root.querySelectorAll(".step-card").forEach((el) => {
      el.classList.toggle("is-active", el.dataset.id === String(id));
    });
    const step = steps.find((s) => s._uid === id);
    if (step) onSelect?.(step);
  }

  function append(eventName, data) {
    if (eventName === "text_delta") return;
    if (eventName === "meta" || eventName === "done") return;
    if (eventName === "stream_detail") {
      const kind = data.payload?.kind;
      // 保留与模型相关的汇总，跳过碎片噪声
      if (kind !== "tool_parse_done" && kind !== "text_summary") return;
    }

    const uid = steps.length + 1;
    const step = { _uid: uid, event: eventName, ...data };
    steps.push(step);

    const card = document.createElement("button");
    card.type = "button";
    card.className = "step-card";
    card.dataset.id = String(uid);
    if (eventName === "mcp_bridge") card.classList.add("is-mcp");
    if (eventName === "llm_request") card.classList.add("is-llm");
    if (eventName === "tool_start" || eventName === "tool_end") {
      card.classList.add("is-tool");
    }

    const head = document.createElement("div");
    head.className = "step-head";
    head.innerHTML = `<span>#${uid} · ${eventName}</span><span>${data.phase || ""}</span>`;

    const title = document.createElement("div");
    title.className = "step-title";
    title.textContent = data.title || eventName;

    const summary = document.createElement("div");
    summary.className = "step-summary";
    summary.textContent = data.summary || "";

    card.append(head, title, summary);
    card.onclick = () => select(uid);
    root.append(card);
    root.scrollTop = root.scrollHeight;

    if (
      eventName === "mcp_bridge" ||
      eventName === "llm_request" ||
      eventName === "tool_end" ||
      eventName === "run_end" ||
      eventName === "error"
    ) {
      select(uid);
    }
  }

  return { clear, append, select };
}

/** 点选步骤后填充详情与 JSON */
export function renderStepDetail(els, step) {
  const { detailPill, detailBody, jsonUnified, jsonOpenAI } = els;
  if (!step) {
    detailPill.textContent = "点选步骤";
    detailBody.textContent = "尚未选择步骤";
    jsonUnified.textContent = "—";
    jsonOpenAI.textContent = "—";
    return;
  }

  detailPill.textContent = `#${step._uid} · ${step.event}`;
  const lines = [
    `title: ${step.title || ""}`,
    `summary: ${step.summary || ""}`,
    step.actor ? `actor: ${step.actor}` : null,
    step.direction ? `direction: ${step.direction}` : null,
    step.note ? `note: ${step.note}` : null,
  ].filter(Boolean);
  detailBody.textContent = lines.join("\n");

  const p = step.payload || {};

  if (step.event === "llm_request") {
    jsonUnified.textContent = JSON.stringify(
      {
        context: p.context,
        messagesAfter: p.messagesAfter,
        messagesBefore: Array.isArray(p.messagesBefore)
          ? `(${p.messagesBefore.length} msgs)`
          : p.messagesBefore,
      },
      null,
      2,
    );
    jsonOpenAI.textContent = JSON.stringify(p.openaiRequest ?? null, null, 2);
    return;
  }

  if (step.event === "mcp_bridge") {
    jsonUnified.textContent = JSON.stringify(p, null, 2);
    jsonOpenAI.textContent = "（MCP 桥接阶段；出站模型 JSON 见后续 llm_request）";
    return;
  }

  if (step.event === "assistant_message") {
    jsonUnified.textContent = JSON.stringify(p, null, 2);
    jsonOpenAI.textContent = "（模型入站；出站见上一轮 llm_request）";
    return;
  }

  if (step.event === "tool_start" || step.event === "tool_end") {
    jsonUnified.textContent = JSON.stringify(p, null, 2);
    jsonOpenAI.textContent =
      "（工具经 MCP Host→Server；线缆帧见上方 JSON-RPC 日志）";
    return;
  }

  if (step.event === "stream_detail") {
    jsonUnified.textContent = JSON.stringify(p, null, 2);
    jsonOpenAI.textContent = "（流式解析细节）";
    return;
  }

  jsonUnified.textContent = JSON.stringify(p, null, 2);
  jsonOpenAI.textContent = "—";
}
